import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Product } from '@prisma/client';

const PRODUCT_CACHE_TTL = 900; // 15 minutes

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findById(id: number): Promise<Product> {
    const cacheKey = `product:id:${id}`;
    const cached = await this.redis.get<Product>(cacheKey);

    if (cached) {
      return cached;
    }

    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }

    if (!product.active) {
      throw new NotFoundException(`Product with id ${id} is not active`);
    }

    await this.redis.set(cacheKey, product, PRODUCT_CACHE_TTL);
    return product;
  }

  async findAll(): Promise<Product[]> {
    const cacheKey = 'products:all';
    const cached = await this.redis.get<Product[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const products = await this.prisma.product.findMany({
      where: { active: true },
    });

    await this.redis.set(cacheKey, products, PRODUCT_CACHE_TTL);
    return products;
  }

  async invalidateCache(productId?: number): Promise<void> {
    if (productId) {
      await this.redis.del(`product:id:${productId}`);
    }
    await this.redis.del('products:all');
  }
}
