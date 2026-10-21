import { z } from 'zod';

import type { EtapaDaTarefa, SituacaoDoPrazo } from './tarefas-do-dia.js';

/*
 * AS TAREFAS DO COMERCIAL (adendo da rodada de produção 1, 21/10/2026, §A1).
 *
 * "Comercial são leads, vai para dentro do Funil vivo." A tarefa do comercial
 * continua sendo `WorkTask` (mesma auditoria, mesmo Dia a dia), mas quem a mostra
 * e edita é o Comercial: o bloco "Tarefas do comercial" do Funil vivo (as sem
 * lead) e o bloco "Tarefas" do painel do lead (as ligadas a ele).
 *
 * É tarefa do comercial a que mora na lista do comercial (com ou sem lead) e
 * qualquer tarefa que aponte para um lead (`WorkTask.leadId`).
 *
 * O cartão do funil ganha a tarefa aberta MAIS ANTIGA do lead (menor prazo; sem
 * prazo, a criada primeiro). Ela é a próxima ação do cartão quando a ficha não
 * tem uma, ou quando o prazo dela vem no mesmo dia ou antes. É leitura derivada:
 * a ficha não é gravada (a próxima ação dela é projeção, e a régua a protege).
 */

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export const TarefaDoComercialCriarSchema = z.object({
  titulo: z.string().trim().min(1).max(300),
  /** O lead da tarefa; sem ele, é tarefa do comercial sem lead (o bloco do Funil vivo). */
  leadId: z.string().uuid().nullish(),
  pessoaId: z.string().uuid().nullish(),
  /** Dia de São Paulo (AAAA-MM-DD). */
  prazo: z.string().regex(DIA).nullish(),
}).strict();
export type TarefaDoComercialCriar = z.infer<typeof TarefaDoComercialCriarSchema>;

export const TarefaDoComercialEditarSchema = z.object({
  /** A versão lida: outra aba que salvou no meio dá 409. */
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  titulo: z.string().trim().min(1).max(300).optional(),
  pessoaId: z.string().uuid().nullable().optional(),
  prazo: z.string().regex(DIA).nullable().optional(),
  /** Concluir e reabrir: o primeiro status da lista da tarefa com esse tipo. */
  etapa: z.enum(['aberta', 'andamento', 'concluida']).optional(),
  /** Ligar a outro lead ou desligar (null). */
  leadId: z.string().uuid().nullable().optional(),
}).strict();
export type TarefaDoComercialEditar = z.infer<typeof TarefaDoComercialEditarSchema>;

export interface TarefaDoComercial {
  id: string;
  titulo: string;
  /** A pessoa da equipe (a mesma pessoa com duas contas é uma só, como no Dia a dia). */
  pessoa: { id: string; nome: string } | null;
  /** Responsável que só existe como texto (veio do ClickUp) ou conta fora da equipe. */
  responsavelTexto: string | null;
  /** Dia de São Paulo (AAAA-MM-DD). */
  prazo: string | null;
  situacao: SituacaoDoPrazo;
  status: { nome: string; tipo: EtapaDaTarefa };
  lead: { id: string; nome: string } | null;
  criadaEm: string;
  updatedAt: string;
}

export interface TarefasDoComercial {
  /** Hoje em São Paulo (AAAA-MM-DD): a régua da situação. */
  hoje: string;
  /** Quem pode ser responsável (a equipe, sem as contas do sistema). */
  pessoas: { id: string; nome: string }[];
  /** As abertas (da mais antiga para a mais nova) e, depois, as concluídas recentes. */
  tarefas: TarefaDoComercial[];
  abertas: number;
}

/** A tarefa que o cartão do funil mostra (a aberta mais antiga do lead). */
export interface TarefaNoCartaoDoFunil {
  id: string;
  titulo: string;
  /** Dia de São Paulo (AAAA-MM-DD). */
  prazo: string | null;
  situacao: SituacaoDoPrazo;
  responsavel: string | null;
  /** `true`: o cartão a mostra COMO a próxima ação; `false`: como segunda linha. */
  ehProximaAcao: boolean;
}

/** As concluídas que o histórico mostra (as mais recentes). */
export const COMERCIAL_TETO_DE_CONCLUIDAS = 30;
