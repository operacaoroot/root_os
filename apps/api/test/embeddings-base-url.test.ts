import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import { PautaService } from '../src/pauta/pauta.service';

/*
 * OPENAI_BASE_URL VAZIA NÃO PODE VIRAR ENDEREÇO VAZIO NOS EMBEDDINGS.
 *
 * O compose declara `OPENAI_BASE_URL: ${OPENAI_BASE_URL:-}`, que entrega STRING
 * VAZIA quando ninguém preenche, e `process.env.X ?? padrao` deixa o vazio
 * passar. Em produção isso virou `fetch('/embeddings')` e "Failed to parse URL
 * from /embeddings" em todas as passadas da reindexação, que refazia o índice e
 * parava ANTES de projetar a vault na memória (P1 da revisão da ROOT-02). É o
 * defeito que `src/llm/env.ts` já tinha consertado nos provedores (`env.test.ts`).
 *
 * NENHUM CASO DAQUI CHAMA A OPENAI. O transporte de mentira faz só o que o
 * `fetch` do Node faz antes de abrir conexão — `new Request(...)`, a leitura de
 * URL onde a falha de produção acontece — e responde vetores inventados. O único
 * pedido que sai do processo vai para um servidor descartável em 127.0.0.1,
 * aberto e fechado pelo próprio caso.
 */

const PADRAO = 'https://api.openai.com/v1/embeddings';
const CHAVE = 'sk-teste-nao-e-chave';
const ORG = 'org-da-casa';
const MTIME = new Date('2026-09-30T12:00:00Z');
const VARIAVEIS = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OBSIDIAN_FONTE', 'OBSIDIAN_VAULT_PATH'] as const;
const FETCH_DO_NODE = globalThis.fetch;

interface Pedido {
  url: string;
  autorizacao: string | null;
  modelo: string;
  textos: string[];
}

function vetoresDe(textos: string[]): Array<{ embedding: number[] }> {
  return textos.map((_, i) => ({ embedding: [i + 0.5, 0.25, 0.125] }));
}

