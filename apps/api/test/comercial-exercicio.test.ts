import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ComercialEntradaExercicioSchema, ComercialPropostaExercicioSchema, ComercialAceiteExercicioSchema } from '@mktos/shared';
import { ComercialExercicioService, hashComercial } from '../src/leads/comercial-exercicio.service';
import { LeadsService } from '../src/leads/leads.service';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ModulosService } from '../src/tenants/modulos.service';
import { exigirBancoDescartavel } from './banco-de-teste';
const uid = () => randomUUID();
const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL,'fixtures próprias Comercial QA');
async function status(p: Promise<unknown>) { try { await p; return 200; } catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; } }
const condicoes = { valorCanonico: 'BRL 1500.00',inicio: null,prazo: '30 dias',periodicidade: null };
const documento = { titulo: 'Proposta QA',corpo: 'Documento sintético de exercício. Entrega demonstrativa.' };
describe('contrato Comercial de exercício',() => {
  it('exige identidade UUID e preserva a origem independente do pedido',() => {
    const p = { requestId: uid(),origemRef: uid(),nome: ' Exercício ' };
    expect(ComercialEntradaExercicioSchema.parse(p)).toMatchObject({ nome: 'Exercício',ownerId: null,origemRef: p.origemRef });
    expect(ComercialEntradaExercicioSchema.safeParse({ ...p,status: 'ganho' }).success).toBe(false);
  });
  it('recusa moeda não canônica e campos financeiros inferidos',() => {
    const p = { requestId: uid(),expectedPropostaVersion: 0,documento,condicoes };
    expect(ComercialPropostaExercicioSchema.safeParse(p).success).toBe(true);
    expect(ComercialPropostaExercicioSchema.safeParse({ ...p,condicoes: { ...condicoes,valorCanonico: 'R$ 1.500,00' } }).success).toBe(false);
    expect(ComercialPropostaExercicioSchema.safeParse({ ...p,contractId: uid() }).success).toBe(false);
  });
  it('aceite exige evidência de exercício e confirmação explícita',() => {
    const p = { requestId: uid(),propostaId: uid(),expectedPropostaVersion: 1,condicoesHash: hashComercial(condicoes),evidencia: { tipo: 'exercicio',texto: 'Confirmação apenas sintética de QA.' },confirmacaoExercicio: true };
    expect(ComercialAceiteExercicioSchema.safeParse(p).success).toBe(true);
    for (const delta of [{ confirmacaoExercicio: false },{ evidencia: { tipo: 'mensagem',texto: 'Cliente aceitou.' } },{ assinatura: true }]) expect(ComercialAceiteExercicioSchema.safeParse({ ...p,...delta }).success).toBe(false);
  });
});

