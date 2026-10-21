import { situacaoDoPrazo, type ComercialProximaAcao, type TarefaNoCartaoDoFunil } from '@mktos/shared';

/*
 * A TAREFA NO CARTÃO DO FUNIL (adendo de 21/10/2026, §A1): a parte pura.
 *
 * O funil lê as tarefas abertas de TODOS os leads da tela numa consulta só
 * (`FichaService.funil`); aqui elas viram, por lead, a mais antiga e a contagem.
 *
 * "Mais antiga" = menor prazo; sem prazo, a criada primeiro (a com prazo vem
 * antes da sem prazo, como na régua do Dia a dia, em que "sem prazo" é o fim).
 *
 * Ela é a PRÓXIMA AÇÃO do cartão quando a ficha não tem uma, ou quando o prazo
 * dela cai no mesmo dia ou antes do "quando" da ficha (dia de São Paulo; no
 * empate, a tarefa vence: é a coisa que alguém da casa combinou fazer). Ação da
 * ficha sem "quando" perde para tarefa com prazo, e tarefa sem prazo nunca passa
 * à frente de uma ação da ficha: fica como segunda linha.
 *
 * Nada aqui grava: a próxima ação da ficha é projeção e a régua a protege.
 */

export interface TarefaAbertaDoLead {
  id: string;
  leadId: string;
  title: string;
  dueDate: Date | null;
  createdAt: Date;
  responsavel: string | null;
}

const FORMATO_DIA_SP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Dia de São Paulo (AAAA-MM-DD) de um instante. O prazo de dia inteiro é guardado à meia-noite daqui. */
export function diaEmSP(d: Date): string {
  return FORMATO_DIA_SP.format(d);
}

/** A ordem da "mais antiga": prazo (dia de SP) crescente, sem prazo no fim; empate pela criação. */
export function antesNaFila(a: TarefaAbertaDoLead, b: TarefaAbertaDoLead): number {
  const pa = a.dueDate ? diaEmSP(a.dueDate) : null;
  const pb = b.dueDate ? diaEmSP(b.dueDate) : null;
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa < pb ? -1 : 1;
  }
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/** A tarefa passa à frente da próxima ação da ficha? */
export function tarefaEhAProximaAcao(prazo: string | null, daFicha: ComercialProximaAcao | null): boolean {
  if (!daFicha) return true;
  if (!prazo) return false;
  if (!daFicha.quando) return true;
  const quando = new Date(daFicha.quando);
  if (Number.isNaN(quando.getTime())) return true;
  return prazo <= diaEmSP(quando);
}

/** Por lead: a tarefa aberta mais antiga (já decidida contra a próxima ação da ficha) e quantas estão abertas. */
export function tarefasDosCartoes(
  linhas: readonly TarefaAbertaDoLead[],
  proximaDaFicha: ReadonlyMap<string, ComercialProximaAcao | null>,
  hoje: string,
): Map<string, { tarefa: TarefaNoCartaoDoFunil; abertas: number }> {
  const porLead = new Map<string, TarefaAbertaDoLead[]>();
  for (const l of linhas) porLead.set(l.leadId, [...(porLead.get(l.leadId) ?? []), l]);
  const saida = new Map<string, { tarefa: TarefaNoCartaoDoFunil; abertas: number }>();
  for (const [leadId, doLead] of porLead) {
    const t = [...doLead].sort(antesNaFila)[0];
    const prazo = t.dueDate ? diaEmSP(t.dueDate) : null;
    saida.set(leadId, {
      abertas: doLead.length,
      tarefa: {
        id: t.id,
        titulo: t.title,
        prazo,
        situacao: situacaoDoPrazo(prazo, hoje, false),
        responsavel: t.responsavel,
        ehProximaAcao: tarefaEhAProximaAcao(prazo, proximaDaFicha.get(leadId) ?? null),
      },
    });
  }
  return saida;
}
