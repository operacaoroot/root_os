import { Module } from '@nestjs/common';
import { LinhaDoTempoController } from './linha-do-tempo.controller';
import { LinhaDoTempoService } from './linha-do-tempo.service';

/**
 * A LINHA DO TEMPO — fatia A9.
 *
 * Só um controller e um serviço de LEITURA. Nada é exportado: nenhuma outra
 * parte do sistema tem por que injetar a leitura narrativa do rastro, e provider
 * exportado sem chamador é superfície que um dia alguém usa por engano (a lição
 * de `ExpurgoService`, que era provider de módulo `@Global` e por isso estava a
 * um construtor de distância de virar rota HTTP).
 *
 * `PrismaService` e `EventLogService` vêm de módulos `@Global` (`PrismaModule` e
 * `GatewayModule`), então não há `imports` aqui — e não pode haver: importar o
 * `GatewayModule` de dentro de um módulo de leitura fecharia ciclo no dia em que
 * a porta quisesse ler a linha.
 *
 * SEM A LINHA DELE NOS `imports` DO `AppModule`, `GET /api/linha-do-tempo`
 * responde 404 e NADA ACUSA — o módulo fica no repositório, correto e fora do
 * alcance de qualquer requisição, como o cofre nasceu na primeira entrega. Não
 * há sentinela de arranque aqui porque não há nada que outro componente
 * *espere* deste módulo (o caso da `rotinas`, onde o silêncio era pior).
 */
@Module({
  controllers: [LinhaDoTempoController],
  providers: [LinhaDoTempoService],
})
export class LinhaDoTempoModule {}
