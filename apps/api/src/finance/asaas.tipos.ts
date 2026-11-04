// Extrato financeiro (movimento de caixa real da conta Asaas). value é COM SINAL.
export interface AsaasFinancialTransaction {
  id: string;
  value: number; // + crédito / − débito
  balance?: number;
  type?: string; // PAYMENT_RECEIVED | PAYMENT_FEE | TRANSFER | PIX_TRANSACTION_* ...
  date: string; // YYYY-MM-DD
  description?: string;
  paymentId?: string;
}

// Cobrança (boleto/pix/cartão). Usamos as EM ABERTO como "a receber".
export interface AsaasPayment {
  id: string;
  customer?: string; // id do cliente
  value: number;
  netValue?: number;
  status?: string; // PENDING | RECEIVED | CONFIRMED | OVERDUE | REFUNDED ...
  dueDate?: string; // YYYY-MM-DD
  paymentDate?: string | null;
  dateCreated?: string;
  billingType?: string; // BOLETO | PIX | CREDIT_CARD ...
  description?: string | null;
  invoiceNumber?: string | null;
  /** Cartão: quando o Asaas repassa o dinheiro (parcela a parcela, ~30 dias depois). */
  estimatedCreditDate?: string | null;
  creditDate?: string | null;
  /** O vencimento da criação (o `dueDate` muda quando alguém prorroga a cobrança). */
  originalDueDate?: string | null;
  clientPaymentDate?: string | null;
  deleted?: boolean;
  /** Cobrança gerada por uma assinatura do Asaas (mensalidade): é conta recorrente, não parcela de acordo. */
  subscription?: string | null;
}

