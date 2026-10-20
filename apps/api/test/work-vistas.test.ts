import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  VISTA_PADRAO_DE_MINHAS_TAREFAS, VISTA_PADRAO_DO_FUNIL, VistaCriarSchema, agruparTarefas, grupoDeVencimento, ordenarTarefas,
} from '@mktos/shared';
import { VistasService } from '../src/work/vistas.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * AS VISTAS SALVAS (rodada do trabalho T3, 19/10/2026).
 *
 *  1. sem banco: grupos de vencimento no relógio de São Paulo (Atrasadas, Hoje,
 *     Amanhã, Esta semana, Depois, Sem data), ordenação com o vazio no fim e o
 *     schema recusando config estranha;
 *  2. contra o Postgres: a vista é da pessoa (a de outra pessoa e a de outra
 *     empresa respondem 404), uma padrão por tela, nome repetido é 409, e a
 *     config é conferida pela tela da vista.
 */

describe('vistas: as regras puras', () => {
  // Segunda-feira, 19/10/2026, 10h em São Paulo (13h UTC).
  const agora = new Date('2026-10-19T13:00:00.000Z');

  it('os grupos de vencimento contam o DIA em São Paulo', () => {
    expect(grupoDeVencimento(null, agora)).toBe('sem-data');
    expect(grupoDeVencimento('2026-10-18T23:00:00.000Z', agora)).toBe('atrasadas'); // 18/10 20h em SP
    expect(grupoDeVencimento('2026-10-20T02:00:00.000Z', agora)).toBe('hoje'); // 19/10 23h em SP
    expect(grupoDeVencimento('2026-10-20T15:00:00.000Z', agora)).toBe('amanha');
    expect(grupoDeVencimento('2026-10-25T15:00:00.000Z', agora)).toBe('semana'); // domingo
    expect(grupoDeVencimento('2026-10-26T15:00:00.000Z', agora)).toBe('depois'); // segunda seguinte
  });

  it('ordena por qualquer campo nas duas direções, com o vazio sempre no fim', () => {
    const base = { status: 'A fazer', lista: 'Execução', prioridade: 'normal', criadaEm: '2026-10-01T00:00:00.000Z' };
    const itens = [
      { ...base, titulo: 'B', cliente: 'Studio Lume', prazo: '2026-10-22T12:00:00.000Z', prioridade: 'baixa' },
      { ...base, titulo: 'A', cliente: null, prazo: null, prioridade: 'urgente' },
      { ...base, titulo: 'C', cliente: 'Alicerce', prazo: '2026-10-20T12:00:00.000Z' },
    ];
    expect(ordenarTarefas(itens, { campo: 'vencimento', direcao: 'asc' }).map((t) => t.titulo)).toEqual(['C', 'B', 'A']);
    expect(ordenarTarefas(itens, { campo: 'vencimento', direcao: 'desc' }).map((t) => t.titulo)).toEqual(['B', 'C', 'A']);
    expect(ordenarTarefas(itens, { campo: 'cliente', direcao: 'asc' }).map((t) => t.titulo)).toEqual(['C', 'B', 'A']);
    expect(ordenarTarefas(itens, { campo: 'prioridade', direcao: 'asc' }).map((t) => t.titulo)).toEqual(['A', 'C', 'B']);
    const grupos = agruparTarefas(itens, 'cliente', agora);
    expect(grupos.map((g) => [g.rotulo, g.itens.length])).toEqual([['Alicerce', 1], ['Studio Lume', 1], ['Sem cliente', 1]]);
    expect(agruparTarefas(itens, 'vencimento', agora).map((g) => g.rotulo)).toEqual(['Amanhã', 'Esta semana', 'Sem data']);
  });

  it('o schema recusa config com chave estranha e tela desconhecida', () => {
    expect(VistaCriarSchema.safeParse({ tela: 'minhas-tarefas', nome: 'Minha', config: VISTA_PADRAO_DE_MINHAS_TAREFAS }).success).toBe(true);
    expect(VistaCriarSchema.safeParse({ tela: 'minhas-tarefas', nome: 'Minha', config: { ...VISTA_PADRAO_DE_MINHAS_TAREFAS, x: 1 } }).success).toBe(false);
    expect(VistaCriarSchema.safeParse({ tela: 'outra', nome: 'Minha', config: {} }).success).toBe(false);
    expect(VistaCriarSchema.safeParse({ tela: 'minhas-tarefas', nome: ' ', config: VISTA_PADRAO_DE_MINHAS_TAREFAS }).success).toBe(false);
  });

  // Versão final (F4): a régua de prazo do Lucas entra como agrupamento, sem invalidar o que já foi salvo.
  it('a régua de prazo agrupa Atrasadas · Hoje · Próximos 7 dias · Mais tarde · Sem prazo · Concluídas, no dia de São Paulo', () => {
    const base = { titulo: 't', status: 's', lista: 'l', cliente: null, prioridade: 'normal', criadaEm: agora.toISOString() };
    const itens = [
      { ...base, titulo: 'feita', prazo: '2026-10-01T15:00:00.000Z', statusTipo: 'closed' },
      { ...base, titulo: 'sem', prazo: null, statusTipo: 'open' },
      { ...base, titulo: 'longe', prazo: '2026-11-30T15:00:00.000Z', statusTipo: 'open' },
      { ...base, titulo: 'semana', prazo: '2026-10-24T15:00:00.000Z', statusTipo: 'custom' },
      { ...base, titulo: 'hoje', prazo: '2026-10-19T03:00:00.000Z', statusTipo: 'open' }, // meia-noite em SP: ainda é hoje
      { ...base, titulo: 'ontem', prazo: '2026-10-19T02:00:00.000Z', statusTipo: 'open' }, // 18/10 23h em SP
    ];
    expect(agruparTarefas(itens, 'prazo', agora).map((g) => [g.rotulo, g.itens.map((t) => t.titulo)])).toEqual([
      ['Atrasadas', ['ontem']], ['Hoje', ['hoje']], ['Próximos 7 dias', ['semana']], ['Mais tarde', ['longe']], ['Sem prazo', ['sem']], ['Concluídas', ['feita']],
    ]);
    // A vista do quadro salva antes (sem agrupamento nem concluídas) continua valendo; as chaves novas são aceitas.
    const antiga = { densidade: 'compacto', visao: 'board', filtros: { assignee: '', agente: '', statusId: '', cliente: '', escopo: 'todos', q: '' } };
    expect(VistaCriarSchema.safeParse({ tela: 'quadro', nome: 'Antiga', config: antiga }).success).toBe(true);
    expect(VistaCriarSchema.safeParse({ tela: 'quadro', nome: 'Nova', config: { ...antiga, visao: 'calendario', agrupamento: 'prazo', concluidas: 'ocultar' } }).success).toBe(true);
    expect(VistaCriarSchema.safeParse({ tela: 'minhas-tarefas', nome: 'Régua', config: { ...VISTA_PADRAO_DE_MINHAS_TAREFAS, agrupamento: 'prazo' } }).success).toBe(true);
  });

  // Rodada da interface (U2, 20/10/2026): os filtros do painel entram como chaves opcionais.
  it('a vista do quadro e a da implantação aceitam os filtros do painel, e a forma continua estrita', () => {
    const antiga = { densidade: 'compacto', visao: 'board', filtros: { assignee: '', agente: '', statusId: '', cliente: '', escopo: 'todos', q: '' } };
    const comPainel = { ...antiga, filtros: { ...antiga.filtros, pessoa: 'sem-vinculo', prazo: 'hoje', etiqueta: 'tag-1', opcao: 'op-1', arquivadas: true } };
    for (const tela of ['quadro', 'implantacao'] as const) {
      expect(VistaCriarSchema.safeParse({ tela, nome: 'Painel', config: antiga }).success).toBe(true);
      expect(VistaCriarSchema.safeParse({ tela, nome: 'Painel', config: comPainel }).success).toBe(true);
      expect(VistaCriarSchema.safeParse({ tela, nome: 'Painel', config: { ...antiga, extra: 1 } }).success).toBe(false);
      expect(VistaCriarSchema.safeParse({ tela, nome: 'Painel', config: { ...comPainel, filtros: { ...comPainel.filtros, arquivadas: 'sim' } } }).success).toBe(false);
      expect(VistaCriarSchema.safeParse({ tela, nome: 'Painel', config: { ...comPainel, filtros: { ...comPainel.filtros, prazo: 'x'.repeat(21) } } }).success).toBe(false);
      // A forma do funil não serve à implantação nem ao quadro.
      expect(VistaCriarSchema.safeParse({ tela, nome: 'Funil', config: VISTA_PADRAO_DO_FUNIL }).success).toBe(false);
    }
  });
});

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-vistas-casa';
const VIZINHA = 'org-teste-vistas-vizinha';
const EU = 'u-vistas-eu';
const COLEGA = 'u-vistas-colega';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas e vistas salvas)');

