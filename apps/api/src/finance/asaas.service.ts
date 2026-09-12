import { Injectable, OnModuleInit, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConectoresConfiguradosRegistry } from '../gateway/conectores-configurados.registry';

// Conector do Asaas (gateway de cobranças + conta digital — https://asaas.com).
// Credencial PRÓPRIA do root em ~/.config/root/asaas.env (isolado do escritório).
// Auth: header `access_token: <API_KEY>`. A chave define o ambiente:
//   produção  → prefixo $aact_prod_ → https://api.asaas.com/v3
//   sandbox   → prefixo $aact_hmlg_ → https://sandbox.asaas.com/api/v3
// Puxamos TUDO da conta: saldo, extrato financeiro (movimento de caixa real)
// e cobranças em aberto (contas a receber). Nada de segredo fica no repo.

const PROD_BASE = 'https://api.asaas.com/v3';
const SANDBOX_BASE = 'https://sandbox.asaas.com/api/v3';

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
}

export interface AsaasCustomer {
  id: string;
  name?: string;
  company?: string | null;
  cpfCnpj?: string | null;
}

interface AsaasList<T> {
  data?: T[];
  hasMore?: boolean;
  totalCount?: number;
  limit?: number;
  offset?: number;
}

// Cobranças que ainda vão entrar no caixa → viram "a receber" (previsto).
export const OPEN_PAYMENT_STATUS = ['PENDING', 'OVERDUE', 'CONFIRMED', 'AWAITING_RISK_ANALYSIS'] as const;

@Injectable()
export class AsaasService implements OnModuleInit {
  private readonly log = new Logger('AsaasService');
  private readonly apiKey = (process.env.ASAAS_API_KEY ?? '').trim();
  private readonly base = this.resolveBase();

  constructor(private readonly conectoresConfigurados: ConectoresConfiguradosRegistry) {}

  /*
   * `configured` aqui lê a chave com `.trim()` aplicado na leitura da variável —
   * uma chave só com espaços é "presente" para quem testa `!!process.env.X` e
   * AUSENTE para este conector. Era exatamente o tipo de divergência que fazia a
   * tela de Conexões afirmar uma coisa e o conector fazer outra (fatia 3.3).
   */
  onModuleInit(): void {
    this.conectoresConfigurados.registrar('asaas', () => this.configured);
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  /** Ambiente derivado da chave (a menos que ASAAS_BASE_URL force manualmente). */
  private resolveBase(): string {
    const forced = (process.env.ASAAS_BASE_URL ?? '').trim();
    if (forced) return forced.replace(/\/$/, '');
    // $aact_hmlg_ = sandbox; $aact_prod_ = produção.
    if (/hmlg/i.test(this.apiKey)) return SANDBOX_BASE;
    return PROD_BASE;
  }

  get environment(): 'sandbox' | 'producao' {
    return this.base === SANDBOX_BASE ? 'sandbox' : 'producao';
  }

  private ensureConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Asaas não configurado: defina ASAAS_API_KEY em ~/.config/root/asaas.env e reinicie a API.',
      );
    }
  }

  private async req<T>(path: string): Promise<T> {
    this.ensureConfigured();
    const res = await fetch(`${this.base}${path}`, {
      headers: {
        access_token: this.apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'marketing-os',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Asaas ${path} → HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  /** Paginação padrão do Asaas (offset/limit/hasMore). */
  private async paginate<T>(path: string, extraQuery = ''): Promise<T[]> {
    const out: T[] = [];
    const limit = 100;
    for (let offset = 0; offset < 100 * limit; offset += limit) {
      const sep = path.includes('?') || extraQuery ? '&' : '?';
      const data = await this.req<AsaasList<T>>(`${path}${extraQuery}${sep}offset=${offset}&limit=${limit}`);
      out.push(...(data.data ?? []));
      if (!data.hasMore) break;
    }
    return out;
  }

  /** Saldo atual da conta Asaas (para casar o saldo exibido com o do banco). */
  async balance(): Promise<number | null> {
    try {
      const data = await this.req<{ balance?: number }>('/finance/balance');
      return typeof data.balance === 'number' ? data.balance : null;
    } catch (e) {
      this.log.warn(`Asaas /finance/balance falhou: ${(e as Error).message}`);
      return null;
    }
  }

  /** Extrato financeiro desde `startDate` (YYYY-MM-DD) até hoje. */
  async listFinancialTransactions(startDateISO: string): Promise<AsaasFinancialTransaction[]> {
    const start = startDateISO.slice(0, 10);
    return this.paginate<AsaasFinancialTransaction>('/financialTransactions', `?startDate=${start}`);
  }

  /** Cobranças ainda em aberto (viram contas a receber). */
  async listOpenPayments(): Promise<AsaasPayment[]> {
    const out: AsaasPayment[] = [];
    for (const status of OPEN_PAYMENT_STATUS) {
      try {
        out.push(...(await this.paginate<AsaasPayment>('/payments', `?status=${status}`)));
      } catch (e) {
        this.log.warn(`Asaas /payments?status=${status} falhou: ${(e as Error).message}`);
      }
    }
    return out;
  }

  /** Mapa id→nome dos clientes (para nomear o pagador das cobranças). */
  async customerMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const customers = await this.paginate<AsaasCustomer>('/customers');
      for (const c of customers) map.set(c.id, c.name || c.company || c.id);
    } catch (e) {
      this.log.warn(`Asaas /customers falhou: ${(e as Error).message}`);
    }
    return map;
  }
}
