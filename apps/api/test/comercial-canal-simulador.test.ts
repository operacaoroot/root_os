import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { JwtUser } from '../src/auth/current-user.decorator';
import type { DecisoesService } from '../src/comercial/decisoes.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { SimuladorController } from '../src/comercial/simulador.controller';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import type { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O SIMULADOR (Lane B): as rotas internas dos celulares, pelo controller, com
 * banco. O lead entra, o celular mostra a M1 com o formulário, o lead responde
 * o formulário e toca no horário, e a mesa vê o que espera o toque. A porta é
 * um dublê que retém (a régua de verdade está em `comercial-canal-porta`).
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, eventos, salas e mensagens do comercial)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';

const MARCA = `sm${Date.now().toString(36).slice(-6)}`;
const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
const p = prisma as unknown as PrismaService;
let ORG = '';
let user: JwtUser;
let ctrl: SimuladorController;
let whats: WhatsappComercialService;
const decisoes = { responder: vi.fn(async () => ({ ok: true, resultados: [] })) };
let n = 0;
const porta = { executar: vi.fn(async () => ({ status: 'aguardando_aprovacao', approvalId: `ap-${++n}` })) };

beforeAll(async () => {
  const org = await prisma.org.create({ data: { name: `Simulador ${MARCA}`, slug: `sim-${MARCA}` } });
  ORG = org.id;
  user = { sub: `u-${MARCA}`, orgId: ORG, email: 'x@y.z', name: 'Rodrigo', roles: [], permissions: [] };
  const reacoes = new ReacoesRegistry();
  const fio = new FioService(p, reacoes);
  const sala = new SalaService(p, fio, reacoes);
  sala.onModuleInit();
  whats = new WhatsappComercialService(p, fio, reacoes, new RelogioComercialRegistry(), sala, new EfeitosRegistry(), porta as unknown as PortaDoOperador);
  whats.onModuleInit();
  ctrl = new SimuladorController(p, whats, sala, decisoes as unknown as DecisoesService);
});

afterAll(async () => {
  if (ORG) {
    const ids = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
    await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.salaDoCliente.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.org.delete({ where: { id: ORG } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('os celulares do simulador', () => {
  let leadId = '';

  it('entrada inválida é 400; a válida cria o lead e o celular mostra a M1 com o formulário', async () => {
    await expect(ctrl.entrada(user, { telefone: 'abc', texto: 'oi' })).rejects.toMatchObject({ status: 400 });
    const r = await ctrl.entrada(user, { telefone: `+55329${Date.now().toString().slice(-8)}`, texto: 'Oi! Funciona com Omie?', nome: 'Marina Duarte' });
    leadId = r.leadId;
    const lista = await ctrl.celulares(user);
    expect(lista.provedor).toBe('simulado');
    expect(lista.leads.find((l) => l.leadId === leadId)).toMatchObject({ nome: 'Marina Duarte', naFila: 1 });
    const c = await ctrl.conversa(user, leadId);
    expect(c.linkDaSala).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
    expect(c.mensagens.map((m) => [m.direcao, m.template])).toEqual([
      ['entrada', null],
      ['saida', 'M1'],
    ]);
    expect(c.mensagens[1].interativo?.formulario?.campos).toHaveLength(4);
    expect(c.mensagens[1].estado).toBe('na_fila');
  });

  it('responder pede exatamente um campo; o formulário vira form.respondido e a M2 com botões', async () => {
    await expect(ctrl.responder(user, leadId, { texto: 'a', botao: 'b' })).rejects.toMatchObject({ status: 400 });
    await ctrl.responder(user, leadId, { formulario: { sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento leva 9 dias', equipeFinanceiro: 3 } });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'form.respondido' } })).toBe(1);
    const c = await ctrl.conversa(user, leadId);
    const resumo = c.mensagens.find((m) => m.direcao === 'entrada' && m.texto.startsWith('Sistema: Omie'));
    expect(resumo).toBeTruthy();
    const m2 = c.mensagens.find((m) => m.template === 'M2')!;
    expect(m2.interativo?.botoes).toHaveLength(2);

    await ctrl.responder(user, leadId, { botao: m2.interativo!.botoes![0].chave });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'agenda.escolhida' } })).toBe(1);
    await ctrl.responder(user, leadId, { texto: 'Combinado, até lá.' });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } })).toBe(2);
  });

  it('a mesa vê as mensagens esperando o toque e responde a decisão pelo serviço da espinha', async () => {
    const mesa = await ctrl.mesa(user);
    expect(mesa.mensagensNaFila.filter((m) => m.leadId === leadId).map((m) => m.template).sort()).toEqual(['M1', 'M2']);
    const decisaoId = '00000000-0000-4000-8000-000000000001';
    await ctrl.mesaResponder(user, { decisaoId, escolha: 'manter' });
    expect(decisoes.responder).toHaveBeenCalledWith(ORG, decisaoId, 'manter', { id: user.sub, nome: 'Rodrigo' }, 'simulado', null);
  });

  it('o VETO só vale na janela; a novidade do M6 é obrigatória', async () => {
    const m1 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M1' } });
    await expect(ctrl.vetar(user, m1.id)).rejects.toMatchObject({ status: 400 });
    await expect(ctrl.novidade(user, m1.id, { novidade: 'curta' })).rejects.toMatchObject({ status: 400 });
  });

  it('lead de outra empresa não aparece', async () => {
    const outro = { ...user, orgId: '00000000-0000-4000-8000-0000000000ff' };
    await expect(ctrl.conversa(outro, leadId)).rejects.toMatchObject({ status: 404 });
  });
});
