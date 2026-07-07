import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

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
export class PluggyService {
  private readonly log = new Logger('PluggyService');
  private readonly clientId = process.env.PLUGGY_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.PLUGGY_CLIENT_SECRET ?? '';
  private readonly base = (process.env.PLUGGY_BASE_URL ?? 'https://api.pluggy.ai').replace(/\/$/, '');
  private apiKey: string | null = null;
  private apiKeyAt = 0;

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
  private async auth(): Promise<string> {
    this.ensureConfigured();
    if (this.apiKey && Date.now() - this.apiKeyAt < 90 * 60_000) return this.apiKey;
    const res = await fetch(`${this.base}/auth`, {
      method: 'POST',
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
