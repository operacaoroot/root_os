import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  MODELOS_DE_LISTA,
  TrabApontamentoCreateSchema,
  TrabListaDoModeloSchema,
  TrabStatusUpdateSchema,
} from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService, diaDeCalendarioValido, hojeEmBrasilia } from '../src/work/work.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ==========================================================================
 * A ESTEIRA DE CLIENTES — o quadro de Trabalho vira kanban (17/09/2026)
 * ==========================================================================
 *
 * O que esta suíte cobra, e por quê:
 *
 *  1. O MODELO é dado versionado: etapas na ordem da esteira, uma de saída
 *     (`closed`) no fim, limite de duas implantações, campos com opções únicas.
 *     Um modelo quebrado criaria listas quebradas em toda empresa que clicar.
 *  2. A IDADE DO CARTÃO é carimbada pelo BANCO. Editar título não reinicia a
 *     idade; trocar etapa reinicia — inclusive por um `updateMany` que não passa
 *     pelo serviço, que é o caminho do checkout atômico.
 *  3. AS HORAS gravam a etapa ATUAL, somam na lista e por etapa, recusam dia no
 *     futuro e dia que não existe, e só quem lançou apaga.
 *  4. O BANCO recusa o absurdo mesmo sem o serviço: minutos fora de 1..1440 e
 *     limite zero ou negativo.
 *
 * O isolamento entre empresas de `WorkApontamento` (leitura cruzada, filho
 * pendurado em pai de outra empresa) está no registro de
 * `tenant-isolation.test.ts`, com as outras tabelas — não se repete aqui.
 */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-esteira';
const VIZINHA = 'org-teste-esteira-vizinha';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (listas, tarefas, horas e auditoria)');

/* ==========================================================================
 * 1. AS REGRAS — sem banco
 * ========================================================================== */

