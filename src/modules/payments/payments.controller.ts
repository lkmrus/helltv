import { Controller, Post, Body, HttpCode, Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentLinkDto } from '../../common/dto/create-payment-link.dto';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * POST /payments/url
   * Create payment link for refill or purchase
   */
  @Post('url')
  async createPaymentLink(
    @Body() dto: CreatePaymentLinkDto,
  ): Promise<{ url: string; transactionId: string; paymentIntentId: string }> {
    return this.paymentsService.createPaymentLink(dto.userId, dto.productId);
  }

  /**
   * POST /payments/provider/webhook
   * Handle provider webhook (stub)
   * For real providers (Stripe), need to validate signature
   */
  @Post('provider/webhook')
  @HttpCode(200)
  async handleWebhook(
    @Body() body: Record<string, any>,
  ): Promise<{ received: boolean }> {
    await this.paymentsService.handleProviderWebhook(body);
    return { received: true };
  }
}