describe.skipIf(!URL)('rotina Comercial em Postgres isolado',() => {
  let db: PrismaClient,svc: ComercialExercicioService,audit: AuditService,legacy: LeadsService;
  const org = uid(),outra = uid(),editor = uid(),aprovador = uid(),segundo = uid(),externo = uid();
  const a = { orgId: org,sub: editor }, decisor = { orgId: org,sub: aprovador };
  let roleEditor: string,roleAprovador: string,listId: string,statusId: string,foreignList: string,foreignStatus: string,leadId: string;
  const modulos = { modulosDaOrg: async () => new Set(['leads','trabalho']) } as unknown as ModulosService;
  const prop = (expectedPropostaVersion = 0) => ({ requestId: uid(),expectedPropostaVersion,documento,condicoes });
  const pedidoAceite = (propostaId: string,versao = 1) => ({ requestId: uid(),propostaId,expectedPropostaVersion: versao,condicoesHash: hashComercial(condicoes),evidencia: { tipo: 'exercicio',texto: 'Evidência sintética, sem aceite de cliente.' },confirmacaoExercicio: true });
  async function preparar() {
    const p = await svc.proposta(a,leadId,prop());
    const ace = pedidoAceite(p.eventoId), r = await svc.aceitar(decisor,leadId,ace);
    return { p,ace,r,entrega: { requestId: uid(),aceiteId: r.eventoId,propostaId: p.eventoId,expectedPropostaVersion: 1,condicoesHash: hashComercial(condicoes),listId,statusId,title: 'Entrega Comercial QA',assigneeUserId: editor } };
  }
  async function efeitos() { return { leads: await db.lead.count({ where: { orgId: org } }),tasks: await db.workTask.count({ where: { orgId: org } }),events: await db.leadEvent.count({ where: { orgId: org } }),audit: await db.auditLog.count({ where: { orgId: org } }),contracts: await db.contract.count({ where: { orgId: org } }),finance: await db.financeTransaction.count({ where: { orgId: org } }) }; }
  async function limpar() {
    await db.leadEvent.deleteMany({ where: { orgId: org } }); await db.lead.deleteMany({ where: { orgId: org } });
    await db.workTask.deleteMany({ where: { orgId: org } }); await db.auditLog.deleteMany({ where: { orgId: org } });
  }
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: URL } } });
    audit = new AuditService(db as unknown as PrismaService); svc = new ComercialExercicioService(db as unknown as PrismaService,audit,modulos);
    legacy = new LeadsService(db as unknown as PrismaService,audit,modulos);
    for (const id of [org,outra]) await db.org.create({ data: { id,name: 'QA Comercial',slug: 'com-'+id } });
    const ps = [];
    for (const key of ['leads.ver','leads.editar','tarefas.ver','tarefas.editar']) ps.push(await db.permission.upsert({ where: { key },create: { key },update: {} }));
    roleEditor = (await db.role.create({ data: { orgId: org,key: 'qa_editor_comercial',name: 'QA editor',permissions: { connect: ps.map((p) => ({ id: p.id })) } } })).id;
    roleAprovador = (await db.role.create({ data: { orgId: org,key: 'gestor_marketing',name: 'QA responsável',permissions: { connect: ps.map((p) => ({ id: p.id })) } } })).id;
    for (const id of [editor,aprovador,segundo]) await db.user.create({ data: { id,orgId: org,name: 'Pessoa QA',email: id+'@qa.invalid',passwordHash: 'sem-login',roles: { connect: { id: id === editor ? roleEditor : roleAprovador } } } });
    await db.user.create({ data: { id: externo,orgId: outra,name: 'Pessoa vizinha QA',email: externo+'@qa.invalid',passwordHash: 'sem-login' } });
    listId = (await db.workList.create({ data: { orgId: org,name: 'Entrega QA' } })).id;
    statusId = (await db.workStatus.create({ data: { orgId: org,listId,name: 'A fazer',type: 'open' } })).id;
    foreignList = (await db.workList.create({ data: { orgId: outra,name: 'Vizinha QA' } })).id;
    foreignStatus = (await db.workStatus.create({ data: { orgId: outra,listId: foreignList,name: 'A fazer' } })).id;
  });
  beforeEach(async () => {
    await limpar();
    await db.user.updateMany({ where: { id: { in: [editor,aprovador,segundo] } },data: { isActive: true } });
    for (const id of [roleEditor,roleAprovador]) await db.role.update({ where: { id },data: { permissions: { connect: ['leads.ver','leads.editar','tarefas.ver','tarefas.editar'].map((key) => ({ key })) } } });
    leadId = (await svc.entrada(a,{ requestId: uid(),origemRef: uid(),nome: 'Oportunidade sintética' })).leadId;
  });
  afterAll(async () => {
    if (!db) return; await limpar();
    await db.workList.deleteMany({ where: { id: { in: [listId,foreignList] } } });
    await db.user.deleteMany({ where: { id: { in: [editor,aprovador,segundo,externo] } } });
    await db.role.deleteMany({ where: { id: { in: [roleEditor,roleAprovador] } } });
    await db.org.deleteMany({ where: { id: { in: [org,outra] } } }); await db.$disconnect();
  });
  it('mesma origem com pedidos distintos mantém uma oportunidade, inclusive em concorrência',async () => {
    const origemRef = uid(),p = { requestId: uid(),origemRef,nome: 'Outra oportunidade' };
    const [r1,r2] = await Promise.all([svc.entrada(a,p),svc.entrada(a,{ ...p,requestId: uid() })]);
    expect(r1.leadId).toBe(r2.leadId); expect((await efeitos()).leads).toBe(2);
    expect((await svc.entrada(a,p)).replayed).toBe(true);
    expect(await status(svc.entrada(a,{ ...p,requestId: uid(),nome: 'Nome divergente' }))).toBe(409);
  });
  it('origem é reaberta e coluna ganho não cria aceite ou cobrança',async () => {
    const s = await svc.ler(a,leadId);
    expect(s.origem.tipo).toBe('manual'); expect(s.lead.nome).toContain('[QA]');
    const p = { requestId: uid(),expectedUpdatedAt: s.lead.updatedAt,status: 'ganho',nextAction: 'Conferir proposta de exercício' };
    const r = await svc.acompanhar(a,leadId,p); expect((await svc.acompanhar(a,leadId,p)).eventoId).toBe(r.eventoId);
    const depois = await svc.ler(a,leadId); expect(depois.aceites).toEqual([]); expect(depois.entregas).toEqual([]);
    expect((await efeitos()).contracts).toBe(0); expect((await efeitos()).finance).toBe(0);
    expect(await status(svc.acompanhar(a,leadId,{ ...p,requestId: uid() }))).toBe(409);
  });
  it('proposta é versionada, contém condições fixadas e rejeita gravação concorrente desatualizada',async () => {
    const p = prop(),r = await svc.proposta(a,leadId,p); expect((await svc.proposta(a,leadId,p)).eventoId).toBe(r.eventoId);
    const [x,y] = await Promise.allSettled([svc.proposta(a,leadId,prop(1)),svc.proposta(a,leadId,prop(1))]);
    expect([x,y].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const s = await svc.ler(a,leadId); expect(s.propostas.map((p) => p.versao)).toEqual([1,2]); expect(s.propostas[0].condicoes).toEqual(condicoes);
    expect(s.propostas[0].documento.hash).toBe(hashComercial(documento));
  });
  it('aceite pede alçada vigente e evidência de exercício, sem fato cliente',async () => {
    const p = await svc.proposta(a,leadId,prop()),ace = pedidoAceite(p.eventoId),antes = await efeitos();
    expect(await status(svc.aceitar(a,leadId,ace))).toBe(403); expect(await efeitos()).toEqual(antes);
    await svc.aceitar(decisor,leadId,ace);
    const s = await svc.ler(a,leadId); expect(s.aceites[0].alcada).toEqual({ minima: 'responsavel',verificada: 'responsavel' });
    expect(s.aceites[0].evidencia.tipo).toBe('exercicio'); expect(await db.leadEvent.count({ where: { orgId: org,type: 'aceite' } })).toBe(0);
  });
  it('rotas comerciais antigas recusam proposta e aceite reais na oportunidade de exercício',async () => {
    expect(await status(legacy.registrarProposta({ ...a,permissions: ['leads.editar','tarefas.ver'] },leadId,{ documento: { tipo: 'link',url: 'https://qa.invalid/documento',sha256: 'a'.repeat(64) } }))).toBe(409);
    expect(await status(legacy.decidir({ ...a,permissions: ['leads.editar','tarefas.ver'] },leadId,{ decisao: 'aceite',evidencia: { tipo: 'mensagem',canal: 'outro',texto: 'Não é um aceite real.' },condicoesHash: 'a'.repeat(64) }))).toBe(409);
  });
  it('mesma aceitação com outro pedido ou ator não duplica e fingerprint divergente recusa',async () => {
    const p = await svc.proposta(a,leadId,prop()),ace = pedidoAceite(p.eventoId);
    const r = await svc.aceitar(decisor,leadId,ace); expect((await svc.aceitar(decisor,leadId,ace)).eventoId).toBe(r.eventoId);
    expect(await status(svc.aceitar({ orgId: org,sub: segundo },leadId,ace))).toBe(409);
    expect(await status(svc.aceitar(decisor,leadId,{ ...ace,requestId: uid() }))).toBe(409);
    expect(await status(svc.aceitar(decisor,leadId,{ ...ace,evidencia: { tipo: 'exercicio',texto: 'Outra evidência sintética.' } }))).toBe(409);
  });
  it('replay confirmado preserva acordo v1 após proposta v2; decisão nova antiga recusa',async () => {
    const s = await preparar(); await svc.proposta(a,leadId,{ ...prop(1),documento: { ...documento,corpo: 'Nova versão sintética do documento.' } });
    expect((await svc.aceitar(decisor,leadId,s.ace)).eventoId).toBe(s.r.eventoId);
    expect(await status(svc.aceitar(decisor,leadId,{ ...s.ace,requestId: uid() }))).toBe(409);
    expect(await status(svc.entregar(a,leadId,s.entrega))).toBe(409);
  });
  it('duas chamadas concorrentes criam uma entrega; resposta perdida recupera a mesma',async () => {
    const s = await preparar(),[x,y] = await Promise.all([svc.entregar(a,leadId,s.entrega),svc.entregar(a,leadId,s.entrega)]);
    expect(x.taskId).toBe(y.taskId); expect([x.replayed,y.replayed].sort()).toEqual([false,true]);
    expect((await efeitos()).tasks).toBe(1);
    await svc.proposta(a,leadId,prop(1)); expect((await svc.entregar(a,leadId,s.entrega)).taskId).toBe(x.taskId);
    const origem = await svc.origemDaEntrega(a,x.taskId!); expect(origem).toMatchObject({ leadId,propostaVersao: 1,aceiteId: s.r.eventoId });
  });
  it('tarefa editável preserva o vínculo independente do texto e da etapa',async () => {
    const s = await preparar(),r = await svc.entregar(a,leadId,s.entrega);
    await db.workTask.update({ where: { id: r.taskId },data: { title: 'Entrega renomeada',description: 'Descrição alterada em Trabalho.' } });
    expect((await svc.ler(a,leadId)).entregas[0]).toMatchObject({ taskId: r.taskId,title: 'Entrega renomeada',propostaVersao: 1 });
  });
  it('sem aceite não abre entrega, nem usa versão de outra oportunidade',async () => {
    const p = await svc.proposta(a,leadId,prop());
    const entrega = { requestId: uid(),aceiteId: uid(),propostaId: p.eventoId,expectedPropostaVersion: 1,condicoesHash: hashComercial(condicoes),listId,title: 'QA' };
    expect(await status(svc.entregar(a,leadId,entrega))).toBe(409); expect((await efeitos()).tasks).toBe(0);
    expect(await status(svc.aceitar(decisor,leadId,pedidoAceite(uid())))).toBe(409);
  });
  it('permissão revogada e inativação recusam inclusive replay já confirmado',async () => {
    const s = await preparar(),r = await svc.entregar(a,leadId,s.entrega),antes = await efeitos();
    await db.role.update({ where: { id: roleEditor },data: { permissions: { disconnect: { key: 'tarefas.editar' } } } });
    expect(await status(svc.entregar(a,leadId,s.entrega))).toBe(403); expect(await efeitos()).toEqual(antes);
    await db.user.update({ where: { id: aprovador },data: { isActive: false } });
    expect(await status(svc.aceitar(decisor,leadId,s.ace))).toBe(403);
    await db.role.update({ where: { id: roleEditor },data: { permissions: { disconnect: { key: 'leads.ver' } } } });
    expect(await status(svc.origemDaEntrega(a,r.taskId!))).toBe(403);
  });
  it('referências de outra empresa e responsável inativo recusam sem efeitos',async () => {
    const s = await preparar(),antes = await efeitos();
    for (const delta of [{ listId: foreignList },{ statusId: foreignStatus },{ assigneeUserId: externo }]) expect(await status(svc.entregar(a,leadId,{ ...s.entrega,...delta }))).toBe(404);
    await db.user.update({ where: { id: editor },data: { isActive: false } });
    expect(await status(svc.entregar(decisor,leadId,s.entrega))).toBe(404); expect(await efeitos()).toEqual(antes);
    expect(await status(svc.ler({ orgId: outra,sub: externo },leadId))).toBe(403);
  });
  it('valor comercial ausente permanece pendente e recusa aceite; nenhuma obrigação é inventada',async () => {
    const p = await svc.proposta(a,leadId,{ ...prop(),condicoes: { ...condicoes,valorCanonico: null } });
    expect(await status(svc.aceitar(decisor,leadId,{ ...pedidoAceite(p.eventoId),condicoesHash: hashComercial({ ...condicoes,valorCanonico: null }) }))).toBe(409);
    expect((await svc.ler(a,leadId)).financeiro.situacao).toBe('pendente'); expect((await efeitos()).contracts).toBe(0); expect((await efeitos()).finance).toBe(0);
  });
  it('snapshot adulterado não é exibido nem consumido',async () => {
    const p = await svc.proposta(a,leadId,prop()),e = await db.leadEvent.findUniqueOrThrow({ where: { id: p.eventoId } }),payload = structuredClone(e.payload) as any;
    payload.dados.documento.corpo = 'Corpo adulterado pela fixture QA.';
    await db.leadEvent.update({ where: { id: p.eventoId },data: { payload } });
    expect(await status(svc.ler(a,leadId))).toBe(409); expect(await status(svc.aceitar(decisor,leadId,pedidoAceite(p.eventoId)))).toBe(409);
  });
  it('conta de máquina não percorre o exercício humano, mesmo com permissões de edição',async () => {
    const antes = await efeitos();
    await db.role.update({ where: { id: roleEditor },data: { key: 'ia_acao' } });
    try {
      expect(await status(svc.proposta(a,leadId,prop()))).toBe(403);
      expect(await status(svc.ler(a,leadId))).toBe(403); expect(await efeitos()).toEqual(antes);
    } finally { await db.role.update({ where: { id: roleEditor },data: { key: 'qa_editor_comercial' } }); }
  });
  it('falha no audit após o vínculo desfaz tarefa, evento e audit; retry confirma uma vez',async () => {
    const s = await preparar(),antes = await efeitos();
    const spy = vi.spyOn(audit,'log').mockRejectedValueOnce(Error('Falha QA após vínculo'));
    await expect(svc.entregar(a,leadId,s.entrega)).rejects.toThrow('Falha QA após vínculo'); expect(await efeitos()).toEqual(antes); spy.mockRestore();
    const r = await svc.entregar(a,leadId,s.entrega); expect(r.replayed).toBe(false); expect((await efeitos()).tasks).toBe(1);
  });
});