describe.skipIf(!URL)('vistas: contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: VistasService;
  const cfg = VISTA_PADRAO_DE_MINHAS_TAREFAS;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    svc = new VistasService(prisma as unknown as PrismaService);
    for (const id of [CASA, VIZINHA]) await prisma.org.upsert({ where: { id }, create: { id, name: id, slug: id }, update: {} });
  });
  beforeEach(async () => { await prisma.vistaSalva.deleteMany({ where: { orgId: { in: [CASA, VIZINHA] } } }); });
  afterAll(async () => {
    await prisma.vistaSalva.deleteMany({ where: { orgId: { in: [CASA, VIZINHA] } } });
    await prisma.org.deleteMany({ where: { id: { in: [CASA, VIZINHA] } } });
    await prisma.$disconnect();
  });

  it('uma padrão por tela; marcar outra desmarca a anterior', async () => {
    const a = await svc.criar(CASA, EU, { tela: 'minhas-tarefas', nome: 'Por cliente', padrao: true, config: { ...cfg, agrupamento: 'cliente' } });
    const b = await svc.criar(CASA, EU, { tela: 'minhas-tarefas', nome: 'Atrasadas', padrao: true, config: { ...cfg, agrupamento: 'vencimento' } });
    let lidas = await svc.listar(CASA, EU, 'minhas-tarefas');
    expect(lidas.filter((v) => v.padrao).map((v) => v.id)).toEqual([b.id]);
    await svc.alterar(CASA, EU, a.id, { padrao: true });
    lidas = await svc.listar(CASA, EU, 'minhas-tarefas');
    expect(lidas[0]).toMatchObject({ id: a.id, padrao: true });
    expect(lidas.filter((v) => v.padrao)).toHaveLength(1);
  });

  it('nome repetido na mesma tela é 409; a config é conferida pela tela', async () => {
    await svc.criar(CASA, EU, { tela: 'minhas-tarefas', nome: 'Minha', config: cfg });
    await expect(svc.criar(CASA, EU, { tela: 'minhas-tarefas', nome: 'Minha', config: cfg })).rejects.toBeInstanceOf(ConflictException);
    const v = (await svc.listar(CASA, EU, 'minhas-tarefas'))[0];
    await expect(svc.alterar(CASA, EU, v.id, { config: { densidade: 'compacto' } })).rejects.toThrow();
    const nova = await svc.alterar(CASA, EU, v.id, { config: { ...cfg, ordenacao: { campo: 'cliente', direcao: 'desc' } } });
    expect((nova.config as typeof cfg).ordenacao).toEqual({ campo: 'cliente', direcao: 'desc' });
  });

  it('a implantação tem as vistas dela: grava, lista separada do quadro e confere a config pela tela', async () => {
    const quadro = { densidade: 'compacto' as const, visao: 'board' as const, filtros: { assignee: '', agente: '', statusId: '', cliente: '', escopo: 'todos' as const, q: '' } };
    const daImplantacao = { ...quadro, filtros: { ...quadro.filtros, escopo: 'atrasados' as const, pessoa: EU } };
    const q = await svc.criar(CASA, EU, { tela: 'quadro', nome: 'Atrasadas', padrao: true, config: quadro });
    const i = await svc.criar(CASA, EU, { tela: 'implantacao', nome: 'Atrasadas', padrao: true, config: daImplantacao });
    // O mesmo nome e uma padrão em cada tela: são vistas de telas diferentes.
    expect((await svc.listar(CASA, EU, 'quadro')).map((v) => [v.id, v.padrao])).toEqual([[q.id, true]]);
    const lidas = await svc.listar(CASA, EU, 'implantacao');
    expect(lidas.map((v) => [v.id, v.padrao])).toEqual([[i.id, true]]);
    expect(lidas[0].config).toEqual(daImplantacao);
    // A config é conferida pela tela da vista: a do funil não entra na implantação.
    await expect(svc.alterar(CASA, EU, i.id, { config: VISTA_PADRAO_DO_FUNIL })).rejects.toThrow();
    await expect(svc.alterar(CASA, EU, i.id, { config: { ...daImplantacao, filtros: { ...daImplantacao.filtros, escopo: 'meio' } } })).rejects.toThrow();
    // A de outra pessoa não aparece e responde 404.
    expect(await svc.listar(CASA, COLEGA, 'implantacao')).toEqual([]);
    await expect(svc.alterar(CASA, COLEGA, i.id, { nome: 'Roubada' })).rejects.toBeInstanceOf(NotFoundException);
    expect(svc.telaValida('implantacao')).toBe('implantacao');
    expect(() => svc.telaValida('trabalho')).toThrow(NotFoundException);
  });

  it('a vista é da pessoa: a de outra pessoa e a de outra empresa respondem 404 e não aparecem', async () => {
    const minha = await svc.criar(CASA, EU, { tela: 'minhas-tarefas', nome: 'Minha', config: cfg });
    expect(await svc.listar(CASA, COLEGA, 'minhas-tarefas')).toEqual([]);
    expect(await svc.listar(VIZINHA, EU, 'minhas-tarefas')).toEqual([]);
    await expect(svc.alterar(CASA, COLEGA, minha.id, { nome: 'Roubada' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remover(VIZINHA, EU, minha.id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.listar(CASA, EU, 'minhas-tarefas')).map((x) => x.nome)).toEqual(['Minha']);
    await svc.remover(CASA, EU, minha.id);
    expect(await svc.listar(CASA, EU, 'minhas-tarefas')).toEqual([]);
  });
});
