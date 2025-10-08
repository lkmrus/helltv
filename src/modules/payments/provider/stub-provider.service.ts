import { Injectable, Logger } from '@nestjs/common';
import { Transaction, User, Product } from '@prisma/client';
import { ProviderEvent } from '../../../common/types';
import { randomUUID } from 'crypto';

@Injectable()
export class StubProviderService {
  private readonly logger = new Logger(StubProviderService.name);

  /**
   * Create a stub payment session
   * Returns fake sessionId and URL for testing
   */
  createSession(
    transaction: Transaction,
    user: User,
    product?: Product,
  ): { sessionId: string; url: string; paymentIntentId: string } {
    const sessionId = `stub_session_${randomUUID()}`;
    const paymentIntentId = `stub_pi_${randomUUID()}`;
    const url = `http://stub.local/pay/${sessionId}`;

    const type = product ? 'purchase' : 'refill';
    const amount = transaction.amountIn.toString();

    this.logger.log(
      `[PAYMENT] Stub session created: sessionId=${sessionId} type=${type} amount=$${amount} USD`,
    );

    return {
      sessionId,
      url,
      paymentIntentId,
    };
  }

  /**
   * Parse stub provider webhook event
   * For testing: expects JSON payload with { type, transactionId, paymentIntentId }
   */
  parseEvent(rawBody: string | Record<string, any>): ProviderEvent {
    let body: Record<string, any>;

    if (typeof rawBody === 'string') {
      try {
        body = JSON.parse(rawBody) as Record<string, any>;
      } catch (e) {
        throw new Error('Invalid JSON in webhook payload');
      }
    } else {
      body = rawBody;
    }

    const { type, transactionId, paymentIntentId, amount, metadata } = body;

    if (!type || !transactionId || !paymentIntentId) {
      throw new Error('Missing required fields in webhook payload');
    }

    return {
      type: type as 'payment.success' | 'payment.failed',
      transactionId: transactionId as string,
      paymentIntentId: paymentIntentId as string,
      amount: amount as number | undefined,
      metadata: metadata as Record<string, any> | undefined,
    };
  }
}
