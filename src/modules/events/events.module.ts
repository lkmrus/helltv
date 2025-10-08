import { Module } from '@nestjs/common';
import { AccountListener } from './listeners/account.listener';
import { TransactionListener } from './listeners/transaction.listener';
import { OrderListener } from './listeners/order.listener';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [AccountsModule],
  providers: [AccountListener, TransactionListener, OrderListener],
})
export class EventsModule {}
