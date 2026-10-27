import 'reflect-metadata';

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CODIGO_LEAD_COM_OUTRO_TELEFONE } from '@mktos/shared';

import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { vincularConversas } from '../src/scripts/vincular-conversas';
import { ACAO_DE_AUDITORIA } from '../src/whatsapp/vinculo';
import { VinculoDoWhatsappService } from '../src/whatsapp/vinculo.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O VÍNCULO DA CONVERSA CONTRA O POSTGRES (produção 22C, W3). Tudo FICTÍCIO:
 * nomes inventados, números no DDD 32 com finais 0001…0099 que não são de ninguém.
 *
 *  · 1:1 casa sozinho pelo telefone do lead e do cliente, com e sem o 55; sem o
 *    9 não casa; dois com o mesmo número não casam; número da equipe é equipe;
 *  · grupo SÓ SUGERE pelo nome igual (nunca liga); um clique aceita; parecido
 *    não sugere;
 *  · manual, 409, desvincular limpa as mensagens, o casamento não refaz o que a
 *    pessoa decidiu; 403 para máquina e para quem só lê; 404 entre empresas;
 *  · pôr o número no lead; editar o telefone casa de novo;
 *  · o fio do lead sem duplicata; o WhatsApp do cliente; o script simular/valer.
 */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-whatsapp-vinculo-w3';
const ORG2 = 'org-teste-whatsapp-vinculo-w3-b';
const INST = 'instancia-ficticia';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, leads, clientes, conversas, mensagens e auditoria)');

const jid = (n: string) => `${n}@s.whatsapp.net`;

