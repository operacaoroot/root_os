import { Global, Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { ReguaService } from './regua.service';
import { SinaisService } from './sinais.service';

// @Global porque a porta é consumida de qualquer lugar — e a porta é a única.
//
// `ReguaService` e `PolicyController` são a tela da Régua (RF-P-09): leitura e
// simulação, nada que execute. O serviço NÃO é exportado de propósito — quem
// decide continua sendo `PolicyService`, e um segundo caminho para a política
// saindo daqui é como se criam duas réguas.
//
// `TenantsModule` entra por causa de `ModulosService`: o painel da Régua mostra
// o catálogo de capacidades e precisa podá-lo pelos módulos que a empresa
// contratou (RF-T-06). A pergunta "o que esta empresa contratou" tem UM dono, e
// é ele — reler `Org.modulos` aqui seria o segundo caminho de sempre, com o
// cache e a lista de chaves válidas de brinde. A dependência não fecha ciclo:
// `TenantsModule` importa só `AuthModule`.
@Global()
@Module({
  imports: [TenantsModule],
  controllers: [PolicyController],
  providers: [PolicyService, SinaisService, ReguaService],
  exports: [PolicyService, SinaisService],
})
export class PolicyModule {}
