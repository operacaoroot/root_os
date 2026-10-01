import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorType, ContextSource, PautaFamilia, PautaObjetivo, PrismaClient } from '@prisma/client';
import { bytesUtf8 } from '@mktos/shared';
import { comContexto } from '../src/common/contexto-execucao';
import { EventLogService } from '../src/gateway/event-log.service';
import { MemoriaService } from '../src/memory/memoria.service';
import {
  FalhaDeEmbedding,
  LIMITES_DE_EMBEDDING,
  cortarParaEmbedding,
  mesclarComTextuais,
  montarLotes,
  vetoresDaResposta,
  vetorizarEmLotes,
} from '../src/obsidian/embeddings-lotes';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import { PautaService } from '../src/pauta/pauta.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * P1b — LOTES, PROJEÇÃO E BUSCA QUANDO A VETORIZAÇÃO FALHA OU NÃO COBRE TUDO.
 *
 * O que estes casos provam, em fixture e nunca contra o fornecedor real:
 *   1. a reindexação de 399 notas sai em pedidos com teto de textos e de bytes;
 *   2. o fornecedor fora do ar, ou um lote que falha no meio, não impede a vault
 *      de chegar à memória, e o recibo não diz que deu tudo certo;
 *   3. a busca da vault, a da memória e a do acervo da pauta acham o texto
 *      quando falta vetor (cobertura zero ou parcial) ou o fornecedor falha.
 *
 * NENHUM CASO CHAMA O FORNECEDOR. O `fetch` é trocado por um dublê que lê o
 * pedido como o fornecedor leria e responde vetores inventados. O dublê mede em
 * BYTES os limites que o fornecedor documenta em tokens (8.192 por entrada,
 * 2.048 entradas e 300.000 somados por pedido) e recusa o que passa deles. Com
 * mais bytes que o limite, o pedido PODE passar do limite de tokens (quanto,
 * depende do texto, e isso não foi medido aqui); com menos, não pode, porque o
 * tokenizador do modelo nunca produz mais tokens que bytes. É por isso que a
 * recusa do dublê prova a falta de teto, e não uma contagem de tokens.
 *
 * A seção final roda contra Postgres com pgvector (`TEST_DATABASE_URL`, banco
 * descartável) para conferir o SQL de verdade: filtro de empresa, filtros do
 * acervo, nota arquivada e a ausência de versão espúria na memória.
 */

const CHAVE = 'sk-teste-nao-e-chave';
const ORG = 'org-da-casa';
const VIZINHA = 'org-vizinha';
const MTIME = new Date('2026-09-30T12:00:00Z');
const VARIAVEIS = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OBSIDIAN_FONTE', 'OBSIDIAN_VAULT_PATH'] as const;
const LIMITE_DOCUMENTADO = { entradas: 2_048, porEntrada: 8_192, porPedido: 300_000 };
const FRASE = 'régua de cobrança';

const soma = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

/** O mesmo texto dá sempre o mesmo vetor; textos diferentes dão vetores diferentes. */
function vetorDoTexto(texto: string, dimensao = 3): number[] {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619) >>> 0;
  return Array.from({ length: dimensao }, (_, i) => Math.round(Math.sin(h * 1e-6 + i * 0.37) * 1e6) / 1e6);
}

type Plano = number | 'rede' | 'pendurar' | null;

interface PedidoVisto {
  textos: string[];
  bytes: number;
  maior: number;
}

function dubleDoFornecedor(dimensao = 3, plano: (n: number, textos: string[]) => Plano = () => null) {
  const pedidos: PedidoVisto[] = [];
  const buscar = async (
    entrada: Parameters<typeof fetch>[0],
    opcoes?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const pedido = new Request(entrada, opcoes);
    const textos = ((await pedido.json()) as { input: string[] }).input;
    const tamanhos = textos.map((t) => bytesUtf8(t));
    const n = pedidos.push({ textos, bytes: soma(tamanhos), maior: Math.max(0, ...tamanhos) });
    const decidido = plano(n, textos);
    if (decidido === 'rede') throw new TypeError('fetch failed');
    if (decidido === 'pendurar') {
      return new Promise<Response>((_, rejeitar) =>
        pedido.signal.addEventListener('abort', () => rejeitar(pedido.signal.reason)),
      );
    }
    if (typeof decidido === 'number') return json({ error: { message: 'falha programada no dublê' } }, decidido);
    const recusa =
      textos.length > LIMITE_DOCUMENTADO.entradas
        ? 'mais de 2.048 entradas'
        : textos.some((t) => !t)
          ? 'entrada vazia'
          : tamanhos.some((b) => b > LIMITE_DOCUMENTADO.porEntrada)
            ? 'entrada com mais de 8.192 bytes: pode passar de 8.192 tokens'
            : soma(tamanhos) > LIMITE_DOCUMENTADO.porPedido
              ? 'pedido com mais de 300.000 bytes: pode passar de 300.000 tokens'
              : null;
    if (recusa) return json({ error: { message: recusa } }, 400);
    return json({
      object: 'list',
      data: textos.map((t, index) => ({ object: 'embedding', index, embedding: vetorDoTexto(t, dimensao) })),
    });
  };
  return { pedidos, buscar };
}

function montarObsidian(memoria: object = {}, prisma: object = {}): ObsidianService {
  const svc = new ObsidianService(prisma as never, {} as never, {} as never, memoria as never);
  vi.spyOn(svc['log'], 'log').mockImplementation(() => undefined);
  return svc;
}

function montarPauta(prisma: object = {}): PautaService {
  const svc = new PautaService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  vi.spyOn(svc['log'], 'log').mockImplementation(() => undefined);
  return svc;
}

/** Os avisos que o serviço escreveu no log, para provar que a falha não ficou calada. */
function avisosDe(svc: ObsidianService | PautaService): () => string[] {
  const log = (svc as unknown as { log: { warn: (mensagem: string) => void } }).log;
  const espiao = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
  return () => espiao.mock.calls.map((c) => String(c[0]));
}

const salvas: Partial<Record<(typeof VARIAVEIS)[number], string>> = {};
const vaults: string[] = [];

beforeEach(() => {
  for (const v of VARIAVEIS) {
    salvas[v] = process.env[v];
    delete process.env[v];
  }
  process.env.OPENAI_API_KEY = CHAVE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const v of VARIAVEIS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v];
  }
  for (const v of vaults.splice(0)) rmSync(v, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures da vault
// ---------------------------------------------------------------------------

const PALAVRAS = [
  'régua', 'cobrança', 'precificação', 'margem', 'contrato', 'ação', 'operação', 'imposto',
  'conciliação', 'fluxo', 'caixa', 'cliente', 'prazo', 'nota', 'fiscal', 'serviço', 'decisão',
];

function prosa(semente: number, caracteres: number): string {
  let s = '';
  let x = semente + 1;
  while (s.length < caracteres) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    s += `${PALAVRAS[x % PALAVRAS.length]} `;
  }
  return s.slice(0, caracteres);
}

