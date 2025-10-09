import { IsNumber, IsPositive } from 'class-validator';

export class CreditDto {
  @IsNumber()
  @IsPositive()
  amount: number;
}
