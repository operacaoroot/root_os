import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorType, ContextSource, PrismaClient } from '@prisma/client';
import { comContexto } from '../src/common/contexto-execucao';
import { EventLogService } from '../src/gateway/event-log.service';
import { MemoriaService, type NotaDeContexto } from '../src/memory/memoria.service';
import { hashDoCorpo } from '../src/memory/procedencia';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ROOT-05c, V1 — O VETOR DE UMA NOTA DA MEMÓRIA É SEMPRE O DO CORPO QUE ELA TEM.
 *
 * O defeito (V1 da ROOT-05ab-REV, sondas S1 e S2): trocar o corpo sem mandar
 * vetor novo deixava o vetor do texto anterior na coluna, e `semVetor` nunca
 * mais listava a nota. Vetor velho não deixa marca, então o que esta suíte mede
 * é que ele não nasce por nenhuma das portas que escrevem corpo ou vetor:
 *
 *   · `alterar` (a tela e a projeção da vault) e `projetarCondicionado` (o guia
 *     de marca) esvaziam a coluna NA transação que troca o corpo — com rollback
 *     e com queda simulada logo depois do commit;
 *   · toda gravação de vetor que acontece depois da leitura — a fila do
 *     conector, o vetor da criação e o do índice na projeção — confere id,
 *     empresa e hash do corpo, e uma edição no meio do caminho vira zero linhas;
 *   · título, tags e o mesmo corpo com outro fim de linha guardam o vetor.
 *
 * Serviço real (`MemoriaService`, `ObsidianService.vetorizarPendentesDaMemoria`)
 * contra Postgres com pgvector e duas empresas. As falhas e as corridas são
 * injetadas por um invólucro em volta do cliente de verdade (`comTroca`), que só
 * troca o método nomeado e repassa o resto ao cliente. Nenhum caso chama
 * fornecedor: o `fetch` é um dublê e a URL do fornecedor aponta para uma porta
 * fechada em 127.0.0.1, para um `fetch` esquecido não sair da máquina.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresas, notas da memória e rastro)');

const DIM = 1536;
/** Prazo por caso e por gancho: a suíte inteira roda em paralelo no mesmo banco, e os 5 s e 10 s padrão não bastam sob carga. */
const TEMPO = 30_000;
const MARCA = `r05c_${randomUUID().slice(0, 8)}`;
const A = `org-vetor-a-${MARCA}`;
const B = `org-vetor-b-${MARCA}`;
const VARIAVEIS = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OBSIDIAN_FONTE', 'OBSIDIAN_VAULT_PATH'] as const;
const salvas: Partial<Record<(typeof VARIAVEIS)[number], string>> = {};

/** Valores k/1024, exatos em float4: o que volta do Postgres é o que foi gravado. */
function vetorDe(texto: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619) >>> 0;
  return Array.from({ length: DIM }, (_, i) => (((h >>> (i % 24)) + i * 7) % 997) / 1024);
}

function mesmo(a: number[] | null, b: number[]): boolean {
  return !!a && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
}

