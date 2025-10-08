import { Controller, Get, Param } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Order } from '@prisma/client';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Order> {
    return this.ordersService.findById(id);
  }
}
