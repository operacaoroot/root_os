import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ChamadaParaTeto,
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
import { env, envNumero, envOpcional } from './env';

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

/*
 * O teto de saída quando a chamada é em STREAMING. Nomeado porque ganhou um
 * segundo leitor: `tetoDeSaida()`, que é de onde o teto de custo por empresa
 * tira o número para reservar (RF-G-05). Vale muito mais do que o de uma
 * chamada comum porque os pedaços chegam na hora e não há timeout de HTTP para
 * respeitar — e é justamente por isso que uma chamada em streaming reserva
 * bem mais do que uma comum.
 */
const TETO_SAIDA_STREAM = 64000;

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly supportsTools = true;
  readonly leAnexos = true;
  private readonly log = new Logger('AnthropicProvider');
  private readonly apiKey = envOpcional('ANTHROPIC_API_KEY');
  // O SDK também aceita ANTHROPIC_AUTH_TOKEN (perfil OAuth). Não dá para forçar
  // uma apiKey falsa no construtor: isso atropelaria a resolução do próprio SDK.
  private readonly authToken = envOpcional('ANTHROPIC_AUTH_TOKEN');
  readonly model = env('ANTHROPIC_MODEL', 'claude-opus-5');
  private readonly effort = env('ANTHROPIC_EFFORT', 'high') as
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max';
  private readonly maxTokens = envNumero('ANTHROPIC_MAX_TOKENS', 16000);

  // Sem credencial no env o cliente sobe assim mesmo (o SDK resolve sozinho se
  // houver perfil); quem barra a chamada é `configured`.
  private readonly client = new Anthropic(
    this.apiKey ? { apiKey: this.apiKey } : {},
  );

  get configured(): boolean {
    return this.apiKey.length > 0 || this.authToken.length > 0;
  }

  /**
   * Ver `LlmProvider.tetoDeSaida`. É a MESMA expressão que vai em `max_tokens`
   * — `step()` chama este método em vez de repetir a conta, para que a reserva
   * do teto de custo e o pedido de verdade nunca possam divergir.
   */
  tetoDeSaida(chamada: ChamadaParaTeto): number {
    if (chamada.tipo === 'completa') return this.maxTokens;
    return chamada.maxTokens ?? (chamada.streaming ? TETO_SAIDA_STREAM : this.maxTokens);
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

  /*
   * UM passo. Não é um laço: se o modelo pedir ferramenta, isto devolve o pedido
   * e para. Quem executa é a porta, e quem decide continuar é o AgentRuntime.
   *
   * Diferença de comportamento em relação a complete(), e é de propósito:
   * `refusal` aqui NÃO lança. Numa sessão, a recusa é um passo do traço — o
   * usuário precisa ver que o modelo se recusou, com a categoria, e não um 500.
   */
  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    if (!this.configured) {
      throw new Error(
        'ANTHROPIC_API_KEY ausente. Defina no .env (ver .env.example) e reinicie a API. ' +
          'ANTHROPIC_AUTH_TOKEN (perfil OAuth) também serve.',
      );
    }

    const modelo = input.model ?? this.model;
    const pedido = {
      model: modelo,
      // Sem streaming o teto fica no valor seguro contra timeout de HTTP; com
      // streaming dá para pedir muito mais, porque os pedaços chegam na hora.
      max_tokens: this.tetoDeSaida({
        tipo: 'passo',
        maxTokens: input.maxTokens,
        streaming: Boolean(input.onTextDelta),
      }),
      thinking: { type: 'adaptive' as const },
      output_config: { effort: input.effort ?? this.effort },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
      system: input.system,
      messages: input.turns.map((t) => this.paraMensagem(t)),
      // `tool_choice` fica de fora: `auto` é o default, e forçar escolha
      // desliga o paralelismo de chamadas.
      ...(input.tools?.length
        ? {
            tools: input.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Beta.BetaTool['input_schema'],
            })),
          }
        : {}),
    };

    const res = input.onTextDelta
      ? await this.comStream(pedido, input.onTextDelta, input.signal)
      : await this.client.beta.messages.create(pedido, { signal: input.signal });

    const texto = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const toolCalls: LlmToolCall[] = res.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        args: (b.input ?? {}) as Record<string, unknown>,
      }));

    if (res.stop_reason === 'refusal') {
      this.log.warn(`Claude recusou (categoria: ${res.stop_details?.category ?? 'n/d'})`);
    }

    return {
      text: texto,
      toolCalls,
      stopReason: this.paraStopReason(res.stop_reason),
      refusalCategoria: res.stop_details?.category ?? undefined,
      usage: this.paraUsage(res),
      // Os blocos voltam INTACTOS na próxima volta. Remover ou reordenar bloco
      // `thinking` quebra a assinatura e a API recusa o turno seguinte.
      raw: res.content,
    };
  }

  private async comStream(
    pedido: Parameters<typeof this.client.beta.messages.create>[0],
    onTextDelta: (d: string) => void,
    signal?: AbortSignal,
  ) {
    const fluxo = this.client.beta.messages.stream(
      pedido as Parameters<typeof this.client.beta.messages.stream>[0],
      { signal },
    );
    fluxo.on('text', (d) => onTextDelta(d));
    return fluxo.finalMessage();
  }

  private paraMensagem(t: LlmTurn): Anthropic.Beta.BetaMessageParam {
    if (t.role === 'user') {
      if (!t.anexos?.length) return { role: 'user', content: t.text };
      // O documento vem ANTES do texto, que é a ordem que a API recomenda: o
      // modelo lê o anexo e depois a pergunta sobre ele.
      const blocos: Anthropic.Beta.BetaContentBlockParam[] = t.anexos.map((a) => ({
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: a.base64 },
        ...(a.titulo ? { title: a.titulo } : {}),
      }));
      blocos.push({ type: 'text', text: t.text });
      return { role: 'user', content: blocos };
    }
    if (t.role === 'assistant') {
      // Preferir os blocos crus: é o que preserva thinking e assinatura.
      if (t.raw) return { role: 'assistant', content: t.raw as Anthropic.Beta.BetaContentBlockParam[] };
      const blocos: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (t.text) blocos.push({ type: 'text', text: t.text });
      for (const c of t.toolCalls ?? []) {
        blocos.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      }
      return { role: 'assistant', content: blocos };
    }
    // TODOS os resultados num único turno: dividir em turnos separados ensina o
    // modelo a parar de pedir ferramentas em paralelo.
    return {
      role: 'user',
      content: t.results.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: r.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  }

  private paraStopReason(motivo: string | null | undefined): LlmStopReason {
    switch (motivo) {
      case 'end_turn':
      case 'tool_use':
      case 'max_tokens':
      case 'refusal':
      case 'pause_turn':
        return motivo;
      default:
        return 'other';
    }
  }

  private paraUsage(res: Anthropic.Beta.BetaMessage): LlmUsage {
    const u = res.usage;
    const entrada = u?.input_tokens ?? 0;
    const saida = u?.output_tokens ?? 0;
    const cacheLeitura = u?.cache_read_input_tokens ?? 0;
    const cacheEscrita = u?.cache_creation_input_tokens ?? 0;
    // Precifica pelo modelo que RESPONDEU: com `fallbacks: 'default'` ligado,
    // ele diverge do pedido justamente nos casos que custam mais.
    const modeloServido = res.model ?? this.model;
    const { custoUsd: custo, custoEstimado } = custoUsd(modeloServido, {
      entrada,
      saida,
      cacheLeitura,
      cacheEscrita,
    });
    return {
      inputTokens: entrada,
      outputTokens: saida,
      cacheReadTokens: cacheLeitura,
      cacheWriteTokens: cacheEscrita,
      custoUsd: custo,
      custoEstimado,
      modeloServido,
    };
  }
}
