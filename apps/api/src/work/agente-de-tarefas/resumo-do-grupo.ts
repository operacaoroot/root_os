import type { TarefaDoDia } from '@mktos/shared';

import { diaCurto } from './pedido-do-grupo';

/*
 * O RESUMO DO GRUPO (TR-12) — 07h e 18h, uma pessoa por bloco.
 *
 * Não chama modelo: é uma conta sobre o Dia a dia, então custa zero e diz
 * sempre a mesma coisa para o mesmo quadro.
 *
 *   07h  o dia que começa: atrasadas e as de hoje de cada pessoa.
 *   18h  o fechamento: o que de hoje e de antes ainda está aberto, e quantas
 *        vencem amanhã.
 */

export const TIPO_DO_RESUMO_DO_GRUPO = 'tarefas.resumo-do-grupo';
export const SLUG_DA_ROTINA_DO_RESUMO = 'tarefas-resumo-do-grupo';
export const CRON_DO_RESUMO = '0 7,18 * * *';
export const FUSO_DO_RESUMO = 'America/Sao_Paulo';
/** Tarefas por pessoa na mensagem; o resto vira "e mais N". */
export const POR_PESSOA = 8;

export type Turno = 'manha' | 'noite';

export function turnoDe(agora: Date): Turno {
  const hora = Number(agora.toLocaleString('en-US', { timeZone: FUSO_DO_RESUMO, hour: '2-digit', hour12: false }));
  return hora < 12 ? 'manha' : 'noite';
}

function amanhaDe(hoje: string): string {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** O que entra no bloco da pessoa: atrasadas primeiro, depois as de hoje. */
function doDia(tarefas: TarefaDoDia[]): TarefaDoDia[] {
  const peso = (t: TarefaDoDia) => (t.situacao === 'atrasada' ? 0 : 1);
  return tarefas
    .filter((t) => t.situacao === 'atrasada' || t.situacao === 'hoje')
    .sort((a, b) => peso(a) - peso(b) || (a.prazo ?? '').localeCompare(b.prazo ?? ''));
}

function linha(t: TarefaDoDia): string {
  return t.situacao === 'atrasada' ? `• ${t.titulo} — venceu ${diaCurto(t.prazo)} ⚠️` : `• ${t.titulo}`;
}

/**
 * `mencao` é o número de WhatsApp da pessoa (só dígitos, como o WhatsApp o
 * escreve). Com ele, o bloco começa com `@número`, que o WhatsApp mostra como o
 * nome do contato e notifica mesmo com o grupo silenciado. Sem ele, o nome em
 * negrito, como antes.
 */
export function montarResumo(
  turno: Turno, hoje: string, pessoas: { id: string; nome: string; mencao?: string | null }[], todas: TarefaDoDia[],
): string {
  const abertas = todas.filter((t) => t.status.tipo !== 'concluida');
  const amanha = amanhaDe(hoje);
  const blocos = pessoas.map((p) => {
    const dela = abertas.filter((t) => t.pessoas.some((x) => x.id === p.id));
    const lista = doDia(dela);
    const atrasadas = lista.filter((t) => t.situacao === 'atrasada');
    const deHoje = lista.filter((t) => t.situacao === 'hoje');
    const quem = p.mencao ? `@${p.mencao}` : `*${p.nome.split(/\s+/)[0]}*`;
    if (lista.length === 0) {
      const vazio = turno === 'manha' ? 'nada em atraso nem para hoje ✅' : 'tudo de hoje feito ✅';
      return `${quem} — ${vazio}`;
    }
    const corte = (ts: TarefaDoDia[]) =>
      ts.slice(0, POR_PESSOA).map(linha).join('\n') + (ts.length > POR_PESSOA ? `\n  …e mais ${ts.length - POR_PESSOA}` : '');
    if (turno === 'manha') {
      // 07h: primeiro o que ficou de dias anteriores, depois o de hoje.
      const partes = [
        atrasadas.length ? `_Em atraso (${atrasadas.length}):_\n${corte(atrasadas)}` : null,
        deHoje.length ? `_Para hoje (${deHoje.length}):_\n${corte(deHoje)}` : null,
      ].filter(Boolean);
      return `${quem}\n${partes.join('\n')}`;
    }
    // 18h: o resumo do que não foi feito — quanto ficou, de onde veio, e a lista.
    const deOntem = atrasadas.length ? `, ${atrasadas.length} já vinha${atrasadas.length > 1 ? 'm' : ''} atrasada${atrasadas.length > 1 ? 's' : ''}` : '';
    const vencemAmanha = dela.filter((t) => t.prazo === amanha).length;
    const rodape = vencemAmanha ? `\n  Amanhã vencem mais ${vencemAmanha}.` : '';
    return `${quem} — não ${lista.length > 1 ? 'foram feitas' : 'foi feita'} ${lista.length} (${deHoje.length} de hoje${deOntem})\n${corte(lista)}${rodape}`;
  });
  const semDono = doDia(abertas.filter((t) => t.pessoas.length === 0)).length;
  const pendentes = pessoas.reduce((n, p) => n + doDia(abertas.filter((t) => t.pessoas.some((x) => x.id === p.id))).length, 0);
  const cabeca = turno === 'manha'
    ? `☀️ *Bom dia! Começo do dia (${diaCurto(hoje)})*`
    : `🌙 *Fechamento do dia (${diaCurto(hoje)}): ${pendentes ? `${pendentes} ${pendentes > 1 ? 'tarefas ficaram' : 'tarefa ficou'} sem fazer` : 'tudo feito 🎉'}*`;
  const pe = [
    semDono ? `Sem responsável, vencendo: ${semDono}. Veja no Dia a dia.` : null,
    turno === 'noite' ? 'Concluiu? Responda: tarefa concluída: <nome da tarefa>' : null,
  ].filter(Boolean).join('\n');
  return [cabeca, '', blocos.join('\n\n'), pe ? `\n${pe}` : ''].join('\n').trim();
}
