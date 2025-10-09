import { IsNumber, IsPositive, IsOptional } from 'class-validator';

export class DebitDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  productId?: number;
}
