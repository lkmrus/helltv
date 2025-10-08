import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { Product } from '@prisma/client';

const PRODUCT_CACHE_TTL = 900 * 1000; // 15 minutes in milliseconds

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async findById(id: number): Promise<Product> {
    const cacheKey = `product:id:${id}`;
    const cached = await this.cacheManager.get<Product>(cacheKey);

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

    await this.cacheManager.set(cacheKey, product, PRODUCT_CACHE_TTL);
    return product;
  }

  async findAll(): Promise<Product[]> {
    const cacheKey = 'products:all';
    const cached = await this.cacheManager.get<Product[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const products = await this.prisma.product.findMany({
      where: { active: true },
    });

    await this.cacheManager.set(cacheKey, products, PRODUCT_CACHE_TTL);
    return products;
  }

  async invalidateCache(productId?: number): Promise<void> {
    if (productId) {
      await this.cacheManager.del(`product:id:${productId}`);
    }
    await this.cacheManager.del('products:all');
  }
}