function criarVault(notas: Array<{ caminho: string; texto: string }>): string {
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'vault-resiliencia-'));
  vaults.push(raiz);
  for (const n of notas) {
    const arquivo = path.join(raiz, n.caminho);
    mkdirSync(path.dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, n.texto);
    utimesSync(arquivo, MTIME, MTIME);
  }
  process.env.OBSIDIAN_VAULT_PATH = raiz;
  return raiz;
}

/**
 * 399 notas, como o índice medido em produção em 01/10/2026 (P0 e V1 da ROOT-05):
 * média perto de 4.441 caracteres, mais três que testam o corte — uma de emoji,
 * uma de escrita CJK e uma de 1 MB.
 */
function notasComoAsDeProducao(): Array<{ caminho: string; texto: string }> {
  const notas = Array.from({ length: 396 }, (_, i) => ({
    caminho: `pasta-${i % 7}/nota-${i}.md`,
    texto: `# Nota ${i}\n\n${prosa(i, 3_800 + ((i * 37) % 1_300))}`,
  }));
  notas.push({ caminho: 'unicode/emoji.md', texto: `# Emoji\n\n${'🙂'.repeat(5_000)}` });
  notas.push({ caminho: 'unicode/cjk.md', texto: `# 漢字\n\n${'漢字'.repeat(3_000)}` });
  notas.push({ caminho: 'grande.md', texto: `# Grande\n\n${prosa(999, 1_000_000)}` });
  return notas;
}

/** Notas ASCII de tamanho fixo: com ~7.900 bytes, cabem exatamente 25 por pedido. */
function notasDeTamanhoFixo(n: number, bytes = 7_900): Array<{ caminho: string; texto: string }> {
  return Array.from({ length: n }, (_, i) => ({
    caminho: `fixa-${String(i).padStart(3, '0')}.md`,
    texto: `# Fixa ${i}\n\n${'x'.repeat(bytes)}`,
  }));
}

/** O índice (`KnowledgeNote`) em memória, com o vetor guardado como o Postgres devolve em texto. */
function indiceEmMemoria() {
  type Linha = Record<string, unknown> & { id: string; orgId: string; path: string; vetor: string | null };
  let linhas: Linha[] = [];
  let seq = 0;
  const prisma = {
    // Desde a ROOT-05c só a empresa da casa (slug `root`) reindexa; ORG faz esse papel aqui.
    org: {
      findFirst: async ({ where }: { where: { id: string; slug: string } }) =>
        where.id === ORG && where.slug === 'root' ? { id: ORG } : null,
    },
    knowledgeNote: {
      findMany: async ({ where }: { where: { orgId: string } }) =>
        linhas.filter((l) => l.orgId === where.orgId).map(({ vetor: _v, ...l }) => ({ ...l })),
      deleteMany: async ({ where }: { where: { orgId: string } }) => {
        const antes = linhas.length;
        linhas = linhas.filter((l) => l.orgId !== where.orgId);
        return { count: antes - linhas.length };
      },
      create: async ({ data }: { data: Record<string, unknown> & { orgId: string; path: string } }) => {
        const linha: Linha = { ...data, id: `kn-${++seq}`, vetor: null };
        linhas.push(linha);
        return linha;
      },
    },
    $queryRaw: async (_partes: TemplateStringsArray, orgId: string) =>
      linhas.filter((l) => l.orgId === orgId && l.vetor).map((l) => ({ path: l.path, vetor: l.vetor })),
    $executeRawUnsafe: async (_sql: string, vetor: string, id: string) => {
      const linha = linhas.find((l) => l.id === id);
      if (linha) linha.vetor = vetor;
      return linha ? 1 : 0;
    },
  };
  return {
    prisma,
    comVetor: () => linhas.filter((l) => l.vetor).length,
    vetorDe: (caminho: string) => linhas.find((l) => l.path === caminho)?.vetor ?? null,
  };
}

/** A memória vista pela reindexação: o que a projeção recebeu, e as pendentes. */
function memoriaDeMentira(pendentes: Array<{ id: string; title: string; body: string }> = []) {
  const projecoes: Array<Array<{ caminho: string; body: string; vetor: number[] | null }>> = [];
  const gravados: string[] = [];
  const servico = {
    projetarDaVault: async (
      _orgId: string,
      notas: Array<{ caminho: string; body: string; embedding?: number[] | null }>,
    ) => {
      projecoes.push(notas.map((n) => ({ caminho: n.caminho, body: n.body, vetor: n.embedding ?? null })));
      return { criadas: 0, alteradas: 0, inalteradas: notas.length, arquivadas: 0, falhas: 0, arquivamentoRecusado: 0 };
    },
    semVetor: async (_orgId: string, limite: number) =>
      pendentes.filter((p) => !gravados.includes(p.id)).slice(0, limite),
    gravarVetor: async (_orgId: string, id: string) => {
      gravados.push(id);
    },
  };
  return { servico, projecoes, gravados };
}

async function desfecho<T>(promessa: Promise<T>): Promise<{ ok: T } | { erro: string }> {
  return promessa.then(
    (ok) => ({ ok }),
    (e: unknown) => ({ erro: (e as Error).message }),
  );
}

// ===========================================================================
// 1. As regras puras: corte, lotes, política de falha e mescla
// ===========================================================================

describe('o corte de cada texto', () => {
  it('ASCII até 8.000 bytes passa inteiro; acima, corta em 8.000', () => {
    expect(cortarParaEmbedding('a'.repeat(8_000))).toHaveLength(8_000);
    expect(cortarParaEmbedding('a'.repeat(9_000))).toHaveLength(8_000);
  });

  it('acento conta 2 bytes, CJK 3 e emoji 4, e o corte nunca parte um caractere', () => {
    expect(bytesUtf8(cortarParaEmbedding('ç'.repeat(5_000)))).toBe(8_000);
    expect(bytesUtf8(cortarParaEmbedding('漢'.repeat(3_000)))).toBe(7_998);
    const emoji = cortarParaEmbedding('🙂'.repeat(5_000));
    expect(bytesUtf8(emoji)).toBe(8_000);
    expect(emoji).toBe('🙂'.repeat(2_000));
    expect(cortarParaEmbedding(`${'a'.repeat(7_999)}🙂`)).toBe('a'.repeat(7_999));
  });

  it('meio par substituto vira U+FFFD em vez de ir solto ao fornecedor', () => {
    expect(cortarParaEmbedding('x\uD83Dy\uDE42z')).toBe('x\uFFFDy\uFFFDz');
  });

  it('texto de 1 MB sai com no máximo 8.000 bytes', () => {
    expect(bytesUtf8(cortarParaEmbedding(prosa(1, 1_000_000)))).toBeLessThanOrEqual(8_000);
  });
});

