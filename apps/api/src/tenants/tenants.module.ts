import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { ModulosController } from './modulos.controller';
import { ModulosInterceptor } from './modulos.interceptor';
import { ModulosService } from './modulos.service';

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
 */
@Module({
  imports: [AuthModule],
  controllers: [ModulosController],
  providers: [ModulosService, { provide: APP_INTERCEPTOR, useClass: ModulosInterceptor }],
  exports: [ModulosService],
})
export class TenantsModule {}
