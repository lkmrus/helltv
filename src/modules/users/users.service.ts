import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { User } from '@prisma/client';

const USER_CACHE_TTL = 300; // 5 minutes

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findById(id: number): Promise<User> {
    const cacheKey = `user:id:${id}`;
    const cached = await this.redis.get<User>(cacheKey);

    if (cached) {
      return cached;
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    await this.redis.set(cacheKey, user, USER_CACHE_TTL);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    const cacheKey = `user:email:${email}`;
    const cached = await this.redis.get<User>(cacheKey);

    if (cached) {
      return cached;
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      await this.redis.set(cacheKey, user, USER_CACHE_TTL);
    }

    return user;
  }

  async getServiceUser(): Promise<User> {
    return this.findById(1); // Service user always has id=1
  }

  async invalidateCache(userId: number): Promise<void> {
    await this.redis.delPattern(`user:*:${userId}`);
  }
}
