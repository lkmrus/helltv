import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { Account } from '@prisma/client';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get('user/:userId')
  async getByUserId(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<Account> {
    return this.accountsService.getByUserId(userId);
  }
}
