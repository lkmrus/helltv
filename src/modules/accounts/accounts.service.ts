import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Account, Transaction } from '@prisma/client';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getById(id: number): Promise<Account> {
    const account = await this.prisma.account.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundException(`Account with id ${id} not found`);
    }

    return account;
  }

  async getByUserId(userId: number): Promise<Account> {
    const account = await this.prisma.account.findUnique({
      where: { userId },
    });

    if (!account) {
      throw new NotFoundException(`Account for user ${userId} not found`);
    }

    return account;
  }

  /**
   * Apply completed transaction to account balances
   * Should be called within a Prisma transaction
   */
  async applyComplete(
    transaction: Transaction,
    prismaClient: any = this.prisma,
  ): Promise<void> {
    const { accountAId, accountBId, amountOut, amountIn } = transaction;

    // Update accountA (source): decrease balance, increase outgoing
    await prismaClient.account.update({
      where: { id: accountAId },
      data: {
        balance: { decrement: amountOut },
        outgoing: { increment: amountOut },
      },
    });

    // Update accountB (destination): increase balance, increase incoming
    await prismaClient.account.update({
      where: { id: accountBId },
      data: {
        balance: { increment: amountIn },
        incoming: { increment: amountIn },
      },
    });

    this.logger.log(
      `[ACCOUNT] Applied transaction: A(${accountAId}) -${amountOut.toNumber()} -> B(${accountBId}) +${amountIn.toNumber()}`,
    );
  }

  /**
   * Reverse a failed transaction
   * Should be called within a Prisma transaction
   */
  async applyReverse(
    transaction: Transaction,
    prismaClient: any = this.prisma,
  ): Promise<void> {
    const { accountAId, accountBId, amountOut, amountIn } = transaction;

    // Only reverse if amounts were already applied (check state before calling)
    await prismaClient.account.update({
      where: { id: accountAId },
      data: {
        balance: { increment: amountOut },
        outgoing: { decrement: amountOut },
      },
    });

    await prismaClient.account.update({
      where: { id: accountBId },
      data: {
        balance: { decrement: amountIn },
        incoming: { decrement: amountIn },
      },
    });

    this.logger.log(
      `[ACCOUNT] Reversed transaction: A(${accountAId}) +${amountOut.toNumber()}, B(${accountBId}) -${amountIn.toNumber()}`,
    );
  }
}
