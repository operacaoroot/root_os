import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LEAD_ORIGENS_DA_PAUTA,
  type LeadDiferencaDaEntrada,
  type LeadEntradaInput,
  type LeadEntradaResposta,
  type LeadList,
  type LeadTrocaDeDonoInput,
  type UpdateLeadInput,
} from '@mktos/shared';
import { LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ModulosService } from '../tenants/modulos.service';
import {
  camposRecebidos,
  diferencaDaEntrada,
  eventoIdDaEntrada,
  hashDoPedido,
  leadIdDaEntrada,
  nomeDeReserva,
  type CamposDoLead,
} from './entrada-de-lead';

/** Quem pede a entrada: a empresa e as permissões vêm do token, nunca do corpo. */
export interface AtorDaEntrada {
  sub: string;
  orgId: string;
  permissions: string[];
}

const TIPO_DO_EVENTO_DE_ENTRADA = 'entrada';
const TIPO_DO_EVENTO_DE_DONO = 'dono';

function ehViolacaoDeUnico(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly modulos: ModulosService,
  ) {}

  async list(
    orgId: string,
    filter: { status?: string; period?: string },
  ): Promise<LeadList> {
    const where: Prisma.LeadWhereInput = { orgId };
    if (filter.status) where.status = filter.status as any;
    if (filter.period) {
      const d = new Date();
      if (filter.period === 'today') d.setHours(0, 0, 0, 0);
      if (filter.period === 'week') d.setDate(d.getDate() - 7);
      if (filter.period === 'month') d.setDate(d.getDate() - 30);
      where.enteredAt = { gte: d };
    }

    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { enteredAt: 'desc' },
        include: { source: true, campaign: true, owner: true },
        take: 200,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      items: rows.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        phone: l.phone,
        source: l.source?.name ?? null,
        campaign: l.campaign?.name ?? null,
        utmSource: l.utmSource,
        utmMedium: l.utmMedium,
        utmCampaign: l.utmCampaign,
        status: l.status,
        owner: l.owner?.name ?? null,
        score: l.score,
        enteredAt: l.enteredAt.toISOString(),
      })),
      total,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async getOne(orgId: string, id: string, permissions: string[] = []) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, orgId },
      include: {
        source: true,
        campaign: true,
        owner: { select: { id: true, name: true } },
        events: { orderBy: { occurredAt: 'desc' } },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    const entrada = [...lead.events].reverse().find((e) => e.type === TIPO_DO_EVENTO_DE_ENTRADA);
    const origem = (entrada?.payload as { origem?: { tipo: string; ref: string } } | null)?.origem ?? null;
    const avisos = await this.avisosDeMesmaPessoa(orgId, lead.id, origem, permissions);
    return { ...lead, origem, avisos };
  }

  /**
   * Possível mesma pessoa (E6): calculado na LEITURA, enquanto as linhas da
   * Pauta existirem. Nada é gravado no lead — guardar o HMAC aqui estenderia a
   * retenção que a MD9 limitou (14 dias; 90 com DM). Depois de expurgada a
   * linha do comentário, o aviso some junto, e é o esperado.
   */
  private async avisosDeMesmaPessoa(
    orgId: string,
    leadId: string,
    origem: { tipo: string; ref: string } | null,
    permissions: string[],
  ): Promise<{ possivelMesmaPessoa: string[] }> {
    const vazio = { possivelMesmaPessoa: [] as string[] };
    if (origem?.tipo !== 'pauta-comentario' || !permissions.includes('pauta.ver')) return vazio;
    if (!(await this.modulos.modulosDaOrg(orgId)).has('pauta')) return vazio;
    const meu = await this.prisma.comentarioComPalavra.findFirst({
      where: { id: origem.ref, orgId },
      select: { pessoaHmac: true },
    });
    if (!meu) return vazio;
    const outros = await this.prisma.comentarioComPalavra.findMany({
      where: { orgId, pessoaHmac: meu.pessoaHmac, id: { not: origem.ref } },
      select: { id: true },
      take: 50,
    });
    if (outros.length === 0) return vazio;
    const ids = outros.map((o) => leadIdDaEntrada(orgId, { tipo: 'pauta-comentario', ref: o.id }));
    const existentes = await this.prisma.lead.findMany({ where: { orgId, id: { in: ids, not: leadId } }, select: { id: true } });
    return { possivelMesmaPessoa: existentes.map((l) => l.id) };
  }

  async update(orgId: string, id: string, input: UpdateLeadInput, actorId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id, orgId } });
    if (!lead) throw new NotFoundException('Lead não encontrado');

    const data: Prisma.LeadUpdateInput = {};
    if (input.status !== undefined) data.status = input.status as LeadStatus;
    if (input.nextAction !== undefined) data.nextAction = input.nextAction;

    // registra a mudança de etapa na timeline do lead
    if (input.status !== undefined && input.status !== lead.status) {
      await this.prisma.leadEvent.create({
        data: { leadId: id, type: 'status_change', payload: { from: lead.status, to: input.status } },
      });
    }

    const updated = await this.prisma.lead.update({ where: { id }, data });
    await this.audit.log({
      orgId,
      actorId,
      action: 'lead.update',
      entityType: 'lead',
      entityId: id,
      before: { status: lead.status, nextAction: lead.nextAction },
      after: { status: updated.status, nextAction: updated.nextAction },
    });
    return { ok: true, status: updated.status, nextAction: updated.nextAction };
  }

  /**
   * A entrada idempotente de um lead (C-01/C-13). O id do lead é a origem, então
   * a chave primária é a trava: dois pedidos simultâneos criam UM lead, e o
   * perdedor (P2002) relê. O mesmo pedido de novo devolve `replayed` sem evento.
   * Mesma origem com conteúdo diferente nunca sobrescreve campo: grava um
   * `entrada` novo com o que chegou e devolve a diferença.
   */
  async entrada(ator: AtorDaEntrada, input: LeadEntradaInput): Promise<LeadEntradaResposta> {
    const { orgId } = ator;
    const daPauta = (LEAD_ORIGENS_DA_PAUTA as readonly string[]).includes(input.origem.tipo);
    if (daPauta) {
      // R1: quem lista várias permissões precisa de todas. A rota exige `leads.editar`; a Pauta soma `pauta.ver`.
      if (!ator.permissions.includes('pauta.ver')) throw new ForbiddenException('Permissão insuficiente');
      if (!(await this.modulos.modulosDaOrg(orgId)).has('pauta')) throw new NotFoundException('Não encontrado');
    }

    const leadId = leadIdDaEntrada(orgId, input.origem);
    const requestHash = hashDoPedido(input);
    const eventoId = eventoIdDaEntrada(orgId, leadId, requestHash);

    // Repetição do mesmo pedido: responde antes de resolver referência — a linha da Pauta pode já ter sido expurgada.
    const jaGravado = await this.prisma.leadEvent.findFirst({ where: { id: eventoId, leadId } });
    if (jaGravado) return { id: leadId, criado: false, replayed: true, diferenca: null, eventoId };

    const ref = await this.resolverReferencias(orgId, input);
    const nome = nomeDeReserva(input, ref.comentario);
    const recebidos = camposRecebidos(input, {
      nome,
      campaignId: ref.campaignId,
      sourceId: ref.sourceId,
      ownerId: ref.ownerId,
    });
    const chaveDoPedido = `${input.origem.tipo}:${input.origem.ref}`;
    const payloadBase = {
      origem: input.origem,
      chaveDoPedido,
      requestHash,
      ator: ator.sub,
      // Só o que sobrevive à expurgação da Pauta (E6): nunca o HMAC, o id da Meta nem o @.
      ...(ref.comentario
        ? {
            procedencia: {
              pecaId: ref.comentario.pecaId,
              palavra: ref.comentario.palavra,
              comentadoEm: ref.comentario.comentadoEm.toISOString(),
              usuarioCopiado: Boolean(input.incluirUsuario),
            },
          }
        : {}),
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.lead.create({
          data: {
            id: leadId,
            orgId,
            name: nome,
            email: recebidos.email,
            phone: recebidos.phone,
            campaignId: recebidos.campaignId,
            sourceId: recebidos.sourceId,
            ownerId: recebidos.ownerId,
            utmSource: recebidos.utmSource,
            utmMedium: recebidos.utmMedium,
            utmCampaign: recebidos.utmCampaign,
            utmContent: recebidos.utmContent,
            utmTerm: recebidos.utmTerm,
            landingPage: recebidos.landingPage,
            anonymousId: input.origem.tipo === 'pixel' ? input.origem.ref : undefined,
          },
        });
        await tx.leadEvent.create({
          data: { id: eventoId, leadId, type: TIPO_DO_EVENTO_DE_ENTRADA, payload: { ...payloadBase, criouLead: true } },
        });
        await tx.auditLog.create({
          data: {
            orgId,
            actorId: ator.sub,
            action: 'lead.entrada',
            entityType: 'lead',
            entityId: leadId,
            after: { origem: input.origem, eventoId, criouLead: true },
          },
        });
      });
      return { id: leadId, criado: true, replayed: false, diferenca: null, eventoId };
    } catch (erro) {
      if (!ehViolacaoDeUnico(erro)) throw erro;
    }

    // A chave primária acusou: o lead já existe (a perdedora da corrida, ou uma entrada anterior com outro conteúdo).
    const existente = await this.prisma.lead.findFirst({ where: { id: leadId, orgId } });
    if (!existente) throw new ConflictException('Conflito ao registrar a entrada; tente de novo');
    const atual: CamposDoLead = {
      name: existente.name,
      email: existente.email,
      phone: existente.phone,
      campaignId: existente.campaignId,
      sourceId: existente.sourceId,
      ownerId: existente.ownerId,
      utmSource: existente.utmSource,
      utmMedium: existente.utmMedium,
      utmCampaign: existente.utmCampaign,
      utmContent: existente.utmContent,
      utmTerm: existente.utmTerm,
      landingPage: existente.landingPage,
    };
    const diferenca: LeadDiferencaDaEntrada = diferencaDaEntrada(atual, recebidos);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.leadEvent.create({
          data: {
            id: eventoId,
            leadId,
            type: TIPO_DO_EVENTO_DE_ENTRADA,
            payload: { ...payloadBase, criouLead: false, diferenca } as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({
          data: {
            orgId,
            actorId: ator.sub,
            action: 'lead.entrada',
            entityType: 'lead',
            entityId: leadId,
            after: { origem: input.origem, eventoId, criouLead: false, campos: Object.keys(diferenca) },
          },
        });
      });
    } catch (erro) {
      // O mesmo pedido, simultâneo: o evento já foi gravado pela outra chamada.
      if (ehViolacaoDeUnico(erro)) return { id: leadId, criado: false, replayed: true, diferenca: null, eventoId };
      throw erro;
    }
    return {
      id: leadId,
      criado: false,
      replayed: false,
      diferenca: Object.keys(diferenca).length > 0 ? diferenca : null,
      eventoId,
    };
  }

  /** Toda referência do corpo é resolvida na empresa da sessão, com o mesmo 404 de um id inexistente (classe T3). */
  private async resolverReferencias(orgId: string, input: LeadEntradaInput) {
    const [campanha, origemDeLead, dono] = await Promise.all([
      input.campaignId ? this.prisma.campaign.findFirst({ where: { id: input.campaignId, orgId }, select: { id: true } }) : null,
      input.sourceKey ? this.prisma.leadSource.findFirst({ where: { key: input.sourceKey, orgId }, select: { id: true } }) : null,
      input.ownerId ? this.prisma.user.findFirst({ where: { id: input.ownerId, orgId, isActive: true }, select: { id: true } }) : null,
    ]);
    if (input.campaignId && !campanha) throw new NotFoundException('Campanha não encontrada');
    if (input.sourceKey && !origemDeLead) throw new NotFoundException('Origem não encontrada');
    if (input.ownerId && !dono) throw new NotFoundException('Usuário não encontrado');

    let comentario: { pecaId: string; palavra: string; comentadoEm: Date; usuario: string | null } | null = null;
    if (input.origem.tipo === 'pauta-comentario') {
      const c = await this.prisma.comentarioComPalavra.findFirst({
        where: { id: input.origem.ref, orgId },
        select: { pecaId: true, palavra: true, comentadoEm: true, usuario: true },
      });
      if (!c) throw new NotFoundException('Comentário não encontrado');
      if (input.incluirUsuario && !c.usuario) {
        throw new ConflictException('O @ de quem comentou já expirou; passe o lead sem ele');
      }
      comentario = c;
    }
    if (input.origem.tipo === 'pixel') {
      const visto = await this.prisma.pixelEvent.findFirst({ where: { orgId, anonymousId: input.origem.ref }, select: { id: true } });
      if (!visto) throw new NotFoundException('Visitante não encontrado');
    }

    return {
      campaignId: campanha?.id,
      sourceId: origemDeLead?.id,
      ownerId: dono?.id,
      comentario,
    };
  }

  /**
   * Troca de dono. Não é escrita sensível (`SensitiveWrite`), de propósito: dono
   * não muda a etapa nem o que o lead é, não dispara efeito fora do sistema e
   * se desfaz com a mesma rota. O que a aprovação daria — justificativa e rastro
   * — vem daqui: `motivo` opcional, evento `dono` na timeline e `AuditLog`
   * `lead.dono` com antes e depois (E26). Etapa e próxima ação seguem com
   * `x-approval-token`.
   */
  async trocarDono(orgId: string, id: string, input: LeadTrocaDeDonoInput, actorId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id, orgId }, select: { id: true, ownerId: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (input.ownerId) {
      const dono = await this.prisma.user.findFirst({ where: { id: input.ownerId, orgId, isActive: true }, select: { id: true } });
      if (!dono) throw new NotFoundException('Usuário não encontrado');
    }
    if (lead.ownerId === input.ownerId) return { ok: true, mudou: false, ownerId: lead.ownerId };

    await this.prisma.$transaction(async (tx) => {
      // Condicionada ao dono lido: duas trocas simultâneas não se sobrescrevem em silêncio.
      const r = await tx.lead.updateMany({ where: { id, orgId, ownerId: lead.ownerId }, data: { ownerId: input.ownerId } });
      if (r.count === 0) throw new ConflictException('O dono mudou enquanto você editava; recarregue');
      await tx.leadEvent.create({
        data: {
          leadId: id,
          type: TIPO_DO_EVENTO_DE_DONO,
          payload: { de: lead.ownerId, para: input.ownerId, motivo: input.motivo ?? null, ator: actorId },
        },
      });
      await tx.auditLog.create({
        data: {
          orgId,
          actorId,
          action: 'lead.dono',
          entityType: 'lead',
          entityId: id,
          before: { ownerId: lead.ownerId },
          after: { ownerId: input.ownerId, motivo: input.motivo ?? null },
        },
      });
    });
    return { ok: true, mudou: true, ownerId: input.ownerId };
  }
}
