/*
 * O FUNIL VIVO EM LISTA (rodada de produção 3, I5, 22/10/2026): a parte sem tela.
 *
 * O Rodrigo achou a lista "horrível": colunas coladas, sem formatação. Aqui mora
 * o que a tabela decide sem desenhar nada, para ser testado sozinho:
 *   · o catálogo das colunas (rótulo, largura mínima e padrão, se ordena);
 *   · as colunas visíveis e a ordenação NO ENDEREÇO (`?colunas=`, `?ordem=`),
 *     que é o que a vista salva leva e o link compartilhado carrega;
 *   · as larguras no NAVEGADOR (localStorage): são do aparelho, não da vista;
 *   · a ordenação dos cartões (estável, vazio sempre no fim);
 *   · o dinheiro e as datas em pt-BR, no fuso de São Paulo.
 *
 * Fica fora do page.tsx porque página do App Router não exporta nada além do componente.
 */
import { COMERCIAL_ETAPAS, COMERCIAL_SAIDAS, type CartaoDoFunil } from '@mktos/shared';

import { ROTULO_DO_PRODUTO } from '@/lib/cockpit';

export type ChaveDaColuna =
  | 'empresa'
  | 'contato'
  | 'etapa'
  | 'responsavel'
  | 'produto'
  | 'perfil'
  | 'valor'
  | 'dias'
  | 'desde'
  | 'reuniao'
  | 'proxima'
  | 'pendencias';

export interface ColunaDaLista {
  chave: ChaveDaColuna;
  rotulo: string;
  /** Largura mínima em px: abaixo disso o texto deixa de ser legível. */
  minimo: number;
  /** Largura de partida em px (sem nada guardado no navegador). */
  padrao: number;
  ordenavel: boolean;
  /** Número alinhado à direita. */
  numerica?: boolean;
  /** Não sai da tabela (é a identidade da linha). */
  fixa?: boolean;
}

/** A ordem do catálogo é a ordem da tabela. */
export const COLUNAS_DA_LISTA: readonly ColunaDaLista[] = [
  { chave: 'empresa', rotulo: 'Empresa', minimo: 160, padrao: 220, ordenavel: true, fixa: true },
  { chave: 'contato', rotulo: 'Contato', minimo: 120, padrao: 160, ordenavel: true },
  { chave: 'etapa', rotulo: 'Etapa', minimo: 130, padrao: 170, ordenavel: true },
  { chave: 'responsavel', rotulo: 'Responsável', minimo: 96, padrao: 112, ordenavel: true },
  { chave: 'produto', rotulo: 'Produto', minimo: 110, padrao: 150, ordenavel: true },
  { chave: 'perfil', rotulo: 'Perfil', minimo: 72, padrao: 80, ordenavel: true },
  { chave: 'valor', rotulo: 'Valor', minimo: 100, padrao: 128, ordenavel: true, numerica: true },
  { chave: 'dias', rotulo: 'Dias na etapa', minimo: 96, padrao: 112, ordenavel: true, numerica: true },
  { chave: 'desde', rotulo: 'Na etapa desde', minimo: 104, padrao: 124, ordenavel: true },
  { chave: 'reuniao', rotulo: 'Reunião', minimo: 104, padrao: 128, ordenavel: true },
  { chave: 'proxima', rotulo: 'Próxima ação', minimo: 200, padrao: 280, ordenavel: true },
  { chave: 'pendencias', rotulo: 'Pendências', minimo: 160, padrao: 220, ordenavel: false },
];

const PELA_CHAVE = new Map(COLUNAS_DA_LISTA.map((c) => [c.chave, c]));
export const colunaDa = (chave: ChaveDaColuna): ColunaDaLista => PELA_CHAVE.get(chave)!;

/** As colunas de quem nunca escolheu: as de antes, mais o valor. */
export const COLUNAS_PADRAO: readonly ChaveDaColuna[] = ['empresa', 'contato', 'etapa', 'responsavel', 'produto', 'valor', 'dias', 'proxima', 'pendencias'];

/** Largura máxima de uma coluna (px): mais que isso é arrasto que passou do ponto. */
export const LARGURA_MAXIMA = 640;
/** A chave do localStorage onde ficam as larguras deste navegador. */
export const CHAVE_DAS_LARGURAS = 'mktos.funil.lista.larguras';

const ehChave = (x: string): x is ChaveDaColuna => PELA_CHAVE.has(x as ChaveDaColuna);

/**
 * As colunas visíveis a partir do endereço (`a,b,c`) ou da vista salva (lista).
 * Chave desconhecida sai; a empresa entra sempre; a ordem é a do catálogo.
 * Nada que valha = o padrão.
 */
