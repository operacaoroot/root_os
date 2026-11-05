import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ActorType, ApprovalState, PrismaClient, RiskLevel } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { canonicalHash } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { EfeitoComercialEscopoService } from '../src/clientes-escopo/efeito-comercial-escopo.service';
import { comContexto, contextoAtual } from '../src/common/contexto-execucao';
import { montarPdfDoRegistro } from '../src/comercial/contratos/documento-do-registro';
import { CAP_CONTRATO, DinheiroService } from '../src/comercial/dinheiro.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { PolicyService } from '../src/policy/policy.service';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

const ownerUrl = process.env.TEST_DATABASE_URL ?? '';
const tenantUrl = process.env.TENANT_DATABASE_URL ?? '';
const rodar = process.env.RLS_NO_TESTE === '1';
if (rodar && (!ownerUrl || !tenantUrl)) throw new Error('A prova exige TEST_DATABASE_URL e TENANT_DATABASE_URL.');
if (rodar) {
  exigirBancoDescartavel(ownerUrl, 'dados de teste descartáveis');
  const a = new URL(ownerUrl), b = new URL(tenantUrl);
  if (!['localhost', '127.0.0.1'].includes(a.hostname) || a.hostname !== b.hostname || a.port !== b.port || a.pathname !== b.pathname || b.username !== 'mktos_app') throw new Error('O papel restrito deve apontar ao mesmo banco descartável local.');
}
const orgId = `l7-emissao-${randomUUID()}`;
const orgB = `l7-outra-${randomUUID()}`;
const naEmpresa = <T>(fn: () => Promise<T>) => comContexto({ orgId, correlationId: 'lote7-emissao-rls', origem: 'http' }, async () => await fn());

