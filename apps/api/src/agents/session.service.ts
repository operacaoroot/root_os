import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  Prisma, SessionCanal, SessionStatus, SessionStepTipo, RiskLevel,
  type Session, type AgentLocalOperation, type AgentLocalAgendaRevision,
} from '@prisma/client';
import {
  SessaoHistoricaListaSchema, SessaoHistoricaTracoSchema, ProcedimentoLocalPedidoSchema,
  AgendaLocalReciboSchema, AgendaLocalRevisaoSchema,
  type SessaoHistoricaConsulta, type SessaoHistoricaLista, type SessaoHistoricaTraco, type ProcedimentoLocalPedido, type AgendaLocalRecibo,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';

const REF_LOCAL = 'procedimento-local:';
const PEDIDO_GENERICO = 'Procedimento local de síntese de fonte';
const RESPOSTA_GENERICA = 'Resultado disponível no procedimento local.';
const ENTRADA_V1 = z.object({ requestId: z.string().uuid(), pedido: z.string().trim().min(1).max(2000),
  itemId: z.string().uuid(), versionId: z.string().uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedItemVersion: z.number().int().positive() }).strict();
const fim = z.enum(['stop', 'length', 'content_filter', 'tool_calls', 'function_call', 'ausente', 'desconhecido']);
const tokens = z.number().int().nonnegative().nullable();
// Mesma forma histórica do produtor V1/V2; não divulga os campos privados.
const REGISTRO_HISTORICO = z.object({
  tipo: z.literal('procedimento_local'), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid(),
  entradaContrato: z.literal(2).optional(), entrada: z.unknown(),
  origemAgenda: z.object({ agendaId: z.string().uuid(), revisionId: z.string().uuid(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), numero: z.number().int().positive().safe() }).strict().optional(),
  procedimento: z.object({ versao: z.number().int().nonnegative(), proposito: z.string(), passos: z.array(z.string()), definicaoDePronto: z.string() }).strict(),
  fonte: z.object({ itemId: z.string().uuid(), versionId: z.string().uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    versao: z.number().int().positive(), chave: z.string(), sourceType: z.string(), sourceRef: z.string().nullable(), title: z.string() }).strict(),
  saida: z.object({ texto: z.string(), modelo: z.string(), tokensIn: tokens, tokensOut: tokens, finishReason: fim.optional() }).strict().optional(),
  observado: z.object({ modelo: z.string().nullable(), tokensIn: tokens, tokensOut: tokens, finishReason: fim.optional() }).strict().optional(),
  modeloConfigurado: z.string().nullable(),
}).strict();
type RegistroHistorico = z.infer<typeof REGISTRO_HISTORICO>;
type EntradaHistorica = z.infer<typeof ENTRADA_V1> | ProcedimentoLocalPedido;
type LocalConferido = { estado: 'local_v1_validado' | 'local_v2_validado'; registro: RegistroHistorico; entrada: EntradaHistorica; requestId: string; payload: unknown };
const DECISAO_HISTORICA = z.enum(['executado', 'aguardando_aprovacao', 'recusado', 'erro']).nullable();
const STEP_LEITURA = { id: true, orgId: true, sessionId: true, ordem: true, tipo: true,
  capacidade: true, toolCallId: true, nivel: true, decisao: true, approvalId: true, duracaoMs: true, payload: true } as const;
const TOOL_LEITURA = { id: true, orgId: true, capabilityId: true, decisionId: true, sessionId: true,
  agentSlug: true, correlationId: true, approvalId: true } as const;
const APPROVAL_LEITURA = { id: true, orgId: true, toolCallId: true, capabilityId: true, decisionId: true } as const;
type StepHistorico = Prisma.SessionStepGetPayload<{ select: typeof STEP_LEITURA }>;
type AgenteHistorico = { id: string; orgId: string; slug: string; nome: string; iniciais: string };
type FormatoHistorico = { estado: 'generico_local' | 'nao_conferido'; motivo: 'origem_historica_insuficiente' | 'registro_inconsistente' | null; prova: string | null };
type RetratoHistorico = { session: Session; agente: AgenteHistorico | null; steps: StepHistorico[];
  tools: Prisma.ToolCallGetPayload<{ select: typeof TOOL_LEITURA }>[];
  approvals: Prisma.ApprovalGetPayload<{ select: typeof APPROVAL_LEITURA }>[];
  capacidades: { id: string }[]; formato: FormatoHistorico };
const iguais = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface PassoInput {
  tipo: SessionStepTipo;
  capacidade?: string | null;
  argsResumo?: string | null;
  args?: Prisma.InputJsonValue;
  resultadoResumo?: string | null;
  toolCallId?: string | null;
  nivel?: RiskLevel | null;
  decisao?: string | null;
  motivo?: string | null;
  gatilhos?: string[];
  approvalId?: string | null;
  provider?: string | null;
  modelo?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  tokensCacheRead?: number | null;
  tokensCacheWrite?: number | null;
  custoUsd?: number | null;
  custoEstimado?: boolean;
  stopReason?: string | null;
  fontes?: Prisma.InputJsonValue;
  /** Por que não havia dado — só no passo de contexto. Ver `SessionStep`. */
  motivoSemDado?: string | null;
  payload?: Prisma.InputJsonValue;
  texto?: string | null;
  erro?: string | null;
  duracaoMs?: number;
}

/** Persistência da sessão e do traço. O runtime não fala com o Prisma direto. */
@Injectable()
export class SessionService {
  private static readonly TTL_MIN = Number(process.env.SESSION_TTL_MIN ?? 120);

  constructor(private readonly prisma: PrismaService) {}

  async abrir(input: {
    orgId: string;
    agentId: string;
    canal: SessionCanal;
    canalRef?: string | null;
    solicitanteId?: string | null;
    solicitanteRotulo: string;
    pedido: string;
  }) {
    return this.prisma.session.create({
      data: {
        orgId: input.orgId,
        agentId: input.agentId,
        canal: input.canal,
        canalRef: input.canalRef ?? null,
        solicitanteId: input.solicitanteId ?? null,
        solicitanteRotulo: input.solicitanteRotulo,
        pedido: input.pedido,
      },
      select: { id: true, criadaEm: true },
    });
  }

  /**
   * A sessão viva daquele canal e daquele contato. É isto que resolve "o bot
   * não tem memória entre turnos": o problema nunca foi o modelo, foi não
   * existir onde guardar.
   */
  async retomar(orgId: string, canal: SessionCanal, canalRef: string) {
    const limite = new Date(Date.now() - SessionService.TTL_MIN * 60_000);
    return this.prisma.session.findFirst({
      where: { orgId, canal, canalRef, ultimaAtividadeEm: { gt: limite }, toolReceipts: { none: {} } },
      orderBy: { ultimaAtividadeEm: 'desc' },
      select: { id: true },
    });
  }

  async passo(orgId: string, sessionId: string, p: PassoInput): Promise<void> {
    if (await this.prisma.agentLocalToolReceipt.findFirst({ where: { orgId, sessionId }, select: { id: true } }))
      throw new ConflictException('A execução de ferramenta local já está encerrada.');
    // A ordem sai do banco, não de um contador em memória: dois passos
    // concorrentes na mesma sessão não podem colidir na chave única.
    const ultimo = await this.prisma.sessionStep.findFirst({
      where: { sessionId },
      orderBy: { ordem: 'desc' },
      select: { ordem: true },
    });
    await this.prisma.sessionStep.create({
      data: {
        orgId,
        sessionId,
        ordem: (ultimo?.ordem ?? 0) + 1,
        tipo: p.tipo,
        capacidade: p.capacidade ?? null,
        argsResumo: p.argsResumo ?? null,
        args: p.args,
        resultadoResumo: p.resultadoResumo ?? null,
        toolCallId: p.toolCallId ?? null,
        nivel: p.nivel ?? null,
        decisao: p.decisao ?? null,
        motivo: p.motivo ?? null,
        gatilhos: p.gatilhos ?? [],
        approvalId: p.approvalId ?? null,
        provider: p.provider ?? null,
        modelo: p.modelo ?? null,
        tokensIn: p.tokensIn ?? null,
        tokensOut: p.tokensOut ?? null,
        tokensCacheRead: p.tokensCacheRead ?? null,
        tokensCacheWrite: p.tokensCacheWrite ?? null,
        custoUsd: p.custoUsd ?? null,
        custoEstimado: p.custoEstimado ?? true,
        stopReason: p.stopReason ?? null,
        fontes: p.fontes ?? [],
        motivoSemDado: p.motivoSemDado ?? null,
        payload: p.payload,
        texto: p.texto ?? null,
        erro: p.erro ?? null,
        duracaoMs: p.duracaoMs ?? 0,
      },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { ultimaAtividadeEm: new Date() },
    });
  }

  async encerrar(
    sessionId: string,
    dados: {
      status: SessionStatus;
      resposta?: string;
      nivelMax?: RiskLevel | null;
      motivo?: string | null;
      fontes?: Prisma.InputJsonValue;
      semProcedencia?: boolean;
      custoUsd?: number;
      custoEstimado?: boolean;
      provider?: string | null;
      modelo?: string | null;
      tokensIn?: number;
      tokensOut?: number;
      passos?: number;
      duracaoMs?: number;
    },
  ): Promise<void> {
    if (await this.prisma.agentLocalToolReceipt.findFirst({ where: { sessionId }, select: { id: true } }))
      throw new ConflictException('A execução de ferramenta local já está encerrada.');
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { ...dados, encerradaEm: new Date() },
    });
  }

  /** Metadados autorizados; conteúdo privado permanece nas rotas próprias. */
  async traco(orgId: string, actorId: string, sessionId: string): Promise<SessaoHistoricaTraco | null> {
    return this.lerAutorizado(orgId, actorId, async (tx) => {
      const s = await tx.session.findFirst({ where: { id: sessionId, orgId } });
      if (!s) return null;
      const retrato = await this.retratoNoTx(tx, s);
      const atual = await tx.session.findFirst({ where: { id: s.id, orgId } });
      if (!atual) throw new InternalServerErrorException('Histórico indisponível.');
      const conferido = await this.retratoNoTx(tx, atual);
      const p = this.projetar(retrato, conferido);
      const dto = SessaoHistoricaTracoSchema.safeParse({
        schemaVersion: 1, escopo: { orgId, actorId }, id: s.id, agente: p.agente,
        canal: s.canal, solicitante: s.solicitanteRotulo, status: s.status,
        custoUsd: Number(s.custoUsd), custoEstimado: s.custoEstimado,
        duracaoMs: s.duracaoMs, criadaEm: s.criadaEm.toISOString(), conteudo: p.conteudo, vinculos: p.vinculos,
        blocos: {
          pedido: p.generico ? PEDIDO_GENERICO : null, contexto: { fontes: [], texto: null },
          ferramentas: p.ferramentas, regua: { nivelMax: s.nivelMax, motivo: null, decisoes: p.decisoes },
          resposta: { texto: p.generico && s.resposta === RESPOSTA_GENERICA ? RESPOSTA_GENERICA : null,
            semProcedencia: s.semProcedencia, fontes: [] },
          registro: { correlationId: s.id, toolCalls: p.toolCalls, passos: retrato.steps.length },
        },
      });
      if (!dto.success) throw new InternalServerErrorException('Histórico indisponível.');
      return dto.data;
    });
  }

  async listar(orgId: string, actorId: string, consulta: SessaoHistoricaConsulta): Promise<SessaoHistoricaLista> {
    return this.lerAutorizado(orgId, actorId, async (tx) => {
      const where: Prisma.SessionWhereInput = { orgId };
      if (consulta.canal !== null) where.canal = consulta.canal;
      if (consulta.agente !== null) {
        const agentes = await tx.agent.findMany({ where: { orgId, slug: consulta.agente }, select: { id: true } });
        where.agentId = { in: agentes.map((a) => a.id) };
      }
      const [linhas, total, somas, semFonte] = await Promise.all([
        tx.session.findMany({ where, orderBy: [{ criadaEm: 'desc' }, { id: 'desc' }], take: consulta.limite }),
        tx.session.count({ where }), tx.session.aggregate({ where, _sum: { custoUsd: true } }),
        tx.session.count({ where: { ...where, semProcedencia: true } }),
      ]);
      const items: SessaoHistoricaLista['items'] = [];
      for (const s of linhas) {
        const retrato = await this.retratoNoTx(tx, s);
        const atual = await tx.session.findFirst({ where: { id: s.id, orgId } });
        if (!atual) throw new InternalServerErrorException('Histórico indisponível.');
        const p = this.projetar(retrato, await this.retratoNoTx(tx, atual));
        items.push({ id: s.id, agente: p.agente, canal: s.canal, solicitante: s.solicitanteRotulo,
          status: s.status, pedido: p.generico ? PEDIDO_GENERICO : null, nivelMax: s.nivelMax,
          passos: s.passos, custoUsd: Number(s.custoUsd), custoEstimado: s.custoEstimado,
          duracaoMs: s.duracaoMs, semProcedencia: s.semProcedencia, criadaEm: s.criadaEm.toISOString(),
          conteudo: p.conteudo, vinculos: p.vinculos });
      }
      const dto = SessaoHistoricaListaSchema.safeParse({ schemaVersion: 1, escopo: { orgId, actorId }, consulta, items, total,
        kpis: { sessoes: total, custoUsd: Number(somas._sum.custoUsd ?? 0),
          custoParcial: linhas.some((s) => !s.custoEstimado), semProcedencia: semFonte } });
      if (!dto.success) throw new InternalServerErrorException('Histórico indisponível.');
      return dto.data;
    });
  }

  private async lerAutorizado<T>(orgId: string, actorId: string, ler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      await exigirAcessoAtual(this.prisma, orgId, actorId, ['mcp.ver']);
      return await this.prisma.$transaction(async (tx) => {
        await this.travarAutoridadeDaLeituraNoTx(tx, orgId, actorId);
        const result = await ler(tx);
        await exigirAcessoAtual(tx, orgId, actorId, ['mcp.ver']);
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (e) {
      if (e instanceof ForbiddenException) throw new ForbiddenException('Acesso insuficiente.');
      throw new InternalServerErrorException('Histórico indisponível.');
    }
  }

  private async travarAutoridadeDaLeituraNoTx(tx: Prisma.TransactionClient, orgId: string, actorId: string) {
    const orgs = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Org" WHERE id=${orgId} AND "isActive" FOR SHARE`;
    const pessoas = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id=${actorId} AND "orgId"=${orgId} AND "isActive" ORDER BY id FOR SHARE`;
    if (orgs.length !== 1 || pessoas.length !== 1) throw new ForbiddenException('Acesso insuficiente.');
    const joins = await tx.$queryRaw<Array<{ roleId: string }>>`SELECT ur."A" AS "roleId" FROM "_UserRoles" ur JOIN "Role" r ON r.id=ur."A"
      WHERE ur."B"=${actorId} AND r."orgId"=${orgId} ORDER BY ur."A",ur."B" FOR SHARE OF ur`;
    const roles = [...new Set(joins.map((j) => j.roleId))].sort();
    if (!roles.length) throw new ForbiddenException('Acesso insuficiente.');
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Role" WHERE "orgId"=${orgId} AND id IN (${Prisma.join(roles)}) ORDER BY id FOR SHARE`;
    if (locked.length !== roles.length) throw new ForbiddenException('Acesso insuficiente.');
    const grants = await tx.$queryRaw<Array<{ permissionId: string }>>`SELECT rp."A" AS "permissionId" FROM "_RolePermissions" rp
      WHERE rp."B" IN (${Prisma.join(roles)}) ORDER BY rp."B",rp."A" FOR SHARE OF rp`;
    const ids = [...new Set(grants.map((g) => g.permissionId))].sort();
    if (!ids.length) throw new ForbiddenException('Acesso insuficiente.');
    const permissions = await tx.$queryRaw<Array<{ id: string; key: string }>>`SELECT id,key FROM "Permission" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
    if (permissions.length !== ids.length || !permissions.some((p) => p.key === 'mcp.ver')) throw new ForbiddenException('Acesso insuficiente.');
    await exigirAcessoAtual(tx, orgId, actorId, ['mcp.ver']);
  }

  private async retratoNoTx(tx: Prisma.TransactionClient, session: Session): Promise<RetratoHistorico> {
    const [agente, steps] = await Promise.all([
      tx.agent.findFirst({ where: { id: session.agentId, orgId: session.orgId }, select: { id: true, orgId: true, slug: true, nome: true, iniciais: true } }),
      tx.sessionStep.findMany({ where: { sessionId: session.id, orgId: session.orgId }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }], select: STEP_LEITURA }),
    ]);
    const toolIds = [...new Set(steps.filter((s) => s.tipo === 'ferramenta' && s.toolCallId).map((s) => s.toolCallId).filter((id): id is string => id !== null))];
    const approvalIds = [...new Set(steps.map((s) => s.approvalId).filter((id): id is string => id !== null))];
    const tools = await tx.toolCall.findMany({ where: { orgId: session.orgId, id: { in: toolIds } }, select: TOOL_LEITURA });
    const [approvals, capacidades] = await Promise.all([
      tx.approval.findMany({ where: { orgId: session.orgId, id: { in: approvalIds } }, select: APPROVAL_LEITURA }),
      tx.capability.findMany({ where: { id: { in: [...new Set(tools.map((t) => t.capabilityId).filter((id): id is string => id !== null))] } }, select: { id: true } }),
    ]);
    const formato = await this.classificarFormatoNoTx(tx, session, agente, steps);
    return { session, agente, steps, tools, approvals, capacidades, formato };
  }

  private projetar(before: RetratoHistorico, after: RetratoHistorico) {
    const agente = before.agente && iguais(before.agente, after.agente) && before.session.agentId === after.session.agentId
      ? { slug: before.agente.slug, nome: before.agente.nome, iniciais: before.agente.iniciais } : null;
    let parcial = agente === null || !iguais(before.steps, after.steps);
    const generico = before.formato.estado === 'generico_local' && after.formato.estado === 'generico_local'
      && before.formato.prova === after.formato.prova && before.session.agentId === after.session.agentId
      && before.session.canal === after.session.canal && before.session.canalRef === after.session.canalRef
      && before.session.solicitanteId === after.session.solicitanteId
      && before.session.pedido === after.session.pedido && before.session.resposta === after.session.resposta;
    const conteudo: SessaoHistoricaLista['items'][number]['conteudo'] = generico
      ? { estado: 'generico_local', motivo: null, corpoDaFonteDivulgado: false }
      : { estado: 'nao_conferido', motivo: before.formato.motivo ?? after.formato.motivo ?? 'registro_inconsistente', corpoDaFonteDivulgado: false };
    const ferramentas: SessaoHistoricaTraco['blocos']['ferramentas'] = [];
    const decisoes: SessaoHistoricaTraco['blocos']['regua']['decisoes'] = [];
    const toolCalls: string[] = [];
    for (const step of before.steps.filter((s) => s.tipo === 'ferramenta')) {
      const stepAtual = after.steps.find((s) => s.id === step.id);
      const tool = before.tools.find((t) => t.id === step.toolCallId);
      const toolAtual = after.tools.find((t) => t.id === step.toolCallId);
      const decisao = DECISAO_HISTORICA.safeParse(step.decisao);
      const vinculado = !!agente && !!tool && iguais(step, stepAtual) && iguais(tool, toolAtual)
        && tool.orgId === before.session.orgId && tool.correlationId === before.session.id
        && (tool.sessionId === null || tool.sessionId === before.session.id) && tool.agentSlug === agente.slug
        && step.capacidade !== null && step.capacidade === tool.capabilityId
        && before.capacidades.some((c) => c.id === step.capacidade) && after.capacidades.some((c) => c.id === step.capacidade)
        && decisao.success;
      const capacidade = vinculado ? step.capacidade : null;
      const nivel = vinculado ? step.nivel : null;
      const decision = vinculado && decisao.success ? decisao.data : null;
      let approvalId: string | null = null;
      if (vinculado && tool?.approvalId && step.approvalId === null) parcial = true;
      if (vinculado && step.approvalId !== null && tool) {
        const approval = before.approvals.find((a) => a.id === step.approvalId);
        const approvalAtual = after.approvals.find((a) => a.id === step.approvalId);
        if (approval && iguais(approval, approvalAtual) && approval.id === tool.approvalId
          && approval.orgId === before.session.orgId && approval.toolCallId === tool.id
          && approval.capabilityId === capacidade && approval.decisionId !== null
          && tool.decisionId !== null && approval.decisionId === tool.decisionId) approvalId = approval.id;
        else parcial = true;
      }
      if (!vinculado) parcial = true;
      else if (tool && !toolCalls.includes(tool.id)) toolCalls.push(tool.id);
      ferramentas.push({ capacidade, args: null, resultado: null, nivel, decisao: decision,
        duracaoMs: step.duracaoMs, vinculo: vinculado ? 'conferido' : 'nao_conferido' });
      if (step.decisao !== null) decisoes.push({ capacidade, nivel, decisao: decision, motivo: null, gatilhos: [], approvalId });
    }
    const vinculos: SessaoHistoricaLista['items'][number]['vinculos'] = parcial
      ? { estado: 'parciais', motivo: 'referencia_nao_conferida' } : { estado: 'conferidos', motivo: null };
    return { agente, generico, conteudo, vinculos, ferramentas, decisoes, toolCalls };
  }

  private classificarFormatoDaSessao(s: Session, agente: AgenteHistorico | null, steps: StepHistorico[]): FormatoHistorico | LocalConferido {
    const primeira = steps.filter((p) => p.ordem === 1);
    if (primeira.some((p) => p.payload !== null && typeof p.payload === 'object' && !Array.isArray(p.payload)
      && (p.payload.tipo === 'procedimento_ferramenta_local' || p.payload.entradaContrato === 3)))
      return { estado: 'nao_conferido', motivo: 'origem_historica_insuficiente', prova: null };
    const marcador = s.canalRef?.startsWith(REF_LOCAL) || primeira.some((p) =>
      p.payload !== null && typeof p.payload === 'object' && !Array.isArray(p.payload) && p.payload.tipo === 'procedimento_local');
    if (!marcador) return { estado: 'nao_conferido', motivo: 'origem_historica_insuficiente', prova: null };
    const invalido: FormatoHistorico = { estado: 'nao_conferido', motivo: 'registro_inconsistente', prova: null };
    if (!agente || s.canal !== 'web' || !s.canalRef?.startsWith(REF_LOCAL) || !s.solicitanteId || primeira.length !== 1
      || s.pedido !== PEDIDO_GENERICO || !['', RESPOSTA_GENERICA].includes(s.resposta)) return invalido;
    const requestId = s.canalRef.slice(REF_LOCAL.length);
    const base = REGISTRO_HISTORICO.safeParse(primeira[0].payload);
    if (!base.success) return invalido;
    const r = base.data;
    const input = r.entradaContrato === 2 ? ProcedimentoLocalPedidoSchema.safeParse(r.entrada) : ENTRADA_V1.safeParse(r.entrada);
    if (!input.success || r.requestId !== requestId || input.data.requestId !== requestId
      || r.fingerprint !== createHash('sha256').update(JSON.stringify({ pessoaId: s.solicitanteId, slug: agente.slug, input: input.data })).digest('hex')
      || r.fonte.itemId !== input.data.itemId || r.fonte.versionId !== input.data.versionId || r.fonte.contentHash !== input.data.contentHash
      || r.entradaContrato === 2 && (!('expectedSopVersion' in input.data) || r.procedimento.versao < 1 || r.procedimento.versao !== input.data.expectedSopVersion)) return invalido;
    return { estado: r.entradaContrato === 2 ? 'local_v2_validado' : 'local_v1_validado', registro: r, entrada: input.data, requestId, payload: primeira[0].payload };
  }

  private async classificarFormatoNoTx(tx: Prisma.TransactionClient, s: Session, agente: AgenteHistorico | null, steps: StepHistorico[]): Promise<FormatoHistorico> {
    const formato = this.classificarFormatoDaSessao(s, agente, steps);
    if (!('registro' in formato)) return formato;
    const invalido: FormatoHistorico = { estado: 'nao_conferido', motivo: 'registro_inconsistente', prova: null };
    if (!agente) return invalido;
    const r = formato.registro, input = formato.entrada, requestId = formato.requestId;
    const sessions = await tx.session.findMany({ where: { orgId: s.orgId, canal: 'web', canalRef: s.canalRef }, take: 2, select: { id: true, agentId: true, solicitanteId: true } });
    if (sessions.length !== 1 || sessions[0].id !== s.id || sessions[0].agentId !== agente.id || sessions[0].solicitanteId !== s.solicitanteId) return invalido;
    const op = await tx.agentLocalOperation.findFirst({ where: { orgId: s.orgId, requestId } });
    if (!r.origemAgenda) return op ? invalido : { estado: 'generico_local', motivo: null, prova: JSON.stringify({ payload: formato.payload, sessions, op: null }) };
    if (formato.estado !== 'local_v2_validado' || !('expectedSopVersion' in input) || !op) return invalido;
    const prova = await this.conferirAgendaNoTx(tx, s, agente, r, ProcedimentoLocalPedidoSchema.parse(input), op);
    return prova === null ? invalido : { estado: 'generico_local', motivo: null, prova: JSON.stringify({ payload: formato.payload, sessions, prova }) };
  }

  private async hashAgendaNoTx(tx: Prisma.TransactionClient, value: unknown) {
    const rows = await tx.$queryRaw<Array<{ hash: string }>>`SELECT encode(sha256(convert_to(public.app_json_canonico(${JSON.stringify(value)}::jsonb),'UTF8')),'hex') AS hash`;
    if (rows.length !== 1 || !/^[a-f0-9]{64}$/.test(rows[0].hash)) throw new InternalServerErrorException('Histórico indisponível.');
    return rows[0].hash;
  }

  private async reciboNoTx(tx: Prisma.TransactionClient, op: AgentLocalOperation, slug: string) {
    const parsed = AgendaLocalReciboSchema.safeParse(op.receipt);
    if (!parsed.success) return null;
    const r = parsed.data;
    if (r.operationId !== op.id || r.requestId !== op.requestId || r.tipo !== op.tipo || r.escopo.orgId !== op.orgId
      || r.escopo.actorId !== op.actorId || r.escopo.agentId !== op.agentId || r.escopo.agentSlug !== slug
      || r.confirmadoEm !== op.criadaEm.toISOString() || !iguais(r.auditIds, op.auditIds)
      || await this.hashAgendaNoTx(tx, r.eventSnapshot) !== await this.hashAgendaNoTx(tx, op.eventSnapshot)
      || await this.hashAgendaNoTx(tx, r) !== op.receiptHash) return null;
    return r;
  }

  private async conferirAgendaNoTx(tx: Prisma.TransactionClient, s: Session, a: AgenteHistorico,
    registro: RegistroHistorico, input: ProcedimentoLocalPedido, op: AgentLocalOperation): Promise<string | null> {
    const origem = registro.origemAgenda;
    if (!origem || op.tipo !== 'agenda_disparar' || op.actorId !== s.solicitanteId || op.agentId !== a.id || op.sessionId !== s.id
      || op.agendaId !== origem.agendaId || op.revisionId !== origem.revisionId || !op.dispatchId) return null;
    const [dispatch, rev, header] = await Promise.all([
      tx.agentLocalAgendaDispatch.findFirst({ where: { id: op.dispatchId, orgId: s.orgId, agentId: a.id, agendaId: origem.agendaId,
        revisionId: origem.revisionId, sessionId: s.id, requestId: input.requestId, actorId: op.actorId, inputFingerprint: op.inputFingerprint } }),
      tx.agentLocalAgendaRevision.findFirst({ where: { id: origem.revisionId, orgId: s.orgId, agentId: a.id, agendaId: origem.agendaId } }),
      tx.agentLocalAgenda.findFirst({ where: { id: origem.agendaId, orgId: s.orgId, agentId: a.id } }),
    ]);
    if (!dispatch || dispatch.tipo !== op.tipo || !rev || !header || rev.numero !== origem.numero
      || rev.snapshotHash !== origem.snapshotHash || rev.estado !== 'habilitada_manual') return null;
    const v = await this.revisaoHistoricaNoTx(tx, rev);
    if (!v) return null;
    const c = v.configuracao;
    if (c.orgId !== s.orgId || c.agentId !== a.id || c.agendaId !== header.id
      || !iguais(ProcedimentoLocalPedidoSchema.parse({ requestId: input.requestId, ...c.pedido }), input)
      || c.fonte.itemId !== registro.fonte.itemId || c.fonte.versionId !== registro.fonte.versionId || c.fonte.contentHash !== registro.fonte.contentHash
      || c.fonte.versao !== registro.fonte.versao || c.fonte.chave !== registro.fonte.chave || c.fonte.sourceType !== registro.fonte.sourceType
      || c.fonte.sourceRef !== registro.fonte.sourceRef || c.fonte.title !== registro.fonte.title || c.modeloConfigurado !== registro.modeloConfigurado
      || c.procedimento.versao !== registro.procedimento.versao || c.procedimento.proposito !== registro.procedimento.proposito
      || !iguais(c.procedimento.passos, registro.procedimento.passos) || c.procedimento.definicaoDePronto !== registro.procedimento.definicaoDePronto) return null;
    const recibo = await this.reciboNoTx(tx, op, a.slug);
    if (!recibo || recibo.tipo !== 'agenda_disparar' || recibo.sessionId !== s.id || recibo.dispatchId !== dispatch.id
      || recibo.agendaId !== header.id || recibo.revisionId !== rev.id || recibo.agendaVersion !== rev.numero
      || recibo.snapshotHash !== rev.snapshotHash || !iguais(recibo.entradaConfirmada, input)) return null;
    const assinatura = await this.hashAgendaNoTx(tx, { schemaVersion: 1, tipo: 'agenda_disparar', orgId: s.orgId,
      actorId: op.actorId, agentId: a.id, agentSlug: a.slug, requestId: input.requestId, agendaId: header.id, revisionId: rev.id,
      snapshotHash: rev.snapshotHash, pedidoConfirmado: input, input: { expectedAgendaVersion: rev.numero, expectedSopVersion: c.procedimento.versao } });
    if (assinatura !== op.inputFingerprint) return null;
    // A criação/revisão tem sua própria causa, distinta da causa do disparo.
    const [revisionOp, creationOp] = await Promise.all([
      tx.agentLocalOperation.findFirst({ where: { orgId: s.orgId, requestId: rev.requestId, actorId: rev.actorId, agentId: a.id,
        tipo: rev.tipo, inputFingerprint: rev.inputFingerprint, agendaId: header.id, revisionId: rev.id } }),
      tx.agentLocalOperation.findFirst({ where: { orgId: s.orgId, requestId: header.criacaoRequestId, actorId: header.criadaPorId,
        agentId: a.id, tipo: header.criacaoTipo, inputFingerprint: header.criacaoFingerprint, agendaId: header.id } }),
    ]);
    if (!revisionOp || !creationOp || creationOp.tipo !== 'agenda_criar'
      || revisionOp.sessionId !== null || revisionOp.dispatchId !== null || creationOp.sessionId !== null || creationOp.dispatchId !== null) return null;
    const revisionReceipt = await this.reciboNoTx(tx, revisionOp, a.slug);
    const creationReceipt = await this.reciboNoTx(tx, creationOp, a.slug);
    if (!revisionReceipt || !('revisao' in revisionReceipt) || !iguais(revisionReceipt.revisao, v)
      || !creationReceipt || creationReceipt.tipo !== 'agenda_criar' || creationReceipt.revisao.agendaId !== header.id
      || creationReceipt.revisao.revisionId !== creationOp.revisionId || creationReceipt.revisao.numero !== 1
      || creationReceipt.anterior !== null || creationReceipt.confirmadoEm !== header.criadaEm.toISOString()) return null;
    const creationRevision = await tx.agentLocalAgendaRevision.findFirst({ where: { id: creationReceipt.revisao.revisionId,
      orgId: s.orgId, agentId: a.id, agendaId: header.id, numero: 1, tipo: 'agenda_criar',
      actorId: header.criadaPorId, requestId: header.criacaoRequestId, inputFingerprint: header.criacaoFingerprint } });
    if (!creationRevision) return null;
    const creationSnapshot = await this.revisaoHistoricaNoTx(tx, creationRevision);
    if (!creationSnapshot || !iguais(creationSnapshot, creationReceipt.revisao)
      || !await this.conferirAssinaturaDaRevisaoNoTx(tx, revisionOp, revisionReceipt, a.slug)
      || !await this.conferirAssinaturaDaRevisaoNoTx(tx, creationOp, creationReceipt, a.slug)) return null;
    return JSON.stringify({ op, dispatch, rev, header, revisionOp, creationOp, creationRevision });
  }

  private async revisaoHistoricaNoTx(tx: Prisma.TransactionClient, row: AgentLocalAgendaRevision) {
    const parsed = AgendaLocalRevisaoSchema.safeParse({ agendaId: row.agendaId, revisionId: row.id, numero: row.numero, estado: row.estado,
      snapshotHash: row.snapshotHash, configuracao: row.configuracaoSnapshot, motivo: row.motivo, criadaEm: row.criadaEm.toISOString() });
    if (!parsed.success) return null;
    const v = parsed.data, c = v.configuracao;
    if (c.orgId !== row.orgId || c.agentId !== row.agentId || c.agendaId !== row.agendaId || c.nome !== row.nome
      || (c.previstoPara === null ? row.previstoPara !== null : row.previstoPara === null || new Date(c.previstoPara).getTime() !== row.previstoPara.getTime())
      || c.pedido.pedido !== row.pedido
      || c.pedido.itemId !== row.itemId || c.pedido.versionId !== row.versionId || c.pedido.contentHash !== row.sourceHash
      || c.fonte.versao !== row.sourceVersionNumber || c.pedido.expectedItemVersion !== row.expectedItemVersion
      || c.fonte.itemId !== c.pedido.itemId || c.fonte.versionId !== c.pedido.versionId || c.fonte.contentHash !== c.pedido.contentHash
      || c.fonte.expectedItemVersion !== c.pedido.expectedItemVersion || c.procedimento.id !== row.sopId
      || c.procedimento.versao !== row.sopVersion || c.pedido.expectedSopVersion !== row.sopVersion
      || c.responsavelId !== row.responsavelId || c.modeloConfigurado !== row.modeloConfigurado
      || await this.hashAgendaNoTx(tx, c) !== row.snapshotHash) return null;
    return v;
  }

  private async conferirAssinaturaDaRevisaoNoTx(tx: Prisma.TransactionClient, op: AgentLocalOperation,
    recibo: AgendaLocalRecibo, slug: string): Promise<boolean> {
    if (!('revisao' in recibo)) return false;
    const v = recibo.revisao, c = v.configuracao;
    if (recibo.tipo === 'agenda_criar' ? v.numero !== 1 || recibo.anterior !== null || v.estado !== 'pausada'
      : !recibo.anterior || recibo.anterior.numero + 1 !== v.numero || recibo.anterior.revisionId === v.revisionId) return false;
    if (recibo.tipo === 'agenda_editar' && v.estado !== 'pausada') return false;
    const configuracao = { nome: c.nome, previstoPara: c.previstoPara, responsavelId: c.responsavelId,
      modeloConfiguradoEsperado: c.modeloConfigurado, pedido: c.pedido };
    const input = recibo.tipo === 'agenda_criar' ? { configuracao }
      : recibo.tipo === 'agenda_editar' ? { expectedAgendaVersion: recibo.anterior?.numero, configuracao }
        : { expectedAgendaVersion: recibo.anterior?.numero, estado: v.estado, motivo: v.motivo };
    const fingerprint = await this.hashAgendaNoTx(tx, { schemaVersion: 1, tipo: op.tipo, orgId: op.orgId, actorId: op.actorId,
      agentId: op.agentId, agentSlug: slug, requestId: op.requestId,
      ...(recibo.tipo === 'agenda_criar' ? {} : { agendaId: op.agendaId }), input });
    return fingerprint === op.inputFingerprint;
  }
}
