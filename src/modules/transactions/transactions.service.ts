import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
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
   * Calculate balance from transaction history
   * This is the source of truth for account balance
   */
  async calculateBalanceFromHistory(accountId: number): Promise<Decimal> {
    const account = await this.accountsService.getById(accountId);

    // Get all completed transactions for this account
    const transactions = await this.prisma.transaction.findMany({
      where: {
        state: TransactionState.COMPLETED,
        OR: [{ accountAId: accountId }, { accountBId: accountId }],
      },
    });

    // Calculate: initial balance + incoming - outgoing
    let calculatedBalance = new Decimal(0);

    for (const tx of transactions) {
      if (tx.accountBId === accountId) {
        // Incoming transaction
        calculatedBalance = calculatedBalance.plus(tx.amountIn);
      }
      if (tx.accountAId === accountId) {
        // Outgoing transaction
        calculatedBalance = calculatedBalance.minus(tx.amountOut);
      }
    }

    this.logger.log(
      `[AUDIT] Account ${accountId} calculated balance from history: ${calculatedBalance.toNumber()}`,
    );

    return calculatedBalance;
  }

  /**
   * Audit account balance against transaction history
   * Throws error if mismatch detected
   */
  async auditBalance(accountId: number): Promise<void> {
    const account = await this.accountsService.getById(accountId);
    const calculatedBalance = await this.calculateBalanceFromHistory(accountId);

    const currentBalance = account.balance;
    const diff = currentBalance.minus(calculatedBalance).abs();

    if (diff.greaterThan(0.01)) {
      const errorMsg = `[AUDIT] Balance mismatch for account ${accountId}: current=${currentBalance.toNumber()}, calculated=${calculatedBalance.toNumber()}, diff=${diff.toNumber()}`;
      this.logger.error(errorMsg);
      throw new InternalServerErrorException(
        `Balance audit failed for account ${accountId}`,
      );
    }

    this.logger.log(
      `[AUDIT] Account ${accountId} balance is consistent: ${currentBalance.toNumber()}`,
    );
  }

  /**
   * Create and complete a CREDIT transaction (pополнение баланса)
   * Service account -> User account
   */
  async credit(
    userId: number,
    amount: number | Decimal,
    description?: string,
  ): Promise<Transaction> {
    const amountDecimal = new Decimal(amount.toString());

    if (amountDecimal.lte(0)) {
      throw new BadRequestException('Amount must be positive');
    }

    // Get service and user accounts
    const serviceAccount = await this.accountsService.getByUserId(1);
    const userAccount = await this.accountsService.getByUserId(userId);

    // Audit balance before transaction
    await this.auditBalance(userAccount.id);

    const completedTransaction = await this.prisma.retryableTransaction(
      async (tx) => {
        // Create and complete transaction
        const transaction = await tx.transaction.create({
          data: {
            type: TransactionType.CREDIT,
            state: TransactionState.HOLD,
            accountAId: serviceAccount.id,
            accountBId: userAccount.id,
            amountOut: amountDecimal,
            amountIn: amountDecimal,
            currency: 'USD',
            meta: JSON.stringify({ description }),
          },
        });

        // Update balances
        await tx.account.update({
          where: { id: serviceAccount.id },
          data: {
            balance: { decrement: amountDecimal },
            outgoing: { increment: amountDecimal },
          },
        });

        await tx.account.update({
          where: { id: userAccount.id },
          data: {
            balance: { increment: amountDecimal },
            incoming: { increment: amountDecimal },
          },
        });

        // Mark as completed
        const completed = await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            state: TransactionState.COMPLETED,
            completedAt: new Date(),
          },
        });

        this.logger.log(
          `[TRANSACTION] CREDIT completed txn=${transaction.id} user=${userId} amount=${amountDecimal.toNumber()} USD`,
        );

        return completed;
      },
    );

    // Audit balance after transaction
    await this.auditBalance(userAccount.id);

    // Emit events
    this.eventEmitter.emit('ACCOUNT_BALANCE_CHANGED', {
      accountId: userAccount.id,
      transactionId: completedTransaction.id,
    });

    this.eventEmitter.emit('TRANSACTION_CHANGED', {
      transactionId: completedTransaction.id,
      state: TransactionState.COMPLETED,
    });

    return completedTransaction;
  }

  /**
   * Create and complete a DEBIT transaction (списание баланса)
   * User account -> Service account
   * Optionally creates an Order if productId is provided
   */
  async debit(
    userId: number,
    amount: number | Decimal,
    productId?: number,
    description?: string,
  ): Promise<{ transaction: Transaction; orderId?: string }> {
    const amountDecimal = new Decimal(amount.toString());

    if (amountDecimal.lte(0)) {
      throw new BadRequestException('Amount must be positive');
    }

    // Get service and user accounts
    const serviceAccount = await this.accountsService.getByUserId(1);
    const userAccount = await this.accountsService.getByUserId(userId);

    // Check if user has sufficient balance
    const currentBalance = await this.calculateBalanceFromHistory(
      userAccount.id,
    );
    if (currentBalance.lessThan(amountDecimal)) {
      throw new BadRequestException(
        `Insufficient balance. Available: ${currentBalance.toNumber()}, Required: ${amountDecimal.toNumber()}`,
      );
    }

    // Audit balance before transaction
    await this.auditBalance(userAccount.id);

    const result = await this.prisma.retryableTransaction(async (tx) => {
      // Create and complete transaction
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.DEBIT,
          state: TransactionState.HOLD,
          accountAId: userAccount.id,
          accountBId: serviceAccount.id,
          amountOut: amountDecimal,
          amountIn: amountDecimal,
          currency: 'USD',
          meta: JSON.stringify({ productId, description }),
        },
      });

      // Update balances
      await tx.account.update({
        where: { id: userAccount.id },
        data: {
          balance: { decrement: amountDecimal },
          outgoing: { increment: amountDecimal },
        },
      });

      await tx.account.update({
        where: { id: serviceAccount.id },
        data: {
          balance: { increment: amountDecimal },
          incoming: { increment: amountDecimal },
        },
      });

      // Mark as completed
      const completed = await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          state: TransactionState.COMPLETED,
          completedAt: new Date(),
        },
      });

      let orderId: string | undefined;

      // Create Order if productId provided
      if (productId) {
        const product = await tx.product.findUnique({
          where: { id: productId },
        });

        if (!product) {
          throw new BadRequestException(`Product ${productId} not found`);
        }

        const order = await tx.order.create({
          data: {
            productId,
            buyerUserId: userId,
            sellerUserId: 1, // Service user
            totalPrice: amountDecimal,
            currency: 'USD',
            status: 'PAID',
          },
        });

        orderId = order.id;

        this.logger.log(
          `[ORDER] Created orderId=${order.id} productId=${productId} buyer=${userId} amount=${amountDecimal.toNumber()} USD`,
        );
      }

      this.logger.log(
        `[TRANSACTION] DEBIT completed txn=${transaction.id} user=${userId} amount=${amountDecimal.toNumber()} USD`,
      );

      return { transaction: completed, orderId };
    });

    // Audit balance after transaction
    await this.auditBalance(userAccount.id);

    // Emit events
    this.eventEmitter.emit('ACCOUNT_BALANCE_CHANGED', {
      accountId: userAccount.id,
      transactionId: result.transaction.id,
    });

    this.eventEmitter.emit('TRANSACTION_CHANGED', {
      transactionId: result.transaction.id,
      state: TransactionState.COMPLETED,
    });

    if (result.orderId) {
      this.eventEmitter.emit('ORDER_CREATED', { orderId: result.orderId });
    }

    return result;
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

  async findByAccountId(accountId: number): Promise<Transaction[]> {
    return this.prisma.transaction.findMany({
      where: {
        OR: [{ accountAId: accountId }, { accountBId: accountId }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
