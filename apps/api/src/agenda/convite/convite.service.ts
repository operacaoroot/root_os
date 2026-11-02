import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  SOCIOS_DA_AGENDA,
  type ConfirmacaoDoConvite,
  type EstadoDoConvitePublico,
  type NovoConviteDeAgenda,
  type SocioDaAgenda,
} from '@mktos/shared';
import { ActorType, type AgendaConvite } from '@prisma/client';

import { comTenantPublico } from '../../common/tenant-publico';
import { PrismaService } from '../../prisma/prisma.service';
import { EscritaDaAgendaService, chaveDerivada } from '../escrita/escrita.service';
import { eventoIdDaChave } from '../escrita/escrita-pura';
import { ReguaService } from '../regua/regua.service';
import {
  conviteAbre,
  diaEmSaoPaulo,
  empresaDoToken,
  gerarTokenDoConvite,
  hashDoConvite,
  icsDoConvite,
  instanteEmSaoPaulo,
  horarioReservado,
  nomeDigitadoParaTitulo,
  pedidoDoConviteCaiu,
  primeiroNome,
  semHorariosReservados,
  type ReservaDeConvite,
  somarDias,
  validadeDoConvite,
} from './convite-puro';

/*
 * O LINK DE ESCOLHA (agenda v2, 29/10/2026, lane G6).
 *
 * Quem é da casa cria um convite (`POST /agenda/convites`) e manda o link ao
 * cliente; o cliente abre `/agendar/<token>` sem login, vê SÓ horários verdes da
 * régua (`ReguaService.livres`, próximos 14 dias: nenhum título, nenhum nome de
 * outro cliente) e confirma um. Confirmar marca o convite como usado numa
 * escrita condicionada (dois cliques = um uso) e pede o `marcar` pela porta como
 * SISTEMA (`link-de-escolha`), SEM `naTela`: R2 fica na fila, e é a confirmação
 * de uma pessoa da casa que solta o convite do Google para o cliente.
 *
 * Token errado, vencido, revogado ou usado sem escolha respondem o MESMO 404.
 * A empresa sai do token e o resto roda dentro dela (`comTenantPublico`); ver
 * `convite-puro.ts` sobre por que a empresa viaja no token.
 */

const NAO_ENCONTRADO = 'link não encontrado.';
const DIAS_DO_LINK = 14;
export const AGENTE_DO_LINK = 'link-de-escolha';

const NovoConviteSchema = z.object({
  socio: z.enum(SOCIOS_DA_AGENDA as unknown as [SocioDaAgenda, ...SocioDaAgenda[]]),
  tipo: z.enum(['cliente', 'interna']),
  modalidade: z.enum(['online', 'presencial']),
  duracaoMin: z.number().int().min(5).max(600),
  leadId: z.string().min(1).max(64).optional(),
  clienteId: z.string().min(1).max(64).optional(),
  validadeDias: z.number().int().min(1).max(30).optional(),
}).strict();

const ConfirmacaoSchema = z.object({
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  nome: z.string().trim().max(120).optional(),
}).strict();

export interface ConviteDaLista {
  id: string;
  socio: string;
  tipo: string;
  modalidade: string;
  duracaoMin: number;
  nome: string | null;
  leadId: string | null;
  clienteId: string | null;
  validoAte: string;
  criadoEm: string;
  usadoEm: string | null;
  escolhido: { inicio: string; fim: string } | null;
  approvalId: string | null;
  eventoId: string | null;
  revogadoEm: string | null;
  /** `pedido_vencido`: escolhido, mas a aprovação do `marcar` venceu, foi recusada ou sumiu (A1); o link volta a aceitar escolha. */
  estado: 'aberto' | 'escolhido' | 'pedido_vencido' | 'vencido' | 'revogado';
}

/** As ações de auditoria do convite (M3). Nenhuma leva o token nem o hash. */
export const AUDITORIA_CONVITE_CRIADO = 'agenda.convite.criar';
export const AUDITORIA_CONVITE_REVOGADO = 'agenda.convite.revogar';
/** A ação de auditoria de quando o pedido do link cai e o convite volta a aceitar escolha. */
export const AUDITORIA_PEDIDO_CAIU = 'agenda.convite.pedido_caiu';

export interface RespostaDaConfirmacao extends EstadoDoConvitePublico {
  mensagem: string;
}

