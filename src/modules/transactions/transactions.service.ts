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
import { DebitResult } from './types';

interface ExecuteTransactionParams {
  type: TransactionType;
  fromAccountId: number;
  toAccountId: number;
  amount: Decimal;
  meta: any;
  userId: number;
  productId?: number;
}

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
   * Private method to execute balance transaction atomically
   * Reduces code duplication between credit() and debit()
   */
  private async executeBalanceTransaction(
    params: ExecuteTransactionParams,
  ): Promise<{ transaction: Transaction; orderId?: string }> {
    const {
      type,
      fromAccountId,
      toAccountId,
      amount,
      meta,
      userId,
      productId,
    } = params;

    const result = await this.prisma.retryableTransaction(async (tx) => {
      // Create and complete transaction
      const transaction = await tx.transaction.create({
        data: {
          type,
          state: TransactionState.HOLD,
          accountAId: fromAccountId,
          accountBId: toAccountId,
          amountOut: amount,
          amountIn: amount,
          currency: 'USD',
          meta: JSON.stringify(meta),
        },
      });

      // Update balances atomically
      await tx.account.update({
        where: { id: fromAccountId },
        data: {
          balance: { decrement: amount },
          outgoing: { increment: amount },
        },
      });

      await tx.account.update({
        where: { id: toAccountId },
        data: {
          balance: { increment: amount },
          incoming: { increment: amount },
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

      // Create Order if productId provided (for DEBIT only)
      if (productId && type === TransactionType.DEBIT) {
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
            totalPrice: amount,
            currency: 'USD',
            status: 'PAID',
          },
        });

        orderId = order.id;

        this.logger.log(
          `[ORDER] Created orderId=${order.id} productId=${productId} buyer=${userId} amount=${amount.toNumber()} USD`,
        );
      }

      this.logger.log(
        `[TRANSACTION] ${type} completed txn=${transaction.id} user=${userId} amount=${amount.toNumber()} USD`,
      );

      return { transaction: completed, orderId };
    });

    return result;
  }

  /**
   * Create and complete a CREDIT transaction (пополнение баланса)
   * Service account -> User account
   */
  async credit(userId: number, amount: number | Decimal): Promise<Transaction> {
    const amountDecimal = new Decimal(amount.toString());

    if (amountDecimal.lte(0)) {
      throw new BadRequestException('Amount must be positive');
    }

    // Get service and user accounts
    const serviceAccount = await this.accountsService.getByUserId(1);
    const userAccount = await this.accountsService.getByUserId(userId);

    // Execute transaction
    const { transaction } = await this.executeBalanceTransaction({
      type: TransactionType.CREDIT,
      fromAccountId: serviceAccount.id,
      toAccountId: userAccount.id,
      amount: amountDecimal,
      meta: {},
      userId,
    });

    // Emit events
    this.eventEmitter.emit('ACCOUNT_BALANCE_CHANGED', {
      accountId: userAccount.id,
      transactionId: transaction.id,
    });

    this.eventEmitter.emit('TRANSACTION_CHANGED', {
      transactionId: transaction.id,
      state: TransactionState.COMPLETED,
    });

    // Trigger async audit
    this.eventEmitter.emit('TRANSACTION_COMPLETED', {
      accountId: userAccount.id,
      transactionId: transaction.id,
    });

    return transaction;
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
  ): Promise<DebitResult> {
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

    // Execute transaction
    const result = await this.executeBalanceTransaction({
      type: TransactionType.DEBIT,
      fromAccountId: userAccount.id,
      toAccountId: serviceAccount.id,
      amount: amountDecimal,
      meta: { productId },
      userId,
      productId,
    });

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

    // Trigger async audit
    this.eventEmitter.emit('TRANSACTION_COMPLETED', {
      accountId: userAccount.id,
      transactionId: result.transaction.id,
    });

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