describe.skipIf(!rodar)('Lote 7: emissão e retorno no PostgreSQL com RLS', { timeout: 60000 }, () => {
  let admin: PrismaClient, db: PrismaClient, svc: DinheiroService, efeitos: EfeitosRegistry, policy: PolicyService, escopo: EfeitoComercialEscopoService;
  let proponente: string, aprovador: string, cliente: string, outro: string;
  let aoLerMinuta: null | (() => Promise<void>) = null;
  let ordenarBuscaDeDocumento = false;
  const enviar = vi.fn(async (entrada: any) => ({ externoId: randomUUID(), signatarios: entrada.signatarios.map((s: any) => ({ ...s, token: randomUUID(), link: null })) }));
  const whats = { prepararTemplate: vi.fn() };
  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: ownerUrl });
    db = comTenantNaSessao(new PrismaClient({ datasourceUrl: tenantUrl }), { modo: 'impor' }).$extends({ query: { comercialDocumento: { async findFirst({ args, query }) {
      if (ordenarBuscaDeDocumento && (args.select as { origemApprovalId?: boolean } | undefined)?.origemApprovalId && (args.where as { hashConteudo?: unknown } | undefined)?.hashConteudo) args.orderBy = { criadoEm: 'asc' };
      const linha = await query(args);
      if (aoLerMinuta && (args.select as { conteudo?: boolean } | undefined)?.conteudo) { const executar = aoLerMinuta; aoLerMinuta = null; await executar(); }
      return linha;
    } } } }) as unknown as PrismaClient;
    const papel = await naEmpresa(() => db.$queryRawUnsafe<{ current_user: string; rolbypassrls: boolean; rolsuper: boolean }[]>(`SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`));
    expect(papel[0]).toMatchObject({ current_user: 'mktos_app', rolbypassrls: false, rolsuper: false });
    const rls = await naEmpresa(() => db.$queryRawUnsafe<{ tabela: string; rls: boolean; force: boolean }[]>(`SELECT tabela, rls, force FROM app_rls_estado() WHERE tabela IN ('ComercialDocumento','ComercialContrato','ComercialContratoSignatario','ComercialFicha','LeadEvent','Approval','ToolCall')`));
    expect(rls).toHaveLength(7); expect(rls.every(x => x.rls && x.force)).toBe(true);
    await admin.org.create({ data: { id: orgId, name: 'QA Lote 7', slug: orgId } });
    await admin.org.create({ data: { id: orgB, name: 'QA outra empresa', slug: orgB } });
    for (const key of ['leads.editar', 'aprovacoes.decidir']) await admin.permission.upsert({ where: { key }, create: { key }, update: {} });
    const role = await admin.role.create({ data: { orgId, key: 'admin_master', name: 'Titular QA', permissions: { connect: [{ key: 'leads.editar' }, { key: 'aprovacoes.decidir' }] } } });
    const pessoa = async () => {
      const u = await admin.user.create({ data: { orgId, name: 'Pessoa QA', email: `${randomUUID()}@example.invalid`, passwordHash: 'sem-login', roles: { connect: { id: role.id } } } });
      await admin.clienteAcessoPerfil.create({ data: { orgId, userId: u.id, modo: 'ALL' } });
      return u.id;
    };
    proponente = await pessoa(); aprovador = await pessoa();
    cliente = (await admin.partner.create({ data: { orgId, razaoSocial: 'Cliente QA', isCliente: true } })).id;
    outro = (await admin.partner.create({ data: { orgId, razaoSocial: 'Outro QA', isCliente: true } })).id;
    const p = db as unknown as PrismaService;
    const audit = new AuditService(p);
    policy = new PolicyService(p); await naEmpresa(() => policy.onModuleInit());
    escopo = new EfeitoComercialEscopoService(p, new ClienteEscopoService(p, audit), policy);
    const reacoes = new ReacoesRegistry(); efeitos = new EfeitosRegistry();
    const assinatura = { provedor: 'zapsign', configurada: () => true, criarDocumento: enviar, webhookAutentico: (token: string) => token === 'qa', interpretarWebhook: (corpo: unknown) => corpo };
    svc = new DinheiroService(p, new FioService(p, reacoes), reacoes, efeitos, {} as never, {} as never, assinatura as never, whats as never, undefined, audit, escopo);
    svc.onModuleInit();
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.leadEvent.deleteMany({ where: { orgId } });
    await admin.lead.deleteMany({ where: { orgId: { in: [orgId, orgB] } } });
    await admin.approval.deleteMany({ where: { orgId } });
    await admin.toolCall.deleteMany({ where: { orgId } });
    await admin.clienteAcessoPerfil.deleteMany({ where: { orgId } });
    await admin.partner.deleteMany({ where: { orgId } });
    await admin.user.deleteMany({ where: { orgId } });
    await admin.role.deleteMany({ where: { orgId } });
    await admin.org.deleteMany({ where: { id: { in: [orgId, orgB] } } });
    await db?.$disconnect(); await admin.$disconnect();
  });
  async function fixture(clienteId: string | null = cliente, registro = false) {
    const lead = await admin.lead.create({ data: { orgId, name: 'Lead QA' } });
    await admin.comercialFicha.create({ data: { leadId: lead.id, partnerId: clienteId } });
    await admin.leadEvent.create({ data: { leadId: lead.id, type: 'proposta.aceita', payload: { versao: 1, produto: 'operacao', valorCentavos: 1199700, parcelas: 3, forma: 'pix', hash: 'a'.repeat(64) } } });
    await admin.leadEvent.create({ data: { leadId: lead.id, type: 'aceite.dados', payload: { cnpj: '12345678000190', razaoSocial: 'QA Ltda', endereco: 'Rua A', quemAssina: 'Cliente', email: 'cliente@example.invalid' } } });
    const aceite = await naEmpresa(() => svc.aceiteDoLead(orgId, lead.id));
    let contratoId: string | undefined;
    let hash = svc.contratoDoAceite(aceite!).hash;
    if (registro) {
      const minuta = await admin.comercialDocumento.create({ data: { leadId: lead.id, provedor: 'minuta', externoId: randomUUID(), estado: 'rascunho', hashConteudo: 'b'.repeat(64), conteudo: 'Contrato de prestação de serviços.' } });
      const root = await admin.user.findUniqueOrThrow({ where: { id: aprovador } });
      const contrato = await admin.comercialContrato.create({ data: { leadId: lead.id, partnerId: clienteId, tipo: 'contrato', modalidade: 'implantacao', estado: 'a_emitir', minutaId: minuta.id, faturaPor: '12345678000190', dadosDoContrato: { campos: { contratada_nome: 'Root QA' } }, signatarios: { create: [{ ordem: 1, papel: 'cliente', nome: 'Cliente', email: 'cliente@example.invalid' }, { ordem: 2, papel: 'root', nome: root.name, email: root.email }] } } });
      contratoId = contrato.id;
      hash = (await naEmpresa(() => montarPdfDoRegistro(db as unknown as PrismaService, orgId, contrato.id, aceite))).pdf.hash;
    }
    const args = { leadId: lead.id, clienteId, origemCliente: { versao: 1, clienteId }, versao: 1, hash, signatarioEmail: 'cliente@example.invalid', ...(contratoId ? { contratoId } : {}) };
    const cap = policy.resolverCapacidade(orgId, CAP_CONTRATO) as unknown as { hashKeys?: string[] };
    const tc = await admin.toolCall.create({ data: { orgId, capabilityId: CAP_CONTRATO, actorType: ActorType.user, actorId: proponente, status: 'aguardando_aprovacao', args } });
    const ap = await admin.approval.create({ data: { orgId, capabilityId: CAP_CONTRATO, toolCallId: tc.id, propostoPorId: proponente, propostoPorTipo: ActorType.user, resourceType: 'comercial.contrato', resourceId: `${contratoId ?? lead.id}:${hash.slice(0,16)}`, contentHash: canonicalHash('comercial.contrato', args, cap.hashKeys ?? []), resumo: 'QA', status: ApprovalState.consumida, nivelExigido: RiskLevel.R4, alcadaMinima: 'titular', tokenHash: randomUUID(), aprovadoPorId: aprovador, aprovadoEm: new Date(), consumidoEm: new Date(), expiraEm: new Date(Date.now()+600000) } });
    await admin.toolCall.update({ where: { id: tc.id }, data: { approvalId: ap.id } });
    const executar = () => naEmpresa(() => efeitos.executar(CAP_CONTRATO, args, { orgId, actorType: ActorType.user, actorId: aprovador, approvalId: ap.id }));
    return { leadId: lead.id, args, ap, executar };
  }
  it('emite pelo aceite e mantém M7 suspensa', async () => {
    const f = await fixture(); enviar.mockClear(); whats.prepararTemplate.mockClear();
    const resultado = await f.executar();
    expect(resultado).toMatchObject({ reaproveitado: false }); expect(enviar).toHaveBeenCalledOnce(); expect(whats.prepararTemplate).not.toHaveBeenCalled();
    expect(await naEmpresa(() => db.comercialDocumento.findFirst({ where: { leadId: f.leadId, origemApprovalId: f.ap.id } }))).not.toBeNull();
  });
  it('emite pelo registro com minuta e signatários vinculados', async () => {
    const f = await fixture(cliente, true); enviar.mockClear(); whats.prepararTemplate.mockClear();
    const resultado = await f.executar();
    expect(resultado).toMatchObject({ contratoId: f.args.contratoId, reaproveitado: false });
    expect(enviar).toHaveBeenCalledOnce(); expect(whats.prepararTemplate).not.toHaveBeenCalled();
    expect(await f.executar()).toMatchObject({ contratoId: f.args.contratoId, reaproveitado: true });
    expect(enviar).toHaveBeenCalledOnce();
  });
  it('retorno legítimo registra assinatura após revogação; divergente ou cancelado é recusado', async () => {
    const f = await fixture();
    const resultado = await f.executar() as { documentoId: string; externoId: string };
    await naEmpresa(() => db.clienteAcessoPerfil.update({ where: { userId_orgId: { userId: proponente, orgId } }, data: { modo: 'SELECTED' } }));
    try {
      const evento = { externoId: resultado.externoId, assinados: [{ papel: 'cliente' }], todosAssinaram: false };
      await expect(naEmpresa(() => svc.aplicarAssinatura(orgId, f.leadId, resultado.documentoId, { ...evento, externoId: 'errado' } as never))).rejects.toThrow();
      await expect(comContexto({ orgId: null, correlationId: 'webhook-qa', origem: 'http' }, async () => svc.webhookDaZapsign('qa', evento))).resolves.toMatchObject({ gravados: 1 });
      const doc = await naEmpresa(() => db.comercialDocumento.findUniqueOrThrow({ where: { id: resultado.documentoId } }));
      expect(doc.assinadoClienteEm).not.toBeNull();
      await naEmpresa(() => db.comercialDocumento.update({ where: { id: resultado.documentoId }, data: { estado: 'cancelado' } }));
      await expect(naEmpresa(() => svc.aplicarAssinatura(orgId, f.leadId, resultado.documentoId, evento as never))).rejects.toThrow();
    } finally { await naEmpresa(() => db.clienteAcessoPerfil.update({ where: { userId_orgId: { userId: proponente, orgId } }, data: { modo: 'ALL' } })); }
  });
  it('outra empresa fica invisível no contexto A e webhook restaura contexto', async () => {
    const f = await fixture(), leadB = await admin.lead.create({ data: { orgId: orgB, name: 'Lead B QA' } });
    const docB = await admin.comercialDocumento.create({ data: { leadId: leadB.id, provedor: 'zapsign', externoId: randomUUID(), estado: 'enviado', hashConteudo: 'd'.repeat(64) } });
    await expect(naEmpresa(() => db.comercialDocumento.findFirst({ where: { id: docB.id } }))).resolves.toBeNull();
    enviar.mockClear();
    await expect(naEmpresa(() => efeitos.executar(CAP_CONTRATO, { ...f.args, leadId: leadB.id }, { orgId, actorType: ActorType.user, actorId: aprovador, approvalId: f.ap.id }))).rejects.toThrow();
    expect(enviar).not.toHaveBeenCalled();
    const resultado = await f.executar() as { externoId: string };
    await naEmpresa(async () => {
      await svc.webhookDaZapsign('qa', { externoId: resultado.externoId, assinados: [{ papel: 'cliente' }], todosAssinaram: false });
      expect(contextoAtual()?.orgId).toBe(orgId);
    });
    const intacto = await comContexto({ orgId: orgB, correlationId: 'verifica-b', origem: 'http' }, async () => await db.comercialDocumento.findUniqueOrThrow({ where: { id: docB.id } }));
    expect(intacto.estado).toBe('enviado'); expect(intacto.assinadoClienteEm).toBeNull();
  });
  it('retry mantém documento vinculado da aprovação apesar de outro documento com mesmo hash', async () => {
    const f = await fixture(cliente, true);
    await admin.comercialDocumento.create({ data: { leadId: f.leadId, provedor: 'zapsign', externoId: randomUUID(), estado: 'enviado', hashConteudo: f.args.hash, origemApprovalId: randomUUID(), criadoEm: new Date('2020-01-01T00:00:00Z') } });
    const correto = await admin.comercialDocumento.create({ data: { leadId: f.leadId, provedor: 'zapsign', externoId: randomUUID(), estado: 'enviado', hashConteudo: f.args.hash, origemApprovalId: f.ap.id, criadoEm: new Date('2021-01-01T00:00:00Z') } });
    await admin.comercialContrato.update({ where: { id: f.args.contratoId! }, data: { documentoId: correto.id, estado: 'em_assinatura' } });
    enviar.mockClear(); ordenarBuscaDeDocumento = true;
    try {
      await expect(f.executar()).resolves.toMatchObject({ documentoId: correto.id, contratoId: f.args.contratoId, reaproveitado: true });
      expect(enviar).not.toHaveBeenCalled();
    } finally { ordenarBuscaDeDocumento = false; }
  });
  it.each([true, false])('preflight recusa documento de outra aprovação com vínculo=%s sem consumir', async (vinculado) => {
    const f = await fixture(cliente, true); await f.executar();
    if (!vinculado) await naEmpresa(() => db.comercialContrato.update({ where: { id: f.args.contratoId! }, data: { documentoId: null, estado: 'a_emitir' } }));
    const tc = await admin.toolCall.create({ data: { orgId, capabilityId: CAP_CONTRATO, actorType: ActorType.user, actorId: proponente, status: 'aguardando_aprovacao', args: f.args } });
    const ap = await admin.approval.create({ data: { orgId, capabilityId: CAP_CONTRATO, toolCallId: tc.id, propostoPorId: proponente, propostoPorTipo: ActorType.user, resourceType: f.ap.resourceType, resourceId: f.ap.resourceId, contentHash: f.ap.contentHash, resumo: 'Segunda aprovação QA', status: ApprovalState.confirmada, nivelExigido: RiskLevel.R4, alcadaMinima: 'titular', tokenHash: randomUUID(), aprovadoPorId: aprovador, aprovadoEm: new Date(), consumidoEm: null, expiraEm: new Date(Date.now()+600000) } });
    await admin.toolCall.update({ where: { id: tc.id }, data: { approvalId: ap.id } });
    enviar.mockClear();
    await expect(naEmpresa(() => escopo.exigir(orgId, ap.id, CAP_CONTRATO, f.args, { fase: 'confirmada', atorExecucaoId: aprovador }))).rejects.toThrow();
    const estado = await naEmpresa(() => db.approval.findUniqueOrThrow({ where: { id: ap.id } }));
    expect(estado.status).toBe(ApprovalState.confirmada); expect(estado.consumidoEm).toBeNull(); expect(enviar).not.toHaveBeenCalled();
  });
  it('registro não reaproveita documento emitido por outra aprovação', async () => {
    const f = await fixture(cliente, true); await f.executar();
    const tc = await admin.toolCall.create({ data: { orgId, capabilityId: CAP_CONTRATO, actorType: ActorType.user, actorId: proponente, status: 'aguardando_aprovacao', args: f.args } });
    const ap = await admin.approval.create({ data: { orgId, capabilityId: CAP_CONTRATO, toolCallId: tc.id, propostoPorId: proponente, propostoPorTipo: ActorType.user, resourceType: f.ap.resourceType, resourceId: f.ap.resourceId, contentHash: f.ap.contentHash, resumo: 'Outra aprovação QA', status: ApprovalState.consumida, nivelExigido: RiskLevel.R4, alcadaMinima: 'titular', tokenHash: randomUUID(), aprovadoPorId: aprovador, aprovadoEm: new Date(), consumidoEm: new Date(), expiraEm: new Date(Date.now()+600000) } });
    await admin.toolCall.update({ where: { id: tc.id }, data: { approvalId: ap.id } });
    enviar.mockClear();
    await expect(naEmpresa(() => efeitos.executar(CAP_CONTRATO, f.args, { orgId, actorType: ActorType.user, actorId: aprovador, approvalId: ap.id }))).rejects.toThrow();
    expect(enviar).not.toHaveBeenCalled();
  });
  it('registro não aceita minuta de outro lead da mesma empresa', async () => {
    const f = await fixture(cliente, true), outra = await fixture();
    const minuta = await admin.comercialDocumento.create({ data: { leadId: outra.leadId, provedor: 'minuta', externoId: randomUUID(), estado: 'rascunho', hashConteudo: 'c'.repeat(64), conteudo: 'Minuta de outro lead.' } });
    await naEmpresa(() => db.comercialContrato.update({ where: { id: f.args.contratoId! }, data: { minutaId: minuta.id } }));
    enviar.mockClear(); await expect(f.executar()).rejects.toThrow(); expect(enviar).not.toHaveBeenCalled();
  });
  it('revogação enquanto a minuta é lida para o PDF impede o envio', async () => {
    const f = await fixture(cliente, true); enviar.mockClear(); let interveio = false;
    aoLerMinuta = async () => { interveio = true; await db.clienteAcessoPerfil.update({ where: { userId_orgId: { userId: proponente, orgId } }, data: { modo: 'SELECTED' } }); };
    try { await expect(f.executar()).rejects.toThrow(); expect(interveio).toBe(true); expect(enviar).not.toHaveBeenCalled(); }
    finally { aoLerMinuta = null; await naEmpresa(() => db.clienteAcessoPerfil.update({ where: { userId_orgId: { userId: proponente, orgId } }, data: { modo: 'ALL' } })); }
  });
  it('revogação para SELECTED impede envio mesmo com vínculo', async () => {
    const f = await fixture(); enviar.mockClear();
    await naEmpresa(async () => { await db.clienteAcessoPerfil.update({ where: { userId_orgId: { userId: proponente, orgId } }, data: { modo: 'SELECTED' } }); await db.clienteAcessoVinculo.create({ data: { orgId, userId: proponente, clienteId: cliente } }); });
    try { await expect(f.executar()).rejects.toThrow(); expect(enviar).not.toHaveBeenCalled(); }
    finally { await naEmpresa(async () => { await db.clienteAcessoVinculo.deleteMany({ where: { orgId, userId: proponente } }); await db.clienteAcessoPerfil.update({ where: { userId_orgId: { userId: proponente, orgId } }, data: { modo: 'ALL' } }); }); }
  });
  it('null é válido apenas enquanto a ficha segue sem cliente', async () => {
    const f = await fixture(null); enviar.mockClear();
    await naEmpresa(() => db.comercialFicha.update({ where: { leadId: f.leadId }, data: { partnerId: outro } }));
    await expect(f.executar()).rejects.toThrow(); expect(enviar).not.toHaveBeenCalled();
  });
});
