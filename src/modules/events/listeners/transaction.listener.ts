import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TransactionState } from '@prisma/client';

@Injectable()
export class TransactionListener {
  private readonly logger = new Logger(TransactionListener.name);

  @OnEvent('TRANSACTION_CHANGED')
  handleTransactionChanged(payload: {
    transactionId: string;
    state: TransactionState;
  }) {
    this.logger.log(
      `[EVENT] TRANSACTION_CHANGED txnId=${payload.transactionId} state=${payload.state}`,
    );
  }
}
