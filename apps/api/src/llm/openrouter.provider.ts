import { Injectable, Logger } from '@nestjs/common';
import { OpenAiProvider } from './openai.provider';

/*
 * OpenRouter — a mesma API de Chat Completions, com duas diferenças que valem
 * a classe própria.
 *
 * 1. PROCEDÊNCIA DO NOME. Rodar OpenRouter com o provider chamado "openai"
 *    faria o rastro registrar `provider: openai` para uma chamada que não foi
 *    da OpenAI. Num sistema cujo argumento é procedência, isso é justamente o
 *    tipo de mentira pequena que ele existe para impedir.
 *
 * 2. PROCEDÊNCIA DO CUSTO. O OpenRouter devolve o custo REAL da chamada em
 *    `usage.cost` quando se pede `usage: {include: true}`. É o número dele,
 *    não uma estimativa da minha tabela — e por isso ele ganha do fallback.
 *    Sem ele, cai na tabela, e modelo desconhecido vira "não medido".
 *
 * O modelo aqui tem prefixo de fornecedor: `anthropic/claude-sonnet-4.5`.
 */
@Injectable()
export class OpenRouterProvider extends OpenAiProvider {
  readonly name = 'openrouter';
  protected readonly log = new Logger('OpenRouterProvider');
  protected readonly apiKey = process.env.OPENROUTER_API_KEY ?? '';
  protected readonly baseUrl = (
    process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'
  ).replace(/\/$/, '');
  readonly model = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4.5';

  protected get envDaChave(): string {
    return 'OPENROUTER_API_KEY';
  }

  // O OpenRouter usa estes headers para atribuir a chamada a uma aplicação.
  protected get headersExtras(): Record<string, string> {
    return {
      'HTTP-Referer': process.env.OPENROUTER_REFERER ?? 'https://os.operacaoroot.com',
      'X-Title': process.env.OPENROUTER_TITLE ?? 'ROOT OS',
    };
  }

  protected ajustarCorpo(corpo: Record<string, unknown>): Record<string, unknown> {
    // Pede o custo real da chamada de volta. Sem isto, `usage.cost` não vem.
    return { ...corpo, usage: { include: true } };
  }

  protected apurarCusto(
    modeloServido: string,
    usage: unknown,
    tokens: { entrada: number; saida: number; cacheLeitura?: number },
  ): { custoUsd: number; custoEstimado: boolean } {
    const custo = (usage as { cost?: number } | undefined)?.cost;
    // O número do próprio provedor ganha da tabela: é medição, não estimativa.
    if (typeof custo === 'number' && Number.isFinite(custo)) {
      return { custoUsd: Number(custo.toFixed(6)), custoEstimado: true };
    }
    return super.apurarCusto(modeloServido, usage, tokens);
  }
}
