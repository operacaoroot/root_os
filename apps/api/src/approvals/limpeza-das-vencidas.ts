import { Injectable, Logger } from '@nestjs/common';
import { ActorType, AgentEstado, Prisma } from '@prisma/client';

import { contextoAtual } from '../common/contexto-execucao';
import { EventLogService } from '../gateway/event-log.service';
import { proximaOcorrencia } from '../pauta/cron';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from './approvals.service';

/*
 * A LIMPEZA DAS VENCIDAS — a rotina `aprovacoes.vencidas` (rodada do trabalho
 * T7, 19/10/2026).
 *
 * `ApprovalsService.expirarVencidas` existia e ninguém chamava: `pendente` com
 * prazo vencido ficava `pendente` para sempre, a fila desenhava certo por
 * cálculo e uma consulta ingênua lia errado. Agora é uma rotina como as outras
 * (`/rotinas`, estado declarado, histórico), uma vez por dia às 03:00 de São
 * Paulo. O executor mora em `routines/executores/aprovacoes-vencidas.executor.ts`.
 *
 * ONDE ELA É SEMEADA: quando a fila é aberta (`GET /approvals/fila`) e quando o
 * agendador varre a empresa (toda empresa que já tem alguma rotina). As duas
 * pontas recebem este serviço por injeção OPCIONAL: as suítes que montam o
 * controlador e o agendador à mão não semeiam nada, e as empresas de teste que
 * elas apagam no fim não ganham uma linha de rotina presa a elas.
 *
 * O QUE ELA FAZ é só o que o serviço sempre fez: marca `expirada` a `pendente`
 * cujo prazo já passou (`ApprovalsService.expirarVencidasDaEmpresa`). Não toca
 * `confirmada`, `consumida` nem `rejeitada`, não estende prazo e não decide nada
 * no lugar de ninguém. Assina como sistema e vai ao RASTRO com a contagem e os
 * ids (id de aprovação não é conteúdo de cliente).
 */

export const TIPO_DA_LIMPEZA_DAS_VENCIDAS = 'aprovacoes.vencidas';
export const SLUG_DA_LIMPEZA_DAS_VENCIDAS = 'aprovacoes-vencidas';
export const CRON_DA_LIMPEZA_DAS_VENCIDAS = '0 3 * * *';
export const FUSO_DA_LIMPEZA_DAS_VENCIDAS = 'America/Sao_Paulo';
/** Quantas por passagem. A sobra fica para a passagem seguinte (ou para o "rodar agora"). */
export const TETO_DA_LIMPEZA = 500;
/** O tipo do evento no RASTRO. */
export const EVENTO_DA_LIMPEZA = 'approval.expiradas';

const LIVRE = new Date(0);

/** A linha do histórico da rotina. Nunca conteúdo de pedido: só a contagem. */
export function resumoDaLimpeza(quantas: number, sobra: boolean): string {
  if (quantas === 0) return 'nenhuma aprovação vencida esperando.';
  const base = quantas === 1 ? '1 aprovação vencida marcada como expirada.' : `${quantas} aprovações vencidas marcadas como expiradas.`;
  return sobra ? `${base} Há mais: a próxima passagem segue.` : base;
}

@Injectable()
export class LimpezaDasVencidasService {
  private readonly log = new Logger('LimpezaDasVencidas');
  private readonly semeadas = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly eventos: EventLogService,
  ) {}

  /** Semeia a rotina da empresa (idempotente; uma vez por processo e empresa). Nunca lança. */
  async garantir(orgId: string): Promise<void> {
    if (!orgId || this.semeadas.has(orgId)) return;
    try {
      await this.prisma.rotina.upsert({
        where: { orgId_slug: { orgId, slug: SLUG_DA_LIMPEZA_DAS_VENCIDAS } },
        create: {
          orgId,
          slug: SLUG_DA_LIMPEZA_DAS_VENCIDAS,
          nome: 'Limpeza das aprovações vencidas',
          tipo: TIPO_DA_LIMPEZA_DAS_VENCIDAS,
          config: {} as Prisma.InputJsonValue,
          cron: CRON_DA_LIMPEZA_DAS_VENCIDAS,
          tz: FUSO_DA_LIMPEZA_DAS_VENCIDAS,
          ativo: true,
          estado: AgentEstado.rodando,
          origem: 'manual',
          refExterna: null,
          agenteSlug: null,
          reservadoEm: LIVRE,
          reservadoAte: LIVRE,
          proximaExecucaoEm: proximaOcorrencia(CRON_DA_LIMPEZA_DAS_VENCIDAS, FUSO_DA_LIMPEZA_DAS_VENCIDAS, new Date()),
        },
        update: {},
      });
      this.semeadas.add(orgId);
    } catch (e) {
      this.log.warn(`empresa ${orgId}: não semeei a limpeza das vencidas: ${(e as Error).message}`);
    }
  }

  /**
   * Uma passagem: marca as vencidas desta empresa e registra no RASTRO, como
   * sistema. Sem nada vencido, não escreve evento (diário de bordo é o que
   * aconteceu; "nada" todo dia afogaria o resto).
   */
  async passagem(orgId: string, agora: Date = new Date()): Promise<{ quantas: number; sobra: boolean; resumo: string }> {
    const { ids, sobra } = await this.approvals.expirarVencidasDaEmpresa(orgId, agora, TETO_DA_LIMPEZA);
    if (ids.length) {
      await this.eventos.registrar({
        orgId,
        tipo: EVENTO_DA_LIMPEZA,
        actorType: ActorType.system,
        actorId: null,
        correlationId: contextoAtual()?.correlationId ?? null,
        conteudo: { argumentos: { quantas: ids.length, sobra, aprovacoes: ids, regra: 'pendente com prazo vencido' } },
        sensibilidade: 'interna',
      });
    }
    return { quantas: ids.length, sobra, resumo: resumoDaLimpeza(ids.length, sobra) };
  }
}
