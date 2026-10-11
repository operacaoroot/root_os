import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AcessoDeSuporteService } from './acesso-de-suporte.service';
import { ConsoleDaPlataformaService } from './console.service';
import { PlataformaController, SuporteDoClienteController } from './plataforma.controller';
import { PropostasController } from './propostas.controller';
import { PropostasService } from './propostas.service';
import { SessaoDaPlataformaGuard } from './sessao-da-plataforma.guard';

/*
 * O CONSOLE DA PLATAFORMA — RF-B-02 (fatia 6.3).
 *
 * `AuthModule` entra por DUAS razões, e as duas importam: o `JwtAuthGuard` dos
 * controladores (como em `TenantsModule`) e o `ReauthService`, que é a prova de
 * presença exigida por R4 em `autorizar`. `PrismaService` vem do `PrismaModule`,
 * que é global, e `EventLogService` vem do `GatewayModule`, que também é.
 *
 * NÃO EXPORTA NADA, e a ausência é deliberada. `AcessoDeSuporteService` sabe
 * abrir o contexto de OUTRA empresa (é o que o acesso de suporte significa);
 * exportá-lo convidaria qualquer módulo a injetá-lo e a usar essa troca de
 * contexto para outro fim. Quem precisar de acesso de suporte passa pelas rotas,
 * que conferem autorização, prazo e escopo antes de qualquer leitura.
 *
 * ONDE ELE ENTRA NO `AppModule`: por último, depois de `GatewayModule` (de onde
 * vem o RASTRO), de `TenantsModule` (o gate de módulos) e de `AuthModule`. A
 * linha existe — foi a edição pontual autorizada nesta correção.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlataformaController, SuporteDoClienteController, PropostasController],
  providers: [ConsoleDaPlataformaService, AcessoDeSuporteService, SessaoDaPlataformaGuard, PropostasService],
})
export class PlataformaModule {}
