import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuthModule } from '../auth/auth.module';
import { AssinaturaController } from './assinatura.controller';
import { AssinaturaService } from './assinatura.service';
import { CobrancaAsaasService } from './cobranca-asaas.service';
import { SuspensaoInterceptor } from './suspensao.interceptor';

/*
 * ASSINATURA, COBRANÇA E SUSPENSÃO — RF-O-03 (fatia 6.2).
 *
 * Instala o gate de suspensão para a aplicação inteira. `APP_INTERCEPTOR`
 * declarado em módulo importado vale para todas as rotas, e é isso que se quer:
 * gate que precisa ser lembrado controller a controller é gate que um dia
 * alguém esquece no controller novo.
 *
 * `useExisting` E NÃO `useClass`, e a diferença não é estilo — é a fatia
 * funcionando ou não. `useClass` cria uma SEGUNDA instância do interceptor, com
 * um segundo cache; o controller esqueceria o cache da instância dele e o gate
 * continuaria lendo o da outra. Quem clicasse em "já paguei" continuaria
 * bloqueado até a janela vencer, e ninguém conseguiria explicar por quê.
 *
 * ORDEM NO `AppModule`: depois do `TenantsModule`. Interceptor global registrado
 * antes ENVOLVE o registrado depois, então o gate de módulos decide primeiro
 * ("esta empresa contratou este módulo?") e o de suspensão decide em seguida
 * ("esta empresa está em dia?"). Nessa ordem, um módulo não contratado responde
 * 404 mesmo para empresa suspensa — que é o certo: quem não contratou não
 * precisa saber que a rota existe, esteja em dia ou não.
 *
 * `AuthModule` entra por causa do `JwtAuthGuard` e do `PermissionsGuard` do
 * controller. `PrismaService`, `CofreService` e `EventLogService` vêm de módulos
 * `@Global` (`PrismaModule`, `CofreModule`, `GatewayModule`) — nada a importar.
 *
 * NÃO HÁ EXECUTOR DE ROTINA AQUI, e é decisão declarada. A conferência contra o
 * provedor é disparada por ato explícito (a tela, o operador), nunca por tique.
 * Um executor de rotina de cobrança exigiria que este módulo importasse
 * `RoutinesModule` — que carrega por último no `AppModule` e cujo registro
 * RECUSA inscrição dupla —, e sobretudo faria a suspensão acontecer sozinha, em
 * lote, no horário em que menos gente está olhando. Ligar o tique é uma fatia
 * própria, e ela precisa vir com teto de quantas empresas por rodada e com um
 * modo de ensaio. Ver PERGUNTAS no relatório.
 */
@Module({
  imports: [AuthModule],
  controllers: [AssinaturaController],
  providers: [
    AssinaturaService,
    CobrancaAsaasService,
    SuspensaoInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: SuspensaoInterceptor },
  ],
  exports: [AssinaturaService],
})
export class BillingModule {}
