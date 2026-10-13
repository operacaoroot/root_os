import { Module } from '@nestjs/common';

import { PORTA_DE_ASSINATURA } from '../portas/assinatura.port';
import { ZapsignService } from './zapsign.service';

/*
 * A fiação do conector da ZapSign (lane D). É o único lugar fora do conector
 * que o cita, como manda a catraca de arquitetura: o comercial recebe a
 * `PORTA_DE_ASSINATURA`, nunca o serviço.
 */
@Module({
  providers: [ZapsignService, { provide: PORTA_DE_ASSINATURA, useExisting: ZapsignService }],
  exports: [PORTA_DE_ASSINATURA],
})
export class ZapsignModule {}