describe('esteira: o modelo de lista', () => {
  const esteira = MODELOS_DE_LISTA['esteira-de-clientes'];

  it('tem as seis etapas de trabalho na ordem da esteira e uma de saída no fim', () => {
    expect(esteira.etapas.map((e) => e.name)).toEqual([
      'Qualificação', 'Diagnóstico', 'Contrato', 'Onboarding', 'Implantação', 'Operação', 'Encerrado',
    ]);
    expect(esteira.etapas[0].type).toBe('open');
    expect(esteira.etapas.at(-1)?.type).toBe('closed');
    // Só a última fecha: "Operação" é cliente ativo, não trabalho concluído.
    expect(esteira.etapas.filter((e) => e.type === 'closed')).toHaveLength(1);
  });

  it('limita a Implantação a duas ao mesmo tempo, e só ela', () => {
    const comLimite = esteira.etapas.filter((e) => e.limite !== null);
    expect(comLimite).toEqual([expect.objectContaining({ name: 'Implantação', limite: 2 })]);
  });

  it('nomes de etapa únicos (o banco exige) e cores em hex', () => {
    const nomes = esteira.etapas.map((e) => e.name);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const e of esteira.etapas) expect(e.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('campos com opções únicas por campo, e só dropdown tem opção', () => {
    for (const c of esteira.campos) {
      const opcoes = 'opcoes' in c ? c.opcoes : undefined;
      if (c.type === 'drop_down') {
        expect(opcoes?.length ?? 0).toBeGreaterThan(0);
        const nomes = opcoes!.map((o) => o.name);
        expect(new Set(nomes).size).toBe(nomes.length);
      } else {
        expect(opcoes).toBeUndefined();
      }
    }
  });

  it('a rota aceita só modelo que existe', () => {
    expect(TrabListaDoModeloSchema.safeParse({ modelo: 'esteira-de-clientes' }).success).toBe(true);
    expect(TrabListaDoModeloSchema.safeParse({ modelo: 'crm-generico' }).success).toBe(false);
  });
});

describe('esteira: as regras das horas e do limite', () => {
  it('minutos inteiros de 1 a 1440 — fração, zero e mais de um dia são recusados', () => {
    for (const ok of [1, 90, 1440]) expect(TrabApontamentoCreateSchema.safeParse({ minutos: ok }).success).toBe(true);
    for (const ruim of [0, -30, 1441, 1.5]) expect(TrabApontamentoCreateSchema.safeParse({ minutos: ruim }).success).toBe(false);
  });

  it('limite de etapa: de 1 a 99, e null apaga', () => {
    expect(TrabStatusUpdateSchema.safeParse({ limite: 2 }).success).toBe(true);
    expect(TrabStatusUpdateSchema.safeParse({ limite: null }).success).toBe(true);
    expect(TrabStatusUpdateSchema.safeParse({ limite: 0 }).success).toBe(false);
    expect(TrabStatusUpdateSchema.safeParse({ limite: 100 }).success).toBe(false);
  });

  it('"hoje" é o dia de Brasília: 22h30 de terça ainda é terça, mesmo com o UTC na quarta', () => {
    expect(hojeEmBrasilia(new Date('2026-09-16T01:30:00Z'))).toBe('2026-09-15');
    expect(hojeEmBrasilia(new Date('2026-09-16T03:30:00Z'))).toBe('2026-09-16');
  });

  it('dia de calendário que não existe é recusado', () => {
    expect(diaDeCalendarioValido('2026-09-15')).toBe(true);
    expect(diaDeCalendarioValido('2028-02-29')).toBe(true);
    for (const ruim of ['2026-02-29', '2026-02-31', '2026-13-01', '15/09/2026', '2026-9-15']) {
      expect(diaDeCalendarioValido(ruim)).toBe(false);
    }
  });
});

/* ==========================================================================
 * 2. CONTRA O BANCO
 * ========================================================================== */

describe.skipIf(!URL)('esteira: contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: WorkService;
  let listaId: string;
  const etapa: Record<string, string> = {};
  const EU = 'u-esteira-eu';
  const OUTRO = 'u-esteira-outro';

  async function tarefa(titulo = 'Cliente de teste') {
    const t = await prisma.workTask.create({
      data: { orgId: ORG, listId: listaId, statusId: etapa['Qualificação'], title: titulo },
      select: { id: true, statusDesde: true, updatedAt: true },
    });
    return t;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    svc = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));

    for (const orgId of [ORG, VIZINHA]) {
      await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    }
    for (const [id, name] of [[EU, 'Rodrigo'], [OUTRO, 'Pedro']] as const) {
      await prisma.user.upsert({
        where: { id },
        create: { id, orgId: ORG, name, email: `${id}@teste.local`, passwordHash: 'x' },
        update: {},
      });
    }

    const lista = await svc.criarListaDoModelo(ORG, EU, { modelo: 'esteira-de-clientes' });
    listaId = lista.id;
    for (const s of await prisma.workStatus.findMany({ where: { listId: listaId } })) etapa[s.name] = s.id;
  });

  beforeEach(async () => {
    vi.useRealTimers();
    await prisma.workTask.deleteMany({ where: { orgId: ORG } });
  });

  afterAll(async () => {
    if (!prisma) return;
    vi.useRealTimers();
    await prisma.workTask.deleteMany({ where: { orgId: { in: [ORG, VIZINHA] } } });
    await prisma.workField.deleteMany({ where: { orgId: { in: [ORG, VIZINHA] } } });
    await prisma.workStatus.deleteMany({ where: { orgId: { in: [ORG, VIZINHA] } } });
    await prisma.workList.deleteMany({ where: { orgId: { in: [ORG, VIZINHA] } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: [ORG, VIZINHA] } } });
    await prisma.user.deleteMany({ where: { id: { in: [EU, OUTRO] } } });
    await prisma.org.deleteMany({ where: { id: { in: [ORG, VIZINHA] } } });
    await prisma.$disconnect();
  });

  it('o modelo vira lista com as etapas, o limite e os campos — e a estrutura devolve o limite', async () => {
    const est = await svc.estrutura(ORG);
    const lista = est.listasSoltas.find((l) => l.id === listaId)!;
    expect(lista.name).toBe('Esteira de clientes');
    expect(lista.statuses.map((s) => [s.name, s.limite])).toEqual([
      ['Qualificação', null], ['Diagnóstico', null], ['Contrato', null], ['Onboarding', null],
      ['Implantação', 2], ['Operação', null], ['Encerrado', null],
    ]);
    expect(lista.fields.map((f) => f.name)).toEqual([
      'Perfil', 'Origem', 'Sistema / ERP', 'Valor do contrato (R$)', 'Próximo passo',
    ]);
    expect(lista.fields[0].options.map((o) => o.name)).toEqual([
      'P1 · conhece o ChatGPT', 'P2 · tem sistema e base', 'P3 · muito dado, não cruza',
    ]);
  });

  it('pasta de outra empresa não recebe lista de modelo', async () => {
    const pastaVizinha = await prisma.workFolder.create({ data: { orgId: VIZINHA, name: 'Pasta da vizinha' } });
    await expect(
      svc.criarListaDoModelo(ORG, EU, { modelo: 'esteira-de-clientes', folderId: pastaVizinha.id }),
    ).rejects.toMatchObject({ status: 404 });
    await prisma.workFolder.delete({ where: { id: pastaVizinha.id } });
  });

  it('tarefa nova nasce com a idade carimbada pelo banco', async () => {
    const t = await tarefa();
    expect(t.statusDesde).toBeInstanceOf(Date);
  });

  it('editar título NÃO reinicia a idade; trocar etapa reinicia', async () => {
    const t = await tarefa();
    const antiga = new Date('2026-08-01T12:00:00Z');
    const preparada = await prisma.workTask.update({ where: { id: t.id }, data: { statusDesde: antiga } });

    const renomeada = await svc.editarTarefa(ORG, EU, t.id, { title: 'Cliente renomeado', expectedUpdatedAt: preparada.updatedAt.toISOString() });
    let agora = await prisma.workTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(agora.statusDesde?.toISOString()).toBe(antiga.toISOString());

    await svc.editarTarefa(ORG, EU, t.id, { statusId: etapa['Diagnóstico'], expectedUpdatedAt: renomeada.updatedAt });
    agora = await prisma.workTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(agora.statusDesde!.getTime()).toBeGreaterThan(antiga.getTime());
  });

  it('troca de etapa por `updateMany` fora do serviço (o caminho do checkout) também carimba', async () => {
    const t = await tarefa();
    const antiga = new Date('2026-08-01T12:00:00Z');
    await prisma.workTask.update({ where: { id: t.id }, data: { statusDesde: antiga } });
    await prisma.workTask.updateMany({ where: { id: t.id, orgId: ORG }, data: { statusId: etapa['Contrato'] } });
    const agora = await prisma.workTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(agora.statusDesde!.getTime()).toBeGreaterThan(antiga.getTime());
  });

  it('a hora grava a etapa ATUAL e o autor, e o dia padrão é hoje em Brasília', async () => {
    vi.setSystemTime(new Date('2026-09-16T01:30:00Z')); // 22h30 de 15/09 em Brasília
    const t = await tarefa();
    await svc.editarTarefa(ORG, EU, t.id, { statusId: etapa['Implantação'], expectedUpdatedAt: t.updatedAt.toISOString() });
    const a = await svc.apontar(ORG, EU, t.id, { minutos: 90, nota: 'Instalação do MCP' });
    expect(a).toMatchObject({ minutos: 90, etapa: 'Implantação', autorNome: 'Rodrigo', autorId: EU, dia: '2026-09-15' });
  });

  it('soma na lista (por tarefa) e no detalhe (por etapa, na ordem em que o cliente andou)', async () => {
    const t = await tarefa();
    const outra = await tarefa('Cliente sem horas');
    await svc.apontar(ORG, EU, t.id, { minutos: 60, dia: '2026-09-01' });
    await svc.editarTarefa(ORG, EU, t.id, { statusId: etapa['Diagnóstico'], expectedUpdatedAt: t.updatedAt.toISOString() });
    await svc.apontar(ORG, OUTRO, t.id, { minutos: 45, dia: '2026-09-02' });
    await svc.apontar(ORG, EU, t.id, { minutos: 30, dia: '2026-09-03' });

    const lista = await svc.tarefas(ORG, { listId: listaId });
    expect(lista.items.find((x) => x.id === t.id)?.minutos).toBe(135);
    expect(lista.items.find((x) => x.id === outra.id)?.minutos).toBe(0);

    const detalhe = await svc.tarefa(ORG, t.id);
    expect(detalhe.minutos).toBe(135);
    expect(detalhe.minutosPorEtapa).toEqual([
      { etapa: 'Qualificação', minutos: 60 },
      { etapa: 'Diagnóstico', minutos: 75 },
    ]);
    expect(detalhe.apontamentos.map((x) => x.dia)).toEqual(['2026-09-03', '2026-09-02', '2026-09-01']);
    expect(detalhe.atividade.some((x) => x.action === 'work.time.create')).toBe(true);
  });

  it('recusa dia no futuro, dia que não existe e tarefa de outra empresa', async () => {
    vi.setSystemTime(new Date('2026-09-16T01:30:00Z')); // ainda 15/09 em Brasília
    const t = await tarefa();
    await expect(svc.apontar(ORG, EU, t.id, { minutos: 30, dia: '2026-09-16' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.apontar(ORG, EU, t.id, { minutos: 30, dia: '2026-02-31' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.apontar(VIZINHA, EU, t.id, { minutos: 30 })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.workApontamento.count({ where: { taskId: t.id } })).toBe(0);
  });

  it('só quem lançou apaga — e o apagamento fica na atividade da tarefa', async () => {
    const t = await tarefa();
    const a = await svc.apontar(ORG, EU, t.id, { minutos: 50, dia: '2026-09-10' });

    await expect(svc.apagarApontamento(ORG, OUTRO, a.id)).rejects.toMatchObject({ status: 403 });
    await expect(svc.apagarApontamento(VIZINHA, EU, a.id)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.workApontamento.count({ where: { id: a.id } })).toBe(1);

    await svc.apagarApontamento(ORG, EU, a.id);
    expect(await prisma.workApontamento.count({ where: { id: a.id } })).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { orgId: ORG, action: 'work.time.delete', entityId: t.id } });
    expect(log?.before).toMatchObject({ minutos: 50, dia: '2026-09-10' });
  });

  it('o banco recusa minutos fora de 1..1440 e limite menor que 1, mesmo sem o serviço', async () => {
    const t = await tarefa();
    for (const minutos of [0, 1441]) {
      await expect(
        prisma.workApontamento.create({
          data: { taskId: t.id, autorNome: 'x', minutos, dia: new Date('2026-09-10T00:00:00Z'), etapa: 'Qualificação' },
        }),
      ).rejects.toThrow(/WorkApontamento_minutos_no_dia/);
    }
    await expect(
      prisma.workStatus.update({ where: { id: etapa['Contrato'] }, data: { limite: 0 } }),
    ).rejects.toThrow(/WorkStatus_limite_positivo/);
  });

  it('editar o limite pela rota de etapa grava e apaga', async () => {
    await svc.editarStatus(ORG, EU, etapa['Onboarding'], { limite: 3 });
    expect((await prisma.workStatus.findUniqueOrThrow({ where: { id: etapa['Onboarding'] } })).limite).toBe(3);
    await svc.editarStatus(ORG, EU, etapa['Onboarding'], { limite: null });
    expect((await prisma.workStatus.findUniqueOrThrow({ where: { id: etapa['Onboarding'] } })).limite).toBeNull();
  });
});
