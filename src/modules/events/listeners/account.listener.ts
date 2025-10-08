import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AccountsService } from '../../accounts/accounts.service';

@Injectable()
export class AccountListener {
  private readonly logger = new Logger(AccountListener.name);

  constructor(private readonly accountsService: AccountsService) {}

  @OnEvent('ACCOUNT_BALANCE_CHANGED')
  async handleBalanceChanged(payload: {
    accountId: number;
    transactionId: string;
  }) {
    try {
      const account = await this.accountsService.getById(payload.accountId);
      this.logger.log(
        `[EVENT] ACCOUNT_BALANCE_CHANGED accountId=${payload.accountId} balance=$${account.balance.toNumber()} incoming=$${account.incoming.toNumber()} outgoing=$${account.outgoing.toNumber()}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[EVENT] Failed to handle ACCOUNT_BALANCE_CHANGED: ${error.message}`,
      );
    }
  }
}
