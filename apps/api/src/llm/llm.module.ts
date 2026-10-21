import { Global, Module } from '@nestjs/common';
import { LLM_PROVIDER } from './llm.provider';
import { OpenAiProvider } from './openai.provider';
import { AnthropicProvider } from './anthropic.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { TetoDeCustoIaService } from './teto-diario.service';
import { RelatorioDeCustoIaService } from './relatorio-custo.service';
import { OrcamentoDeAgenteService } from './orcamento-de-agente.service';
import { ProviderComTeto } from './provider-com-teto';
import { env } from './env';
import { TranscricaoService } from './transcricao.provider';
import { StubProvider } from './stub.provider';
import { PonteProvider } from './ponte.provider';
import { GastoPorFuncaoService } from './gasto-por-funcao.service';
import { MedidorDeGastoExterno } from './gasto-externo';

// Escolhe o provider por env LLM_PROVIDER: anthropic | openrouter | openai | stub | ponte.
//
// `stub` e `ponte` são da homologação do cockpit comercial (lane E, 13/10/2026):
// o stub responde por regra a partir de `homolog/fixtures/stub/` (sem rede,
// custo 0) e a ponte fala com o sidecar do host, caindo no stub com aviso
// quando ele não responde. Ver `stub.provider.ts` e `ponte.provider.ts`.
//
// O default segue `anthropic` (Claude pela API própria). O `openrouter` existe
// porque a operação já tem chave e crédito lá, e ele é a mesma API de Chat
// Completions com nome e custo próprios — ver openrouter.provider.ts.
//
// O OpenAI continua sendo quem gera embeddings: não há endpoint de embedding
// na Anthropic, e trocar isso mudaria os vetores já gravados.
//
// Provider escolhido sem credencial NÃO derruba o boot: `configured` fica
// falso e a chamada falha com mensagem clara, na hora do uso. Derrubar a API
// inteira por falta de chave de IA deixaria o painel fora do ar por causa de
// um recurso opcional.
//
// O QUE O TOKEN `LLM_PROVIDER` ENTREGA MUDOU NA FATIA 3.6: não é mais o provider
// escolhido, é ele DENTRO do envelope do teto de custo por empresa e por dia
// (`ProviderComTeto`, RF-G-05). A superfície é a mesma — quem injeta não muda
// uma linha —, e é essa a razão de o teto morar num envelope e não espalhado
// pelos três providers: regra de negócio repetida três vezes é regra que diverge
// na terceira.
//
// O QUE SAIU DAQUI NA CORREÇÃO DA 3.6: `OpenAiProvider` era exportado CRU, com a
// justificativa de que quem o injetasse estaria gerando EMBEDDING. A
// justificativa não conferia — NINGUÉM o injeta, e os dois pontos de vetorização
// (`obsidian/obsidian.service.ts` e `pauta/pauta.service.ts`) falam com
// `/embeddings` por `fetch` próprio. O que a exportação de fato oferecia, num
// módulo GLOBAL, era um caminho até `complete()` e `step()` POR FORA do envelope
// do teto, disponível a qualquer serviço da aplicação. Ele continua registrado
// como provider (a fábrica abaixo precisa dele); o que não existe mais é a porta
// lateral. Embedding segue não medido por este teto — é cobrado à parte pela
// OpenAI e está no relatório da fatia.
//
// O QUE ENTROU NA FATIA A3: `OrcamentoDeAgenteService` — o orçamento MENSAL por
// agente, o quarto eixo de contenção de gasto. Ele entra no envelope ANTES do
// teto da empresa (ver `provider-com-teto.ts`), e mora aqui pelo mesmo motivo
// que o relatório: fala do mesmo dinheiro que o teto, e leitura de dinheiro que
// muda de casa é leitura que um dia refaz por fora a conta que o controle já
// faz. Ele não tem tabela própria — o livro-caixa por agente é o log de passos
// (`SessionStep`), e o cabeçalho do serviço explica por que.
//
// O QUE ENTROU NA FATIA 6.4: `RelatorioDeCustoIaService` (RF-B-03). Ele só LÊ —
// não reserva, não liquida, não corta —, e por isso divide o módulo com quem
// escreve em vez de morar em `dashboard/`: as duas classes falam das MESMAS duas
// tabelas, e o dia em que a leitura mudar de casa é o dia em que ela começa a
// refazer por fora a conta que o teto já faz. Precisa estar declarado aqui: até
// a fatia 6.4 ele era classe sem módulo — código morto que nenhuma rota
// alcançava e que consulta bruta nenhuma chegou a executar.
//
// O QUE ENTROU NA RODADA DOS AGENTES (21/10/2026, A1): `GastoPorFuncaoService`
// (o livro do gasto por função do cadastro, somado pelo envelope em toda
// chamada e lido pela tela de Agentes em `doMes`) e `MedidorDeGastoExterno`
// (vetorização e transcrição passando pelo teto do dia, com o mesmo livro).
@Global()
@Module({
  providers: [
    OpenAiProvider,
    AnthropicProvider,
    OpenRouterProvider,
    TetoDeCustoIaService,
    RelatorioDeCustoIaService,
    OrcamentoDeAgenteService,
    TranscricaoService,
    GastoPorFuncaoService,
    MedidorDeGastoExterno,
    // O stub vem sem pasta fixa: ele a procura no uso (`pastaDoStub`).
    { provide: StubProvider, useFactory: () => new StubProvider() },
    PonteProvider,
    {
      provide: LLM_PROVIDER,
      useFactory: (
        openai: OpenAiProvider,
        anthropic: AnthropicProvider,
        openrouter: OpenRouterProvider,
        teto: TetoDeCustoIaService,
        orcamentoDoAgente: OrcamentoDeAgenteService,
        stub: StubProvider,
        ponte: PonteProvider,
        gastoPorFuncao: GastoPorFuncaoService,
      ) => {
        const escolhido = env('LLM_PROVIDER', 'anthropic');
        const provider =
          escolhido === 'openai'
            ? openai
            : escolhido === 'openrouter'
              ? openrouter
              : escolhido === 'stub'
                ? stub
                : escolhido === 'ponte'
                  ? ponte
                  : anthropic;
        return new ProviderComTeto(provider, teto, orcamentoDoAgente, gastoPorFuncao);
      },
      inject: [
        OpenAiProvider,
        AnthropicProvider,
        OpenRouterProvider,
        TetoDeCustoIaService,
        OrcamentoDeAgenteService,
        StubProvider,
        PonteProvider,
        GastoPorFuncaoService,
      ],
    },
  ],
  // Exportar continua sendo obrigatório mesmo num módulo `@Global()`: sem a
  // linha abaixo o Nest recusa subir com "can't resolve dependencies of
  // DashboardController", e a recusa é no arranque, não em tempo de teste.
  exports: [
    LLM_PROVIDER,
    TetoDeCustoIaService,
    RelatorioDeCustoIaService,
    OrcamentoDeAgenteService,
    TranscricaoService,
    GastoPorFuncaoService,
    MedidorDeGastoExterno,
  ],
})
export class LlmModule {}
