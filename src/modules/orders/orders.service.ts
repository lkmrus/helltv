import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Order,
  OrderStatus,
  TransactionType,
  TransactionState,
} from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { ProductsService } from '../products/products.service';
import { TransactionsService } from '../transactions/transactions.service';
import { UsersService } from '../users/users.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsService: AccountsService,
    private readonly productsService: ProductsService,
    private readonly transactionsService: TransactionsService,
    private readonly usersService: UsersService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a paid order
   * Used by TransactionsService after successful payment
   */
  async createPaidOrder(
    buyerUserId: number,
    productId: number,
    sellerUserId: number = 1, // Default to service user
  ): Promise<Order> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }

    return this.prisma.order.create({
      data: {
        productId,
        buyerUserId,
        sellerUserId,
        totalPrice: product.price,
        currency: 'USD',
        status: OrderStatus.PAID,
      },
    });
  }

  async findById(id: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        product: true,
        buyer: true,
        seller: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    return order;
  }

  /**
   * Purchase product directly from user balance
   * Creates PRODUCT_PURCHASE transaction and Order atomically
   */
  async purchaseWithBalance(userId: number, productId: number): Promise<Order> {
    // 1. Get product and validate
    const product = await this.productsService.findById(productId);
    if (!product.active) {
      throw new BadRequestException(
        `Product ${productId} is not available for purchase`,
      );
    }

    // 2. Get user account and check balance
    const userAccount = await this.accountsService.getByUserId(userId);
    const productPrice = product.price.toNumber();

    if (userAccount.balance.toNumber() < productPrice) {
      throw new BadRequestException(
        `Insufficient balance: have $${userAccount.balance.toNumber()}, need $${productPrice}. Use POST /payments/url to pay with card.`,
      );
    }

    // 3. Get service account
    const serviceUser = await this.usersService.getServiceUser();
    const serviceAccount = await this.accountsService.getByUserId(
      serviceUser.id,
    );

    this.logger.log(
      `[ORDER] Begin purchase from balance: userId=${userId} productId=${productId} price=$${productPrice}`,
    );

    // 4. Create PRODUCT_PURCHASE transaction
    const purchaseTransaction = await this.transactionsService.initiateTransfer(
      userAccount.id,
      serviceAccount.id,
      productPrice,
      TransactionType.PRODUCT_PURCHASE,
      { productId, source: 'balance' },
    );

    // 5. Complete transaction and create order atomically
    const order: Order = await this.prisma.$transaction(async (tx) => {
      // Apply balance changes
      const transaction = await tx.transaction.findUnique({
        where: { id: purchaseTransaction.id },
      });

      if (!transaction) {
        throw new BadRequestException(
          `Transaction ${purchaseTransaction.id} not found`,
        );
      }

      // Update account balances
      await tx.account.update({
        where: { id: userAccount.id },
        data: {
          balance: { decrement: product.price },
          outgoing: { increment: product.price },
        },
      });

      await tx.account.update({
        where: { id: serviceAccount.id },
        data: {
          balance: { increment: product.price },
          incoming: { increment: product.price },
        },
      });

      // Complete transaction
      await tx.transaction.update({
        where: { id: purchaseTransaction.id },
        data: {
          state: TransactionState.COMPLETED,
          completedAt: new Date(),
        },
      });

      // Create order
      const createdOrder = await tx.order.create({
        data: {
          productId,
          buyerUserId: userId,
          sellerUserId: serviceUser.id,
          totalPrice: product.price,
          currency: 'USD',
          status: OrderStatus.PAID,
        },
      });

      this.logger.log(
        `[ORDER] Created from balance: orderId=${createdOrder.id} txn=${purchaseTransaction.id} price=$${productPrice}`,
      );

      return createdOrder;
    });

    this.logger.log(
      `[ORDER] Purchase from balance successful: orderId=${order.id}`,
    );

    // 6. Emit events after commit
    this.eventEmitter.emit('ACCOUNT_BALANCE_CHANGED', {
      accountId: userAccount.id,
      transactionId: purchaseTransaction.id,
    });

    this.eventEmitter.emit('ACCOUNT_BALANCE_CHANGED', {
      accountId: serviceAccount.id,
      transactionId: purchaseTransaction.id,
    });

    this.eventEmitter.emit('TRANSACTION_CHANGED', {
      transactionId: purchaseTransaction.id,
      state: TransactionState.COMPLETED,
    });

    this.eventEmitter.emit('ORDER_CREATED', { orderId: order.id });

    // Return formatted order
    return {
      id: order.id,
      productId: order.productId,
      buyerUserId: order.buyerUserId,
      sellerUserId: order.sellerUserId,
      totalPrice: order.totalPrice.toString(),
      currency: order.currency,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    } as any;
  }
}
