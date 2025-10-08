import { Module } from '@nestjs/common';
import { StubProviderService } from './stub-provider.service';

@Module({
  providers: [StubProviderService],
  exports: [StubProviderService],
})
export class ProviderModule {}