describe('os lotes', () => {
  it('param em 100 textos ou 200.000 bytes, na ordem, e cada texto sai uma vez', () => {
    expect(montarLotes(Array(30).fill(8_000)).map((l) => l.length)).toEqual([25, 5]);
    expect(montarLotes(Array(250).fill(10)).map((l) => l.length)).toEqual([100, 100, 50]);
    expect(montarLotes([])).toEqual([]);
    const lotes = montarLotes([150_000, 60_000, 10, 199_999, 1]);
    expect(lotes).toEqual([[0], [1, 2], [3, 4]]);
  });

  it('os tetos ficam abaixo do que o fornecedor documenta', () => {
    expect(LIMITES_DE_EMBEDDING.bytesPorTexto).toBeLessThan(LIMITE_DOCUMENTADO.porEntrada);
    expect(LIMITES_DE_EMBEDDING.bytesPorPedido).toBeLessThan(LIMITE_DOCUMENTADO.porPedido);
    expect(LIMITES_DE_EMBEDDING.textosPorPedido).toBeLessThan(LIMITE_DOCUMENTADO.entradas);
  });
});

describe('a resposta do fornecedor é conferida antes de gravar', () => {
  it('a ordem vem do `index`, e sem ele vale a da lista', () => {
    expect(
      vetoresDaResposta({ data: [{ index: 1, embedding: [2, 2] }, { index: 0, embedding: [1, 1] }] }, 2),
    ).toEqual([[1, 1], [2, 2]]);
    expect(vetoresDaResposta({ data: [{ embedding: [1] }, { embedding: [2] }] }, 2)).toEqual([[1], [2]]);
  });

  it('quantidade errada, índice repetido, número inválido ou tamanho diferente é falha', () => {
    expect(() => vetoresDaResposta({ data: [{ embedding: [1] }] }, 2)).toThrow(FalhaDeEmbedding);
    expect(() => vetoresDaResposta({ data: [{ index: 0, embedding: [1] }, { index: 0, embedding: [2] }] }, 2)).toThrow(
      /índices/,
    );
    expect(() => vetoresDaResposta({ data: [{ embedding: [1, Number.NaN] }] }, 1)).toThrow(/inválido/);
    expect(() => vetoresDaResposta({ data: [{ embedding: [1, 2] }, { embedding: [1] }] }, 2)).toThrow(/tamanho/);
    expect(() => vetoresDaResposta(null, 1)).toThrow(/nenhum/);
  });
});

describe('a política de falha da vetorização em lotes', () => {
  const vetor = (t: string) => vetorDoTexto(t);

  it('lista vazia não faz pedido', async () => {
    const enviar = vi.fn(async (l: string[]) => l.map(vetor));
    const r = await vetorizarEmLotes([], enviar);
    expect(enviar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ textos: 0, vetorizados: 0, semVetor: 0, pedidos: 0, motivo: null });
  });

  it('falha do fornecedor para a chamada: os lotes seguintes nem saem', async () => {
    let n = 0;
    const enviar = vi.fn(async (l: string[]) => {
      if (++n === 2) throw new FalhaDeEmbedding('OpenAI embeddings HTTP 503', 503);
      return l.map(vetor);
    });
    const r = await vetorizarEmLotes(Array.from({ length: 250 }, (_, i) => `t${i}`), enviar);
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ textos: 250, vetorizados: 100, semVetor: 150, pedidos: 2, recusados: 0 });
    expect(r.motivo).toBe('OpenAI embeddings HTTP 503');
    expect(r.vetores.slice(0, 100).every(Boolean)).toBe(true);
    expect(r.vetores.slice(100).every((v) => v === null)).toBe(true);
  });

  it('um texto recusado é isolado pela bisseção e não prende os outros 99 nem os lotes seguintes', async () => {
    const textos = Array.from({ length: 150 }, (_, i) => `t${i}`);
    const enviar = vi.fn(async (l: string[]) => {
      if (l.includes('t42')) throw new FalhaDeEmbedding('OpenAI embeddings HTTP 400', 400);
      return l.map(vetor);
    });
    const r = await vetorizarEmLotes(textos, enviar);
    expect(r.vetores[42]).toBeNull();
    expect(r).toMatchObject({ vetorizados: 149, semVetor: 1, recusados: 8 });
    expect(r.vetores.filter((v, i) => i !== 42).every(Boolean)).toBe(true);
    expect(r.vetores[100]).toEqual(vetor('t100'));
  });

  it('recusa em tudo para na nona recusa, sem multiplicar pedidos', async () => {
    const enviar = vi.fn(async () => {
      throw new FalhaDeEmbedding('OpenAI embeddings HTTP 400', 400);
    });
    const r = await vetorizarEmLotes(Array.from({ length: 300 }, (_, i) => `t${i}`), enviar);
    expect(enviar).toHaveBeenCalledTimes(9);
    expect(r).toMatchObject({ vetorizados: 0, semVetor: 300, pedidos: 9, recusados: 9 });
  });

  it('gravação que falha para a chamada e o lote não conta como vetorizado', async () => {
    const enviar = vi.fn(async (l: string[]) => l.map(vetor));
    const gravar = vi.fn(async () => {
      throw new Error('conexão caiu');
    });
    const r = await vetorizarEmLotes(Array.from({ length: 150 }, (_, i) => `t${i}`), enviar, { gravar });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ vetorizados: 0, semVetor: 150 });
    expect(r.motivo).toMatch(/não foi gravado \(conexão caiu\)/);
  });

  it('texto em branco não é enviado e conta como sem vetor', async () => {
    const enviar = vi.fn(async (l: string[]) => l.map(vetor));
    const r = await vetorizarEmLotes(['um', '  \n ', 'dois'], enviar);
    expect(enviar.mock.calls[0][0]).toEqual(['um', 'dois']);
    expect(r).toMatchObject({ vetorizados: 2, semVetor: 1 });
    expect(r.motivo).toMatch(/em branco/);
  });
});

describe('a mescla do semântico com o textual', () => {
  const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);
  const de = (...xs: string[]) => xs.map((id) => ({ id }));

  it('sem textual (cobertura total) devolve o semântico de antes, intacto', () => {
    expect(ids(mesclarComTextuais(de('a', 'b', 'c'), [], 8))).toEqual(['a', 'b', 'c']);
    expect(ids(mesclarComTextuais(de('a', 'b', 'c'), [], 2))).toEqual(['a', 'b']);
  });

  it('alterna as vagas, começando pelo semântico, e põe o bloco semântico antes', () => {
    expect(ids(mesclarComTextuais(de('a', 'b', 'c', 'd'), de('x', 'y'), 5))).toEqual(['a', 'b', 'c', 'x', 'y']);
    expect(ids(mesclarComTextuais(de('a', 'b', 'c', 'd'), de('x', 'y', 'z'), 4))).toEqual(['a', 'b', 'x', 'y']);
    expect(ids(mesclarComTextuais(de('a'), de('x', 'y', 'z'), 3))).toEqual(['a', 'x', 'y']);
    expect(ids(mesclarComTextuais(de('a', 'b'), de('x'), 1))).toEqual(['a']);
  });

  it('o mesmo id nunca sai duas vezes', () => {
    expect(ids(mesclarComTextuais(de('a', 'b'), de('b', 'x', 'x'), 8))).toEqual(['a', 'b', 'x']);
  });
});

