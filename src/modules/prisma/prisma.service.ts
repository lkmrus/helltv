import {
  INestApplication,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function isRetryableError(error: any): boolean {
  if (!error) return false;

  const message = error.message?.toLowerCase() || '';
  const code = error.code || '';

  // PostgreSQL error codes for retryable errors
  const retryableCodes = [
    '40001', // serialization_failure
    '40P01', // deadlock_detected
    '08000', // connection_exception
    '08003', // connection_does_not_exist
    '08006', // connection_failure
    '57P03', // cannot_connect_now
    '53300', // too_many_connections
  ];

  if (retryableCodes.includes(code)) {
    return true;
  }

  // Prisma-specific errors
  if (
    message.includes('deadlock') ||
    message.includes('serialization') ||
    message.includes('connection') ||
    message.includes('timeout')
  ) {
    return true;
  }

  return false;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    (this as any).$on('beforeExit', async () => {
      await app.close();
    });
  }

  /**
   * Wraps the provided function in a transaction and retries it if it fails due to a retryable error.
   *
   * @param fn The function to be executed in a transaction
   * @param options Prisma transaction options and transaction retry options
   * @returns
   */
  async retryableTransaction<T>(
    fn: (tx: TxClient) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
      // transaction retry options
      retryCount?: number;
      retryWait?: number;
    },
  ): Promise<T> {
    const retryCount = options?.retryCount ?? 3;
    const retryWait = options?.retryWait ?? 500;

    let attempts = 0;

    while (true) {
      try {
        const result = await this.$transaction<T>(fn, {
          maxWait: options?.maxWait,
          timeout: options?.timeout,
          isolationLevel: options?.isolationLevel,
        });

        return result;
      } catch (err) {
        attempts++;

        if (isRetryableError(err) && attempts < retryCount) {
          await new Promise((resolve) => setTimeout(resolve, retryWait));
        } else {
          if (attempts === retryCount) {
            err.message = `Max retry attempts reached: ${err.message}`;
          }

          throw err;
        }
      }
    }
  }
}
