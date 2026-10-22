import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AgendaDaImplantacaoService } from './agenda-da-implantacao.service';
import { ImplantacaoController } from './implantacao.controller';
import { ImplantacaoDoQuadroService } from './implantacao-do-quadro.service';
import { LimiteDaEtapaService } from './limite-da-etapa.service';

/**
 * O CARTÃO DA IMPLANTAÇÃO (rodada de produção 2, M1, 22/10/2026): a próxima
 * reunião (S1), a fase do trilho (S2), o resumo do Dia a dia (S5) e o limite da
 * etapa pelo menu da coluna (S4). A porta vem do `GatewayModule` (global).
 *
 * SEM A LINHA NO `AppModule`, `GET /api/trabalho/implantacao/*` e
 * `PATCH /api/trabalho/statuses/:id/limite` respondem 404 e nada acusa.
 */
@Module({
  imports: [AuditModule],
  controllers: [ImplantacaoController],
  providers: [AgendaDaImplantacaoService, ImplantacaoDoQuadroService, LimiteDaEtapaService],
})
export class ImplantacaoModule {}
