import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Order, OrderStatus } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

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
}