function transporteDeMentira() {
  const pedidos: Pedido[] = [];
  const buscar = async (
    entrada: Parameters<typeof fetch>[0],
    opcoes?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const pedido = new Request(entrada, opcoes);
    if (new URL(pedido.url).hostname === '127.0.0.1') return FETCH_DO_NODE(pedido);
    const corpo = (await pedido.json()) as { model: string; input: string[] };
    pedidos.push({
      url: pedido.url,
      autorizacao: pedido.headers.get('authorization'),
      modelo: corpo.model,
      textos: corpo.input,
    });
    return new Response(JSON.stringify({ data: vetoresDe(corpo.input) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { pedidos, buscar };
}

async function servidorDescartavel() {
  const recebidos: Array<{ caminho: string; autorizacao: string | undefined; modelo: string; textos: string[] }> = [];
  const servidor = createServer((req, res) => {
    let bruto = '';
    req.setEncoding('utf8');
    req.on('data', (parte: string) => (bruto += parte));
    req.on('end', () => {
      const corpo = JSON.parse(bruto) as { model: string; input: string[] };
      recebidos.push({
        caminho: `${req.method} ${req.url}`,
        autorizacao: req.headers.authorization,
        modelo: corpo.model,
        textos: corpo.input,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: vetoresDe(corpo.input) }));
    });
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const { port } = servidor.address() as AddressInfo;
  return {
    recebidos,
    // Com a barra no fim, de propósito: o serviço a tira e não pede `//embeddings`.
    base: `http://127.0.0.1:${port}/v1/`,
    fechar: () =>
      new Promise<void>((pronto) => {
        servidor.closeAllConnections();
        servidor.close(() => pronto());
      }),
  };
}

function montarObsidian(memoria: object = {}, prisma: object = {}): ObsidianService {
  const svc = new ObsidianService(prisma as never, {} as never, {} as never, memoria as never);
  vi.spyOn(svc['log'], 'log').mockImplementation(() => undefined);
  return svc;
}

function montarPauta(prisma: object = {}): PautaService {
  return new PautaService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
}

let transporte: ReturnType<typeof transporteDeMentira>;
const salvas: Partial<Record<(typeof VARIAVEIS)[number], string>> = {};

beforeEach(() => {
  for (const v of VARIAVEIS) {
    salvas[v] = process.env[v];
    delete process.env[v];
  }
  process.env.OPENAI_API_KEY = CHAVE;
  transporte = transporteDeMentira();
  vi.stubGlobal('fetch', transporte.buscar);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const v of VARIAVEIS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v];
  }
});

type Embed = (textos: string[]) => Promise<number[][]>;

const SERVICOS: Array<{ nome: string; embedDe: () => Embed }> = [
  {
    nome: 'da vault (ObsidianService)',
    embedDe: () => {
      const svc = montarObsidian();
      return (textos) => svc['embed'](textos);
    },
  },
  {
    nome: 'do acervo da pauta (PautaService)',
    embedDe: () => {
      const svc = montarPauta();
      return (textos) => svc['embed'](textos);
    },
  },
];

for (const { nome, embedDe } of SERVICOS) {
  describe(`OPENAI_BASE_URL nos embeddings ${nome}`, () => {
    const daOpenAiPadrao = [
      { url: PADRAO, autorizacao: `Bearer ${CHAVE}`, modelo: 'text-embedding-3-small', textos: ['nota'] },
    ];

    it('vazia — o que o compose entrega — vai ao endereço padrão', async () => {
      process.env.OPENAI_BASE_URL = '';
      await expect(embedDe()(['nota'])).resolves.toEqual([[0.5, 0.25, 0.125]]);
      expect(transporte.pedidos).toEqual(daOpenAiPadrao);
    });

    it('só com espaço também vale como ausente', async () => {
      process.env.OPENAI_BASE_URL = '   ';
      await expect(embedDe()(['nota'])).resolves.toEqual([[0.5, 0.25, 0.125]]);
      expect(transporte.pedidos).toEqual(daOpenAiPadrao);
    });

    it('ausente vai ao endereço padrão', async () => {
      await expect(embedDe()(['nota'])).resolves.toEqual([[0.5, 0.25, 0.125]]);
      expect(transporte.pedidos).toEqual(daOpenAiPadrao);
    });

    it('explícita continua valendo, com a mesma chave e o mesmo modelo', async () => {
      const servidor = await servidorDescartavel();
      try {
        process.env.OPENAI_BASE_URL = servidor.base;
        await expect(embedDe()(['nota'])).resolves.toEqual([[0.5, 0.25, 0.125]]);
        expect(servidor.recebidos).toEqual([
          {
            caminho: 'POST /v1/embeddings',
            autorizacao: `Bearer ${CHAVE}`,
            modelo: 'text-embedding-3-small',
            textos: ['nota'],
          },
        ]);
        expect(transporte.pedidos).toEqual([]);
      } finally {
        await servidor.fechar();
      }
    });
  });
}

describe('a reindexação da vault com OPENAI_BASE_URL vazia', () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(path.join(os.tmpdir(), 'vault-embeddings-'));
    mkdirSync(path.join(vault, 'pasta'));
    writeFileSync(path.join(vault, 'antiga.md'), '# Antiga\n\nJá estava no índice, sem vetor.');
    writeFileSync(path.join(vault, 'pasta', 'nova.md'), '# Nova\n\nChegou depois da última projeção.');
    utimesSync(path.join(vault, 'antiga.md'), MTIME, MTIME);
    utimesSync(path.join(vault, 'pasta', 'nova.md'), MTIME, MTIME);
    process.env.OBSIDIAN_VAULT_PATH = vault;
  });

  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  /** O estado medido em produção: índice em dia e nenhum vetor guardado. */
  function indiceSemVetor() {
    let linhas: Array<Record<string, unknown> & { id: string; path: string }> = [
      {
        id: 'kn-antiga',
        orgId: ORG,
        path: 'antiga.md',
        folder: null,
        title: 'Antiga',
        tags: [],
        content: 'Já estava no índice, sem vetor.',
        links: [],
        wordCount: 6,
        fileTime: MTIME,
      },
    ];
    let seq = 0;
    const vetorizadas: string[] = [];
    const prisma = {
      knowledgeNote: {
        findMany: async () => linhas.map((l) => ({ ...l })),
        deleteMany: async () => {
          const count = linhas.length;
          linhas = [];
          return { count };
        },
        create: async ({ data }: { data: Record<string, unknown> & { path: string } }) => {
          const linha = { ...data, id: `kn-${++seq}` };
          linhas.push(linha);
          return linha;
        },
      },
      $queryRaw: async () => [],
      $executeRawUnsafe: async (_sql: string, _vetor: string, id: string) => {
        vetorizadas.push(id);
        return 1;
      },
    };
    return { prisma, vetorizadas, caminhos: () => linhas.map((l) => l.path).sort() };
  }

  function memoriaQueGrava() {
    const projecoes: Array<Array<{ caminho: string; comVetor: boolean }>> = [];
    const servico = {
      projetarDaVault: async (_orgId: string, notas: Array<{ caminho: string; embedding?: number[] | null }>) => {
        projecoes.push(
          notas
            .map((n) => ({ caminho: n.caminho, comVetor: Array.isArray(n.embedding) }))
            .sort((a, b) => a.caminho.localeCompare(b.caminho)),
        );
        return {
          criadas: notas.length,
          alteradas: 0,
          inalteradas: 0,
          arquivadas: 0,
          falhas: 0,
          arquivamentoRecusado: 0,
        };
      },
      semVetor: async () => [],
    };
    return { servico, projecoes };
  }

  it('vetoriza o índice e entrega a vault à memória, em vez de parar antes da projeção', async () => {
    process.env.OPENAI_BASE_URL = '';
    const banco = indiceSemVetor();
    const memoria = memoriaQueGrava();
    const svc = montarObsidian(memoria.servico, banco.prisma);

    const erro = await svc.reindex(ORG).then(
      () => null,
      (e: unknown) => e,
    );

    // O índice é refeito com ou sem a correção; a diferença é o que vem depois dele.
    expect(banco.caminhos()).toEqual(['antiga.md', 'pasta/nova.md']);
    expect(erro).toBeNull();
    expect(transporte.pedidos.map((p) => [p.url, p.textos.length])).toEqual([[PADRAO, 2]]);
    expect(banco.vetorizadas).toHaveLength(2);
    expect(memoria.projecoes).toEqual([
      [
        { caminho: 'antiga.md', comVetor: true },
        { caminho: 'pasta/nova.md', comVetor: true },
      ],
    ]);
  });
});

