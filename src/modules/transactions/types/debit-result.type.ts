import { Transaction } from '@prisma/client';

export interface DebitResult {
  transaction: Transaction;
  orderId?: string;
}
