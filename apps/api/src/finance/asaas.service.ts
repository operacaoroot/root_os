import { Injectable, OnModuleInit, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConectoresConfiguradosRegistry } from '../gateway/conectores-configurados.registry';
import { PRAZO_DA_CHAMADA_DE_SONDA_MS, RegistroDeConectores } from '../integrations/conectores.registry';
import {
  type ConectorDoContrato,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  naoConfigurado,
} from '../integrations/contrato-de-conector';
import {
  billingTypeDoAsaas,
  lerWebhookDoAsaas,
  parcelaDoAsaas,
  segredoConfere,
  type ClienteDeCobranca,
  type NovaCobranca,
  type PagamentoNoWebhook,
  type ParcelaNoProvedor,
  type PortaDeCobranca,
} from '../comercial/portas/cobranca.port';

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
export class AsaasService implements OnModuleInit, PortaDeCobranca {
  private readonly log = new Logger('AsaasService');
  private readonly apiKey = (process.env.ASAAS_API_KEY ?? '').trim();
  private readonly base = this.resolveBase();
  /** O segredo que o Asaas manda no cabeçalho `asaas-access-token` do webhook (cockpit comercial, lane D). */
  private readonly webhookToken = (process.env.ASAAS_WEBHOOK_TOKEN ?? '').trim();
  readonly provedor = 'asaas';

  constructor(
    private readonly conectoresConfigurados: ConectoresConfiguradosRegistry,
    /** Rodada dos agentes (A6): o Asaas implementa o contrato único de conector. */
    @Optional() private readonly contrato?: RegistroDeConectores,
  ) {}

  /*
   * `configured` aqui lê a chave com `.trim()` aplicado na leitura da variável —
   * uma chave só com espaços é "presente" para quem testa `!!process.env.X` e
   * AUSENTE para este conector. Era exatamente o tipo de divergência que fazia a
   * tela de Conexões afirmar uma coisa e o conector fazer outra (fatia 3.3).
   */
  onModuleInit(): void {
    this.conectoresConfigurados.registrar('asaas', () => this.configured);
    this.contrato?.registrar(this.descritorDoContrato(), 'AsaasService');
  }

