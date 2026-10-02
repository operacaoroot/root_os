import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CODIGO_DECISAO_SUPERADA,
  LEAD_ORIGENS_DA_PAUTA,
  type LeadCondicoes,
  type LeadCondicoesLeitura,
  type LeadCondicoesMudaramCorpo,
  type LeadDecisaoInput,
  type LeadDecisaoResposta,
  type LeadDecisaoResumo,
  type LeadDecisaoSuperadaCorpo,
  type LeadDiferencaDaEntrada,
  type LeadEntradaInput,
  type LeadEntradaResposta,
  type LeadEvidencia,
  type LeadList,
  type LeadPropostaDocumento,
  type LeadPropostaLeitura,
  type LeadPropostaRegistroInput,
  type LeadPropostaResposta,
  type LeadPropostaResumo,
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
import {
  TIPOS_DE_DECISAO,
  TIPO_DO_EVENTO_DE_PROPOSTA,
  condicoesDoCard,
  decisaoMaisRecenteDasCondicoes,
  diferencaDasCondicoes,
  estadoDaProposta,
  eventoIdDaDecisao,
  eventoIdDaProposta,
  evidenciaParaORastro,
  hashDaEvidencia,
  hashDasCondicoes,
  hashDoRegistroDaProposta,
  mensagemDeDecisaoSuperada,
  motivoDeCondicoesInsuficientes,
  origemDoLink,
} from './proposta-comercial';

/** Quem pede a entrada: a empresa e as permissões vêm do token, nunca do corpo. */
export interface AtorDaEntrada {
  sub: string;
  orgId: string;
  permissions: string[];
}

const TIPO_DO_EVENTO_DE_ENTRADA = 'entrada';
const TIPO_DO_EVENTO_DE_DONO = 'dono';

/** Payloads dos eventos da proposta e da decisão (ROOT-49). As condições NÃO entram: só o hash delas. */
interface PayloadDaProposta {
  documento: LeadPropostaDocumento;
  cardId: string;
  condicoesHash: string;
  registroHash: string;
  ator: string;
}
interface PayloadDaDecisao {
  propostaEventoId: string;
  cardId: string;
  condicoesHash: string;
  evidencia: LeadEvidencia;
  evidenciaHash: string;
  motivo: string | null;
  ator: string;
}
interface EventoLido {
  id: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
}