// ===========================================================================
// 2. A reindexação da vault com o fornecedor simulado
// ===========================================================================

describe('reindexar 399 notas sem pedido de embedding ilimitado', () => {
  it('a vault inteira sem vetor vira pedidos de até 100 textos e 200.000 bytes, e cada nota recebe o próprio vetor', async () => {
    criarVault(notasComoAsDeProducao());
    const indice = indiceEmMemoria();
    const memoria = memoriaDeMentira();
    const fornecedor = dubleDoFornecedor();
    vi.stubGlobal('fetch', fornecedor.buscar);
    const svc = montarObsidian(memoria.servico, indice.prisma);

    const resultado = await desfecho(svc.reindex(ORG));

    expect({
      resultado,
      pedidosAcimaDoTeto: fornecedor.pedidos
        .filter((p) => p.textos.length > 100 || p.bytes > 200_000 || p.maior > 8_000)
        .map((p) => ({ textos: p.textos.length, bytes: p.bytes, maiorTexto: p.maior })),
    }).toEqual({ resultado: { ok: 399 }, pedidosAcimaDoTeto: [] });
    const enviados = fornecedor.pedidos.flatMap((p) => p.textos);
    expect(enviados).toHaveLength(399);
    expect(fornecedor.pedidos.length).toBeGreaterThanOrEqual(Math.ceil(soma(enviados.map(bytesUtf8)) / 200_000));
    expect(indice.comVetor()).toBe(399);
    expect(memoria.projecoes).toHaveLength(1);
    expect(memoria.projecoes[0].filter((n) => n.vetor)).toHaveLength(399);
    // O vetor de cada nota é o do texto dela, mesmo depois de 9+ lotes.
    for (const nota of memoria.projecoes[0]) {
      const titulo = nota.body.match(/^#\s+(.+)$/m)?.[1] ?? '';
      expect(nota.vetor, nota.caminho).toEqual(vetorDoTexto(cortarParaEmbedding(`${titulo}\n\n${nota.body}`)));
    }
  });
});

describe('a projeção na memória quando a vetorização falha', () => {
  it('fornecedor fora do ar: a vault chega à memória sem vetor, e a reindexação não diz que deu certo', async () => {
    criarVault(notasDeTamanhoFixo(5, 100));
    const indice = indiceEmMemoria();
    const memoria = memoriaDeMentira();
    const fornecedor = dubleDoFornecedor(3, () => 503);
    vi.stubGlobal('fetch', fornecedor.buscar);
    const svc = montarObsidian(memoria.servico, indice.prisma);
    const avisos = avisosDe(svc);

    const resultado = await desfecho(svc.reindex(ORG));

    expect({
      projecoes: memoria.projecoes.map((p) => ({ notas: p.length, comVetor: p.filter((n) => n.vetor).length })),
      pedidos: fornecedor.pedidos.length,
      vetoresGravados: indice.comVetor(),
    }).toEqual({ projecoes: [{ notas: 5, comVetor: 0 }], pedidos: 1, vetoresGravados: 0 });
    expect(resultado).toEqual({ erro: expect.stringMatching(/0 de 5 .*HTTP 503.*busca textual/s) });
    expect(avisos().join('\n')).toMatch(/0 de 5/);
  });

  it('um lote falha no meio: o que chegou é gravado e projetado, o resto fica para a próxima volta', async () => {
    criarVault(notasDeTamanhoFixo(60));
    const indice = indiceEmMemoria();
    const memoria = memoriaDeMentira();
    const fornecedor = dubleDoFornecedor(3, (n) => (n === 2 ? 500 : null));
    vi.stubGlobal('fetch', fornecedor.buscar);
    const svc = montarObsidian(memoria.servico, indice.prisma);
    avisosDe(svc);

    const resultado = await desfecho(svc.reindex(ORG));

    expect({
      pedidos: fornecedor.pedidos.map((p) => p.textos.length),
      projecoes: memoria.projecoes.map((p) => ({ notas: p.length, comVetor: p.filter((n) => n.vetor).length })),
      vetoresGravados: indice.comVetor(),
    }).toEqual({ pedidos: [25, 25], projecoes: [{ notas: 60, comVetor: 25 }], vetoresGravados: 25 });
    expect(resultado).toEqual({ erro: expect.stringMatching(/25 de 60 .*HTTP 500/s) });
  });

  it('a volta seguinte pede só o que faltou, e a terceira não pede nada nem muda o que vai à memória', async () => {
    criarVault(notasDeTamanhoFixo(60));
    const indice = indiceEmMemoria();
    const memoria = memoriaDeMentira();
    let foraDoAr = true;
    const fornecedor = dubleDoFornecedor(3, (n) => (foraDoAr && n === 2 ? 500 : null));
    vi.stubGlobal('fetch', fornecedor.buscar);
    const svc = montarObsidian(memoria.servico, indice.prisma);
    avisosDe(svc);

    const primeira = await desfecho(svc.reindex(ORG));
    const pagosNaPrimeira = new Set(fornecedor.pedidos[0]?.textos ?? []);
    foraDoAr = false;
    const pedidosAntes = fornecedor.pedidos.length;
    const segunda = await desfecho(svc.reindex(ORG));
    const daSegunda = fornecedor.pedidos.slice(pedidosAntes);
    const pedidosAntesDaTerceira = fornecedor.pedidos.length;
    const terceira = await desfecho(svc.reindex(ORG));

    expect({
      primeira: 'erro' in primeira,
      segunda,
      terceira,
      textosNaSegunda: daSegunda.flatMap((p) => p.textos).length,
      repetidosNaSegunda: daSegunda.flatMap((p) => p.textos).filter((t) => pagosNaPrimeira.has(t)).length,
      pedidosNaTerceira: fornecedor.pedidos.length - pedidosAntesDaTerceira,
      vetoresGravados: indice.comVetor(),
    }).toEqual({
      primeira: true,
      segunda: { ok: 60 },
      terceira: { ok: 60 },
      textosNaSegunda: 35,
      repetidosNaSegunda: 0,
      pedidosNaTerceira: 0,
      vetoresGravados: 60,
    });
    const [, segundaProjecao, terceiraProjecao] = memoria.projecoes;
    expect(segundaProjecao.every((n) => n.vetor)).toBe(true);
    expect(terceiraProjecao).toEqual(segundaProjecao);
  });

  it('sem chave de embedding nada é pedido, a projeção roda e a volta termina como antes', async () => {
    delete process.env.OPENAI_API_KEY;
    criarVault(notasDeTamanhoFixo(3, 50));
    const indice = indiceEmMemoria();
    const memoria = memoriaDeMentira();
    const fornecedor = dubleDoFornecedor();
    vi.stubGlobal('fetch', fornecedor.buscar);
    const svc = montarObsidian(memoria.servico, indice.prisma);

    await expect(svc.reindex(ORG)).resolves.toBe(3);
    expect(fornecedor.pedidos).toHaveLength(0);
    expect(memoria.projecoes).toHaveLength(1);
  });
});

describe('as notas pendentes da memória em lotes', () => {
  const pendentes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `ctx-${i}`, title: `Pendente ${i}`, body: 'y'.repeat(7_000) }));

  it('100 notas de 7 kB não viram um pedido de 700 kB', async () => {
    const memoria = memoriaDeMentira(pendentes(100));
    const fornecedor = dubleDoFornecedor();
    vi.stubGlobal('fetch', fornecedor.buscar);
    const svc = montarObsidian(memoria.servico);

    const resultado = await desfecho(svc.vetorizarPendentesDaMemoria(ORG));

    expect({
      resultado,
      pedidos: fornecedor.pedidos.map((p) => p.textos.length),
      gravados: memoria.gravados.length,
    }).toEqual({ resultado: { ok: undefined }, pedidos: [28, 28, 28, 16], gravados: 100 });
    expect(Math.max(...fornecedor.pedidos.map((p) => p.bytes))).toBeLessThanOrEqual(200_000);

    await svc.vetorizarPendentesDaMemoria(ORG);
    expect(fornecedor.pedidos).toHaveLength(4);
  });

  it('falha no segundo lote: o primeiro fica gravado e a chamada avisa quantas faltaram', async () => {
    const memoria = memoriaDeMentira(pendentes(100));
    const fornecedor = dubleDoFornecedor(3, (n) => (n === 2 ? 503 : null));
    vi.stubGlobal('fetch', fornecedor.buscar);
    const svc = montarObsidian(memoria.servico);

    const resultado = await desfecho(svc.vetorizarPendentesDaMemoria(ORG));

    expect({ gravados: memoria.gravados.length, pedidos: fornecedor.pedidos.length }).toEqual({ gravados: 28, pedidos: 2 });
    expect(resultado).toEqual({ erro: expect.stringMatching(/28 de 100 .*HTTP 503/s) });
  });
});

