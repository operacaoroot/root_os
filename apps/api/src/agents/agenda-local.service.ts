import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type Agent, type ContextItem, type ContextItemVersion, type Sop, type AgentLocalAgendaRevision, type AgentLocalOperation } from '@prisma/client';
import { z } from 'zod';
import {
  AgentEstadoHumanoPainelSchema, AgendaLocalConfiguracaoSchema, AgendaLocalListaSchema, AgendaLocalPainelSchema,
  AgendaLocalReciboSchema, AgendaLocalRecuperacaoSchema, AgendaLocalRevisaoSchema,
  type AgentEstadoHumanoEscopo, type AgentEstadoHumanoMarca, type AgentEstadoHumanoBase,
  type AgendaLocalCriar, type AgendaLocalEditar, type AgendaLocalEstado, type AgendaLocalDisparar,
  type AgendaLocalRevisao, type AgendaLocalRecibo, type AgendaLocalRecuperacao, type AgendaLocalRecuperacaoConsulta, type AgendaLocalPainel,
  type ProcedimentoLocalPedido, type ProcedimentoLocalPainel, type ProcedimentoLocalExecucao,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventLogService, type PreparoEventoNoTx } from '../gateway/event-log.service';
import { contextoAtual } from '../common/contexto-execucao';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { consultaMovimentoPendente } from '../memory/contexto-movimento-namespace';
import { TRANSICOES } from './estado-do-agente';

export interface LeitoresAgendaNoTx {
  painelNoTx(tx: Prisma.TransactionClient, orgId: string, actorId: string, slug: string): Promise<ProcedimentoLocalPainel>;
  detalheNoTx(tx: Prisma.TransactionClient, orgId: string, actorId: string, slug: string, id: string): Promise<ProcedimentoLocalExecucao>;
  fonteNoTx(tx: Prisma.TransactionClient, orgId: string, actorId: string, pedido: ProcedimentoLocalPedido,
    anterior: Omit<AgendaLocalRevisao['configuracao']['fonte'], 'expectedItemVersion'> | undefined,
    modo: 'novo_efeito' | 'historico'): Promise<{ item: ContextItem; v: ContextItemVersion }>;
}
export type EscopoAgenda = AgentEstadoHumanoEscopo;
export type TipoOperacaoLocal = AgendaLocalRecuperacaoConsulta['tipoEsperado'];
export type ConfiguracaoAgenda = AgendaLocalCriar['configuracao'];
export type OrigemAgenda = { agendaId: string; revisionId: string; snapshotHash: string; numero: number };
const GATES = {
  LER: ['mcp.ver', 'obsidian.ver'], CONFIGURAR: ['automacoes.executar', 'admin.usuarios', 'mcp.ver', 'obsidian.ver'],
  EXECUTAR: ['mcp.ver', 'mcp.executar', 'admin.usuarios', 'obsidian.ver'], COMANDAR: ['admin.usuarios'],
};
const EVENTOS = { agenda_criar: 'agente.agenda.criada', agenda_editar: 'agente.agenda.editada', agenda_estado: 'agente.agenda.estado_alterado', agenda_disparar: 'agente.agenda.disparada' };
type Gate = keyof typeof GATES;
type AgenteSop = Agent & { sop: Sop | null };
type Lookup = { operation: AgentLocalOperation | null; sessions: Array<{ id: string; agentId: string; solicitanteId: string | null }> };
const slot = Symbol('orcamento-futuro');
type Arvore = null | string | number | boolean | { [slot]: number } | Arvore[] | { [key: string]: Arvore };
const futuro = (bytes: number): Arvore => ({ [slot]: bytes });
const UID = () => futuro(38); const HASH = () => futuro(66); const ISO = () => futuro(29);
const json = (valor: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(valor));
const arvore = (valor: unknown): Arvore => JSON.parse(JSON.stringify(valor));

