// Abstração de LLM. O default é Claude (Anthropic); o OpenAI segue disponível e
// continua sendo quem gera embeddings. Ver docs/INTEGRATIONS.md.
//
// São DUAS superfícies, de propósito:
//
//   complete()  uma pergunta, uma resposta, sem ferramenta e sem histórico.
//               É o que os quatro pontos antigos usam (relatório, curadoria,
//               peças, ficha) e NÃO muda.
//   step()      UM passo de uma conversa com ferramentas. Devolve o texto e as
//               chamadas que o modelo propôs — e para por aí.
//
// O LOOP NÃO MORA AQUI, e isso é a decisão que sustenta o produto: entre o
// modelo propor uma ferramenta e a ferramenta rodar existe a porta, que
// classifica, decide e GRAVA ANTES de qualquer efeito. Um loop dentro do
// provider engoliria exatamente esse ponto. Quem roda o laço é o AgentRuntime.

export interface LlmMessage {
  system: string;
  user: string;
  /**
   * A empresa que paga por esta chamada (RF-G-05).
   *
   * Existe porque o teto por empresa e por dia precisa saber de quem é o gasto
   * ANTES de o modelo ser chamado. Quando vem preenchido, manda; quando não vem,
   * o teto cai em `contextoAtual()`.
   *
   * ELE NÃO SUBSTITUI O CONTEXTO DE EXECUÇÃO, e essa é a parte que custou caro:
   * a empresa que viaja para a SESSÃO do banco sai do contexto, não deste campo
   * (`prisma/sessao-de-banco.ts`). Informar `orgId` sem abrir o contexto grava —
   * ou deixa de gravar — na empresa errada assim que a aplicação conectar com o
   * papel restrito. Todo chamador de fora de requisição abre o contexto (o
   * agendador da pauta é o caso), e este campo é o cinto explícito por cima.
   * Ver `teto-diario.service.ts`.
   */
  orgId?: string;
  /**
   * O teto de saída que ESTA chamada pede, para as gerações longas (roteiro,
   * pacote, newsletter, voz, peças). Só sobe o padrão do provider, nunca o
   * baixa, e para em `TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA` (`saidaDaResposta`).
   * Ausente, a chamada sai exatamente como antes. A reserva do teto de custo
   * usa o mesmo número (`tetoDeSaida({ tipo: 'completa', maxTokens })`).
   */
  maxTokens?: number;
  /**
   * A FUNÇÃO do cadastro único (`packages/shared/src/agentes.ts`) em nome de quem
   * esta chamada acontece: `CO-03`, `IM-07`, `AG-01`... (rodada dos agentes, 21/10/2026).
   *
   * O provedor escolhe o modelo e o esforço por ela (`escolherModelo`: a variável
   * `LLM_MODELO_<ID>`, depois o cadastro, depois o padrão), e o orçamento por agente
   * enxerga o gasto pelo slug dela quando `agentSlug` não vem. `model`/`effort`
   * passados explicitamente na chamada continuam valendo por cima (é como a tela
   * de Agentes ajusta um agente do laço). Ausente = como antes. O stub aceita a
   * função como marca, além do `[tarefa:...]`.
   */
  funcao?: string;
  /** O agente em nome de quem (ver `LlmStepInput.agentSlug`). Ausente = o slug da `funcao`. */
  agentSlug?: string;
  /**
   * Modelo e esforço EXPLÍCITOS (rodada dos agentes, A1). Chamada nova NÃO os
   * passa: quem decide é o cadastro, pela `funcao`. Existem para o mesmo caso do
   * `LlmStepInput`: um ajuste deliberado vale por cima do cadastro.
   */
  model?: string;
  effort?: LlmEffort;
}

/**
 * O maior `max_tokens` que um `complete()` pode pedir. Não é folga arbitrária:
 * o SDK da Anthropic recusa a chamada SEM streaming cuja saída prevista passe
 * de 10 minutos (por volta de 21 mil tokens), e `complete()` não usa streaming.
 */
export const TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA = 16_000;

/**
 * O `max_tokens` de um `complete()`: o padrão do provider, ou o que a chamada
 * pediu quando é maior — limitado ao teto máximo. Pedido inválido (zero,
 * negativo, não numérico) vale como ausente. Padrão configurado acima do teto
 * máximo fica como está: a chamada não pode baixar o que o ambiente decidiu.
 */
export function saidaDaResposta(padrao: number, pedido: number | undefined): number {
  if (typeof pedido !== 'number' || !Number.isFinite(pedido) || pedido < 1) return padrao;
  return Math.max(padrao, Math.min(Math.floor(pedido), TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA));
}

/** Ferramenta como o modelo a enxerga. O nome NÃO aceita ponto — só [A-Za-z0-9_-]. */
export interface LlmToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

/**
 * Um documento que viaja junto com um turno do usuário.
 *
 * Existe para o leitor de ata ler a transcrição em PDF SEM biblioteca de PDF
 * no processo: o modelo lê o documento nativamente. Só o provider da Anthropic
 * sabe fazer isso; os outros ignoram o anexo e quem chama precisa saber
 * (`LlmProvider.leAnexos`). Base64 sem quebra de linha, até 32 MB de pedido.
 */
export interface AnexoDoTurno {
  tipo: 'pdf';
  base64: string;
  titulo?: string;
}