/** O mesmo objeto, com os métodos nomeados trocados e o resto ligado ao original. */
function comTroca<T extends object>(alvo: T, troca: Record<string, unknown>): T {
  return new Proxy(alvo, {
    get(t, prop) {
      if (typeof prop === 'string' && prop in troca) return troca[prop];
      const v = Reflect.get(t, prop, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

beforeEach(() => {
  for (const v of VARIAVEIS) {
    salvas[v] = process.env[v];
    delete process.env[v];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const v of VARIAVEIS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v];
  }
});

describe.skipIf(!URL)('V1: o vetor acompanha o corpo, com Postgres e duas empresas', () => {
  let prisma: PrismaClient;
  let memoria: MemoriaService;

  const naEmpresa = <T>(orgId: string, fn: () => Promise<T>) =>
    comContexto(
      { orgId, actorType: ActorType.user, actorId: 'operador-teste', correlationId: `r05c-${MARCA}`, origem: 'script' },
      fn,
    );

  const novaMemoria = (cliente: object, eventos = new EventLogService(prisma as never)) =>
    new MemoriaService(cliente as unknown as PrismaService, eventos);

  const criar = (orgId: string, nome: string, body: string, embedding: number[] | null, servico = memoria) =>
    naEmpresa(orgId, () =>
      servico.criar(orgId, {
        chave: `r05c/${MARCA}/${nome}`,
        title: `Nota ${nome}`,
        body,
        sourceType: ContextSource.operador,
        embedding,
      }),
    );

  const alterar = (orgId: string, id: string, mudancas: Parameters<MemoriaService['alterar']>[2], servico = memoria) =>
    naEmpresa(orgId, () => servico.alterar(orgId, id, mudancas));

  const vetorNoBanco = async (id: string): Promise<number[] | null> => {
    const [l] = await prisma.$queryRawUnsafe<Array<{ v: string | null }>>(
      'SELECT embedding::text AS v FROM "ContextItem" WHERE id = $1',
      id,
    );
    return l?.v ? l.v.replace(/^\[|\]$/g, '').split(',').map(Number) : null;
  };

  const pendenteDe = async (orgId: string, id: string) =>
    (await naEmpresa(orgId, () => memoria.semVetor(orgId, 100))).find((p) => p.id === id) ?? null;

  const linha = (id: string) =>
    prisma.contextItem.findUnique({ where: { id }, select: { body: true, versao: true, contentHash: true } });

  async function limpar() {
    await prisma.contextItem.deleteMany({ where: { orgId: { in: [A, B] } } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [[A, `r05c-a-${MARCA}`], [B, `r05c-b-${MARCA}`]] as const) {
      await prisma.org.upsert({ where: { id }, create: { id, name: `Empresa ${slug}`, slug }, update: {} });
    }
    memoria = novaMemoria(prisma);
  }, TEMPO);

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    await prisma.$disconnect();
  }, TEMPO);

  beforeEach(async () => {
    await limpar();
  }, TEMPO);

  // -------------------------------------------------------------------------
  // alterar: o que esvazia e o que guarda
  // -------------------------------------------------------------------------

  it('S2: corpo novo sem vetor esvazia a coluna, a nota volta para semVetor e a vizinha fica como estava', async () => {
    const vizinha = await criar(B, 'vizinha', 'corpo da vizinha', vetorDe('corpo da vizinha'));
    const nota = await criar(A, 'tela', 'corpo velho', vetorDe('corpo velho'));

    const depois = await alterar(A, nota.id, { body: 'corpo novo, outro assunto' });

    expect({
      temVetor: depois.temVetor,
      vetor: await vetorNoBanco(nota.id),
      hashNaFila: (await pendenteDe(A, nota.id))?.contentHash,
      versao: depois.versao,
      vizinhaComOVetorDela: mesmo(await vetorNoBanco(vizinha.id), vetorDe('corpo da vizinha')),
      vizinhaNaFila: await pendenteDe(B, vizinha.id),
    }).toEqual({
      temVetor: false,
      vetor: null,
      hashNaFila: hashDoCorpo('corpo novo, outro assunto'),
      versao: 2,
      vizinhaComOVetorDela: true,
      vizinhaNaFila: null,
    });
  }, TEMPO);

  it('título, tags e o mesmo corpo com outro fim de linha guardam o vetor', async () => {
    const corpo = 'linha um\nlinha dois';
    const nota = await criar(A, 'titulo', corpo, vetorDe(corpo));

    await alterar(A, nota.id, { title: 'Título corrigido' });
    await alterar(A, nota.id, { tags: ['outra-tag'] });
    const ultima = await alterar(A, nota.id, { body: 'linha um\r\nlinha dois  ' });

    expect({
      versao: ultima.versao,
      mesmoHash: ultima.contentHash === nota.contentHash,
      vetorDoCorpo: mesmo(await vetorNoBanco(nota.id), vetorDe(corpo)),
      naFila: await pendenteDe(A, nota.id),
    }).toEqual({ versao: 4, mesmoHash: true, vetorDoCorpo: true, naFila: null });
  }, TEMPO);

  it('corpo novo com vetor novo fica com o vetor do corpo novo', async () => {
    const nota = await criar(A, 'com-vetor', 'antes', vetorDe('antes'));
    const depois = await alterar(A, nota.id, { body: 'depois', embedding: vetorDe('depois') });
    expect({ temVetor: depois.temVetor, doCorpoNovo: mesmo(await vetorNoBanco(nota.id), vetorDe('depois')) })
      .toEqual({ temVetor: true, doCorpoNovo: true });
  }, TEMPO);

  it('vetor novo que o banco recusa deixa a coluna vazia, nunca com o vetor velho, e o evento existe', async () => {
    const nota = await criar(A, 'torto', 'antes do vetor torto', vetorDe('antes do vetor torto'));
    vi.spyOn(memoria['log'], 'warn').mockImplementation(() => undefined);

    const depois = await alterar(A, nota.id, { body: 'corpo com vetor de 3 posições', embedding: [1, 2, 3] });
    const historico = await naEmpresa(A, () => memoria.historico(A, nota.id));

    expect({
      temVetor: depois.temVetor,
      vetor: await vetorNoBanco(nota.id),
      naFila: (await pendenteDe(A, nota.id))?.contentHash,
      eventoDaVersao2: Boolean(historico[0].eventoId),
    }).toEqual({
      temVetor: false,
      vetor: null,
      naFila: hashDoCorpo('corpo com vetor de 3 posições'),
      eventoDaVersao2: true,
    });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // a gravação depois da leitura confere o hash
  // -------------------------------------------------------------------------

  it('corrida pela fila: ler, editar e gravar com o hash antigo altera zero linhas', async () => {
    const nota = await criar(A, 'corrida', 'texto lido pela fila', null);
    const lida = await pendenteDe(A, nota.id);
    await alterar(A, nota.id, { body: 'texto editado depois da leitura' });

    const comHashAntigo = await memoria.gravarVetor(A, nota.id, vetorDe('texto lido pela fila'), lida!.contentHash);
    const vetorDepois = await vetorNoBanco(nota.id);
    const relida = await pendenteDe(A, nota.id);
    const comHashNovo = await memoria.gravarVetor(A, nota.id, vetorDe('texto editado depois da leitura'), relida!.contentHash);

    // A segunda volta da corrida: edição que JÁ trouxe vetor não é sobrescrita pelo pedido atrasado.
    const lida2 = await pendenteDe(A, (await criar(A, 'corrida-2', 'lido 2', null)).id);
    await alterar(A, lida2!.id, { body: 'editado 2 com vetor', embedding: vetorDe('editado 2 com vetor') });
    const atrasado = await memoria.gravarVetor(A, lida2!.id, vetorDe('lido 2'), lida2!.contentHash);

    expect({
      comHashAntigo,
      vetorDepois,
      hashRelido: relida?.contentHash,
      comHashNovo,
      final: mesmo(await vetorNoBanco(nota.id), vetorDe('texto editado depois da leitura')),
      atrasado,
      ficouOVetorDaEdicao: mesmo(await vetorNoBanco(lida2!.id), vetorDe('editado 2 com vetor')),
    }).toEqual({
      comHashAntigo: 0,
      vetorDepois: null,
      hashRelido: hashDoCorpo('texto editado depois da leitura'),
      comHashNovo: 1,
      final: true,
      atrasado: 0,
      ficouOVetorDaEdicao: true,
    });
  }, TEMPO);

  it('corrida pelo conector: a nota editada enquanto o fornecedor responde não recebe o vetor do texto antigo', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste-nao-e-chave';
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
    const nota = await criar(A, 'no-meio-do-pedido', 'texto que foi ao fornecedor', null);
    const pedidos: string[][] = [];
    vi.stubGlobal('fetch', async (entrada: Parameters<typeof fetch>[0], opcoes?: Parameters<typeof fetch>[1]) => {
      const textos = ((await new Request(entrada, opcoes).json()) as { input: string[] }).input;
      pedidos.push(textos);
      // A pessoa salva a edição na tela enquanto o fornecedor calcula.
      if (pedidos.length === 1) await alterar(A, nota.id, { body: 'texto trocado no meio do pedido' });
      return new Response(JSON.stringify({ data: textos.map((t, index) => ({ index, embedding: vetorDe(t) })) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const svc = new ObsidianService(prisma as never, {} as never, {} as never, memoria as never);
    const log = vi.spyOn(svc['log'], 'log').mockImplementation(() => undefined);

    await naEmpresa(A, () => svc.vetorizarPendentesDaMemoria(A));
    const depoisDaPrimeira = await vetorNoBanco(nota.id);
    await naEmpresa(A, () => svc.vetorizarPendentesDaMemoria(A));

    expect({
      textosPedidos: pedidos.map((p) => p.map((t) => t.split('\n\n')[1])),
      depoisDaPrimeira,
      avisou: log.mock.calls.some((c) => String(c[0]).includes('1 vetor(es) descartado(s)')),
      depoisDaSegunda: mesmo(await vetorNoBanco(nota.id), vetorDe(pedidos[1]?.[0] ?? '')),
    }).toEqual({
      textosPedidos: [['texto que foi ao fornecedor'], ['texto trocado no meio do pedido']],
      depoisDaPrimeira: null,
      avisou: true,
      depoisDaSegunda: true,
    });
  }, TEMPO);

  it('criar: o vetor que chega depois de uma edição concorrente é descartado', async () => {
    const eventosDaCriacao = new EventLogService(prisma as never);
    const quemCria = novaMemoria(prisma, eventosDaCriacao);
    const registrar = eventosDaCriacao.registrar.bind(eventosDaCriacao);
    let editou = false;
    // Entre o commit da criação e a gravação do vetor dela, outra aba edita o corpo.
    vi.spyOn(eventosDaCriacao, 'registrar').mockImplementation(async (evento) => {
      if (!editou && evento.tipo === 'memoria.item.criado') {
        editou = true;
        const itemId = (evento.payload as { itemId: string }).itemId;
        await alterar(A, itemId, { body: 'editado antes do vetor da criação' });
      }
      return registrar(evento);
    });

    const criada = await criar(A, 'criacao', 'corpo da criação', vetorDe('corpo da criação'), quemCria);

    expect({
      editou,
      body: criada.body,
      temVetor: criada.temVetor,
      vetor: await vetorNoBanco(criada.id),
      naFila: (await pendenteDe(A, criada.id))?.contentHash,
    }).toEqual({
      editou: true,
      body: 'editado antes do vetor da criação',
      temVetor: false,
      vetor: null,
      naFila: hashDoCorpo('editado antes do vetor da criação'),
    });
  }, TEMPO);

  it('projeção da vault: o vetor do índice que chega depois de uma edição na tela é descartado', async () => {
    const caminho = `r05c-${MARCA}/projecao.md`;
    await naEmpresa(A, () =>
      memoria.projetarDaVault(A, [{ caminho, title: 'Projeção', body: 'corpo da vault', embedding: null }]),
    );
    const item = await prisma.contextItem.findFirstOrThrow({ where: { orgId: A, sourceRef: caminho } });
    let gatilho: (() => Promise<void>) | null = async () => {
      await alterar(A, item.id, { body: 'editado na tela durante a projeção' });
    };
    // `porChave` lê a nota e o `temVetor`; a edição entra logo depois dessa leitura.
    const comGatilho = comTroca(prisma, {
      $queryRawUnsafe: async (sql: string, ...valores: unknown[]) => {
        const r = await prisma.$queryRawUnsafe(sql, ...valores);
        if (gatilho && sql.includes('SELECT id FROM "ContextItem"') && sql.includes('embedding IS NOT NULL')) {
          const g = gatilho;
          gatilho = null;
          await g();
        }
        return r;
      },
    });
    const projetora = novaMemoria(comGatilho);
    const vetorDoIndice = vetorDe('Projeção\n\ncorpo da vault');

    await naEmpresa(A, () =>
      projetora.projetarDaVault(A, [{ caminho, title: 'Projeção', body: 'corpo da vault', embedding: vetorDoIndice }]),
    );
    const depoisDaCorrida = { ...(await linha(item.id)), vetor: await vetorNoBanco(item.id) };
    // A volta seguinte traz a vault de volta, e com ela o vetor do índice.
    await naEmpresa(A, () =>
      memoria.projetarDaVault(A, [{ caminho, title: 'Projeção', body: 'corpo da vault', embedding: vetorDoIndice }]),
    );

    expect({
      disparou: gatilho === null,
      corpoNaCorrida: depoisDaCorrida.body,
      vetorNaCorrida: depoisDaCorrida.vetor,
      corpoNaVoltaSeguinte: (await linha(item.id))?.body,
      vetorDoIndiceNaVoltaSeguinte: mesmo(await vetorNoBanco(item.id), vetorDoIndice),
    }).toEqual({
      disparou: true,
      corpoNaCorrida: 'editado na tela durante a projeção',
      vetorNaCorrida: null,
      corpoNaVoltaSeguinte: 'corpo da vault',
      vetorDoIndiceNaVoltaSeguinte: true,
    });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // projetarCondicionado (o guia de marca)
  // -------------------------------------------------------------------------

  async function guiaEDestino(orgId: string, destinoComVetor = true) {
    const fonte = await criar(orgId, 'guia', 'Guia da marca v1', null);
    const pedido = (destino: NotaDeContexto | null, body: string, title = 'Marca') => ({
      fonte: { id: fonte.id, chave: fonte.chave, versao: fonte.versao, hash: fonte.contentHash },
      destino: destino
        ? { id: destino.id, chave: destino.chave, versao: destino.versao, hash: destino.contentHash }
        : { id: null, chave: `r05c/${MARCA}/marca-projetada`, versao: null, hash: null },
      title,
      body,
      tags: ['marca'],
      sourceRef: `projecao:${fonte.id}:v1`,
      motivo: 'projeção revisada do guia',
    });
    const projetar = (p: ReturnType<typeof pedido>, servico = memoria) =>
      naEmpresa(orgId, () => servico.projetarCondicionado(orgId, p));
    const criado = await projetar(pedido(null, 'Marca, primeira projeção'));
    if (destinoComVetor) {
      await memoria.gravarVetor(orgId, criado.id, vetorDe('Marca, primeira projeção'), criado.contentHash);
    }
    return { pedido, projetar, destino: (await naEmpresa(orgId, () => memoria.obter(orgId, criado.id)))! };
  }

  it('projetarCondicionado: corpo novo esvazia a coluna; título novo e a mesma prévia repetida guardam o vetor', async () => {
    const { pedido, projetar, destino } = await guiaEDestino(A);

    const soTitulo = await projetar(pedido(destino, 'Marca, primeira projeção', 'Marca (título revisto)'));
    const vetorComTitulo = mesmo(await vetorNoBanco(destino.id), vetorDe('Marca, primeira projeção'));
    const pedidoNovo = pedido(soTitulo, 'Marca, segunda projeção');
    const corpoNovo = await projetar(pedidoNovo);
    const vetorComCorpoNovo = await vetorNoBanco(destino.id);
    await memoria.gravarVetor(A, destino.id, vetorDe('Marca, segunda projeção'), corpoNovo.contentHash);
    const repetida = await projetar(pedidoNovo);

    expect({
      versoes: [soTitulo.versao, corpoNovo.versao, repetida.versao],
      vetorComTitulo,
      vetorComCorpoNovo,
      temVetorDepoisDoCorpoNovo: corpoNovo.temVetor,
      vetorDepoisDaRepetida: mesmo(await vetorNoBanco(destino.id), vetorDe('Marca, segunda projeção')),
    }).toEqual({
      versoes: [2, 3, 3],
      vetorComTitulo: true,
      vetorComCorpoNovo: null,
      temVetorDepoisDoCorpoNovo: false,
      vetorDepoisDaRepetida: true,
    });
  }, TEMPO);

  it('projetarCondicionado: ler na fila, projetar corpo novo e gravar com o hash antigo altera zero linhas', async () => {
    const { pedido, projetar, destino } = await guiaEDestino(A, false);
    const lida = await pendenteDe(A, destino.id);

    await projetar(pedido(destino, 'Marca projetada no meio da fila'));
    const gravadas = await memoria.gravarVetor(A, destino.id, vetorDe('Marca, primeira projeção'), lida!.contentHash);

    expect({ gravadas, vetor: await vetorNoBanco(destino.id), naFila: (await pendenteDe(A, destino.id))?.contentHash })
      .toEqual({ gravadas: 0, vetor: null, naFila: hashDoCorpo('Marca projetada no meio da fila') });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // a transação: o vetor sai junto com o corpo, ou nenhum dos dois muda
  // -------------------------------------------------------------------------

  /** Cliente cujas transações rodam de verdade, com uma falha injetada depois do NULL do vetor. */
  function falhaDepoisDoNull() {
    let anulou = false;
    const cliente = comTroca(prisma, {
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        prisma.$transaction((tx) =>
          fn(
            comTroca(tx, {
              $executeRawUnsafe: async (sql: string, ...valores: unknown[]) => {
                const r = await tx.$executeRawUnsafe(sql, ...valores);
                if (sql.includes('SET embedding = NULL')) {
                  anulou = true;
                  throw new Error('falha injetada depois de anular o vetor, dentro da transação');
                }
                return r;
              },
            }),
          ),
        ),
    });
    return { cliente, anulou: () => anulou };
  }

  /** Cliente que commita a transação e "cai" logo em seguida, antes de qualquer passo seguinte. */
  function quedaDepoisDoCommit() {
    return comTroca(prisma, {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        await prisma.$transaction((tx) => fn(tx));
        throw new Error('queda simulada logo depois do commit');
      },
    });
  }

  it('rollback: a transação desfeita leva o NULL junto, e o corpo e o vetor ficam como estavam', async () => {
    const nota = await criar(A, 'rollback', 'corpo que fica', vetorDe('corpo que fica'));
    const { pedido, projetar, destino } = await guiaEDestino(A);
    const alterarComFalha = falhaDepoisDoNull();
    const projetarComFalha = falhaDepoisDoNull();

    const naAlteracao = await alterar(A, nota.id, { body: 'corpo que não entra' }, novaMemoria(alterarComFalha.cliente))
      .then(() => 'passou', (e: Error) => e.message);
    const naProjecao = await projetar(pedido(destino, 'Marca que não entra'), novaMemoria(projetarComFalha.cliente))
      .then(() => 'passou', (e: Error) => e.message);

    expect({
      anulouNasDuas: alterarComFalha.anulou() && projetarComFalha.anulou(),
      naAlteracao,
      naProjecao,
      nota: await linha(nota.id),
      vetorDaNota: mesmo(await vetorNoBanco(nota.id), vetorDe('corpo que fica')),
      destino: await linha(destino.id),
      vetorDoDestino: mesmo(await vetorNoBanco(destino.id), vetorDe('Marca, primeira projeção')),
    }).toEqual({
      anulouNasDuas: true,
      naAlteracao: expect.stringMatching(/falha injetada/),
      naProjecao: expect.stringMatching(/falha injetada/),
      nota: { body: 'corpo que fica', versao: 1, contentHash: hashDoCorpo('corpo que fica') },
      vetorDaNota: true,
      destino: { body: 'Marca, primeira projeção', versao: 1, contentHash: destino.contentHash },
      vetorDoDestino: true,
    });
  }, TEMPO);

  it('queda logo depois do commit: o corpo novo nunca fica com o vetor do corpo anterior', async () => {
    const nota = await criar(A, 'queda', 'corpo antes da queda', vetorDe('corpo antes da queda'));
    const { pedido, projetar, destino } = await guiaEDestino(A);

    const naAlteracao = await alterar(A, nota.id, { body: 'corpo gravado antes da queda' }, novaMemoria(quedaDepoisDoCommit()))
      .then(() => 'passou', (e: Error) => e.message);
    const naProjecao = await projetar(pedido(destino, 'Marca gravada antes da queda'), novaMemoria(quedaDepoisDoCommit()))
      .then(() => 'passou', (e: Error) => e.message);

    expect({
      naAlteracao,
      naProjecao,
      nota: await linha(nota.id),
      vetorDaNota: await vetorNoBanco(nota.id),
      notaNaFila: Boolean(await pendenteDe(A, nota.id)),
      destino: (await linha(destino.id))?.body,
      vetorDoDestino: await vetorNoBanco(destino.id),
      destinoNaFila: Boolean(await pendenteDe(A, destino.id)),
    }).toEqual({
      naAlteracao: expect.stringMatching(/queda simulada/),
      naProjecao: expect.stringMatching(/queda simulada/),
      nota: { body: 'corpo gravado antes da queda', versao: 2, contentHash: hashDoCorpo('corpo gravado antes da queda') },
      vetorDaNota: null,
      notaNaFila: true,
      destino: 'Marca gravada antes da queda',
      vetorDoDestino: null,
      destinoNaFila: true,
    });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // a outra empresa
  // -------------------------------------------------------------------------

  it('id ou hash de outra empresa gravam zero linhas, e o vetor de cada uma continua o dela', async () => {
    const deA = await criar(A, 'cruzada-a', 'nota de A', vetorDe('nota de A'));
    const deB = await criar(B, 'cruzada-b', 'nota de B', vetorDe('nota de B'));

    const cruzadas = [
      await memoria.gravarVetor(B, deA.id, vetorDe('intruso'), deA.contentHash),
      await memoria.gravarVetor(A, deB.id, vetorDe('intruso'), deB.contentHash),
    ];
    await alterar(A, deA.id, { body: 'A mudou de assunto' });

    expect({
      cruzadas,
      vetorDeA: await vetorNoBanco(deA.id),
      vetorDeB: mesmo(await vetorNoBanco(deB.id), vetorDe('nota de B')),
      filaDeB: await pendenteDe(B, deB.id),
    }).toEqual({ cruzadas: [0, 0], vetorDeA: null, vetorDeB: true, filaDeB: null });
  }, TEMPO);
});
