import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Order } from '@prisma/client';
import { ProductsService } from '../products/products.service';
import { TransactionsService } from '../transactions/transactions.service';
import { OrderWithRelations } from './types';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async findById(id: string): Promise<OrderWithRelations> {
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
   * Uses TransactionsService.debit() which creates transaction + order atomically
   */
  async purchaseWithBalance(userId: number, productId: number): Promise<Order> {
    // 1. Get product and validate
    const product = await this.productsService.findById(productId);
    if (!product.active) {
      throw new BadRequestException(
        `Product ${productId} is not available for purchase`,
      );
    }

    this.logger.log(
      `[ORDER] Begin purchase from balance: userId=${userId} productId=${productId} price=$${product.price.toNumber()}`,
    );

    // 2. Create DEBIT transaction with order
    const result = await this.transactionsService.debit(
      userId,
      product.price,
      productId,
    );

    if (!result.orderId) {
      throw new BadRequestException('Failed to create order');
    }

    // 3. Get created order
    const order = await this.findById(result.orderId);

    this.logger.log(
      `[ORDER] Purchase from balance successful: orderId=${order.id}`,
    );

    return order;
  }
}