export type LlmTurn =
  | { role: 'user'; text: string; anexos?: AnexoDoTurno[] }
  | { role: 'assistant'; text?: string; toolCalls?: LlmToolCall[]; raw?: unknown }
  | { role: 'tool'; results: LlmToolResult[] };

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  custoUsd: number;
  /**
   * false = o modelo servido não está na tabela de preço, e o custo é 0 por
   * falta de dado, não por ser grátis. A tela mostra "não medido" — nunca
   * R$ 0,00, que seria o mesmo defeito da IA inventando número.
   */
  custoEstimado: boolean;
  /** Pode diferir de `model`: com fallback ligado, quem responde é outro. */
  modeloServido: string;
}

export type LlmStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'refusal'
  | 'pause_turn'
  | 'other';

export type LlmEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LlmStepInput {
  system: string;
  turns: LlmTurn[];
  tools?: LlmToolSpec[];
  model?: string;
  maxTokens?: number;
  effort?: LlmEffort;
  /** Presente ⇒ o provider usa streaming e chama isto a cada pedaço de texto. */
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
  /** A empresa que paga por este passo (RF-G-05). Ver `LlmMessage.orgId`. */
  orgId?: string;
  /**
   * O AGENTE em nome de quem este passo acontece (fatia A3).
   *
   * Existe porque o orçamento MENSAL por agente precisa saber de quem é o gasto
   * antes de o modelo ser chamado. Quando vem preenchido, manda; quando não vem,
   * o envelope cai em `contextoAtual()?.agentSlug`.
   *
   * VAZIO NÃO É ERRO: `complete()` e os chamadores que não são agente (relatório,
   * curadoria, ficha) gastam em nome da EMPRESA, e atribuir esse gasto a um
   * agente qualquer seria inventar procedência. Sem agente, só o teto por
   * empresa e por dia se aplica.
   */
  agentSlug?: string;
  /**
   * Ferramentas que rodam NO SERVIDOR do provedor (rodada dos agentes, IM-02): hoje
   * só a busca na web, e só o provedor `anthropic` sabe (ferramenta `web_search`).
   * Os outros ignoram e quem chama precisa saber (`LlmProvider.buscaNaWeb`). Quem
   * liga é a nota da empresa (`onboarding.pesquisa.web` = `ligada`), nunca o modelo.
   */
  servidor?: { buscaNaWeb?: { maxUsos: number } };
  /**
   * A FUNÇÃO do cadastro único (`packages/shared/src/agentes.ts`) em nome de quem
   * esta chamada acontece: `CO-03`, `IM-07`, `AG-01`... (rodada dos agentes, 21/10/2026).
   *
   * O provedor escolhe o modelo e o esforço por ela (`escolherModelo`: a variável
   * `LLM_MODELO_<ID>`, depois o cadastro, depois o padrão), e o orçamento por agente
   * enxerga o gasto pelo slug dela quando `agentSlug` não vem. `model`/`effort`
   * passados explicitamente na chamada continuam valendo por cima (é como a tela
   * de Agentes ajusta um agente do laço). Ausente = como antes. O stub aceita a
   * função como marca, além do `[tarefa:...]`.
   */
  funcao?: string;
}

/**
 * A chamada, do ponto de vista de quem só precisa saber quanto ela pode custar.
 *
 * `tetoDeSaida` existe para o teto de custo reservar o número REAL de
 * `max_tokens` que o provider vai mandar, em vez de manter um palpite paralelo
 * que envelhece em silêncio quando o default do provider muda.
 */
export type ChamadaParaTeto =
  | { tipo: 'completa'; maxTokens?: number }
  | { tipo: 'passo'; maxTokens?: number; streaming: boolean };

export interface LlmStepOutput {
  text: string;
  /** Vazio ⇒ o modelo terminou. */
  toolCalls: LlmToolCall[];
  stopReason: LlmStopReason;
  refusalCategoria?: string;
  usage: LlmUsage;
  /** Blocos crus, devolvidos intactos na próxima volta (thinking exige isso). */
  raw: unknown;
}

export interface LlmProvider {
  /** provedor: openai | anthropic … (para registrar no rastro) */
  readonly name: string;
  /** modelo em uso, ex.: claude-opus-5 */
  readonly model: string;
  /** true quando há credencial configurada (senão, geração falha com msg clara) */
  readonly configured: boolean;
  /** false quando o provider não sabe chamar ferramenta — o runtime recusa antes de tentar. */
  readonly supportsTools: boolean;
  /**
   * true quando o provider lê `AnexoDoTurno` (PDF) num turno do usuário.
   * Opcional para os dublês de teste não precisarem declará-lo; ausente = não lê.
   */
  readonly leAnexos?: boolean;
  /** true quando o provider executa `LlmStepInput.servidor.buscaNaWeb`. Ausente = não executa. */
  readonly buscaNaWeb?: boolean;
  /**
   * O modelo e o esforço que ESTE provedor vai mandar para esta chamada
   * (rodada dos agentes, A1): o explícito, senão a função do cadastro, senão o
   * padrão dele. O envelope do teto reserva com o mesmo número que vai no pedido.
   * Ausente (dublês, provedores que não escolhem) = `input.model ?? this.model`.
   */
  modeloDaChamada?(input: { funcao?: string; model?: string; effort?: LlmEffort }): { modelo: string; esforco?: LlmEffort };
  complete(input: LlmMessage): Promise<string>;
  step(input: LlmStepInput): Promise<LlmStepOutput>;
  /**
   * O `max_tokens` que ESTE provider vai enviar para esta chamada. É o limite
   * superior da saída, e é com ele que o teto de custo reserva (RF-G-05).
   */
  tetoDeSaida(chamada: ChamadaParaTeto): number;
}

// Token de injeção do Nest (o módulo escolhe a implementação por env).
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
