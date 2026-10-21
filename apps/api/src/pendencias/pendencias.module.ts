import { Global, Module } from '@nestjs/common';

import { PendenciasController } from './pendencias.controller';
import { PendenciasRegistry } from './pendencias.registry';
import { PendenciasService } from './pendencias.service';

/**
 * AS PENDÊNCIAS (rodada dos agentes, 21/10/2026, Lane 0).
 *
 * `@Global` de propósito: quem ABRE pendência é muita gente (o arquivista, o
 * cobrador de tarefas, a triagem do WhatsApp, o vigia da agenda), e importar
 * este módulo em cada um fecharia ciclo no dia em que um deles fosse importado
 * por outro. O módulo não importa nada além do Prisma (global), então não há
 * ciclo do lado de cá. Exporta o serviço (para abrir) e o registro (para
 * inscrever o tratador do tipo).
 *
 * SEM A LINHA NO `AppModule`, `GET /api/pendencias` responde 404 e nada acusa.
 */
@Global()
@Module({
  controllers: [PendenciasController],
  providers: [PendenciasService, PendenciasRegistry],
  exports: [PendenciasService, PendenciasRegistry],
})
export class PendenciasModule {}
