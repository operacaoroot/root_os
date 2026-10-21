import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ROSTER_DO_ONBOARDING } from '../src/agents/roster';
import { EventLogService } from '../src/gateway/event-log.service';
import { MARCOS_DO_AGENTE, QUEM_E_O_RELOGIO, montarQuemTrabalha } from '../src/onboarding/trilho/quem-trabalha';
import { SLUG_DA_ROTINA_DO_RELOGIO, TIPO_DA_ROTINA_DO_RELOGIO, TrilhoService } from '../src/onboarding/trilho/trilho.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * QUEM TRABALHA NESTA ETAPA (rodada de produção 1, 21/10/2026): o painel do card da
 * implantação lista os agentes do roster do onboarding e o relógio, com o último fato
 * de cada um neste cliente e o que vai fazer. Só leitura, nada inventado.
 */

const trilho = { id: 't1', fase: 'contrato', faseRotulo: 'Contrato e onboarding' };

describe('quem trabalha nesta etapa: a parte pura', () => {
  it('os três agentes do roster, na ordem; o último marco de cada um; sem marco, "ainda não rodou"', () => {
    const r = montarQuemTrabalha({
      trilho,
      roster: ROSTER_DO_ONBOARDING,
      estados: new Map([['leitor-de-ata', 'ativo'], ['pesquisador-de-conta', 'ativo'], ['roteirista-de-kickoff', 'pausado']]),
      marcos: [
        { tipo: 'ata.lida', texto: 'Ata lida (texto): 3 proposta(s)', em: new Date('2026-10-10T13:00:00Z'), quem: 'Rodrigo' },
        { tipo: 'ata.lida', texto: 'Ata lida (pdf): 5 proposta(s)', em: new Date('2026-10-12T13:00:00Z'), quem: 'Rodrigo' },
        { tipo: 'check.semanal', texto: 'check feito à mão', em: new Date('2026-10-13T13:00:00Z'), quem: 'Lucas' },
        { tipo: 'sem-proximo-passo', texto: 'Cliente: sem próximo passo', em: new Date('2026-10-11T12:00:00Z'), quem: QUEM_E_O_RELOGIO },
      ],
      rotina: { ativo: true, proximaExecucaoEm: new Date('2026-10-22T12:00:00Z') },
      pendencias: [{ texto: 'Cliente: sem próximo passo com dono e data.' }],
    });
    expect(r.agentes.map((a) => [a.slug, a.estado])).toEqual([['leitor-de-ata', 'ativo'], ['pesquisador-de-conta', 'ativo'], ['roteirista-de-kickoff', 'pausado']]);
    expect(r.agentes[0].ultimoFato).toEqual({ texto: 'Ata lida (pdf): 5 proposta(s)', em: '2026-10-12T13:00:00.000Z' });
    expect(r.agentes[0].oQueVaiFazer).toMatch(/^Já rodou neste cliente\. Roda de novo com uma ata de kickoff/);
    expect(r.agentes[1].ultimoFato).toBeNull();
    expect(r.agentes[1].oQueVaiFazer).toMatch(/^Ainda não rodou neste cliente\. Roda com a reunião marcada/);
    expect(r.agentes[2].oQueVaiFazer).toBe('Está pausado: não roda até o dono ligar de novo em Agentes.');
    // O check semanal feito por gente não é fato do relógio.
    expect(r.relogio).toEqual({
      nome: 'Relógio do onboarding', ligado: true, proximaPassagemEm: '2026-10-22T12:00:00.000Z',
      ultimoFato: { texto: 'Cliente: sem próximo passo', em: '2026-10-11T12:00:00.000Z' },
      vaiFazer: ['Cliente: sem próximo passo com dono e data.'],
    });
    for (const a of ROSTER_DO_ONBOARDING) expect(MARCOS_DO_AGENTE[a.slug], a.slug).toBeTruthy();
  });

  it('agente não semeado e relógio desligado: diz isso, sem data inventada', () => {
    const r = montarQuemTrabalha({ trilho, roster: ROSTER_DO_ONBOARDING, estados: new Map(), marcos: [], rotina: { ativo: false, proximaExecucaoEm: new Date() }, pendencias: [{ texto: 'x' }] });
    expect(r.agentes.every((a) => a.estado === 'ausente' && /Não está semeado/.test(a.oQueVaiFazer))).toBe(true);
    expect([r.relogio.ligado, r.relogio.proximaPassagemEm, r.relogio.vaiFazer, r.relogio.ultimoFato]).toEqual([false, null, [], null]);
    expect(montarQuemTrabalha({ trilho, roster: [], estados: new Map(), marcos: [], rotina: null, pendencias: [] }).relogio.ligado).toBe(false);
  });
});

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresa, trilho, marcos, agentes e rotina de teste)');