/** A base do link público (a mesma da sala do cliente). */
export function baseDoLinkDeEscolha(): string {
  return (process.env.PUBLIC_BASE_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
}

@Injectable()
export class ConviteDaAgendaService {
  private readonly log = new Logger('LinkDeEscolha');

  constructor(
    private readonly prisma: PrismaService,
    private readonly regua: ReguaService,
    private readonly escrita: EscritaDaAgendaService,
  ) {}

  /* -------------------------------------------------------------------------
   * Dentro da casa
   * ----------------------------------------------------------------------- */

  async criar(orgId: string, criadoPorId: string, corpo: NovoConviteDeAgenda | unknown, agora = new Date()): Promise<{ id: string; url: string; validoAte: string }> {
    const lido = NovoConviteSchema.safeParse(corpo);
    if (!lido.success) {
      throw new BadRequestException({ message: 'Convite inválido.', erros: lido.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    const c = lido.data;
    let nome: string | null = null;
    if (c.leadId) {
      const lead = await this.prisma.lead.findFirst({ where: { id: c.leadId, orgId }, select: { name: true } });
      if (!lead) throw new BadRequestException('Esse lead não existe nesta empresa.');
      nome = primeiroNome(lead.name);
    }
    if (c.clienteId) {
      const cliente = await this.prisma.partner.findFirst({ where: { id: c.clienteId, orgId }, select: { id: true } });
      if (!cliente) throw new BadRequestException('Esse cliente não existe nesta empresa.');
    }
    const { token, hash } = gerarTokenDoConvite(orgId);
    const validoAte = validadeDoConvite(agora, c.validadeDias);
    // O convite e a auditoria na mesma transação (M3). Nem o token nem o hash entram na auditoria.
    const criado = await this.prisma.$transaction(async (tx) => {
      const linha = await tx.agendaConvite.create({
        data: {
          orgId,
          tokenHash: hash,
          socio: c.socio,
          tipo: c.tipo,
          modalidade: c.modalidade,
          duracaoMin: c.duracaoMin,
          leadId: c.leadId ?? null,
          clienteId: c.clienteId ?? null,
          nome,
          validoAte,
          criadoPorId,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          orgId,
          actorType: ActorType.user,
          actorId: criadoPorId,
          action: AUDITORIA_CONVITE_CRIADO,
          entityType: 'agenda_convite',
          entityId: linha.id,
          after: {
            socio: c.socio,
            tipo: c.tipo,
            modalidade: c.modalidade,
            duracaoMin: c.duracaoMin,
            leadId: c.leadId ?? null,
            clienteId: c.clienteId ?? null,
            validoAte: validoAte.toISOString(),
          },
          metadata: { origem: 'agenda.convite' },
        },
      });
      return linha;
    });
    // O token cru sai SÓ nesta resposta: o banco guarda o hash.
    return { id: criado.id, url: `${baseDoLinkDeEscolha()}/agendar/${token}`, validoAte: validoAte.toISOString() };
  }

  async listar(orgId: string, agora = new Date()): Promise<ConviteDaLista[]> {
    const linhas = await this.prisma.agendaConvite.findMany({ where: { orgId }, orderBy: { criadoEm: 'desc' }, take: 100 });
    const caidos = await this.pedidosCaidos(orgId, linhas, agora);
    return linhas.map((c) => ({
      id: c.id,
      socio: c.socio,
      tipo: c.tipo,
      modalidade: c.modalidade,
      duracaoMin: c.duracaoMin,
      nome: c.nome,
      leadId: c.leadId,
      clienteId: c.clienteId,
      validoAte: c.validoAte.toISOString(),
      criadoEm: c.criadoEm.toISOString(),
      usadoEm: c.usadoEm?.toISOString() ?? null,
      escolhido: c.escolhidoInicio && c.escolhidoFim ? { inicio: c.escolhidoInicio.toISOString(), fim: c.escolhidoFim.toISOString() } : null,
      approvalId: c.approvalId,
      eventoId: c.eventoId,
      revogadoEm: c.revogadoEm?.toISOString() ?? null,
      estado: c.revogadoEm
        ? 'revogado'
        : caidos.has(c.id)
          ? 'pedido_vencido'
          : c.escolhidoInicio
            ? 'escolhido'
            : c.validoAte <= agora
              ? 'vencido'
              : 'aberto',
    }));
  }

  /** Revoga um convite ainda sem escolha. O link passa a responder 404. Auditado com quem revogou (M3). */
  async revogar(orgId: string, id: string, agora = new Date(), revogadoPorId: string | null = null): Promise<{ ok: true }> {
    const ok = await this.prisma.$transaction(async (tx) => {
      const r = await tx.agendaConvite.updateMany({
        where: { id, orgId, revogadoEm: null, usadoEm: null },
        data: { revogadoEm: agora },
      });
      if (r.count === 0) return false;
      const c = await tx.agendaConvite.findFirst({ where: { id, orgId }, select: { socio: true, validoAte: true, criadoPorId: true } });
      await tx.auditLog.create({
        data: {
          orgId,
          actorType: ActorType.user,
          actorId: revogadoPorId,
          action: AUDITORIA_CONVITE_REVOGADO,
          entityType: 'agenda_convite',
          entityId: id,
          before: { revogadoEm: null },
          after: { revogadoEm: agora.toISOString() },
          metadata: { origem: 'agenda.convite', socio: c?.socio ?? null, validoAte: c?.validoAte.toISOString() ?? null, criadoPorId: c?.criadoPorId ?? null },
        },
      });
      return true;
    });
    if (!ok) throw new ConflictException('Esse convite já foi usado, revogado ou não existe.');
    return { ok: true };
  }

  /* -------------------------------------------------------------------------
   * A página pública
   * ----------------------------------------------------------------------- */

  /** A empresa do token e o convite, dentro dela. Qualquer falha é o MESMO 404. */
  private async resolver(token: string, agora: Date): Promise<{ orgId: string; convite: AgendaConvite }> {
    const orgId = empresaDoToken(token);
    if (!orgId) throw new NotFoundException(NAO_ENCONTRADO);
    const hash = hashDoConvite(token);
    const convite = await comTenantPublico(orgId, () =>
      this.prisma.agendaConvite.findFirst({ where: { tokenHash: hash, orgId } }),
    ).catch(() => null);
    if (!convite || convite.orgId !== orgId || !conviteAbre(convite, agora)) throw new NotFoundException(NAO_ENCONTRADO);
    return { orgId, convite };
  }

  private async diasLivres(orgId: string, c: AgendaConvite, agora: Date) {
    const hoje = diaEmSaoPaulo(agora);
    const [dias, reservas] = await Promise.all([this.diasDaRegua(orgId, c, agora, hoje), this.reservasDeOutros(orgId, c, agora)]);
    return semHorariosReservados(dias, reservas, c.duracaoMin);
  }

  private async diasDaRegua(orgId: string, c: AgendaConvite, agora: Date, hoje: string) {
    return this.regua.livres(
      orgId,
      {
        socio: c.socio as SocioDaAgenda,
        tipo: c.tipo === 'interna' ? 'interna' : 'cliente',
        modalidade: c.modalidade === 'presencial' ? 'presencial' : 'online',
        duracaoMin: c.duracaoMin,
        de: hoje,
        ate: somarDias(hoje, DIAS_DO_LINK),
      },
      agora,
    );
  }

  private estadoDe(c: AgendaConvite, dias: EstadoDoConvitePublico['dias']): EstadoDoConvitePublico {
    return {
      socio: c.socio as SocioDaAgenda,
      modalidade: c.modalidade === 'presencial' ? 'presencial' : 'online',
      duracaoMin: c.duracaoMin,
      nome: c.nome,
      emailObrigatorio: c.modalidade !== 'presencial',
      dias,
      validoAte: c.validoAte.toISOString(),
      escolhido: c.escolhidoInicio && c.escolhidoFim ? { inicio: c.escolhidoInicio.toISOString(), fim: c.escolhidoFim.toISOString() } : null,
    };
  }

  /* -------------------------------------------------------------------------
   * O pedido que caiu (A1)
   * ----------------------------------------------------------------------- */

  /**
   * Os convites (desta lista) cujo pedido caiu: escolhidos, com `approvalId`,
   * a aprovação recusada, expirada, sumida ou vencida sem execução, e o evento
   * que não nasceu no espelho. Só lê.
   */
  private async pedidosCaidos(orgId: string, convites: AgendaConvite[], agora: Date): Promise<Set<string>> {
    const candidatos = convites.filter((c) => !c.revogadoEm && c.usadoEm && c.escolhidoInicio && c.approvalId);
    if (!candidatos.length) return new Set();
    const [aprovacoes, nascidos] = await Promise.all([
      this.prisma.approval.findMany({
        where: { orgId, id: { in: candidatos.map((c) => c.approvalId as string) } },
        select: { id: true, status: true, expiraEm: true, capabilityId: true },
      }),
      this.eventosNascidos(orgId, candidatos),
    ]);
    const porId = new Map(aprovacoes.map((a) => [a.id, a]));
    return new Set(
      candidatos
        .filter((c) => !(c.eventoId && nascidos.has(c.eventoId)))
        .filter((c) => pedidoDoConviteCaiu(c, porId.get(c.approvalId as string) ?? null, agora))
        .map((c) => c.id),
    );
  }

  /** Os `eventoId` destes convites que já estão no espelho (o evento nasceu). */
  private async eventosNascidos(orgId: string, convites: AgendaConvite[]): Promise<Set<string>> {
    const ids = convites.map((c) => c.eventoId).filter((x): x is string => !!x);
    if (!ids.length) return new Set();
    const eventos = await this.prisma.agendaEvento.findMany({ where: { orgId, googleId: { in: ids } }, select: { googleId: true } });
    return new Set(eventos.map((e) => e.googleId));
  }

  /**
   * Os horários que OUTROS convites do mesmo sócio já pediram e que ainda
   * esperam (M2): escolhidos, não revogados, com o pedido vivo (ou ainda a
   * caminho da porta) e o evento que ainda não nasceu no espelho. O evento que
   * nasceu já está na régua; o pedido que caiu não reserva nada.
   */
  private async reservasDeOutros(orgId: string, c: AgendaConvite, agora: Date, db: Pick<PrismaService, 'agendaConvite'> = this.prisma): Promise<ReservaDeConvite[]> {
    const outros = await db.agendaConvite.findMany({
      where: {
        orgId,
        socio: c.socio,
        id: { not: c.id },
        revogadoEm: null,
        usadoEm: { not: null },
        escolhidoInicio: { not: null },
        escolhidoFim: { gt: agora },
      },
      orderBy: { escolhidoInicio: 'asc' },
      take: 500,
    });
    if (!outros.length) return [];
    const [caidos, nascidos] = await Promise.all([this.pedidosCaidos(orgId, outros, agora), this.eventosNascidos(orgId, outros)]);
    return outros
      .filter((o) => !caidos.has(o.id) && !(o.eventoId && nascidos.has(o.eventoId)))
      .map((o) => ({ inicio: o.escolhidoInicio as Date, fim: o.escolhidoFim as Date }));
  }

  /**
   * Se o pedido do convite caiu, devolve o convite a "aberto" numa escrita
   * condicionada ao estado lido (duas abas ao mesmo tempo = uma reabertura) e
   * grava a auditoria na mesma transação. Roda dentro da empresa.
   */
  private async reabrirSeCaiu(orgId: string, c: AgendaConvite, agora: Date): Promise<{ convite: AgendaConvite; reaberto: boolean }> {
    const caidos = await this.pedidosCaidos(orgId, [c], agora);
    if (!caidos.has(c.id)) return { convite: c, reaberto: false };
    const reaberto = await this.prisma.$transaction(async (tx) => {
      const r = await tx.agendaConvite.updateMany({
        where: { id: c.id, orgId, revogadoEm: null, usadoEm: c.usadoEm, approvalId: c.approvalId, eventoId: c.eventoId },
        data: { usadoEm: null, escolhidoInicio: null, escolhidoFim: null, emailInformado: null, approvalId: null, eventoId: null },
      });
      if (r.count === 0) return false;
      await tx.auditLog.create({
        data: {
          orgId,
          actorType: ActorType.system,
          actorId: AGENTE_DO_LINK,
          action: AUDITORIA_PEDIDO_CAIU,
          entityType: 'agenda_convite',
          entityId: c.id,
          before: {
            usadoEm: c.usadoEm?.toISOString() ?? null,
            escolhidoInicio: c.escolhidoInicio?.toISOString() ?? null,
            escolhidoFim: c.escolhidoFim?.toISOString() ?? null,
            approvalId: c.approvalId,
            eventoId: c.eventoId,
          },
          after: { estado: 'aberto' },
          metadata: { origem: 'agenda.convite', socio: c.socio, motivo: 'a aprovação do pedido venceu, foi recusada ou sumiu, e o evento não nasceu' },
        },
      });
      return true;
    });
    if (!reaberto) {
      const relido = await this.prisma.agendaConvite.findFirst({ where: { id: c.id, orgId } });
      return { convite: relido ?? c, reaberto: false };
    }
    this.log.warn(`link de escolha ${c.id}: o pedido não foi confirmado a tempo; o link volta a aceitar escolha`);
    return { convite: { ...c, usadoEm: null, escolhidoInicio: null, escolhidoFim: null, emailInformado: null, approvalId: null, eventoId: null }, reaberto: true };
  }

  /** O convite aberto já teve um pedido que caiu? (a página avisa "escolha de novo"). */
  private async teveConvitePedidoCaido(orgId: string, c: AgendaConvite): Promise<boolean> {
    // Barato: só convite aberto que já foi mexido depois de criado.
    if (c.usadoEm || c.atualizadoEm.getTime() <= c.criadoEm.getTime()) return false;
    const linha = await this.prisma.auditLog.findFirst({
      where: { orgId, action: AUDITORIA_PEDIDO_CAIU, entityType: 'agenda_convite', entityId: c.id, createdAt: { gte: c.criadoEm } },
      select: { id: true },
    });
    return !!linha;
  }

  async estadoPublico(token: string, agora = new Date()): Promise<EstadoDoConvitePublico> {
    const lido = await this.resolver(token, agora);
    const { orgId } = lido;
    return comTenantPublico(orgId, async () => {
      const { convite, reaberto } = await this.reabrirSeCaiu(orgId, lido.convite, agora);
      // Já escolhido: a página mostra o horário, e nenhum outro.
      const dias = convite.escolhidoInicio ? [] : await this.diasLivres(orgId, convite, agora);
      const caiu = reaberto || (await this.teveConvitePedidoCaido(orgId, convite));
      return { ...this.estadoDe(convite, dias), ...(caiu ? { pedidoAnteriorCaiu: true } : {}) };
    });
  }

  async confirmar(token: string, corpo: ConfirmacaoDoConvite | unknown, agora = new Date()): Promise<RespostaDaConfirmacao> {
    const resolvido = await this.resolver(token, agora);
    const { orgId } = resolvido;
    const lido = ConfirmacaoSchema.safeParse(corpo);
    if (!lido.success) throw new BadRequestException('Escolha o dia e o horário.');
    const pedido = lido.data;
    if (resolvido.convite.modalidade !== 'presencial' && !pedido.email) {
      throw new BadRequestException('Diga o seu e-mail: o convite com o link do Meet vai para ele.');
    }
    const inicio = instanteEmSaoPaulo(pedido.dia, pedido.hora);
    if (!inicio) throw new BadRequestException('Escolha o dia e o horário.');
    const fim = new Date(inicio.getTime() + resolvido.convite.duracaoMin * 60_000);

    return comTenantPublico(orgId, async () => {
      // O pedido anterior caiu na fila (A1)? O convite volta a aceitar escolha antes de conferir o uso.
      const { convite } = await this.reabrirSeCaiu(orgId, resolvido.convite, agora);
      if (convite.usadoEm) throw new ConflictException('Este link já foi usado. Se precisar mudar o horário, fale com a Root.');

      // O horário ainda é verde? (pode ter sido tomado entre abrir a página e confirmar)
      const dias = await this.diasLivres(orgId, convite, agora);
      const dia = dias.find((d) => d.dia === pedido.dia);
      if (!dia || ![...dia.manha, ...dia.tarde].includes(pedido.hora)) {
        throw new ConflictException('Esse horário não está mais livre. Escolha outro.');
      }

      // UM uso: a escrita condicionada decide quem leva (o segundo clique encontra zero linhas).
      // E UM convite por horário do sócio (M2): sob o cadeado do sócio, o horário que outro
      // convite pendente acabou de pedir é recusado, mesmo que os dois tenham visto verde.
      const tomado = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agenda-convite:${orgId}:${convite.socio}`}))`;
        const reservas = await this.reservasDeOutros(orgId, convite, agora, tx as unknown as Pick<PrismaService, 'agendaConvite'>);
        if (horarioReservado(inicio, fim, reservas)) return 'reservado' as const;
        const r = await tx.agendaConvite.updateMany({
          where: { id: convite.id, orgId, usadoEm: null, revogadoEm: null, validoAte: { gt: agora } },
          data: { usadoEm: agora, escolhidoInicio: inicio, escolhidoFim: fim, emailInformado: pedido.email ?? null },
        });
        return r.count === 0 ? ('usado' as const) : ('ok' as const);
      });
      if (tomado === 'reservado') throw new ConflictException('Esse horário não está mais livre. Escolha outro.');
      if (tomado === 'usado') throw new ConflictException('Este link já foi usado. Se precisar mudar o horário, fale com a Root.');

      const cliente = await this.nomeDoCliente(orgId, convite, pedido.nome);
      const chave = chaveDerivada(`convite:${convite.id}`);
      let r;
      try {
        r = await this.escrita.executar(
          { orgId, actorType: 'system', actorId: AGENTE_DO_LINK, agentSlug: AGENTE_DO_LINK },
          {
            acao: 'marcar',
            chave,
            compromisso: {
              tipo: convite.tipo === 'interna' ? 'interna' : 'cliente',
              modalidade: convite.modalidade === 'presencial' ? 'presencial' : 'online',
              ...(convite.tipo !== 'interna' ? { cliente } : {}),
              ...(convite.leadId ? { leadId: convite.leadId } : {}),
              ...(convite.clienteId ? { clienteId: convite.clienteId } : {}),
              responsaveis: [convite.socio as SocioDaAgenda],
              inicio: inicio.toISOString(),
              fim: fim.toISOString(),
              ...(pedido.email ? { convidados: [pedido.email] } : {}),
              pauta: 'Horário escolhido pelo link de escolha da Root.',
            },
          },
        );
      } catch (e) {
        await this.devolverUso(convite.id, orgId, agora);
        throw e;
      }
      if (r.status === 'recusado') {
        await this.devolverUso(convite.id, orgId, agora);
        this.log.warn(`link de escolha ${convite.id}: a escrita foi recusada (${r.mensagem})`);
        throw new ConflictException('Esse horário não está mais livre. Escolha outro.');
      }
      await this.prisma.agendaConvite.updateMany({
        where: { id: convite.id, orgId },
        data: { approvalId: r.approvalId, eventoId: r.eventoId ?? eventoIdDaChave(orgId, chave) },
      });
      const atualizado = { ...convite, usadoEm: agora, escolhidoInicio: inicio, escolhidoFim: fim };
      return {
        ...this.estadoDe(atualizado, []),
        mensagem: r.status === 'executado'
          ? 'Horário marcado. O convite com o link do Meet chega no seu e-mail.'
          : 'Horário reservado. O convite com o link do Meet chega no seu e-mail assim que a Root confirmar.',
      };
    });
  }

  /** O `.ics` do horário escolhido (o mesmo 404 sem escolha). */
  async ics(token: string, agora = new Date()): Promise<string> {
    const { convite } = await this.resolver(token, agora);
    if (!convite.escolhidoInicio || !convite.escolhidoFim) throw new NotFoundException(NAO_ENCONTRADO);
    const online = convite.modalidade !== 'presencial';
    return icsDoConvite({
      uid: `${convite.id}@agenda.operacaoroot`,
      inicio: convite.escolhidoInicio,
      fim: convite.escolhidoFim,
      titulo: `Reunião ${online ? 'online' : 'presencial'} com ${convite.socio} · Root`,
      descricao: online
        ? 'O convite do Google com o link do Meet chega no seu e-mail.'
        : 'O endereço chega no convite do Google, no seu e-mail.',
      agora,
    });
  }

  /** Desfaz o uso que esta própria chamada marcou (a escrita não saiu): o cliente pode escolher de novo. */
  private async devolverUso(id: string, orgId: string, agora: Date): Promise<void> {
    await this.prisma.agendaConvite
      .updateMany({
        where: { id, orgId, usadoEm: agora, approvalId: null, eventoId: null },
        data: { usadoEm: null, escolhidoInicio: null, escolhidoFim: null, emailInformado: null },
      })
      .catch((e) => this.log.error(`link de escolha ${id}: não deu para devolver o uso (${(e as Error).message})`));
  }

  /** O nome que o título leva: o do lead ou do cliente; senão o que a pessoa escreveu. Nunca inventado. */
  private async nomeDoCliente(orgId: string, c: AgendaConvite, digitado?: string): Promise<string> {
    if (c.leadId) {
      const lead = await this.prisma.lead.findFirst({ where: { id: c.leadId, orgId }, select: { name: true } });
      if (lead?.name?.trim()) return lead.name.trim().slice(0, 120);
    }
    if (c.clienteId) {
      const p = await this.prisma.partner.findFirst({ where: { id: c.clienteId, orgId }, select: { nomeFantasia: true, razaoSocial: true } });
      const n = p?.nomeFantasia?.trim() || p?.razaoSocial?.trim();
      if (n) return n.slice(0, 120);
    }
    // O digitado não mexe na gramática do título (M4): sem separador, com teto de tamanho.
    return nomeDigitadoParaTitulo(digitado) ?? 'Convidado pelo link';
  }
}
