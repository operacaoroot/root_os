import { z } from 'zod';

import type { ContratoVivo } from './comercial.js';
import { FECHADO_FORA_MAX_BYTES } from './comercial-fechado-fora.js';

/*
 * O CONTRATO IMPORTADO DO CRM ANTIGO: O PDF E AS PARCELAS À MÃO (rodada de
 * produção 2, 22/10/2026, sugestões 6 e 7).
 *
 * O importador trouxe cada subtarefa de "Contratos dos clientes" como um
 * contrato vivo sem PDF e sem parcela (`contrato.importado`). Esta parte deixa
 * a mesa completar o que falta, como FATO PASSADO (decisão do dono do produto
 * de 21/10): nada vai à porta, nada cobra, nada sai para fora.
 *
 *   · o PDF entra pelo MESMO armazém e o MESMO fato `contrato.anexado` do
 *     "Registrar cliente já fechado", com `procedencia: 'importado'` e a origem
 *     do contrato. Outro PDF é versão nova; o mesmo PDF não grava nada;
 *   · as parcelas são lançadas à mão (em série mensal ou linha a linha), em
 *     centavos inteiros e dias de São Paulo, cada lançamento uma versão nova
 *     de `contrato.parcelas_lancadas`;
 *   · a régua de cobrança fica DESLIGADA até uma pessoa ligar
 *     (`contrato.regua_ligada`). Ligada, a régua é dona das parcelas: a tela
 *     não as edita mais.
 *
 * Sem Nest e sem banco: a API e a tela usam as mesmas contas.
 */

/** A procedência do PDF anexado a um contrato que veio do CRM antigo. */
export const PROCEDENCIA_DO_CONTRATO_IMPORTADO = 'importado';
/** O teto do PDF: o mesmo do "Registrar cliente já fechado". */
export const CONTRATO_IMPORTADO_MAX_BYTES = FECHADO_FORA_MAX_BYTES;
/** No máximo dez anos de parcelas mensais por contrato. */
export const PARCELAS_MANUAIS_MAX = 120;
/** O teto de uma parcela (R$ 1 milhão), o mesmo do valor declarado no fechado fora. */
export const PARCELA_MANUAL_MAX_CENTAVOS = 100_000_000;

/** A origem do contrato importado: `cartao:<id da subtarefa>`, como o importador grava. */
export const ORIGEM_DO_CONTRATO_IMPORTADO = /^cartao:[A-Za-z0-9_-]{1,120}$/;

/** AAAA-MM-DD que existe no calendário (31/02 não passa; o `Date` do JS aceitaria e viraria março). */
export function diaDeVerdade(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 2000 || a > 2100 || mes < 1 || mes > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(a, mes, 0)).getUTCDate();
}

