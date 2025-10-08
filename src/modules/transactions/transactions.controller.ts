import { Controller, Get, Param } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { Transaction } from '@prisma/client';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Transaction> {
    return this.transactionsService.findById(id);
  }
}
