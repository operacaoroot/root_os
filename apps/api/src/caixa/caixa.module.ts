import { Module } from '@nestjs/common';

import { TenantsModule } from '../tenants/tenants.module';
import { CaixaController } from './caixa.controller';
import { CaixaService } from './caixa.service';
import { CaixaAtividadeController } from './caixa-atividade.controller';
import { CaixaAtividadeService } from './caixa-atividade.service';
import { CaixaVistoService } from './caixa-visto.service';

/**
 * A CAIXA PESSOAL — fatia A7.
 *
 * Um controller e um serviço de LEITURA. Nada é exportado: nenhuma outra parte
 * do sistema tem por que injetar "o que espera pelo Pedro", e provider exportado
 * sem chamador é superfície que um dia alguém usa por engano (a lição do
 * `ExpurgoService`, que era provider de módulo `@Global` e por isso estava a um
 * construtor de distância de virar rota HTTP).
 *
 * `TenantsModule` entra por UMA pergunta: "esta empresa contratou o módulo
 * `trabalho`?". `caixa` é prefixo de espinha, então o `ModulosInterceptor` deixa
 * a rota responder sempre — e sem essa pergunta a caixa serviria dado do quadro
 * a quem não contratou o quadro. `TenantsModule` já exporta o `ModulosService` e
 * importa só o `AuthModule`, então não há ciclo.
 *
 * `PrismaService` e `ToolGateway` vêm de módulos `@Global` (`PrismaModule` e
 * `GatewayModule`) e por isso não aparecem nos `imports` — e não podem aparecer:
 * importar o `GatewayModule` de dentro de um módulo de leitura fecharia ciclo no
 * dia em que a porta quisesse ler a caixa.
 *
 * SEM A LINHA DELE NOS `imports` DO `AppModule`, `GET /api/caixa` responde 404 e
 * NADA ACUSA — o módulo fica no repositório, correto e fora do alcance de
 * qualquer requisição, como o cofre nasceu na primeira entrega. É o mesmo caso
 * da linha do tempo, e é por isso que `/api/caixa` entrou na lista padrão do
 * smoke (`apps/api/scripts/smoke-boot.mjs`): não há sentinela de arranque aqui,
 * porque nenhum outro componente ESPERA algo deste módulo — o silêncio só
 * aparece na tela.
 */
@Module({
  imports: [TenantsModule],
  /*
   * A caixa de entrada (rodada do painel P1, 18/10/2026) entra no MESMO módulo:
   * `CaixaAtividadeController` (atividade, minhas tarefas e o limpar), o
   * serviço de leitura dele e `CaixaVistoService`, a única escrita do módulo —
   * a marca pessoal de "limpei", na tabela `CaixaVisto`. Nada exportado, pelo
   * mesmo motivo de cima.
   */
  controllers: [CaixaController, CaixaAtividadeController],
  providers: [CaixaService, CaixaAtividadeService, CaixaVistoService],
})
export class CaixaModule {}