describe.skipIf(!URL)('o vínculo da conversa contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: VinculoDoWhatsappService;
  let fio: FioService;
  type Quem = { id: string; papeis: string[] };
  let gente: Quem;
  let maquina: Quem;
  let leitor: Quem;
  let emailDaGente: string;

  async function limpar() {
    for (const org of [ORG, ORG2]) {
      await prisma.whatsAppMensagem.deleteMany({ where: { orgId: org } });
      await prisma.whatsAppConversa.deleteMany({ where: { orgId: org } });
      const leads = (await prisma.lead.findMany({ where: { orgId: org }, select: { id: true } })).map((l) => l.id);
      await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.lead.deleteMany({ where: { orgId: org } });
      await prisma.partner.deleteMany({ where: { orgId: org } });
      await prisma.channelIdentity.deleteMany({ where: { orgId: org } });
      await prisma.auditLog.deleteMany({ where: { orgId: org } });
    }
  }

  async function lead(nome: string, phone: string | null = null, org = ORG) {
    return (await prisma.lead.create({ data: { orgId: org, name: nome, phone }, select: { id: true } })).id;
  }
  async function cliente(nome: string, phone: string | null = null, org = ORG, extra: { razaoSocial?: string } = {}) {
    return (await prisma.partner.create({ data: { orgId: org, isCliente: true, razaoSocial: extra.razaoSocial ?? `${nome} Ltda`, nomeFantasia: nome, phone }, select: { id: true } })).id;
  }
  async function conversa(chatJid: string, nome: string | null, grupo = false, org = ORG) {
    return (await prisma.whatsAppConversa.create({ data: { orgId: org, instancia: INST, chatJid, grupo, nome, ultimaMensagemEm: new Date() }, select: { id: true } })).id;
  }
  let seq = 0;
  async function mensagem(conversaId: string, chatJid: string, o: { deMim?: boolean; texto?: string; ext?: string; grupo?: boolean; em?: Date; org?: string } = {}) {
    seq++;
    return prisma.whatsAppMensagem.create({
      data: {
        orgId: o.org ?? ORG,
        conversaId,
        instancia: INST,
        chatJid,
        grupo: !!o.grupo,
        deMim: !!o.deMim,
        direcao: o.deMim ? 'saida' : 'entrada',
        tipo: 'conversation',
        texto: o.texto ?? `mensagem ficticia ${seq}`,
        mensagemExternaId: o.ext ?? `EXT-W3-${seq}-${Date.now()}`,
        timestamp: o.em ?? new Date(Date.now() - (100 - seq) * 1000),
        origem: 'webhook',
      },
      select: { id: true, mensagemExternaId: true },
    });
  }
  const daConversa = (id: string) => prisma.whatsAppConversa.findUniqueOrThrow({ where: { id } });
  const mensagensDe = (conversaId: string) => prisma.whatsAppMensagem.findMany({ where: { conversaId }, select: { leadId: true, clienteId: true } });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await limpar();
    for (const org of [ORG, ORG2]) {
      await prisma.user.deleteMany({ where: { orgId: org } });
      await prisma.role.deleteMany({ where: { orgId: org } });
      await prisma.org.upsert({ where: { id: org }, create: { id: org, name: org, slug: org }, update: {} });
    }
    for (const key of ['leads.ver', 'leads.editar']) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin', permissions: { connect: [{ key: 'leads.ver' }, { key: 'leads.editar' }] } }, select: { id: true } });
    const ia = await prisma.role.create({ data: { orgId: ORG, key: 'ia_acao', name: 'IA ação', permissions: { connect: [{ key: 'leads.ver' }, { key: 'leads.editar' }] } }, select: { id: true } });
    const ver = await prisma.role.create({ data: { orgId: ORG, key: 'leitor_w3', name: 'Só lê', permissions: { connect: [{ key: 'leads.ver' }] } }, select: { id: true } });
    const criar = async (papel: string, roleId: string): Promise<Quem> => ({
      id: (await prisma.user.create({ data: { orgId: ORG, email: `${papel}-w3@vinculo.teste`, name: `Pessoa ${papel}`, passwordHash: 'x', roles: { connect: { id: roleId } } }, select: { id: true } })).id,
      papeis: [papel],
    });
    gente = await criar('admin_master', admin.id);
    emailDaGente = 'admin_master-w3@vinculo.teste';
    maquina = await criar('ia_acao', ia.id);
    leitor = await criar('leitor_w3', ver.id);
    const p = prisma as unknown as PrismaService;
    svc = new VinculoDoWhatsappService(p);
    fio = new FioService(p, new ReacoesRegistry());
  }, 60_000);
  beforeEach(limpar);
  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    for (const org of [ORG, ORG2]) {
      await prisma.user.deleteMany({ where: { orgId: org } });
      await prisma.role.deleteMany({ where: { orgId: org } });
      await prisma.org.deleteMany({ where: { id: org } });
    }
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // 1:1
  // -------------------------------------------------------------------------

  it('1:1 casa sozinho com o lead pelo telefone (gravado sem o 55 e formatado) e leva o lead às mensagens passadas', async () => {
    const l = await lead('Contato Fictício Um', '(32) 98888-0001');
    const c = await conversa(jid('5532988880001'), 'Contato Um');
    await mensagem(c, jid('5532988880001'));
    await mensagem(c, jid('5532988880001'), { deMim: true });
    await svc.casarConversa(ORG, c);
    const depois = await daConversa(c);
    expect(depois).toMatchObject({ leadId: l, clienteId: null, vinculadoPorId: null, equipe: false });
    expect((await mensagensDe(c)).every((m) => m.leadId === l)).toBe(true);
    // A mensagem que chega depois também ganha o lead.
    await mensagem(c, jid('5532988880001'));
    await svc.casarConversa(ORG, c);
    expect((await mensagensDe(c)).every((m) => m.leadId === l)).toBe(true);
  });

  it('1:1 casa com o cliente pelo Partner.phone; sem o 9 não casa; fornecedor não casa', async () => {
    const p = await cliente('Cliente Fictício Dois', '+55 32 98888-0002');
    const c = await conversa(jid('5532988880002'), null);
    await svc.casarConversa(ORG, c);
    expect(await daConversa(c)).toMatchObject({ clienteId: p, leadId: null });

    await lead('Lead Sem Nove', '553288880003');
    const c2 = await conversa(jid('5532988880003'), null);
    await svc.casarConversa(ORG, c2);
    expect(await daConversa(c2)).toMatchObject({ leadId: null, clienteId: null });

    await prisma.partner.create({ data: { orgId: ORG, isCliente: false, isFornecedor: true, razaoSocial: 'Fornecedor Fictício', phone: '5532988880004' } });
    const c3 = await conversa(jid('5532988880004'), null);
    await svc.casarConversa(ORG, c3);
    expect(await daConversa(c3)).toMatchObject({ clienteId: null });
  });

  it('revisão 22C (A2): o lead que fechou e o cliente com o mesmo telefone: a conversa liga ao cliente, sem violar o CHECK', async () => {
    await lead('Lead Que Fechou Ficticio', '5532988880009');
    const p = await cliente('Cliente Que Era Lead Ficticio', '5532988880009');
    const c = await conversa(jid('5532988880009'), null);
    await mensagem(c, jid('5532988880009'));
    await expect(svc.casar(ORG, c)).resolves.toMatchObject({ mudou: true, clienteId: p, leadId: null });
    expect(await daConversa(c)).toMatchObject({ clienteId: p, leadId: null });
    expect((await mensagensDe(c)).every((m) => m.clienteId === p && m.leadId === null)).toBe(true);
  });

  it('dois leads com o mesmo telefone: não casa nem sugere', async () => {
    await lead('Lead A', '5532988880005');
    await lead('Lead B', '32988880005');
    const c = await conversa(jid('5532988880005'), null);
    await svc.casarConversa(ORG, c);
    expect(await daConversa(c)).toMatchObject({ leadId: null, clienteId: null, vinculoSugerido: null });
  });

  it('número da equipe (identidade de canal ou telefone de usuário) é equipe, sem vínculo', async () => {
    await lead('Lead Que Também É Da Casa', '5532988880006');
    await prisma.channelIdentity.create({ data: { orgId: ORG, canal: 'whatsapp', externalId: '5532988880006', rotulo: 'WhatsApp fictício', userId: gente.id } });
    const c = await conversa(jid('5532988880006'), null);
    await svc.casarConversa(ORG, c);
    expect(await daConversa(c)).toMatchObject({ equipe: true, leadId: null });

    await prisma.user.update({ where: { id: leitor.id }, data: { phone: '(32) 98888-0007' } });
    const c2 = await conversa(jid('5532988880007'), null);
    await svc.casarConversa(ORG, c2);
    expect(await daConversa(c2)).toMatchObject({ equipe: true });
    await prisma.user.update({ where: { id: leitor.id }, data: { phone: null } });
  });

  // -------------------------------------------------------------------------
  // Grupo
  // -------------------------------------------------------------------------

  it('grupo com nome igual ao do cliente só SUGERE; nunca liga sozinho; parecido não sugere', async () => {
    const p = await cliente('Padaria Aurora Ficticia');
    const g = await conversa('120363000000000001@g.us', 'ROOT | Padaria Aurora Fictícia', true);
    await mensagem(g, '120363000000000001@g.us', { grupo: true });
    await svc.casarConversa(ORG, g);
    const d = await daConversa(g);
    expect(d.leadId).toBeNull();
    expect(d.clienteId).toBeNull();
    expect(d.vinculoSugerido).toEqual({ tipo: 'cliente', id: p, nome: 'Padaria Aurora Ficticia', como: 'nome_igual' });
    expect((await mensagensDe(g)).every((m) => m.clienteId === null)).toBe(true);

    const g2 = await conversa('120363000000000002@g.us', 'ROOT | Padaria Aurora Ficticia Filial', true);
    await svc.casarConversa(ORG, g2);
    expect(await daConversa(g2)).toMatchObject({ vinculoSugerido: null, clienteId: null });

    const eq = await conversa('120363000000000003@g.us', 'ROOT | Estratégia e Produto', true);
    await svc.casarConversa(ORG, eq);
    expect(await daConversa(eq)).toMatchObject({ equipe: true, vinculoSugerido: null });
  });

  it('um clique aceita a sugestão: liga, propaga às mensagens e audita; o segundo clique não muda nada', async () => {
    const p = await cliente('Oficina Boa Vista Ficticia');
    const g = await conversa('120363000000000011@g.us', 'Root | Oficina Boa Vista Ficticia', true);
    await mensagem(g, '120363000000000011@g.us', { grupo: true });
    await svc.casarConversa(ORG, g);
    const r = await svc.aceitarSugestao(ORG, g, gente);
    expect(r.mudou).toBe(true);
    expect(r.conversa.vinculo).toMatchObject({ tipo: 'cliente', id: p, vinculadoPor: { id: gente.id } });
    expect(r.conversa.sugestao).toBeNull();
    expect((await mensagensDe(g)).every((m) => m.clienteId === p)).toBe(true);
    const r2 = await svc.aceitarSugestao(ORG, g, gente);
    expect(r2.mudou).toBe(false);
    const audit = await prisma.auditLog.findMany({ where: { orgId: ORG, action: ACAO_DE_AUDITORIA.vinculada, entityId: g } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: gente.id, entityType: 'whatsapp_conversa' });
    // O casamento seguinte não mexe no que a pessoa decidiu.
    await svc.casarConversa(ORG, g);
    expect(await daConversa(g)).toMatchObject({ clienteId: p, vinculadoPorId: gente.id });
  });

  // -------------------------------------------------------------------------
  // Manual
  // -------------------------------------------------------------------------

  it('vínculo manual: ligar a outro é 409; o mesmo não muda; desvincular limpa as mensagens e o casamento não religa', async () => {
    const a = await lead('Lead Automático', '5532988880021');
    const b = await lead('Lead Escolhido');
    const c = await conversa(jid('5532988880021'), null);
    await mensagem(c, jid('5532988880021'));
    await svc.casarConversa(ORG, c);
    expect((await daConversa(c)).leadId).toBe(a);

    // Ligado (mesmo que sozinho) a A: ligar a B é 409.
    await expect(svc.vincular(ORG, c, { tipo: 'lead', id: b }, gente)).rejects.toBeInstanceOf(ConflictException);
    // Confirmar A vira manual.
    expect((await svc.vincular(ORG, c, { tipo: 'lead', id: a }, gente)).mudou).toBe(true);
    expect((await svc.vincular(ORG, c, { tipo: 'lead', id: a }, gente)).mudou).toBe(false);

    const d = await svc.desvincular(ORG, c, gente);
    expect(d.mudou).toBe(true);
    expect(d.conversa.vinculo).toBeNull();
    expect((await mensagensDe(c)).every((m) => m.leadId === null && m.clienteId === null)).toBe(true);
    await svc.casarConversa(ORG, c);
    expect((await daConversa(c)).leadId).toBeNull();
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: ACAO_DE_AUDITORIA.desvinculada, entityId: c } })).toBe(1);

    // Agora a pessoa liga a B, e o casamento pelo telefone (que daria A) não troca.
    await svc.vincular(ORG, c, { tipo: 'lead', id: b }, gente);
    await svc.casarConversa(ORG, c);
    expect(await daConversa(c)).toMatchObject({ leadId: b, vinculadoPorId: gente.id });
    expect((await mensagensDe(c)).every((m) => m.leadId === b)).toBe(true);
  });

  it('equipe à mão: marcar e tirar; ligada a lead, marcar é 409', async () => {
    const g = await conversa('120363000000000031@g.us', 'Grupo Fictício Qualquer', true);
    const r = await svc.marcarEquipe(ORG, g, { equipe: true }, gente);
    expect(r.conversa.equipe).toBe(true);
    await svc.casarConversa(ORG, g);
    expect((await daConversa(g)).equipe).toBe(true);
    expect((await svc.marcarEquipe(ORG, g, { equipe: false }, gente)).conversa.equipe).toBe(false);

    const l = await lead('Lead Ligado');
    const c = await conversa(jid('5532988880032'), null);
    await svc.vincular(ORG, c, { tipo: 'lead', id: l }, gente);
    await expect(svc.marcarEquipe(ORG, c, { equipe: true }, gente)).rejects.toBeInstanceOf(ConflictException);
  });

  it('passar para cliente: o cliente do fechamento num clique; sem ele, o escolhido ou o cadastrado pelo nome', async () => {
    const fechado = await lead('Papeleira Ficticia');
    const p = await cliente('Papeleira Ficticia');
    await prisma.comercialFicha.create({ data: { leadId: fechado, partnerId: p } });
    const g = await conversa('120363000000000051@g.us', 'ROOT | Papeleira Ficticia', true);
    await mensagem(g, '120363000000000051@g.us', { grupo: true });
    await svc.vincular(ORG, g, { tipo: 'lead', id: fechado }, gente);
    const lida = await svc.vincular(ORG, g, { tipo: 'lead', id: fechado }, gente);
    expect(lida.conversa.vinculo).toMatchObject({ tipo: 'lead', clienteDoLead: { id: p } });
    const r = await svc.passarParaCliente(ORG, g, {}, gente);
    expect(r.mudou).toBe(true);
    expect(r.conversa.vinculo).toMatchObject({ tipo: 'cliente', id: p });
    expect(await daConversa(g)).toMatchObject({ leadId: null, clienteId: p, vinculadoPorId: gente.id });
    expect((await mensagensDe(g)).every((m) => m.leadId === null && m.clienteId === p)).toBe(true);
    // Já é do cliente: passar de novo é 409 (não está ligada a lead).
    await expect(svc.passarParaCliente(ORG, g, {}, gente)).rejects.toBeInstanceOf(ConflictException);

    // Lead sem fechamento no sistema: sem cliente nem nome é 400; com nome cadastra e passa.
    const fora = await lead('Fechado Por Fora');
    const c = await conversa(jid('5532988880052'), null);
    await svc.vincular(ORG, c, { tipo: 'lead', id: fora }, gente);
    await expect(svc.passarParaCliente(ORG, c, {}, gente)).rejects.toBeInstanceOf(BadRequestException);
    const n = await svc.passarParaCliente(ORG, c, { nome: 'Fechado Por Fora' }, gente);
    expect(n.conversa.vinculo).toMatchObject({ tipo: 'cliente', nome: 'Fechado Por Fora' });
    // O lead continua no funil.
    expect(await prisma.lead.count({ where: { id: fora } })).toBe(1);
    // Com o cliente escolhido, vai para ele.
    const outro = await cliente('Escolhido Na Busca');
    const c2 = await conversa(jid('5532988880053'), null);
    await svc.vincular(ORG, c2, { tipo: 'lead', id: fora }, gente);
    expect((await svc.passarParaCliente(ORG, c2, { clienteId: outro }, gente)).conversa.vinculo).toMatchObject({ tipo: 'cliente', id: outro });
    await expect(svc.passarParaCliente(ORG, c2, { clienteId: outro }, leitor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lead em Negócio fechado sem cadastro: aparece como cliente, vira cliente num clique e a ficha passa a apontar o cadastro', async () => {
    const l = await lead('Contato da Papeleira');
    await prisma.comercialFicha.create({ data: { leadId: l, etapa: 'fechado', empresa: 'Papeleira Fechada Ficticia' } });
    const aberto = await lead('Lead Ainda Aberto');
    await prisma.comercialFicha.create({ data: { leadId: aberto, etapa: 'qualificacao', empresa: 'Aberta Ficticia' } });
    const g = await conversa('120363000000000061@g.us', 'ROOT | Papeleira Fechada Ficticia', true);

    const cands = await svc.candidatos(ORG, { conversaId: g, tipo: 'cliente' });
    expect(cands[0]).toMatchObject({ tipo: 'cliente', nome: 'Papeleira Fechada Ficticia', leadId: l, igual: true });
    expect(cands.some((c) => c.nome === 'Aberta Ficticia')).toBe(false);

    const r = await svc.vincularAoClienteDoLead(ORG, g, { leadId: l }, gente);
    expect(r.conversa.vinculo).toMatchObject({ tipo: 'cliente', nome: 'Papeleira Fechada Ficticia' });
    const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: l } });
    expect(ficha.partnerId).toBe(r.conversa.vinculo!.id);
    // De novo não cria outro cadastro: a busca agora traz o cliente, não o lead.
    expect((await svc.candidatos(ORG, { conversaId: g, tipo: 'cliente' })).filter((c) => c.nome === 'Papeleira Fechada Ficticia')).toHaveLength(1);
    await expect(svc.vincularAoClienteDoLead(ORG, g, { leadId: aberto }, gente)).rejects.toBeInstanceOf(ConflictException);

    // Ligada ao lead fechado, "Passar para cliente" sem nada usa o mesmo cadastro.
    const c = await conversa(jid('5532988880062'), null);
    await svc.vincular(ORG, c, { tipo: 'lead', id: l }, gente);
    expect((await svc.vincular(ORG, c, { tipo: 'lead', id: l }, gente)).conversa.vinculo).toMatchObject({ clienteDoLead: { id: ficha.partnerId } });
    expect((await svc.passarParaCliente(ORG, c, {}, gente)).conversa.vinculo).toMatchObject({ tipo: 'cliente', id: ficha.partnerId });
  });

  it('403 para conta de máquina e para quem só lê (relido no banco)', async () => {
    const l = await lead('Lead Qualquer');
    const c = await conversa(jid('5532988880041'), null);
    await expect(svc.vincular(ORG, c, { tipo: 'lead', id: l }, maquina)).rejects.toBeInstanceOf(ForbiddenException);
    // O token diz "admin", o banco diz máquina.
    await expect(svc.vincular(ORG, c, { tipo: 'lead', id: l }, { id: maquina.id, papeis: ['admin_master'] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.vincular(ORG, c, { tipo: 'lead', id: l }, leitor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.desvincular(ORG, c, leitor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.definirTelefone(ORG, 'lead', l, { telefone: '32988880041' }, maquina)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await daConversa(c)).leadId).toBeNull();
  });

  it('isolamento: conversa, lead e cliente de outra empresa são 404; a busca não os mostra', async () => {
    const deFora = await lead('Lead De Outra Empresa', null, ORG2);
    const clienteDeFora = await cliente('Cliente De Outra Empresa', null, ORG2);
    const conversaDeFora = await conversa(jid('5532988880051'), null, false, ORG2);
    const c = await conversa('120363000000000052@g.us', 'ROOT | Lead De Outra Empresa', true);
    await expect(svc.vincular(ORG, c, { tipo: 'lead', id: deFora }, gente)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.vincular(ORG, c, { tipo: 'cliente', id: clienteDeFora }, gente)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.vincular(ORG, conversaDeFora, { tipo: 'lead', id: deFora }, gente)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.doLead(ORG, deFora, true)).rejects.toBeInstanceOf(NotFoundException);
    await svc.casarConversa(ORG, c);
    expect((await daConversa(c)).vinculoSugerido).toBeNull();
    const busca = await svc.candidatos(ORG, { conversaId: c, q: 'outra empresa' });
    expect(busca).toHaveLength(0);
  });

  it('a busca: o igual primeiro, o parecido depois, por tipo', async () => {
    const igual = await cliente('Marcenaria Ipe Ficticia');
    const parecido = await lead('Marcenaria Ipe Ficticia Filial');
    await lead('Transportes Horizonte Ficticio');
    const g = await conversa('120363000000000061@g.us', 'ROOT | Marcenaria Ipê Fictícia', true);
    const r = await svc.candidatos(ORG, { conversaId: g });
    expect(r[0]).toMatchObject({ id: igual, tipo: 'cliente', igual: true });
    expect(r.map((x) => x.id)).toContain(parecido);
    expect(r.find((x) => x.id === parecido)?.igual).toBe(false);
    expect((await svc.candidatos(ORG, { conversaId: g, tipo: 'lead' })).every((x) => x.tipo === 'lead')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Telefone
  // -------------------------------------------------------------------------

  it('pôr o número da conversa no lead: grava, liga e audita; com outro telefone pede substituir; número de outro lead é 409', async () => {
    const semFone = await lead('Lead Sem Telefone');
    const c = await conversa(jid('5532988880071'), null);
    await mensagem(c, jid('5532988880071'));
    const r = await svc.telefoneNoLead(ORG, c, { leadId: semFone }, gente);
    expect(r.conversa.vinculo).toMatchObject({ tipo: 'lead', id: semFone });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: semFone } })).phone).toBe('5532988880071');
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: ACAO_DE_AUDITORIA.telefoneDoLead, entityId: semFone } })).toBe(1);
    expect((await mensagensDe(c)).every((m) => m.leadId === semFone)).toBe(true);

    const comOutro = await lead('Lead Com Outro Telefone', '5532988880072');
    const c2 = await conversa(jid('5532988880073'), null);
    const erro = await svc.telefoneNoLead(ORG, c2, { leadId: comOutro }, gente).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(((erro as ConflictException).getResponse() as { error?: string }).error).toBe(CODIGO_LEAD_COM_OUTRO_TELEFONE);
    await svc.telefoneNoLead(ORG, c2, { leadId: comOutro, substituir: true }, gente);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: comOutro } })).phone).toBe('5532988880073');

    const outro = await lead('Outro Lead');
    const c3 = await conversa(jid('5532988880071'.replace('71', '74')), null);
    await prisma.lead.update({ where: { id: outro }, data: { phone: '5532988880074' } });
    const terceiro = await lead('Terceiro Lead');
    await expect(svc.telefoneNoLead(ORG, c3, { leadId: terceiro }, gente)).rejects.toBeInstanceOf(ConflictException);

    const g = await conversa('120363000000000075@g.us', 'Grupo Fictício', true);
    await expect(svc.telefoneNoLead(ORG, g, { leadId: terceiro }, gente)).rejects.toThrow(/1:1/);
  });

  it('editar o telefone do lead e do cliente normaliza, audita e casa de novo a conversa 1:1', async () => {
    const l = await lead('Lead Para Telefone');
    const c = await conversa(jid('5532988880081'), null);
    await svc.casarConversa(ORG, c);
    expect((await daConversa(c)).leadId).toBeNull();
    const r = await svc.definirTelefone(ORG, 'lead', l, { telefone: '(32) 98888-0081' }, gente);
    expect(r).toMatchObject({ telefone: '5532988880081', mudou: true, conversasCasadas: 1 });
    expect((await daConversa(c)).leadId).toBe(l);
    // Tirar o telefone desfaz o casamento automático.
    await svc.definirTelefone(ORG, 'lead', l, { telefone: null }, gente);
    expect((await daConversa(c)).leadId).toBeNull();
    await expect(svc.definirTelefone(ORG, 'lead', l, { telefone: '123' }, gente)).rejects.toThrow();

    const p = await cliente('Cliente Para Telefone');
    const c2 = await conversa(jid('5532988880082'), null);
    await svc.definirTelefone(ORG, 'cliente', p, { telefone: '32 98888-0082' }, gente);
    expect((await daConversa(c2)).clienteId).toBe(p);
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: ACAO_DE_AUDITORIA.telefoneDoCliente, entityId: p } })).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Fio do lead e ficha do cliente
  // -------------------------------------------------------------------------

  it('o fio do lead ganha o WhatsApp de gente sem duplicar o que o comercial já mostra', async () => {
    const l = await lead('Lead Do Fio', '5532988880091');
    const c = await conversa(jid('5532988880091'), null);
    const doComercial = await mensagem(c, jid('5532988880091'), { deMim: true, texto: 'enviada pelo comercial' });
    const recebidaNoFio = await mensagem(c, jid('5532988880091'), { texto: 'chegou pela entrada do lead' });
    const deGente = await mensagem(c, jid('5532988880091'), { texto: 'mensagem fictícia de gente' });
    await svc.casarConversa(ORG, c);
    await prisma.comercialMensagem.create({ data: { orgId: ORG, leadId: l, direcao: 'saida', provedor: 'evolution', texto: 'enviada pelo comercial', estado: 'enviada', mensagemExternaId: doComercial.mensagemExternaId } });
    await prisma.leadEvent.create({ data: { leadId: l, type: 'whats.recebida', payload: { texto: 'chegou', mensagemId: recebidaNoFio.mensagemExternaId, provedor: 'evolution' } } });
    const eventos = await prisma.leadEvent.findMany({ where: { leadId: l } });
    const linhas = await fio.fioDoLead(ORG, l, eventos, new Date(Date.now() - 86_400_000));
    const zap = linhas.filter((x) => x.type === 'whatsapp.mensagem');
    expect(zap).toHaveLength(1);
    expect(zap[0].eventoId).toBe(`whatsapp:${deGente.id}`);
    expect(zap[0].resumo).toContain('mensagem fictícia de gente');
    expect(linhas.filter((x) => x.type === 'whats.recebida')).toHaveLength(1);
    // Ordem cronológica e nenhum LeadEvent novo por mensagem.
    expect([...linhas].map((x) => x.em)).toEqual([...linhas].map((x) => x.em).sort());
    expect(await prisma.leadEvent.count({ where: { leadId: l } })).toBe(1);
  });

  it('o WhatsApp do lead e do cliente: as conversas e as últimas 5 em ordem, com o telefone', async () => {
    const p = await cliente('Cliente Da Ficha', '5532988880095');
    const g = await conversa('120363000000000096@g.us', 'ROOT | Cliente Da Ficha', true);
    for (let i = 0; i < 7; i++) await mensagem(g, '120363000000000096@g.us', { grupo: true, texto: `fictícia ${i}`, em: new Date(Date.UTC(2026, 9, 20, 12, i)) });
    await svc.casarConversa(ORG, g);
    await svc.aceitarSugestao(ORG, g, gente);
    const w = await svc.doCliente(ORG, p, true);
    expect(w.telefone).toBe('5532988880095');
    expect(w.conversas.map((x) => x.id)).toEqual([g]);
    expect(w.ultimas.map((m) => m.texto)).toEqual(['fictícia 2', 'fictícia 3', 'fictícia 4', 'fictícia 5', 'fictícia 6']);
    const l = await lead('Lead Sem Conversa');
    expect(await svc.doLead(ORG, l, false)).toEqual({ conversas: [], ultimas: [], telefone: null, podeEditar: false });
  });

  // -------------------------------------------------------------------------
  // O script
  // -------------------------------------------------------------------------

  it('o script: simular não escreve; valer aplica só o nome IGUAL, em nome de --como; é idempotente', async () => {
    const p = await cliente('Construtora Alicerce Ficticia');
    const l = await lead('Floricultura Lirio Ficticia');
    await cliente('Padaria Parecida Ficticia');
    const g1 = await conversa('120363000000000101@g.us', 'ROOT | Construtora Alicerce Fictícia', true);
    const g2 = await conversa('120363000000000102@g.us', 'ROOT - Floricultura Lírio Fictícia', true);
    const g3 = await conversa('120363000000000103@g.us', 'ROOT | Padaria Parecida Ficticia Matriz', true);
    const eq = await conversa('120363000000000104@g.us', 'FullBPO | Operação Fictícia', true);
    const l1 = await lead('Lead Do Um A Um', '5532988880105');
    const c1 = await conversa(jid('5532988880105'), null);
    // Revisão 22C (A7): lead de nome de uma palavra só fica para o clique (primeiro nome sozinho não liga sem gente).
    await lead('Ficticiano');
    const g5 = await conversa('120363000000000105@g.us', 'ROOT | Ficticiano', true);
    await mensagem(g1, '120363000000000101@g.us', { grupo: true });

    await expect(vincularConversas(prisma, { org: ORG, como: null, valer: true })).rejects.toThrow(/--como/);
    await expect(vincularConversas(prisma, { org: ORG, como: 'maquina', valer: true })).rejects.toThrow();
    await expect(vincularConversas(prisma, { org: ORG, como: 'ia_acao-w3@vinculo.teste', valer: true })).rejects.toThrow(/máquina/);
    await expect(vincularConversas(prisma, { org: ORG, como: 'leitor_w3-w3@vinculo.teste', valer: true })).rejects.toThrow(/leads.editar/);

    const sim = await vincularConversas(prisma, { org: ORG, como: null, valer: false });
    expect(sim).toMatchObject({ modo: 'simular', conversas: 6, aplicadas: 2, casamentos: 1, equipe: 1, soNoClique: 1, erros: 0 });
    expect(sim.ids.aplicadas.every((id) => id.length === 8)).toBe(true);
    // Nada foi escrito.
    expect(await daConversa(g1)).toMatchObject({ clienteId: null, vinculoSugerido: null, vinculadoPorId: null });
    expect((await daConversa(c1)).leadId).toBeNull();

    const val = await vincularConversas(prisma, { org: ORG, como: emailDaGente, valer: true });
    expect(val).toMatchObject({ modo: 'valer', aplicadas: 2, casamentos: 1 });
    expect(await daConversa(g1)).toMatchObject({ clienteId: p, vinculadoPorId: gente.id });
    expect(await daConversa(g2)).toMatchObject({ leadId: l, vinculadoPorId: gente.id });
    expect(await daConversa(g3)).toMatchObject({ clienteId: null, leadId: null, vinculadoPorId: null });
    expect(await daConversa(eq)).toMatchObject({ equipe: true, clienteId: null });
    expect(await daConversa(c1)).toMatchObject({ leadId: l1, vinculadoPorId: null });
    expect(await daConversa(g5)).toMatchObject({ leadId: null, vinculadoPorId: null });
    expect((await daConversa(g5)).vinculoSugerido).toMatchObject({ tipo: 'lead', como: 'nome_igual' });
    expect((await mensagensDe(g1)).every((m) => m.clienteId === p)).toBe(true);
    const audit = await prisma.auditLog.findMany({ where: { orgId: ORG, action: ACAO_DE_AUDITORIA.vinculada } });
    expect(audit).toHaveLength(2);
    expect(audit.every((a) => a.actorId === gente.id && (a.after as { como?: string }).como === 'script')).toBe(true);

    const deNovo = await vincularConversas(prisma, { org: ORG, como: emailDaGente, valer: true });
    expect(deNovo).toMatchObject({ aplicadas: 0, casamentos: 0, manuais: 2 });
    const depois = await vincularConversas(prisma, { org: ORG, como: null, valer: false });
    expect(depois).toMatchObject({ aplicadas: 0, casamentos: 0 });
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: ACAO_DE_AUDITORIA.vinculada } })).toBe(2);
  });

  it('o --detalhe recusa caminho dentro de repositório git', async () => {
    const { dentroDeGit } = await import('../src/comercial/importador-crm/detalhe');
    expect(dentroDeGit(path.join(__dirname, 'detalhe.md'))).toBe(true);
    const fora = mkdtempSync(path.join(os.tmpdir(), 'vincular-'));
    try {
      expect(dentroDeGit(path.join(fora, 'detalhe.md'))).toBe(false);
    } finally {
      rmSync(fora, { recursive: true, force: true });
    }
  });
});
