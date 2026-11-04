import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { TarefaEscopoService } from '../src/clientes-escopo/tarefa-escopo.service';
import { EfeitoClienteEscopoService } from '../src/clientes-escopo/efeito-cliente-escopo.service';
import { comContexto } from '../src/common/contexto-execucao';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador, type AcaoRetida } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { GoogleService } from '../src/google/google.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { StubProvider } from '../src/llm/stub.provider';
import { PendenciasRegistry } from '../src/pendencias/pendencias.registry';
import { PendenciasService } from '../src/pendencias/pendencias.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ArquivistaService } from '../src/clientes/arquivista/arquivista.service';
import { classificacaoSegura, lerClassificacao, promptDaClassificacao } from '../src/clientes/arquivista/classificador';
import {
  FRASE_NOME_RESERVADO,
  chaveDoNomeDaPasta,
  ehNomeDoModelo,
  escolherPastaExistente,
  outrosComAChave,
} from '../src/clientes/pasta-do-cliente/nome-da-pasta';
import { PastaDoClienteService } from '../src/clientes/pasta-do-cliente/pasta-do-cliente.service';
import { dentroDeGit, planoDasPastas, proporPastas } from '../src/clientes/pasta-do-cliente/pastas-dos-clientes';
import { exigirBancoDescartavel } from './banco-de-teste';
import { DriveEmMemoria, StorageEmMemoria, montarRaiz } from './clientes-dubles';

import { ActorType } from '@prisma/client';
import { canonicalHash } from '../src/approvals/approvals.service';
import { OrigemArquivoClienteService } from '../src/clientes-escopo/origem-arquivo-cliente.service';
const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'cria clientes, aprovações e arquivos de teste');

const ORG = 'org-lote6-integracao';
const ORG_B = 'org-lote6-integracao-b';
const PEDRO = { id: 'l6-pedro-0000-0000-0000-000000000001', papeis: ['admin_master'] };
const LUCAS = { id: 'l6-lucas-0000-0000-0000-000000000002', papeis: ['gestor_marketing'] };

