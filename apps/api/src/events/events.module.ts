import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { PixelTenantService } from './pixel-tenant.service';

/*
 * `PixelTenantService` fica como provider deste módulo e NÃO é exportado: ele
 * guarda memória curta e o inventário de recusas, e duas instâncias seriam duas
 * contagens e dois caches. Nada fora daqui precisa resolver empresa por chave de
 * pixel — quem resolve tenant de superfície pública da bio usa as funções de
 * `common/tenant-publico.ts`, que não têm estado.
 */
@Module({
  controllers: [EventsController],
  providers: [EventsService, PixelTenantService],
  exports: [EventsService],
})
export class EventsModule {}
