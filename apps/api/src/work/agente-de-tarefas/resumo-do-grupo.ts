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
export const CRON_DO_RESUMO = '0 7,18 * * 1-5';
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
    turno === 'noite' ? 'Concluiu? Marque o @Root: tarefa concluída: <nome da tarefa>' : null,
  ].filter(Boolean).join('\n');
  return [cabeca, '', blocos.join('\n\n'), pe ? `\n${pe}` : ''].join('\n').trim();
}

// ---------------------------------------------------------------- feriados

/**
 * Domingo de Páscoa (computo gregoriano, algoritmo de Meeus/Jones/Butcher),
 * AAAA-MM-DD. É dele que sai a Sexta-feira Santa.
 */
export function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Os feriados NACIONAIS de lei (02/11/2026, pedido do Lucas): Lei 662/1949 com a
 * redação da Lei 10.607/2002, Lei 6.802/1980 (12/10) e Lei 14.759/2023 (20/11),
 * mais a Sexta-feira da Paixão, que a Lei 9.093/1995 manda guardar. Carnaval e
 * Corpus Christi são ponto facultativo, não feriado nacional: o resumo sai.
 */
export function feriadosNacionais(ano: number): Map<string, string> {
  const p = new Date(`${pascoa(ano)}T12:00:00Z`);
  p.setUTCDate(p.getUTCDate() - 2);
  const fixos: [string, string][] = [
    ['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência'], ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'], ['11-20', 'Dia da Consciência Negra'], ['12-25', 'Natal'],
  ];
  return new Map<string, string>([
    ...fixos.map(([md, nome]) => [`${ano}-${md}`, nome] as [string, string]),
    [p.toISOString().slice(0, 10), 'Sexta-feira da Paixão'],
  ]);
}

/** O nome do feriado nacional do dia (AAAA-MM-DD), ou `null`. */
export function feriadoNacional(dia: string): string | null {
  return feriadosNacionais(Number(dia.slice(0, 4))).get(dia) ?? null;
}
