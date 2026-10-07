import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  ComercialEntradaExercicioSchema, ComercialPropostaExercicioSchema, ComercialAceiteExercicioSchema,
  ComercialEntregaExercicioSchema, ComercialAcompanhamentoExercicioSchema, ComercialCondicoesExercicioSchema,
  ComercialDocumentoExercicioSchema, ComercialEvidenciaExercicioSchema,
  type ComercialExercicioLeitura, type ComercialExercicioResposta, type ComercialPropostaExercicioDto,
  type ComercialAceiteExercicioDto, type ComercialEntregaExercicioDto,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ModulosService } from '../tenants/modulos.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { alcadaDe, atendeAlcada, temPapelDeMaquina } from '../approvals/alcada';
import { leadIdDaEntrada } from './entrada-de-lead';

export interface AtorComercial { orgId: string; sub: string }
type Acao = 'entrada' | 'proposta' | 'aceite' | 'entrega' | 'acompanhamento';
type Db = Prisma.TransactionClient;
const PREFIXO = 'comercial_qa_';
const CONTRATO = 'comercial-exercicio-v1';
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const respostaSchema = z.object({ leadId: uuid, eventoId: uuid, replayed: z.boolean(), taskId: uuid.optional() }).strict();
const envelope = z.object({ modo: z.literal('exercicio'), contrato: z.literal(CONTRATO),
  acao: z.enum(['entrada','proposta','aceite','entrega','acompanhamento']), requestId: uuid,
  fingerprint: hash, atorId: uuid, dados: z.unknown(), resposta: respostaSchema,
}).strict();
type Recibo = z.infer<typeof envelope>;
type Evento = { id: string; leadId: string; type: string; occurredAt: Date; payload: unknown };
function conflito(code: string, message: string): never { throw new ConflictException({ code, message }); }
function canonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  const r = v as Record<string,unknown>;
  return '{' + Object.keys(r).filter((k) => r[k] !== undefined).sort().map((k) => JSON.stringify(k)+':'+canonico(r[k])).join(',') + '}';
}
export const hashComercial = (v: unknown) => createHash('sha256').update(canonico(v)).digest('hex');
export function idComercial(partes: string[]): string {
  const b = createHash('sha256').update(partes.join('\0')).digest().subarray(0,16);
  b[6] = (b[6] & 15) | 80; b[8] = (b[8] & 63) | 128;
  const h = b.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function lerRecibo(e: Evento): Recibo {
  const r = envelope.safeParse(e.payload);
  if (!r.success || e.type !== PREFIXO+r.data.acao || r.data.resposta.eventoId !== e.id || r.data.resposta.leadId !== e.leadId)
    conflito('comercial_registro_inconsistente','O registro do exercício está inconsistente.');
  return r.data;
}

@Injectable()
export class ComercialExercicioService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly modulos: ModulosService) {}
  private async ambiente(orgId: string) {
    if (process.env.ROOTOS_QA_PREVIEW !== '1') throw new NotFoundException('Exercício não disponível.');
    const ms = await this.modulos.modulosDaOrg(orgId);
    if (!ms.has('leads') || !ms.has('trabalho')) throw new NotFoundException('Exercício não disponível.');
  }
  private async pessoa(db: Db, a: AtorComercial, permissoes: string[], decisor = false) {
    await exigirAcessoAtual(db, a.orgId, a.sub, permissoes);
    const u = await db.user.findFirst({ where: { id: a.sub, orgId: a.orgId, isActive: true }, select: { roles: { where: { orgId: a.orgId }, select: { key: true, permissions: { select: { key: true } } } } } });
    if (temPapelDeMaquina(u?.roles.map((r) => r.key) ?? [])) throw new ForbiddenException('O exercício Comercial exige uma pessoa operando.');
    const alcada = alcadaDe(u?.roles.map((r) => r.key) ?? []);
    if (decisor && !atendeAlcada('responsavel', alcada)) throw new ForbiddenException('O aceite de exercício exige alçada responsável.');
    return { alcada, permissoes: new Set(u?.roles.flatMap((r) => r.permissions.map((p) => p.key)) ?? []) };
  }
  private async eventos(db: Db, orgId: string, leadId: string) {
    const es = await db.leadEvent.findMany({ where: { orgId, leadId, type: { startsWith: PREFIXO } }, orderBy: [{ occurredAt: 'asc' },{ id: 'asc' }] });
    return es.map((e) => ({ e, r: lerRecibo(e) }));
  }
  private async exercicio(db: Db, orgId: string, leadId: string) {
    const lead = await db.lead.findFirst({ where: { id: leadId, orgId } });
    if (!lead) throw new NotFoundException('Oportunidade de exercício não encontrada.');
    const es = await this.eventos(db, orgId, leadId);
    if (!es.some(({ r }) => r.acao === 'entrada')) throw new NotFoundException('Oportunidade de exercício não encontrada.');
    return { lead, es };
  }
  private propostas(es: Awaited<ReturnType<ComercialExercicioService['eventos']>>) {
    const ps = es.filter(({ r }) => r.acao === 'proposta').map(({ e, r }): ComercialPropostaExercicioDto => {
      const schema = z.object({ versao: z.number().int().positive(), documento: ComercialDocumentoExercicioSchema.extend({ hash }), condicoes: ComercialCondicoesExercicioSchema, condicoesHash: hash }).strict();
      const v = schema.safeParse(r.dados);
      if (!v.success || hashComercial({ titulo: v.data.documento.titulo, corpo: v.data.documento.corpo }) !== v.data.documento.hash || hashComercial(v.data.condicoes) !== v.data.condicoesHash)
        conflito('comercial_registro_inconsistente','A versão da proposta está inconsistente.');
      return { id: e.id, ...v.data, registradaEm: e.occurredAt.toISOString(), atorId: r.atorId };
    }).sort((a,b) => a.versao-b.versao);
    if (ps.some((p,i) => p.versao !== i+1)) conflito('comercial_registro_inconsistente','O histórico das versões está inconsistente.');
    return ps;
  }
  private aceites(es: Awaited<ReturnType<ComercialExercicioService['eventos']>>, ps: ComercialPropostaExercicioDto[]) {
    return es.filter(({ r }) => r.acao === 'aceite').map(({ e,r }): ComercialAceiteExercicioDto => {
      const schema = z.object({ propostaId: uuid, propostaVersao: z.number().int().positive(), condicoesHash: hash, evidencia: ComercialEvidenciaExercicioSchema,
        alcada: z.object({ minima: z.literal('responsavel'), verificada: z.enum(['responsavel','titular']) }).strict() }).strict();
      const v = schema.safeParse(r.dados);
      const p = v.success ? ps.find((p) => p.id === v.data.propostaId) : null;
      if (!v.success || !p || p.versao !== v.data.propostaVersao || p.condicoesHash !== v.data.condicoesHash)
        conflito('comercial_registro_inconsistente','O vínculo do aceite de exercício está inconsistente.');
      return { id: e.id, ...v.data, registradaEm: e.occurredAt.toISOString(), atorId: r.atorId };
    });
  }
  private async entregas(db: Db, orgId: string, leadId: string, es: Awaited<ReturnType<ComercialExercicioService['eventos']>>, aceites: ComercialAceiteExercicioDto[]) {
    const ds: ComercialEntregaExercicioDto[] = [];
    for (const { e,r } of es.filter(({ r }) => r.acao === 'entrega')) {
      const schema = z.object({ taskId: uuid, listId: uuid, title: z.string().min(1), aceiteId: uuid, propostaId: uuid, propostaVersao: z.number().int().positive(), condicoesHash: hash }).strict();
      const v = schema.safeParse(r.dados);
      const a = v.success ? aceites.find((a) => a.id === v.data.aceiteId) : null;
      if (!v.success || !a || a.propostaId !== v.data.propostaId || a.propostaVersao !== v.data.propostaVersao || a.condicoesHash !== v.data.condicoesHash || r.resposta.taskId !== v.data.taskId)
        conflito('comercial_registro_inconsistente','O vínculo da entrega está inconsistente.');
      const t = await db.workTask.findFirst({ where: { id: v.data.taskId, orgId }, select: { id: true, title: true, listId: true } });
      if (!t || t.id !== idComercial([orgId,CONTRATO,'entrega',a.id]))
        conflito('comercial_entrega_indisponivel','A entrega do exercício não está disponível.');
      ds.push({ ...v.data, listId: t.listId, title: t.title, criadaEm: e.occurredAt.toISOString(), atorId: r.atorId });
    }
    if (new Set(ds.map((d) => d.aceiteId)).size !== ds.length) conflito('comercial_registro_inconsistente','Há entregas duplicadas no registro.');
    return ds;
  }
  private async repetir(db: Db, a: AtorComercial, acao: Acao, leadId: string, p: { requestId: string }) {
    const eventId = idComercial([a.orgId, CONTRATO, p.requestId]);
    const fingerprint = hashComercial({ orgId: a.orgId, actorId: a.sub, acao, leadId, pedido: p });
    const e = await db.leadEvent.findFirst({ where: { id: eventId, orgId: a.orgId } });
    if (!e) return { eventId, fingerprint, resposta: null };
    const r = lerRecibo(e);
    if (r.atorId !== a.sub || r.fingerprint !== fingerprint || r.acao !== acao || e.leadId !== leadId)
      conflito('comercial_pedido_conflito','Este pedido já foi usado com outra pessoa ou conteúdo.');
    if (acao !== 'entrada') {
      const s = await this.exercicio(db, a.orgId, leadId), ps = this.propostas(s.es), ats = this.aceites(s.es,ps);
      if (r.resposta.taskId) await this.entregas(db, a.orgId, leadId, s.es, ats);
    }
    return { eventId, fingerprint, resposta: { ...r.resposta, replayed: true } };
  }
  private async registrar(db: Db, a: AtorComercial, acao: Acao, leadId: string, requestId: string, r: { eventId: string; fingerprint: string }, dados: unknown, taskId?: string, replayed = false) {
    const resposta: ComercialExercicioResposta = { leadId, eventoId: r.eventId, replayed, ...(taskId ? { taskId } : {}) };
    const payload = { modo: 'exercicio', contrato: CONTRATO, acao, requestId, fingerprint: r.fingerprint, atorId: a.sub, dados, resposta };
    await db.leadEvent.create({ data: { id: r.eventId, orgId: a.orgId, leadId, type: PREFIXO+acao, payload: payload as unknown as Prisma.InputJsonValue } });
    await this.audit.log({ orgId: a.orgId, actorId: a.sub, action: 'comercial.exercicio.'+acao, entityType: 'lead', entityId: leadId,
      after: { modo: 'exercicio', eventoId: r.eventId, requestId, ...(taskId ? { taskId } : {}) } }, db);
    return resposta;
  }
  private async transacao<T>(a: AtorComercial, permissoes: string[], decisor: boolean, fn: (db: Db, pessoa: Awaited<ReturnType<ComercialExercicioService['pessoa']>>) => Promise<T>) {
    await this.ambiente(a.orgId);
    return this.prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`comercial-exercicio:${a.orgId}`}))`;
      const pessoa = await this.pessoa(db,a,permissoes,decisor);
      const resultado = await fn(db,pessoa);
      await this.pessoa(db,a,permissoes,decisor);
      return resultado;
    });
  }
  async entrada(a: AtorComercial, input: unknown): Promise<ComercialExercicioResposta> {
    const p = ComercialEntradaExercicioSchema.parse(input), leadId = leadIdDaEntrada(a.orgId,{ tipo: 'manual', ref: p.origemRef });
    return this.transacao(a,['leads.editar'],false,async (db) => {
      const r = await this.repetir(db,a,'entrada',leadId,p); if (r.resposta) return r.resposta;
      const ownerId = p.ownerId ?? a.sub;
      if (!await db.user.findFirst({ where: { id: ownerId, orgId: a.orgId, isActive: true }, select: { id: true } })) throw new NotFoundException('Responsável não encontrado.');
      const existente = await db.lead.findFirst({ where: { id: leadId, orgId: a.orgId } });
      if (existente) {
        const s = await this.exercicio(db,a.orgId,leadId);
        const origem = s.es.find(({ r }) => r.acao === 'entrada')!.r.dados as { origemRef: string; nome: string; ownerId: string };
        if (origem.origemRef !== p.origemRef || origem.nome !== p.nome || origem.ownerId !== ownerId)
          conflito('comercial_origem_conflito','Esta origem já tem uma oportunidade com outros dados.');
      } else {
        await db.lead.create({ data: { id: leadId, orgId: a.orgId, name: '[QA] '+p.nome, ownerId } });
      }
      return this.registrar(db,a,'entrada',leadId,p.requestId,r,{ origemRef: p.origemRef, nome: p.nome, ownerId },undefined,!!existente);
    });
  }
  async acompanhar(a: AtorComercial, id: string, input: unknown) {
    const p = ComercialAcompanhamentoExercicioSchema.parse(input);
    return this.transacao(a,['leads.editar'],false,async (db) => {
      await this.exercicio(db,a.orgId,id);
      const r = await this.repetir(db,a,'acompanhamento',id,p); if (r.resposta) return r.resposta;
      const changed = await db.lead.updateMany({ where: { id, orgId: a.orgId, updatedAt: new Date(p.expectedUpdatedAt) }, data: { status: p.status, nextAction: p.nextAction } });
      if (changed.count !== 1) conflito('comercial_oportunidade_alterada','A oportunidade mudou. Reabra antes de salvar.');
      return this.registrar(db,a,'acompanhamento',id,p.requestId,r,{ status: p.status, nextAction: p.nextAction });
    });
  }
  async proposta(a: AtorComercial, id: string, input: unknown) {
    const p = ComercialPropostaExercicioSchema.parse(input);
    return this.transacao(a,['leads.editar'],false,async (db) => {
      const s = await this.exercicio(db,a.orgId,id);
      const r = await this.repetir(db,a,'proposta',id,p); if (r.resposta) return r.resposta;
      const ps = this.propostas(s.es), atual = ps.at(-1)?.versao ?? 0;
      if (atual !== p.expectedPropostaVersion) conflito('comercial_proposta_alterada','A proposta mudou. Reabra antes de salvar outra versão.');
      return this.registrar(db,a,'proposta',id,p.requestId,r,{ versao: atual+1, documento: { ...p.documento, hash: hashComercial(p.documento) }, condicoes: p.condicoes, condicoesHash: hashComercial(p.condicoes) });
    });
  }
  private escolher(ps: ComercialPropostaExercicioDto[], propostaId: string, versao: number, condicoesHash: string) {
    const p = ps.at(-1);
    if (!p || p.id !== propostaId || p.versao !== versao || p.condicoesHash !== condicoesHash)
      conflito('comercial_proposta_alterada','A proposta ou as condições mudaram. Reabra antes de continuar.');
    if (!p.condicoes.valorCanonico) conflito('comercial_condicoes_pendentes','Informe o valor comercial na proposta antes do aceite de exercício.');
    return p;
  }
  async aceitar(a: AtorComercial, id: string, input: unknown) {
    const p = ComercialAceiteExercicioSchema.parse(input);
    return this.transacao(a,['leads.editar','tarefas.ver'],true,async (db,pessoa) => {
      const s = await this.exercicio(db,a.orgId,id);
      const r = await this.repetir(db,a,'aceite',id,p); if (r.resposta) return r.resposta;
      const ps = this.propostas(s.es), proposta = this.escolher(ps,p.propostaId,p.expectedPropostaVersion,p.condicoesHash);
      if (this.aceites(s.es,ps).some((a) => a.propostaId === proposta.id)) conflito('comercial_aceite_ja_registrado','Esta versão já tem um aceite de exercício.');
      return this.registrar(db,a,'aceite',id,p.requestId,r,{ propostaId: proposta.id, propostaVersao: proposta.versao, condicoesHash: proposta.condicoesHash,
        evidencia: p.evidencia, alcada: { minima: 'responsavel', verificada: pessoa.alcada } });
    });
  }
  async entregar(a: AtorComercial, id: string, input: unknown) {
    const p = ComercialEntregaExercicioSchema.parse(input);
    return this.transacao(a,['leads.editar','tarefas.ver','tarefas.editar'],false,async (db) => {
      const s = await this.exercicio(db,a.orgId,id);
      const r = await this.repetir(db,a,'entrega',id,p); if (r.resposta) return r.resposta;
      const ps = this.propostas(s.es), proposta = this.escolher(ps,p.propostaId,p.expectedPropostaVersion,p.condicoesHash), ats = this.aceites(s.es,ps);
      const aceite = ats.find((a) => a.id === p.aceiteId && a.propostaId === proposta.id && a.condicoesHash === proposta.condicoesHash);
      if (!aceite) conflito('comercial_aceite_ausente','Esta versão precisa de um aceite de exercício antes da entrega.');
      if ((await this.entregas(db,a.orgId,id,s.es,ats)).some((d) => d.aceiteId === aceite.id)) conflito('comercial_entrega_ja_aberta','Este aceite já tem uma entrega em Trabalho.');
      if (!await db.workList.findFirst({ where: { id: p.listId, orgId: a.orgId }, select: { id: true } })) throw new NotFoundException('Lista não encontrada.');
      const status = await db.workStatus.findFirst({ where: { listId: p.listId, orgId: a.orgId, ...(p.statusId ? { id: p.statusId } : { type: 'open' }) }, orderBy: { order: 'asc' }, select: { id: true } });
      if (!status) throw new NotFoundException('Etapa não encontrada na lista.');
      if (p.assigneeUserId && !await db.user.findFirst({ where: { id: p.assigneeUserId, orgId: a.orgId, isActive: true }, select: { id: true } })) throw new NotFoundException('Responsável não encontrado.');
      const taskId = idComercial([a.orgId,CONTRATO,'entrega',aceite.id]);
      await db.workTask.create({ data: { id: taskId, orgId: a.orgId, listId: p.listId, statusId: status.id, title: p.title, assigneeUserId: p.assigneeUserId,
        description: `Exercício Comercial (QA). Origem: /leads/${id}. Aceite de exercício: ${aceite.id}.` } });
      return this.registrar(db,a,'entrega',id,p.requestId,r,{ taskId, listId: p.listId, title: p.title, aceiteId: aceite.id, propostaId: proposta.id,
        propostaVersao: proposta.versao, condicoesHash: proposta.condicoesHash },taskId);
    });
  }
  async origemDaEntrega(a: AtorComercial, taskId: string) {
    await this.ambiente(a.orgId);
    await this.pessoa(this.prisma,a,['leads.ver','tarefas.ver']);
    const eventos = await this.prisma.leadEvent.findMany({ where: { orgId: a.orgId, type: PREFIXO+'entrega',
      payload: { path: ['dados','taskId'], equals: taskId } }, select: { leadId: true }, take: 2 });
    if (eventos.length === 0) return null;
    if (eventos.length !== 1) conflito('comercial_registro_inconsistente','O vínculo comercial está inconsistente.');
    const s = await this.ler(a,eventos[0].leadId), d = s.entregas.find((d) => d.taskId === taskId);
    if (!d) conflito('comercial_entrega_indisponivel','A origem comercial não está disponível.');
    await this.pessoa(this.prisma,a,['leads.ver','tarefas.ver']);
    return { modo: 'exercicio' as const, leadId: s.lead.id, leadNome: s.lead.nome, aceiteId: d.aceiteId, propostaVersao: d.propostaVersao };
  }

  async ler(a: AtorComercial, id: string): Promise<ComercialExercicioLeitura> {
    await this.ambiente(a.orgId);
    const pessoa = await this.pessoa(this.prisma,a,['leads.ver']);
    const s = await this.exercicio(this.prisma,a.orgId,id), ps = this.propostas(s.es), ats = this.aceites(s.es,ps);
    let ds: ComercialEntregaExercicioDto[] = [];
    if (s.es.some(({ r }) => r.acao === 'entrega')) {
      await this.pessoa(this.prisma,a,['leads.ver','tarefas.ver']);
      ds = await this.entregas(this.prisma,a.orgId,id,s.es,ats);
    }
    const primeira = s.es.find(({ r }) => r.acao === 'entrada')!.r.dados;
    const origem = z.object({ origemRef: uuid, nome: z.string().min(1), ownerId: uuid }).strict().safeParse(primeira);
    if (!origem.success || leadIdDaEntrada(a.orgId,{ tipo: 'manual', ref: origem.data.origemRef }) !== id)
      conflito('comercial_registro_inconsistente','A origem do exercício está inconsistente.');
    await this.pessoa(this.prisma,a,['leads.ver',...(ds.length ? ['tarefas.ver'] : [])]);
    return { modo: 'exercicio', lead: { id, nome: s.lead.name, ownerId: s.lead.ownerId, status: s.lead.status, nextAction: s.lead.nextAction, updatedAt: s.lead.updatedAt.toISOString() },
      origem: { tipo: 'manual', ref: origem.data.origemRef }, propostas: ps, versaoAtual: ps.at(-1)?.versao ?? 0, aceites: ats, entregas: ds,
      financeiro: { situacao: 'pendente', pendencias: ['Identificar a contraparte financeira.', 'Definir classificação e conta financeira.', 'Confirmar vencimento e condições de cobrança.'] },
      podeAceitar: atendeAlcada('responsavel',pessoa.alcada) && pessoa.permissoes.has('leads.editar') && pessoa.permissoes.has('tarefas.ver'),
      podeEntregar: pessoa.permissoes.has('leads.editar') && pessoa.permissoes.has('tarefas.ver') && pessoa.permissoes.has('tarefas.editar') };
  }
}
