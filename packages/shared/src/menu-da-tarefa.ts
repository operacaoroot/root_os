import { z } from 'zod';
import { TRAB_CARD_DA_IMPLANTACAO_NAO_DUPLICA, TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA, TRAB_NA_LIXEIRA, TRAB_TAREFA_COM_AGENTE } from './lixeira-do-trabalho.js';

/*
 * O MENU DA TAREFA (rodada de produção 3, I4, 22/10/2026).
 *
 * O botão direito (e o "⋯" do cartão, para toque e teclado) em qualquer tarefa do
 * OS: quadro, lista, Todas, Dia a dia, Implantação, Tarefas do comercial e painel
 * do lead. As ações e as razões de desabilitar moram aqui, para a tela e o teste
 * perguntarem a mesma coisa. Toda escrita é de gente, auditada, pela permissão que
 * a ação já tinha (`tarefas.editar`); o que a pessoa não pode fazer aparece
 * desabilitado com a razão, nunca some sem explicação.
 */

// Leva 5, L2 (27/10/2026): "Histórico" abre as entradas do AuditLog da tarefa (quem, quando, antes e depois).
export const ACOES_DO_MENU_DA_TAREFA = [
  'renomear', 'copiar-id', 'mover', 'mesclar', 'duplicar', 'arquivar', 'excluir', 'compartilhar', 'historico',
] as const;
export type AcaoDoMenuDaTarefa = (typeof ACOES_DO_MENU_DA_TAREFA)[number];

export const ROTULO_DA_ACAO_DA_TAREFA: Record<AcaoDoMenuDaTarefa, string> = {
  renomear: 'Renomear',
  'copiar-id': 'Copiar ID',
  mover: 'Mover para…',
  mesclar: 'Mesclar com outra…',
  duplicar: 'Duplicar',
  arquivar: 'Arquivar',
  excluir: 'Excluir',
  compartilhar: 'Compartilhar (copiar link)',
  historico: 'Histórico',
};

export interface EstadoParaOMenu {
  /** A pessoa tem `tarefas.editar`. */
  podeEditar: boolean;
  /** A sessão é de gente (conta de máquina não mexe por aqui). */
  ehGente: boolean;
  arquivada: boolean;
  excluida: boolean;
  /** É o card de um cliente na Implantação. */
  cardDaImplantacao: boolean;
  /** Um agente tem a tarefa na mão (checkout). */
  comAgente: boolean;
}

export const SEM_PERMISSAO_DE_EDITAR = 'Você não tem permissão para editar tarefas.';
export const SO_GENTE_NO_MENU = 'Esta ação é de gente: conta de máquina não faz.';
export const JA_ARQUIVADA = 'A tarefa já está arquivada.';

/** A razão de a ação estar desabilitada, ou `null` quando ela pode. */
export function razaoParaNaoFazer(acao: AcaoDoMenuDaTarefa, e: EstadoParaOMenu): string | null {
  // Só leitura: ver o histórico não pede permissão de editar (a tela pede `auditoria.ver` ao abrir).
  if (acao === 'copiar-id' || acao === 'compartilhar' || acao === 'historico') return null;
  if (!e.podeEditar) return SEM_PERMISSAO_DE_EDITAR;
  if (!e.ehGente) return SO_GENTE_NO_MENU;
  if (e.excluida) return TRAB_NA_LIXEIRA;
  switch (acao) {
    case 'mesclar':
      if (e.cardDaImplantacao) return TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA;
      if (e.comAgente) return TRAB_TAREFA_COM_AGENTE;
      return e.arquivada ? JA_ARQUIVADA : null;
    case 'duplicar':
      return e.cardDaImplantacao ? TRAB_CARD_DA_IMPLANTACAO_NAO_DUPLICA : null;
    case 'arquivar':
      return e.arquivada ? JA_ARQUIVADA : null;
    case 'excluir':
      return e.comAgente ? TRAB_TAREFA_COM_AGENTE : null;
    default:
      return null;
  }
}

/** O endereço de compartilhar: abre a tarefa no pop-up único (`?tarefa=`). */
export function linkDaTarefa(origem: string, tarefa: { id: string; listId?: string | null }): string {
  const u = new URL('/trabalho', origem);
  if (tarefa.listId) u.searchParams.set('lista', tarefa.listId);
  u.searchParams.set('tarefa', tarefa.id);
  return u.toString();
}

/** O caminho relativo da tarefa, o que vai no comentário "mesclada em". */
export function caminhoDaTarefa(tarefa: { id: string; listId: string }): string {
  return `/trabalho?lista=${tarefa.listId}&tarefa=${tarefa.id}`;
}

export const TrabTarefaMoverSchema = z.object({
  listId: z.string().uuid(),
  statusId: z.string().uuid().optional(),
  expectedUpdatedAt: z.string().max(40),
}).strict();
export type TrabTarefaMoverInput = z.infer<typeof TrabTarefaMoverSchema>;

export const TrabTarefaMesclarSchema = z.object({
  destinoId: z.string().uuid(),
  expectedUpdatedAt: z.string().max(40).optional(),
}).strict();
export type TrabTarefaMesclarInput = z.infer<typeof TrabTarefaMesclarSchema>;

export interface TrabTarefaMesclada {
  origemId: string;
  destinoId: string;
  comentarios: number;
  anexos: number;
  subtarefas: number;
  etiquetas: number;
  campos: number;
  /** Valores de campo que ficaram guardados na origem (o destino já tinha valor, ou o campo não vale lá). */
  camposGuardados: number;
}

export interface TrabTarefaDuplicada { id: string; listId: string; title: string }

/** O título da cópia. */
export function tituloDaCopia(titulo: string): string {
  return `cópia de ${titulo}`.slice(0, 500);
}
