import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as criarNet } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ReauthService } from '../src/auth/reauth.service';
import { comContexto } from '../src/common/contexto-execucao';
import { ZapsignService } from '../src/comercial/conectores/zapsign.service';
import { ContratoVivoService } from '../src/comercial/contrato-vivo.service';
import { CAP_CANCELAR, CAP_REENVIAR, ContratosService, type QuemNoContrato } from '../src/comercial/contratos/contratos.service';
import { FRASE_DO_IMPORTADO_NO_LOTE, idDoContratoDoDocumento } from '../src/comercial/contratos/contratos-puro';
import { DecisoesService } from '../src/comercial/decisoes.service';
import { CAP_CONTRATO, DinheiroService } from '../src/comercial/dinheiro.service';
import { hashDoConteudo } from '../src/comercial/eventos';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import type { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { EfeitoComercialEscopoService } from '../src/clientes-escopo/efeito-comercial-escopo.service';

/*
 * O MÓDULO DE CONTRATOS CONTRA O BANCO, A RÉGUA E O DUBLÊ (02/11/2026, F1 e F3).
 *
 * A política é a do BANCO (`db:seed:politica`), a porta é a de verdade e a ZapSign é o dublê da homologação
 * (`homolog/mocks/zapsign`), SEM webhook apontado: é assim que a conferência prova que acha a assinatura sozinha.
 * O caminho do documento é o de sempre: o aceite → `comercial.contrato.enviar` (R4) → a titular assina.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lead, contrato, documento, aprovação e rastro do comercial)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';

const MARCA = `ct${Date.now().toString(36).slice(-6)}`;
const ORG = `org-contratos-${MARCA}`;
const OUTRA = `org-contratos-b-${MARCA}`;
const SENHA = 'senha-da-titular-contratos';
const SEGREDO_ZAP = `zap-${MARCA}-segredo-de-teste`;
const RAIZ = path.resolve(__dirname, '../../..');

async function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = criarNet();
    s.once('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

describe.skipIf(!URL)('o módulo de contratos, ponta a ponta', { timeout: 40_000 }, () => {
  let prisma: PrismaClient;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let dinheiro: DinheiroService;
  let fio: FioService;
  let contratos: ContratosService;
  let contratoVivo: ContratoVivoService;
  let zapsign: ZapsignService;
  let portaZap = 0;
  let estado = '';
  let filho: ChildProcess;
  let titularId = '';
  let titular2Id = '';
  let gestorId = '';
  let maquinaId = '';
  const m7: { leadId: string; quemAssina: unknown; chave: unknown }[] = [];
  const ambiente = { base: process.env.ZAPSIGN_BASE_URL, token: process.env.ZAPSIGN_API_TOKEN, hook: process.env.ZAPSIGN_WEBHOOK_TOKEN, modo: process.env.GATEWAY_MODO };

  const naEmpresa = <T>(fn: () => Promise<T>, org = ORG): Promise<T> => comContexto({ orgId: org, correlationId: `contratos-${MARCA}`, origem: 'http' }, fn);
  const gestor = (): QuemNoContrato => ({ id: gestorId, nome: 'Mesa', papeis: ['gestor_marketing'] });

  async function novoLead(nome: string, etapa: 'proposta' | 'contrato' | 'fechado' = 'proposta', valorCentavos: number | null = null): Promise<string> {
    const lead = await prisma.lead.create({ data: { orgId: ORG, name: nome, status: 'proposta', ownerId: gestorId }, select: { id: true } });
    await prisma.comercialFicha.create({ data: { leadId: lead.id, etapa, empresa: nome, valorCentavos } });
    return lead.id;
  }

  /** O aceite no fio, sem sala nem reação: o bastante para `comercial.contrato.enviar` montar o documento. */
  async function comAceite(leadId: string, nome: string): Promise<void> {
    await naEmpresa(async () => {
      await fio.registrar(ORG, leadId, 'proposta.aceita', 'v1', { versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, forma: 'pix', hash: hashDoConteudo({ leadId, v: 1 }) } as never, { semReacoes: true });
      await fio.registrar(ORG, leadId, 'aceite.dados', 'v1', { cnpj: '12345678000190', razaoSocial: `${nome} Ltda`, endereco: 'Rua A, 1', quemAssina: 'Marina Duarte', email: 'marina@cliente.test' } as never, { semReacoes: true });
    });
  }

  /** Propõe o contrato do aceite e a titular assina: o documento nasce no dublê. Devolve o registro. */
  async function contratoEnviado(nome: string) {
    const leadId = await novoLead(nome);
    await comAceite(leadId, nome);
    await naEmpresa(() => dinheiro.proporAceite(ORG, leadId, { id: gestorId, tipo: 'user' as never }));
    const ap = await prisma.approval.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAP_CONTRATO, resourceId: { startsWith: `${leadId}:` } }, orderBy: { criadoEm: 'desc' } });
    await naEmpresa(() => approvals.confirm(ORG, ap.id, { id: titularId, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'conferi o aceite e o valor'));
    await naEmpresa(() => acoes.executarAprovada(ORG, ap.id, titularId));
    const contrato = await prisma.comercialContrato.findFirstOrThrow({ where: { orgId: ORG, leadId }, include: { signatarios: { orderBy: { ordem: 'asc' } }, documento: true } });
    return { leadId, contrato, documento: contrato.documento! };
  }

  async function docNoDuble(externoId: string): Promise<Record<string, unknown> & { signers: { token: string; status: string }[]; status: string }> {
    const r = await fetch(`http://127.0.0.1:${portaZap}/api/v1/docs/${externoId}/`, { headers: { authorization: 'Bearer x' } });
    return (await r.json()) as never;
  }

  /**
   * Outra pessoa libera, com senha e motivo: a capacidade é R3, mas um sinal aceso (fora da janela, segundo pedido
   * na hora) sobe a R4 na hora do pedido, e a suíte roda a qualquer hora. O nível de catálogo é conferido à parte.
   */
  async function titularLibera(approvalId: string): Promise<unknown> {
    await naEmpresa(() => approvals.confirm(ORG, approvalId, { id: titularId, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'conferi o pedido e pode sair'));
    return naEmpresa(() => acoes.executarAprovada(ORG, approvalId, titularId));
  }

  const assinarNoDuble = async (token: string) => {
    await fetch(`http://127.0.0.1:${portaZap}/simular/assinar/${token}`, { method: 'POST', headers: { accept: 'application/json' } });
  };

  /** O nível de catálogo da capacidade, na política que o banco tem (a que a porta usa). */
  async function nivelDeCatalogo(capabilityId: string): Promise<string> {
    const c = await prisma.capability.findUniqueOrThrow({ where: { id: capabilityId }, select: { level: true } });
    return String(c.level);
  }

  beforeAll(async () => {
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    estado = mkdtempSync(path.join(tmpdir(), 'contratos-'));
    portaZap = await portaLivre();
    filho = spawn(process.execPath, [path.join(RAIZ, 'homolog/mocks/zapsign/server.mjs')], {
      env: { ...process.env, PORT: String(portaZap), WEBHOOK_URL: '', PUBLIC_URL: `http://127.0.0.1:${portaZap}`, ESTADO: path.join(estado, 'zap.json') },
      stdio: 'ignore',
    });
    const ate = Date.now() + 10_000;
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${portaZap}/health`)).ok) break;
      } catch {
        /* ainda subindo */
      }
      if (Date.now() > ate) throw new Error('o dublê da ZapSign não subiu');
      await new Promise((r) => setTimeout(r, 100));
    }
    process.env.ZAPSIGN_BASE_URL = `http://127.0.0.1:${portaZap}/api/v1`;
    process.env.ZAPSIGN_API_TOKEN = 'token-de-homologacao';
    process.env.ZAPSIGN_WEBHOOK_TOKEN = SEGREDO_ZAP;

    for (const org of [ORG, OUTRA]) await prisma.org.create({ data: { id: org, name: org, slug: org } });
    for(const key of ['leads.editar','aprovacoes.decidir']) await prisma.permission.upsert({where:{key},update:{},create:{key}});
    const comPermissao = { permissions: { connect: [{ key: 'leads.editar' },{key:'aprovacoes.decidir'}] } };
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin', ...comPermissao }, select: { id: true } });
    const papelGestor = await prisma.role.create({ data: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor', ...comPermissao }, select: { id: true } });
    const papelMaquina = await prisma.role.create({ data: { orgId: ORG, key: 'ia_acao', name: 'Máquina', ...comPermissao }, select: { id: true } });
    const pessoa = async (rotulo: string, nome: string, papel: string) =>
      (await prisma.user.create({ data: { orgId: ORG, email: `${rotulo}-${MARCA}@contratos.teste`, name: nome, passwordHash: await bcrypt.hash(SENHA, 4), roles: { connect: { id: papel } } }, select: { id: true } })).id;
    titularId = await pessoa('titular', 'Titular da Root', admin.id);
    titular2Id = await pessoa('titular2', 'Outra Titular', admin.id);
    gestorId = await pessoa('gestor', 'Mesa', papelGestor.id);
    maquinaId = await pessoa('maquina', 'Conta de IA', papelMaquina.id);
    for(const userId of [titularId,titular2Id,gestorId,maquinaId]) await prisma.clienteAcessoPerfil.create({data:{orgId:ORG,userId,modo:'ALL'}});

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const escopo=new EfeitoComercialEscopoService(p,new ClienteEscopoService(p,audit),policy);
    const reauth = new ReauthService(p, new JwtService({ secret: `segredo-${MARCA}` }), audit);
    approvals = new ApprovalsService(p, audit, reauth);
    const eventos = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(p, audit, eventos, interruptores).onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, efeitos,undefined,undefined,escopo);
    acoes = new AcoesService(p, gateway, eventos, interruptores, policy);
    const porta = new PortaDoOperador(gateway, efeitos);
    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    const relogio = new RelogioComercialRegistry();
    zapsign = new ZapsignService();
    const naoCobra = new Proxy({} as never, { get: (_a, chave) => (chave === 'provedor' ? 'asaas' : chave === 'configurada' ? () => true : () => { throw new Error('a cobrança não deveria ser chamada'); }) });
    const whats = { prepararTemplate: vi.fn(async (_o: string, leadId: string, _t: string, v: Record<string, unknown>, op: { chave?: string }) => { m7.push({ leadId, quemAssina: v.quemAssina, chave: op.chave }); return {} as never; }) } as unknown as WhatsappComercialService;
    dinheiro = new DinheiroService(p, fio, reacoes, efeitos, porta, naoCobra, zapsign, whats, reauth, audit,escopo);
    dinheiro.onModuleInit();
    contratoVivo = new ContratoVivoService(p, fio, relogio, {} as DecisoesService);
    contratoVivo.onModuleInit();
    contratos = new ContratosService(p, fio, reacoes, efeitos, relogio, porta, dinheiro, zapsign, whats, interruptores);
    contratos.onModuleInit();
  }, 60_000);

  afterAll(async () => {
    filho?.kill();
    rmSync(estado, { recursive: true, force: true });
    for (const [k, v] of [['ZAPSIGN_BASE_URL', ambiente.base], ['ZAPSIGN_API_TOKEN', ambiente.token], ['ZAPSIGN_WEBHOOK_TOKEN', ambiente.hook], ['GATEWAY_MODO', ambiente.modo]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.leadEvent.deleteMany({ where: { orgId: ORG } });
    await prisma.lead.deleteMany({ where: { orgId: { in: [ORG, OUTRA] } } });
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.clienteAcessoPerfil.deleteMany({where:{orgId:ORG}});
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: { in: [ORG, OUTRA] } } });
    await prisma.$disconnect();
  }, 60_000);

  it('o id do código é o do backfill: a mesma conta no banco', async () => {
    const [linha] = await prisma.$queryRaw<{ m: string }[]>`SELECT md5('comercial-contrato:' || 'doc-qualquer') AS m`;
    expect(idDoContratoDoDocumento('doc-qualquer').replace(/-/g, '')).toBe(linha!.m);
  });

  it('criar é de gente, idempotente, e vai ao fio e à auditoria', async () => {
    const leadId = await novoLead('Criar Ltda', 'contrato', 500_000);
    await expect(naEmpresa(() => contratos.criar(ORG, { id: maquinaId, nome: 'IA', papeis: ['ia_acao'] }, { leadId, modalidade: 'implantacao' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(naEmpresa(() => contratos.criar(ORG, { id: maquinaId, nome: 'IA', papeis: [] }, { leadId, modalidade: 'implantacao' }))).rejects.toBeInstanceOf(ForbiddenException);
    const a = await naEmpresa(() => contratos.criar(ORG, gestor(), { leadId, modalidade: 'implantacao' }));
    const b = await naEmpresa(() => contratos.criar(ORG, gestor(), { leadId, modalidade: 'continuidade' }));
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ estado: 'a_emitir', etapa: 'a_emitir', modalidade: 'implantacao', valorCentavos: 500_000, cliente: 'Criar Ltda', dono: 'Mesa', fantasma: false });
    expect(a.faltaParaEnviar.join(' ')).toMatch(/CNPJ que fatura/);
    const linhas = await prisma.comercialContrato.findMany({ where: { leadId } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.orgId).toBe(ORG);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.registrado' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'comercial.contrato.criado', entityId: a.id } })).toBe(1);
    // Lead de outra empresa é "não encontrado".
    await expect(naEmpresa(() => contratos.ficha(OUTRA, a.id), OUTRA)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('editar: vigência e CNPJ; signatário da Root só titular ativo; cliente pode ser dois', async () => {
    const leadId = await novoLead('Editar Ltda');
    const { id } = await naEmpresa(() => contratos.criar(ORG, gestor(), { leadId, modalidade: 'continuidade' }));
    const editado = await naEmpresa(() => contratos.editar(ORG, id, gestor(), { numero: ' 12/2026 ', vigenciaInicio: '2026-11-01', vigenciaFim: '2027-10-31', faturaPor: '12.345.678/0001-90' }));
    expect(editado).toMatchObject({ numero: '12/2026', vigenciaInicio: '2026-11-01', vigenciaFim: '2027-10-31', faturaPor: '12.345.678/0001-90' });
    await expect(naEmpresa(() => contratos.editar(ORG, id, gestor(), { vigenciaFim: '2020-01-01' }))).rejects.toBeInstanceOf(BadRequestException);

    const emailDe = async (uid: string) => (await prisma.user.findUniqueOrThrow({ where: { id: uid }, select: { email: true } })).email;
    const emailGestor = await emailDe(gestorId);
    await expect(naEmpresa(() => contratos.definirSignatarios(ORG, id, gestor(), { signatarios: [{ papel: 'cliente', nome: 'Sócia', email: 'a@c.test' }, { papel: 'root', nome: 'Mesa', email: emailGestor }] }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(naEmpresa(() => contratos.definirSignatarios(ORG, id, gestor(), { signatarios: [{ papel: 'cliente', nome: 'Sócia', email: 'a@c.test' }, { papel: 'root', nome: 'Ninguém', email: 'fora@c.test' }] }))).rejects.toBeInstanceOf(BadRequestException);
    const emailTitular = await emailDe(titular2Id);
    const ficha = await naEmpresa(() => contratos.definirSignatarios(ORG, id, gestor(), { signatarios: [
      { papel: 'cliente', nome: 'Sócia Um', email: 'um@c.test' }, { papel: 'cliente', nome: 'Sócio Dois', email: 'dois@c.test' }, { papel: 'root', nome: 'Nome digitado', email: emailTitular.toUpperCase() },
    ] }));
    expect(ficha.signatarios.map((s) => [s.ordem, s.papel, s.nome])).toEqual([[1, 'cliente', 'Sócia Um'], [2, 'cliente', 'Sócio Dois'], [3, 'root', 'Outra Titular']]);
    expect(JSON.stringify(ficha)).not.toContain('tokenNoProvedor');
    // Refazer a lista inteira funciona; o fio não leva nome nem e-mail.
    const fatos = await prisma.leadEvent.findMany({ where: { leadId, type: 'contrato.registrado' }, select: { payload: true } });
    expect(JSON.stringify(fatos)).not.toContain('um@c.test');
  });

  it('o caminho de sempre cria o registro, com os dois signatários e os tokens; o external_id é o novo', async () => {
    const { contrato, documento } = await contratoEnviado('Efeito Ltda');
    expect(contrato).toMatchObject({ estado: 'em_assinatura', tipo: 'contrato', hashDoConteudo: documento.hashConteudo });
    expect(contrato.signatarios.map((s) => [s.ordem, s.papel, s.nome])).toEqual([[1, 'cliente', 'Marina Duarte'], [2, 'root', 'Titular da Root']]);
    expect(contrato.signatarios.every((s) => !!s.tokenNoProvedor)).toBe(true);
    const noDuble = await docNoDuble(documento.externoId);
    expect((noDuble.signers as unknown as { external_id: string }[]).map((s) => s.external_id)).toEqual(['cliente:1', 'root:1']);
    // Depois de enviado, a lista não muda mais.
    await expect(naEmpresa(() => contratos.definirSignatarios(ORG, contrato.id, gestor(), { signatarios: [{ papel: 'cliente', nome: 'Outra', email: 'x@c.test' }, { papel: 'root', nome: 'T', email: 'y@c.test' }] }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('retry do esqueleto só reaproveita documento da mesma aprovação consumida',async()=>{
    const {leadId,documento}=await contratoEnviado('Retry do esqueleto');
    const approvalId=documento.origemApprovalId!;
    const ap=await prisma.approval.findUniqueOrThrow({where:{id:approvalId}});
    const chamada=await prisma.toolCall.findUniqueOrThrow({where:{id:ap.toolCallId!}});
    const args=chamada.args as Record<string,unknown>;
    const efeito=(dinheiro as unknown as {efeitoDeContrato:(a:unknown,o:string,c:unknown)=>Promise<{reaproveitado:boolean}>}).efeitoDeContrato.bind(dinheiro);
    const ctx={orgId:ORG,actorType:'user',actorId:titularId,approvalId};
    const provedor=vi.spyOn(zapsign,'criarDocumento');
    try {
      expect(await naEmpresa(()=>efeito(args,ORG,ctx))).toMatchObject({reaproveitado:true,documentoId:documento.id});
      expect(provedor).not.toHaveBeenCalled();
      const tc2=await prisma.toolCall.create({data:{orgId:ORG,capabilityId:CAP_CONTRATO,actorType:ap.propostoPorTipo,actorId:ap.propostoPorId,status:'aguardando_aprovacao',args:args as never}});
      const ap2=await prisma.approval.create({data:{orgId:ORG,toolCallId:tc2.id,capabilityId:CAP_CONTRATO,propostoPorTipo:ap.propostoPorTipo,propostoPorId:ap.propostoPorId,resourceType:ap.resourceType,resourceId:ap.resourceId,contentHash:ap.contentHash,resumo:'Outra aprovação de teste',status:'consumida',nivelExigido:'R4',tokenHash:crypto.randomUUID(),aprovadoPorId:titularId,aprovadoEm:new Date(),consumidoEm:new Date(),expiraEm:new Date(Date.now()+600000)}});
      await prisma.toolCall.update({where:{id:tc2.id},data:{approvalId:ap2.id}});
      await expect(naEmpresa(()=>efeito(args,ORG,{...ctx,approvalId:ap2.id}))).rejects.toThrow();
      expect(provedor).not.toHaveBeenCalled();
      expect(await prisma.comercialDocumento.count({where:{orgId:ORG,leadId,provedor:'zapsign'}})).toBe(1);
    } finally {provedor.mockRestore();}
  });

  it('a consulta acha a assinatura sem webhook, e a reentrega do webhook não duplica nada', async () => {
    const { leadId, contrato, documento } = await contratoEnviado('Conferir Ltda');
    const nada = await naEmpresa(() => contratos.conferir(ORG, contrato.id, gestor()));
    expect(nada).toMatchObject({ estado: 'em_assinatura', mudou: false, assinaturas: { feitas: 0, total: 2 } });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.conferido' } })).toBe(0);

    const noDuble = await docNoDuble(documento.externoId);
    await assinarNoDuble(noDuble.signers[0]!.token);
    const parcial = await naEmpresa(() => contratos.conferir(ORG, contrato.id, gestor()));
    expect(parcial).toMatchObject({ estado: 'em_assinatura', mudou: true, assinaturas: { feitas: 1, total: 2 } });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.assinado_cliente' } })).toBe(1);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.assinado' } })).toBe(0);
    expect((await prisma.comercialDocumento.findUniqueOrThrow({ where: { id: documento.id } })).estado).toBe('assinado_parcial');

    await assinarNoDuble(noDuble.signers[1]!.token);
    const tudo = await naEmpresa(() => contratos.conferir(ORG, contrato.id, gestor()));
    expect(tudo).toMatchObject({ estado: 'assinado', mudou: true, assinaturas: { feitas: 2, total: 2 } });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.assinado' } })).toBe(1);
    expect((await prisma.comercialContratoSignatario.findMany({ where: { contratoId: contrato.id } })).every((s) => s.assinadoEm)).toBe(true);

    // Conferir de novo e o webhook chegando atrasado, duas vezes: nenhum fato a mais.
    expect(await naEmpresa(() => contratos.conferir(ORG, contrato.id, gestor()))).toMatchObject({ estado: 'assinado', mudou: false });
    const corpo = { ...(await docNoDuble(documento.externoId)), event_type: 'doc_signed' };
    for (let i = 0; i < 2; i++) expect(await dinheiro.webhookDaZapsign(SEGREDO_ZAP, corpo)).toMatchObject({ ok: true, gravados: 0 });
    for (const type of ['contrato.assinado_cliente', 'contrato.assinado_root', 'contrato.assinado']) {
      expect(await prisma.leadEvent.count({ where: { leadId, type } }), type).toBe(1);
    }
    // Cliente ativo promove o registro.
    await naEmpresa(() => fio.registrar(ORG, leadId, 'cliente.ativo', `fech-${leadId}-v1`, { chave: `fech-${leadId}-v1` } as never));
    expect((await prisma.comercialContrato.findUniqueOrThrow({ where: { id: contrato.id } })).estado).toBe('ativo');
  });

  it('o webhook reflete a assinatura no registro, e o segredo errado segue recusado', async () => {
    const { contrato, documento } = await contratoEnviado('Webhook Ltda');
    await expect(dinheiro.webhookDaZapsign('errado', {})).rejects.toMatchObject({ status: 401 });
    const noDuble = await docNoDuble(documento.externoId);
    await assinarNoDuble(noDuble.signers[0]!.token);
    await dinheiro.webhookDaZapsign(SEGREDO_ZAP, { ...(await docNoDuble(documento.externoId)), event_type: 'signer_signed' });
    const s = await prisma.comercialContratoSignatario.findMany({ where: { contratoId: contrato.id }, orderBy: { ordem: 'asc' } });
    expect(s.map((x) => !!x.assinadoEm)).toEqual([true, false]);
    expect((await prisma.comercialContrato.findUniqueOrThrow({ where: { id: contrato.id } })).estado).toBe('em_assinatura');
  });

  it('sem token: conferir diz 503 com a frase, e a rotina não faz nada', async () => {
    const { contrato } = await contratoEnviado('Sem Token Ltda');
    const configurada = vi.spyOn(zapsign, 'configurada').mockReturnValue(false);
    try {
      await expect(naEmpresa(() => contratos.conferir(ORG, contrato.id, gestor()))).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(naEmpresa(() => contratos.conferir(ORG, contrato.id, gestor()))).rejects.toThrow(/não tem token/);
      expect(await naEmpresa(() => contratos.conferirEmAssinatura(ORG, new Date()))).toEqual({ conferidos: 0, mudaram: 0, erros: 0 });
      expect((await naEmpresa(() => contratos.quadro(ORG))).assinaturaConfigurada).toBe(false);
    } finally {
      configurada.mockRestore();
    }
  });

  it('o relógio confere só o que está em assinatura e respeita o intervalo', async () => {
    const { contrato, documento } = await contratoEnviado('Relogio Ltda');
    const noDuble = await docNoDuble(documento.externoId);
    await assinarNoDuble(noDuble.signers[0]!.token);
    await prisma.comercialContrato.updateMany({ where: { orgId: ORG, estado: 'em_assinatura', id: { not: contrato.id } }, data: { ultimaConferenciaEm: new Date() } });
    await prisma.comercialContrato.updateMany({ where: { id: contrato.id }, data: { ultimaConferenciaEm: null } });
    const agora = new Date();
    const r = await naEmpresa(() => contratos.conferirEmAssinatura(ORG, agora));
    expect(r).toEqual({ conferidos: 1, mudaram: 1, erros: 0 });
    // Dentro dos 30 minutos, o mesmo contrato não volta; depois, volta.
    expect((await naEmpresa(() => contratos.conferirEmAssinatura(ORG, new Date(agora.getTime() + 5 * 60_000)))).conferidos).toBe(0);
    await prisma.comercialContrato.updateMany({ where: { orgId: ORG, estado: 'em_assinatura', id: { not: contrato.id } }, data: { ultimaConferenciaEm: new Date(agora.getTime() + 31 * 60_000) } });
    expect((await naEmpresa(() => contratos.conferirEmAssinatura(ORG, new Date(agora.getTime() + 31 * 60_000)))).conferidos).toBe(1);
  });

  it('cancelar vai à porta: R3, em nome de quem clicou; só outra pessoa libera, e o documento sai do dublê', async () => {
    const { leadId, contrato, documento } = await contratoEnviado('Cancelar Ltda');
    const retida = (await naEmpresa(() => contratos.proporCancelar(ORG, contrato.id, gestor(), { motivo: 'o cliente pediu para refazer' }))) as { status: string; approvalId: string; nivel: string };
    expect(retida.status).toBe('aguardando_aprovacao');
    const ap = await prisma.approval.findUniqueOrThrow({ where: { id: retida.approvalId } });
    expect(ap).toMatchObject({ capabilityId: CAP_CANCELAR, propostoPorId: gestorId, status: 'pendente' });
    expect(await nivelDeCatalogo(CAP_CANCELAR)).toBe('R3');
    // Nada saiu ainda, e o segundo clique não abre outro pedido.
    expect((await docNoDuble(documento.externoId)).status).toBe('pending');
    expect(await naEmpresa(() => contratos.proporCancelar(ORG, contrato.id, gestor(), { motivo: 'o cliente pediu para refazer' }))).toMatchObject({ status: 'aguardando_aprovacao', approvalId: ap.id, jaNaFila: true });
    // Quem propôs não libera.
    await expect(naEmpresa(() => approvals.confirm(ORG, ap.id, { id: gestorId, papeis: ['gestor_marketing'], reauth: { senha: SENHA } }, 'tentando assinar o próprio pedido'))).rejects.toBeTruthy();
    await titularLibera(ap.id);

    const depois = await prisma.comercialContrato.findUniqueOrThrow({ where: { id: contrato.id } });
    expect(depois).toMatchObject({ estado: 'cancelado', motivoDoFim: 'o cliente pediu para refazer' });
    expect(await prisma.comercialDocumento.findUniqueOrThrow({ where: { id: documento.id } })).toMatchObject({ estado: 'cancelado', linkCliente: null, linkRoot: null });
    const r = await fetch(`http://127.0.0.1:${portaZap}/api/v1/docs/${documento.externoId}/`, { headers: { authorization: 'Bearer x' } });
    expect(r.status).toBe(404);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.cancelado' } })).toBe(1);
    await expect(naEmpresa(() => contratos.reabrir(ORG, contrato.id, gestor(), { motivo: 'tentar reabrir' }))).rejects.toThrow(/não reabre/);
    // Documento cancelado não conta como "já existe": o aceite pode ir de novo.
    expect(await naEmpresa(() => dinheiro.proporAceite(ORG, leadId, { id: gestorId, tipo: 'user' as never }))).toMatchObject({ contrato: 'proposta' });
    // E um novo registro pode nascer: o cancelado não é vivo.
    const novo = await naEmpresa(() => contratos.criar(ORG, gestor(), { leadId, modalidade: 'implantacao' }));
    expect(novo.id).not.toBe(contrato.id);
  });

  it('documento todo assinado não sai da ZapSign: o efeito recusa e grava a assinatura', async () => {
    const { contrato, documento } = await contratoEnviado('Assinou Antes Ltda');
    const retida = (await naEmpresa(() => contratos.proporCancelar(ORG, contrato.id, gestor(), { motivo: 'pedido antes de assinarem' }))) as { approvalId: string };
    const noDuble = await docNoDuble(documento.externoId);
    for (const s of noDuble.signers) await assinarNoDuble(s.token);
    // O efeito lança, e a fila devolve a recusa: o que importa é o que ficou no provedor e no registro.
    await titularLibera(retida.approvalId).catch(() => undefined);
    expect((await docNoDuble(documento.externoId)).status).toBe('signed');
    expect((await prisma.comercialContrato.findUniqueOrThrow({ where: { id: contrato.id } })).estado).toBe('assinado');
    await expect(naEmpresa(() => contratos.proporCancelar(ORG, contrato.id, gestor(), { motivo: 'agora já assinado' }))).rejects.toThrow(/não se cancela/);
  });

  it('reenviar: R3, prepara a M7 para quem do cliente falta, e o link não vai ao fio nem ao resultado', async () => {
    m7.length = 0;
    const { leadId, contrato } = await contratoEnviado('Reenviar Ltda');
    const envioOriginal = m7.length;
    const retida = (await naEmpresa(() => contratos.proporReenviar(ORG, contrato.id, gestor()))) as { approvalId: string };
    const ap = await prisma.approval.findUniqueOrThrow({ where: { id: retida.approvalId } });
    expect(ap).toMatchObject({ capabilityId: CAP_REENVIAR, propostoPorId: gestorId });
    expect(await nivelDeCatalogo(CAP_REENVIAR)).toBe('R3');
    const feito = await titularLibera(ap.id);
    expect(JSON.stringify(feito)).not.toContain('/assinar/');
    expect(m7.slice(envioOriginal)).toMatchObject([{ leadId, quemAssina: 'Marina Duarte' }]);
    const fato = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'contrato.reenviado' } });
    expect(fato.payload).toMatchObject({ pendentes: 2, mensagemPreparada: true });
    expect(JSON.stringify(fato.payload)).not.toContain('/assinar/');
  });

  describe('sobre contrato ativo', () => {
    let leadId = '';
    let id = '';

    beforeAll(async () => {
      const e = await contratoEnviado('Ativo Ltda');
      leadId = e.leadId;
      id = e.contrato.id;
      for (const s of (await docNoDuble(e.documento.externoId)).signers) await assinarNoDuble(s.token);
      await naEmpresa(() => contratos.conferir(ORG, id, gestor()));
      await naEmpresa(() => fio.registrar(ORG, leadId, 'cliente.ativo', `fech-${leadId}-v1`, { chave: `fech-${leadId}-v1` } as never));
    }, 40_000);

    it('aditivo e distrato nascem rascunho; o mesmo pedido cai no mesmo; distrato pede ciência e não mexe na cobrança', async () => {
      const ficha = await naEmpresa(() => contratos.criarFilho(ORG, id, gestor(), { tipo: 'aditivo', motivo: 'muda o escopo da fase 2', mudancas: 'nova entrega', valorCentavos: 100_000 }));
      expect(ficha.aditivos).toBe(1);
      const doc = ficha.documentos.find((d) => d.tipo === 'aditivo')!;
      expect(doc.estado).toBe('rascunho');
      const denovo = await naEmpresa(() => contratos.criarFilho(ORG, id, gestor(), { tipo: 'aditivo', motivo: 'muda o escopo da fase 2', mudancas: 'nova entrega', valorCentavos: 100_000 }));
      expect(denovo.aditivos).toBe(1);
      const linha = await prisma.comercialContrato.findUniqueOrThrow({ where: { id: doc.id }, include: { signatarios: true } });
      expect(linha).toMatchObject({ paiId: id, tipo: 'aditivo', estado: 'rascunho', valorCentavos: 100_000 });
      expect(linha.signatarios).toHaveLength(2);
      // A ficha do filho abre sozinha.
      expect(await naEmpresa(() => contratos.ficha(ORG, doc.id))).toMatchObject({ tipo: 'aditivo', paiId: id, etapa: 'minuta' });
      // O filho não vira cartão.
      expect((await naEmpresa(() => contratos.quadro(ORG))).itens.some((i) => i.id === doc.id)).toBe(false);

      const cobranca = await prisma.comercialCobranca.create({ data: { leadId, provedor: 'asaas', externoId: `pay-${MARCA}`, parcela: 1, parcelas: 1, valorCentavos: 1000, forma: 'pix', vence: new Date(Date.now() + 86_400_000) } });
      await expect(naEmpresa(() => contratos.criarFilho(ORG, id, gestor(), { tipo: 'distrato', motivo: 'o cliente desistiu' }))).rejects.toBeInstanceOf(BadRequestException);
      const comDistrato = await naEmpresa(() => contratos.criarFilho(ORG, id, gestor(), { tipo: 'distrato', motivo: 'o cliente desistiu', cienteDasParcelas: true }));
      expect(comDistrato.documentos.filter((d) => d.tipo === 'distrato')).toHaveLength(1);
      // A ciência fica gravada: no registro do distrato e no fato.
      const doDistrato = await prisma.comercialContrato.findUniqueOrThrow({ where: { id: comDistrato.documentos.find((d) => d.tipo === 'distrato')!.id } });
      expect(doDistrato.dadosDoContrato).toMatchObject({ parcelasEmAberto: 1, cienteDasParcelas: true });
      expect((await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'contrato.distrato' } })).payload).toMatchObject({ parcelasEmAberto: 1, cienteDasParcelas: true });
      await expect(naEmpresa(() => contratos.criarFilho(ORG, id, gestor(), { tipo: 'distrato', motivo: 'outro motivo qualquer', cienteDasParcelas: true }))).rejects.toThrow(/já tem um distrato/);
      expect(await prisma.comercialCobranca.findUniqueOrThrow({ where: { id: cobranca.id } })).toMatchObject({ estado: 'pendente', pagaEm: null });
      expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.distrato' } })).toBe(1);
      await prisma.comercialCobranca.deleteMany({ where: { id: cobranca.id } });
    });

    it('encerrar e reabrir: R0 pela escada, auditados, e a lista de contratos vivos conta igual', async () => {
      const fim = await naEmpresa(() => contratos.encerrar(ORG, id, gestor(), { motivo: 'escopo entregue e aceito' }));
      expect(fim).toMatchObject({ estado: 'encerrado', etapa: 'encerrado', motivoDoFim: 'escopo entregue e aceito' });
      expect(await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'comercial.contrato.encerrado', entityId: id } })).toMatchObject({ actorId: gestorId });
      expect((await naEmpresa(() => contratoVivo.doLead(ORG, leadId))).situacao).toBe('concluido');
      await expect(naEmpresa(() => contratos.encerrar(ORG, id, gestor(), { motivo: 'de novo' }))).rejects.toBeInstanceOf(ConflictException);

      const aberto = await naEmpresa(() => contratos.reabrir(ORG, id, gestor(), { motivo: 'encerrado por engano' }));
      expect(aberto).toMatchObject({ estado: 'ativo', motivoDoFim: null });
      expect((await naEmpresa(() => contratoVivo.doLead(ORG, leadId))).encerramento).toBeNull();

      // Encerrar de novo, pela rota antiga: a chave do fato muda depois da reabertura, e o registro acompanha.
      await naEmpresa(() => contratoVivo.encerrar(ORG, leadId, { id: gestorId, papeis: ['gestor_marketing'] }, { situacao: 'concluido', motivo: 'agora sim terminou' }));
      expect(await prisma.comercialContrato.findUniqueOrThrow({ where: { id } })).toMatchObject({ estado: 'encerrado', motivoDoFim: 'agora sim terminou' });
      // Reabrir sem motivo também vale.
      expect(await naEmpresa(() => contratos.reabrir(ORG, id, gestor(), {}))).toMatchObject({ estado: 'ativo' });
      expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.reaberto' } })).toBe(2);
    });

    it('desativar pela rota antiga leva o cartão a A encerrar', async () => {
      await naEmpresa(() => contratoVivo.encerrar(ORG, leadId, { id: gestorId, papeis: ['gestor_marketing'] }, { situacao: 'desativado', motivo: 'cliente pediu a pausa' }));
      const q = await naEmpresa(() => contratos.quadro(ORG));
      expect(q.itens.find((i) => i.id === id)).toMatchObject({ estado: 'ativo', etapa: 'a_encerrar', aviso: 'Cliente desativado com contrato vivo' });
    });
  });

  it('o quadro: fantasma com aviso, importado derivado, e o primeiro ato cria o registro', async () => {
    const comContrato = await novoLead('Grupo Serra');
    await naEmpresa(() => contratos.criar(ORG, gestor(), { leadId: comContrato, modalidade: 'implantacao' }));
    const fantasma = await novoLead('Grupo Serra Filial', 'fechado');
    const naProposta = await novoLead('Ainda Em Proposta', 'proposta');
    const importado = await novoLead('Importado Ltda', 'fechado');
    for (const [origem, valor] of [['cartao:a', 100_000], ['cartao:b', 250_000]] as const) {
      await naEmpresa(() => fio.registrar(ORG, importado, 'contrato.importado', origem, { origem, titulo: 'Contrato antigo', produtoRotulo: null, valorCentavos: valor, fechadoEm: '2026-01-10', semDocumento: true } as never, { semReacoes: true }));
    }

    let q = await naEmpresa(() => contratos.quadro(ORG));
    expect(q.itens.find((i) => i.leadId === fantasma)).toMatchObject({ id: `sem-contrato:${fantasma}`, fantasma: true, etapa: 'a_emitir', aviso: 'conferir: pode ser o mesmo contrato de Grupo Serra' });
    expect(q.itens.some((i) => i.leadId === naProposta)).toBe(false);
    const doImportado = q.itens.filter((i) => i.leadId === importado);
    expect(doImportado).toHaveLength(1);
    expect(doImportado[0]).toMatchObject({ id: `importado:${importado}`, importado: true, etapa: 'ativo', valorCentavos: 350_000, temPdf: false });
    expect(await prisma.comercialContrato.count({ where: { leadId: importado } })).toBe(0);

    // A ficha do importado e a do fantasma abrem sem criar nada.
    expect(await naEmpresa(() => contratos.ficha(ORG, `importado:${importado}`))).toMatchObject({ importado: true, signatarios: [] });
    expect(await naEmpresa(() => contratos.ficha(ORG, `sem-contrato:${fantasma}`))).toMatchObject({ fantasma: true });
    await expect(naEmpresa(() => contratos.encerrar(ORG, `sem-contrato:${fantasma}`, gestor(), { motivo: 'não existe contrato' }))).rejects.toBeInstanceOf(ConflictException);
    await expect(naEmpresa(() => contratos.conferir(ORG, `importado:${importado}`, gestor()))).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.comercialContrato.count({ where: { leadId: importado } })).toBe(0);

    // Agir cria o registro: uma linha, com a soma e as duas origens; o cartão continua um só.
    const editado = await naEmpresa(() => contratos.editar(ORG, `importado:${importado}`, gestor(), { vigenciaFim: '2026-12-01' }));
    expect(editado).toMatchObject({ importado: true, valorCentavos: 350_000, etapa: 'renovar' });
    const linhas = await prisma.comercialContrato.findMany({ where: { leadId: importado } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ origemImportada: 'cartao:a', dadosDoContrato: { origens: ['cartao:a', 'cartao:b'] } });
    q = await naEmpresa(() => contratos.quadro(ORG));
    expect(q.itens.filter((i) => i.leadId === importado).map((i) => i.id)).toEqual([linhas[0]!.id]);
    // O id derivado segue valendo para quem tinha a tela aberta.
    expect((await naEmpresa(() => contratos.ficha(ORG, `importado:${importado}`))).id).toBe(linhas[0]!.id);
  });

  it('o lote segue até o fim: um recusado não para os outros, e encerrar sem motivo é recusado inteiro', async () => {
    const leadA = await novoLead('Lote A');
    const a = await naEmpresa(() => contratos.criar(ORG, gestor(), { leadId: leadA, modalidade: 'implantacao' }));
    const { contrato } = await contratoEnviado('Lote B');
    const r = await naEmpresa(() => contratos.lote(ORG, gestor(), { acao: 'conferir', ids: [a.id, contrato.id, contrato.id, 'nao-existe', `sem-contrato:${a.leadId}`] }));
    expect(r.ok).toEqual([contrato.id]);
    expect(r.recusados.map((x) => x.id)).toEqual([a.id, 'nao-existe', `sem-contrato:${a.leadId}`]);
    expect(r.recusados.every((x) => x.motivo.length > 5)).toBe(true);
    expect(r.retidos).toEqual([]);
    await expect(naEmpresa(() => contratos.lote(ORG, gestor(), { acao: 'encerrar', ids: [a.id] }))).rejects.toBeInstanceOf(BadRequestException);
    const fim = await naEmpresa(() => contratos.lote(ORG, gestor(), { acao: 'encerrar', ids: [a.id], motivo: 'teste de encerrar em lote' }));
    expect(fim.ok).toEqual([]);
    expect(fim.recusados[0]!.motivo).toMatch(/cancele/);
  });

  it('encerrar em lote: parcela em aberto e importado são recusados no item, e os outros seguem; reabrir em lote não pede motivo', async () => {
    const assinado = async (nome: string) => {
      const e = await contratoEnviado(nome);
      for (const s of (await docNoDuble(e.documento.externoId)).signers) await assinarNoDuble(s.token);
      await naEmpresa(() => contratos.conferir(ORG, e.contrato.id, gestor()));
      return e;
    };
    const livre = await assinado('Lote Livre');
    const comParcela = await assinado('Lote Parcela');
    await prisma.comercialCobranca.create({ data: { leadId: comParcela.leadId, provedor: 'asaas', externoId: `pay-lote-${MARCA}`, parcela: 1, parcelas: 1, valorCentavos: 1000, forma: 'pix', vence: new Date(Date.now() + 86_400_000) } });
    const leadImportado = await novoLead('Lote Importado', 'fechado');
    await naEmpresa(() => fio.registrar(ORG, leadImportado, 'contrato.importado', 'cartao:lote', { origem: 'cartao:lote', titulo: 'Contrato antigo', produtoRotulo: null, valorCentavos: 10, fechadoEm: '2026-01-10', semDocumento: true } as never, { semReacoes: true }));

    const idImportado = `importado:${leadImportado}`;
    const fim = await naEmpresa(() => contratos.lote(ORG, gestor(), { acao: 'encerrar', ids: [livre.contrato.id, comParcela.contrato.id, idImportado], motivo: 'fechando a carteira do mês' }));
    expect(fim.ok).toEqual([livre.contrato.id]);
    expect(fim.recusados.find((x) => x.id === comParcela.contrato.id)?.motivo).toMatch(/1 parcela\(s\) em aberto/);
    expect(fim.recusados.find((x) => x.id === idImportado)?.motivo).toBe(FRASE_DO_IMPORTADO_NO_LOTE);
    // Recusar não criou registro do importado, e a parcela segue como estava.
    expect(await prisma.comercialContrato.count({ where: { leadId: leadImportado } })).toBe(0);
    expect((await prisma.comercialContrato.findUniqueOrThrow({ where: { id: comParcela.contrato.id } })).estado).toBe('assinado');

    const volta = await naEmpresa(() => contratos.lote(ORG, gestor(), { acao: 'reabrir', ids: [livre.contrato.id, idImportado] }));
    expect(volta.ok).toEqual([livre.contrato.id]);
    expect(volta.recusados).toEqual([{ id: idImportado, motivo: FRASE_DO_IMPORTADO_NO_LOTE }]);

    // Importado que já virou registro continua na lista antiga, para o lote.
    const assumido = await naEmpresa(() => contratos.editar(ORG, idImportado, gestor(), { numero: 'A-1' }));
    const deNovo = await naEmpresa(() => contratos.lote(ORG, gestor(), { acao: 'encerrar', ids: [assumido.id], motivo: 'fechando a carteira do mês' }));
    expect(deNovo.recusados).toEqual([{ id: assumido.id, motivo: FRASE_DO_IMPORTADO_NO_LOTE }]);
    await prisma.comercialCobranca.deleteMany({ where: { leadId: comParcela.leadId } });
  });

  it('o fio e a auditoria não levam link nem token do provedor', async () => {
    const fatos = await prisma.leadEvent.findMany({ where: { orgId: ORG, type: { startsWith: 'contrato.' } }, select: { payload: true } });
    expect(JSON.stringify(fatos)).not.toContain('/assinar/');
    const auditoria = await prisma.auditLog.findMany({ where: { orgId: ORG, entityType: 'comercial.contrato' }, select: { before: true, after: true } });
    expect(auditoria.length).toBeGreaterThan(5);
    expect(JSON.stringify(auditoria)).not.toContain('/assinar/');
  });
});