export function lerColunas(entrada: string | readonly string[] | null | undefined): ChaveDaColuna[] {
  const lidas = (typeof entrada === 'string' ? entrada.split(',') : entrada ?? []).map((x) => x.trim()).filter(ehChave);
  if (!lidas.length) return [...COLUNAS_PADRAO];
  const set = new Set<ChaveDaColuna>(['empresa', ...lidas]);
  return COLUNAS_DA_LISTA.filter((c) => set.has(c.chave)).map((c) => c.chave);
}

export function saoAsPadrao(colunas: readonly ChaveDaColuna[]): boolean {
  return colunas.length === COLUNAS_PADRAO.length && COLUNAS_PADRAO.every((c) => colunas.includes(c));
}

/** O texto do endereço; vazio quando é o padrão (a chave sai do endereço). */
export function colunasNoEndereco(colunas: readonly ChaveDaColuna[]): string {
  return saoAsPadrao(colunas) ? '' : lerColunas(colunas).join(',');
}

/** Liga ou desliga uma coluna. A empresa não sai. */
export function alternarColuna(colunas: readonly ChaveDaColuna[], chave: ChaveDaColuna): ChaveDaColuna[] {
  if (colunaDa(chave).fixa) return lerColunas(colunas);
  return lerColunas(colunas.includes(chave) ? colunas.filter((c) => c !== chave) : [...colunas, chave]);
}

// ------------------------------------------------------------------ a ordenação

export type DirecaoDaOrdem = 'asc' | 'desc';
export interface OrdemDaLista {
  chave: ChaveDaColuna;
  direcao: DirecaoDaOrdem;
}

/** `valor:desc` → a ordem; coluna que não ordena ou texto torto = sem ordem. */
export function lerOrdem(texto: string | null | undefined): OrdemDaLista | null {
  const m = /^([a-z]+):(asc|desc)$/.exec((texto ?? '').trim());
  if (!m || !ehChave(m[1]) || !colunaDa(m[1]).ordenavel) return null;
  return { chave: m[1], direcao: m[2] as DirecaoDaOrdem };
}

export function ordemNoEndereco(ordem: OrdemDaLista | null): string {
  return ordem ? `${ordem.chave}:${ordem.direcao}` : '';
}

/** O clique no cabeçalho: crescente, decrescente, e de novo sem ordem (a da API). */
export function proximaOrdem(atual: OrdemDaLista | null, chave: ChaveDaColuna): OrdemDaLista | null {
  if (!colunaDa(chave).ordenavel) return atual;
  if (!atual || atual.chave !== chave) return { chave, direcao: 'asc' };
  return atual.direcao === 'asc' ? { chave, direcao: 'desc' } : null;
}

export function ariaSort(ordem: OrdemDaLista | null, chave: ChaveDaColuna): 'ascending' | 'descending' | 'none' {
  if (!ordem || ordem.chave !== chave) return 'none';
  return ordem.direcao === 'asc' ? 'ascending' : 'descending';
}

const ORDEM_DAS_ETAPAS: readonly string[] = [...COMERCIAL_ETAPAS, ...COMERCIAL_SAIDAS];
const instante = (iso: string | null | undefined) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** O instante da próxima ação que o cartão mostra primeiro (a tarefa pelo prazo, a ficha pelo "quando"). */
function instanteDaProxima(c: CartaoDoFunil): number | null {
  if (c.tarefa?.ehProximaAcao) return c.tarefa.prazo ? instante(`${c.tarefa.prazo}T12:00:00-03:00`) : null;
  return instante(c.proximaAcao?.quando) ?? (c.tarefa?.prazo ? instante(`${c.tarefa.prazo}T12:00:00-03:00`) : null);
}

/** O valor de comparação de cada coluna. Nulo = vazio, que vai sempre para o fim. */
export function valorParaOrdenar(c: CartaoDoFunil, chave: ChaveDaColuna): string | number | null {
  switch (chave) {
    case 'empresa': return c.empresa ?? c.nome;
    case 'contato': return c.nome || null;
    case 'etapa': return ORDEM_DAS_ETAPAS.indexOf(c.etapa);
    case 'responsavel': return c.dono ?? null;
    case 'produto': return c.produto ? ROTULO_DO_PRODUTO[c.produto] : null;
    case 'perfil': return c.perfil ?? null;
    case 'valor': return c.valorCentavos ?? null;
    case 'dias': return c.diasNaEtapa;
    case 'desde': return instante(c.etapaDesde);
    case 'reuniao': return instante(c.reuniaoEm);
    case 'proxima': return instanteDaProxima(c);
    case 'pendencias': return null;
  }
}

