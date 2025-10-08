import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AccountsService } from '../accounts/accounts.service';
import { ProductsService } from '../products/products.service';
import { TransactionsService } from '../transactions/transactions.service';
import { StubProviderService } from './provider/stub-provider.service';
import { TransactionType, Product } from '@prisma/client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly accountsService: AccountsService,
    private readonly productsService: ProductsService,
    private readonly transactionsService: TransactionsService,
    private readonly stubProvider: StubProviderService,
  ) {}

  /**
   * Create payment link for refill or purchase
   * Returns URL for user to "pay" (stub) and transactionId for webhook
   */
  async createPaymentLink(
    userId: number,
    productId?: number,
  ): Promise<{ url: string; transactionId: string; paymentIntentId: string }> {
    // 1. Get user and their account
    const user = await this.usersService.findById(userId);
    const userAccount = await this.accountsService.getByUserId(userId);

    // 2. Get service user account (always id=1)
    const serviceUser = await this.usersService.getServiceUser();
    const serviceAccount = await this.accountsService.getByUserId(
      serviceUser.id,
    );

    // 3. Determine type and amount
    let amount: number;
    let product: Product | undefined = undefined;
    const meta: Record<string, any> = { provider: 'stub' };
    let transaction;

    if (productId) {
      // Purchase flow with partial payment support
      product = await this.productsService.findById(productId);
      const productPrice = product.price.toNumber();
      const userBalance = userAccount.balance.toNumber();

      meta.productId = productId;
      meta.purpose = 'purchase';

      // Check if user has sufficient balance
      if (userBalance >= productPrice) {
        throw new BadRequestException(
          `You have sufficient balance ($${userBalance}). Use POST /orders/create to purchase directly from balance.`,
        );
      }

      // Check if partial payment is needed
      if (userBalance > 0) {
        // PARTIAL PAYMENT: user has some balance but not enough
        this.logger.log(
          `[PAYMENT] Begin partial payment: userId=${userId} productId=${productId} balance=$${userBalance} price=$${productPrice}`,
        );

        const balancePart = userBalance;
        const cardPart = productPrice - userBalance;

        meta.partial = true;
        meta.balancePart = balancePart;
        meta.cardPart = cardPart;

        // Create first PRODUCT_PURCHASE transaction (from balance)
        const balanceTransaction =
          await this.transactionsService.initiateTransfer(
            userAccount.id,
            serviceAccount.id,
            balancePart,
            TransactionType.PRODUCT_PURCHASE,
            {
              productId,
              partial: true,
              partialType: 'balance',
              source: 'balance',
            },
          );

        // Complete balance transaction immediately
        await this.transactionsService.completeImmediately(
          balanceTransaction.id,
        );

        this.logger.log(
          `[PAYMENT] Partial payment - balance part completed: txn=${balanceTransaction.id} amount=$${balancePart}`,
        );

        // Store link to balance transaction
        meta.linkedTransactionId = balanceTransaction.id;

        // Create ACCOUNT_REFILL for card part
        transaction = await this.transactionsService.initiateTransfer(
          serviceAccount.id,
          userAccount.id,
          cardPart,
          TransactionType.ACCOUNT_REFILL,
          meta,
        );

        amount = cardPart;

        this.logger.log(
          `[PAYMENT] Partial payment - card part pending: txn=${transaction!.id} amount=$${cardPart}`,
        );
      } else {
        // FULL CARD PAYMENT: user has zero balance
        amount = productPrice;
        transaction = await this.transactionsService.initiateTransfer(
          serviceAccount.id,
          userAccount.id,
          amount,
          TransactionType.ACCOUNT_REFILL,
          meta,
        );

        this.logger.log(
          `[PAYMENT] Begin full card payment: userId=${userId} productId=${productId} amount=$${amount}`,
        );
      }
    } else {
      // Simple refill flow (for testing)
      amount = 100; // Default refill amount for MVP
      meta.purpose = 'refill';

      transaction = await this.transactionsService.initiateTransfer(
        serviceAccount.id,
        userAccount.id,
        amount,
        TransactionType.ACCOUNT_REFILL,
        meta,
      );

      this.logger.log(
        `[PAYMENT] Begin refill flow userId=${userId} amount=$${amount}`,
      );
    }

    // 5. Ensure transaction is defined
    if (!transaction) {
      throw new BadRequestException('Failed to create transaction');
    }

    // 6. Create provider session (stub)
    const session = this.stubProvider.createSession(transaction, user, product);

    // 7. Update transaction with provider identifiers
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        providerSessionId: session.sessionId,
        paymentIntentId: session.paymentIntentId,
      },
    });

    this.logger.log(
      `[PAYMENT] Payment link created: txn=${transaction.id} sessionId=${session.sessionId} url=${session.url}`,
    );

    return {
      url: session.url,
      transactionId: transaction.id,
      paymentIntentId: session.paymentIntentId,
    };
  }

  /**
   * Handle provider webhook (stub or real provider)
   * Processes payment success/failure
   */
  async handleProviderWebhook(
    rawBody: string | Record<string, any>,
  ): Promise<void> {
    // 1. Parse event from provider
    const event = this.stubProvider.parseEvent(rawBody);

    this.logger.log(
      `[WEBHOOK] Received ${event.type} paymentIntentId=${event.paymentIntentId} txn=${event.transactionId}`,
    );

    // 2. Find transaction by paymentIntentId (idempotency key)
    let transaction = await this.transactionsService.findByPaymentIntentId(
      event.paymentIntentId,
    );

    if (!transaction) {
      // Fallback: try by transactionId
      transaction = await this.transactionsService.findById(
        event.transactionId,
      );
    }

    if (!transaction) {
      throw new BadRequestException(
        `Transaction not found for payment ${event.paymentIntentId}`,
      );
    }

    // 3. Check if already processed (idempotency)
    if (transaction.state === 'COMPLETED' || transaction.state === 'FAILED') {
      this.logger.log(
        `[WEBHOOK] Transaction already processed: state=${transaction.state} (idempotent)`,
      );
      return;
    }

    // 4. Process based on event type
    if (event.type === 'payment.success') {
      await this.transactionsService.completePayTransaction(transaction.id);
      this.logger.log(
        `[WEBHOOK] Payment success processed txn=${transaction.id}`,
      );
    } else if (event.type === 'payment.failed') {
      await this.transactionsService.failTransaction(transaction.id);
      this.logger.log(
        `[WEBHOOK] Payment failure processed txn=${transaction.id}`,
      );
    } else {
      this.logger.warn(`[WEBHOOK] Unknown event type: ${event.type}`);
    }
  }
}
