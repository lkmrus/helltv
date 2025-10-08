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

    if (productId) {
      // Purchase flow
      product = await this.productsService.findById(productId);
      amount = product.price.toNumber();
      meta.productId = productId;
      meta.purpose = 'purchase';
      this.logger.log(
        `[PAYMENT] Begin purchase flow userId=${userId} productId=${productId} amount=$${amount}`,
      );
    } else {
      // Simple refill flow (for testing)
      amount = 100; // Default refill amount for MVP
      meta.purpose = 'refill';
      this.logger.log(
        `[PAYMENT] Begin refill flow userId=${userId} amount=$${amount}`,
      );
    }

    // 4. Create HOLD transaction (ACCOUNT_REFILL: service -> user)
    // This represents external funds coming into user's account
    const transaction = await this.transactionsService.initiateTransfer(
      serviceAccount.id, // From service (virtual external source)
      userAccount.id, // To user
      amount,
      TransactionType.ACCOUNT_REFILL,
      meta,
    );

    // 5. Create provider session (stub)
    const session = this.stubProvider.createSession(transaction, user, product);

    // 6. Update transaction with provider identifiers
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
