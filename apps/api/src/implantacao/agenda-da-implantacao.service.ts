import { Injectable, Logger, Optional } from '@nestjs/common';
import { DIAS_DA_AGENDA_DO_CARTAO } from '@mktos/shared';

import { EspelhoService } from '../agenda/espelho/espelho.service';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import type { EventoDaAgenda } from './proxima-reuniao';

/*
 * A AGENDA QUE O QUADRO DA IMPLANTAÇÃO LÊ (rodada de produção 2, M1, S1).
 *
 * UMA leitura por empresa e por passagem, nunca uma por card: os próximos 14
 * dias, pela capacidade de leitura que já existe (`comunicacao.agenda.periodo`,
 * R0), PELA PORTA, em nome de quem abriu o quadro (o RASTRO diz quem leu, como
 * `GET /google/calendar/periodo`). O resultado fica 5 minutos na memória do
 * processo; duas telas abertas ao mesmo tempo esperam a mesma leitura.
 *
 * FALHAR NÃO DERRUBA O QUADRO: Google desligado em Conexões, sem credencial, a
 * porta recusando ou retendo, o Google fora do ar. Tudo vira `indisponivel`, o
 * cartão só não mostra a reunião e o painel diz "Agenda indisponível". A falha
 * fica 1 minuto guardada, para uma agenda fora do ar não ser chamada a cada clique.
 *
 * O motivo da falha vai ao log, nunca à tela: pode trazer texto do conector.
 *
 * AGENDA V2 (29/10/2026, lane G1): com o espelho da agenda EM DIA (última
 * passagem da sincronia há menos de 10 min), a leitura sai dele, sem chamar o
 * Google. Espelho atrasado (ou fora: outra empresa que não a casa, falha do
 * banco) = a leitura de antes, pela porta.
 */

export const CAPACIDADE_DA_AGENDA_DO_CARTAO = 'comunicacao.agenda.periodo';
/** O teto de eventos de uma leitura (14 dias de uma agenda cheia cabem com folga). */
export const TETO_DE_EVENTOS_DO_CARTAO = 500;
export const VALIDADE_DA_LEITURA_MS = 5 * 60_000;
export const VALIDADE_DA_FALHA_MS = 60_000;

export type LeituraDaAgenda =
  | { ok: true; eventos: EventoDaAgenda[]; lidaEm: Date }
  | { ok: false; lidaEm: Date };

const DIA_MS = 86_400_000;

const ehRetida = (r: unknown): boolean =>
  !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';

@Injectable()
export class AgendaDaImplantacaoService {
  private readonly log = new Logger('AgendaDaImplantacao');
  private readonly guardadas = new Map<string, { valor: LeituraDaAgenda; expira: number }>();
  private readonly emCurso = new Map<string, Promise<LeituraDaAgenda>>();
  /** O relógio, trocável no teste. */
  agora: () => Date = () => new Date();

  constructor(
    private readonly porta: PortaDoOperador,
    @Optional() private readonly espelho?: EspelhoService,
  ) {}

  /** A leitura desta empresa: a guardada, a que já está em curso, ou uma nova. */
  async ler(orgId: string, actorId: string): Promise<LeituraDaAgenda> {
    const agora = this.agora();
    const g = this.guardadas.get(orgId);
    if (g && g.expira > agora.getTime()) return g.valor;
    const viva = this.emCurso.get(orgId);
    if (viva) return viva;
    const p = this.lerDoGoogle(orgId, actorId, agora).finally(() => this.emCurso.delete(orgId));
    this.emCurso.set(orgId, p);
    return p;
  }

  /** Esquece a leitura desta empresa (teste e, um dia, o retorno do OAuth). */
  esquecer(orgId?: string): void {
    if (orgId) this.guardadas.delete(orgId);
    else this.guardadas.clear();
  }

  /** O espelho em dia, no formato da leitura direta; nulo = leia pela porta. */
  private async lerDoEspelho(orgId: string, agora: Date): Promise<EventoDaAgenda[] | null> {
    if (!this.espelho) return null;
    try {
      const eventos = await this.espelho.lerSeEmDia(orgId, agora, new Date(agora.getTime() + DIAS_DA_AGENDA_DO_CARTAO * DIA_MS), agora);
      if (!eventos) return null;
      return eventos
        .filter((e) => e.origem === 'google' && e.status !== 'cancelado')
        .slice(0, TETO_DE_EVENTOS_DO_CARTAO)
        .map((e) => ({
          id: e.id,
          title: e.titulo,
          start: e.inicio,
          end: e.fim,
          diaInteiro: e.diaInteiro,
          status: e.status === 'provisorio' ? 'tentative' : 'confirmed',
          attendees: e.convidados.map((c) => c.email),
          organizador: e.organizador,
        }));
    } catch (e) {
      this.log.warn(`empresa ${orgId}: espelho da agenda indisponível para o quadro; lendo pela porta (${(e as Error).message})`);
      return null;
    }
  }

  private async lerDoGoogle(orgId: string, actorId: string, agora: Date): Promise<LeituraDaAgenda> {
    let valor: LeituraDaAgenda;
    const doEspelho = await this.lerDoEspelho(orgId, agora);
    if (doEspelho) {
      valor = { ok: true, eventos: doEspelho, lidaEm: agora };
      this.guardadas.set(orgId, { valor, expira: agora.getTime() + VALIDADE_DA_LEITURA_MS });
      return valor;
    }
    try {
      const r = await this.porta.executar({
        orgId,
        actorId,
        capabilityId: CAPACIDADE_DA_AGENDA_DO_CARTAO,
        args: {
          de: agora.toISOString(),
          ate: new Date(agora.getTime() + DIAS_DA_AGENDA_DO_CARTAO * DIA_MS).toISOString(),
          limite: TETO_DE_EVENTOS_DO_CARTAO,
        },
        resource: { type: CAPACIDADE_DA_AGENDA_DO_CARTAO, id: 'quadro-da-implantacao' },
      });
      if (ehRetida(r)) throw new Error('a porta reteve a leitura da agenda para aprovação');
      if (!Array.isArray(r)) throw new Error('a leitura da agenda não devolveu uma lista');
      valor = { ok: true, eventos: r as EventoDaAgenda[], lidaEm: agora };
    } catch (e) {
      this.log.warn(`empresa ${orgId}: agenda indisponível para o quadro da implantação (${(e as Error).message})`);
      valor = { ok: false, lidaEm: agora };
    }
    this.guardadas.set(orgId, { valor, expira: agora.getTime() + (valor.ok ? VALIDADE_DA_LEITURA_MS : VALIDADE_DA_FALHA_MS) });
    return valor;
  }
}
