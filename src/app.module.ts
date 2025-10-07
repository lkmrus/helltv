import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './modules/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import config from './config/config';

@Module({
  imports: [
    PrismaModule,
    EventEmitterModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, load: [config] }),
  ],
})
export class AppModule {}
