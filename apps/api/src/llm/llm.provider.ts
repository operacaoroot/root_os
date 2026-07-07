// Abstração de LLM. Hoje: OpenAI (temporário). Amanhã: Claude, sem mexer no resto.
// Ver docs/INTEGRATIONS.md — "Claude / API" é consumidor via LLMProvider.

export interface LlmMessage {
  system: string;
  user: string;
}

export interface LlmProvider {
  /** provedor: openai | anthropic … (para registrar no relatório) */
  readonly name: string;
  /** modelo em uso, ex.: gpt-4o */
  readonly model: string;
  /** true quando há credencial configurada (senão, geração falha com msg clara) */
  readonly configured: boolean;
  complete(input: LlmMessage): Promise<string>;
}

// Token de injeção do Nest (o módulo escolhe a implementação por env).
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