@Injectable()
export class AgendaLocalService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly eventos: EventLogService) {}

  async hashNoTx(tx: Prisma.TransactionClient, value: unknown): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ hash: string }>>`SELECT encode(digest(public.app_json_canonico(${JSON.stringify(value)}::jsonb),'sha256'),'hex') AS hash`;
    if (rows.length !== 1 || !/^[a-f0-9]{64}$/.test(rows[0].hash)) throw new ConflictException('A assinatura da operação não pôde ser conferida.');
    return rows[0].hash;
  }

  async conferirTamanhoNoTx(tx: Prisma.TransactionClient, value: unknown) {
    const text = JSON.stringify(value);
    const rows = await tx.$queryRaw<Array<{ bytes: number }>>`SELECT octet_length(${text}::jsonb::text)::int AS bytes`;
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0].bytes)) throw new ConflictException('O tamanho do registro não pôde ser conferido.');
    if (Buffer.byteLength(text, 'utf8') > 65536 || rows[0].bytes > 65536) throw new BadRequestException('O registro ultrapassa 64 KiB. Revise o pedido antes de enviar.');
  }

  // A árvore é um orçamento privado. Slots de bytes não são DTOs nem provas.
  async orcamentoNoTx(tx: Prisma.TransactionClient, trees: Arvore[]) {
    const strings = new Set<string>();
    const listar = (v: Arvore): void => {
      if (typeof v === 'string') { strings.add(v); return; }
      if (v === null || typeof v !== 'object' || slot in v) return;
      if (Array.isArray(v)) { v.forEach(listar); return; }
      Object.entries(v).forEach(([k, x]) => { strings.add(k); listar(x); });
    };
    trees.forEach(listar);
    const rows = await tx.$queryRaw<Array<{ value: string; bytes: number }>>`SELECT value,octet_length(to_jsonb(value)::text)::int AS bytes FROM jsonb_array_elements_text(${JSON.stringify([...strings])}::jsonb) AS value`;
    const sizes = new Map(rows.map((r) => [r.value, Math.max(r.bytes, Buffer.byteLength(JSON.stringify(r.value), 'utf8'))]));
    const medir = (v: Arvore): number => {
      if (v === null) return 4;
      if (typeof v === 'string') { const n = sizes.get(v); if (n === undefined) throw new ConflictException('Orçamento não conferido.'); return n; }
      if (typeof v !== 'object') return Buffer.byteLength(JSON.stringify(v), 'utf8');
      if (slot in v) return v[slot];
      if (Array.isArray(v)) return 2 + v.reduce((a, x) => a + medir(x), 0) + Math.max(0, v.length - 1) * 2;
      const entries = Object.entries(v);
      return 2 + entries.reduce((a, [k, x]) => a + medir(k) + 2 + medir(x), 0) + Math.max(0, entries.length - 1) * 2;
    };
    if (trees.some((t) => medir(t) > 65536)) throw new BadRequestException('O registro ultrapassaria 64 KiB. Revise o pedido antes de enviar.');
  }

  async travarClaimNoTx(tx: Prisma.TransactionClient, orgId: string, requestId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`procedimento:${orgId}:${requestId}`}))`;
  }
  async lookupNoTx(tx: Prisma.TransactionClient, orgId: string, requestId: string): Promise<Lookup> {
    const operation = await tx.agentLocalOperation.findFirst({ where: { orgId, requestId } });
    const sessions = await tx.session.findMany({ where: { orgId, canal: 'web', canalRef: `procedimento-local:${requestId}` },
      take: 2, select: { id: true, agentId: true, solicitanteId: true } });
    if (sessions.length > 1) throw new ConflictException('O pedido não pôde ser conferido.');
    if (operation && (operation.tipo === 'agenda_disparar'
      ? sessions.length !== 1 || sessions[0].id !== operation.sessionId || sessions[0].agentId !== operation.agentId || sessions[0].solicitanteId !== operation.actorId
      : sessions.length !== 0)) throw new ConflictException('A causa do pedido não pôde ser conferida.');
    return { operation, sessions };
  }
  async exigirPedidoDiretoNoTx(tx: Prisma.TransactionClient, orgId: string, requestId: string) {
    const look = await this.lookupNoTx(tx, orgId, requestId);
    if (look.operation) throw new ConflictException('O pedido pertence a outra operação local.');
  }
  conferirCausa(look: Lookup, scope: EscopoAgenda, requestId: string, tipo: TipoOperacaoLocal, fingerprint?: string, agendaId?: string) {
    const op = look.operation;
    if (!op) { if (look.sessions.length) throw new ConflictException('O pedido pertence a outra operação local.'); return null; }
    if (op.orgId !== scope.orgId || op.actorId !== scope.actorId || op.agentId !== scope.agentId || op.requestId !== requestId
      || op.tipo !== tipo || fingerprint !== undefined && op.inputFingerprint !== fingerprint || agendaId !== undefined && op.agendaId !== agendaId)
      throw new ConflictException('O pedido pertence a outra operação, conteúdo ou pessoa.');
    return op;
  }

  async travarAutoridadeHumanaNoTx(tx: Prisma.TransactionClient, orgId: string, actorId: string, operacao: Gate) {
    const ctx = contextoAtual();
    if (!ctx || ctx.actorType !== 'user' || ctx.orgId !== orgId || ctx.actorId !== actorId) throw new ForbiddenException('Acesso insuficiente.');
    const orgs = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Org" WHERE id=${orgId} AND "isActive" FOR SHARE`;
    const pessoas = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id=${actorId} AND "orgId"=${orgId} AND "isActive" ORDER BY id FOR SHARE`;
    if (orgs.length !== 1 || pessoas.length !== 1) throw new ForbiddenException('Acesso insuficiente.');
    const joins = await tx.$queryRaw<Array<{ roleId: string }>>`SELECT ur."A" AS "roleId" FROM "_UserRoles" ur JOIN "Role" r ON r.id=ur."A"
      WHERE ur."B"=${actorId} AND r."orgId"=${orgId} ORDER BY ur."A",ur."B" FOR SHARE OF ur`;
    const roles = [...new Set(joins.map((r) => r.roleId))].sort();
    if (!roles.length) throw new ForbiddenException('Acesso insuficiente.');
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Role" WHERE "orgId"=${orgId} AND id IN (${Prisma.join(roles)}) ORDER BY id FOR SHARE`;
    if (locked.length !== roles.length) throw new ForbiddenException('Acesso insuficiente.');
    const grants = await tx.$queryRaw<Array<{ permissionId: string }>>`SELECT rp."A" AS "permissionId" FROM "_RolePermissions" rp
      WHERE rp."B" IN (${Prisma.join(roles)}) ORDER BY rp."B",rp."A" FOR SHARE OF rp`;
    const ids = [...new Set(grants.map((g) => g.permissionId))].sort();
    if (!ids.length) throw new ForbiddenException('Acesso insuficiente.');
    const permissions = await tx.$queryRaw<Array<{ id: string; key: string }>>`SELECT id,key FROM "Permission" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
    if (permissions.length !== ids.length || !GATES[operacao].every((p) => permissions.some((x) => x.key === p))) throw new ForbiddenException('Acesso insuficiente.');
    await exigirAcessoAtual(tx, orgId, actorId, GATES[operacao]);
  }

  async travarAgenteNoTx(tx: Prisma.TransactionClient, orgId: string, slug: string, escrita = true): Promise<AgenteSop> {
    if (escrita) await tx.$queryRaw`SELECT id FROM "Agent" WHERE "orgId"=${orgId} AND slug=${slug} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Agent" WHERE "orgId"=${orgId} AND slug=${slug} FOR SHARE`;
    const identity = await tx.agent.findFirst({ where: { orgId, slug }, select: { id: true } });
    if (!identity) throw new NotFoundException('Agente indisponível.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-sop:${orgId}:${identity.id}`}))`;
    await tx.$queryRaw`SELECT id FROM "Sop" WHERE "orgId"=${orgId} AND "agentId"=${identity.id} FOR SHARE`;
    const a = await tx.agent.findFirst({ where: { id: identity.id, orgId, slug }, include: { sop: true } });
    if (!a || a.sop && (a.sop.orgId !== orgId || a.sop.agentId !== a.id)) throw new ConflictException('O agente e o procedimento não puderam ser conferidos.');
    return a;
  }
  escopo(orgId: string, actorId: string, a: Pick<Agent, 'id' | 'slug'>): EscopoAgenda {
    return { orgId, actorId, agentId: a.id, agentSlug: a.slug };
  }
  base(a: Agent): AgentEstadoHumanoBase {
    return { estado: a.estado, ativo: a.ativo, donoId: a.donoId, estadoPorId: a.estadoPorId,
      estadoEm: a.estadoEm?.toISOString() ?? null, estadoMotivo: a.estadoMotivo, atualizadoEm: a.atualizadoEm.toISOString() };
  }
  async marcaNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, a: Agent): Promise<AgentEstadoHumanoMarca> {
    const base = this.base(a); return { escopo: scope, base, marca: await this.hashNoTx(tx, { escopo: scope, base }) };
  }
  async assinaturaNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, requestId: string, tipo: TipoOperacaoLocal, input: unknown, extras?: Record<string, unknown>) {
    return this.hashNoTx(tx, { schemaVersion: 1, tipo, orgId: scope.orgId, actorId: scope.actorId,
      agentId: scope.agentId, agentSlug: scope.agentSlug, requestId, ...extras, input });
  }
  async preparar(tipo: Exclude<TipoOperacaoLocal, 'agente_estado'>) {
    return this.eventos.prepararContextoParaTx({ orgId: contextoAtual()?.orgId ?? '', tipo: EVENTOS[tipo], nivel: null });
  }
  async configuracao(orgId: string, actorId: string, slug: string) {
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.CONFIGURAR);
    return this.prisma.$transaction(async (tx) => {
      const a = await this.travarAgenteNoTx(tx, orgId, slug, false);
      await this.travarAutoridadeHumanaNoTx(tx, orgId, actorId, 'CONFIGURAR');
      const pessoas = await tx.user.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
      await exigirAcessoAtual(tx, orgId, actorId, GATES.CONFIGURAR);
      return AgendaLocalConfiguracaoSchema.parse({ escopo: this.escopo(orgId, actorId, a), pessoas });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async estadoHumano(orgId: string, actorId: string, slug: string) {
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.COMANDAR);
    return this.prisma.$transaction(async (tx) => {
      const a = await this.travarAgenteNoTx(tx, orgId, slug, false);
      await this.travarAutoridadeHumanaNoTx(tx, orgId, actorId, 'COMANDAR');
      const result = AgentEstadoHumanoPainelSchema.parse({ ...await this.marcaNoTx(tx, this.escopo(orgId, actorId, a), a),
        autoridade: { comandar: true, verificadaEm: new Date().toISOString() }, transicoes: [...TRANSICOES[a.estado]] });
      await this.conferirTamanhoNoTx(tx, result); await exigirAcessoAtual(tx, orgId, actorId, GATES.COMANDAR); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async ultimaNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, agendaId: string) {
    await tx.$queryRaw`SELECT id FROM "AgentLocalAgenda" WHERE id=${agendaId} AND "orgId"=${scope.orgId} AND "agentId"=${scope.agentId} FOR UPDATE`;
    const header = await tx.agentLocalAgenda.findFirst({ where: { id: agendaId, orgId: scope.orgId, agentId: scope.agentId } });
    if (!header) throw new NotFoundException('Agenda indisponível.');
    const row = await tx.agentLocalAgendaRevision.findFirst({ where: { agendaId, orgId: scope.orgId, agentId: scope.agentId }, orderBy: { numero: 'desc' } });
    if (!row) throw new ConflictException('A revisão da agenda não pôde ser conferida.');
    return row;
  }
  async revisaoNoTx(tx: Prisma.TransactionClient, row: AgentLocalAgendaRevision): Promise<AgendaLocalRevisao> {
    const v = AgendaLocalRevisaoSchema.parse({ agendaId: row.agendaId, revisionId: row.id, numero: row.numero, estado: row.estado,
      snapshotHash: row.snapshotHash, configuracao: row.configuracaoSnapshot, motivo: row.motivo, criadaEm: row.criadaEm.toISOString() });
    const c = v.configuracao;
    if (c.orgId !== row.orgId || c.agentId !== row.agentId || c.agendaId !== row.agendaId || c.pedido.pedido !== row.pedido
      || c.pedido.itemId !== row.itemId || c.pedido.versionId !== row.versionId || c.pedido.contentHash !== row.sourceHash
      || c.fonte.versao !== row.sourceVersionNumber || c.pedido.expectedItemVersion !== row.expectedItemVersion || c.procedimento.id !== row.sopId
      || c.procedimento.versao !== row.sopVersion || c.pedido.expectedSopVersion !== row.sopVersion || c.responsavelId !== row.responsavelId
      || c.modeloConfigurado !== row.modeloConfigurado || await this.hashNoTx(tx, c) !== row.snapshotHash)
      throw new ConflictException('A revisão da agenda não pôde ser conferida.');
    return v;
  }
  async disponibilidadeNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, a: Agent,
    revision: AgendaLocalRevisao | null, leitores?: LeitoresAgendaNoTx) {
    let fonte: AgendaLocalPainel['disponibilidadeAtual']['fonte'] = null;
    let modelo: AgendaLocalPainel['disponibilidadeAtual']['modelo'] = null;
    if (revision) {
      if (!leitores) throw new ConflictException('O leitor da agenda não foi conferido.');
      const cfg = revision.configuracao;
      const { item, v } = await leitores.fonteNoTx(tx, scope.orgId, scope.actorId,
        { requestId: randomUUID(), ...cfg.pedido }, cfg.fonte, 'historico');
      const pendente = await consultaMovimentoPendente(tx, scope.orgId, item.id);
      fonte = { legivel: true as const, arquivada: !!item.arquivadoEm, versaoAtual: item.versao,
        novoUsoPermitido: !pendente && !item.arquivadoEm && item.versao === cfg.pedido.expectedItemVersion
          && item.chave === cfg.fonte.chave && item.sourceType === v.sourceType && item.sourceRef === v.sourceRef };
      modelo = (await leitores.painelNoTx(tx, scope.orgId, scope.actorId, scope.agentSlug)).modelo;
    }
    return { verificadaEm: new Date().toISOString(), agente: this.base(a), agenda: revision
      ? { revisionId: revision.revisionId, numero: revision.numero, estado: revision.estado } : null,
      fonte, modelo, automatico: false as const };
  }
  async painelNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, a: Agent, row: AgentLocalAgendaRevision, leitores: LeitoresAgendaNoTx) {
    const revisao = await this.revisaoNoTx(tx, row);
    const last = await tx.agentLocalAgendaDispatch.findFirst({ where: { orgId: scope.orgId, agendaId: row.agendaId }, orderBy: [{ criadaEm: 'desc' }, { id: 'desc' }], include: { session: true } });
    const result = AgendaLocalPainelSchema.parse({ escopo: scope, agendaId: row.agendaId, revisao,
      painelLocal: await leitores.painelNoTx(tx, scope.orgId, scope.actorId, scope.agentSlug), automatico: false,
      ultimoDisparo: last ? { requestId: last.requestId, dispatchId: last.id, sessionId: last.sessionId, status: last.session.status, encerradaEm: last.session.encerradaEm?.toISOString() ?? null } : null,
      disponibilidadeAtual: await this.disponibilidadeNoTx(tx, scope, a, revisao, leitores) });
    await this.conferirTamanhoNoTx(tx, result); return result;
  }
  private async cabecalhoLegivelNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, agendaId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; criadaEm: Date }>>`SELECT h.id,h."criadaEm" FROM "AgentLocalAgenda" h
      JOIN LATERAL (SELECT r."itemId" FROM "AgentLocalAgendaRevision" r WHERE r."orgId"=h."orgId" AND r."agendaId"=h.id AND r."agentId"=h."agentId" ORDER BY r.numero DESC LIMIT 1) r ON true
      JOIN "ContextItem" c ON c.id=r."itemId" AND c."orgId"=h."orgId"
      WHERE h.id=${agendaId} AND h."orgId"=${scope.orgId} AND h."agentId"=${scope.agentId}
        AND (NOT c."acessoRestrito" OR ${scope.actorId}=ANY(c.leitores))`;
    // Ausência, outro escopo e fonte ilegível têm a mesma recusa.
    if (rows.length !== 1) throw new NotFoundException('Agenda indisponível.');
    return rows[0];
  }
  async listar(orgId: string, actorId: string, slug: string, leitores: LeitoresAgendaNoTx, cursorId?: string) {
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.LER);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const a = await this.travarAgenteNoTx(tx, orgId, slug, false); const scope = this.escopo(orgId, actorId, a);
      await this.travarAutoridadeHumanaNoTx(tx, orgId, actorId, 'LER');
      let cursor: { id: string; criadaEm: Date } | null = null;
      if (cursorId) {
        cursor = await this.cabecalhoLegivelNoTx(tx, scope, cursorId);
      }
      // ACL do item da última revisão é aplicada antes do LIMIT e do lookahead.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT h.id FROM "AgentLocalAgenda" h
        JOIN LATERAL (SELECT r."itemId" FROM "AgentLocalAgendaRevision" r WHERE r."orgId"=h."orgId" AND r."agendaId"=h.id AND r."agentId"=h."agentId" ORDER BY r.numero DESC LIMIT 1) r ON true
        JOIN "ContextItem" c ON c.id=r."itemId" AND c."orgId"=h."orgId"
        WHERE h."orgId"=${orgId} AND h."agentId"=${a.id} AND (NOT c."acessoRestrito" OR ${actorId}=ANY(c.leitores))
          AND (${cursor === null} OR (h."criadaEm",h.id)>(${cursor?.criadaEm ?? new Date(0)},${cursor?.id ?? ''}))
        ORDER BY h."criadaEm" ASC,h.id ASC LIMIT 51`;
      const items: AgendaLocalPainel[] = [];
      for (const h of rows.slice(0, 50)) items.push(await this.painelNoTx(tx, scope, a, await this.ultimaNoTx(tx, scope, h.id), leitores));
      await exigirAcessoAtual(tx, orgId, actorId, GATES.LER);
      return AgendaLocalListaSchema.parse({ escopo: scope, items, automatico: false, proximoId: rows.length > 50 ? rows[49].id : null });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async obter(orgId: string, actorId: string, slug: string, agendaId: string, leitores: LeitoresAgendaNoTx) {
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.LER);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const a = await this.travarAgenteNoTx(tx, orgId, slug, false); const scope = this.escopo(orgId, actorId, a);
      await this.travarAutoridadeHumanaNoTx(tx, orgId, actorId, 'LER');
      await this.cabecalhoLegivelNoTx(tx, scope, agendaId);
      const result = await this.painelNoTx(tx, scope, a, await this.ultimaNoTx(tx, scope, agendaId), leitores);
      await exigirAcessoAtual(tx, orgId, actorId, GATES.LER); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async recebidoNoTx(tx: Prisma.TransactionClient, op: AgentLocalOperation): Promise<AgendaLocalRecibo> {
    const r = AgendaLocalReciboSchema.parse(op.receipt);
    if (r.operationId !== op.id || r.requestId !== op.requestId || r.tipo !== op.tipo || r.escopo.orgId !== op.orgId || r.escopo.actorId !== op.actorId
      || r.escopo.agentId !== op.agentId || r.confirmadoEm !== op.criadaEm.toISOString() || JSON.stringify(r.auditIds) !== JSON.stringify(op.auditIds)
      || await this.hashNoTx(tx, r.eventSnapshot) !== await this.hashNoTx(tx, op.eventSnapshot) || await this.hashNoTx(tx, r) !== op.receiptHash)
      throw new ConflictException('O recibo da operação não pôde ser conferido.');
    if ('revisao' in r) {
      const row = await tx.agentLocalAgendaRevision.findFirst({ where: { id: op.revisionId ?? '', orgId: op.orgId, agentId: op.agentId, agendaId: op.agendaId ?? '' } });
      if (!row || row.requestId !== op.requestId || row.actorId !== op.actorId || row.tipo !== op.tipo || row.inputFingerprint !== op.inputFingerprint
        || await this.hashNoTx(tx, await this.revisaoNoTx(tx, row)) !== await this.hashNoTx(tx, r.revisao)) throw new ConflictException('A causa da revisão não pôde ser conferida.');
    } else if (r.tipo === 'agenda_disparar') {
      const d = await tx.agentLocalAgendaDispatch.findFirst({ where: { id: r.dispatchId, orgId: op.orgId, actorId: op.actorId, requestId: op.requestId, sessionId: r.sessionId,
        agendaId: r.agendaId, revisionId: r.revisionId, agentId: op.agentId, inputFingerprint: op.inputFingerprint } });
      const rev = await tx.agentLocalAgendaRevision.findFirst({ where: { id: r.revisionId, orgId: op.orgId, agendaId: r.agendaId, agentId: op.agentId } });
      if (!d || !rev || r.sessionId !== op.sessionId || r.dispatchId !== op.dispatchId || r.agendaId !== op.agendaId || r.revisionId !== op.revisionId
        || rev.numero !== r.agendaVersion || rev.snapshotHash !== r.snapshotHash || JSON.stringify(r.entradaConfirmada) !== JSON.stringify({ requestId: r.requestId, ...((await this.revisaoNoTx(tx, rev)).configuracao.pedido) }))
        throw new ConflictException('A causa do disparo não pôde ser conferida.');
    } else if (await this.hashNoTx(tx, { escopo: r.anterior.escopo, base: r.anterior.base }) !== r.marcaAnterior
      || await this.hashNoTx(tx, { escopo: r.posterior.escopo, base: r.posterior.base }) !== r.marcaNova) throw new ConflictException('As marcas da operação não puderam ser conferidas.');
    await this.conferirTamanhoNoTx(tx, r); return r;
  }
  async recuperarNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, a: Agent, op: AgentLocalOperation, leitores?: LeitoresAgendaNoTx): Promise<AgendaLocalRecuperacao> {
    const recibo = await this.recebidoNoTx(tx, op);
    if (recibo.escopo.agentSlug !== scope.agentSlug) throw new ConflictException('O agente da operação mudou.');
    let current: AgendaLocalRevisao | null = null;
    if (op.agendaId) current = await this.revisaoNoTx(tx, await this.ultimaNoTx(tx, scope, op.agendaId));
    // A revisão consumida também continua sob ACL, mesmo após uma edição posterior.
    if ('revisao' in recibo && leitores) await leitores.fonteNoTx(tx, scope.orgId, scope.actorId,
      { requestId: op.requestId, ...recibo.revisao.configuracao.pedido }, recibo.revisao.configuracao.fonte, 'historico');
    const disponibilidadeAtual = await this.disponibilidadeNoTx(tx, scope, a, current, leitores);
    const comum = { estado: 'confirmado' as const, escopo: scope, requestId: op.requestId, tipo: recibo.tipo, recibo, disponibilidadeAtual };
    if (recibo.tipo === 'agenda_disparar') {
      if (!leitores) throw new ConflictException('O leitor da execução não foi conferido.');
      return AgendaLocalRecuperacaoSchema.parse({ ...comum, execucao: await leitores.detalheNoTx(tx, scope.orgId, scope.actorId, scope.agentSlug, recibo.sessionId) });
    }
    return AgendaLocalRecuperacaoSchema.parse(comum);
  }
  async porOperacao(orgId: string, actorId: string, slug: string, requestId: string, tipoEsperado: TipoOperacaoLocal, agendaId?: string, leitores?: LeitoresAgendaNoTx) {
    if (!z.string().uuid().safeParse(requestId).success) throw new BadRequestException('Pedido inválido.');
    const gate: Gate = tipoEsperado === 'agente_estado' ? 'COMANDAR' : 'LER';
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES[gate]);
    return this.prisma.$transaction(async (tx) => {
      await this.travarClaimNoTx(tx, orgId, requestId); const look = await this.lookupNoTx(tx, orgId, requestId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const a = await this.travarAgenteNoTx(tx, orgId, slug, false); const scope = this.escopo(orgId, actorId, a);
      const op = this.conferirCausa(look, scope, requestId, tipoEsperado, undefined, agendaId);
      const absenceGate: Gate = tipoEsperado === 'agente_estado' ? 'COMANDAR' : tipoEsperado === 'agenda_disparar' ? 'EXECUTAR' : 'CONFIGURAR';
      await this.travarAutoridadeHumanaNoTx(tx, orgId, actorId, op ? gate : absenceGate);
      if (!op) {
        await exigirAcessoAtual(tx, orgId, actorId, GATES[absenceGate]);
        return AgendaLocalRecuperacaoSchema.parse({ estado: 'ausencia_conferida', escopo: scope, requestId, observadoEm: new Date().toISOString(), cancelaPedido: false, conservaRequestId: true });
      }
      const result = await this.recuperarNoTx(tx, scope, a, op, leitores);
      await exigirAcessoAtual(tx, orgId, actorId, GATES[gate]); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async conferirConfiguracaoNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, a: AgenteSop, cfg: ConfiguracaoAgenda, leitores: LeitoresAgendaNoTx) {
    if (!a.sop || a.sop.versao !== cfg.pedido.expectedSopVersion || a.modelo !== cfg.modeloConfiguradoEsperado || a.donoId !== cfg.responsavelId)
      throw new ConflictException('O procedimento, o responsável ou o modelo mudou. Confira antes de enviar.');
    await tx.$queryRaw`SELECT id FROM "User" WHERE "orgId"=${scope.orgId} AND id=${cfg.responsavelId} FOR SHARE`;
    if (!await tx.user.findFirst({ where: { orgId: scope.orgId, id: cfg.responsavelId, isActive: true }, select: { id: true } })) throw new ConflictException('Responsável indisponível nesta empresa.');
    const { item, v } = await leitores.fonteNoTx(tx, scope.orgId, scope.actorId, { requestId: randomUUID(), ...cfg.pedido }, undefined, 'novo_efeito');
    return { sop: a.sop, item, v };
  }
  snapshot(scope: EscopoAgenda, agendaId: string, cfg: ConfiguracaoAgenda, reais: { sop: Sop; item: ContextItem; v: ContextItemVersion }): AgendaLocalRevisao['configuracao'] {
    const { sop, item, v } = reais;
    return { schemaVersion: 1, orgId: scope.orgId, agentId: scope.agentId, agendaId, nome: cfg.nome, previstoPara: cfg.previstoPara,
      responsavelId: cfg.responsavelId, modeloConfigurado: cfg.modeloConfiguradoEsperado, pedido: cfg.pedido,
      procedimento: { id: sop.id, versao: sop.versao, proposito: sop.proposito, gatilho: sop.gatilho, passos: sop.passos,
        definicaoDePronto: sop.definicaoDePronto, observacoes: sop.observacoes, atualizadoPor: sop.atualizadoPor, atualizadoEm: sop.atualizadoEm.toISOString() },
      fonte: { itemId: item.id, versionId: v.id, versao: v.versao, contentHash: v.contentHash, expectedItemVersion: cfg.pedido.expectedItemVersion,
        chave: item.chave, sourceType: v.sourceType, sourceRef: v.sourceRef, title: v.title }, ferramenta: 'contexto.memoria.buscar', automatico: false };
  }
  private comumOrcamento(scope: EscopoAgenda, requestId: string, count = 1): { [key: string]: Arvore } {
    return { schemaVersion: 1, escopo: arvore(scope), requestId, operationId: UID(), confirmadoEm: ISO(), auditIds: Array.from({ length: count }, UID),
      eventSnapshot: Array.from({ length: count }, () => ({ id: UID(), seq: futuro(21), hash: HASH(), tipo: futuro(100), ocorreuEm: ISO() })) };
  }
  async orcamentoRevisaoNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, requestId: string, cfg: AgendaLocalRevisao['configuracao'], numero: number, anterior: AgendaLocalRevisao | null, painel: ProcedimentoLocalPainel, a: Agent) {
    AgendaLocalRevisaoSchema.shape.configuracao.parse(cfg);
    await this.conferirTamanhoNoTx(tx, cfg);
    const revision: Arvore = { agendaId: cfg.agendaId, revisionId: UID(), numero, estado: futuro(20), snapshotHash: HASH(), configuracao: arvore(cfg), motivo: futuro(3002), criadaEm: ISO() };
    const receipt: Arvore = { ...this.comumOrcamento(scope, requestId), tipo: futuro(20), revisao: revision,
      anterior: { revisionId: UID(), numero: futuro(16), estado: futuro(20) } };
    const disponibilidade: Arvore = { verificadaEm: ISO(), agente: arvore(this.base(a)),
      agenda: { revisionId: UID(), numero, estado: futuro(20) }, fonte: { legivel: true, arquivada: false, novoUsoPermitido: true, versaoAtual: cfg.pedido.expectedItemVersion }, modelo: arvore(painel.modelo), automatico: false };
    await this.orcamentoNoTx(tx, [arvore(cfg), receipt, { escopo: arvore(scope), agendaId: cfg.agendaId, revisao: revision, painelLocal: arvore(painel), automatico: false,
      ultimoDisparo: { requestId: UID(), dispatchId: UID(), sessionId: UID(), status: futuro(20), encerradaEm: ISO() }, disponibilidadeAtual: disponibilidade }]);
  }
  async emitirNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, tipo: Exclude<TipoOperacaoLocal, 'agente_estado'>, entityId: string, requestId: string, preparo: PreparoEventoNoTx) {
    const audit = await this.audit.logComRecibo({ orgId: scope.orgId, actorId: scope.actorId, action: `agent.${tipo}`, entityType: 'agent_local_agenda', entityId, metadata: { requestId, tipo, agentId: scope.agentId } }, tx);
    const e = await this.eventos.registrarNoTx(tx, { orgId: scope.orgId, tipo: EVENTOS[tipo], actorId: scope.actorId, actorType: 'user', agentSlug: scope.agentSlug, correlationId: requestId,
      payload: { agendaId: entityId, requestId, agentId: scope.agentId, automatico: false } }, preparo);
    return { auditIds: [audit.id], eventSnapshot: [{ id: e.id, seq: e.seq.toString(), hash: e.hash, tipo: EVENTOS[tipo], ocorreuEm: e.ocorreuEm.toISOString() }] };
  }
  async gravarOperacaoNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, assinatura: string, receipt: AgendaLocalRecibo) {
    AgendaLocalReciboSchema.parse(receipt); await this.conferirTamanhoNoTx(tx, receipt);
    if (receipt.escopo.orgId !== scope.orgId || receipt.escopo.actorId !== scope.actorId || receipt.escopo.agentId !== scope.agentId || receipt.escopo.agentSlug !== scope.agentSlug)
      throw new ConflictException('O escopo do recibo não pôde ser conferido.');
    const refs = receipt.tipo === 'agente_estado' ? {} : 'revisao' in receipt
      ? { agendaId: receipt.revisao.agendaId, revisionId: receipt.revisao.revisionId }
      : { agendaId: receipt.agendaId, revisionId: receipt.revisionId, sessionId: receipt.sessionId, dispatchId: receipt.dispatchId };
    return tx.agentLocalOperation.create({ data: { id: receipt.operationId, orgId: scope.orgId, actorId: scope.actorId, agentId: scope.agentId,
      requestId: receipt.requestId, tipo: receipt.tipo, inputFingerprint: assinatura, ...refs, receipt: json(receipt), receiptHash: await this.hashNoTx(tx, receipt),
      auditIds: receipt.auditIds, eventSnapshot: json(receipt.eventSnapshot), criadaEm: new Date(receipt.confirmadoEm) } });
  }
  async registrarRevisaoNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, requestId: string,
    tipo: 'agenda_criar' | 'agenda_editar' | 'agenda_estado', assinatura: string, cfg: AgendaLocalRevisao['configuracao'], anterior: AgendaLocalRevisao | null,
    estado: AgendaLocalRevisao['estado'], motivo: string | null, preparo: PreparoEventoNoTx) {
    const criadaEm = new Date(); const operationId = randomUUID(); const id = randomUUID(); const c = cfg;
    if (tipo === 'agenda_criar') await tx.agentLocalAgenda.create({ data: { id: c.agendaId, orgId: scope.orgId, agentId: scope.agentId,
      criadaPorId: scope.actorId, criacaoRequestId: requestId, criacaoFingerprint: assinatura, criadaEm } });
    const row = await tx.agentLocalAgendaRevision.create({ data: { id, orgId: scope.orgId, agendaId: c.agendaId, agentId: scope.agentId, numero: (anterior?.numero ?? 0) + 1,
      estado, tipo, nome: c.nome, previstoPara: c.previstoPara ? new Date(c.previstoPara) : null, pedido: c.pedido.pedido, itemId: c.fonte.itemId, versionId: c.fonte.versionId,
      sourceVersionNumber: c.fonte.versao, sourceHash: c.fonte.contentHash, expectedItemVersion: c.fonte.expectedItemVersion,
      sopId: c.procedimento.id, sopVersion: c.procedimento.versao, responsavelId: c.responsavelId, modeloConfigurado: c.modeloConfigurado,
      configuracaoSnapshot: json(c), snapshotHash: await this.hashNoTx(tx, c), motivo, actorId: scope.actorId, requestId, inputFingerprint: assinatura, criadaEm } });
    const events = await this.emitirNoTx(tx, scope, tipo, c.agendaId, requestId, preparo);
    const receipt = AgendaLocalReciboSchema.parse({ schemaVersion: 1, escopo: scope, requestId, operationId, confirmadoEm: criadaEm.toISOString(), tipo,
      revisao: await this.revisaoNoTx(tx, row), anterior: anterior ? { revisionId: anterior.revisionId, numero: anterior.numero, estado: anterior.estado } : null, ...events });
    return this.gravarOperacaoNoTx(tx, scope, assinatura, receipt);
  }
  async conferirFonteHistoricaDaAgendaNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda,
    revision: AgendaLocalRevisao, requestId: string, leitores: LeitoresAgendaNoTx): Promise<void> {
    const cfg = revision.configuracao;
    try {
      await leitores.fonteNoTx(tx, scope.orgId, scope.actorId, { requestId, ...cfg.pedido }, cfg.fonte, 'historico');
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof NotFoundException) throw new NotFoundException('Agenda indisponível.');
      throw e;
    }
  }
  async configurar(orgId: string, actorId: string, slug: string, input: AgendaLocalCriar | AgendaLocalEditar, leitores: LeitoresAgendaNoTx, agendaId?: string) {
    const tipo = agendaId ? 'agenda_editar' : 'agenda_criar';
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.CONFIGURAR); const preparo = await this.preparar(tipo);
    const id = agendaId ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await this.travarClaimNoTx(tx, orgId, input.requestId); const look = await this.lookupNoTx(tx, orgId, input.requestId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const a = await this.travarAgenteNoTx(tx, orgId, slug); const scope = this.escopo(orgId, actorId, a);
      const signature = await this.assinaturaNoTx(tx, scope, input.requestId, tipo, agendaId
        ? { expectedAgendaVersion: 'expectedAgendaVersion' in input ? input.expectedAgendaVersion : null, configuracao: input.configuracao }
        : { configuracao: input.configuracao }, agendaId ? { agendaId } : undefined);
      const existing = this.conferirCausa(look, scope, input.requestId, tipo, signature, agendaId);
      await this.travarAutoridadeHumanaNoTx(tx, orgId, actorId, 'CONFIGURAR');
      if (existing) return this.recuperarNoTx(tx, scope, a, existing, leitores);
      const previous = agendaId ? await this.revisaoNoTx(tx, await this.ultimaNoTx(tx, scope, agendaId)) : null;
      if (previous) await this.conferirFonteHistoricaDaAgendaNoTx(tx, scope, previous, input.requestId, leitores);
      if (previous && (!('expectedAgendaVersion' in input) || previous.numero !== input.expectedAgendaVersion || previous.estado === 'encerrada')) throw new ConflictException('A agenda mudou ou foi encerrada. Confira a revisão escolhida.');
      const reais = await this.conferirConfiguracaoNoTx(tx, scope, a, input.configuracao, leitores);
      const cfg = this.snapshot(scope, id, input.configuracao, reais);
      await this.orcamentoRevisaoNoTx(tx, scope, input.requestId, cfg, (previous?.numero ?? 0) + 1, previous, await leitores.painelNoTx(tx, orgId, actorId, slug), a);
      const op = await this.registrarRevisaoNoTx(tx, scope, input.requestId, tipo, signature, cfg, previous, 'pausada', null, preparo);
      const result = await this.recuperarNoTx(tx, scope, a, op, leitores);
      await this.painelNoTx(tx, scope, a, await this.ultimaNoTx(tx, scope, id), leitores);
      await exigirAcessoAtual(tx, orgId, actorId, GATES.CONFIGURAR); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async definirEstado(orgId: string, actorId: string, slug: string, agendaId: string, input: AgendaLocalEstado, leitores: LeitoresAgendaNoTx) {
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.CONFIGURAR); const preparo = await this.preparar('agenda_estado');
    return this.prisma.$transaction(async (tx) => {
      await this.travarClaimNoTx(tx, orgId, input.requestId); const look = await this.lookupNoTx(tx, orgId, input.requestId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const a = await this.travarAgenteNoTx(tx, orgId, slug); const scope = this.escopo(orgId, actorId, a);
      const signature = await this.assinaturaNoTx(tx, scope, input.requestId, 'agenda_estado', { expectedAgendaVersion: input.expectedAgendaVersion, estado: input.estado, motivo: input.motivo }, { agendaId });
      const existing = this.conferirCausa(look, scope, input.requestId, 'agenda_estado', signature, agendaId);
      await this.travarAutoridadeHumanaNoTx(tx, orgId, actorId, 'CONFIGURAR');
      if (existing) return this.recuperarNoTx(tx, scope, a, existing, leitores);
      const previous = await this.revisaoNoTx(tx, await this.ultimaNoTx(tx, scope, agendaId));
      const cfg = previous.configuracao;
      await this.conferirFonteHistoricaDaAgendaNoTx(tx, scope, previous, input.requestId, leitores);
      if (previous.numero !== input.expectedAgendaVersion || previous.estado === 'encerrada' || previous.estado === input.estado) throw new ConflictException('A agenda mudou, foi encerrada ou já está nesse estado.');
      if (input.estado === 'encerrada' && !input.motivo) throw new BadRequestException('Informe o motivo para encerrar a agenda.');
      await this.orcamentoRevisaoNoTx(tx, scope, input.requestId, cfg, previous.numero + 1, previous, await leitores.painelNoTx(tx, orgId, actorId, slug), a);
      const op = await this.registrarRevisaoNoTx(tx, scope, input.requestId, 'agenda_estado', signature, cfg, previous, input.estado, input.motivo, preparo);
      const result = await this.recuperarNoTx(tx, scope, a, op, leitores);
      await this.painelNoTx(tx, scope, a, await this.ultimaNoTx(tx, scope, agendaId), leitores);
      await exigirAcessoAtual(tx, orgId, actorId, GATES.CONFIGURAR); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async conferirAgendaParaNovoEfeitoNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, origem: OrigemAgenda) {
    const latest = await this.ultimaNoTx(tx, scope, origem.agendaId);
    const revision = await this.revisaoNoTx(tx, latest);
    if (revision.revisionId !== origem.revisionId || revision.snapshotHash !== origem.snapshotHash || revision.numero !== origem.numero || revision.estado !== 'habilitada_manual')
      throw new ConflictException('A agenda mudou ou foi pausada antes do novo efeito.');
    return revision;
  }
  async conferirDisparoNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, revision: AgendaLocalRevisao, input: AgendaLocalDisparar) {
    if (revision.numero !== input.expectedAgendaVersion || revision.configuracao.procedimento.versao !== input.expectedSopVersion || revision.estado !== 'habilitada_manual') throw new ConflictException('A agenda ou o procedimento mudou.');
    const pending = await tx.agentLocalAgendaDispatch.findMany({ where: { orgId: scope.orgId, agendaId: revision.agendaId }, include: { session: true } });
    if (pending.some((d) => !['respondida', 'executada', 'recusada', 'falhou'].includes(d.session.status) || !d.session.encerradaEm || !Number.isFinite(d.session.encerradaEm.getTime())))
      throw new ConflictException('A agenda possui um disparo ainda não encerrado. Recupere o pedido antes de criar outro.');
  }
  async orcamentoDisparoNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, revision: AgendaLocalRevisao, pedido: ProcedimentoLocalPedido, painel: ProcedimentoLocalPainel, a: Agent) {
    const receipt: Arvore = { ...this.comumOrcamento(scope, pedido.requestId), tipo: 'agenda_disparar', agendaId: revision.agendaId, revisionId: revision.revisionId,
      agendaVersion: revision.numero, snapshotHash: revision.snapshotHash, dispatchId: UID(), sessionId: UID(), entradaConfirmada: arvore(pedido), estadoNoCompromisso: 'rodando' };
    await this.orcamentoNoTx(tx, [receipt, arvore(revision.configuracao), { escopo: arvore(scope), agendaId: revision.agendaId, revisao: arvore(revision), painelLocal: arvore(painel), automatico: false,
      ultimoDisparo: { requestId: pedido.requestId, dispatchId: UID(), sessionId: UID(), status: 'rodando', encerradaEm: null }, disponibilidadeAtual: {
        verificadaEm: ISO(), agente: arvore(this.base(a)),
        agenda: { revisionId: revision.revisionId, numero: revision.numero, estado: revision.estado }, fonte: { legivel: true, arquivada: false, novoUsoPermitido: true, versaoAtual: pedido.expectedItemVersion }, modelo: arvore(painel.modelo), automatico: false } }]);
  }
  async registrarDispatchNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, revision: AgendaLocalRevisao, pedido: ProcedimentoLocalPedido, sessionId: string, signature: string, preparo: PreparoEventoNoTx) {
    const createdAt = new Date(); const id = randomUUID(); const operationId = randomUUID();
    await tx.agentLocalAgendaDispatch.create({ data: { id, orgId: scope.orgId, agendaId: revision.agendaId, agentId: scope.agentId, revisionId: revision.revisionId,
      actorId: scope.actorId, requestId: pedido.requestId, inputFingerprint: signature, sessionId, criadaEm: createdAt } });
    const events = await this.emitirNoTx(tx, scope, 'agenda_disparar', revision.agendaId, pedido.requestId, preparo);
    const receipt = AgendaLocalReciboSchema.parse({ schemaVersion: 1, escopo: scope, requestId: pedido.requestId, operationId, confirmadoEm: createdAt.toISOString(),
      tipo: 'agenda_disparar', agendaId: revision.agendaId, revisionId: revision.revisionId, agendaVersion: revision.numero,
      snapshotHash: revision.snapshotHash, dispatchId: id, sessionId, entradaConfirmada: pedido, estadoNoCompromisso: 'rodando', ...events });
    return this.gravarOperacaoNoTx(tx, scope, signature, receipt);
  }
  async orcamentoEstadoHumanoNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, requestId: string, anterior: AgentEstadoHumanoMarca, tarefas: Array<{ id: string; title: string; desde: Date | null }>, novo: Pick<AgentEstadoHumanoBase, 'estado' | 'ativo' | 'estadoMotivo'>) {
    if (tarefas.length + 1 > 500) throw new BadRequestException('A operação possui mais de 500 registros. Nenhuma tarefa foi solta.');
    const posterior: { [key: string]: Arvore } = { escopo: arvore(scope), base: { estado: novo.estado, ativo: novo.ativo, donoId: anterior.base.donoId, estadoPorId: scope.actorId, estadoEm: ISO(), estadoMotivo: novo.estadoMotivo, atualizadoEm: ISO() }, marca: HASH() };
    const receipt: Arvore = { ...this.comumOrcamento(scope, requestId, tarefas.length + 1), tipo: 'agente_estado', marcaAnterior: anterior.marca, marcaNova: HASH(), anterior: arvore(anterior), posterior,
      tarefasSoltas: tarefas.map((t) => ({ id: t.id, titulo: t.title, desde: t.desde?.toISOString() ?? null })) };
    await this.orcamentoNoTx(tx, [receipt, { ...posterior, autoridade: { comandar: true, verificadaEm: ISO() }, transicoes: [futuro(20), futuro(20), futuro(20), futuro(20)] }]);
  }
  async registrarOperacaoDeEstadoDoAgenteNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, signature: string, receipt: AgendaLocalRecibo) {
    if (receipt.tipo !== 'agente_estado') throw new ConflictException('A causa do estado não pôde ser conferida.');
    return this.gravarOperacaoNoTx(tx, scope, signature, receipt);
  }
}
