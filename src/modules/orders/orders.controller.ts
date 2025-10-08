import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Order } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('create')
  async create(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.ordersService.purchaseWithBalance(dto.userId, dto.productId);
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Order> {
    return this.ordersService.findById(id);
  }
}
