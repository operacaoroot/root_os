import {
  PAUTA_SECOES_DO_RELATORIO,
  PAUTA_TETO_DO_RELATORIO,
  type PautaRelatorioDaIa,
} from '@mktos/shared';
import { neutralizarConteudoExterno } from '../agents/context-builder.service';
import { parseJsonDaIa } from './parse-json';

/*
 * ============================================================================
 * O RELATÓRIO DO MÊS (MK6) — a parte pura
 * ============================================================================
 *
 * A REGRA DESTA FATIA: número é do sistema, narrativa é da IA.
 *
 * "O que foi ao ar" e "Como rendeu" são montados da consulta ao banco, linha
 * por linha. O modelo escreve só a leitura do mês, as decisões e os próximos
 * passos — e recebe os números prontos, sem poder somar nada. Relatório é
 * prestação de contas: número que um modelo escreveu é número que ninguém
 * consegue conferir depois, e o erro sobrevive porque tem cara de relatório.
 *
 * A seção de performance DECLARA A AUSÊNCIA enquanto a MK5 não existe e o
 * Instagram não está conectado, em vez de sumir. Seção que some esconde a
 * pergunta; seção que diz "não medimos, e é por isto" mantém a pergunta viva.
 */

export interface PecaDoMes {
  titulo: string;
  canal: string;
  formato: string;
  publicadaEm: string | null;
  urlPublicada: string | null;
}

export interface DadosDoRelatorio {
  mes: string;
  pecas: PecaDoMes[];
  /** A estratégia que valia no mês, se houver. */
  estrategia: string;
  /** A do mês seguinte, quando já existe: é dela que saem os próximos passos. */
  estrategiaSeguinte: string;
  /** Por que não há número de desempenho ainda. Vazio quando houver (MK5). */
  motivoSemPerformance: string;
}

const limpo = (t: string) => neutralizarConteudoExterno(String(t ?? '')).texto.trim();

export const SYSTEM_RELATORIO = `Você escreve o fechamento de UM mês de conteúdo para quem toca o negócio.

Recebe a lista do que foi publicado, a estratégia que valia e, quando houver, a do mês seguinte.
Os números já estão contados: não some, não estime e não invente nenhum.

Responda SOMENTE com um objeto JSON válido, sem cercas de código:
{
  "leitura": string,           // 2 a 4 frases: o que este mês mostrou, sem elogio e sem desculpa
  "decisoes": [string],        // até 6: o que foi decidido no mês, lido do que foi publicado e da estratégia
  "proximosPassos": [string]   // até 6: o que fazer no mês seguinte, cada um uma ação
}

Regras:
- Só afirme o que a lista sustenta. Sem dado para uma afirmação, ela não entra.
- Não escreva número nenhum que não esteja no material: nem soma, nem média, nem porcentagem.
- Se o mês não publicou nada, diga isso na leitura, sem rodeio e sem culpar ninguém.
- Decisão é o que mudou de rumo, não a lista do que saiu.
- Português do Brasil, sem emoji.`;

export function entradaDoRelatorio(d: DadosDoRelatorio): string {
  const partes: string[] = [`Mês fechado: ${d.mes}.`];

  partes.push(
    d.pecas.length
      ? `\n--- O que foi publicado (${d.pecas.length}) ---\n${d.pecas
          .map((p) => `- ${limpo(p.titulo)} (${p.canal}/${p.formato}${p.publicadaEm ? `, ${p.publicadaEm.slice(0, 10)}` : ''})`)
          .join('\n')}`
      : '\n--- O que foi publicado ---\nNada foi publicado neste mês.',
  );

  partes.push(
    d.estrategia.trim()
      ? `\n--- A estratégia que valia ---\n${limpo(d.estrategia)}`
      : '\n--- A estratégia que valia ---\nNão havia estratégia escrita para este mês.',
  );

  if (d.estrategiaSeguinte.trim()) {
    partes.push(`\n--- A estratégia do mês seguinte, já escrita ---\n${limpo(d.estrategiaSeguinte)}`);
  }

  if (d.motivoSemPerformance) {
    partes.push(`\n--- Desempenho ---\n${d.motivoSemPerformance} Não fale de desempenho como se houvesse número.`);
  }

  return partes.join('\n');
}

export class RelatorioInvalidoError extends Error {}

const linha = (v: unknown, teto: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, teto) : '';

function lista(v: unknown, max: number, teto: number): string[] {
  if (!Array.isArray(v)) return [];
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    const l = linha(x, teto);
    if (!l || vistos.has(l.toLowerCase())) continue;
    vistos.add(l.toLowerCase());
    out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

export function lerRelatorioDaIa(saida: string): PautaRelatorioDaIa {
  let bruto: unknown;
  try {
    bruto = parseJsonDaIa<unknown>(saida);
  } catch {
    throw new RelatorioInvalidoError('A IA não devolveu o relatório em JSON — nada foi gravado. Tente de novo.');
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw new RelatorioInvalidoError('A IA não devolveu o relatório em JSON — nada foi gravado. Tente de novo.');
  }
  const b = bruto as Record<string, unknown>;
  const leitura = linha(b.leitura, 1200);
  if (!leitura) {
    throw new RelatorioInvalidoError('O relatório veio sem a leitura do mês — nada foi gravado. Tente de novo.');
  }
  return {
    leitura,
    decisoes: lista(b.decisoes, 6, 240),
    proximosPassos: lista(b.proximosPassos, 6, 240),
  };
}

/**
 * O markdown. As seções de número saem dos DADOS; as de texto, do modelo. Quem
 * lê tem de conseguir dizer, de cada linha, de onde ela veio — por isso a lista
 * do que foi ao ar é a consulta crua, com data e link.
 */
export function montarRelatorio(d: DadosDoRelatorio, n: PautaRelatorioDaIa): string {
  const itens = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`) : ['—']);

  const oQueFoiAoAr = d.pecas.length
    ? d.pecas.map((p) => {
        const quando = p.publicadaEm ? p.publicadaEm.slice(0, 10) : 'sem data';
        const link = p.urlPublicada ? ` — ${p.urlPublicada}` : '';
        return `- ${quando} · ${p.canal}/${p.formato} · ${p.titulo}${link}`;
      })
    : ['Nada foi publicado neste mês.'];

  const md = [
    `# Relatório de ${d.mes}`,
    '',
    n.leitura,
    '',
    `## ${PAUTA_SECOES_DO_RELATORIO[0]}`,
    `${d.pecas.length} peça(s) publicada(s).`,
    '',
    ...oQueFoiAoAr,
    '',
    `## ${PAUTA_SECOES_DO_RELATORIO[1]}`,
    ...itens(n.decisoes),
    '',
    `## ${PAUTA_SECOES_DO_RELATORIO[2]}`,
    d.motivoSemPerformance || 'Sem número de desempenho neste relatório.',
    '',
    `## ${PAUTA_SECOES_DO_RELATORIO[3]}`,
    ...itens(n.proximosPassos),
    '',
    `## ${PAUTA_SECOES_DO_RELATORIO[4]}`,
    d.estrategia.trim() || 'Não havia estratégia escrita para este mês.',
  ]
    .join('\n')
    .trimEnd();

  return md.length <= PAUTA_TETO_DO_RELATORIO ? md : md.slice(0, PAUTA_TETO_DO_RELATORIO).trimEnd();
}
