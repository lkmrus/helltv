export interface ProviderEvent {
  type: 'payment.success' | 'payment.failed';
  transactionId: string;
  paymentIntentId: string;
  amount?: number;
  metadata?: Record<string, any>;
}
