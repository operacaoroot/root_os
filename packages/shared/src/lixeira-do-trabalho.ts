import { z } from 'zod';
import type { TrabArquivadaPor } from './arvore-do-trabalho.js';

/*
 * A LIXEIRA DO TRABALHO (rodada de produção 3, I2, 22/10/2026).
 *
 * Excluir uma tarefa passa a ser recuperável. `WorkTask.excluidaEm` guarda a hora
 * e a tarefa também é arquivada, então some de toda listagem (quadro, Todas, Dia a
 * dia, contadores, Implantação, busca, agenda, caixa, tarefas do comercial, painel
 * do lead). Ela fica na Lixeira por `TRAB_DIAS_NA_LIXEIRA` dias e pode ser
 * restaurada: volta para a lista e a etapa de onde saiu (as duas não mudam ao
 * excluir). Se a lista ou a pasta dela continua arquivada, a tarefa volta assim
 * mesmo e a resposta avisa.
 *
 * "Apagar de vez" é só de quem tem `admin.usuarios`, com a frase escrita, e só da
 * tarefa que já está na Lixeira como excluída. O expurgo dos 30 dias é uma rotina
 * (`trabalho.lixeira.expurgo`) que nasce DESLIGADA em /rotinas: quem liga é gente.
 *
 * A Lixeira mostra também as ARQUIVADAS (restaurar = desarquivar). A hora e quem
 * arquivou vêm da auditoria da tarefa (`work.task.update`; ver
 * `apps/api/src/work/lixeira/quando-saiu.ts`): a tarefa não tem coluna de
 * arquivamento.
 */

/** Quantos dias a tarefa excluída espera na Lixeira antes do expurgo (quando ligado). */
export const TRAB_DIAS_NA_LIXEIRA = 30;

/** A frase que quem apaga de vez escreve. Comparada sem maiúscula e sem espaço sobrando. */
export const TRAB_FRASE_DE_APAGAR_DE_VEZ = 'apagar de vez';

/** O tipo da rotina do expurgo (registro de executores de rotina). */
export const TRAB_TIPO_DA_ROTINA_DO_EXPURGO = 'trabalho.lixeira.expurgo';
export const TRAB_SLUG_DA_ROTINA_DO_EXPURGO = 'lixeira-expurgo';

export const TRAB_NA_LIXEIRA = 'A tarefa está na Lixeira. Restaure antes de editar.';
export const TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA = 'O card da implantação é o cliente: ele não se mescla com outra tarefa.';
export const TRAB_CARD_DA_IMPLANTACAO_NAO_DUPLICA = 'O card da implantação nasce do lead no Comercial: ele não se duplica.';
export const TRAB_TAREFA_COM_AGENTE = 'Um agente está com esta tarefa na mão. Solte a tarefa antes.';

export function fraseDeApagarDeVezConfere(escrita: string | null | undefined): boolean {
  return (escrita ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === TRAB_FRASE_DE_APAGAR_DE_VEZ;
}

/** Quando a excluída sai pelo expurgo (excluída + 30 dias). */
export function expiraNaLixeiraEm(excluidaEm: Date): Date {
  return new Date(excluidaEm.getTime() + TRAB_DIAS_NA_LIXEIRA * 24 * 60 * 60 * 1000);
}

export type TrabEstadoNaLixeira = 'excluida' | 'arquivada';

export interface TrabTarefaNaLixeira {
  id: string;
  title: string;
  estado: TrabEstadoNaLixeira;
  /** Quando saiu (excluída: a coluna; arquivada: a auditoria, senão a última atualização). */
  em: string;
  /** Quem tirou, pela coluna ou pela auditoria; nulo quando não dá para dizer. */
  por: TrabArquivadaPor | null;
  /** De onde saiu: a lista (e se ela continua arquivada) e a pasta. */
  lista: { id: string; name: string; arquivada: boolean };
  pasta: { id: string; name: string } | null;
  status: { id: string; name: string };
  /** Só da excluída: quando o expurgo a apagaria, se estiver ligado. */
  expiraEm: string | null;
  /** O card de um cliente na Implantação (lista da implantação ou com trilho). */
  cardDaImplantacao: boolean;
}

export interface TrabLixeira {
  tarefas: TrabTarefaNaLixeira[];
  /** Quantas casam com o filtro (a lista pode vir cortada em `limite`). */
  total: number;
  limite: number;
  diasNaLixeira: number;
  /** A rotina do expurgo: existe? dispara? */
  expurgo: { rotinaId: string | null; ligado: boolean };
}

const ID = z.string().uuid();

export const TrabLixeiraQuerySchema = z.object({
  q: z.string().max(120).optional(),
  estado: z.enum(['excluida', 'arquivada']).optional(),
}).strict();

/** Restaurar em lote: ids de tarefas arquivadas ou excluídas. */
export const TrabLixeiraRestaurarSchema = z.object({ ids: z.array(ID).min(1).max(200) }).strict();
export type TrabLixeiraRestaurarInput = z.infer<typeof TrabLixeiraRestaurarSchema>;

export const TrabLixeiraApagarDeVezSchema = z.object({
  ids: z.array(ID).min(1).max(200),
  frase: z.string().max(80),
}).strict();
export type TrabLixeiraApagarDeVezInput = z.infer<typeof TrabLixeiraApagarDeVezSchema>;

export const TrabTarefaExcluirSchema = z.object({ expectedUpdatedAt: z.string().max(40).optional() }).strict();
export type TrabTarefaExcluirInput = z.infer<typeof TrabTarefaExcluirSchema>;

export interface TrabTarefaExcluida { id: string; excluidaEm: string; expiraEm: string }

export interface TrabTarefasRestauradas {
  restauradas: number;
  ids: string[];
  /** As que já estavam vivas (nada a fazer). */
  jaVivas: number;
  /** Frases para a tela: lista ou pasta que continua arquivada. */
  avisos: string[];
}

export interface TrabTarefasApagadasDeVez {
  apagadas: number;
  ids: string[];
  /** As que não saíram, com o motivo (não excluída, card da implantação, vínculo que o banco protege). */
  presas: { id: string; motivo: string }[];
}
