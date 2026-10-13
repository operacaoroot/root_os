import { createHash, timingSafeEqual } from 'node:crypto';

/*
 * A PORTA DE COBRANÇA DO COMERCIAL (lane D, 13/10/2026).
 *
 * O comercial não importa o conector do Asaas (a catraca de arquitetura
 * proíbe: conector só pela porta). Ele recebe esta interface por injeção, pelo
 * token `PORTA_DE_COBRANCA`, que o `finance.module.ts` (a fiação da pasta do
 * conector) liga ao `AsaasService`. O endereço, a chave da API e o segredo do
 * webhook moram só lá. Aqui ficam o contrato e a leitura PURA do corpo do
 * webhook, que não sabe de endereço nem de credencial.
 *
 * Quem chama as escritas (`criarCliente`, `criarCobranca`) é só o EFEITO de
 * uma capacidade da régua (`comercial.cobranca.criar`, `comercial.fechamento.executar`),
 * que a porta dispara depois da assinatura da titular. Nenhuma rota chama.
 */

export const PORTA_DE_COBRANCA = Symbol('PORTA_DE_COBRANCA');

export type FormaDeCobranca = 'pix' | 'boleto' | 'cartao';

export interface ClienteDeCobranca {
  nome: string;
  /** CPF (11) ou CNPJ (14), só dígitos. */
  documento: string;
  email: string | null;
  telefone: string | null;
  referenciaExterna: string;
}

export interface NovaCobranca {
  clienteExternoId: string;
  parcelas: number;
  parcelaCentavos: number;
  /**
   * D-11: a última parcela, quando o total não divide pelas parcelas (a última
   * absorve a diferença, como a proposta e o contrato mostram). Ausente ou igual
   * a `parcelaCentavos`: todas iguais.
   */
  ultimaParcelaCentavos?: number;
  forma: FormaDeCobranca;
  /** AAAA-MM-DD. As outras parcelas vencem mês a mês a partir dele. */
  primeiroVencimento: string;
  descricao: string;
  /** A chave de idempotência no provedor: a mesma referência não cria outra cobrança. */
  referenciaExterna: string;
}

export interface ParcelaNoProvedor {
  externoId: string;
  parcela: number;
  parcelas: number;
  valorCentavos: number;
  /** AAAA-MM-DD */
  vence: string;
  estado: 'pendente' | 'paga' | 'atrasada' | 'estornada' | 'outro';
  pagaEm: string | null;
  linkPagamento: string | null;
}

export interface PagamentoNoWebhook {
  /** O id do evento no provedor (a reentrega traz o mesmo). */
  eventoId: string | null;
  /** D-10: estorno e chargeback têm tipo próprio; a parcela volta a não paga. */
  tipo: 'paga' | 'estornada' | 'outro';
  /** O nome cru do evento no provedor (vai ao fato do estorno). */
  evento: string;
  externoId: string;
  valorCentavos: number;
  /** AAAA-MM-DD ou ISO. */
  pagoEm: string | null;
}

export interface PortaDeCobranca {
  readonly provedor: string;
  configurada(): boolean;
  criarCliente(c: ClienteDeCobranca): Promise<{ externoId: string; reaproveitado: boolean }>;
  /** Idempotente pela `referenciaExterna`: devolve as parcelas que já existem em vez de criar outras. */
  criarCobranca(n: NovaCobranca): Promise<{ parcelas: ParcelaNoProvedor[]; reaproveitada: boolean }>;
  consultarCobranca(externoId: string): Promise<ParcelaNoProvedor | null>;
  /** O Pix copia e cola da parcela, quando a forma permite. */
  pixDaCobranca(externoId: string): Promise<string | null>;
  /** O segredo do cabeçalho confere? Sem segredo configurado, recusa tudo. */
  webhookAutentico(token: string | undefined | null): boolean;
  interpretarWebhook(corpo: unknown): PagamentoNoWebhook | null;
}