// ===========================================================================
// 3. A busca quando falta vetor ou o fornecedor falha
// ===========================================================================

interface NotaDoIndice {
  id: string;
  orgId: string;
  title: string;
  content: string;
  vetor: boolean;
}

/** O índice como a busca o lê: KNN só sobre linha com vetor; ILIKE sobre título e conteúdo. */
function indiceParaBusca(notas: NotaDoIndice[]) {
  const linha = (n: NotaDoIndice, score: number) => ({
    id: n.id, path: `${n.id}.md`, folder: null, title: n.title, tags: [], links: [], wordCount: 3,
    fileTime: MTIME, content: n.content, score,
  });
  return {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      const daEmpresa = notas.filter((n) => n.orgId === params[1]);
      const limite = Number(params[2]);
      if (sql.includes('ORDER BY embedding <=>')) {
        return daEmpresa.filter((n) => n.vetor).slice(0, limite).map((n) => linha(n, 0.9));
      }
      const termo = String(params[0]).replace(/^%|%$/g, '').toLowerCase();
      const soSemVetor = sql.includes('embedding IS NULL');
      return daEmpresa
        .filter((n) => `${n.title}\n${n.content}`.toLowerCase().includes(termo) && (!soSemVetor || !n.vetor))
        .slice(0, limite)
        .map((n) => linha(n, 0));
    },
  };
}

describe('a busca da vault (índice) com cobertura de vetor zero, parcial e total', () => {
  const comFrase = (id: string, orgId: string, vetor: boolean): NotaDoIndice => ({
    id, orgId, title: 'Cobrança', content: `A ${FRASE} começa em D+3.`, vetor,
  });
  const qualquer = (id: string, vetor: boolean): NotaDoIndice => ({
    id, orgId: ORG, title: `Nota ${id}`, content: 'margem e prazo', vetor,
  });

  it('cobertura zero: acha pelo texto em vez de responder vazio', async () => {
    vi.stubGlobal('fetch', dubleDoFornecedor().buscar);
    const svc = montarObsidian({}, indiceParaBusca([qualquer('n1', false), comFrase('n2', ORG, false), qualquer('n3', false)]));

    const r = await svc.search(ORG, FRASE, 8);

    expect({ mode: r.mode, ids: r.items.map((i) => i.id) }).toEqual({ mode: 'keyword', ids: ['n2'] });
  });

  it('cobertura parcial: a nota sem vetor que tem o texto entra, depois das semânticas, sem repetir', async () => {
    vi.stubGlobal('fetch', dubleDoFornecedor().buscar);
    const svc = montarObsidian(
      {},
      indiceParaBusca([qualquer('n1', true), qualquer('n2', true), qualquer('n3', true), comFrase('n4', ORG, false)]),
    );

    const r = await svc.search(ORG, FRASE, 8);

    expect({ mode: r.mode, ids: r.items.map((i) => i.id), scores: r.items.map((i) => i.score) }).toEqual({
      mode: 'semantic',
      ids: ['n1', 'n2', 'n3', 'n4'],
      scores: [0.9, 0.9, 0.9, 0],
    });
  });

  it('cobertura total: o resultado é o semântico de antes, sem nada a mais', async () => {
    vi.stubGlobal('fetch', dubleDoFornecedor().buscar);
    const svc = montarObsidian({}, indiceParaBusca([qualquer('n1', true), comFrase('n2', ORG, true)]));

    const r = await svc.search(ORG, FRASE, 8);

    expect({ mode: r.mode, ids: r.items.map((i) => i.id) }).toEqual({ mode: 'semantic', ids: ['n1', 'n2'] });
  });

  it('fornecedor fora do ar: cai para o texto', async () => {
    vi.stubGlobal('fetch', dubleDoFornecedor(3, () => 503).buscar);
    const svc = montarObsidian({}, indiceParaBusca([qualquer('n1', true), comFrase('n2', ORG, false)]));
    avisosDe(svc);

    const r = await svc.search(ORG, FRASE, 8);

    expect({ mode: r.mode, ids: r.items.map((i) => i.id) }).toEqual({ mode: 'keyword', ids: ['n2'] });
  });

  it('fornecedor pendurado: o vetor da pergunta tem prazo, e a busca segue pelo texto', async () => {
    vi.stubGlobal('fetch', dubleDoFornecedor(3, () => 'pendurar').buscar);
    const svc = montarObsidian({}, indiceParaBusca([comFrase('n2', ORG, false)]));
    avisosDe(svc);

    await expect(svc['embed'](['pergunta'], 25)).rejects.toThrow(FalhaDeEmbedding);
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const r = await svc.search(ORG, FRASE, 8);
    expect({ mode: r.mode, ids: r.items.map((i) => i.id) }).toEqual({ mode: 'keyword', ids: ['n2'] });
  }, 3_000);

  it('a nota da vizinha, com ou sem vetor, nunca aparece', async () => {
    vi.stubGlobal('fetch', dubleDoFornecedor().buscar);
    const notas = [qualquer('n1', true), comFrase('v1', VIZINHA, false), comFrase('v2', VIZINHA, true)];
    const svc = montarObsidian({}, indiceParaBusca(notas));

    const parcial = await svc.search(ORG, FRASE, 8);
    const zero = await montarObsidian({}, indiceParaBusca(notas.filter((n) => n.id !== 'n1'))).search(ORG, FRASE, 8);

    expect(parcial.items.map((i) => i.id)).toEqual(['n1']);
    expect(zero.items).toEqual([]);
  });
});

