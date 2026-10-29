/*
 * PARCELAS DO ACORDO E OCORRÊNCIAS DE CONTRATO (29/10/2026) — as contas puras.
 *
 * Uma cobrança do Asaas veste uma parcela quando o nome do pagador bate com o
 * cliente ou um apelido do acordo, o valor é o mesmo e o vencimento cai perto.
 * O mesmo vale para o previsto que um contrato recorrente gerou (Curral: o
 * contrato gera no dia 6 e o Asaas cobra no dia 10; são a mesma mensalidade).
 */

/** Distância máxima entre o vencimento da parcela e o da cobrança, em dias. */
export const JANELA_PARCELA_DIAS = 20;

const DIA = 86400_000;
const minusculo = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** As chaves de nome de um acordo (cliente + apelidos), como a Análise já usa para casar o extrato. */
export function chavesDoAcordo(a: { cliente: string; apelidos: string | null }): string[] {
  return [a.cliente, ...(a.apelidos ?? '').split(',')].map(minusculo).filter((c) => c.length >= 3);
}

/** O CPF/CNPJ só com dígitos, quando é um documento inteiro (o Asaas manda assim). */
export function documentoComoChave(doc: string | null | undefined): string[] {
  const d = (doc ?? '').replace(/\D/g, '');
  return d.length === 11 || d.length === 14 ? [d] : [];
}

export function nomeCasa(chaves: string[], texto: string): boolean {
  const alvo = minusculo(texto);
  return chaves.some((c) => alvo.includes(c));
}

export interface CobrancaParaCasar { valor: number; vence: Date; texto: string }
export interface ParcelaCandidata { id: string; valor: number; vencimento: Date; chaves: string[] }

/** A parcela livre que a cobrança veste: nome, valor igual e o vencimento mais perto dentro da janela. */
export function escolherParcela<T extends ParcelaCandidata>(c: CobrancaParaCasar, livres: T[]): T | null {
  let melhor: { p: T; dias: number } | null = null;
  for (const p of livres) {
    if (Math.abs(p.valor - c.valor) > 0.009) continue;
    const dias = Math.abs(p.vencimento.getTime() - c.vence.getTime()) / DIA;
    if (dias > JANELA_PARCELA_DIAS) continue;
    if (!nomeCasa(p.chaves, c.texto)) continue;
    if (!melhor || dias < melhor.dias) melhor = { p, dias };
  }
  return melhor?.p ?? null;
}

/**
 * As datas em que um contrato ativo ainda vai vencer dentro da janela, a partir
 * do próximo vencimento que NÃO foi gerado como previsto. O que já foi gerado
 * está no banco; daqui para frente a projeção desenha sem gravar nada. `proximo`
 * é a mesma conta do gerador de contratos, para as datas não divergirem.
 */
export function ocorrenciasDoContrato(
  c: { proximoVencimento: Date; dataFim: Date | null; periodicidade: string },
  de: Date,
  ate: Date,
  proximo: (vencimento: Date, periodicidade: string) => Date,
): Date[] {
  const fim = c.dataFim && c.dataFim < ate ? c.dataFim : ate;
  const out: Date[] = [];
  for (let d = c.proximoVencimento, i = 0; d <= fim && i < 240; d = proximo(d, c.periodicidade), i++) {
    if (d >= de) out.push(d);
  }
  return out;
}
