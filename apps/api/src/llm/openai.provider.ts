import { Injectable, Logger } from '@nestjs/common';
import type {
  LlmMessage,
  LlmProvider,
  LlmStepInput,
  LlmStepOutput,
  LlmStopReason,
  LlmToolCall,
  LlmTurn,
  LlmUsage,
} from './llm.provider';
import { custoUsd } from './preco';

// Provider OpenAI (Chat Completions) via fetch nativo — sem SDK/dep extra.
// Credenciais PRÓPRIAS do root (openai.env em ~/.config/root/), nunca no repo.
// Temporário: a meta do produto é Claude atrás desta MESMA interface.
@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  readonly supportsTools = true;
  private readonly log = new Logger('OpenAiProvider');
  private readonly apiKey = process.env.OPENAI_API_KEY ?? '';
  private readonly baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  readonly model = process.env.OPENAI_MODEL ?? 'gpt-4o';

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async complete({ system, user }: LlmMessage): Promise<string> {
    if (!this.configured) {
      throw new Error(
        'OPENAI_API_KEY ausente. Configure ~/.config/root/openai.env (OPENAI_API_KEY=...) e reinicie a API.',
      );
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.log.error(`OpenAI HTTP ${res.status}: ${body.slice(0, 500)}`);
      throw new Error(`OpenAI respondeu HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI retornou resposta vazia.');
    return text;
  }

  /*
   * UM passo, com ferramentas. Mesma forma do provider Anthropic — o runtime
   * que roda o laço não sabe qual dos dois está atrás da interface, que é o
   * ponto inteiro de existir a interface.
   *
   * Sem streaming aqui: o único consumidor que precisa é o chat da web, e o
   * default do produto é Claude. Passar `onTextDelta` para cá entrega o texto
   * de uma vez, no fim — degradação honesta, não silenciosa.
   */
  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    if (!this.configured) {
      throw new Error(
        'OPENAI_API_KEY ausente. Configure ~/.config/root/openai.env (OPENAI_API_KEY=...) e reinicie a API.',
      );
    }

    const modelo = input.model ?? this.model;
    const corpo: Record<string, unknown> = {
      model: modelo,
      max_tokens: input.maxTokens ?? 4000,
      messages: [
        { role: 'system', content: input.system },
        ...input.turns.flatMap((t) => this.paraMensagens(t)),
      ],
    };
    if (input.tools?.length) {
      corpo.tools = input.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
      corpo.tool_choice = 'auto';
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(corpo),
      signal: input.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.log.error(`OpenAI HTTP ${res.status}: ${body.slice(0, 500)}`);
      throw new Error(`OpenAI respondeu HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };

    const escolha = json.choices?.[0];
    const texto = escolha?.message?.content?.trim() ?? '';
    const toolCalls: LlmToolCall[] = (escolha?.message?.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      // Argumento vem como string JSON. Malformado é problema do modelo, não
      // da porta: devolve objeto vazio e a validação por schema recusa depois.
      args: this.parseArgs(c.function.arguments, c.function.name),
    }));

    if (texto) input.onTextDelta?.(texto);

    const modeloServido = json.model ?? modelo;
    const entrada = json.usage?.prompt_tokens ?? 0;
    const saida = json.usage?.completion_tokens ?? 0;
    const cacheLeitura = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const { custoUsd: custo, custoEstimado } = custoUsd(modeloServido, {
      entrada,
      saida,
      cacheLeitura,
    });
    const usage: LlmUsage = {
      inputTokens: entrada,
      outputTokens: saida,
      cacheReadTokens: cacheLeitura,
      cacheWriteTokens: 0,
      custoUsd: custo,
      custoEstimado,
      modeloServido,
    };

    return {
      text: texto,
      toolCalls,
      stopReason: this.paraStopReason(escolha?.finish_reason, toolCalls.length),
      usage,
      raw: escolha?.message ?? null,
    };
  }

  private parseArgs(bruto: string, ferramenta: string): Record<string, unknown> {
    try {
      const v = JSON.parse(bruto || '{}');
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      this.log.warn(`argumento malformado em ${ferramenta}: ${bruto.slice(0, 120)}`);
      return {};
    }
  }

  private paraMensagens(t: LlmTurn): Record<string, unknown>[] {
    if (t.role === 'user') return [{ role: 'user', content: t.text }];
    if (t.role === 'assistant') {
      return [
        {
          role: 'assistant',
          content: t.text ?? null,
          ...(t.toolCalls?.length
            ? {
                tool_calls: t.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.args) },
                })),
              }
            : {}),
        },
      ];
    }
    // O OpenAI quer UMA mensagem por resultado (o Anthropic quer um turno só).
    return t.results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.content }));
  }

  private paraStopReason(motivo: string | undefined, qtdTools: number): LlmStopReason {
    if (motivo === 'tool_calls' || qtdTools > 0) return 'tool_use';
    if (motivo === 'stop') return 'end_turn';
    if (motivo === 'length') return 'max_tokens';
    if (motivo === 'content_filter') return 'refusal';
    return 'other';
  }
}
