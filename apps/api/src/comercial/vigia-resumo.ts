import { COMERCIAL_ROTULO_DA_AUTOMACAO, type PremissaDoVigia, type ResumoDoVigia } from '@mktos/shared';

/*
 * O RESUMO DO VIGIA DAS 08:00 (rodada dos agentes, 21/10/2026, CO-11) — a parte pura.
 *
 * Três linhas no topo da passagem, para quem abre a torre ler antes da lista.
 * A REGRA É A DO RELATÓRIO DO MÊS DA PAUTA (MK6): número é do sistema,
 * narrativa é da IA. O vigia já contou tudo (conferidas, quebradas, não
 * conferidas, decisões abertas, leads tocados); o modelo (Haiku 5.5, esforço
 * baixo, pelo cadastro) só escreve a frase. Linha do modelo com número que NÃO
 * é um dos do sistema sai, e a linha do sistema da mesma posição entra no
 * lugar, com aviso. O número pode vir em algarismo ou por extenso ("duas
 * premissas"): os dois são conferidos.
 *
 * Sem modelo (stub sem a fixture, provedor desligado, erro, resposta vazia), as
 * três linhas são as do sistema, montadas aqui. A passagem nunca depende do
 * modelo para existir.
 */

export const TAREFA_DO_RESUMO_DO_VIGIA = 'comercial.vigia.resumo';
const TETO_DA_LINHA = 220;

/** O mínimo da passagem que o resumo lê (a `PassagemDoVigia` do serviço cabe aqui). */
export interface PassagemParaResumo {
  dia: string;
  conferidas: number;
  quebradas: number;
  naoConferidas: number;
  decisoesAbertas: number;
  premissas: PremissaDoVigia[];
}

/** "um"/"uma" ficam de fora: são artigo na maioria das frases, e o algarismo continua conferido. */
const EXTENSO: Record<string, number> = {
  zero: 0, nenhum: 0, nenhuma: 0, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100,
};

function semAcento(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Os leads distintos tocados pelas premissas quebradas. */
export function leadsTocados(p: PassagemParaResumo): number {
  return new Set(p.premissas.filter((x) => x.ok === false).flatMap((x) => x.leads)).size;
}

/** Os números que o sistema contou nesta passagem: os únicos que uma linha pode ter. */
export function numerosDoSistema(p: PassagemParaResumo): Set<number> {
  return new Set([p.conferidas, p.quebradas, p.naoConferidas, p.decisoesAbertas, p.premissas.length, leadsTocados(p)]);
}

/** Os números escritos numa linha: algarismos (inteiros) e os por extenso conhecidos. A hora "08:00" e o dia da passagem não contam. */
export function numerosDaLinha(linha: string, dia: string): number[] {
  const sem = String(linha ?? '')
    .split(dia).join(' ')
    .replace(/\b\d{1,2}[:h]\d{2}\b/gi, ' ')
    .replace(/\b0?8\s?h\b/gi, ' ');
  const out: number[] = [];
  for (const m of sem.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const n = Number(m[0].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n)) out.push(n);
  }
  for (const palavra of semAcento(sem).split(/[^a-z]+/)) {
    if (palavra in EXTENSO) out.push(EXTENSO[palavra]);
  }
  return out;
}

/** As três linhas montadas pelo sistema (o resumo sem modelo, e o reserva de cada posição). */
export function resumoDoSistema(p: PassagemParaResumo): string[] {
  const quebradas = p.premissas.filter((x) => x.ok === false);
  const nomes = quebradas.map((x) => (x.automacao ? COMERCIAL_ROTULO_DA_AUTOMACAO[x.automacao] : x.premissa)).slice(0, 4);
  const leads = leadsTocados(p);
  return [
    p.quebradas
      ? `${p.quebradas} de ${p.conferidas} premissas conferidas hoje estão quebradas.`
      : `As ${p.conferidas} premissas conferidas hoje estão de pé.`,
    p.quebradas
      ? `Quebrou: ${nomes.join(', ')}${quebradas.length > nomes.length ? ' e outras' : ''}${leads ? `, tocando ${leads} lead(s)` : ''}.`
      : `${p.naoConferidas} premissas ficaram sem conferir (número a decidir ou fonte fora do alcance).`,
    p.decisoesAbertas
      ? `${p.decisoesAbertas} decisão(ões) nova(s) na fila: quem conserta é gente.`
      : 'Nenhuma decisão nova na fila hoje.',
  ];
}

