import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { ModulosController } from './modulos.controller';
import { ModulosInterceptor } from './modulos.interceptor';
import { ModulosService } from './modulos.service';
import { ProvisionamentoController } from './provisionar.controller';
import { ProvisionamentoService } from './provisionar.service';

/*
 * O TENANT E O QUE ELE CONTRATOU — RF-T-06.
 *
 * Instala o gate de módulos para a aplicação inteira. `APP_INTERCEPTOR`
 * declarado em módulo importado vale para todas as rotas, e é isso que se quer:
 * gate que precisa ser lembrado controller a controller é gate que um dia
 * alguém esquece no controller novo.
 *
 * ORDEM IMPORTA: este módulo é importado no `AppModule` DEPOIS do
 * `ContextoModule`. Interceptor global registrado antes envolve o registrado
 * depois, então quando este roda o contexto de execução já está aberto e o
 * tenant já está resolvido. Trocar a ordem não quebra (há a rede do
 * `req.user.orgId`), mas tira o caminho principal.
 *
 * `AuthModule` entra por causa do `JwtAuthGuard` do controller — a rota "quais
 * módulos eu tenho" é autenticada como qualquer outra.
 *
 * O PROVISIONAMENTO (RF-T-07) mora aqui porque é a mesma pergunta vista do
 * outro lado: `ModulosService` responde "o que esta empresa contratou" e
 * `ProvisionamentoService` é quem faz a empresa existir com essa resposta
 * preenchida. O `EventLogService` que ele usa vem do `GatewayModule` e o
 * `AuditService` vem do `AuditModule`; os dois são `@Global` — nada a importar,
 * e a ordem deles no `AppModule` não muda nada (módulo global entra no registro
 * na varredura, antes de qualquer resolução de dependência).
 */
@Module({
  imports: [AuthModule],
  controllers: [ModulosController, ProvisionamentoController],
  providers: [
    ModulosService,
    ProvisionamentoService,
    { provide: APP_INTERCEPTOR, useClass: ModulosInterceptor },
  ],
  exports: [ModulosService, ProvisionamentoService],
})
export class TenantsModule {}
