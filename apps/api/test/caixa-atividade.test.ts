import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CaixaLimparSchema, CaixaTarefasQuerySchema } from '@mktos/shared';

import { CaixaAtividadeService } from '../src/caixa/caixa-atividade.service';
import { CaixaVistoService } from '../src/caixa/caixa-visto.service';
import {
  ACOES_DA_ATIVIDADE,
  LOTE_POR_FONTE,
  chaveDoItem,
  codificarCursor,
  compararNaOrdem,
  condicaoDepoisDoCursor,
  estaLimpo,
  filtroDoVencimento,
  inicioDoDiaEmBrasilia,
  juntarPagina,
  lerChaveDoItem,
  lerCursor,
  limiteDaPagina,
  mudancasDaAuditoria,
  novoLimpoAte,
  tipoDasMudancas,
} from '../src/caixa/atividade-da-caixa';
import { ESTADO_DO_EIXO } from '../src/caixa/o-que-espera';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ModulosService } from '../src/tenants/modulos.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ==========================================================================
 * A CAIXA DE ENTRADA — atividade, limpar e minhas tarefas (rodada do painel P1)
 * ==========================================================================
 *
 * O que esta suíte trava:
 *
 *  1. A LEITURA NÃO ESCREVE. `CaixaAtividadeService` não tem verbo de escrita, e
 *     a única escrita do módulo (`CaixaVistoService`) toca UMA tabela,
 *     `CaixaVisto`. `CaixaService` continua sem escrita nenhuma — quem cobra é
 *     `caixa.test.ts`, que esta rodada não afrouxou;
 *  2. O QUE MUDOU sai do antes/depois que a tela dona grava, e só do campo que
 *     os dois lados registraram (a auditoria antiga não tinha vencimento);
 *  3. O CURSOR não pula nem repete evento na virada da página, com as duas
 *     fontes (auditoria e comentário) na mesma ordem;
 *  4. LIMPAR é por pessoa e por empresa: o visto de um não some da caixa do
 *     outro; limpo some da caixa e volta com `incluirLimpos`; "limpar tudo" não
 *     alcança o futuro nem anda para trás;
 *  5. CONTRA O BANCO: a atividade é só das MINHAS tarefas, do mais novo para o
 *     mais velho, e a edição pelo quadro (`WorkService.editarTarefa`) aparece com
 *     o de → para do status e do vencimento.
 */

const RAIZ = path.resolve(__dirname, '..');
const semComentarios = (fonte: string) =>
  fonte
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l))
    .join('\n');
const LEITURA = semComentarios(readFileSync(path.join(RAIZ, 'src/caixa/caixa-atividade.service.ts'), 'utf8'));
const VISTO = semComentarios(readFileSync(path.join(RAIZ, 'src/caixa/caixa-visto.service.ts'), 'utf8'));
const CONTROLLER_ANTIGO = readFileSync(path.join(RAIZ, 'src/caixa/caixa.controller.ts'), 'utf8');

const VERBOS_DE_ESCRITA = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', '$executeRaw'];

/* ========================================================================== *
 * 1. Quem escreve e quem não escreve
 * ========================================================================== */