  /**
   * O CONTRATO ÚNICO (rodada dos agentes, A6). A chave do Asaas é do PROCESSO
   * (a conta da Operação ROOT, `ASAAS_API_KEY`), como a do ClickUp: não há
   * OAuth, revogar é trocar a chave no painel do Asaas, e parar UMA empresa é o
   * desligamento. A sonda lê o saldo (`GET /finance/balance`), a leitura mais
   * barata que prova chave aceita; desligado, o registro nem chama.
   */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: 'asaas',
      rotulo: 'Asaas (cobranças e conta digital)',
      escopoDaCredencial: 'processo',
      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao:
          'O Asaas não tem OAuth: a chave da API (painel do Asaas › Integrações) vai em ASAAS_API_KEY no ambiente ' +
          'da API, e o segredo do webhook em ASAAS_WEBHOOK_TOKEN. Recrie o container depois de trocar.',
      }),
      sincronizar: async (): Promise<ResultadoDeSincronizacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'O extrato e as cobranças do Asaas entram pela sincronização do Financeiro (Financeiro › Sincronizar), ' +
          'que concilia com as contas; o pagamento de cada cobrança chega pelo webhook.',
      }),
      saude: async (): Promise<SaudeDeConector> => {
        if (!this.configured) return naoConfigurado('ASAAS_API_KEY ausente no ambiente da API: nenhuma cobrança sai e o extrato não entra.');
        const comecou = Date.now();
        try {
          await this.req<{ balance?: number }>('/finance/balance', AbortSignal.timeout(PRAZO_DA_CHAMADA_DE_SONDA_MS));
          return conectado(
            Date.now() - comecou,
            `${this.environment === 'sandbox' ? 'ambiente de testes (sandbox)' : 'produção'}` +
              (this.webhookToken ? '' : ' · sem ASAAS_WEBHOOK_TOKEN: o pagamento não volta ao OS'),
          );
        } catch (e) {
          return erroDeConector(`O Asaas não respondeu: ${(e as Error).message}`, Date.now() - comecou);
        }
      },
      revogar: async (): Promise<ResultadoDeRevogacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'A chave do Asaas é do processo. Para parar agora, DESLIGUE o conector em Conexões (a porta recusa ' +
          'comercial.cobranca.criar e comercial.fechamento.executar); para queimar a chave, gere outra no painel do ' +
          'Asaas e troque ASAAS_API_KEY no ambiente da API.',
      }),
    };
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

  private async req<T>(path: string, sinal?: AbortSignal): Promise<T> {
    this.ensureConfigured();
    const res = await fetch(`${this.base}${path}`, {
      ...(sinal ? { signal: sinal } : {}),
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

  // ==========================================================================
  // ESCRITAS DO COCKPIT COMERCIAL (lane D, 13/10/2026) — a `PortaDeCobranca`.
  //
  // Quem chama é só o EFEITO de `comercial.cobranca.criar` e de
  // `comercial.fechamento.executar`, que a porta dispara depois da assinatura
  // da titular (R4). O comercial recebe este serviço pelo token
  // `PORTA_DE_COBRANCA` (fiação em `finance.module.ts`), nunca por import.
  // As leituras acima não mudaram.
  // ==========================================================================

  configurada(): boolean {
    return this.configured;
  }

  private async escrever<T>(metodo: 'POST', path: string, corpo: Record<string, unknown>): Promise<T> {
    this.ensureConfigured();
    const res = await fetch(`${this.base}${path}`, {
      method: metodo,
      headers: { access_token: this.apiKey, 'Content-Type': 'application/json', 'User-Agent': 'marketing-os' },
      body: JSON.stringify(corpo),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Asaas ${metodo} ${path} → HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  /** Cria o cliente, ou reaproveita o que já existe com o mesmo documento. */
  async criarCliente(c: ClienteDeCobranca): Promise<{ externoId: string; reaproveitado: boolean }> {
    const doc = c.documento.replace(/\D/g, '');
    const existentes = await this.req<AsaasList<AsaasCustomer>>(`/customers?cpfCnpj=${encodeURIComponent(doc)}`);
    const ja = existentes.data?.[0];
    if (ja?.id) return { externoId: ja.id, reaproveitado: true };
    const novo = await this.escrever<AsaasCustomer>('POST', '/customers', {
      name: c.nome,
      cpfCnpj: doc,
      ...(c.email ? { email: c.email } : {}),
      ...(c.telefone ? { mobilePhone: c.telefone } : {}),
      externalReference: c.referenciaExterna,
      notificationDisabled: true,
    });
    return { externoId: novo.id, reaproveitado: false };
  }

  private async parcelasDaReferencia(ref: string): Promise<ParcelaNoProvedor[]> {
    const lista = await this.req<AsaasList<Record<string, unknown>>>(`/payments?externalReference=${encodeURIComponent(ref)}`);
    return (lista.data ?? []).map(parcelaDoAsaas).sort((a, b) => a.parcela - b.parcela);
  }

  /** Cria a cobrança parcelada. A mesma `referenciaExterna` devolve as parcelas que já existem. */
  async criarCobranca(n: NovaCobranca): Promise<{ parcelas: ParcelaNoProvedor[]; reaproveitada: boolean }> {
    const ja = await this.parcelasDaReferencia(n.referenciaExterna);
    if (ja.length) return { parcelas: await this.ajustarUltima(n, ja), reaproveitada: true };
    const reais = n.parcelaCentavos / 100;
    const corpo: Record<string, unknown> = {
      customer: n.clienteExternoId,
      billingType: billingTypeDoAsaas(n.forma),
      dueDate: n.primeiroVencimento,
      description: n.descricao,
      externalReference: n.referenciaExterna,
      ...(n.parcelas > 1 ? { installmentCount: n.parcelas, installmentValue: reais } : { value: reais }),
    };
    await this.escrever<Record<string, unknown>>('POST', '/payments', corpo);
    const criadas = await this.parcelasDaReferencia(n.referenciaExterna);
    if (!criadas.length) throw new Error('Asaas criou a cobrança e não a devolveu pela referência: confira no painel antes de tentar de novo.');
    return { parcelas: await this.ajustarUltima(n, criadas), reaproveitada: false };
  }

  /**
   * D-11: o parcelamento do Asaas nasce com parcelas iguais. Quando o total não
   * divide, a última absorve a diferença (`ultimaParcelaCentavos`): ela é
   * atualizada depois de criada. A reentrega da mesma referência confere de novo
   * e corrige só a última ainda aberta; a que já não está aberta com outro valor
   * para com o motivo, sem mexer em nada.
   */
  private async ajustarUltima(n: NovaCobranca, parcelas: ParcelaNoProvedor[]): Promise<ParcelaNoProvedor[]> {
    const alvo = n.ultimaParcelaCentavos;
    if (alvo == null || alvo === n.parcelaCentavos || n.parcelas < 2) return parcelas;
    const ultima = parcelas.find((p) => p.parcela === n.parcelas);
    if (!ultima || ultima.valorCentavos === alvo) return parcelas;
    if (ultima.estado !== 'pendente' && ultima.estado !== 'atrasada') {
      throw new Error(`a última parcela no Asaas (${ultima.externoId}) não está aberta e não vale o que a última deve valer: confira no painel`);
    }
    await this.escrever<Record<string, unknown>>('POST', `/payments/${encodeURIComponent(ultima.externoId)}`, {
      billingType: billingTypeDoAsaas(n.forma),
      value: alvo / 100,
      dueDate: ultima.vence,
    });
    return this.parcelasDaReferencia(n.referenciaExterna);
  }

  async consultarCobranca(externoId: string): Promise<ParcelaNoProvedor | null> {
    try {
      return parcelaDoAsaas(await this.req<Record<string, unknown>>(`/payments/${encodeURIComponent(externoId)}`));
    } catch (e) {
      if (/HTTP 404/.test((e as Error).message)) return null;
      throw e;
    }
  }

  async pixDaCobranca(externoId: string): Promise<string | null> {
    const r = await this.req<{ payload?: string }>(`/payments/${encodeURIComponent(externoId)}/pixQrCode`);
    return typeof r.payload === 'string' && r.payload ? r.payload : null;
  }

  /** Sem `ASAAS_WEBHOOK_TOKEN` configurado, recusa tudo. Comparação em tempo constante. */
  webhookAutentico(token: string | undefined | null): boolean {
    return segredoConfere(this.webhookToken, token);
  }

  interpretarWebhook(corpo: unknown): PagamentoNoWebhook | null {
    return lerWebhookDoAsaas(corpo);
  }
}
