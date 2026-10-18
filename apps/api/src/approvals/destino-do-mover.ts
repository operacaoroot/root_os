import { COMERCIAL_ESTAGIOS, COMERCIAL_ROTULO_DA_ETAPA, type ComercialEtapa } from '@mktos/shared';

import { hashDaSuperficieAntiga } from './approvals.service';

/*
 * O DESTINO QUE A ASSINATURA DO MOVER PRENDE (rodada do painel, revisão PA-1, 18/10/2026).
 *
 * O pedido de mover do funil é da superfície antiga: o hash prende só `{para}`
 * e o resumo é texto. Quem assina em /atendimento lia o resumo, e nada conferia
 * que o resumo dissesse o mesmo destino que o hash. Esta conta fecha isso SÓ
 * LENDO: as etapas são poucas, então recalcula o hash de `{para: e}` para cada
 * uma e acha a que bate. A fila mostra esse destino ("Destino conferido") e a
 * frase do pedido passa a usá-lo; se o resumo cita outro destino, ou diz que é
 * um mover e o hash não casa com etapa nenhuma, a linha ganha impedimento, e
 * `POST /approvals/:id/confirm` recusa antes de mexer no estado.
 *
 * Nada aqui afrouxa: o consumo continua conferindo recurso e hash como sempre.
 */

export interface ConferenciaDoMover {
  /** A etapa cujo `{para}` produz o hash gravado; `null` quando nenhuma produz. */
  destino: ComercialEtapa | null;
  /** O rótulo de tela do destino conferido ("E3 · Reunião agendada"). */
  rotulo: string | null;
  /** Por que esta assinatura não pode sair; `null` quando o texto confere com o hash. */
  impedimento: string | null;
}

export const DESTINO_NAO_CONFERE = 'O destino assinado não confere com o texto do pedido. Recuse e peça de novo pelo funil.';

/** O cache dos hashes por etapa: o cálculo não depende de nada além do recurso. */
let hashes: Map<string, ComercialEtapa> | null = null;
function hashesDasEtapas(): Map<string, ComercialEtapa> {
  if (!hashes) {
    hashes = new Map(COMERCIAL_ESTAGIOS.map((e) => [hashDaSuperficieAntiga('lead', { para: e }), e] as const));
  }
  return hashes;
}

/** A etapa que o hash prende, ou `null`. */
export function destinoDoHash(contentHash: string): ComercialEtapa | null {
  return hashesDasEtapas().get(contentHash) ?? null;
}

/** "E6 · Proposta" → "Proposta"; "Saída · Geladeira" → "Geladeira". */
function curto(rotulo: string): string {
  const i = rotulo.indexOf(' · ');
  return i >= 0 ? rotulo.slice(i + 3) : rotulo;
}

/**
 * As etapas que o texto cita como destino ("para <rótulo>", inteiro ou curto,
 * sem diferenciar maiúscula). Só a oração principal: as pendências que o
 * servidor anexa (" com pendências: …") ficam de fora, para uma pendência que
 * diga "para a proposta" não virar destino.
 */
export function destinosCitados(resumo: string): ComercialEtapa[] {
  const corte = resumo.indexOf(' com pendências:');
  const principal = (corte >= 0 ? resumo.slice(0, corte) : resumo).toLocaleLowerCase('pt-BR');
  const citados: ComercialEtapa[] = [];
  for (const e of COMERCIAL_ESTAGIOS) {
    const rotulo = COMERCIAL_ROTULO_DA_ETAPA[e];
    for (const forma of [rotulo, curto(rotulo)]) {
      const alvo = `para ${forma.toLocaleLowerCase('pt-BR')}`;
      const i = principal.indexOf(alvo);
      // A forma curta não pode ser o pedaço de uma palavra maior ("para Proposta" × "para Propostas").
      if (i >= 0 && !/[\p{L}\p{N}]/u.test(principal.charAt(i + alvo.length))) {
        citados.push(e);
        break;
      }
    }
  }
  return citados;
}

/** O resumo diz que é um pedido de mover do funil? */
function dizQueMove(resumo: string, citados: readonly ComercialEtapa[]): boolean {
  return /^\s*mover\b/i.test(resumo) || citados.length > 0;
}

/**
 * A conferência de UMA aprovação do recurso `lead` da superfície antiga.
 * `null` quando ela não é (nem diz ser) um pedido de mover: a aprovação do
 * `PATCH /leads/:id` (status, próxima ação) segue como sempre.
 */
export function conferirPedidoDeMover(ap: { contentHash: string; resumo: string }): ConferenciaDoMover | null {
  const destino = destinoDoHash(ap.contentHash);
  const citados = destinosCitados(ap.resumo ?? '');
  if (!destino) {
    return dizQueMove(ap.resumo ?? '', citados) ? { destino: null, rotulo: null, impedimento: DESTINO_NAO_CONFERE } : null;
  }
  const outro = citados.some((e) => e !== destino);
  return { destino, rotulo: COMERCIAL_ROTULO_DA_ETAPA[destino], impedimento: outro ? DESTINO_NAO_CONFERE : null };
}