const MARCA = `qt${Date.now().toString(36).slice(-6)}`;
const ORG = `org-quem-trabalha-${MARCA}`;

describe.skipIf(!URL)('quem trabalha nesta etapa, contra o Postgres', { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let svc: TrilhoService;
  let trilhoId = '';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    const p = prisma as unknown as PrismaService;
    await prisma.org.create({ data: { id: ORG, name: `Quem trabalha ${MARCA}`, slug: `quem-trabalha-${MARCA}` } });
    svc = new TrilhoService(p, undefined as never, new EventLogService(p), undefined as never);
    trilhoId = (await prisma.onboardingTrilho.create({ data: { orgId: ORG, cliente: 'Cliente Sintético', slug: `cliente-${MARCA}`, fase: 'contrato', proximoPasso: 'marcar a imersão', proximoPassoEm: new Date('2026-01-01T12:00:00Z') }, select: { id: true } })).id;
    await prisma.onboardingMarco.createMany({
      data: [
        { orgId: ORG, trilhoId, tipo: 'dossie.gerado', texto: 'Dossiê gerado: 4 afirmação(ões)', dados: {}, quem: 'Rodrigo', em: new Date('2026-10-01T12:00:00Z') },
        { orgId: ORG, trilhoId, tipo: 'proximo-passo.vencido', texto: 'Cliente Sintético: o próximo passo venceu', dados: {}, quem: QUEM_E_O_RELOGIO, em: new Date('2026-10-02T12:00:00Z') },
      ],
    });
    await prisma.agent.create({ data: { orgId: ORG, slug: 'pesquisador-de-conta', nome: 'Pesquisador de conta', missao: 'x', estado: 'ativo', capacidades: [] } });
    await prisma.rotina.create({ data: { orgId: ORG, slug: SLUG_DA_ROTINA_DO_RELOGIO, nome: 'Relógio do onboarding', tipo: TIPO_DA_ROTINA_DO_RELOGIO, config: { nDiasSemUso: 7 }, cron: '0 9 * * *', tz: 'America/Sao_Paulo', ativo: true, proximaExecucaoEm: new Date('2026-10-22T12:00:00Z') } });
  });

  afterAll(async () => {
    await prisma.onboardingMarco.deleteMany({ where: { orgId: ORG } });
    await prisma.onboardingTrilho.deleteMany({ where: { orgId: ORG } });
    await prisma.rotina.deleteMany({ where: { orgId: ORG } });
    await prisma.agent.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  it('lê o que está gravado: estado dos agentes, último marco, relógio e a pendência de agora', async () => {
    const r = await svc.quemTrabalha(ORG, trilhoId, new Date('2026-10-21T12:00:00Z'));
    expect(r.faseRotulo).toBe('2 · Contrato e onboarding');
    expect(r.agentes.map((a) => [a.slug, a.estado, a.ultimoFato?.texto ?? null])).toEqual([
      ['leitor-de-ata', 'ausente', null],
      ['pesquisador-de-conta', 'ativo', 'Dossiê gerado: 4 afirmação(ões)'],
      ['roteirista-de-kickoff', 'ausente', null],
    ]);
    expect(r.relogio.ligado).toBe(true);
    expect(r.relogio.ultimoFato?.texto).toBe('Cliente Sintético: o próximo passo venceu');
    expect(r.relogio.vaiFazer.some((t) => /venceu/.test(t))).toBe(true);
    await expect(svc.quemTrabalha(ORG, 'trilho-de-outra-empresa')).rejects.toMatchObject({ status: 404 });
  });
});