interface ItemDaMemoria {
  id: string;
  orgId: string;
  title: string;
  body: string;
  vetor: boolean;
}

/** A memória como `buscar` a lê: mesmas três consultas, KNN só sobre linha com vetor. */
function memoriaParaBusca(itens: ItemDaMemoria[]) {
  const linha = (i: ItemDaMemoria, score: number) => ({
    id: i.id, chave: `vault:${i.id}.md`, kind: 'nota', title: i.title, body: i.body, tags: [],
    sourceType: 'vault', sourceRef: `${i.id}.md`, validFrom: null, validUntil: null, supersedesId: null,
    confidence: 1, contentHash: 'h', versao: 1, arquivadoEm: null, criadoEm: MTIME, atualizadoEm: MTIME,
    temVetor: i.vetor, score,
  });
  return {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      const daEmpresa = itens.filter((i) => i.orgId === params[1]);
      const limite = Number(params[2]);
      if (sql.includes('ORDER BY embedding <=>')) {
        return daEmpresa.filter((i) => i.vetor).slice(0, limite).map((i) => linha(i, 0.8));
      }
      const termo = String(params[0]).replace(/^%|%$/g, '').toLowerCase();
      const soSemVetor = sql.includes('embedding IS NULL');
      return daEmpresa
        .filter((i) => `${i.title}\n${i.body}`.toLowerCase().includes(termo) && (!soSemVetor || !i.vetor))
        .slice(0, limite)
        .map((i) => linha(i, 0));
    },
  };
}

describe('a busca da memória com o vetor da pergunta', () => {
  const montar = (itens: ItemDaMemoria[]) => new MemoriaService(memoriaParaBusca(itens) as never, {} as never);
  const comFrase = (id: string, vetor: boolean, orgId = ORG): ItemDaMemoria => ({
    id, orgId, title: 'Cobrança', body: `A ${FRASE} começa em D+3.`, vetor,
  });
  const qualquer = (id: string, vetor: boolean): ItemDaMemoria => ({ id, orgId: ORG, title: 'Preço', body: 'margem', vetor });

  it('cobertura zero: acha pelo texto', async () => {
    const r = await montar([qualquer('m1', false), comFrase('m2', false)]).buscar(ORG, FRASE, 8, vetorDoTexto(FRASE));
    expect({ modo: r.modo, ids: r.itens.map((i) => i.id) }).toEqual({ modo: 'textual', ids: ['m2'] });
  });

  it('cobertura parcial: a nota sem vetor entra depois das semânticas, sem a da vizinha', async () => {
    const r = await montar([qualquer('m1', true), comFrase('m2', false), comFrase('v1', false, VIZINHA)]).buscar(
      ORG,
      FRASE,
      8,
      vetorDoTexto(FRASE),
    );
    expect({ modo: r.modo, ids: r.itens.map((i) => i.id), temVetor: r.itens.map((i) => i.temVetor) }).toEqual({
      modo: 'semantica',
      ids: ['m1', 'm2'],
      temVetor: [true, false],
    });
  });

  it('sem o vetor da pergunta continua textual, como a tela usa', async () => {
    const r = await montar([qualquer('m1', true), comFrase('m2', false)]).buscar(ORG, FRASE, 8);
    expect({ modo: r.modo, ids: r.itens.map((i) => i.id) }).toEqual({ modo: 'textual', ids: ['m2'] });
  });
});

type Ficha = Record<string, unknown> & {
  id: string;
  orgId: string;
  titulo: string;
  familia: string;
  objetivo: string;
  campea: boolean;
  vetor: string | null;
  criadaEm: Date;
};

function ficha(id: string, orgId: string, titulo: string, vetor: boolean, familia = 'CUR'): Ficha {
  return {
    id, orgId, titulo, familia, objetivo: 'ALC', campea: false, vetor: vetor ? '[1,2,3]' : null,
    plataforma: null, autor: null, url: null, publicadoEm: null, materiaPrima: `matéria de ${titulo}`,
    tensaoCentral: 't', emocaoAlvo: 'e', motorPsicologico: 'm', formulaHeadline: 'f', estruturaCorpo: 'c',
    prova: 'p', cta: null, preRequisitos: null, antiPadroes: null, teoriaImplicita: null, metricas: null,
    tags: [], origem: 'manual', vaultPath: null, criadaEm: MTIME, atualizadaEm: MTIME,
  };
}

/** O acervo da pauta em memória: o `where` do Prisma que o serviço monta, avaliado aqui. */
function acervoEmMemoria(fichas: Ficha[]) {
  type Where = {
    orgId?: string;
    familia?: string;
    objetivo?: string;
    campea?: boolean;
    id?: { in: string[] };
    OR?: Array<Record<string, { contains: string }>>;
  };
  const casa = (f: Ficha, where: Where = {}): boolean =>
    (!where.orgId || f.orgId === where.orgId) &&
    (!where.familia || f.familia === where.familia) &&
    (!where.objetivo || f.objetivo === where.objetivo) &&
    (where.campea === undefined || f.campea === where.campea) &&
    (!where.id || where.id.in.includes(f.id)) &&
    (!where.OR ||
      where.OR.some((c) =>
        Object.entries(c).some(([campo, cond]) =>
          String(f[campo] ?? '').toLowerCase().includes(cond.contains.toLowerCase()),
        ),
      ));
  const gravados: string[] = [];
  const prisma = {
    pautaReferencia: {
      findMany: async ({ where, take }: { where: Where; take?: number }) =>
        fichas.filter((f) => casa(f, where)).slice(0, take ?? fichas.length),
      count: async ({ where }: { where: Where }) => fichas.filter((f) => casa(f, where)).length,
      groupBy: async ({ by, where }: { by: string[]; where: Where }) => {
        const contagem = new Map<string, number>();
        for (const f of fichas.filter((x) => casa(x, where))) {
          const valor = String(f[by[0]]);
          contagem.set(valor, (contagem.get(valor) ?? 0) + 1);
        }
        return [...contagem].map(([valor, n]) => ({ [by[0]]: valor, _count: n }));
      },
      findUnique: async ({ where }: { where: { id: string } }) => fichas.find((f) => f.id === where.id) ?? null,
    },
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      if (sql.includes('ORDER BY embedding <=>')) {
        return fichas.filter((f) => f.orgId === params[1] && f.vetor).map((f) => ({ ...f, similaridade: 0.8 }));
      }
      if (sql.includes('embedding IS NULL')) {
        return fichas.filter((f) => f.orgId === params[0] && !f.vetor).map((f) => ({ id: f.id }));
      }
      throw new Error(`consulta que o dublê não conhece: ${sql}`);
    },
    $executeRawUnsafe: async (_sql: string, vetor: string, id: string) => {
      const f = fichas.find((x) => x.id === id);
      if (f) {
        f.vetor = vetor;
        gravados.push(id);
      }
      return f ? 1 : 0;
    },
  };
  return { prisma, gravados };
}

