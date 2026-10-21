import type { CartaoDoFunil, TarefaNoCartaoDoFunil } from '@mktos/shared';

import { dataDoDia, descricaoJaDizQuando, quandoRoda } from '@/lib/cockpit';

/*
 * A PRÓXIMA AÇÃO DO CARTÃO DO FUNIL com a tarefa do lead (adendo de 21/10/2026, §A1).
 *
 * A API já decidiu (`tarefa.ehProximaAcao`) se a tarefa aberta mais antiga do
 * lead vem antes da próxima ação da ficha. Aqui só se monta o texto: a que vem
 * primeiro é a linha principal; a outra, quando existe, é a segunda linha.
 * O prazo da tarefa é dia de São Paulo ("22/10"); o "quando" da ficha segue o
 * formato de sempre ("em 2 h").
 */

export interface LinhaDaProximaAcao {
  texto: string;
  /** O complemento de tempo ("em 2 h", "prazo 22/10"); vazio quando não há. */
  quando: string;
  /** Prazo da tarefa já passou. */
  atrasada: boolean;
}

function daTarefa(t: TarefaNoCartaoDoFunil): LinhaDaProximaAcao {
  return {
    texto: `tarefa: ${t.titulo}`,
    quando: t.prazo ? `prazo ${dataDoDia(t.prazo)}${t.situacao === 'atrasada' ? ', atrasada' : t.situacao === 'hoje' ? ', hoje' : ''}` : '',
    atrasada: t.situacao === 'atrasada',
  };
}

function daFicha(c: Pick<CartaoDoFunil, 'proximaAcao'>, agora?: Date): LinhaDaProximaAcao | null {
  if (!c.proximaAcao) return null;
  return {
    texto: c.proximaAcao.descricao,
    quando: descricaoJaDizQuando(c.proximaAcao.descricao) ? '' : quandoRoda(c.proximaAcao.quando, agora),
    atrasada: false,
  };
}

/** A linha principal (nula = "próxima ação ausente") e a segunda (nula = não há). */
export function proximaAcaoDoCartao(
  c: Pick<CartaoDoFunil, 'proximaAcao' | 'tarefa'>,
  agora?: Date,
): { principal: LinhaDaProximaAcao | null; segunda: LinhaDaProximaAcao | null } {
  const ficha = daFicha(c, agora);
  if (!c.tarefa) return { principal: ficha, segunda: null };
  const tarefa = daTarefa(c.tarefa);
  return c.tarefa.ehProximaAcao ? { principal: tarefa, segunda: ficha } : { principal: ficha, segunda: tarefa };
}

/** "2 tarefas abertas"; vazio sem nenhuma. */
export function contagemDeTarefas(n: number | null | undefined): string {
  if (!n || n <= 0) return '';
  return `${n} ${n === 1 ? 'tarefa aberta' : 'tarefas abertas'}`;
}
