import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class OrderListener {
  private readonly logger = new Logger(OrderListener.name);

  @OnEvent('ORDER_CREATED')
  handleOrderCreated(payload: { orderId: string }) {
    this.logger.log(`[EVENT] ORDER_CREATED orderId=${payload.orderId}`);
  }
}
