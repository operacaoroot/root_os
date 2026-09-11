import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { RetencaoService } from './retencao.service';
import { MemoryModule } from '../memory/memoria.module';

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
/*
 * `MemoryModule` entra no `imports` por UMA razão, e ela é de produto: existir
 * UM lugar onde se pergunta se o rastro fecha.
 *
 * A cadeia de hash do RASTRO e os elos da MEMÓRIA são duas metades da mesma
 * prova — mexer no corpo de uma versão sem mexer no evento é pego pelos elos;
 * mexer também no evento para esconder quebra a cadeia e é pego aqui. Duas rotas
 * separadas significariam, na prática, uma delas nunca ser aberta.
 *
 * A aresta é segura: `MemoryModule` não importa este de volta (e `MemoriaService`
 * escreve no rastro pelo `EventLogService`, que vem do gateway `@Global`).
 */
@Global()
@Module({
  imports: [MemoryModule],
  controllers: [AuditController],
  providers: [AuditService, RetencaoService],
  exports: [AuditService, RetencaoService],
})
export class AuditModule {}
