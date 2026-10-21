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

// Conector de bancos via Open Finance (Pluggy — https://pluggy.ai).
// Credencial PRÓPRIA do root em ~/.config/root/pluggy.env (isolado do escritório).
// Fluxo: auth (clientId/secret → apiKey) → connect_token (widget do front) →
// o usuário conecta o banco → recebemos um itemId → listamos contas + extrato.
// NÃO guardamos senha de banco: o Pluggy detém as credenciais; guardamos só o itemId.

export interface PluggyAccount {
  id: string;
  type?: string; // BANK | CREDIT
  subtype?: string; // CHECKING_ACCOUNT | SAVINGS_ACCOUNT | CREDIT_CARD...
  name?: string;
  balance?: number;
  currencyCode?: string;
  number?: string;
}

export interface PluggyTransaction {
  id: string;
  description?: string;
  amount: number; // pode vir com sinal
  type?: 'CREDIT' | 'DEBIT';
  date: string; // ISO
  category?: string;
}

@Injectable()
export class PluggyService implements OnModuleInit {
  private readonly log = new Logger('PluggyService');
  private readonly clientId = process.env.PLUGGY_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.PLUGGY_CLIENT_SECRET ?? '';
  private readonly base = (process.env.PLUGGY_BASE_URL ?? 'https://api.pluggy.ai').replace(/\/$/, '');
  private apiKey: string | null = null;
  private apiKeyAt = 0;

  constructor(
    private readonly conectoresConfigurados: ConectoresConfiguradosRegistry,
    /** Rodada dos agentes (A6): a Pluggy implementa o contrato único de conector. */
    @Optional() private readonly contrato?: RegistroDeConectores,
  ) {}

  /*
   * A Pluggy precisa de DUAS variáveis para estar configurada, e é por isso que
   * ela ilustra bem o motivo da mudança da fatia 3.3: a tela de Conexões
   * reproduzia essa conjunção por fora (`!!(PLUGGY_CLIENT_ID &&
   * PLUGGY_CLIENT_SECRET)`), e qualquer mudança no critério aqui dentro deixava
   * as duas leituras em desacordo sem nada quebrar. O critério é de quem usa a
   * credencial.
   */
  onModuleInit(): void {
    this.conectoresConfigurados.registrar('pluggy', () => this.configured);
    this.contrato?.registrar(this.descritorDoContrato(), 'PluggyService');
  }

  /**
   * O CONTRATO ÚNICO (rodada dos agentes, A6). O par cliente/segredo da Pluggy é
   * do PROCESSO; o banco de cada conta é ligado pelo widget do Financeiro (a
   * Pluggy guarda a senha do banco, o OS guarda só o itemId). A sonda faz a
   * autenticação (`POST /auth`), que prova o par aceito sem tocar em conta.
   */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: 'pluggy',
      rotulo: 'Bancos (Open Finance/Pluggy)',
      escopoDaCredencial: 'processo',
      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao:
          'O par da Pluggy (PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET) vai no ambiente da API. Cada banco é ligado ' +
          'depois pelo botão "Conectar banco" do Financeiro, no widget da própria Pluggy.',
      }),
      sincronizar: async (): Promise<ResultadoDeSincronizacao> => ({
        tipo: 'nao_se_aplica',
        motivo: 'Contas e extratos entram pela sincronização do Financeiro (Financeiro › Sincronizar), conta a conta.',
      }),
      saude: async (): Promise<SaudeDeConector> => {
        if (!this.configured) return naoConfigurado('PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET ausentes no ambiente da API: nenhum banco entra pelo Open Finance.');
        const comecou = Date.now();
        try {
          await this.auth(AbortSignal.timeout(PRAZO_DA_CHAMADA_DE_SONDA_MS), true);
          return conectado(Date.now() - comecou);
        } catch (e) {
          return erroDeConector(`A Pluggy não respondeu: ${(e as Error).message}`, Date.now() - comecou);
        }
      },
      revogar: async (): Promise<ResultadoDeRevogacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'O par da Pluggy é do processo, não desta empresa: para queimar, gere outro par no painel da Pluggy e troque ' +
          'as duas variáveis no ambiente da API. Cada banco ligado se desfaz no próprio Financeiro.',
      }),
    };
  }

  get configured(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  private ensureConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Pluggy não configurado: defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET em ~/.config/root/pluggy.env e reinicie a API.',
      );
    }
  }

  // apiKey do Pluggy vale ~2h; cacheamos por 1h30.
  private async auth(sinal?: AbortSignal, semMemoria = false): Promise<string> {
    this.ensureConfigured();
    if (!semMemoria && this.apiKey && Date.now() - this.apiKeyAt < 90 * 60_000) return this.apiKey;
    const res = await fetch(`${this.base}/auth`, {
      method: 'POST',
      ...(sinal ? { signal: sinal } : {}),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: this.clientId, clientSecret: this.clientSecret }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Pluggy /auth → HTTP ${res.status} ${body.slice(0, 160)}`);
    }
    const data = (await res.json()) as { apiKey: string };
    this.apiKey = data.apiKey;
    this.apiKeyAt = Date.now();
    return this.apiKey;
  }

  private async pg<T>(path: string, init?: RequestInit): Promise<T> {
    const key = await this.auth();
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Pluggy ${path} → HTTP ${res.status} ${body.slice(0, 160)}`);
    }
    return res.json() as Promise<T>;
  }

  /** Token efêmero p/ o widget Pluggy Connect (front). Opcional: itemId p/ update. */
  async connectToken(itemId?: string): Promise<{ accessToken: string }> {
    const body = itemId ? { itemId } : {};
    const data = await this.pg<{ accessToken: string }>('/connect_token', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { accessToken: data.accessToken };
  }

  /** Metadados do item (nome do banco, status da conexão). */
  async getItem(itemId: string): Promise<{ institution: string | null; status: string | null }> {
    const data = await this.pg<{ connector?: { name?: string }; status?: string }>(
      `/items/${encodeURIComponent(itemId)}`,
    );
    return { institution: data.connector?.name ?? null, status: data.status ?? null };
  }

  async listAccounts(itemId: string): Promise<PluggyAccount[]> {
    const data = await this.pg<{ results: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`);
    return data.results ?? [];
  }

  async listTransactions(accountId: string, fromISO: string): Promise<PluggyTransaction[]> {
    const out: PluggyTransaction[] = [];
    const from = fromISO.slice(0, 10);
    for (let page = 1; page <= 20; page++) {
      const data = await this.pg<{ results: PluggyTransaction[]; totalPages?: number }>(
        `/transactions?accountId=${encodeURIComponent(accountId)}&from=${from}&pageSize=500&page=${page}`,
      );
      out.push(...(data.results ?? []));
      if (!data.totalPages || page >= data.totalPages) break;
    }
    return out;
  }
}