describe('P1: a leitura não escreve, e a escrita é só a marca pessoal', () => {
  it('o serviço de leitura não tem verbo de escrita', () => {
    for (const verbo of VERBOS_DE_ESCRITA) {
      expect(LEITURA.includes(`.${verbo}(`), `a leitura passou a chamar ${verbo}`).toBe(false);
    }
  });

  it('o serviço do visto só escreve em CaixaVisto', () => {
    const escritas = [...VISTO.matchAll(/this\.prisma\.(\w+)\.(\w+)\(/g)]
      .filter((m) => VERBOS_DE_ESCRITA.includes(m[2]))
      .map((m) => m[1]);
    expect(escritas.length).toBeGreaterThan(0);
    expect([...new Set(escritas)]).toEqual(['caixaVisto']);
  });

  it('o userId da marca vem do token, nunca do corpo do pedido', () => {
    // O corpo aceito tem só `ids` ou `tudo`/`ate` — e é estrito.
    expect(CaixaLimparSchema.safeParse({ ids: ['comentario:abc'], userId: 'outro' }).success).toBe(false);
    expect(CaixaLimparSchema.safeParse({ tudo: true, userId: 'outro' }).success).toBe(false);
    expect(VISTO).toContain('userId: eu.id');
  });

  it('o controller antigo da caixa continua sem verbo de escrita', () => {
    for (const verbo of ['@Post(', '@Put(', '@Patch(', '@Delete(']) {
      expect(CONTROLLER_ANTIGO.includes(verbo)).toBe(false);
    }
  });

  it('o corpo do limpar aceita só chave de origem conhecida', () => {
    expect(CaixaLimparSchema.safeParse({ ids: ['auditoria:1f2e', 'comentario:abc-1'] }).success).toBe(true);
    expect(CaixaLimparSchema.safeParse({ ids: ['tudo:tudo'] }).success).toBe(false);
    expect(CaixaLimparSchema.safeParse({ ids: ['qualquer coisa'] }).success).toBe(false);
    expect(CaixaLimparSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(CaixaLimparSchema.safeParse({ tudo: true, ate: '2026-10-18T12:00:00.000Z' }).success).toBe(true);
  });
});

/* ========================================================================== *
 * 2. O que mudou
 * ========================================================================== */

describe('P1: o que mudou sai do antes/depois da tela dona', () => {
  it('status e responsável viram de → para', () => {
    const m = mudancasDaAuditoria(
      { status: 'A fazer', title: 'X', assignee: 'Pedro', priority: 'normal' },
      { status: 'Feito', title: 'X', assignee: 'Lucas', priority: 'normal' },
    );
    expect(m).toEqual([
      { campo: 'status', de: 'A fazer', para: 'Feito' },
      { campo: 'responsavel', de: 'Pedro', para: 'Lucas' },
    ]);
    expect(tipoDasMudancas(m)).toBe('status');
  });

  it('auditoria antiga sem dueDate NÃO inventa mudança de vencimento', () => {
    const m = mudancasDaAuditoria(
      { status: 'A', title: 'X', assignee: null, priority: 'normal' },
      { status: 'A', title: 'X', assignee: null, priority: 'normal', dueDate: '2026-10-20T00:00:00.000Z' },
    );
    expect(m).toEqual([]);
  });

  it('vencimento novo aparece quando os dois lados o registraram', () => {
    const m = mudancasDaAuditoria(
      { status: 'A', dueDate: null },
      { status: 'A', dueDate: '2026-10-20T00:00:00.000Z' },
    );
    expect(m).toEqual([{ campo: 'vencimento', de: null, para: '2026-10-20T00:00:00.000Z' }]);
    expect(tipoDasMudancas(m)).toBe('vencimento');
  });

  it('atribuição, e edição de título ou prioridade', () => {
    expect(tipoDasMudancas([{ campo: 'responsavel', de: null, para: 'Pedro' }])).toBe('atribuicao');
    expect(tipoDasMudancas([{ campo: 'titulo', de: 'a', para: 'b' }])).toBe('edicao');
  });

  it('antes ou depois ilegível não vira mudança', () => {
    expect(mudancasDaAuditoria(null, { status: 'A' })).toEqual([]);
    expect(mudancasDaAuditoria(['x'], { status: 'A' })).toEqual([]);
  });

  it('o comentário vem de WorkComment — a cópia da auditoria não entra', () => {
    expect(ACOES_DA_ATIVIDADE).not.toContain('work.comment.create' as never);
  });
});

/* ========================================================================== *
 * 3. O cursor e a página
 * ========================================================================== */

describe('P1: a página não pula nem repete evento', () => {
  const t = (s: number) => new Date(Date.UTC(2026, 9, 18, 12, 0, s));

  it('a chave do item ida e volta', () => {
    expect(lerChaveDoItem(chaveDoItem('auditoria', 'abc'))).toEqual({ origem: 'auditoria', eventoId: 'abc' });
    expect(lerChaveDoItem('tudo:tudo')).toBeNull();
    expect(lerChaveDoItem('auditoria:')).toBeNull();
  });

  it('cursor ilegível recomeça do topo, sem erro', () => {
    expect(lerCursor('lixo')).toBeNull();
    expect(lerCursor(null)).toBeNull();
    const c = { quando: t(5), chave: 'comentario:abc' };
    expect(lerCursor(codificarCursor(c))).toEqual(c);
  });

  it('no mesmo instante, comentário vem antes de auditoria', () => {
    const a = { quando: t(1), chave: 'auditoria:z' };
    const c = { quando: t(1), chave: 'comentario:a' };
    expect([a, c].sort(compararNaOrdem)).toEqual([c, a]);
  });

  it('a condição do cursor, fonte por fonte', () => {
    const cursorEmComentario = { quando: t(1), chave: 'comentario:m' };
    // A auditoria do mesmo instante vem TODA depois de um comentário.
    expect(condicaoDepoisDoCursor('auditoria', cursorEmComentario)).toEqual({
      OR: [{ createdAt: { lt: t(1) } }, { createdAt: t(1) }],
    });
    expect(condicaoDepoisDoCursor('comentario', cursorEmComentario)).toEqual({
      OR: [{ createdAt: { lt: t(1) } }, { createdAt: t(1), id: { lt: 'm' } }],
    });
    const cursorEmAuditoria = { quando: t(1), chave: 'auditoria:m' };
    // Nenhum comentário do mesmo instante sobrou: todos vieram antes.
    expect(condicaoDepoisDoCursor('comentario', cursorEmAuditoria)).toEqual({
      OR: [{ createdAt: { lt: t(1) } }],
    });
    expect(condicaoDepoisDoCursor('auditoria', null)).toEqual({});
  });

  it('fonte cheia segura a página: nada mais velho que a última linha lida dela sai', () => {
    const aud = [9, 8, 7].map((s) => ({ quando: t(s), chave: `auditoria:${s}` }));
    const com = [6, 2].map((s) => ({ quando: t(s), chave: `comentario:${s}` }));
    const r = juntarPagina(
      [
        { itens: aud, cheia: true, ultimaLida: aud[2] },
        { itens: com, cheia: false, ultimaLida: com[1] },
      ],
      30,
    );
    // Os comentários de 6s e 2s são mais velhos que a última auditoria lida
    // (7s): pode haver auditoria entre eles que esta leva não trouxe.
    expect(r.itens.map((i) => i.chave)).toEqual(['auditoria:9', 'auditoria:8', 'auditoria:7']);
    expect(r.proximo).toBe(codificarCursor(aud[2]));
  });

  it('página cheia corta no limite e aponta para o último publicado', () => {
    const aud = [9, 8, 7].map((s) => ({ quando: t(s), chave: `auditoria:${s}` }));
    const r = juntarPagina([{ itens: aud, cheia: false, ultimaLida: aud[2] }], 2);
    expect(r.itens).toHaveLength(2);
    expect(r.proximo).toBe(codificarCursor(aud[1]));
  });

  it('fontes vazias e não cheias acabam a lista', () => {
    expect(juntarPagina([{ itens: [], cheia: false, ultimaLida: null }], 10)).toEqual({ itens: [], proximo: null });
  });

  it('o limite tem chão e teto', () => {
    expect(limiteDaPagina(undefined)).toBe(30);
    expect(limiteDaPagina('5')).toBe(5);
    expect(limiteDaPagina('9999')).toBe(100);
    expect(limiteDaPagina('-1')).toBe(30);
  });
});

/* ========================================================================== *
 * 4. O limpo
 * ========================================================================== */

describe('P1: o limpo', () => {
  const agora = new Date('2026-10-18T15:00:00.000Z');

  it('limpo pela marca ou pelo "limpar tudo" que alcança o instante', () => {
    const item = { quando: new Date('2026-10-18T10:00:00.000Z'), chave: 'auditoria:a' };
    expect(estaLimpo(item, null, new Set())).toBe(false);
    expect(estaLimpo(item, null, new Set(['auditoria:a']))).toBe(true);
    expect(estaLimpo(item, new Date('2026-10-18T10:00:00.000Z'), new Set())).toBe(true);
    expect(estaLimpo(item, new Date('2026-10-18T09:59:59.000Z'), new Set())).toBe(false);
  });

  it('"limpar tudo" não alcança o futuro', () => {
    expect(novoLimpoAte(new Date('2030-01-01T00:00:00.000Z'), null, agora)).toEqual(agora);
  });

  it('"limpar tudo" não anda para trás', () => {
    const anterior = new Date('2026-10-18T14:00:00.000Z');
    expect(novoLimpoAte(new Date('2026-10-18T13:00:00.000Z'), anterior, agora)).toEqual(anterior);
    expect(novoLimpoAte(null, anterior, agora)).toEqual(agora);
  });
});

/* ========================================================================== *
 * 5. O vencimento
 * ========================================================================== */

describe('P1: vencidas, hoje e semana, no dia de Brasília', () => {
  it('22h30 de sexta em Brasília ainda é sexta', () => {
    const agora = new Date('2026-10-17T01:30:00.000Z'); // 16/10 22h30 em Brasília
    expect(inicioDoDiaEmBrasilia(agora).toISOString()).toBe('2026-10-16T03:00:00.000Z');
    expect(filtroDoVencimento('hoje', agora)).toEqual({
      gte: new Date('2026-10-16T03:00:00.000Z'),
      lt: new Date('2026-10-17T03:00:00.000Z'),
    });
  });

  it('semana são sete dias a partir de hoje; vencidas é antes de agora', () => {
    const agora = new Date('2026-10-18T15:00:00.000Z');
    expect(filtroDoVencimento('semana', agora)).toEqual({
      gte: new Date('2026-10-18T03:00:00.000Z'),
      lt: new Date('2026-10-25T03:00:00.000Z'),
    });
    expect(filtroDoVencimento('vencidas', agora)).toEqual({ lt: agora });
    expect(filtroDoVencimento(undefined, agora)).toBeUndefined();
  });

  it('os filtros da rota: responsável padrão é "eu", encerradas fora', () => {
    const f = CaixaTarefasQuerySchema.parse({});
    expect(f.responsavel).toBe('eu');
    expect(f.encerradas).toBe(false);
    expect(CaixaTarefasQuerySchema.parse({ encerradas: 'sim' }).encerradas).toBe(true);
    expect(CaixaTarefasQuerySchema.safeParse({ vencimento: 'ontem' }).success).toBe(false);
  });
});

/* ========================================================================== *
 * 6. Os portões, com dublê — sem banco
 * ========================================================================== */

describe('P1: os portões da leitura', () => {
  function dublê(opts: { modulos?: string[]; usuario?: boolean } = {}) {
    const consultas: string[] = [];
    const prisma = new Proxy(
      {},
      {
        get: (_alvo, modelo: string) =>
          new Proxy(
            {},
            {
              get: (_a, metodo: string) => (args: { where?: Record<string, unknown> }) => {
                consultas.push(`${modelo}.${metodo}`);
                if (modelo === 'user' && metodo === 'findFirst') {
                  return Promise.resolve(
                    opts.usuario === false ? null : { id: 'u', name: 'Pedro', email: 'p@x.com' },
                  );
                }
                // Toda consulta leva empresa.
                expect(JSON.stringify(args?.where ?? {})).toContain('org-p1');
                return Promise.resolve(metodo === 'findFirst' ? null : []);
              },
            },
          ),
      },
    ) as unknown as PrismaService;
    const modulos = {
      modulosDaOrg: () => Promise.resolve(new Set(opts.modulos ?? ['trabalho'])),
    } as unknown as ModulosService;
    return { svc: new CaixaAtividadeService(prisma, modulos), consultas };
  }
  const pedido = {
    orgId: 'org-p1',
    usuarioId: 'u',
    permissoes: ['dashboard.ver', 'tarefas.ver'],
    incluirLimpos: false,
    incluirMeus: false,
    limite: 30,
  };

  it('sem tarefas.ver, o quadro não é nem consultado', async () => {
    const { svc, consultas } = dublê();
    const r = await svc.atividade({ ...pedido, permissoes: ['dashboard.ver'] });
    expect(r.estado).toBe(ESTADO_DO_EIXO.semPermissao);
    expect(consultas.some((c) => c.startsWith('workTask') || c.startsWith('auditLog'))).toBe(false);
  });

  it('módulo trabalho desligado: nada do quadro é lido', async () => {
    const { svc, consultas } = dublê({ modulos: [] });
    const r = await svc.tarefas({ ...pedido, filtros: CaixaTarefasQuerySchema.parse({}) });
    expect(r.estado).toBe(ESTADO_DO_EIXO.moduloDesligado);
    expect(consultas.some((c) => c.startsWith('work'))).toBe(false);
  });

  it('sessão sem usuário ativo nesta empresa', async () => {
    const { svc } = dublê({ usuario: false });
    expect((await svc.atividade(pedido)).estado).toBe(ESTADO_DO_EIXO.foraDaCasa);
  });

  it('sem tarefas minhas, a atividade volta vazia sem ler a auditoria', async () => {
    const { svc, consultas } = dublê();
    const r = await svc.atividade(pedido);
    expect(r.estado).toBe(ESTADO_DO_EIXO.ok);
    expect(r.itens).toEqual([]);
    expect(consultas).not.toContain('auditLog.findMany');
  });
});

/* ========================================================================== *
 * 7. CONTRA O BANCO
 * ========================================================================== */

const URL_DO_BANCO = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL_DO_BANCO ?? '', 'cria e apaga empresas, usuários, tarefas e marcas da caixa');

describe.skipIf(!URL_DO_BANCO)('P1: a caixa de entrada contra o Postgres', () => {
  const ORG = 'org-p1-caixa';
  const VIZINHA = 'org-p1-caixa-vizinha';
  const EU = 'u-p1-eu';
  const OUTRO = 'u-p1-outro';
  const TERCEIRO = 'u-p1-terceiro';
  const DA_VIZINHA = 'u-p1-vizinha';

  let prisma: PrismaClient;
  let work: WorkService;
  let leitura: CaixaAtividadeService;
  let visto: CaixaVistoService;
  const tarefa: Record<string, string> = {};
  const status: Record<string, string> = {};

  const sessao = (usuarioId: string, orgId = ORG) => ({
    orgId,
    usuarioId,
    permissoes: ['dashboard.ver', 'tarefas.ver', 'tarefas.editar'],
    incluirLimpos: false,
    incluirMeus: false,
    limite: 30,
  });

  async function limpar() {
    const orgs = { in: [ORG, VIZINHA] };
    await prisma.caixaVisto.deleteMany({ where: { orgId: orgs } });
    await prisma.workComment.deleteMany({ where: { orgId: orgs } });
    await prisma.workTask.deleteMany({ where: { orgId: orgs } });
    await prisma.workStatus.deleteMany({ where: { orgId: orgs } });
    await prisma.workList.deleteMany({ where: { orgId: orgs } });
    await prisma.auditLog.deleteMany({ where: { orgId: orgs } });
    await prisma.user.deleteMany({ where: { id: { in: [EU, OUTRO, TERCEIRO, DA_VIZINHA] } } });
    await prisma.org.deleteMany({ where: { id: orgs } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL_DO_BANCO } } });
    await prisma.$connect();
    await limpar();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    work = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    const modulos = {
      modulosDaOrg: () => Promise.resolve(new Set(['trabalho'])),
    } as unknown as ModulosService;
    leitura = new CaixaAtividadeService(p, modulos);
    visto = new CaixaVistoService(p);

    for (const id of [ORG, VIZINHA]) {
      await prisma.org.create({ data: { id, name: id, slug: id, modulos: ['trabalho'] } });
    }
    const gente: [string, string, string][] = [
      [EU, ORG, 'Pedro Caixa'],
      [OUTRO, ORG, 'Lucas Caixa'],
      [TERCEIRO, ORG, 'Ana Caixa'],
      // Mesmo nome que eu, na empresa vizinha: o casamento por nome não pode
      // atravessar a empresa.
      [DA_VIZINHA, VIZINHA, 'Pedro Caixa'],
    ];
    for (const [id, orgId, name] of gente) {
      await prisma.user.create({ data: { id, orgId, name, email: `${id}@p1.test`, passwordHash: 'x' } });
    }

    for (const orgId of [ORG, VIZINHA]) {
      const lista = await prisma.workList.create({ data: { orgId, name: `Lista ${orgId}` } });
      const aberto = await prisma.workStatus.create({ data: { listId: lista.id, name: 'A fazer', type: 'open', order: 0 } });
      const feito = await prisma.workStatus.create({ data: { listId: lista.id, name: 'Feito', type: 'closed', order: 1 } });
      status[`${orgId}:aberto`] = aberto.id;
      status[`${orgId}:feito`] = feito.id;
      status[`${orgId}:lista`] = lista.id;
    }

    // Pela tela dona: a criação e a edição gravam a auditoria de verdade.
    const minha = await work.criarTarefa(ORG, OUTRO, {
      listId: status[`${ORG}:lista`],
      title: 'Minha tarefa',
      assignee: 'pedro caixa',
    });
    tarefa.minha = minha.id;
    const doLucas = await work.criarTarefa(ORG, OUTRO, {
      listId: status[`${ORG}:lista`],
      title: 'Tarefa do Lucas',
      assignee: 'Lucas Caixa',
    });
    tarefa.doLucas = doLucas.id;
    const daVizinha = await work.criarTarefa(VIZINHA, DA_VIZINHA, {
      listId: status[`${VIZINHA}:lista`],
      title: 'Tarefa da vizinha',
      assignee: 'Pedro Caixa',
    });
    tarefa.daVizinha = daVizinha.id;

    await work.editarTarefa(ORG, OUTRO, tarefa.minha, {
      statusId: status[`${ORG}:feito`],
      dueDate: '2026-10-25T12:00:00.000Z',
    });
    await work.comentar(ORG, TERCEIRO, tarefa.minha, 'Ana passando: precisa do anexo');
    await work.comentar(ORG, EU, tarefa.minha, 'meu próprio comentário');
    // Na tarefa que não é minha: não pode chegar à minha caixa.
    await work.editarTarefa(ORG, EU, tarefa.doLucas, { statusId: status[`${ORG}:feito`] });
    await work.comentar(ORG, OUTRO, tarefa.doLucas, 'comentário na tarefa do Lucas');
    // Na vizinha, com o meu nome: não pode atravessar.
    await work.comentar(VIZINHA, DA_VIZINHA, tarefa.daVizinha, 'recado da vizinha');
  });

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    await prisma.$disconnect();
  });

  it('a atividade é só das minhas tarefas, do mais novo para o mais velho, sem o que eu fiz', async () => {
    const r = await leitura.atividade(sessao(EU));
    expect(r.estado).toBe(ESTADO_DO_EIXO.ok);
    expect(r.itens.every((i) => i.tarefaId === tarefa.minha)).toBe(true);
    expect(r.itens.map((i) => i.tipo)).toEqual(['comentario', 'status', 'criacao']);
    const quando = r.itens.map((i) => new Date(i.quando).getTime());
    expect([...quando].sort((a, b) => b - a)).toEqual(quando);
    expect(r.itens.some((i) => i.porMim)).toBe(false);
    expect(JSON.stringify(r)).not.toContain('recado da vizinha');
    expect(JSON.stringify(r)).not.toContain('tarefa do Lucas');
  });

  it('a edição pelo quadro chega com o de → para do status e do vencimento', async () => {
    const r = await leitura.atividade(sessao(EU));
    const edicao = r.itens.find((i) => i.tipo === 'status');
    expect(edicao?.quem).toBe('Lucas Caixa');
    expect(edicao?.mudancas).toEqual([
      { campo: 'status', de: 'A fazer', para: 'Feito' },
      { campo: 'vencimento', de: null, para: '2026-10-25T12:00:00.000Z' },
    ]);
    const comentario = r.itens.find((i) => i.tipo === 'comentario');
    expect(comentario?.quem).toBe('Ana Caixa');
    expect(comentario?.trecho).toContain('precisa do anexo');
  });

  it('com incluirMeus, o meu comentário aparece marcado como meu', async () => {
    const r = await leitura.atividade({ ...sessao(EU), incluirMeus: true });
    const meus = r.itens.filter((i) => i.porMim);
    expect(meus.map((i) => i.trecho)).toEqual(['meu próprio comentário']);
  });

  it('a página corta e o cursor continua sem repetir', async () => {
    const p1 = await leitura.atividade({ ...sessao(EU), limite: 2 });
    expect(p1.itens).toHaveLength(2);
    expect(p1.proximo).not.toBeNull();
    const p2 = await leitura.atividade({ ...sessao(EU), limite: 2, antesDe: p1.proximo });
    expect(p2.itens.map((i) => i.tipo)).toEqual(['criacao']);
    expect(p2.proximo).toBeNull();
    const ids = [...p1.itens, ...p2.itens].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('limpar um: some da caixa, fica no histórico, e não some da caixa de outra pessoa', async () => {
    const antes = await leitura.atividade(sessao(EU));
    const alvo = antes.itens.find((i) => i.tipo === 'comentario')!;
    const r = await visto.limpar({ orgId: ORG, usuarioId: EU, entrada: { ids: [alvo.id] } });
    expect(r.limpos).toBe(1);
    // Repetir não é erro e não duplica.
    expect((await visto.limpar({ orgId: ORG, usuarioId: EU, entrada: { ids: [alvo.id] } })).limpos).toBe(0);

    const depois = await leitura.atividade(sessao(EU));
    expect(depois.itens.map((i) => i.id)).not.toContain(alvo.id);
    const historico = await leitura.atividade({ ...sessao(EU), incluirLimpos: true });
    expect(historico.itens.find((i) => i.id === alvo.id)?.limpo).toBe(true);

    // A marca é minha: no banco ela tem o meu id e a minha empresa, e só.
    const marcas = await prisma.caixaVisto.findMany({ where: { eventoId: lerChaveDoItem(alvo.id)!.eventoId } });
    expect(marcas.map((m) => [m.orgId, m.userId])).toEqual([[ORG, EU]]);
  });

  it('o visto de um não some da caixa do outro', async () => {
    // O Lucas é responsável pela tarefa dele e vê a minha mudança de status ali.
    const doLucas = await leitura.atividade(sessao(OUTRO));
    expect(doLucas.itens.some((i) => i.tarefaId === tarefa.doLucas && i.tipo === 'status')).toBe(true);
    await visto.limpar({ orgId: ORG, usuarioId: EU, entrada: { ids: doLucas.itens.map((i) => i.id) } });
    const deNovo = await leitura.atividade(sessao(OUTRO));
    expect(deNovo.itens.map((i) => i.id)).toEqual(doLucas.itens.map((i) => i.id));
  });

  it('limpar tudo: a caixa zera, o histórico guarda, e evento novo volta a aparecer', async () => {
    const r = await visto.limpar({ orgId: ORG, usuarioId: EU, entrada: { tudo: true } });
    expect(r.limpoAte).not.toBeNull();
    expect((await leitura.atividade(sessao(EU))).itens).toEqual([]);
    const historico = await leitura.atividade({ ...sessao(EU), incluirLimpos: true });
    expect(historico.itens.length).toBe(3);
    expect(historico.itens.every((i) => i.limpo)).toBe(true);
    expect(historico.limpoAte).toBe(r.limpoAte);

    // Depois do "tudo", um comentário novo chega.
    await new Promise((ok) => setTimeout(ok, 5));
    await work.comentar(ORG, OUTRO, tarefa.minha, 'chegou depois do limpar tudo');
    const nova = await leitura.atividade(sessao(EU));
    expect(nova.itens.map((i) => i.trecho)).toEqual(['chegou depois do limpar tudo']);
  });

  it('a marca não atravessa empresa: a vizinha com o meu nome não vê nada meu', async () => {
    const r = await leitura.atividade(sessao(DA_VIZINHA, VIZINHA));
    expect(r.itens.every((i) => i.tarefaId === tarefa.daVizinha)).toBe(true);
    expect(r.limpoAte).toBeNull();
    // Usuário de uma empresa não marca na outra.
    await expect(
      visto.limpar({ orgId: VIZINHA, usuarioId: EU, entrada: { tudo: true } }),
    ).rejects.toThrow(/usuário ativo/);
  });

  it('minhas tarefas: filtros, contagem de comentários e encerradas', async () => {
    const abertas = await leitura.tarefas({ ...sessao(EU), filtros: CaixaTarefasQuerySchema.parse({}) });
    // A minha está Feito (encerrada): fora por padrão.
    expect(abertas.itens).toEqual([]);
    expect(abertas.listas.map((l) => l.nome)).toEqual([`Lista ${ORG}`]);
    expect(abertas.status).toEqual(['A fazer', 'Feito']);

    const todas = await leitura.tarefas({
      ...sessao(EU),
      filtros: CaixaTarefasQuerySchema.parse({ encerradas: 'sim' }),
    });
    expect(todas.itens.map((t) => t.titulo)).toEqual(['Minha tarefa']);
    expect(todas.itens[0].comentarios).toBe(3);
    expect(todas.itens[0].motivos).toEqual([]);

    const qualquer = await leitura.tarefas({
      ...sessao(EU),
      filtros: CaixaTarefasQuerySchema.parse({ encerradas: 'sim', responsavel: 'qualquer' }),
    });
    expect(qualquer.itens.map((t) => t.titulo).sort()).toEqual(['Minha tarefa', 'Tarefa do Lucas']);

    const vencidas = await leitura.tarefas({
      ...sessao(EU),
      filtros: CaixaTarefasQuerySchema.parse({ encerradas: 'sim', vencimento: 'vencidas' }),
    });
    expect(vencidas.itens).toEqual([]);
  });

  it('o lote por fonte é o teto declarado', () => {
    expect(LOTE_POR_FONTE).toBeGreaterThanOrEqual(30);
  });
});
