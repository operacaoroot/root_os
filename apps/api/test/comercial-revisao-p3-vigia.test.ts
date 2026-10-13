/**
 * REVISÃO ADVERSARIAL, P3 DO VIGIA (lane G/P3-servidor, 13/10/2026).
 *
 *   · E-23: uma premissa quebrada abre UMA decisão por premissa por dia, com a
 *     lista de leads, não uma por lead.
 *   · E-22: a passagem manual antes das 08:00 não cala a das 08:00.
 *
 * Os serviços de verdade, montados à mão, no banco descartável; a memória é
 * um dublê em memória.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigComercialService } from '../src/comercial/config.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { VigiaService, leadDaDecisao, passagemDasOitoDeHoje } from '../src/comercial/vigia.service';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, eventos, fichas e decisões do comercial)');

const MARCA = `p3v${Date.now().toString(36).slice(-6)}`;
const FUSO = 'America/Sao_Paulo';

/** A memória em memória: porChave, criar, alterar, restaurar (o que as notas do comercial usam). */
function memoriaDeTeste() {
  const notas = new Map<string, { id: string; chave: string; body: string; versao: number; arquivadoEm: null }>();
  let seq = 0;
  const m = {
    notas,
    porChave: async (_o: string, chave: string) => notas.get(chave) ?? null,
    criar: async (_o: string, e: { chave: string; body: string }) => {
      const n = { id: `n${++seq}`, chave: e.chave, body: e.body, versao: 1, arquivadoEm: null as null };
      notas.set(n.chave, n);
      return n;
    },
    alterar: async (_o: string, id: string, e: { body: string }) => {
      const n = [...notas.values()].find((x) => x.id === id)!;
      n.body = e.body;
      n.versao += 1;
      return n;
    },
    restaurar: async (_o: string, id: string) => [...notas.values()].find((x) => x.id === id)!,
  };
  return m;
}

describe('E-22 e E-23, a regra pura', () => {
  it('a passagem gravada antes das 08:00 não é a das 08:00; a das 08:00 ou depois é', () => {
    expect(passagemDasOitoDeHoje(null, '2026-10-14', FUSO)).toBe(false);
    expect(passagemDasOitoDeHoje({ dia: '2026-10-14', em: '2026-10-14T10:30:00.000Z' }, '2026-10-14', FUSO)).toBe(false); // 07:30 em SP
    expect(passagemDasOitoDeHoje({ dia: '2026-10-14', em: '2026-10-14T11:00:00.000Z' }, '2026-10-14', FUSO)).toBe(true); // 08:00 em SP
    expect(passagemDasOitoDeHoje({ dia: '2026-10-13', em: '2026-10-13T15:00:00.000Z' }, '2026-10-14', FUSO)).toBe(false);
    expect(passagemDasOitoDeHoje({ dia: '2026-10-14', em: 'torto' }, '2026-10-14', FUSO)).toBe(false);
  });
  it('a decisão da premissa se pendura sempre no mesmo lead, qualquer que seja a ordem', () => {
    expect(leadDaDecisao(['c', 'a', 'b'])).toBe('a');
    expect(leadDaDecisao(['b', 'c', 'a'])).toBe('a');
    expect(leadDaDecisao([])).toBeNull();
  });
});

describe.skipIf(!URL)('revisão P3 do vigia, contra o banco', { timeout: 30_000 }, () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  let fichas: FichaService;
  let vigia: VigiaService;
  const memoria = memoriaDeTeste();

  beforeAll(async () => {
    const org = await prisma.org.create({ data: { name: `P3 vigia ${MARCA}`, slug: `p3-vigia-${MARCA}` } });
    ORG = org.id;
    const reacoes = new ReacoesRegistry();
    const fio = new FioService(p, reacoes);
    const config = new ConfigComercialService(p);
    const decisoes = new DecisoesService(p, fio, config, new DecisoesRegistry());
    fichas = new FichaService(p, fio, config);
    vigia = new VigiaService(p, fio, decisoes, config, new RelogioComercialRegistry(), memoria as unknown as MemoriaService);
  });

  afterAll(async () => {
    if (ORG) {
      const leads = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
      await prisma.comercialReacao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.lead.deleteMany({ where: { orgId: ORG } });
      await prisma.org.deleteMany({ where: { id: ORG } });
    }
    await prisma.$disconnect();
  });

  it('E-23: três leads com o status renomeado abrem UMA decisão com os três; o fato vai ao fio de cada um', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const lead = await prisma.lead.create({ data: { orgId: ORG, name: `Lead ${MARCA} ${i}`, phone: `55329${Date.now().toString().slice(-7)}${i}` } });
      await fichas.garantir(ORG, lead.id);
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'ganho' } });
      ids.push(lead.id);
    }
    const agora = new Date();
    const passagem = await vigia.passar(ORG, agora);
    const quebrada = passagem.premissas.find((x) => x.chave === 'status_segue_etapa')!;
    expect(quebrada.ok).toBe(false);
    expect([...quebrada.leads].sort()).toEqual([...ids].sort());
    const decisoes = await prisma.comercialDecisao.findMany({ where: { lead: { orgId: ORG }, tipo: 'excecao_do_vigia' } });
    expect(decisoes).toHaveLength(1);
    expect(decisoes[0].leadId).toBe([...ids].sort()[0]);
    expect((decisoes[0].dados as { leads: string[] }).leads).toEqual([...ids].sort());
    expect(decisoes[0].titulo).toContain('(3 leads)');
    expect(passagem.decisoesAbertas).toBe(1);
    for (const id of ids) expect(await prisma.leadEvent.count({ where: { leadId: id, type: 'vigia.premissa' } })).toBe(1);
    // A segunda passagem do mesmo dia não abre outra.
    expect((await vigia.passar(ORG, agora)).decisoesAbertas).toBe(0);
    expect(await prisma.comercialDecisao.count({ where: { lead: { orgId: ORG }, tipo: 'excecao_do_vigia' } })).toBe(1);
  });

  it('E-22: a passagem manual às 07:30 não cala a das 08:00 do mesmo dia; a das 08:00 cala o resto do dia', async () => {
    memoria.notas.delete('comercial.vigia');
    await vigia.passar(ORG, new Date('2026-10-20T07:30:00-03:00'));
    expect(await vigia.talvezPassar(ORG, new Date('2026-10-20T07:59:00-03:00'))).toBe(0);
    expect(await vigia.talvezPassar(ORG, new Date('2026-10-20T08:00:00-03:00'))).toBe(1);
    expect(await vigia.talvezPassar(ORG, new Date('2026-10-20T08:05:00-03:00'))).toBe(0);
    // Num processo novo (sem a memória do processo), a nota das 08:00 basta.
    const outro = new VigiaService(p, new FioService(p, new ReacoesRegistry()), {} as never, new ConfigComercialService(p), new RelogioComercialRegistry(), memoria as unknown as MemoriaService);
    expect(await outro.talvezPassar(ORG, new Date('2026-10-20T09:00:00-03:00'))).toBe(0);
  });
});