const comparar = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true }).compare;

/** Ordena sem mexer na lista de entrada. Estável; o vazio fica no fim nas duas direções. */
export function ordenarCartoes(cartoes: readonly CartaoDoFunil[], ordem: OrdemDaLista | null): CartaoDoFunil[] {
  if (!ordem) return [...cartoes];
  const sinal = ordem.direcao === 'asc' ? 1 : -1;
  return cartoes
    .map((c, i) => ({ c, i, v: valorParaOrdenar(c, ordem.chave) }))
    .sort((a, b) => {
      if (a.v === null || a.v === '') return b.v === null || b.v === '' ? a.i - b.i : 1;
      if (b.v === null || b.v === '') return -1;
      const d = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : comparar(String(a.v), String(b.v));
      return d === 0 ? a.i - b.i : d * sinal;
    })
    .map((x) => x.c);
}

// ------------------------------------------------------------------ as larguras

export type Larguras = Partial<Record<ChaveDaColuna, number>>;

/** Prende a largura entre o mínimo da coluna e o máximo. */
export function limitarLargura(chave: ChaveDaColuna, px: number): number {
  const c = colunaDa(chave);
  if (!Number.isFinite(px)) return c.padrao;
  return Math.round(Math.min(LARGURA_MAXIMA, Math.max(c.minimo, px)));
}

/** O que está guardado no navegador, conferido: JSON torto ou chave desconhecida não derrubam a tela. */
export function lerLarguras(texto: string | null | undefined): Larguras {
  if (!texto) return {};
  let cru: unknown;
  try {
    cru = JSON.parse(texto);
  } catch {
    return {};
  }
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) return {};
  const saida: Larguras = {};
  for (const [k, v] of Object.entries(cru as Record<string, unknown>)) {
    if (ehChave(k) && typeof v === 'number') saida[k] = limitarLargura(k, v);
  }
  return saida;
}

export function larguraDa(larguras: Larguras, chave: ChaveDaColuna): number {
  return larguras[chave] ?? colunaDa(chave).padrao;
}

/** A largura total da tabela: a soma das colunas visíveis (a rolagem para o lado é da tabela). */
export function larguraDaTabela(larguras: Larguras, colunas: readonly ChaveDaColuna[]): number {
  return colunas.reduce((s, c) => s + larguraDa(larguras, c), 0);
}

// ------------------------------------------------------------------ o texto das células

const FUSO = 'America/Sao_Paulo';

/** "R$ 12.500,00"; vazio quando a ficha não tem valor (ausente nunca vira zero). */
export function dinheiro(centavos: number | null | undefined): string {
  if (centavos == null || !Number.isFinite(centavos)) return '';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function partes(iso: string): { dia: string; mes: string; ano: string; hora: string; minuto: string } | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, x.value]));
  return { dia: p.day, mes: p.month, ano: p.year, hora: String(Number(p.hour) % 24).padStart(2, '0'), minuto: p.minute };
}

/** "22/10" no ano de agora, "22/10/2025" fora dele; em São Paulo. */
export function dataCurta(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return '';
  const p = partes(iso);
  const hoje = partes(agora.toISOString());
  if (!p) return '';
  return p.ano === hoje?.ano ? `${p.dia}/${p.mes}` : `${p.dia}/${p.mes}/${p.ano}`;
}

/** "22/10/2026 14:30" em São Paulo (o balão da célula). */
export function dataCompleta(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = partes(iso);
  return p ? `${p.dia}/${p.mes}/${p.ano} ${p.hora}:${p.minuto}` : '';
}

/** As iniciais do avatar: primeira e última palavra ("Ana Paula Souza" → "AS"). */
export function iniciais(nome: string | null | undefined): string {
  const palavras = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!palavras.length) return '';
  const primeira = palavras[0][0] ?? '';
  const ultima = palavras.length > 1 ? (palavras[palavras.length - 1][0] ?? '') : '';
  return `${primeira}${ultima}`.toLocaleUpperCase('pt-BR');
}

/** O tom do chip da etapa: fechado é bom, contrato é a marca, saída é alerta. */
export function tomDaEtapa(etapa: CartaoDoFunil['etapa']): 'neutro' | 'brand' | 'bom' | 'alerta' {
  if (etapa === 'fechado') return 'bom';
  if (etapa === 'contrato') return 'brand';
  if ((COMERCIAL_SAIDAS as readonly string[]).includes(etapa)) return 'alerta';
  return 'neutro';
}
