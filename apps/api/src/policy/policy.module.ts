import { Global, Module } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { SinaisService } from './sinais.service';

// @Global porque a porta é consumida de qualquer lugar — e a porta é a única.
@Global()
@Module({
  providers: [PolicyService, SinaisService],
  exports: [PolicyService, SinaisService],
})
export class PolicyModule {}