describe('a ficha da pauta com OPENAI_BASE_URL vazia', () => {
  it('ganha vetor, em vez de a falha virar só um aviso no log', async () => {
    process.env.OPENAI_BASE_URL = '';
    const gravados: Array<{ vetor: string; id: string }> = [];
    const svc = montarPauta({
      pautaReferencia: {
        findUnique: async () => ({
          id: 'ref-1',
          titulo: 'Título',
          materiaPrima: 'matéria',
          tensaoCentral: 'tensão',
          emocaoAlvo: 'emoção',
          motorPsicologico: 'motor',
          formulaHeadline: 'fórmula',
          estruturaCorpo: 'estrutura',
          prova: 'prova',
          teoriaImplicita: null,
        }),
      },
      $executeRawUnsafe: async (_sql: string, vetor: string, id: string) => {
        gravados.push({ vetor, id });
        return 1;
      },
    });
    const avisos = vi.spyOn(svc['log'], 'warn').mockImplementation(() => undefined);

    await svc.indexar('ref-1');

    expect(avisos.mock.calls).toEqual([]);
    expect(transporte.pedidos.map((p) => p.url)).toEqual([PADRAO]);
    expect(gravados).toEqual([{ vetor: '[0.5,0.25,0.125]', id: 'ref-1' }]);
  });
});