/** Soma meses a um dia AAAA-MM-DD; o dia que não existe no mês cai no último (31/01 + 1 = 28 ou 29/02). */
export function somarMesesAoDia(dia: string, meses: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/** Uma linha lançada: valor em centavos inteiros, vencimento e, se já foi paga fora, o dia do pagamento. */
export interface LinhaDeParcela {
  valorCentavos: number;
  vence: string;
  pagaEm: string | null;
}

/** A parcela numerada (1, 2, 3... na ordem do vencimento). */
export interface ParcelaManual extends LinhaDeParcela {
  n: number;
}

const dia = z.string().refine(diaDeVerdade, 'data no formato AAAA-MM-DD, que exista no calendário');
const centavos = z.number().int('valor em centavos inteiros').positive('valor maior que zero').max(PARCELA_MANUAL_MAX_CENTAVOS, 'parcela acima de R$ 1.000.000');
const origem = z.string().regex(ORIGEM_DO_CONTRATO_IMPORTADO, 'origem do contrato importado inválida');

export const LinhaDeParcelaSchema = z.object({
  valorCentavos: centavos,
  vence: dia,
  pagaEm: dia.nullable().optional(),
}).strict();

/** Mensal: N parcelas do mesmo valor a partir do 1º vencimento. */
export const SerieDeParcelasSchema = z.object({
  quantidade: z.number().int().min(1).max(PARCELAS_MANUAIS_MAX),
  valorCentavos: centavos,
  primeiroVencimento: dia,
}).strict();

/**
 * Lançar as parcelas de um contrato importado: em série OU linha a linha (uma das duas).
 * `versaoEsperada` é a versão que a tela leu (0 = nenhuma): outra aba salvou no meio, 409.
 */
export const ParcelasDoImportadoSchema = z.object({
  origem,
  versaoEsperada: z.number().int().min(0),
  serie: SerieDeParcelasSchema.optional(),
  linhas: z.array(LinhaDeParcelaSchema).min(1, 'lance ao menos uma parcela').max(PARCELAS_MANUAIS_MAX).optional(),
}).strict().superRefine((v, ctx) => {
  if (!!v.serie === !!v.linhas) ctx.addIssue({ code: 'custom', path: ['linhas'], message: 'mande a série mensal ou as linhas, uma das duas' });
});
export type ParcelasDoImportadoInput = z.infer<typeof ParcelasDoImportadoSchema>;

/** Ligar a régua: a versão das parcelas que a pessoa viu e a ciência do que vai acontecer. */
export const LigarReguaDoImportadoSchema = z.object({
  origem,
  versaoDasParcelas: z.number().int().min(1),
  ciente: z.literal(true, { errorMap: () => ({ message: 'confirme que leu o que acontece ao ligar a régua' }) }),
}).strict();
export type LigarReguaDoImportadoInput = z.infer<typeof LigarReguaDoImportadoSchema>;

/** As linhas de uma série mensal: o mesmo valor, um mês depois do outro. */
export function parcelasEmSerie(quantidade: number, valorCentavos: number, primeiroVencimento: string): LinhaDeParcela[] {
  return Array.from({ length: Math.max(0, Math.trunc(quantidade)) }, (_, i) => ({ valorCentavos, vence: somarMesesAoDia(primeiroVencimento, i), pagaEm: null }));
}

/** Numera na ordem do vencimento (empate: a ordem em que foram lançadas). */
export function numerarParcelas(linhas: readonly LinhaDeParcela[]): ParcelaManual[] {
  return linhas
    .map((l, i) => ({ l, i }))
    .sort((a, b) => a.l.vence.localeCompare(b.l.vence) || a.i - b.i)
    .map(({ l }, k) => ({ n: k + 1, valorCentavos: l.valorCentavos, vence: l.vence, pagaEm: l.pagaEm ?? null }));
}

/** A soma, em centavos inteiros. */
export function somaDasParcelas(linhas: readonly { valorCentavos: number }[]): number {
  return linhas.reduce((s, l) => s + l.valorCentavos, 0);
}

/** As linhas do lançamento, já numeradas (a série vira linhas aqui, na API e na tela). */
export function linhasDoLancamento(input: Pick<ParcelasDoImportadoInput, 'serie' | 'linhas'>): ParcelaManual[] {
  if (input.serie) return numerarParcelas(parcelasEmSerie(input.serie.quantidade, input.serie.valorCentavos, input.serie.primeiroVencimento));
  return numerarParcelas((input.linhas ?? []).map((l) => ({ valorCentavos: l.valorCentavos, vence: l.vence, pagaEm: l.pagaEm ?? null })));
}

function reais(c: number): string {
  const inteiro = Math.trunc(Math.abs(c) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${inteiro},${(Math.abs(c) % 100).toString().padStart(2, '0')}`;
}

/**
 * O que acontece ao ligar a régua, na frase que a tela mostra e a auditoria guarda.
 * A régua de hoje grava os avisos D-3, D0, D+1, D+5 e D+10 no fio e abre uma decisão
 * no D+10; os textos ao cliente são [a decidir], então nada sai para ele.
 */
export function fraseDeLigarARegua(parcelas: readonly LinhaDeParcela[], hoje: string): string {
  const abertas = parcelas.filter((p) => !p.pagaEm);
  if (!abertas.length) return 'Todas as parcelas estão pagas: ligar a régua não gera aviso nenhum.';
  const vencidas = abertas.filter((p) => p.vence < hoje);
  const partes = [`Ao ligar, a régua de cobrança passa a valer para ${abertas.length} parcela${abertas.length > 1 ? 's' : ''} em aberto, somando ${reais(somaDasParcelas(abertas))}.`];
  if (vencidas.length) {
    partes.push(`${vencidas.length} já ${vencidas.length > 1 ? 'venceram e entram' : 'venceu e entra'} no aviso do dia; vencida há 10 dias ou mais abre uma decisão na fila.`);
  }
  partes.push('Os avisos ficam no fio e na fila de decisões. Nenhuma mensagem vai ao cliente e nenhuma cobrança nasce no Asaas.');
  partes.push('Depois de ligada, as parcelas não se editam mais por aqui.');
  return partes.join(' ');
}

/** O PDF anexado a um contrato importado (o mais novo; os anteriores ficam no fio). */
export interface AnexoDoImportado {
  nome: string;
  bytes: number;
  sha256: string;
  /** ISO do anexo. */
  em: string;
  versao: number;
  por: string | null;
}

/** Uma parcela lançada, com o estado de hoje e o último aviso da régua. */
export interface ParcelaManualNaTela extends ParcelaManual {
  estado: 'paga' | 'pendente' | 'atrasada';
  aviso: string | null;
}

/** As parcelas lançadas à mão (a versão mais nova). */
export interface ParcelasDoImportado {
  versao: number;
  linhas: ParcelaManualNaTela[];
  somaCentavos: number;
  /** ISO do lançamento. */
  em: string;
  por: string | null;
}

/** A régua de cobrança do contrato importado: desligada até uma pessoa ligar. */
export interface ReguaDoImportado {
  ligada: boolean;
  em: string | null;
  por: string | null;
}

/** O que as três escritas devolvem: se gravou, a versão e o contrato vivo relido. */
export interface ResultadoDoContratoImportado {
  /** `false` quando nada mudou (o mesmo PDF, as mesmas parcelas, a régua já ligada). */
  novo: boolean;
  versao: number;
  contrato: ContratoVivo;
}
