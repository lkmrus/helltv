import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Product } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: number): Promise<Product> {
    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }

    if (!product.active) {
      throw new NotFoundException(`Product with id ${id} is not active`);
    }

    return product;
  }

  async findAll(): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: { active: true },
    });
  }
}
