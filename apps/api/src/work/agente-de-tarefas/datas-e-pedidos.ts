import { tituloNormalizado } from '@mktos/shared';

/*
 * Datas e pedidos de escrita sem modelo (26/10/2026): a chave da IA da produção
 * está fora, e o Lucas precisa mudar o dia, trocar o responsável e criar tarefa
 * pelo grupo do mesmo jeito. Tudo aqui é regra; o que não fecha com segurança
 * volta `null` e o agente pede para escrever de outro jeito.
 */

export const DIAS_DA_SEMANA: Record<string, number> = {
  domingo: 0, dom: 0, segunda: 1, seg: 1, terca: 2, ter: 2, quarta: 3, qua: 3, quinta: 4, qui: 4, sexta: 5, sex: 5, sabado: 6, sab: 6,
};

/** Como o dia aparece no texto ORIGINAL (com acento e "-feira"), para tirá-lo do título. */
const DIA_NO_ORIGINAL: Record<string, string> = {
  domingo: 'domingo', dom: 'dom', segunda: 'segunda', seg: 'seg', terca: 'ter[çc]a', ter: 'ter', quarta: 'quarta', qua: 'qua',
  quinta: 'quinta', qui: 'qui', sexta: 'sexta', sex: 'sex', sabado: 's[áa]bado', sab: 's[áa]b',
};

function somar(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dois(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * A data do pedido, AAAA-MM-DD, e o trecho a tirar do título; `null` sem data.
 * `norm` é o texto sem acento (`tituloNormalizado`); `original`, como foi
 * digitado (a barra de "05/11" só existe nele).
 */
export function dataDoTexto(norm: string, hoje: string, original = ''): { dia: string; trecho: RegExp } | null {
  const semana = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  const [ano, mes, diaHoje] = hoje.split('-').map(Number);
  if (/\bdepois de amanha\b/.test(norm)) return { dia: somar(hoje, 2), trecho: /depois de amanh[ãa]/i };
  if (/\bamanha\b/.test(norm)) return { dia: somar(hoje, 1), trecho: /amanh[ãa]/i };
  if (/\bhoje\b/.test(norm)) return { dia: hoje, trecho: /\bhoje\b/i };
  if (/\b(semana que vem|proxima semana)\b/.test(norm)) {
    return { dia: somar(hoje, ((8 - semana) % 7) || 7), trecho: /(semana que vem|pr[óo]xima semana)/i };
  }
  const barra = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(original);
  if (barra) {
    const d = Number(barra[1]), me = Number(barra[2]);
    let a = barra[3] ? Number(barra[3].length === 2 ? `20${barra[3]}` : barra[3]) : ano;
    if (!barra[3] && (me < mes || (me === mes && d < diaHoje))) a++;
    if (me >= 1 && me <= 12 && d >= 1 && d <= 31) return { dia: `${a}-${dois(me)}-${dois(d)}`, trecho: /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/ };
  }
  const doDia = /\bdia (\d{1,2})\b/.exec(norm);
  if (doDia) {
    const d = Number(doDia[1]);
    if (d >= 1 && d <= 31) {
      let a = ano, me = mes;
      if (d < diaHoje) { me++; if (me > 12) { me = 1; a++; } }
      return { dia: `${a}-${dois(me)}-${dois(d)}`, trecho: /\bdia \d{1,2}\b/i };
    }
  }
  const palavras = norm.split(' ');
  for (const [nome, alvo] of Object.entries(DIAS_DA_SEMANA)) {
    if (!palavras.includes(nome)) continue;
    const n = ((alvo - semana + 7) % 7) || 7;
    return { dia: somar(hoje, n), trecho: new RegExp('\\b' + DIA_NO_ORIGINAL[nome] + '(\\s?-?\\s?feira)?\\b', 'i') };
  }
  return null;
}

export const VERBO_DE_MUDAR = /\b(muda\w*|mude|passa\w*|passe|adia\w*|joga\w*|remarca\w*|empurra\w*|transfer\w*|troca\w*|move\w*|coloca\w*|poe|bota|deixa)\b/;
export const VERBO_DE_CRIAR = /^(nova tarefa|tarefa|cria\w*|crie|anota\w*|adiciona\w*|lembr\w*)\b/;

/** A pessoa da equipe citada pelo primeiro nome ("pro Pedro", "pra Rodrigo"). */
export function pessoaDoTexto(norm: string, pessoas: { nome: string }[]): string | null {
  const palavras = norm.split(' ');
  return pessoas.find((p) => palavras.includes(tituloNormalizado(p.nome).split(' ')[0]))?.nome ?? null;
}

/**
 * O título de uma tarefa nova, tirado do texto ORIGINAL (com acento): sai o
 * verbo de criar, a pessoa ("pro Pedro"), a data ("até sexta") e a pontuação
 * da frente. "tarefa pro Pedro: revisar contrato da Custeio até sexta" →
 * "Revisar contrato da Custeio".
 */
export function tituloDaNova(original: string, pessoa: string | null, trechoDaData: RegExp | null): string {
  let t = original.replace(
    /^\s*(nova tarefa|tarefa|cria(r)?( uma)?( tarefa)?|crie( uma)?( tarefa)?|anota(r)?( a[ií])?|adiciona(r)?( uma)?( tarefa)?|lembra(r)?( de)?)\b/i, '');
  if (pessoa) {
    const primeiro = pessoa.split(/\s+/)[0];
    t = t.replace(new RegExp('(^|\\s)((pr[oa]|para( o| a)?|com)\\s+)?' + primeiro + '(?=$|[\\s:,.])', 'i'), ' ');
  }
  // O "(^|\\s)" impede de comer a última letra da palavra de antes ("proposta amanhã" virava "propost").
  if (trechoDaData) t = t.replace(new RegExp('(^|\\s)((at[ée]|pra|para|pro|na|no|em|de)\\s+)?((o|a)\\s+)?' + trechoDaData.source, 'i'), ' ');
  t = t.replace(/\s+/g, ' ').replace(/^[\s:,.\-–—]+|[\s:,.\-–—]+$/g, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}
