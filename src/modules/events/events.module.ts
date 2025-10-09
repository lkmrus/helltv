import { Module } from '@nestjs/common';
import { AccountListener } from './listeners/account.listener';
import { TransactionListener } from './listeners/transaction.listener';
import { OrderListener } from './listeners/order.listener';
import { TransactionAuditListener } from './listeners/transaction-audit.listener';
import { AccountsModule } from '../accounts/accounts.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [AccountsModule, TransactionsModule],
  providers: [
    AccountListener,
    TransactionListener,
    OrderListener,
    TransactionAuditListener,
  ],
})
export class EventsModule {}
