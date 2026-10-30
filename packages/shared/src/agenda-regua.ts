/*
 * A RÉGUA DA AGENDA (rodada da Agenda v2, 29/10/2026, lane G2) — o motor puro.
 *
 * Usado pela tela (semáforo do painel), pela API (antes de toda escrita) e pelo
 * link público (`horariosLivres`). Recebe os eventos do período, as regras e o
 * compromisso proposto; devolve verde/amarelo/vermelho com as frases.
 *
 * ESQUELETO DA LANE 0: as assinaturas são o contrato; a lane G2 implementa.
 * PURO: sem relógio (o `agora` vem de fora), sem rede, sem banco.
 */
import type {
  CompromissoProposto,
  DiaLivre,
  EventoDaAgenda,
  HorarioSugerido,
  RegrasDaAgenda,
  ResultadoDaRegua,
  SocioDaAgenda,
} from './agenda-v2.js';

export interface EntradaDaRegua {
  eventos: readonly EventoDaAgenda[];
  regras: Pick<RegrasDaAgenda, 'pessoas' | 'ritos' | 'feriados'>;
  proposta: CompromissoProposto;
  /** Para "no passado" e para a frase "em N dias". */
  agora?: Date;
}

/** O semáforo de um compromisso proposto. */
export function avaliarNaRegua(entrada: EntradaDaRegua): ResultadoDaRegua {
  void entrada;
  return { cor: 'verde', itens: [] };
}

export interface EntradaDaSugestao {
  eventos: readonly EventoDaAgenda[];
  regras: Pick<RegrasDaAgenda, 'pessoas' | 'ritos' | 'feriados'>;
  /** O compromisso sem horário: tipo, modalidade, quem e a duração. */
  base: Omit<CompromissoProposto, 'inicio' | 'fim'> & { duracaoMin: number };
  /** A partir de quando procurar. */
  aPartirDe: Date;
  /** Quantos horários devolver (padrão 3). */
  limite?: number;
  /** Passo da procura em minutos (padrão 30). */
  passoMin?: number;
  /** Até quantos dias à frente (padrão 14). */
  dias?: number;
}

/** Os próximos horários VERDES. */
export function sugerirHorarios(entrada: EntradaDaSugestao): HorarioSugerido[] {
  void entrada;
  return [];
}

export interface EntradaDosLivres {
  eventos: readonly EventoDaAgenda[];
  regras: Pick<RegrasDaAgenda, 'pessoas' | 'ritos' | 'feriados'>;
  socio: SocioDaAgenda;
  tipo: 'cliente' | 'interna';
  modalidade: 'online' | 'presencial';
  duracaoMin: number;
  /** `AAAA-MM-DD`, inclusive, no fuso da agenda. */
  de: string;
  ate: string;
  agora: Date;
  /** Passo em minutos (padrão 30). */
  passoMin?: number;
}

/** O que o link público mostra: por dia útil, os horários verdes da manhã e da tarde. */
export function horariosLivres(entrada: EntradaDosLivres): DiaLivre[] {
  void entrada;
  return [];
}
