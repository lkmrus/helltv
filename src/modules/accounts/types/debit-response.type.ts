import { Transaction } from '@prisma/client';

export interface DebitResponse {
  transaction: Transaction;
  orderId?: string;
}