function resumoDaProposta(ev: EventoLido): LeadPropostaResumo {
  const p = ev.payload as PayloadDaProposta;
  return { eventoId: ev.id, documento: p.documento, cardId: p.cardId, condicoesHash: p.condicoesHash, registradaEm: ev.occurredAt.toISOString(), ator: p.ator ?? null };
}

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

  // ---------- Proposta e aceite comercial (ROOT-49, C-03, P-b) ----------

  /** Aceite e proposta cruzam dois módulos (E15): o prefixo `leads` o gate já viu; o `trabalho` se confere aqui. */
  private async exigirTrabalho(orgId: string): Promise<void> {
    if (!(await this.modulos.modulosDaOrg(orgId)).has('trabalho')) throw new NotFoundException('Não encontrado');
  }

  private async exigirLead(orgId: string, id: string): Promise<void> {
    const lead = await this.prisma.lead.findFirst({ where: { id, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado');
  }

  /** A timeline que interessa à proposta, do mais antigo ao mais novo. */
  private eventosDaProposta(leadId: string): Promise<EventoLido[]> {
    return this.prisma.leadEvent.findMany({
      where: { leadId, type: { in: ['entrada', TIPO_DO_EVENTO_DE_PROPOSTA, ...TIPOS_DE_DECISAO] } },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, type: true, payload: true, occurredAt: true },
    });
  }

  /**
   * O card comercial do lead. Vale, nesta ordem: o `cardId` do pedido; o card da
   * última proposta; o card de origem `clickup` (o `externalId` do card é a
   * origem do lead). Card de outra empresa é 404, como um id que não existe.
   */
  private async resolverCard(orgId: string, eventos: EventoLido[], cardIdPedido?: string) {
    const selecao = {
      id: true,
      title: true,
      startDate: true,
      dueDate: true,
      values: { select: { fieldId: true, value: true, field: { select: { name: true, type: true } }, option: { select: { name: true } } } },
    } as const;
    if (cardIdPedido) {
      const card = await this.prisma.workTask.findFirst({ where: { id: cardIdPedido, orgId }, select: selecao });
      if (!card) throw new NotFoundException('Card não encontrado');
      return { card, motivo: null };
    }
    const ultimaProposta = [...eventos].reverse().find((e) => e.type === TIPO_DO_EVENTO_DE_PROPOSTA);
    if (ultimaProposta) {
      const cardId = (ultimaProposta.payload as PayloadDaProposta).cardId;
      const card = await this.prisma.workTask.findFirst({ where: { id: cardId, orgId }, select: selecao });
      if (card) return { card, motivo: null };
      return { card: null, motivo: 'O card da proposta não existe mais; informe o card e registre a proposta de novo' };
    }
    const entrada = eventos.find((e) => e.type === TIPO_DO_EVENTO_DE_ENTRADA);
    const origem = (entrada?.payload as { origem?: { tipo: string; ref: string } } | null)?.origem;
    if (origem?.tipo === 'clickup') {
      const card = await this.prisma.workTask.findFirst({ where: { orgId, externalId: origem.ref }, select: selecao });
      if (card) return { card, motivo: null };
      return { card: null, motivo: 'O card do ClickUp deste lead ainda não foi importado para o Trabalho' };
    }
    return { card: null, motivo: 'Este lead não tem card comercial ligado; informe o card da proposta' };
  }

  private condicoesDe(card: NonNullable<Awaited<ReturnType<LeadsService['resolverCard']>>['card']>): LeadCondicoes {
    return condicoesDoCard(
      card,
      card.values.map((v) => ({
        campoId: v.fieldId,
        campoNome: v.field.name,
        campoTipo: v.field.type,
        valor: v.value,
        opcao: v.option?.name ?? null,
      })),
    );
  }

  /** O estado e o que foi registrado. Não lê o card: `leads.ver` basta. */
  async lerProposta(orgId: string, id: string): Promise<LeadPropostaLeitura> {
    await this.exigirLead(orgId, id);
    const eventos = await this.eventosDaProposta(id);
    const estado = estadoDaProposta(eventos);
    const ultimaProposta = [...eventos].reverse().find((e) => e.type === TIPO_DO_EVENTO_DE_PROPOSTA);
    const proposta: LeadPropostaResumo | null = ultimaProposta ? resumoDaProposta(ultimaProposta) : null;
    let decisao: LeadDecisaoResumo | null = null;
    if (estado === 'aceite_registrado' || estado === 'recusa_registrada') {
      const tipo = estado === 'aceite_registrado' ? 'aceite' : 'recusa';
      const ev = [...eventos].reverse().find((e) => e.type === tipo)!;
      const p = ev.payload as PayloadDaDecisao;
      decisao = {
        eventoId: ev.id,
        decisao: tipo,
        propostaEventoId: p.propostaEventoId,
        condicoesHash: p.condicoesHash,
        evidencia: p.evidencia,
        motivo: p.motivo ?? null,
        registradaEm: ev.occurredAt.toISOString(),
        ator: p.ator ?? null,
      };
    }
    return { estado, proposta, decisao };
  }

  /** As condições do card, lidas agora e nunca guardadas. `leads.ver` + `tarefas.ver` (a rota confere). */
  async lerCondicoes(orgId: string, id: string, cardIdPedido?: string): Promise<LeadCondicoesLeitura> {
    await this.exigirTrabalho(orgId);
    await this.exigirLead(orgId, id);
    const eventos = await this.eventosDaProposta(id);
    const alvo = await this.resolverCard(orgId, eventos, cardIdPedido);
    if (!alvo.card) return { card: null, motivo: alvo.motivo, condicoes: null, hash: null, propostaVigente: null, propostaVigenteResumo: null };
    const condicoes = this.condicoesDe(alvo.card);
    const hash = hashDasCondicoes(condicoes);
    const propostas = eventos.filter((e) => e.type === TIPO_DO_EVENTO_DE_PROPOSTA);
    // O mesmo critério de `decidir`: vale a proposta mais recente feita com estas condições, não só a última registrada.
    const vigente = [...propostas].reverse().find((e) => {
      const p = e.payload as PayloadDaProposta;
      return p.condicoesHash === hash && p.cardId === condicoes.cardId;
    });
    return {
      card: { id: alvo.card.id, titulo: alvo.card.title },
      motivo: motivoDeCondicoesInsuficientes(condicoes),
      condicoes,
      hash,
      propostaVigente: propostas.length > 0 ? !!vigente : null,
      propostaVigenteResumo: vigente ? resumoDaProposta(vigente) : null,
    };
  }

  /**
   * Registra a proposta: o documento (link + sha256) e o hash das condições do
   * card NESTE instante. O mesmo documento nas mesmas condições é o mesmo
   * evento (`replayed`); condições novas são uma proposta nova. Não cria
   * `Contract` nem lançamento: a ponte para o Financeiro (C-04) é outro caminho.
   */
  async registrarProposta(ator: AtorDaEntrada, id: string, input: LeadPropostaRegistroInput): Promise<LeadPropostaResposta> {
    const { orgId } = ator;
    await this.exigirTrabalho(orgId);
    await this.exigirLead(orgId, id);
    const eventos = await this.eventosDaProposta(id);
    const alvo = await this.resolverCard(orgId, eventos, input.cardId);
    if (!alvo.card) throw new ConflictException(alvo.motivo);
    const condicoes = this.condicoesDe(alvo.card);
    const insuficiente = motivoDeCondicoesInsuficientes(condicoes);
    if (insuficiente) throw new ConflictException(insuficiente);
    const condicoesHash = hashDasCondicoes(condicoes);
    const registroHash = hashDoRegistroDaProposta({ documento: input.documento, cardId: alvo.card.id, condicoesHash });
    const eventoId = eventoIdDaProposta(orgId, id, registroHash);
    const resposta = (replayed: boolean): LeadPropostaResposta => ({ id, eventoId, replayed, cardId: alvo.card!.id, condicoesHash });

    if (await this.prisma.leadEvent.findFirst({ where: { id: eventoId, leadId: id }, select: { id: true } })) return resposta(true);
    const payload: PayloadDaProposta = { documento: input.documento, cardId: alvo.card.id, condicoesHash, registroHash, ator: ator.sub };
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.leadEvent.create({ data: { id: eventoId, leadId: id, type: TIPO_DO_EVENTO_DE_PROPOSTA, payload: payload as unknown as Prisma.InputJsonValue } });
        await tx.auditLog.create({
          data: {
            orgId,
            actorId: ator.sub,
            action: 'lead.proposta',
            entityType: 'lead',
            entityId: id,
            // Nível do RASTRO: ids e resumos. O endereço do documento fica só no evento (pode levar token de acesso).
            after: {
              eventoId,
              cardId: alvo.card!.id,
              condicoesHash,
              documento: { tipo: input.documento.tipo, sha256: input.documento.sha256, origem: origemDoLink(input.documento.url) },
            },
          },
        });
      });
    } catch (erro) {
      if (ehViolacaoDeUnico(erro)) return resposta(true);
      throw erro;
    }
    return resposta(false);
  }

  /**
   * Registra a decisão do cliente — aceite ou recusa — com a evidência e o hash
   * das condições que ele viu. Mover o card para "fechado" NÃO passa por aqui:
   * só esta rota grava `aceite`. Nada sai do OS (sem assinatura, cobrança ou
   * e-mail).
   *
   * O id do evento é `(lead, decisão, hash das condições)`: reenviar a mesma
   * decisão é no-op e responde antes de reler o card (se o card mudou depois,
   * a repetição segue sendo repetição) — desde que ela ainda seja a decisão mais
   * recente para estas condições. Se depois dela veio a outra (aceite, recusa,
   * aceite), a resposta é 409 `decisao_superada`, sem gravar. Decisão nova com hash que não é o do
   * card agora é 409 com a diferença, e só vale sobre uma proposta registrada
   * com essas mesmas condições.
   */
  async decidir(ator: AtorDaEntrada, id: string, input: LeadDecisaoInput): Promise<LeadDecisaoResposta> {
    const { orgId } = ator;
    if (input.condicoesVistas && hashDasCondicoes(input.condicoesVistas) !== input.condicoesHash) {
      throw new BadRequestException('condicoesVistas não corresponde ao condicoesHash enviado');
    }
    await this.exigirTrabalho(orgId);
    await this.exigirLead(orgId, id);
    const evidenciaHash = hashDaEvidencia(input.evidencia);
    const eventoId = eventoIdDaDecisao(orgId, id, input.decisao, input.condicoesHash);
    // A decisão pedida já existe. Se é a mais recente para estas condições, é repetição (200, nada gravado); se depois dela
    // veio a outra (aceite, recusa, aceite), repetir seria dizer "registrado" sobre algo que não vale mais: 409, nada gravado.
    const jaExiste = async (p: PayloadDaDecisao): Promise<LeadDecisaoResposta> => {
      const atual = decisaoMaisRecenteDasCondicoes(await this.eventosDaProposta(id), input.condicoesHash);
      if (atual && atual.eventoId !== eventoId) {
        const corpo: LeadDecisaoSuperadaCorpo = {
          code: CODIGO_DECISAO_SUPERADA,
          message: mensagemDeDecisaoSuperada(atual.decisao, atual.registradaEm),
          decisaoAtual: atual.decisao,
          eventoAtualId: atual.eventoId,
        };
        throw new ConflictException(corpo);
      }
      return {
        id,
        eventoId,
        decisao: input.decisao,
        replayed: true,
        evidenciaIgual: p.evidenciaHash === evidenciaHash,
        propostaEventoId: p.propostaEventoId,
        condicoesHash: input.condicoesHash,
      };
    };

    const jaGravado = await this.prisma.leadEvent.findFirst({ where: { id: eventoId, leadId: id }, select: { payload: true } });
    if (jaGravado) return jaExiste(jaGravado.payload as unknown as PayloadDaDecisao);

    const eventos = await this.eventosDaProposta(id);
    const propostas = eventos.filter((e) => e.type === TIPO_DO_EVENTO_DE_PROPOSTA);
    if (propostas.length === 0) throw new ConflictException('Registre a proposta antes de registrar o aceite ou a recusa');
    const alvo = await this.resolverCard(orgId, eventos);
    if (!alvo.card) throw new ConflictException(alvo.motivo);
    const atual = this.condicoesDe(alvo.card);
    const insuficiente = motivoDeCondicoesInsuficientes(atual);
    if (insuficiente) throw new ConflictException(insuficiente);
    const atualHash = hashDasCondicoes(atual);
    if (atualHash !== input.condicoesHash) {
      const corpo: LeadCondicoesMudaramCorpo = {
        message: 'As condições do card mudaram desde o que foi visto; releia as condições e registre de novo',
        atualHash,
        atual,
        diferenca: input.condicoesVistas ? diferencaDasCondicoes(input.condicoesVistas, atual) : null,
      };
      throw new ConflictException(corpo);
    }
    const proposta = [...propostas].reverse().find((e) => {
      const p = e.payload as PayloadDaProposta;
      return p.condicoesHash === atualHash && p.cardId === atual.cardId;
    });
    if (!proposta) {
      throw new ConflictException('A proposta registrada foi feita com outras condições; registre a proposta de novo antes da decisão');
    }

    const payload: PayloadDaDecisao = {
      propostaEventoId: proposta.id,
      cardId: atual.cardId,
      condicoesHash: atualHash,
      evidencia: input.evidencia,
      evidenciaHash,
      motivo: input.motivo ?? null,
      ator: ator.sub,
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.leadEvent.create({ data: { id: eventoId, leadId: id, type: input.decisao, payload: payload as unknown as Prisma.InputJsonValue } });
        await tx.auditLog.create({
          data: {
            orgId,
            actorId: ator.sub,
            action: `lead.${input.decisao}`,
            entityType: 'lead',
            entityId: id,
            // Nível do RASTRO: ids, hashes e o tipo da evidência — nunca o texto da mensagem nem o link inteiro.
            after: {
              eventoId,
              propostaEventoId: proposta.id,
              cardId: atual.cardId,
              condicoesHash: atualHash,
              evidencia: evidenciaParaORastro(input.evidencia),
              comMotivo: Boolean(input.motivo),
            },
          },
        });
      });
    } catch (erro) {
      if (!ehViolacaoDeUnico(erro)) throw erro;
      // A mesma decisão, simultânea: a outra chamada gravou primeiro.
      const gravado = await this.prisma.leadEvent.findFirst({ where: { id: eventoId, leadId: id }, select: { payload: true } });
      if (!gravado) throw new ConflictException('Conflito ao registrar a decisão; tente de novo');
      return jaExiste(gravado.payload as unknown as PayloadDaDecisao);
    }
    return {
      id,
      eventoId,
      decisao: input.decisao,
      replayed: false,
      evidenciaIgual: true,
      propostaEventoId: proposta.id,
      condicoesHash: atualHash,
    };
  }
}