/** Comparação em tempo constante (hash dos dois lados, mesmo tamanho). Vazio de qualquer lado = falso. */
export function segredoConfere(esperado: string, recebido: string | undefined | null): boolean {
  const a = (esperado ?? '').trim();
  const b = String(recebido ?? '').trim();
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

type P = Record<string, unknown>;

/** Centavos a partir do valor em reais do provedor (número ou texto), sem ponto flutuante na soma. */
export function centavosDe(reais: unknown): number {
  const n = typeof reais === 'number' ? reais : Number(String(reais ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** D-10: status do Asaas em que o dinheiro voltou (ou está em disputa) e a parcela deixa de contar como paga. */
const STATUS_DE_ESTORNO = new Set(['REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL']);

/**
 * D-10: eventos do webhook do Asaas que tiram a parcela de paga. Estorno
 * (total ou parcial), chargeback aberto ou em disputa e o recebimento em
 * dinheiro desfeito. Estorno parcial também tira: a parcela deixou de estar
 * inteira paga, e quem decide o que fazer com a diferença é gente.
 */
export const EVENTOS_DE_ESTORNO_DO_ASAAS: ReadonlySet<string> = new Set([
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
]);

/** Estado da parcela a partir do status do Asaas. */
export function estadoDoAsaas(status: unknown): ParcelaNoProvedor['estado'] {
  const s = String(status ?? '').toUpperCase();
  if (s === 'RECEIVED' || s === 'CONFIRMED' || s === 'RECEIVED_IN_CASH') return 'paga';
  if (s === 'PENDING' || s === 'AWAITING_RISK_ANALYSIS') return 'pendente';
  if (s === 'OVERDUE') return 'atrasada';
  if (STATUS_DE_ESTORNO.has(s)) return 'estornada';
  return 'outro';
}

/** A forma do comercial no vocabulário do Asaas. */
export function billingTypeDoAsaas(forma: FormaDeCobranca): 'PIX' | 'BOLETO' | 'CREDIT_CARD' {
  if (forma === 'pix') return 'PIX';
  if (forma === 'boleto') return 'BOLETO';
  return 'CREDIT_CARD';
}

/** Uma cobrança do Asaas (API v3) como parcela do comercial. */
export function parcelaDoAsaas(p: P): ParcelaNoProvedor {
  return {
    externoId: String(p.id ?? ''),
    parcela: Number(p.installmentNumber ?? 1) || 1,
    parcelas: Number(p.installmentCount ?? 1) || 1,
    valorCentavos: centavosDe(p.value),
    vence: String(p.dueDate ?? '').slice(0, 10),
    estado: estadoDoAsaas(p.status),
    pagaEm: typeof p.paymentDate === 'string' && p.paymentDate ? p.paymentDate : null,
    linkPagamento: typeof p.invoiceUrl === 'string' && p.invoiceUrl ? p.invoiceUrl : null,
  };
}

/**
 * Lê o corpo do webhook do Asaas (`{ id, event, payment }`).
 * `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` viram pagamento; estorno e
 * chargeback (`EVENTOS_DE_ESTORNO_DO_ASAAS`) viram `estornada`; o resto é `outro`.
 * Corpo sem cobrança = `null` (nada a fazer).
 */
export function lerWebhookDoAsaas(corpo: unknown): PagamentoNoWebhook | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const c = corpo as P;
  const pay = (c.payment ?? null) as P | null;
  if (!pay || typeof pay !== 'object' || !pay.id) return null;
  const evento = String(c.event ?? '').toUpperCase();
  const paga = evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED';
  return {
    eventoId: typeof c.id === 'string' && c.id ? c.id : null,
    tipo: paga ? 'paga' : EVENTOS_DE_ESTORNO_DO_ASAAS.has(evento) ? 'estornada' : 'outro',
    evento,
    externoId: String(pay.id),
    valorCentavos: centavosDe(pay.value),
    pagoEm: typeof pay.paymentDate === 'string' && pay.paymentDate ? pay.paymentDate : typeof pay.confirmedDate === 'string' ? pay.confirmedDate : null,
  };
}
