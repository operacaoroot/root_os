/*
 * O VALOR DO CAMPO `moeda` DO TRABALHO (ROOT-06a).
 *
 * O valor mora em `WorkFieldValue.value`, a coluna de texto que já existe, na
 * forma canônica "<código ISO 4217> <decimal com duas casas>": `BRL 1500.00`,
 * `BRL -20.50`. Texto, e não número, porque guarda a moeda junto e porque cabe
 * sem perda em `Decimal(14,2)`, o tipo de `FinanceTransaction.amount` e de
 * `Contract.valor`: no máximo 12 dígitos inteiros, sempre duas casas, nunca
 * `-0.00`.
 *
 * Três caminhos chegam aqui e todos usam estas funções: o importador do ClickUp
 * (texto ou número JSON da origem), a API (que confere antes de gravar) e a
 * tela (digitação pt-BR na gaveta e exibição na tabela).
 *
 * NENHUM PASSO PASSA POR PONTO FLUTUANTE. O número JSON da origem vira texto por
 * `String()`, que devolve a menor representação exata dele, e o resto é texto e
 * expressão regular. Casa além da precisão só passa se for zero; nada é
 * arredondado. A exibição entrega ao `Intl.NumberFormat` o decimal em texto,
 * que ele formata sem converter.
 *
 * A lista de moedas é a do ICU do ambiente (`Intl.supportedValuesOf`). Código
 * ISO que o ICU não traz (XTS, XXX, BOV) é recusado como "não suportada", e não
 * como "fora da ISO". A exibição usa sempre duas casas, inclusive em moeda que
 * não tem centavos: o valor guardado tem duas, e arredondar na tela mostraria
 * outro número.
 */

export const MOEDA_PADRAO = 'BRL';

/** O teto de `Decimal(14,2)`: 14 dígitos, 2 deles depois da vírgula. */
export const DIGITOS_INTEIROS_MAXIMOS = 12;

export type ResultadoMonetario =
  | { valor: string; motivo?: undefined }
  | { valor?: undefined; motivo: string };

export const MOTIVO_DA_DIGITACAO_PT_BR = 'use vírgula para os centavos e ponto só para milhar';

const CANONICO = /^([A-Z]{3}) (-?)(0|[1-9]\d{0,11})\.(\d{2})$/;
const DECIMAL_DA_ORIGEM = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;
const DIGITADO_PT_BR = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

let suportadas: Set<string> | null | undefined;

/*
 * Navegador sem `Intl.supportedValuesOf` aceita qualquer código de três letras:
 * a tela só propõe, e quem decide o que grava é a API, que roda no Node.
 */
function moedaSuportada(codigo: string): boolean {
  if (suportadas === undefined) {
    suportadas = typeof Intl.supportedValuesOf === 'function' ? new Set(Intl.supportedValuesOf('currency')) : null;
  }
  return suportadas === null || suportadas.has(codigo);
}

/** O motivo de recusa da moeda e da precisão da origem, ou `null` quando as duas valem. */
export function motivoDaMoedaECasas(moeda: unknown, casas: unknown): string | null {
  if (typeof moeda !== 'string' || !/^[A-Z]{3}$/.test(moeda)) return 'código de moeda fora do formato de três letras maiúsculas';
  if (!moedaSuportada(moeda)) return `moeda ${moeda} não suportada`;
  if (typeof casas !== 'number' || !Number.isInteger(casas) || casas < 0 || casas > 2) {
    return `precisão ${String(casas)} não suportada (o valor guarda até 2 casas)`;
  }
  return null;
}

/**
 * Da origem (texto ou número JSON) para o canônico. Nunca arredonda, e o motivo
 * de recusa nunca repete o valor: ele circula no relatório do dry-run.
 */
export function valorMonetarioCanonico(bruto: unknown, moeda: string, casas: number): ResultadoMonetario {
  const config = motivoDaMoedaECasas(moeda, casas);
  if (config) return { motivo: config };
  if (typeof bruto === 'number') {
    if (!Number.isFinite(bruto)) return { motivo: 'número não finito' };
  } else if (typeof bruto !== 'string') {
    return { motivo: 'tipo de valor inválido' };
  }
  const m = DECIMAL_DA_ORIGEM.exec(String(bruto));
  if (!m) return { motivo: 'fora do formato decimal (sem expoente, vírgula, espaço, símbolo ou zero à esquerda)' };
  const [, sinal, inteiro, fracao = ''] = m;
  if (inteiro.length > DIGITOS_INTEIROS_MAXIMOS) {
    return { motivo: `mais de ${DIGITOS_INTEIROS_MAXIMOS} dígitos inteiros (teto de Decimal(14,2))` };
  }
  if (/[1-9]/.test(fracao.slice(casas))) return { motivo: `mais casas que a precisão ${casas}` };
  const centavos = fracao.slice(0, casas).padEnd(2, '0');
  const zero = inteiro === '0' && centavos === '00';
  return { valor: `${moeda} ${zero ? '' : sinal}${inteiro}.${centavos}` };
}

export function ehValorMonetarioCanonico(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const m = CANONICO.exec(valor);
  return !!m && moedaSuportada(m[1]) && !(m[2] === '-' && m[3] === '0' && m[4] === '00');
}

/** O código da moeda de um valor canônico; `null` para qualquer outra coisa. */
export function moedaDoValor(valor: string | null | undefined): string | null {
  return ehValorMonetarioCanonico(valor) ? valor.slice(0, 3) : null;
}

/** Canônico para o texto de digitação pt-BR: `BRL 1500.00` vira `1.500,00`. */
export function paraDigitarPtBr(canonico: string): string {
  if (!ehValorMonetarioCanonico(canonico)) return '';
  const [, , sinal, inteiro, centavos] = CANONICO.exec(canonico)!;
  return `${sinal}${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${centavos}`;
}

/**
 * Digitação pt-BR para o canônico. Vírgula separa os centavos (até duas casas)
 * e o ponto só agrupa milhar, de três em três: com ponto decimal, `1.500` seria
 * ambíguo, então `1500.00` é recusado.
 */
export function lerValorDigitadoPtBr(digitado: string, moeda: string): ResultadoMonetario {
  const m = DIGITADO_PT_BR.exec(digitado.trim());
  if (!m) return { motivo: MOTIVO_DA_DIGITACAO_PT_BR };
  const inteiro = m[2].replace(/\./g, '').replace(/^0+(?=\d)/, '');
  return valorMonetarioCanonico(`${m[1]}${inteiro}${m[3] ? `.${m[3]}` : ''}`, moeda, 2);
}

/** Canônico para a tela: `BRL 1500.00` vira `R$ 1.500,00`. Outro texto volta como veio. */
export function formatarValorMonetario(canonico: string): string {
  if (!ehValorMonetarioCanonico(canonico)) return canonico;
  const [, moeda, sinal, inteiro, centavos] = CANONICO.exec(canonico)!;
  const formato = new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: moeda, minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  // A tipagem do ES2022 só declara número, mas o `format` aceita o decimal em
  // texto e o formata exato, sem passar por ponto flutuante.
  return formato.format(`${sinal}${inteiro}.${centavos}` as unknown as number);
}
