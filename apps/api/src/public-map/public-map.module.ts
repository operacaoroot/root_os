import { Module } from '@nestjs/common';

import { MapaPublicoController } from './mapa-publico.controller';
import { MapaPublicoService } from './mapa-publico.service';

/**
 * O MAPA PÚBLICO — fatia 6.5 (degrau 0 da esteira).
 *
 * A entrada pública do domínio: o mapa ao vivo da ROOT, montado só a partir das
 * linhas de `MapaPublicoItem` que alguém marcou como publicadas.
 *
 * NÃO IMPORTA NADA. `PrismaModule` é `@Global()` e já está de pé quando este
 * módulo carrega; não há conector, não há modelo, não há porta — esta fatia só
 * LÊ, e lê uma tabela que existe para ser lida por qualquer pessoa da internet.
 *
 * REGISTRADO EM `app.module.ts`. Sem essa linha o controller não existe,
 * `GET /api/mapa-publico` responde 404 e a página da raiz mostra o texto de
 * venda sem mapa nenhum (ela degrada de propósito, mas degrada).
 *
 * ORDEM: depois de `TenantsModule` (o gate de módulos) como todo módulo de rota,
 * e a posição entre os módulos de domínio é indiferente — ele não injeta nenhum
 * deles.
 */
@Module({
  controllers: [MapaPublicoController],
  providers: [MapaPublicoService],
  exports: [MapaPublicoService],
})
export class PublicMapModule {}
