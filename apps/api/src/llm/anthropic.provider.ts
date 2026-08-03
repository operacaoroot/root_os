import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { LlmMessage, LlmProvider } from './llm.provider';

// Provider Claude (SDK oficial @anthropic-ai/sdk). Credencial PRÓPRIA do root.
//
// Diferenças que NÃO dá para copiar do OpenAiProvider:
// - `temperature`/`top_p`/`top_k` foram REMOVIDOS nos modelos Opus atuais: mandar
//   qualquer um deles devolve HTTP 400. Quem guia o tom aqui é o prompt.
// - Thinking é adaptativo (`{type:'adaptive'}`); o antigo `budget_tokens` também
//   responde 400. `max_tokens` limita pensamento + resposta juntos, por isso o
//   teto abaixo é folgado.
// - A resposta pode vir com `stop_reason: 'refusal'` (HTTP 200, conteúdo vazio) —
//   ler `content[0]` direto quebraria. Ver o tratamento em complete().
@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly log = new Logger('AnthropicProvider');
  private readonly apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  // O SDK também aceita ANTHROPIC_AUTH_TOKEN (perfil OAuth). Não dá para forçar
  // uma apiKey falsa no construtor: isso atropelaria a resolução do próprio SDK.
  private readonly authToken = process.env.ANTHROPIC_AUTH_TOKEN ?? '';
  readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';
  private readonly effort = (process.env.ANTHROPIC_EFFORT ?? 'high') as
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max';
  private readonly maxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 16000);

  // Sem credencial no env o cliente sobe assim mesmo (o SDK resolve sozinho se
  // houver perfil); quem barra a chamada é `configured`.
  private readonly client = new Anthropic(
    this.apiKey ? { apiKey: this.apiKey } : {},
  );

  get configured(): boolean {
    return this.apiKey.length > 0 || this.authToken.length > 0;
  }

  async complete({ system, user }: LlmMessage): Promise<string> {
    if (!this.configured) {
      throw new Error(
        'ANTHROPIC_API_KEY ausente. Defina no .env (ver .env.example) e reinicie a API. ' +
          'ANTHROPIC_AUTH_TOKEN (perfil OAuth) também serve.',
      );
    }

    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      // Pensamento adaptativo: o modelo decide quanto pensar por tarefa.
      thinking: { type: 'adaptive' },
      output_config: { effort: this.effort },
      // Se um classificador recusar, a API repete o pedido no modelo de reserva
      // recomendado em vez de devolver a recusa. Sai mais caro só quando ocorre.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: user }],
    });

    if (res.stop_reason === 'refusal') {
      this.log.warn(`Claude recusou o pedido (categoria: ${res.stop_details?.category ?? 'n/d'})`);
      throw new Error(
        'Claude recusou este pedido por política de conteúdo. Revise o material capturado.',
      );
    }

    // content é união discriminada: só os blocos de texto interessam
    // (blocos `thinking` vêm com texto vazio no default e não entram na resposta).
    const texto = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!texto) {
      throw new Error(
        `Claude devolveu resposta vazia (stop_reason: ${res.stop_reason ?? 'n/d'}).`,
      );
    }
    return texto;
  }
}