describe('a busca do acervo da pauta com cobertura de vetor zero e parcial', () => {
  it('cobertura zero: a ficha com o texto aparece, pela busca de texto', async () => {
    vi.stubGlobal('fetch', dubleDoFornecedor().buscar);
    const acervo = acervoEmMemoria([ficha('r1', ORG, 'Preço', false), ficha('r2', ORG, `A ${FRASE}`, false)]);
    const r = await montarPauta(acervo.prisma).listarReferencias(ORG, { q: FRASE });
    expect({ fonte: r.source.tool, ids: r.items.map((i) => i.id), total: r.total }).toEqual({
      fonte: 'banco-interno',
      ids: ['r2'],
      total: 1,
    });
  });

  it('cobertura parcial: a ficha sem vetor entra depois das semânticas, sem a da vizinha', async () => {
    vi.stubGlobal('fetch', dubleDoFornecedor().buscar);
    const acervo = acervoEmMemoria([
      ficha('r1', ORG, 'Preço', true),
      ficha('r2', ORG, `A ${FRASE}`, false),
      ficha('v1', VIZINHA, `A ${FRASE}`, false),
    ]);
    const r = await montarPauta(acervo.prisma).listarReferencias(ORG, { q: FRASE });
    expect({
      fonte: r.source.tool,
      ids: r.items.map((i) => i.id),
      similaridade: r.items.map((i) => i.similaridade),
      total: r.total,
    }).toEqual({ fonte: 'busca-semantica', ids: ['r1', 'r2'], similaridade: [0.8, undefined], total: 2 });
  });
});

describe('a reposição do acervo da pauta não declara o que não fez', () => {
  it('fornecedor fora do ar: nenhuma ficha conta como indexada, e a reposição para no primeiro pedido', async () => {
    const fornecedor = dubleDoFornecedor(3, () => 503);
    vi.stubGlobal('fetch', fornecedor.buscar);
    const acervo = acervoEmMemoria(Array.from({ length: 40 }, (_, i) => ficha(`r${i}`, ORG, `Ficha ${i}`, false)));
    const svc = montarPauta(acervo.prisma);
    avisosDe(svc);

    const r = await svc.reindexar(ORG);

    expect({ resposta: r, pedidos: fornecedor.pedidos.length, gravados: acervo.gravados.length }).toEqual({
      resposta: { indexadas: 0, falhas: 40, motivo: 'OpenAI embeddings HTTP 503' },
      pedidos: 1,
      gravados: 0,
    });
  });

  it('fornecedor em ordem: a contagem é a dos vetores gravados, e cada pedido respeita o teto', async () => {
    const fornecedor = dubleDoFornecedor();
    vi.stubGlobal('fetch', fornecedor.buscar);
    const acervo = acervoEmMemoria(Array.from({ length: 150 }, (_, i) => ficha(`r${i}`, ORG, `Ficha ${i}`, false)));

    const svc = montarPauta(acervo.prisma);
    const r = await svc.reindexar(ORG);

    expect(r).toEqual({ indexadas: 150, falhas: 0, motivo: null });
    expect(acervo.gravados).toHaveLength(150);
    expect(fornecedor.pedidos.every((p) => p.textos.length <= 100 && p.bytes <= 200_000)).toBe(true);

    const pedidos = fornecedor.pedidos.length;
    expect(await svc.reindexar(ORG)).toEqual({ indexadas: 0, falhas: 0, motivo: null });
    expect(fornecedor.pedidos).toHaveLength(pedidos);
  });
});

// ===========================================================================
// 4. Com banco descartável: o SQL de verdade
// ===========================================================================

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresas, índice da vault, memória e acervo da pauta)');

