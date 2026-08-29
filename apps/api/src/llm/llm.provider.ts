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

export type LlmTurn =
  | { role: 'user'; text: string }
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
}

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
  complete(input: LlmMessage): Promise<string>;
  step(input: LlmStepInput): Promise<LlmStepOutput>;
}

// Token de injeção do Nest (o módulo escolhe a implementação por env).
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
