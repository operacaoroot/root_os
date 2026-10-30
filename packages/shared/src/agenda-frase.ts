/*
 * O ATALHO POR FRASE DO PAINEL DE MARCAR (rodada da Agenda v2, 29/10/2026, lane G3).
 *
 * "Andrade online sexta 15h com Rodrigo 1h" → os campos do painel. Sem IA: um
 * intérprete puro que preenche SÓ o que a frase disse (o resto fica como está
 * no painel). "14h 30 min" = 14:00 por 30 min.
 *
 * ESQUELETO DA LANE 0: a assinatura é o contrato; a lane G3 implementa.
 */
import type { ModalidadeDeReuniao } from './agenda.js';
import type { SocioDaAgenda, TipoQueSeMarca } from './agenda-v2.js';

export interface ContextoDaFrase {
  /** Hoje, `AAAA-MM-DD`, no fuso da agenda. */
  hoje: string;
  /** Nomes de clientes e leads conhecidos (para reconhecer o cliente na frase). */
  clientes?: readonly string[];
}

export interface CamposDaFrase {
  tipo?: TipoQueSeMarca;
  modalidade?: ModalidadeDeReuniao;
  cliente?: string;
  responsaveis?: SocioDaAgenda[];
  /** `AAAA-MM-DD`. */
  dia?: string;
  /** `HH:MM`. */
  hora?: string;
  duracaoMin?: number;
  motivo?: string;
}

export function interpretarFrase(frase: string, ctx: ContextoDaFrase): CamposDaFrase {
  void frase;
  void ctx;
  return {};
}