describe.skipIf(!URL)('TR-04 e TR-05 contra o banco, pela porta', { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let porta: PortaDoOperador;
  let conectores: ConectoresService;
  let pastas: PastaDoClienteService;
  let arquivista: ArquivistaService;
  let pendencias: PendenciasService;
  let origens: OrigemArquivoClienteService;
  let policy: PolicyService;
  let drive: DriveEmMemoria;
  let storage: StorageEmMemoria;
  let raiz: { raiz: string; modelo: string; fora: string };
  const notas = new Map<string, string>();
  const eventosDaAgenda: Record<string, Record<string, unknown>> = {};
  const patches: Array<{ url: string; corpo: Record<string, unknown> }> = [];
  let fetchOriginal: typeof fetch;

  const na = <T>(fn: () => Promise<T>, org = ORG): Promise<T> => comContexto({ orgId: org, correlationId: `a4-${Date.now()}`, origem: 'http' }, fn);
  /**
   * O sinal `volume_atipico` sobe R3 para R4 a partir do segundo pedido da hora. A suíte mede a
   * pasta e o arquivista, não o sinal: o histórico de chamadas desta empresa é empurrado para
   * antes da janela de 30 dias do sinal. Empurrado e não apagado: a chamada RETIDA é o que a
   * aprovação executa depois (`Approval.toolCallId`).
   */
  const zerarVolume = () =>
    prisma.toolCall.updateMany({ where: { orgId: { in: [ORG, ORG_B] } }, data: { criadoEm: new Date('2026-08-01T12:00:00Z') } });
  const confirmar = async (approvalId: string) => {
    await zerarVolume();
    await na(() => approvals.confirm(ORG, approvalId, LUCAS));
    return na(() => acoes.executarAprovada(ORG, approvalId, LUCAS.id));
  };
  const cliente = (razaoSocial: string, extra: Record<string, unknown> = {}, org = ORG) =>
    prisma.partner.create({ data: { orgId: org, isCliente: true, razaoSocial, ...extra } });

  beforeAll(async () => {
    vi.setSystemTime(new Date('2026-10-21T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    process.env.GOOGLE_CLIENT_ID = 'cliente-de-teste';
    process.env.GOOGLE_CLIENT_SECRET = 'segredo-de-teste';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [[ORG, 'l6-integracao'], [ORG_B, 'l6-integracao-b']]) {
      await prisma.org.upsert({ where: { id }, create: { id, name: `A4 ${slug}`, slug }, update: {} });
    }
    // Classificar à mão exige `tarefas.editar` (relida no banco).
    const comPermissao = { permissions: { connectOrCreate: ['tarefas.editar','aprovacoes.decidir','leads.editar'].map(key => ({where: {key},create:{key}})) } };
    const papel = await prisma.role.upsert({ where: { orgId_key: { orgId: ORG, key: 'admin_master' } }, create: { orgId: ORG, key: 'admin_master', name: 'Admin', ...comPermissao }, update: comPermissao, select: { id: true } });
    const papelL = await prisma.role.upsert({ where: { orgId_key: { orgId: ORG, key: 'gestor_marketing' } }, create: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor', ...comPermissao }, update: comPermissao, select: { id: true } });
    for (const [u, r] of [[PEDRO, papel.id], [LUCAS, papelL.id]] as const) {
      await prisma.user.upsert({
        where: { id: u.id },
        create: { id: u.id, orgId: ORG, email: `${u.id}@a4.teste`, name: u.id.slice(3, 8), passwordHash: 'x', roles: { connect: { id: r } } },
        update: { isActive: true, roles: { set: [{ id: r }] } },
      });
      await prisma.clienteAcessoPerfil.upsert({where:{userId_orgId:{userId:u.id,orgId:ORG}},create:{userId:u.id,orgId:ORG,modo:'ALL'},update:{modo:'ALL'}});
    }
    for (const org of [ORG, ORG_B]) {
      await prisma.googleAccount.upsert({
        where: { orgId: org },
        create: { orgId: org, accessToken: 'token-de-teste', expiresAt: new Date('2027-01-01T00:00:00Z'), email: 'casa@a4.teste' },
        update: { expiresAt: new Date('2027-01-01T00:00:00Z') },
      });
    }

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    policy = new PolicyService(p);
    await policy.onModuleInit();
    const escopo = new ClienteEscopoService(p,audit);
    origens = new OrigemArquivoClienteService(p,escopo,policy);
    const efeitoEscopo = new EfeitoClienteEscopoService(p,escopo,new TarefaEscopoService(p,escopo),policy,origens);
    approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);
    const registro = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, registro, undefined, efeitoEscopo);
    acoes = new AcoesService(p, gateway, eventos, interruptores, policy);
    porta = new PortaDoOperador(gateway, registro);

    const memoria = {
      porChave: async (org: string, chave: string) => {
        const corpo = notas.get(`${org}:${chave}`);
        return corpo === undefined ? null : ({ body: corpo, arquivadoEm: null } as never);
      },
    };
    drive = new DriveEmMemoria();
    raiz = montarRaiz(drive);
    storage = new StorageEmMemoria();
    pastas = new PastaDoClienteService(p, memoria as never, porta, registro, audit, drive, efeitoEscopo);
    pastas.onModuleInit();
    const registroP = new PendenciasRegistry();
    pendencias = new PendenciasService(p, registroP);
    const llm = new StubProvider(path.resolve(__dirname, '../../../homolog/fixtures/stub'));
    arquivista = new ArquivistaService(p, porta, registro, audit, pendencias, registroP, pastas, memoria as never, drive, llm as never, efeitoEscopo);
    arquivista.usarArmazem(storage);
    arquivista.onModuleInit();

    // A Agenda: o efeito de `agenda.evento.padronizar` do conector de verdade, com o HTTP num dublê.
    fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (u: string | URL | Request, init: RequestInit = {}) => {
      const url = String(u);
      const id = /events\/([^/?]+)/.exec(url)?.[1] ?? '';
      const e = eventosDaAgenda[decodeURIComponent(id)];
      if (!e) return new Response('{}', { status: 404 });
      if ((init.method ?? 'GET') === 'PATCH') {
        const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
        patches.push({ url, corpo });
        Object.assign(e, corpo);
      }
      return new Response(JSON.stringify({ id, ...e }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const google = new GoogleService(p, audit, registro, { registrar: () => undefined } as never);
    google.onModuleInit();
  });

  afterAll(async () => {
    globalThis.fetch = fetchOriginal;
    vi.useRealTimers();
    const orgs = [ORG, ORG_B];
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = ANY($1)', orgs),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.arquivoDoCliente.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.pendencia.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.approval.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.toolCall.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.policyDecision.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.conectorDesligado.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.integrationAccount.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.googleAccount.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.clienteAcessoVinculo.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.clienteAcessoPerfil.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.origemArquivoCliente.deleteMany({where:{orgId:{in:orgs}}});
    await prisma.salaDoCliente.deleteMany({where:{orgId:{in:orgs}}});
    await prisma.comercialFechamento.deleteMany({where:{orgId:{in:orgs}}});
    await prisma.comercialDocumento.deleteMany({where:{orgId:{in:orgs}}});
    await prisma.comercialFicha.deleteMany({where:{orgId:{in:orgs}}});
    await prisma.leadEvent.deleteMany({where:{orgId:{in:orgs}}});
    await prisma.lead.deleteMany({where:{orgId:{in:orgs}}});
    await prisma.partner.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.user.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.role.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.org.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    notas.set(`${ORG}:clientes.pasta.raiz`, `${raiz.raiz}\nA raiz dos clientes.`);
    notas.set(`${ORG_B}:clientes.pasta.raiz`, `${raiz.raiz}`);
    await prisma.conectorDesligado.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await zerarVolume();
  });

  // ---------------------------------------------------------------------------
  // TR-04
  // ---------------------------------------------------------------------------


  async function dadosFechamento(system = false) {
    const c=await cliente('Cliente fechamento '+crypto.randomUUID());
    const lead=await prisma.lead.create({data:{orgId:ORG,name:'Lead QA'}});
    const hash='a'.repeat(64), chave=`fech-${lead.id}-v1`;
    await prisma.comercialFicha.create({data:{orgId:ORG,leadId:lead.id,partnerId:c.id,propostaVersao:1,propostaHash:hash}});
    await prisma.leadEvent.create({data:{orgId:ORG,leadId:lead.id,type:'proposta.aceita',payload:{versao:1,hash}}});
    await prisma.comercialFechamento.create({data:{orgId:ORG,leadId:lead.id,chave,versao:1}});
    const args={leadId:lead.id,chave,propostaHash:hash};
    const actorId=system?'comercial':PEDRO.id, actorType=system?ActorType.system:ActorType.user;
    const chamada=await prisma.toolCall.create({data:{orgId:ORG,capabilityId:'comercial.fechamento.executar',actorId,actorType,status:'aguardando_aprovacao',args}});
    const cap=policy.resolverCapacidade(ORG,'comercial.fechamento.executar') as unknown as {hashKeys?:string[]};
    const ap=await prisma.approval.create({data:{orgId:ORG,toolCallId:chamada.id,capabilityId:'comercial.fechamento.executar',propostoPorTipo:actorType,propostoPorId:actorId,resourceType:'comercial.fechamento',resourceId:chave,contentHash:canonicalHash('comercial.fechamento',args,cap.hashKeys??[]),resumo:'QA',nivelExigido:'R4',status:'consumida',tokenHash:crypto.randomUUID(),aprovadoPorId:LUCAS.id,aprovadoEm:new Date(),consumidoEm:new Date(),expiraEm:new Date(Date.now()+600000)}});
    await prisma.toolCall.update({where:{id:chamada.id},data:{approvalId:ap.id}});
    return {c,lead,ap};
  }
  for(const system of [false,true]) it(`fechamento ${system?'system':'humano'} preserva R4 e propõe pasta por R3`,async()=>{
    const f=await dadosFechamento(system);
    const resultado=await na(()=>pastas.garantir({orgId:ORG,partnerId:f.c.id,leadId:f.lead.id,origem:'fechamento',fechamentoApprovalId:f.ap.id}));
    expect(resultado.estado).toBe('aguardando_aprovacao');
    const id=(resultado as {approvalId:string}).approvalId;
    const r3=await prisma.approval.findUniqueOrThrow({where:{id}});
    expect(r3.propostoPorId).toBe(system?'criador-da-pasta-do-cliente':PEDRO.id);
    expect((await confirmar(id)).status).toBe('executado');
  });
  it('revogação do originador depois do R3 conserva token e não chama Drive',async()=>{
    const f=await dadosFechamento();
    const r=await na(()=>pastas.garantir({orgId:ORG,partnerId:f.c.id,leadId:f.lead.id,origem:'fechamento',fechamentoApprovalId:f.ap.id}));
    const id=(r as {approvalId:string}).approvalId;
    await prisma.clienteAcessoPerfil.update({where:{userId_orgId:{userId:PEDRO.id,orgId:ORG}},data:{modo:'SELECTED'}});
    try {
      await na(()=>approvals.confirm(ORG,id,LUCAS));
      const antes=drive.escritas.length;
      await expect(na(()=>acoes.executarAprovada(ORG,id,LUCAS.id))).rejects.toThrow();
      expect(drive.escritas.length).toBe(antes);
      expect((await prisma.approval.findUniqueOrThrow({where:{id}})).status).toBe('confirmada');
    } finally { await prisma.clienteAcessoPerfil.update({where:{userId_orgId:{userId:PEDRO.id,orgId:ORG}},data:{modo:'ALL'}}); }
  });
  it('veto do fechamento depois do R3 impede a pasta e mantém aprovação confirmada',async()=>{
    const f=await dadosFechamento();
    const r=await na(()=>pastas.garantir({orgId:ORG,partnerId:f.c.id,leadId:f.lead.id,origem:'fechamento',fechamentoApprovalId:f.ap.id}));
    const id=(r as {approvalId:string}).approvalId;
    await na(()=>approvals.confirm(ORG,id,LUCAS));
    await prisma.comercialFechamento.updateMany({where:{orgId:ORG,leadId:f.lead.id},data:{estado:'vetado',vetadoEm:new Date()}});
    const antes=drive.escritas.length;
    await expect(na(()=>acoes.executarAprovada(ORG,id,LUCAS.id))).rejects.toThrow();
    expect(drive.escritas.length).toBe(antes);
    expect((await prisma.approval.findUniqueOrThrow({where:{id}})).status).toBe('confirmada');
  });
  for(const mudanca of ['nenhuma','revogacao','cliente'] as const) it(`recebimento da sala por receipt e R3: ${mudanca}`,async()=>{
    const c=await cliente('Cliente sala '+crypto.randomUUID());
    const lead=await prisma.lead.create({data:{orgId:ORG,name:'Lead sala'}});
    await prisma.comercialFicha.create({data:{orgId:ORG,leadId:lead.id,partnerId:c.id}});
    const sala=await prisma.salaDoCliente.create({data:{orgId:ORG,leadId:lead.id,slug:crypto.randomUUID(),tokenHash:crypto.randomUUID(),validoAte:new Date(Date.now()+600000)}});
    const pasta=await na(()=>pastas.garantir({orgId:ORG,partnerId:c.id,origem:'manual',atorId:PEDRO.id}));
    await confirmar((pasta as {approvalId:string}).approvalId);
    const buffer=Buffer.from('conteudo comprovado'), sha256=createHash('sha256').update(buffer).digest('hex');
    const conteudo={chave:`comercial/sala/${sala.id}/${sha256}`,sha256,bytes:buffer.length,tipoMime:'application/pdf'};
    await storage.put(conteudo.chave,buffer,conteudo.tipoMime);
    const recibo=await origens.registrarSala({orgId:ORG,salaId:sala.id,tokenHash:sala.tokenHash,conteudo});
    await zerarVolume();
    const r=await na(()=>arquivista.arquivar({orgId:ORG,partnerId:c.id,leadId:lead.id,origem:'sala',origemRecebidaId:recibo.id,nomeOriginal:'teste.pdf',tipoMime:conteudo.tipoMime,conteudo,subpasta:'01-comercial'}));
    expect(r.estado).toBe('aguardando_aprovacao');
    const id=(r as {approvalId:string}).approvalId;
    expect((await prisma.approval.findUniqueOrThrow({where:{id}})).propostoPorId).toBe('arquivista-do-cliente');
    await na(()=>approvals.confirm(ORG,id,LUCAS));
    if(mudanca==='revogacao') await prisma.salaDoCliente.update({where:{id:sala.id},data:{revogadoEm:new Date()}});
    if(mudanca==='cliente') {
      const outro=await cliente('Outro cliente '+crypto.randomUUID());
      await prisma.comercialFicha.update({where:{leadId:lead.id},data:{partnerId:outro.id}});
    }
    const antes=drive.escritas.length;
    if(mudanca==='nenhuma') {
      expect((await na(()=>acoes.executarAprovada(ORG,id,LUCAS.id))).status).toBe('executado');
      expect(drive.escritas.length).toBeGreaterThan(antes);
      expect((await prisma.approval.findUniqueOrThrow({where:{id}})).status).toBe('consumida');
    } else {
      await expect(na(()=>acoes.executarAprovada(ORG,id,LUCAS.id))).rejects.toThrow();
      expect(drive.escritas.length).toBe(antes);
      expect((await prisma.approval.findUniqueOrThrow({where:{id}})).status).toBe('confirmada');
    }
  });
  for(const system of [false,true]) it(`contrato assinado preserva origem ${system?'system':'humana'} até o R3`,async()=>{
    const c=await cliente('Cliente contrato '+crypto.randomUUID());
    const lead=await prisma.lead.create({data:{orgId:ORG,name:'Lead contrato'}});
    await prisma.comercialFicha.create({data:{orgId:ORG,leadId:lead.id,partnerId:c.id}});
    const hash='b'.repeat(64), args={leadId:lead.id,hash,versao:1,signatarioEmail:'qa@example.invalid'};
    const actorId=system?'comercial':PEDRO.id,actorType=system?ActorType.system:ActorType.user;
    const chamada=await prisma.toolCall.create({data:{orgId:ORG,capabilityId:'comercial.contrato.enviar',actorId,actorType,status:'aguardando_aprovacao',args}});
    const cap=policy.resolverCapacidade(ORG,'comercial.contrato.enviar') as unknown as {hashKeys?:string[]};
    const ap=await prisma.approval.create({data:{orgId:ORG,toolCallId:chamada.id,capabilityId:'comercial.contrato.enviar',propostoPorTipo:actorType,propostoPorId:actorId,resourceType:'comercial.contrato',resourceId:`${lead.id}:${hash.slice(0,16)}`,contentHash:canonicalHash('comercial.contrato',args,cap.hashKeys??[]),resumo:'QA',nivelExigido:'R4',status:'consumida',tokenHash:crypto.randomUUID(),aprovadoPorId:LUCAS.id,aprovadoEm:new Date(),consumidoEm:new Date(),expiraEm:new Date(Date.now()+600000)}});
    await prisma.toolCall.update({where:{id:chamada.id},data:{approvalId:ap.id}});
    const documento=await prisma.comercialDocumento.create({data:{orgId:ORG,leadId:lead.id,provedor:'zapsign',externoId:crypto.randomUUID(),estado:'assinado',hashConteudo:hash,origemApprovalId:ap.id,assinadoClienteEm:new Date(),assinadoRootEm:new Date()}});
    const pasta=await na(()=>pastas.garantir({orgId:ORG,partnerId:c.id,origem:'manual',atorId:PEDRO.id}));
    await confirmar((pasta as {approvalId:string}).approvalId);
    const buffer=Buffer.from('%PDF documento'),sha256=createHash('sha256').update(buffer).digest('hex');
    const conteudo={chave:`clientes/arquivos/${ORG}/${sha256}`,sha256,bytes:buffer.length,tipoMime:'application/pdf'};
    await storage.put(conteudo.chave,buffer,conteudo.tipoMime);
    const recibo=await origens.registrarContrato({orgId:ORG,leadId:lead.id,documentoId:documento.id,externoId:documento.externoId,provedor:'zapsign',conteudo});
    expect(recibo.atorId).toBe(system?null:PEDRO.id);
    await zerarVolume();
    const r=await na(()=>arquivista.arquivar({orgId:ORG,partnerId:c.id,leadId:lead.id,origem:'contrato-assinado',origemRecebidaId:recibo.id,atorId:recibo.atorId,nomeOriginal:'contrato.pdf',tipoMime:conteudo.tipoMime,conteudo,subpasta:'02-contrato'}));
    expect(r.estado).toBe('aguardando_aprovacao');
    const id=(r as {approvalId:string}).approvalId;
    expect((await prisma.approval.findUniqueOrThrow({where:{id}})).propostoPorId).toBe(system?'arquivista-do-cliente':PEDRO.id);
    expect((await confirmar(id)).status).toBe('executado');
  });
});
