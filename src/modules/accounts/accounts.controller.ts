import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { TransactionsService } from '../transactions/transactions.service';
import { Account, Transaction } from '@prisma/client';
import { CreditDto } from './dto/credit.dto';
import { DebitDto } from './dto/debit.dto';
import { AccountAuditResponse, DebitResponse } from './types';

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Get('user/:userId')
  async getByUserId(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<Account> {
    return this.accountsService.getByUserId(userId);
  }

  @Get('user/:userId/history')
  async getHistory(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<Transaction[]> {
    const account = await this.accountsService.getByUserId(userId);
    return this.transactionsService.findByAccountId(account.id);
  }

  @Get('user/:userId/audit')
  async audit(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<AccountAuditResponse> {
    const account = await this.accountsService.getByUserId(userId);
    const calculatedBalance =
      await this.transactionsService.calculateBalanceFromHistory(account.id);

    const currentBalance = account.balance;
    const diff = currentBalance.minus(calculatedBalance).abs();
    const isValid = diff.lessThanOrEqualTo(0.01);

    return {
      accountId: account.id,
      currentBalance: currentBalance.toString(),
      calculatedBalance: calculatedBalance.toString(),
      difference: diff.toString(),
      isValid,
    };
  }

  @Post('user/:userId/credit')
  async credit(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: CreditDto,
  ): Promise<Transaction> {
    return this.transactionsService.credit(userId, dto.amount);
  }

  @Post('user/:userId/debit')
  async debit(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: DebitDto,
  ): Promise<DebitResponse> {
    return this.transactionsService.debit(userId, dto.amount, dto.productId);
  }
}
