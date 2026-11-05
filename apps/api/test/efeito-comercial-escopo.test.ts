import { ActorType, ApprovalState, RiskLevel } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { exigirOrigemDaEmissao } from '../src/comercial/contratos/emissao-origem';
import { canonicalHash } from '../src/approvals/approvals.service';
import { EfeitoComercialEscopoService } from '../src/clientes-escopo/efeito-comercial-escopo.service';
import type { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import type { PolicyService } from '../src/policy/policy.service';
import type { PrismaService } from '../src/prisma/prisma.service';

vi.mock('../src/comercial/sala-publicacao-origem', () => ({ exigirVersaoDaPublicacao: vi.fn(async () => ({})) }));
vi.mock('../src/comercial/contratos/emissao-origem', () => ({ exigirOrigemDaEmissao: vi.fn(async () => ({})) }));

function montar(capabilityId = 'comercial.sala.publicar') {
  const args: Record<string, unknown> = { leadId: 'lead-a', versao: 1, hash: 'a'.repeat(64), clienteId: 'cliente-a', origemCliente:{versao:1,clienteId:'cliente-a'} };
  const resourceType = capabilityId === 'comercial.sala.publicar' ? 'comercial.sala' : 'comercial.contrato';
  const resourceId = capabilityId === 'comercial.sala.publicar' ? 'lead-a:v1' : `lead-a:${String(args.hash).slice(0,16)}`;
  const ap = { id: 'ap', orgId: 'org', capabilityId, resourceType, resourceId,
    alcadaMinima:'titular', toolCallId: 'tc', contentHash: canonicalHash(resourceType, args, []),
    status: ApprovalState.confirmada as ApprovalState, nivelExigido: (capabilityId === 'comercial.sala.publicar' ? RiskLevel.R3 : RiskLevel.R4) as RiskLevel,
    propostoPorTipo: ActorType.user as ActorType, propostoPorId: 'autor', aprovadoPorId: 'aprovador',
    expiraEm: new Date(Date.now()+60000), consumidoEm: null as Date|null };
  const tc = { id: 'tc', orgId: 'org', capabilityId, approvalId: 'ap', actorId: 'autor', actorType: ActorType.user as ActorType, args: { ...args } };
  const ficha = { partnerId: 'cliente-a' as string|null };
  const conflito = { atual: null as object|null };
  const papeis = {autor:['operador'],aprovador:['admin_master']};
  const prisma = { approval: { findFirst: vi.fn(async ({where}: {where:Record<string,unknown>}) => where.NOT ? conflito.atual : ap) },
    toolCall: { findFirst: vi.fn(async () => tc) }, lead: { findFirst: vi.fn(async () => ({id:'lead-a'})) },
    comercialFicha: { findFirst: vi.fn(async () => ficha) }, partner: { findFirst: vi.fn(async () => ({ id: ficha.partnerId })) },
    user: { findFirst: vi.fn(async ({where}: {where:{id?:string}}) => ({id:where.id,isActive:true,passwordHash:'qa',roles:(where.id==='autor'?papeis.autor:papeis.aprovador).map(key=>({key}))})) } };
  const escopo = { exigirAmplo: vi.fn(async (_org:string,_id:string) => {}), exigirCliente: vi.fn(async () => ({})) };
  const policy = { resolverCapacidade: vi.fn(() => ({id:capabilityId,hashKeys:[] as string[]})) };
  const svc = new EfeitoComercialEscopoService(prisma as unknown as PrismaService, escopo as unknown as ClienteEscopoService, policy as unknown as PolicyService);
  const exigir = (fase: 'confirmada'|'consumida'|'repedido' = 'confirmada') => svc.exigir('org','ap',capabilityId,args,{fase,atorExecucaoId: fase==='repedido' ? undefined : 'aprovador'});
  return {ap,tc,args,ficha,conflito,papeis,prisma,escopo,policy,svc,exigir};
}

describe('origem e carteira dos efeitos comerciais', () => {
  it('confere proponente e aprovador atuais sem substituir a identidade', async () => {
    const m=montar();
    expect(await m.exigir()).toMatchObject({proponenteId:'autor',proponenteTipo:'user',aprovadorId:'aprovador',clienteId:'cliente-a'});
    expect(m.escopo.exigirAmplo.mock.calls.map(c=>c[1])).toEqual(expect.arrayContaining(['autor','aprovador']));
  });
  it.each(['autor','aprovador'])('nega revogação de %s antes do consumo', async (id) => {
    const m=montar(); m.escopo.exigirAmplo.mockImplementation(async (_o,u)=>{if(u===id)throw new Error('revogado');});
    await expect(m.exigir()).rejects.toThrow();
    expect(m.ap.status).toBe('confirmada');
  });
  it.each(['ausente','outro','null'])('nega snapshot de cliente %s', async (tipo) => {
    const m=montar(); if(tipo==='ausente')delete m.args.clienteId; else m.args.clienteId=tipo==='null'?null:'cliente-b';
    m.tc.args={...m.args};m.ap.contentHash=canonicalHash(m.ap.resourceType,m.args,[]);
    await expect(m.exigir()).rejects.toThrow();
  });
  it('aceita null explícito apenas enquanto o lead continua sem cliente', async () => {
    const m=montar();m.ficha.partnerId=null;m.args.clienteId=null;m.args.origemCliente={versao:1,clienteId:null};m.tc.args={...m.args};m.ap.contentHash=canonicalHash(m.ap.resourceType,m.args,[]);
    await expect(m.exigir()).resolves.toMatchObject({clienteId:null});
    m.ficha.partnerId='cliente-a'; await expect(m.exigir()).rejects.toThrow();
  });
  it.each(['org','capacidade','recurso','backlink','ator','hash','chamada-org','chamada-capacidade'])('nega divergência de %s', async (tipo) => {
    const m=montar();
    if(tipo==='org')m.ap.orgId='outra'; if(tipo==='capacidade')m.ap.capabilityId='outra'; if(tipo==='recurso')m.ap.resourceId='outro';
    if(tipo==='backlink')m.tc.approvalId='outra'; if(tipo==='ator')m.tc.actorId='outro'; if(tipo==='hash')m.tc.args.versao=2;
    if(tipo==='chamada-org')m.tc.orgId='outra';if(tipo==='chamada-capacidade')m.tc.capabilityId='outra';
    await expect(m.exigir()).rejects.toThrow();
  });
  it('nega identidade do executor diferente do aprovador', async () => {
    const m=montar();await expect(m.svc.exigir('org','ap',m.ap.capabilityId,m.args,{fase:'confirmada',atorExecucaoId:'outro'})).rejects.toThrow();
  });
  it('nega expirada e aprovação abaixo do nível necessário', async () => {
    const m=montar('comercial.contrato.enviar');m.ap.nivelExigido=RiskLevel.R3;await expect(m.exigir()).rejects.toThrow();
    m.ap.nivelExigido=RiskLevel.R4;m.ap.expiraEm=new Date(0);await expect(m.exigir()).rejects.toThrow();
  });
  it('efeito exige consumo comprovado, não só um ID', async () => {
    const m=montar();await expect(m.exigir('consumida')).rejects.toThrow();m.ap.status=ApprovalState.consumida;
    await expect(m.exigir('consumida')).rejects.toThrow();m.ap.consumidoEm=new Date();await expect(m.exigir('consumida')).resolves.toBeDefined();
  });
  it('R4 não permite a mesma pessoa propor e aprovar', async () => {
    const m=montar('comercial.contrato.enviar');m.ap.propostoPorId='aprovador';m.tc.actorId='aprovador';await expect(m.exigir()).rejects.toThrow();
  });
  it('não transforma origem humana em sistema e só admite sistema conhecido para contrato', async () => {
    const m=montar();m.ap.propostoPorTipo=ActorType.system;m.tc.actorType=ActorType.system;m.ap.propostoPorId=m.tc.actorId='comercial';
    await expect(m.exigir()).rejects.toThrow();
    const c=montar('comercial.contrato.enviar');c.ap.propostoPorTipo=c.tc.actorType=ActorType.system;c.ap.propostoPorId=c.tc.actorId='comercial';
    await expect(c.exigir()).resolves.toBeDefined();c.conflito.atual={id:'humana'};await expect(c.exigir()).rejects.toThrow();
  });
  it('repedido valida proponente e snapshot expirados sem inventar aprovador', async () => {
    const m=montar();m.ap.status=ApprovalState.expirada;m.ap.aprovadoPorId='';await expect(m.exigir('repedido')).resolves.toMatchObject({proponenteId:'autor'});
    m.ficha.partnerId='cliente-b';await expect(m.exigir('repedido')).rejects.toThrow();
  });
});


describe('revisão do vínculo aprovado',()=>{
  it('não aceita política que deixe cliente fora do hash',async()=>{
    const m=montar();const keys=['leadId','versao','hash'];m.policy.resolverCapacidade.mockReturnValue({id:m.ap.capabilityId,hashKeys:keys});
    m.ap.contentHash=canonicalHash(m.ap.resourceType,m.args,keys);m.ficha.partnerId='cliente-b';m.args.clienteId='cliente-b';m.args.origemCliente={versao:1,clienteId:'cliente-b'};m.tc.args={...m.args};
    await expect(m.exigir()).rejects.toThrow();
  });
  it('null acrescentado ao legado não é snapshot aprovado',async()=>{
    const m=montar();delete m.args.origemCliente;delete m.args.clienteId;
    m.ap.contentHash=canonicalHash(m.ap.resourceType,m.args,[]);m.args.clienteId=null;m.ficha.partnerId=null;m.tc.args={...m.args};
    await expect(m.exigir()).rejects.toThrow();
  });
  it('Sala R3 também exige duas pessoas',async()=>{
    const m=montar();m.ap.propostoPorId=m.tc.actorId='aprovador';await expect(m.exigir()).rejects.toThrow();
  });
  it('revogação durante a conferência do PDF impede o próximo efeito',async()=>{
    const m=montar('comercial.contrato.enviar');
    vi.mocked(exigirOrigemDaEmissao).mockImplementationOnce(async()=>{m.escopo.exigirAmplo.mockRejectedValue(new Error('revogado durante PDF'));});
    await expect(m.exigir()).rejects.toThrow('revogado');
  });
  it('troca de cliente durante a conferência do PDF impede o próximo efeito',async()=>{
    const m=montar('comercial.contrato.enviar');vi.mocked(exigirOrigemDaEmissao).mockImplementationOnce(async()=>{m.ficha.partnerId='cliente-b';});
    await expect(m.exigir()).rejects.toThrow();
  });
});


describe('alçada atual no momento do efeito',()=>{
  it('titular rebaixado ainda tem permissão, mas não pode executar R4',async()=>{
    const m=montar('comercial.contrato.enviar');m.papeis.aprovador=['gestor'];await expect(m.exigir()).rejects.toThrow();
  });
  it.each(['autor','aprovador'] as const)('papel de máquina acumulado por %s impede execução',async(id)=>{
    const m=montar();m.papeis[id].push('ia_acao');await expect(m.exigir()).rejects.toThrow();
  });
  it('alçada revogada durante PDF impede emissão',async()=>{
    const m=montar('comercial.contrato.enviar');vi.mocked(exigirOrigemDaEmissao).mockImplementationOnce(async()=>{m.papeis.aprovador=['gestor'];});
    await expect(m.exigir()).rejects.toThrow();
  });
});
