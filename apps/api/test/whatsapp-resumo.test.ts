import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ResumoDoWhatsappController } from '../src/whatsapp/resumo.controller';
import { ResumoDoWhatsappService, VALIDADE_DO_RESUMO_MS } from '../src/whatsapp/resumo.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O RESUMO DO WHATSAPP (produção 22C, W4): o cartão do Dia a dia e a bolha do
 * menu. Contagens com conversas fictícias, arquivada fora, equipe separada, o
 * cache de 30 s e o isolamento entre empresas. Tudo fictício: números da faixa
 * 55329000000xx, nomes de exemplo.
 */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-whatsapp-resumo';
const VIZINHA = 'org-teste-whatsapp-resumo-vizinha';
const INST = 'instancia-de-teste';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (conversas de WhatsApp, leads e clientes fictícios)');

describe.skipIf(!URL)('GET /whatsapp/resumo', () => {
  let prisma: PrismaClient;
  let servico: ResumoDoWhatsappService;
  let relogio = Date.parse('2026-10-22T13:00:00Z');
  let leadId = '';
  let clienteId = '';
  let seq = 0;

  async function conversa(orgId: string, d: { naoLidas: number; equipe?: boolean; lead?: boolean; cliente?: boolean; arquivada?: boolean; grupo?: boolean }) {
    seq += 1;
    return prisma.whatsAppConversa.create({
      data: {
        orgId,
        instancia: INST,
        chatJid: d.grupo ? `1203630000000${String(seq).padStart(5, '0')}@g.us` : `55329000${String(seq).padStart(5, '0')}@s.whatsapp.net`,
        grupo: !!d.grupo,
        nome: `Conversa de exemplo ${seq}`,
        naoLidas: d.naoLidas,
        equipe: !!d.equipe,
        leadId: d.lead && orgId === ORG ? leadId : null,
        clienteId: d.cliente && orgId === ORG ? clienteId : null,
        arquivadaEm: d.arquivada ? new Date('2026-10-21T12:00:00Z') : null,
      },
    });
  }

  async function limpar() {
    await prisma.whatsAppConversa.deleteMany({ where: { orgId: { in: [ORG, VIZINHA] } } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const orgId of [ORG, VIZINHA]) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    await limpar();
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.partner.deleteMany({ where: { orgId: ORG } });
    leadId = (await prisma.lead.create({ data: { orgId: ORG, name: 'Lead de Exemplo' } })).id;
    clienteId = (await prisma.partner.create({ data: { orgId: ORG, razaoSocial: 'Cliente de Exemplo Ltda', isCliente: true } })).id;
  });

  beforeEach(async () => {
    await limpar();
    servico = new ResumoDoWhatsappService(prisma as unknown as PrismaService);
    servico.agora = () => relogio;
  });

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.partner.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: { in: [ORG, VIZINHA] } } });
    await prisma.$disconnect();
  });

  it('a rota pede leads.ver', () => {
    const exige = Reflect.getMetadata(PERMISSIONS_KEY, ResumoDoWhatsappController.prototype.ler);
    expect(exige).toEqual(['leads.ver']);
  });

  it('empresa sem conversa: tudo zero', async () => {
    const r = await servico.doResumo(ORG);
    expect(r.naoLidas).toEqual({ leads: 0, clientes: 0, semVinculo: 0, equipe: 0, comunidade: 0, total: 0 });
    expect(r.conversasSemVinculo).toBe(0);
    expect(new Date(r.geradoEm).getTime()).toBe(relogio);
  });

  it('conta por faixa, sem sobrepor: equipe separada (vence o lead), arquivada fora', async () => {
    await conversa(ORG, { naoLidas: 3, lead: true });
    await conversa(ORG, { naoLidas: 2, lead: true, grupo: true });
    await conversa(ORG, { naoLidas: 4, cliente: true, grupo: true });
    await conversa(ORG, { naoLidas: 0, cliente: true });
    await conversa(ORG, { naoLidas: 5 }); // sem vínculo, com não lidas
    await conversa(ORG, { naoLidas: 0, grupo: true }); // sem vínculo, lida
    await conversa(ORG, { naoLidas: 7, equipe: true, grupo: true });
    await conversa(ORG, { naoLidas: 1, equipe: true, lead: true }); // equipe vence o lead
    await conversa(ORG, { naoLidas: 9, arquivada: true }); // arquivada: fora de tudo
    await conversa(ORG, { naoLidas: 6, arquivada: true, lead: true });
    await conversa(ORG, { naoLidas: 8, arquivada: true, equipe: true });

    const r = await servico.doResumo(ORG);
    expect(r.naoLidas).toEqual({ leads: 5, clientes: 4, semVinculo: 5, equipe: 8, comunidade: 0, total: 22 });
    // Conversas sem vínculo: as duas fora da equipe, sem lead e sem cliente, não arquivadas.
    expect(r.conversasSemVinculo).toBe(2);
  });

  it('o banco não deixa uma conversa ter lead e cliente ao mesmo tempo (as faixas não se sobrepõem)', async () => {
    await expect(conversa(ORG, { naoLidas: 1, lead: true, cliente: true })).rejects.toThrow(/vinculo_check/);
  });

  it('guarda 30 s por empresa; depois mede de novo; esquecer mede na hora', async () => {
    await conversa(ORG, { naoLidas: 2 });
    const a = await servico.doResumo(ORG);
    expect(a.naoLidas.total).toBe(2);

    await conversa(ORG, { naoLidas: 3, lead: true });
    relogio += VALIDADE_DO_RESUMO_MS - 1;
    const b = await servico.doResumo(ORG);
    expect(b).toEqual(a); // ainda o guardado, com a hora de quando foi medido

    relogio += 1;
    const c = await servico.doResumo(ORG);
    expect(c.naoLidas).toMatchObject({ leads: 3, semVinculo: 2, total: 5 });
    expect(new Date(c.geradoEm).getTime()).toBe(relogio);

    await conversa(ORG, { naoLidas: 1, cliente: true });
    expect((await servico.doResumo(ORG)).naoLidas.total).toBe(5);
    servico.esquecer(ORG);
    expect((await servico.doResumo(ORG)).naoLidas.total).toBe(6);
  });

  it('duas leituras ao mesmo tempo dividem a mesma medição', async () => {
    await conversa(ORG, { naoLidas: 1 });
    let medicoes = 0;
    const real = prisma.whatsAppConversa.aggregate.bind(prisma.whatsAppConversa);
    const contado = {
      whatsAppConversa: {
        aggregate: (...args: Parameters<typeof real>) => {
          medicoes += 1;
          return real(...args);
        },
      },
    };
    const s = new ResumoDoWhatsappService(contado as unknown as PrismaService);
    s.agora = () => relogio;
    const [x, y] = await Promise.all([s.doResumo(ORG), s.doResumo(ORG)]);
    expect(x).toEqual(y);
    expect(medicoes).toBe(4); // uma medição = quatro agregações, e nenhuma linha trazida
  });

  it('medição que falha não fica guardada', async () => {
    let falhar = true;
    const real = prisma.whatsAppConversa.aggregate.bind(prisma.whatsAppConversa);
    const instavel = {
      whatsAppConversa: {
        aggregate: (...args: Parameters<typeof real>) => (falhar ? Promise.reject(new Error('banco fora')) : real(...args)),
      },
    };
    const s = new ResumoDoWhatsappService(instavel as unknown as PrismaService);
    s.agora = () => relogio;
    await expect(s.doResumo(ORG)).rejects.toThrow('banco fora');
    falhar = false;
    await conversa(ORG, { naoLidas: 4, lead: true });
    expect((await s.doResumo(ORG)).naoLidas.leads).toBe(4);
  });

  it('isolamento: cada empresa vê só as próprias conversas, e o cache é por empresa', async () => {
    await conversa(ORG, { naoLidas: 2 });
    await conversa(VIZINHA, { naoLidas: 10 });
    await conversa(VIZINHA, { naoLidas: 1, equipe: true });

    const minha = await servico.doResumo(ORG);
    const dela = await servico.doResumo(VIZINHA);
    expect(minha.naoLidas).toEqual({ leads: 0, clientes: 0, semVinculo: 2, equipe: 0, comunidade: 0, total: 2 });
    expect(minha.conversasSemVinculo).toBe(1);
    expect(dela.naoLidas).toEqual({ leads: 0, clientes: 0, semVinculo: 10, equipe: 1, comunidade: 0, total: 11 });
    expect(dela.conversasSemVinculo).toBe(1);
    // A empresa sem conversa nenhuma não herda o guardado da outra.
    expect((await servico.doResumo('org-teste-whatsapp-resumo-inexistente')).naoLidas.total).toBe(0);
  });
});
