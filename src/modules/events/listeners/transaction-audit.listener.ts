import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TransactionsService } from '../../transactions/transactions.service';

@Injectable()
export class TransactionAuditListener {
  private readonly logger = new Logger(TransactionAuditListener.name);

  constructor(private readonly transactionsService: TransactionsService) {}

  @OnEvent('TRANSACTION_COMPLETED', { async: true })
  async handleTransactionCompleted(payload: {
    accountId: number;
    transactionId: string;
  }) {
    try {
      await this.transactionsService.auditBalance(payload.accountId);
      this.logger.log(
        `[AUDIT] Async audit passed for account ${payload.accountId} after transaction ${payload.transactionId}`,
      );
    } catch (error) {
      // Логируем ошибку, но НЕ блокируем пользователя
      this.logger.error(
        `[AUDIT] Async audit FAILED for account ${payload.accountId} after transaction ${payload.transactionId}: ${error.message}`,
      );

      // TODO: Отправить alert в мониторинг (Sentry, Slack, etc.)
      // await this.alertService.send(`Balance mismatch detected for account ${payload.accountId}`);
    }
  }
}

