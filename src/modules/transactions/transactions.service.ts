import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { Transaction, TransactionType, TransactionState } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsService: AccountsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Initiate a transfer by creating a HOLD transaction
   * For external payments (ACCOUNT_REFILL) or internal purchases (PRODUCT_PURCHASE)
   */
  async initiateTransfer(
    accountAId: number,
    accountBId: number,
    amount: number | Decimal,
    type: TransactionType,
    meta: Record<string, any> = {},
  ): Promise<Transaction> {
    if (accountAId === accountBId) {
      throw new BadRequestException(
        'Source and destination accounts must be different',
      );
    }

    const amountDecimal = new Decimal(amount.toString());

    if (amountDecimal.lte(0)) {
      throw new BadRequestException('Amount must be positive');
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        type,
        state: TransactionState.HOLD,
        accountAId,
        accountBId,
        amountOut: amountDecimal,
        amountIn: amountDecimal, // Same amount for MVP (no conversion/fees)
        currency: 'USD',
        meta: JSON.stringify(meta),
      },
    });

    this.logger.log(
      `[TRANSACTION] Initiated ${type} txn=${transaction.id} A(${accountAId}) -> B(${accountBId}) amount=${amount} USD`,
    );

    return transaction;
  }

  /**
   * Complete payment transaction (ACCOUNT_REFILL)
   * If purchase: also create Order and PRODUCT_PURCHASE transaction
   * All operations are atomic within one DB transaction
   */
  async completePayTransaction(transactionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 1. Find and lock refill transaction
      const refillTransaction = await tx.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!refillTransaction) {
        throw new BadRequestException(`Transaction ${transactionId} not found`);
      }

      if (refillTransaction.state === TransactionState.COMPLETED) {
        this.logger.log(
          `[TRANSACTION] Already completed txn=${transactionId} (idempotent)`,
        );
        return; // Idempotent
      }

      if (
        refillTransaction.state !== TransactionState.PENDING &&
        refillTransaction.state !== TransactionState.HOLD
      ) {
        throw new BadRequestException(
          `Transaction ${transactionId} has invalid state: ${refillTransaction.state}`,
        );
      }

      // 2. Complete refill: update balances
      await this.accountsService.applyComplete(refillTransaction, tx);

      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          state: TransactionState.COMPLETED,
          completedAt: new Date(),
        },
      });

      this.logger.log(`[TRANSACTION] Refill COMPLETED txn=${transactionId}`);

      // 3. Check if this is a purchase (has productId in meta)
      const meta = JSON.parse(refillTransaction.meta) as Record<string, any>;
      const productId = meta?.productId as number;

      if (productId) {
        // Get product and user info
        const product = await tx.product.findUnique({
          where: { id: productId },
        });
        if (!product) {
          throw new BadRequestException(`Product ${productId} not found`);
        }

        const buyerAccountId = refillTransaction.accountBId; // User account
        const buyerAccount = await tx.account.findUnique({
          where: { id: buyerAccountId },
        });
        const buyerUserId = buyerAccount!.userId;

        const sellerUserId = 1; // Service user (id=1)
        const sellerAccount = await tx.account.findUnique({
          where: { userId: sellerUserId },
        });

        // Create Order
        const order = await tx.order.create({
          data: {
            productId,
            buyerUserId,
            sellerUserId,
            totalPrice: product.price,
            currency: 'USD',
            status: 'PAID',
          },
        });

        this.logger.log(
          `[ORDER] Created orderId=${order.id} productId=${productId} buyer=${buyerUserId} seller=${sellerUserId} total=$${product.price} USD`,
        );

        // Create and immediately complete PRODUCT_PURCHASE transaction
        const purchaseTransaction = await tx.transaction.create({
          data: {
            type: TransactionType.PRODUCT_PURCHASE,
            state: TransactionState.HOLD,
            accountAId: buyerAccountId,
            accountBId: sellerAccount!.id,
            amountOut: product.price,
            amountIn: product.price,
            currency: 'USD',
            meta: JSON.stringify({ orderId: order.id, productId }),
          },
        });

        // Apply purchase balance changes
        await this.accountsService.applyComplete(purchaseTransaction, tx);

        await tx.transaction.update({
          where: { id: purchaseTransaction.id },
          data: {
            state: TransactionState.COMPLETED,
            completedAt: new Date(),
          },
        });

        this.logger.log(
          `[TRANSACTION] Product purchase COMPLETED txn=${purchaseTransaction.id} buyer=${buyerUserId} -> seller=${sellerUserId} amount=$${product.price} USD`,
        );

        // Store purchase transaction for events
        meta.purchaseTransactionId = purchaseTransaction.id;
        meta.orderId = order.id;
      }

      // Store updated meta
      await tx.transaction.update({
        where: { id: transactionId },
        data: { meta: JSON.stringify(meta) },
      });
    });

    // 4. After commit: emit events
    const completedTransaction = await this.findById(transactionId);
    const meta = JSON.parse(completedTransaction.meta) as Record<string, any>;

    // Account balance changed events
    this.eventEmitter.emit('ACCOUNT_BALANCE_CHANGED', {
      accountId: completedTransaction.accountBId,
      transactionId,
    });

    // Transaction changed event
    this.eventEmitter.emit('TRANSACTION_CHANGED', {
      transactionId,
      state: TransactionState.COMPLETED,
    });

    // If purchase: emit additional events
    if (meta.orderId) {
      this.eventEmitter.emit('ORDER_CREATED', { orderId: meta.orderId });

      this.eventEmitter.emit('ACCOUNT_BALANCE_CHANGED', {
        accountId: completedTransaction.accountAId,
        transactionId: meta.purchaseTransactionId as string,
      });

      this.eventEmitter.emit('TRANSACTION_CHANGED', {
        transactionId: meta.purchaseTransactionId as string,
        state: TransactionState.COMPLETED,
      });
    }

    this.logger.log(`[EVENT] Published events for txn=${transactionId}`);
  }

  /**
   * Fail a transaction and reverse any partial changes
   */
  async failTransaction(transactionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        throw new BadRequestException(`Transaction ${transactionId} not found`);
      }

      if (transaction.state === TransactionState.FAILED) {
        this.logger.log(
          `[TRANSACTION] Already failed txn=${transactionId} (idempotent)`,
        );
        return; // Idempotent
      }

      if (transaction.state === TransactionState.COMPLETED) {
        throw new BadRequestException(
          `Cannot fail completed transaction ${transactionId}`,
        );
      }

      // If HOLD state and balances were partially changed, reverse them
      // For MVP, we assume HOLD doesn't touch balances yet, so just mark as FAILED
      await tx.transaction.update({
        where: { id: transactionId },
        data: { state: TransactionState.FAILED },
      });

      this.logger.log(`[TRANSACTION] Failed txn=${transactionId}`);
    });

    // Emit event
    this.eventEmitter.emit('TRANSACTION_CHANGED', {
      transactionId,
      state: TransactionState.FAILED,
    });
  }

  async findById(id: string): Promise<Transaction> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      throw new BadRequestException(`Transaction ${id} not found`);
    }

    return transaction;
  }

  async findByProviderSessionId(
    sessionId: string,
  ): Promise<Transaction | null> {
    return this.prisma.transaction.findUnique({
      where: { providerSessionId: sessionId },
    });
  }

  async findByPaymentIntentId(intentId: string): Promise<Transaction | null> {
    return this.prisma.transaction.findUnique({
      where: { paymentIntentId: intentId },
    });
  }
}
