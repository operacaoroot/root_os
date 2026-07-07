import { Injectable, Logger } from '@nestjs/common';
import type { LlmMessage, LlmProvider } from './llm.provider';

// Provider OpenAI (Chat Completions) via fetch nativo — sem SDK/dep extra.
// Credenciais PRÓPRIAS do root (openai.env em ~/.config/root/), nunca no repo.
// Temporário: a meta do produto é Claude atrás desta MESMA interface.
@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
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
}