describe.skipIf(!URL)('com Postgres e pgvector: busca híbrida, filtros, empresa e versões', () => {
  const MARCA = `res_${randomUUID().slice(0, 8)}`;
  const A = `org-res-a-${MARCA}`;
  const B = `org-res-b-${MARCA}`;
  const DIM = 1536;
  let prisma: PrismaClient;
  let memoria: MemoriaService;

  const naEmpresa = <T>(orgId: string, fn: () => Promise<T>) =>
    comContexto(
      { orgId, actorType: ActorType.system, correlationId: `teste-${MARCA}`, origem: 'script' },
      fn,
    );
  const comoTexto = (v: number[]) => `[${v.join(',')}]`;

  async function limpar() {
    const orgId = { in: [A, B] };
    await prisma.contextItem.deleteMany({ where: { orgId } });
    await prisma.knowledgeNote.deleteMany({ where: { orgId } });
    await prisma.pautaReferencia.deleteMany({ where: { orgId } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [
      [A, `res-a-${MARCA}`],
      [B, `res-b-${MARCA}`],
    ] as const) {
      await prisma.org.upsert({ where: { id }, create: { id, name: `Empresa ${slug}`, slug }, update: {} });
    }
    memoria = new MemoriaService(prisma as unknown as PrismaService, new EventLogService(prisma as never));
  });

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpar();
  });

  async function notaNoIndice(orgId: string, nome: string, content: string, vetor: number[] | null) {
    const n = await prisma.knowledgeNote.create({
      data: { orgId, path: `${nome}.md`, folder: null, title: nome, tags: [], content, links: [], wordCount: 3, fileTime: MTIME },
    });
    if (vetor) {
      await prisma.$executeRawUnsafe('UPDATE "KnowledgeNote" SET embedding = $1::vector WHERE id = $2', comoTexto(vetor), n.id);
    }
    return n.id;
  }

  it('vault: semântico + texto sem vetor da própria empresa; cobertura zero cai para texto', async () => {
    vi.stubGlobal('fetch', dubleDoFornecedor(DIM).buscar);
    const a1 = await notaNoIndice(A, 'preco', 'margem e preço', vetorDoTexto('preço', DIM));
    const a2 = await notaNoIndice(A, 'contrato', 'cláusula de reajuste', vetorDoTexto('contrato', DIM));
    const a3 = await notaNoIndice(A, 'cobranca', `A ${FRASE} começa em D+3.`, null);
    const b1 = await notaNoIndice(B, 'cobranca-b', `A ${FRASE} da vizinha.`, null);
    const b2 = await notaNoIndice(B, 'perto-b', 'texto qualquer', vetorDoTexto(FRASE, DIM));
    const svc = montarObsidian({}, prisma);

    const parcial = await svc.search(A, FRASE, 8);
    await prisma.$executeRawUnsafe('UPDATE "KnowledgeNote" SET embedding = NULL WHERE "orgId" = $1', A);
    const zero = await svc.search(A, FRASE, 8);

    expect({ mode: parcial.mode, semanticas: new Set(parcial.items.slice(0, 2).map((i) => i.id)), resto: parcial.items.slice(2).map((i) => i.id) })
      .toEqual({ mode: 'semantic', semanticas: new Set([a1, a2]), resto: [a3] });
    expect({ mode: zero.mode, ids: zero.items.map((i) => i.id) }).toEqual({ mode: 'keyword', ids: [a3] });
    for (const r of [parcial, zero]) expect(r.items.filter((i) => i.id === b1 || i.id === b2)).toEqual([]);
  });

  it('memória: semântico + texto sem vetor, sem arquivada e sem a vizinha', async () => {
    const criar = (orgId: string, chave: string, title: string, body: string, vetor: number[] | null) =>
      naEmpresa(orgId, () =>
        memoria.criar(orgId, { chave, title, body, sourceType: ContextSource.operador, embedding: vetor }),
      );
    const m1 = await criar(A, 'res/preco', 'Preço', 'margem', vetorDoTexto('preço', DIM));
    const m2 = await criar(A, 'res/cobranca', 'Cobrança', `A ${FRASE} começa em D+3.`, null);
    const m3 = await criar(A, 'res/arquivada', 'Antiga', `A ${FRASE} de 2025.`, null);
    await naEmpresa(A, () => memoria.arquivar(A, m3.id, 'teste'));
    const b1 = await criar(B, 'res/cobranca', 'Cobrança B', `A ${FRASE} da vizinha.`, vetorDoTexto(FRASE, DIM));

    const r = await naEmpresa(A, () => memoria.buscar(A, FRASE, 10, vetorDoTexto(FRASE, DIM)));

    expect({ modo: r.modo, ids: r.itens.map((i) => i.id) }).toEqual({ modo: 'semantica', ids: [m1.id, m2.id] });
    expect(r.itens.map((i) => i.id)).not.toContain(b1.id);
  });

  it('acervo: os filtros valem nas duas metades, e a ficha da vizinha não entra', async () => {
    vi.stubGlobal('fetch', dubleDoFornecedor(DIM).buscar);
    const [F1, F2] = [PautaFamilia.CUR, PautaFamilia.REA];
    const criar = async (
      orgId: string,
      titulo: string,
      familia: PautaFamilia,
      vetor: number[] | null,
      campea = false,
    ) => {
      const r = await prisma.pautaReferencia.create({
        data: {
          orgId, titulo, familia, objetivo: PautaObjetivo.ALC, materiaPrima: titulo, tensaoCentral: 't',
          emocaoAlvo: 'e', motorPsicologico: 'm', formulaHeadline: 'f', estruturaCorpo: 'c', prova: 'p', campea,
        },
      });
      if (vetor) {
        await prisma.$executeRawUnsafe('UPDATE "PautaReferencia" SET embedding = $1::vector WHERE id = $2', comoTexto(vetor), r.id);
      }
      return r.id;
    };
    const r1 = await criar(A, 'Preço', F1, vetorDoTexto('preço', DIM), true);
    const r2 = await criar(A, 'Perto da pergunta', F2, vetorDoTexto(FRASE, DIM));
    const r3 = await criar(A, `A ${FRASE}`, F1, null, true);
    const r4 = await criar(A, `Outra ${FRASE}`, F2, null);
    const r5 = await criar(B, `A ${FRASE} da vizinha`, F1, null, true);
    const svc = montarPauta(prisma);
    const avisos = avisosDe(svc);

    const filtrada = await svc.listarReferencias(A, { q: FRASE, familia: F1 });
    const campeas = await svc.listarReferencias(A, { q: FRASE, campea: true });
    const semFiltro = await svc.listarReferencias(A, { q: FRASE });

    for (const r of [filtrada, campeas]) {
      expect({ fonte: r.source.tool, ids: r.items.map((i) => i.id) }).toEqual({
        fonte: 'busca-semantica',
        ids: [r1, r3],
      });
    }
    expect(semFiltro.items.map((i) => i.id).sort()).toEqual([r1, r2, r3, r4].sort());
    for (const r of [filtrada, campeas, semFiltro]) expect(r.items.map((i) => i.id)).not.toContain(r5);
    expect(avisos()).toEqual([]);
  });

  it('reindexação: fornecedor fora não segura a projeção, e as voltas seguintes não criam versão', async () => {
    criarVault(notasDeTamanhoFixo(6, 200));
    const vizinha = await naEmpresa(B, () =>
      memoria.criar(B, { chave: 'res/vizinha', title: 'Vizinha', body: 'nota da vizinha', sourceType: ContextSource.operador }),
    );
    let foraDoAr = true;
    const fornecedor = dubleDoFornecedor(DIM, () => (foraDoAr ? 503 : null));
    vi.stubGlobal('fetch', fornecedor.buscar);
    const svc = montarObsidian(memoria, prisma);
    /*
     * A empresa da casa tem o slug fixo `root`, único no banco, e as suítes rodam
     * em paralelo; A faz o papel da casa só nesta suíte. A guarda em si é medida
     * com o slug de verdade em `obsidian-reindex-tenant.test.ts`.
     */
    vi.spyOn(svc as unknown as { exigirEmpresaDaCasa(orgId: string): Promise<void> }, 'exigirEmpresaDaCasa')
      .mockImplementation(async (orgId) => {
        if (orgId !== A) throw new Error(`só ${A} faz o papel da casa nesta suíte`);
      });
    avisosDe(svc);
    const contar = async () => ({
      itens: await prisma.contextItem.count({ where: { orgId: A } }),
      versoes: await prisma.contextItemVersion.count({ where: { orgId: A } }),
      itensComVetor: await memoria.contarComVetor(A),
      notasComVetor: Number(
        (
          await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
            'SELECT count(*)::bigint AS n FROM "KnowledgeNote" WHERE "orgId" = $1 AND embedding IS NOT NULL',
            A,
          )
        )[0].n,
      ),
    });

    const primeira = await naEmpresa(A, () => desfecho(svc.reindex(A)));
    const depoisDaPrimeira = await contar();
    foraDoAr = false;
    const segunda = await naEmpresa(A, () => desfecho(svc.reindex(A)));
    const depoisDaSegunda = await contar();
    const pedidosAntes = fornecedor.pedidos.length;
    const terceira = await naEmpresa(A, () => desfecho(svc.reindex(A)));
    const depoisDaTerceira = await contar();

    expect({ primeira: 'erro' in primeira, depoisDaPrimeira }).toEqual({
      primeira: true,
      depoisDaPrimeira: { itens: 6, versoes: 6, itensComVetor: 0, notasComVetor: 0 },
    });
    expect({ segunda, depoisDaSegunda }).toEqual({
      segunda: { ok: 6 },
      depoisDaSegunda: { itens: 6, versoes: 6, itensComVetor: 6, notasComVetor: 6 },
    });
    expect({ terceira, depoisDaTerceira, pedidos: fornecedor.pedidos.length - pedidosAntes }).toEqual({
      terceira: { ok: 6 },
      depoisDaTerceira: { itens: 6, versoes: 6, itensComVetor: 6, notasComVetor: 6 },
      pedidos: 0,
    });
    expect(await prisma.contextItemVersion.count({ where: { itemId: vizinha.id } })).toBe(1);
    expect(await prisma.knowledgeNote.count({ where: { orgId: B } })).toBe(0);
  });
});
