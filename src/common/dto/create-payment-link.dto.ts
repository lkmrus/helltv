import { IsNumber, IsOptional, Min } from 'class-validator';

export class CreatePaymentLinkDto {
  @IsNumber()
  @Min(1)
  userId: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  productId?: number;
}
