import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService, ehPreVisualizacao } from '../src/comercial/sala.service';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import type { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * REVISÃO ADVERSARIAL, P3 DA SALA E DO CANAL (lane G/P3-servidor, 13/10/2026).
 *
 * B-10: o kickoff remarcado leva o horário novo ao grupo (o M8 tem o horário
 *       na chave) e o M8 de antes, que ainda não saiu, fica vetado.
 * B-11: a pré-visualização do link lê o estado da sala sem contar visita.
 *
 * A porta é um dublê que retém; o banco é o descartável.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, eventos, salas e mensagens do comercial)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';
process.env.PUBLIC_BASE_URL ??= 'http://sala.teste';

const MARCA = `p3c${Date.now().toString(36).slice(-6)}`;
const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
const p = prisma as unknown as PrismaService;
let ORG = '';
let sala: SalaService;
let whats: WhatsappComercialService;
let n = 0;
const porta = { executar: vi.fn(async () => ({ status: 'aguardando_aprovacao', approvalId: `ap-${MARCA}-${++n}` })) };

describe('B-11, a regra pura', () => {
  it('reconhece quem monta a pré-visualização e os robôs; o navegador de gente não', () => {
    expect(ehPreVisualizacao('WhatsApp/2.23.20.0 A')).toBe(true);
    expect(ehPreVisualizacao('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true);
    expect(ehPreVisualizacao('TelegramBot (like TwitterBot)')).toBe(true);
    expect(ehPreVisualizacao('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(ehPreVisualizacao('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(ehPreVisualizacao('Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 Chrome/118.0 Mobile Safari/537.36')).toBe(false);
    expect(ehPreVisualizacao(null)).toBe(false);
  });
});

describe.skipIf(!URL)('revisão P3 da sala e do canal, contra o banco', () => {
  beforeAll(async () => {
    const org = await prisma.org.create({ data: { name: `P3 canal ${MARCA}`, slug: `p3-canal-${MARCA}` } });
    ORG = org.id;
    const reacoes = new ReacoesRegistry();
    const fio = new FioService(p, reacoes);
    sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    whats = new WhatsappComercialService(p, fio, reacoes, new RelogioComercialRegistry(), sala, new EfeitosRegistry(), porta as unknown as PortaDoOperador);
    whats.onModuleInit();
  });

  afterAll(async () => {
    if (ORG) {
      const ids = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
      await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.salaDoCliente.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.lead.deleteMany({ where: { orgId: ORG } });
      await prisma.org.delete({ where: { id: ORG } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('B-10: remarcado, sai um M8 novo com o horário novo e o de antes, ainda na fila, fica vetado', async () => {
    const lead = await prisma.lead.create({ data: { orgId: ORG, name: 'Marina Duarte', phone: `55329${Date.now().toString().slice(-8)}` } });
    const jid = `grupo-${MARCA}@g.us`;
    const a = await whats.enviarM8(ORG, lead.id, jid, { equipe: '[a decidir]', kickoff: 'ter., 20/10, 10:00' });
    expect(a.estado).toBe('na_fila');
    const b = await whats.enviarM8(ORG, lead.id, jid, { equipe: '[a decidir]', kickoff: 'qua., 21/10, 15:00' });
    expect(b.mensagemId).not.toBe(a.mensagemId);
    expect(b.estado).toBe('na_fila');
    const velho = await prisma.comercialMensagem.findUniqueOrThrow({ where: { id: a.mensagemId } });
    const novo = await prisma.comercialMensagem.findUniqueOrThrow({ where: { id: b.mensagemId } });
    expect(velho.estado).toBe('vetada');
    expect(velho.erro).toContain('remarcado');
    expect(novo.texto).toContain('21/10');
    // O mesmo horário de novo não cria outro nem veta o vigente.
    const c = await whats.enviarM8(ORG, lead.id, jid, { equipe: '[a decidir]', kickoff: 'qua., 21/10, 15:00' });
    expect(c.mensagemId).toBe(b.mensagemId);
    expect((await prisma.comercialMensagem.findUniqueOrThrow({ where: { id: b.mensagemId } })).estado).toBe('na_fila');
  });

  it('B-11: a pré-visualização do WhatsApp lê a sala sem contar acesso nem gravar visita; o navegador conta', async () => {
    const lead = await prisma.lead.create({ data: { orgId: ORG, name: 'Carla Lima', phone: `55319${Date.now().toString().slice(-8)}` } });
    const token = (/\/s\/([A-Za-z0-9_-]{40,48})/.exec((await sala.garantir(ORG, lead.id)).link ?? (await sala.linkDoLead(ORG, lead.id)) ?? '') ?? [])[1];
    expect(token).toBeTruthy();
    const visitas = () => prisma.leadEvent.count({ where: { leadId: lead.id, type: 'sala.visitada' } });
    const acessos = async () => (await prisma.salaDoCliente.findUniqueOrThrow({ where: { leadId: lead.id } })).acessos;
    const antes = await acessos();
    const e = await sala.estado(token, new Date(), { userAgent: 'WhatsApp/2.23.20.0 A' });
    expect(e.estagio).toBeTruthy();
    expect(await acessos()).toBe(antes);
    expect(await visitas()).toBe(0);
    await sala.estado(token, new Date(), { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' });
    expect(await acessos()).toBe(antes + 1);
    expect(await visitas()).toBe(1);
  });
});
