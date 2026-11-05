import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { OrigemArquivoClienteService } from '../src/clientes-escopo/origem-arquivo-cliente.service';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { AuditService } from '../src/audit/audit.service';
import { PolicyService } from '../src/policy/policy.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { LeituraDaEvolution } from '../src/gateway/canais/evolution.port';
import { exigirBancoDescartavel } from './banco-de-teste';
import { canonicalHash } from '../src/approvals/approvals.service';

const url = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(url ?? '', 'Recibos sintéticos do lote 6');
describe.skipIf(!url)('origem de arquivo: recibo persistido não concede acesso', () => {
  let db: PrismaClient, service: OrigemArquivoClienteService;
  const orgs: string[] = [];
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    const p = db as unknown as PrismaService;
    const policy = new PolicyService(p); await policy.onModuleInit();
    service = new OrigemArquivoClienteService(p, new ClienteEscopoService(p, new AuditService(p)), policy, { ligado: async () => true, instanciaDaEmpresa: async () => 'qa-instancia' } as unknown as LeituraDaEvolution);
  });
  afterAll(async () => {
    if (!db) return;
    const where = { orgId: { in: orgs } };
    await db.origemArquivoCliente.deleteMany({ where });
    await db.comercialDocumento.deleteMany({ where });
    await db.approval.deleteMany({ where });
    await db.toolCall.deleteMany({ where });
    await db.clienteAcessoPerfil.deleteMany({ where });
    await db.user.deleteMany({ where });
    await db.role.deleteMany({ where });
    await db.whatsAppMensagem.deleteMany({ where });
    await db.whatsAppConversa.deleteMany({ where });
    await db.salaDoCliente.deleteMany({ where });
    await db.comercialFicha.deleteMany({ where });
    await db.lead.deleteMany({ where });
    await db.partner.deleteMany({ where });
    await db.org.deleteMany({ where: { id: { in: orgs } } });
    await db.$disconnect();
  });
  async function fixture(comCliente = true) {
    const org = await db.org.create({ data: { name: 'QA recibo', slug: randomUUID() } }); orgs.push(org.id);
    const orgId = org.id;
    const lead = await db.lead.create({ data: { orgId, name: 'Lead canônico' } });
    const partner = await db.partner.create({ data: { orgId, razaoSocial: 'Cliente canônico', isCliente: true } });
    const ficha = await db.comercialFicha.create({ data: { orgId, leadId: lead.id, partnerId: comCliente ? partner.id : null } });
    const sala = await db.salaDoCliente.create({ data: { orgId, leadId: lead.id, slug: 'qa', tokenHash: randomUUID(), validoAte: new Date(Date.now() + 600000) } });
    const conteudo = { chave: `comercial/sala/${sala.id}/${'a'.repeat(64)}`, sha256: 'a'.repeat(64), bytes: 4, tipoMime: 'application/pdf' };
    const pedido = { orgId, salaId: sala.id, tokenHash: sala.tokenHash, conteudo };
    const esperado = { leadId: lead.id, partnerId: ficha.partnerId, origem: 'sala', ...conteudo };
    return { orgId, lead, partner, ficha, sala, conteudo, pedido, esperado };
  }
  it('recebimento válido conserva origem externa e é idempotente', async () => {
    const f = await fixture();
    const a = await service.registrarSala(f.pedido), b = await service.registrarSala(f.pedido);
    expect(b.id).toBe(a.id);
    await expect(service.exigir(f.orgId, a.id, f.esperado)).resolves.toMatchObject({ atorId: null, leadId: f.lead.id, partnerId: f.partner.id });
  });
  for (const mudanca of ['revogada', 'rotacionada', 'expirada', 'cliente'] as const) it(`recusa sala ${mudanca} após recebimento`, async () => {
    const f = await fixture(); const r = await service.registrarSala(f.pedido);
    if (mudanca === 'cliente') await db.comercialFicha.update({ where: { leadId: f.lead.id }, data: { partnerId: null } });
    else await db.salaDoCliente.update({ where: { id: f.sala.id }, data: mudanca === 'revogada' ? { revogadoEm: new Date() } : mudanca === 'rotacionada' ? { tokenHash: randomUUID() } : { validoAte: new Date(0) } });
    await expect(service.exigir(f.orgId, r.id, f.esperado)).rejects.toThrow();
  });
  it('nega conteúdo ou organização diferentes e recibo revogado', async () => {
    const f = await fixture(); const r = await service.registrarSala(f.pedido);
    await expect(service.exigir(f.orgId, r.id, { ...f.esperado, sha256: 'b'.repeat(64) })).rejects.toThrow();
    await expect(service.exigir('outra-org', r.id, f.esperado)).rejects.toThrow();
    await db.origemArquivoCliente.update({ where: { id: r.id }, data: { revogadoEm: new Date() } });
    await expect(service.exigir(f.orgId, r.id, f.esperado)).rejects.toThrow();
  });
  it('prova imutável no Postgres: não altera dono, hash ou snapshot', async () => {
    const f = await fixture(); const r = await service.registrarSala(f.pedido);
    for (const data of [{ partnerId: null }, { sha256: 'b'.repeat(64) }, { prova: {} }]) {
      await expect(db.origemArquivoCliente.update({ where: { id: r.id }, data })).rejects.toThrow();
    }
  });
  it('lead pré-cliente resolve apenas a ficha atual e vincula destino esperado', async () => {
    const f = await fixture(false); const r = await service.registrarSala(f.pedido);
    await db.comercialFicha.update({ where: { leadId: f.lead.id }, data: { partnerId: f.partner.id } });
    await expect(service.exigir(f.orgId, r.id, { ...f.esperado, partnerId: f.partner.id })).resolves.toMatchObject({ partnerId: f.partner.id });
    await expect(service.exigir(f.orgId, r.id, { ...f.esperado, partnerId: 'cliente-inventado' })).rejects.toThrow();
  });
  async function whatsapp() {
    const f = await fixture();
    const conversa = await db.whatsAppConversa.create({ data: { orgId: f.orgId, instancia: 'qa-instancia', chatJid: '5532999999999@s.whatsapp.net', leadId: f.lead.id, clienteId: null } });
    const mensagem = await db.whatsAppMensagem.create({ data: { orgId: f.orgId, conversaId: conversa.id, instancia: conversa.instancia, chatJid: conversa.chatJid, remetenteNumero: '5532999999999', direcao: 'entrada', tipo: 'document', mensagemExternaId: randomUUID(), timestamp: new Date(), origem: 'webhook', leadId: f.lead.id, clienteId: null, midia: { mime: 'application/pdf', tamanho: 4 } } });
    const conteudo = { ...f.conteudo, chave: `clientes/arquivos/${f.orgId}/${f.conteudo.sha256}` };
    const pedido = { orgId: f.orgId, instancia: 'qa-instancia', mensagemExternaId: mensagem.mensagemExternaId, remetenteNumero: '5532999999999', conteudo };
    return { ...f, conversa, mensagem, pedido, esperado: { ...f.esperado, origem: 'whatsapp', ...conteudo } };
  }
  async function contrato(system = false) {
    const f = await fixture();
    const permissoes = await Promise.all(['leads.editar', 'aprovacoes.decidir'].map(key => db.permission.upsert({ where: { key }, update: {}, create: { key } })));
    const role = await db.role.create({ data: { orgId: f.orgId, key: 'qa_recibo', name: 'QA', permissions: { connect: permissoes.map(p => ({ id: p.id })) } } });
    const pessoas = [];
    for (let i = 0; i < 2; i++) {
      const u = await db.user.create({ data: { orgId: f.orgId, name: 'QA', email: `${randomUUID()}@invalid.test`, passwordHash: 'sem-login', roles: { connect: { id: role.id } } } });
      await db.clienteAcessoPerfil.create({ data: { orgId: f.orgId, userId: u.id, modo: 'ALL' } }); pessoas.push(u);
    }
    const hash = 'c'.repeat(64), args = { leadId: f.lead.id, versao: 1, hash, signatarioEmail: 'qa@invalid.test' };
    const tipo = system ? 'system' as const : 'user' as const, ator = system ? 'comercial' : pessoas[0]!.id;
    const tc = await db.toolCall.create({ data: { orgId: f.orgId, capabilityId: 'comercial.contrato.enviar', actorType: tipo, actorId: ator, args, status: 'executado' } });
    const ap = await db.approval.create({ data: { orgId: f.orgId, toolCallId: tc.id, capabilityId: 'comercial.contrato.enviar', resourceType: 'comercial.contrato', resourceId: `${f.lead.id}:${hash.slice(0,16)}`, contentHash: canonicalHash('comercial.contrato', args, []), propostoPorTipo: tipo, propostoPorId: ator, aprovadoPorId: pessoas[1]!.id, nivelExigido: 'R4', status: 'consumida', consumidoEm: new Date(), tokenHash: randomUUID(), resumo: 'QA', expiraEm: new Date(Date.now()+60000) } });
    await db.toolCall.update({ where: { id: tc.id }, data: { approvalId: ap.id } });
    const doc = await db.comercialDocumento.create({ data: { orgId: f.orgId, leadId: f.lead.id, provedor: 'zapsign', externoId: randomUUID(), estado: 'assinado', hashConteudo: hash, origemApprovalId: ap.id, assinadoRootEm: new Date(), assinadoClienteEm: new Date() } });
    const conteudo = { ...f.conteudo, chave: `clientes/arquivos/${f.orgId}/${f.conteudo.sha256}` };
    const pedido = { orgId: f.orgId, leadId: f.lead.id, documentoId: doc.id, externoId: doc.externoId, provedor: doc.provedor, conteudo };
    return { ...f, doc, ap, tc, pessoas, pedido, esperado: { ...f.esperado, origem: 'contrato-assinado', ...conteudo } };
  }
  it('contrato conserva originador humano distinto de quem aprovou', async () => {
    const f = await contrato(); const r = await service.registrarContrato(f.pedido);
    expect(r.atorId).toBe(f.pessoas[0]!.id);
    await db.clienteAcessoPerfil.updateMany({ where: { orgId: f.orgId, userId: f.pessoas[0]!.id }, data: { modo: 'SELECTED' } });
    await expect(service.exigir(f.orgId, r.id, f.esperado)).rejects.toThrow();
  });
  it('contrato nega troca de recurso, conteúdo e aprovador revogado', async () => {
    const f = await contrato(); const r = await service.registrarContrato(f.pedido);
    await expect(service.exigirContrato(f.orgId, f.lead.id, f.doc.id, 'outro-documento', 'zapsign')).rejects.toThrow();
    await expect(service.registrarContrato({ ...f.pedido, conteudo: { ...f.pedido.conteudo, bytes: 5 } })).rejects.toThrow();
    await db.user.update({ where: { id: f.pessoas[1]!.id }, data: { isActive: false } });
    await expect(service.exigir(f.orgId, r.id, f.esperado)).rejects.toThrow();
  });
  it('contrato automático com origem canônica não inventa humano', async () => {
    const f = await contrato(true);
    await expect(service.registrarContrato(f.pedido)).resolves.toMatchObject({ atorId: null });
  });
  it('aprovação R3 não comprova emissão de contrato R4', async () => {
    const f = await contrato();
    await db.approval.update({ where: { id: f.ap.id }, data: { nivelExigido: 'R3' } });
    await expect(service.exigirContrato(f.orgId, f.lead.id, f.doc.id, f.doc.externoId, 'zapsign')).rejects.toThrow();
  });
  it('histórico humano não vira origem automática de contrato', async () => {
    const f = await contrato(true);
    await db.approval.create({ data: { orgId: f.orgId, capabilityId: f.ap.capabilityId, resourceType: f.ap.resourceType, resourceId: f.ap.resourceId, contentHash: f.ap.contentHash, propostoPorTipo: 'user', propostoPorId: f.pessoas[0]!.id, status: 'expirada', tokenHash: randomUUID(), resumo: 'Tentativa humana', expiraEm: new Date(0) } });
    await expect(service.registrarContrato(f.pedido)).rejects.toThrow();
  });
  it('a origem do documento não aceita backfill nem substituição', async () => {
    const f = await contrato();
    await expect(db.comercialDocumento.update({ where: { id: f.doc.id }, data: { origemApprovalId: randomUUID() } })).rejects.toThrow();
    const legado = await db.comercialDocumento.create({ data: { orgId: f.orgId, leadId: f.lead.id, provedor: 'zapsign', externoId: randomUUID(), hashConteudo: 'd'.repeat(64) } });
    await expect(db.comercialDocumento.update({ where: { id: legado.id }, data: { origemApprovalId: f.ap.id } })).rejects.toThrow();
    await expect(service.exigirContrato(f.orgId, f.lead.id, legado.id, legado.externoId, 'zapsign')).rejects.toThrow();
  });
  it('WhatsApp exige mensagem persistida, instância e remetente canônicos', async () => {
    const f = await whatsapp();
    for (const troca of [{ mensagemExternaId: 'ausente' }, { instancia: 'outra' }, { remetenteNumero: '5532888888888' }]) await expect(service.registrarWhatsapp({ ...f.pedido, ...troca })).rejects.toThrow();
    const r = await service.registrarWhatsapp(f.pedido);
    await expect(service.exigir(f.orgId, r.id, f.esperado)).resolves.toMatchObject({ atorId: null });
  });
  it('mesma mensagem com bytes diferentes não substitui recibo', async () => {
    const f = await whatsapp(); const r = await service.registrarWhatsapp(f.pedido);
    await expect(service.registrarWhatsapp({ ...f.pedido, conteudo: { ...f.pedido.conteudo, sha256: 'b'.repeat(64), chave: `clientes/arquivos/${f.orgId}/${'b'.repeat(64)}` } })).rejects.toThrow();
    expect((await db.origemArquivoCliente.findUniqueOrThrow({ where: { id: r.id } })).sha256).toBe(f.conteudo.sha256);
  });
  it('troca de vínculo da conversa invalida retry', async () => {
    const f = await whatsapp(); const r = await service.registrarWhatsapp(f.pedido);
    await db.whatsAppConversa.update({ where: { id: f.conversa.id }, data: { leadId: null, clienteId: null } });
    await expect(service.exigir(f.orgId, r.id, f.esperado)).rejects.toThrow();
  });
  it('imagem recebida usa a mesma prova de mensagem e conteúdo', async () => {
    const f = await whatsapp();
    await db.whatsAppMensagem.update({ where: { id: f.mensagem.id }, data: { tipo: 'image', midia: { mime: 'image/png', tamanho: 4 } } });
    const pedido = { ...f.pedido, conteudo: { ...f.pedido.conteudo, tipoMime: 'image/png' } };
    const r = await service.registrarWhatsapp(pedido);
    await expect(service.exigir(f.orgId, r.id, { ...f.esperado, tipoMime: 'image/png' })).resolves.toMatchObject({ atorId: null });
  });
  it('cliente direto sem lead usa o vínculo da conversa', async () => {
    const f = await whatsapp();
    await db.whatsAppConversa.update({ where: { id: f.conversa.id }, data: { leadId: null, clienteId: f.partner.id } });
    await db.whatsAppMensagem.update({ where: { id: f.mensagem.id }, data: { leadId: null, clienteId: f.partner.id } });
    const r = await service.registrarWhatsapp(f.pedido);
    expect(r).toMatchObject({ leadId: null, partnerId: f.partner.id, atorId: null });
  });
});
