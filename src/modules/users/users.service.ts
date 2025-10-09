import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

const USER_CACHE_TTL = 300 * 1000; // 5 minutes in milliseconds

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async findById(id: number): Promise<User> {
    const cacheKey = `user:id:${id}`;
    const cached = await this.cacheManager.get<User>(cacheKey);

    if (cached) {
      return cached;
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    await this.cacheManager.set(cacheKey, user, USER_CACHE_TTL);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    const cacheKey = `user:email:${email}`;
    const cached = await this.cacheManager.get<User>(cacheKey);

    if (cached) {
      return cached;
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      await this.cacheManager.set(cacheKey, user, USER_CACHE_TTL);
    }

    return user;
  }

  async getServiceUser(): Promise<User> {
    return this.findById(1); // Service user always has id=1
  }

  async invalidateCache(userId: number): Promise<void> {
    await this.cacheManager.del(`user:id:${userId}`);
  }
}
