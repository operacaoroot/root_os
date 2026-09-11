import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { RetencaoService } from './retencao.service';

/*
 * `ExpurgoService` NÃO ESTÁ AQUI, e a ausência é a trava.
 *
 * Até 11/09/2026 ele era provider e export deste módulo — que é `@Global`.
 * Provider de módulo global é alcançável por injeção de qualquer lugar da
 * aplicação: bastava alguém escrever `constructor(private expurgo:
 * ExpurgoService)` num controller para o caminho que apaga linha do RASTRO
 * passar a atender requisição HTTP. As travas do banco não seguram isso quando a
 * aplicação conecta como DONA das tabelas (o padrão sem `TENANT_DATABASE_URL`):
 * dono é superusuário na imagem que usamos, tem EXECUTE na função e atravessa
 * policy.
 *
 * Agora o expurgo é alcançável de um lugar só: `src/scripts/expurgar-rastro.ts`,
 * que constrói a classe à mão, com a conexão dona, fora de qualquer injetor do
 * Nest. Quem tentar injetá-lo recebe erro de dependência no arranque — que é o
 * momento certo para a conversa acontecer.
 *
 * Ver o cabeçalho de `expurgo.service.ts` para as outras três camadas.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, RetencaoService],
  exports: [AuditService, RetencaoService],
})
export class AuditModule {}
