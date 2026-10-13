import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { env } from './env';
import type { ChamadaParaTeto, LlmMessage, LlmProvider, LlmStepInput, LlmStepOutput } from './llm.provider';
import { anotarProcedencia } from './procedencia';

/*
 * O PROVEDOR `stub` — determinístico, sem rede, custo 0 (lane E do cockpit, 13/10/2026).
 *
 * Existe para a suíte e o seed da homologação rodarem a inteligência do
 * comercial sem gastar modelo e sem depender de chave. Ele NÃO é um modelo: é
 * uma tabela de respostas por regra, lida de arquivos JSON versionados em
 * `homolog/fixtures/stub/`.
 *
 * COMO ELE ESCOLHE A RESPOSTA
 *   1. A tarefa vem marcada no prompt de sistema: `[tarefa:comercial.diagnostico]`.
 *      Pedido sem marca, ou de tarefa sem arquivo, LANÇA: o stub não inventa
 *      resposta para pergunta que ninguém escreveu.
 *   2. O arquivo da tarefa tem `respostas: [{ quando: [...], depoisDe?, texto }]` e
 *      `padrao`. Vale a primeira resposta cujos termos de `quando` aparecem
 *      TODOS no pedido do usuário (sem acento, sem caixa), contados depois da
 *      marca `depoisDe` quando ela existe. Nenhuma casa: vale
 *      `padrao`; sem `padrao`, lança.
 *
 * ONDE MORAM OS ARQUIVOS: `STUB_FIXTURES_DIR`, ou o primeiro que existir entre
 * `<cwd>/homolog/fixtures/stub` (raiz do repo), `<cwd>/../../homolog/fixtures/stub`
 * (`apps/api`, no host e no container, onde o repo fica em `/app`) e
 * `/app/homolog/fixtures/stub`.
 *
 * O custo é 0 e CONHECIDO (`custoDesconhecido: false`): o stub não gasta nada.
 * O teto por empresa recebe o modelo `stub`, que não está em `preco.ts`; com o
 * teto LIGADO a chamada é recusada, e é por isso que a empresa de homologação
 * fica sem teto. Não se inventa preço para fazer passar.
 */

export const MODELO_DO_STUB = 'stub';
const MARCA_DA_TAREFA = /\[tarefa:([a-z0-9._-]+)\]/i;

interface RespostaDoStub {
  quando?: string[];
  /** Só procura os termos DEPOIS desta marca do pedido (ex.: a pergunta do cliente, e não os fatos). */
  depoisDe?: string;
  texto: string;
}

interface ArquivoDoStub {
  tarefa: string;
  respostas?: RespostaDoStub[];
  padrao?: string | null;
}

export class StubSemRespostaError extends Error {
  constructor(motivo: string) {
    super(`stub sem resposta: ${motivo}`);
    this.name = 'StubSemRespostaError';
  }
}

function semAcento(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** A pasta das respostas do stub (ver o cabeçalho). `null` quando nenhuma existe. */
export function pastaDoStub(): string | null {
  const configurada = env('STUB_FIXTURES_DIR', '');
  const candidatas = configurada
    ? [resolve(configurada)]
    : [
        resolve(process.cwd(), 'homolog/fixtures/stub'),
        resolve(process.cwd(), '../../homolog/fixtures/stub'),
        '/app/homolog/fixtures/stub',
      ];
  return candidatas.find((c) => existsSync(c)) ?? null;
}

/** Lê as tarefas da pasta. Arquivo malformado lança na leitura, com o nome dele. */
export function carregarRespostasDoStub(pasta: string): Map<string, ArquivoDoStub> {
  const mapa = new Map<string, ArquivoDoStub>();
  for (const nome of readdirSync(pasta).filter((n) => n.endsWith('.json')).sort()) {
    const bruto = JSON.parse(readFileSync(join(pasta, nome), 'utf8')) as ArquivoDoStub;
    if (!bruto || typeof bruto.tarefa !== 'string' || !bruto.tarefa.trim()) {
      throw new Error(`fixture do stub sem "tarefa": ${nome}`);
    }
    mapa.set(bruto.tarefa.trim().toLowerCase(), bruto);
  }
  return mapa;
}

/** Puro: a resposta do stub para um pedido, ou o erro que diz por que não há. */
export function responderPeloStub(respostas: Map<string, ArquivoDoStub>, input: { system: string; user: string }): string {
  const marca = MARCA_DA_TAREFA.exec(input.system ?? '');
  if (!marca) throw new StubSemRespostaError('o prompt de sistema não marca a tarefa ([tarefa:...])');
  const tarefa = marca[1].toLowerCase();
  const arquivo = respostas.get(tarefa);
  if (!arquivo) throw new StubSemRespostaError(`nenhuma fixture para a tarefa "${tarefa}"`);
  const pedido = semAcento(input.user);
  for (const r of arquivo.respostas ?? []) {
    const marcaDoTrecho = r.depoisDe ? semAcento(r.depoisDe) : '';
    const onde = marcaDoTrecho ? pedido.indexOf(marcaDoTrecho) : 0;
    if (onde < 0) continue;
    const alvo = pedido.slice(onde + marcaDoTrecho.length);
    const termos = (r.quando ?? []).map(semAcento);
    if (termos.every((t) => alvo.includes(t))) return r.texto;
  }
  if (typeof arquivo.padrao === 'string') return arquivo.padrao;
  throw new StubSemRespostaError(`nenhuma regra da tarefa "${tarefa}" casou com o pedido e ela não tem padrão`);
}

@Injectable()
export class StubProvider implements LlmProvider {
  readonly name = 'stub';
  readonly model = MODELO_DO_STUB;
  readonly supportsTools = false;
  private readonly log = new Logger('StubProvider');
  private cache: Map<string, ArquivoDoStub> | null = null;

  constructor(private readonly pasta: string | null = null) {}

  get configured(): boolean {
    return Boolean(this.pasta ?? pastaDoStub());
  }

  tetoDeSaida(chamada: ChamadaParaTeto): number {
    return chamada.maxTokens ?? 1;
  }

  private respostas(): Map<string, ArquivoDoStub> {
    if (this.cache) return this.cache;
    const pasta = this.pasta ?? pastaDoStub();
    if (!pasta) throw new StubSemRespostaError('a pasta homolog/fixtures/stub não foi encontrada (defina STUB_FIXTURES_DIR)');
    this.cache = carregarRespostasDoStub(pasta);
    this.log.log(`stub com ${this.cache.size} tarefa(s) de ${pasta}`);
    return this.cache;
  }

  async complete(input: LlmMessage): Promise<string> {
    const texto = responderPeloStub(this.respostas(), input);
    anotarProcedencia({ provider: this.name, modelo: MODELO_DO_STUB, custoUsd: 0, custoDesconhecido: false, caiuNoStub: false, aviso: null });
    return texto;
  }

  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    const ultimo = [...input.turns].reverse().find((t) => t.role === 'user');
    const user = ultimo && ultimo.role === 'user' ? ultimo.text : '';
    const text = responderPeloStub(this.respostas(), { system: input.system, user });
    return {
      text,
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, custoUsd: 0, custoEstimado: true, modeloServido: MODELO_DO_STUB },
      raw: null,
    };
  }
}
