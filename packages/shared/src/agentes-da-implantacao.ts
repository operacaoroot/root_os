import { z } from 'zod';

import type { Pendencia } from './pendencias';

/*
 * OS CONTRATOS DA LANE A3+TR (rodada dos agentes, 21/10/2026): o kit da
 * implantação (IM-07), o cobrador de tarefas (TR-07), a triagem da caixa (TR-08)
 * e o delegador (TR-09). A tela e a API leem daqui.
 */

// ---------------------------------------------------------------------------
// "Nunca invente número": a régua comum do kit (IM-07) e do cobrador (TR-07)
// ---------------------------------------------------------------------------

/** Os números de um texto, só os dígitos (`1.500,00` → `150000`; `10x` → `10`). */
export function numerosDoTexto(texto: string): string[] {
  return (String(texto ?? '').match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, '')).filter(Boolean);
}

/**
 * Os números que o modelo escreveu e que NÃO estão em nenhuma das fontes. Vazio =
 * nada inventado. Quem chama descarta o texto (ou o item) que voltar com algum:
 * número é do sistema, o modelo só escreve a frase.
 */
export function numerosInventados(texto: string, fontes: readonly string[]): string[] {
  const permitidos = new Set(fontes.flatMap(numerosDoTexto));
  return [...new Set(numerosDoTexto(texto).filter((n) => !permitidos.has(n)))];
}

// ---------------------------------------------------------------------------
// IM-07 · O kit de implantação
// ---------------------------------------------------------------------------

/** O tipo do marco que guarda o kit no trilho (a cópia do OS). */
export const MARCO_DO_KIT = 'kit.montado';
/** O nome da etapa do card da Implantação em que o kit deve existir. */
export const ETAPA_DO_KIT = 'Kit montado';

export type EstadoDaCopiaDoKit =
  | 'enviado'
  | 'aguardando_aprovacao'
  | 'na_fila'
  | 'classificar_a_mao'
  | 'so_no_os'
  | 'erro'
  | 'sem_cliente';

export interface KitNaTela {
  montadoEm: string;
  montadoPor: string | null;
  /** O nome do arquivo do kit (`kit-<cliente>.md`). */
  arquivo: string;
  secoes: { titulo: string; itens: number }[];
  /** Os avisos do parser (item com número que não estava na fonte, seção vazia). */
  avisos: string[];
  /** O que o arquivista disse da cópia em 03-kickoff. */
  copia: { estado: EstadoDaCopiaDoKit; motivo: string | null };
}

/** O que o card da Implantação lê para o kit e a pasta do cliente. */
export interface KitEPastaDoCard {
  /** O nome da etapa em que o card está agora (ou nulo sem card). */
  etapaDoCard: string | null;
  kit: KitNaTela | null;
  /** O card está em "Kit montado" e ainda não há kit: aviso, não trava. */
  avisoSemKit: boolean;
  cliente: { partnerId: string; pastaUrl: string | null; pastaErro: string | null } | null;
}

// ---------------------------------------------------------------------------
// TR-07 · O cobrador de tarefas
// ---------------------------------------------------------------------------

export const TIPO_DA_ROTINA_DE_COBRANCA = 'trabalho.cobranca';
export const TIPO_DA_PENDENCIA_DE_COBRANCA = 'tarefa.cobranca';
/** A nota da memória com o N (primeira linha = um inteiro de 1 a 90). */
export const NOTA_DOS_DIAS_DA_COBRANCA = 'trabalho.cobranca.dias';
export const DIAS_DA_COBRANCA_PADRAO = 7;
export const OPCOES_DA_COBRANCA = [
  { chave: 'vou-tratar', rotulo: 'Vou tratar hoje' },
  { chave: 'ja-tratei', rotulo: 'Já tratei' },
] as const;

// ---------------------------------------------------------------------------
// TR-08 · A triagem da caixa
// ---------------------------------------------------------------------------

export type UrgenciaDaPendencia = 'urgente' | 'hoje' | 'depois';

export interface PendenciaNaCaixa extends Pendencia {
  /** O nome da função que abriu (do cadastro único), para a tela. */
  funcaoNome: string | null;
  urgencia: UrgenciaDaPendencia;
  /** Por que a regra marcou a urgência (prazo, aprovação vencendo). */
  motivoDaUrgencia: string | null;
  /** O cliente, quando a pendência diz qual (explícito) ou quando o modelo agrupou. */
  cliente: string | null;
  /** `explicito` = da referência; `modelo` = agrupado pela triagem; `nenhum`. */
  clienteDe: 'explicito' | 'modelo' | 'nenhum';
}

export interface GrupoDaCaixa {
  cliente: string | null;
  urgencia: UrgenciaDaPendencia;
  itens: PendenciaNaCaixa[];
}

export interface PendenciasDaCaixa {
  /** Quantas abertas esperam por você (as suas e as sem destinatário): o contador da caixa. */
  total: number;
  grupos: GrupoDaCaixa[];
  /** Como a triagem rodou: `modelo` (agrupou o que não tinha cliente), `regra` (sem modelo), `nada` (tudo explícito). */
  triagem: 'modelo' | 'regra' | 'nada';
  /** Quantos itens a triagem reaproveitou do cache (não perguntou de novo ao modelo). */
  doCache: number;
}

// ---------------------------------------------------------------------------
// TR-09 · O delegador
// ---------------------------------------------------------------------------

export const EstadoDaDelegacaoSchema = z.enum(['rascunho', 'aceita', 'descartada']);
export type EstadoDaDelegacao = z.infer<typeof EstadoDaDelegacaoSchema>;

export interface DelegacaoSugestaoDto {
  id: string;
  taskId: string;
  titulo: string;
  descricao: string;
  donoTipo: 'pessoa' | 'agente';
  donoUsuarioId: string | null;
  donoNome: string | null;
  donoFuncao: string | null;
  prazo: string | null;
  porque: string;
  estado: EstadoDaDelegacao;
  subtarefaId: string | null;
  decididaEm: string | null;
}

export interface DelegacaoDaTarefa {
  /** A tarefa está atribuída a um agente (é aí que o Delegador trabalha). */
  atribuidaAAgente: boolean;
  agente: string | null;
  sugestoes: DelegacaoSugestaoDto[];
}

export const AceitarDelegacaoSchema = z.object({
  titulo: z.string().trim().min(1).max(300).optional(),
  /** A pessoa dona da subtarefa; ausente = a da sugestão (se a sugestão é de pessoa). */
  responsavelId: z.string().min(1).max(80).nullable().optional(),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type AceitarDelegacao = z.infer<typeof AceitarDelegacaoSchema>;