/** O pedido ao modelo (CO-11). Os fatos são do sistema; nada de texto de terceiro entra aqui. */
export function promptDoResumoDoVigia(p: PassagemParaResumo): { system: string; user: string } {
  const system = [
    `[tarefa:${TAREFA_DO_RESUMO_DO_VIGIA}]`,
    'Você escreve o resumo da passagem diária do vigia do comercial da Root, para quem abre a torre às 08:00.',
    'Regras:',
    '- Exatamente três linhas curtas e afirmativas, em português, uma por linha, sem marcador, sem título.',
    '- Linha 1: o estado geral. Linha 2: o que quebrou (ou o que ficou sem conferir). Linha 3: o que foi para a fila de decisões.',
    '- Use SÓ os números da lista de fatos abaixo, exatamente como estão. Não some, não calcule porcentagem, não arredonde: número que não está na lista é descartado.',
    '- Sem travessão, sem emoji, sem exagero.',
  ].join('\n');
  const quebradas = p.premissas.filter((x) => x.ok === false);
  const user = [
    `FATOS DO SISTEMA (passagem de ${p.dia}):`,
    `premissas conferidas: ${p.conferidas}`,
    `premissas quebradas: ${p.quebradas}`,
    `premissas não conferidas: ${p.naoConferidas}`,
    `premissas no total: ${p.premissas.length}`,
    `leads tocados pelas quebradas: ${leadsTocados(p)}`,
    `decisões novas abertas na fila: ${p.decisoesAbertas}`,
    `quebradas: ${quebradas.length ? quebradas.map((x) => (x.automacao ? COMERCIAL_ROTULO_DA_AUTOMACAO[x.automacao] : x.premissa)).join('; ') : 'nenhuma'}`,
  ].join('\n');
  return { system, user };
}

/** Uma linha do modelo limpa: sem marcador de lista, sem travessão, numa linha só, com teto. */
function limparLinha(l: string): string {
  const t = String(l ?? '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > TETO_DA_LINHA ? `${t.slice(0, TETO_DA_LINHA - 1)}…` : t;
}

/**
 * Confere a resposta do modelo: até três linhas; linha com número que o sistema
 * não contou sai (o aviso diz qual), e a do sistema daquela posição entra.
 * Resposta nula ou vazia = as três do sistema.
 */
export function conferirResumoDoVigia(bruta: string | null, p: PassagemParaResumo): ResumoDoVigia {
  const sistema = resumoDoSistema(p);
  const avisos: string[] = [];
  const doModelo = String(bruta ?? '')
    .replace(/```[a-z]*\n?|```/gi, '')
    .split(/\r?\n/)
    .map(limparLinha)
    .filter(Boolean)
    .slice(0, 3);
  if (!doModelo.length) return { linhas: sistema, origem: 'sistema', avisos };
  const permitidos = numerosDoSistema(p);
  let usadas = 0;
  const linhas = sistema.map((reserva, i) => {
    const l = doModelo[i];
    if (!l) return reserva;
    const estranhos = numerosDaLinha(l, p.dia).filter((n) => !permitidos.has(n));
    if (estranhos.length) {
      avisos.push(`linha ${i + 1} do modelo descartada: o número ${estranhos.join(', ')} não é um dos que o vigia contou ("${l.slice(0, 120)}")`);
      return reserva;
    }
    usadas++;
    return l;
  });
  return { linhas, origem: usadas === 3 ? 'modelo' : usadas === 0 ? 'sistema' : 'misto', avisos };
}
