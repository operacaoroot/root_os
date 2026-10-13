import { Injectable, Logger } from '@nestjs/common';

import { env, envNumero } from './env';
import type { ChamadaParaTeto, LlmMessage, LlmProvider, LlmStepInput, LlmStepOutput } from './llm.provider';
import { anotarProcedencia } from './procedencia';
import { StubProvider } from './stub.provider';

/*
 * O PROVEDOR `ponte` — o sidecar do host (lane E do cockpit, 13/10/2026).
 *
 * Fala com `homolog/ponte-modelo/ponte.mjs` por `POST <PONTE_MODELO_URL>/complete
 * {system, user, maxTokens}`. A ponte chama o CLI do Claude Code no host e
 * devolve `{texto, modelo, custoUsd: 0, custoDesconhecido: true}`. Só serve à
 * DEMONSTRAÇÃO da homologação: gasta a assinatura de quem está logado no host.
 *
 * QUANDO A PONTE NÃO RESPONDE (503, 5xx, rede, prazo `PONTE_MODELO_PRAZO_MS`),
 * A RESPOSTA VEM DO STUB, e isso nunca é silêncio: a procedência da chamada sai
 * com `caiuNoStub: true` e o motivo, o log avisa, e quem grava o fato (o
 * diagnóstico, a proposta, a dúvida) leva os dois para a tela. Sem a queda, a
 * demonstração pararia inteira porque a sessão do CLI expirou.
 *
 * CUSTO: 0 com `custoDesconhecido: true`. O modelo servido (`claude-fable-5-1`,
 * por padrão) não está em `preco.ts` e não se inventa preço: com o teto da
 * empresa LIGADO a chamada é recusada antes de sair; a homologação roda sem
 * teto, e "preço do Fable na tabela" é pendência registrada.
 */

const PRAZO_PADRAO_MS = 190_000;

@Injectable()
export class PonteProvider implements LlmProvider {
  readonly name = 'ponte';
  readonly supportsTools = false;
  private readonly log = new Logger('PonteProvider');
  private readonly url = env('PONTE_MODELO_URL', 'http://127.0.0.1:4099').replace(/\/$/, '');
  private readonly prazoMs = envNumero('PONTE_MODELO_PRAZO_MS', PRAZO_PADRAO_MS);
  readonly model = env('PONTE_MODELO', 'claude-fable-5-1');
  /** O token compartilhado com a ponte (E-1): sem ele a ponte recusa com 401 e a chamada cai no stub com aviso. */
  private readonly token = env('PONTE_MODELO_TOKEN', '');

  constructor(private readonly stub: StubProvider) {}

  get configured(): boolean {
    return Boolean(this.url);
  }

  tetoDeSaida(chamada: ChamadaParaTeto): number {
    return chamada.maxTokens ?? 4_000;
  }

  async complete(input: LlmMessage): Promise<string> {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), this.prazoMs);
    let motivo: string;
    try {
      const r = await fetch(`${this.url}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.token ? { 'x-ponte-token': this.token } : {}) },
        body: JSON.stringify({ system: input.system, user: input.user, maxTokens: input.maxTokens }),
        signal: controle.signal,
      });
      const corpo = (await r.json().catch(() => null)) as { texto?: unknown; modelo?: unknown; erro?: unknown } | null;
      if (r.ok && corpo && typeof corpo.texto === 'string' && corpo.texto.trim()) {
        anotarProcedencia({
          provider: this.name,
          modelo: typeof corpo.modelo === 'string' && corpo.modelo ? corpo.modelo : this.model,
          custoUsd: 0,
          custoDesconhecido: true,
          caiuNoStub: false,
          aviso: null,
        });
        return corpo.texto;
      }
      motivo = `a ponte respondeu ${r.status}${corpo && typeof corpo.erro === 'string' ? `: ${corpo.erro.slice(0, 200)}` : ''}`;
    } catch (e) {
      motivo = controle.signal.aborted
        ? `a ponte não respondeu em ${this.prazoMs} ms`
        : `a ponte está fora do ar: ${(e as Error).message.slice(0, 200)}`;
    } finally {
      clearTimeout(relogio);
    }

    const aviso = `${motivo}; a resposta veio do stub (determinístico, sem modelo).`;
    this.log.warn(aviso);
    const texto = await this.stub.complete(input);
    anotarProcedencia({ provider: 'stub', modelo: this.stub.model, custoUsd: 0, custoDesconhecido: false, caiuNoStub: true, aviso });
    return texto;
  }

  /** Passo de agente com ferramentas não passa pela ponte: ela só sabe responder texto. */
  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    const ultimo = [...input.turns].reverse().find((t) => t.role === 'user');
    const text = await this.complete({ system: input.system, user: ultimo && ultimo.role === 'user' ? ultimo.text : '', orgId: input.orgId, maxTokens: input.maxTokens });
    return {
      text,
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, custoUsd: 0, custoEstimado: false, modeloServido: this.model },
      raw: null,
    };
  }
}
