'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  FinanceSummary,
  FinanceAccountList,
  FinanceCategoryList,
  FinanceTransactionList,
  BankConnectionList,
  FinanceTxTypeValue,
  FinanceTxStatusValue,
} from '@mktos/shared';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_CLS: Record<string, string> = {
  realizado: 'bg-good/15 text-good',
  conciliado: 'bg-brand/15 text-brand',
  previsto: 'bg-surface-2 text-muted',
};
const ACCOUNT_TYPES = [
  { v: 'corrente', l: 'Conta corrente' },
  { v: 'poupanca', l: 'Poupança' },
  { v: 'caixa', l: 'Caixa' },
  { v: 'cartao', l: 'Cartão' },
  { v: 'investimento', l: 'Investimento' },
];

const TABS = [
  { key: 'visao', label: 'Visão geral' },
  { key: 'lancamentos', label: 'Lançamentos' },
  { key: 'contas', label: 'Contas' },
  { key: 'bancos', label: 'Bancos' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const inputCls =
  'rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim';

export default function FinanceiroPage() {
  const { token, ready, can } = useAuth();
  const canEdit = can('financeiro.editar');
  const canBank = can('financeiro.conciliar');

  const [tab, setTab] = useState<TabKey>('visao');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccountList | null>(null);
  const [categories, setCategories] = useState<FinanceCategoryList | null>(null);
  const [txs, setTxs] = useState<FinanceTransactionList | null>(null);
  const [banks, setBanks] = useState<BankConnectionList | null>(null);

  const [txFilter, setTxFilter] = useState<{ status?: string; type?: string; accountId?: string }>({});

  const loadAll = useCallback(() => {
    if (!token) return;
    setError(null);
    apiGet<FinanceSummary>('/finance/summary', token).then(setSummary).catch((e) => setError(e.message));
    apiGet<FinanceAccountList>('/finance/accounts', token).then(setAccounts).catch(() => {});
    apiGet<FinanceCategoryList>('/finance/categories', token).then(setCategories).catch(() => {});
    apiGet<BankConnectionList>('/finance/bank/connections', token).then(setBanks).catch(() => {});
  }, [token]);

  const loadTxs = useCallback(() => {
    if (!token) return;
    const p = new URLSearchParams();
    if (txFilter.status) p.set('status', txFilter.status);
    if (txFilter.type) p.set('type', txFilter.type);
    if (txFilter.accountId) p.set('accountId', txFilter.accountId);
    apiGet<FinanceTransactionList>(`/finance/transactions?${p.toString()}`, token)
      .then(setTxs)
      .catch((e) => setError(e.message));
  }, [token, txFilter]);

  useEffect(() => {
    if (!ready || !token) return;
    loadAll();
  }, [ready, token, loadAll]);

  useEffect(() => {
    if (!ready || !token) return;
    loadTxs();
  }, [ready, token, loadTxs]);

  const flash = (m: string) => {
    setMsg(m);
    setError(null);
    setTimeout(() => setMsg(null), 4000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Financeiro</h1>
          <p className="text-sm text-muted">
            Contas, lançamentos, fluxo de caixa e integração bancária (Open Finance / OFX).
          </p>
        </div>
        {summary && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted">Saldo total</div>
            <div className={`text-2xl font-semibold ${summary.saldoTotal >= 0 ? 'text-good' : 'text-bad'}`}>
              {brl(summary.saldoTotal)}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm ${
              tab === t.key ? 'border-b-2 border-brand font-medium text-text' : 'text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</div>}
      {msg && <div className="rounded-lg border border-good/30 bg-good/10 px-4 py-2 text-sm text-good">{msg}</div>}

      {tab === 'visao' && <Visao summary={summary} />}
      {tab === 'lancamentos' && (
        <Lancamentos
          txs={txs}
          accounts={accounts}
          categories={categories}
          canEdit={canEdit}
          token={token}
          filter={txFilter}
          setFilter={setTxFilter}
          onChange={() => { loadTxs(); loadAll(); }}
          onError={setError}
          onFlash={flash}
        />
      )}
      {tab === 'contas' && (
        <Contas accounts={accounts} canEdit={canEdit} token={token} onChange={loadAll} onError={setError} onFlash={flash} />
      )}
      {tab === 'bancos' && (
        <Bancos banks={banks} accounts={accounts} canBank={canBank} token={token} onChange={loadAll} onError={setError} onFlash={flash} />
      )}
    </div>
  );
}

// ---------------- Visão geral ----------------
function Card({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  const cls = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-text';
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function Visao({ summary }: { summary: FinanceSummary | null }) {
  if (!summary) return <p className="text-sm text-muted">Carregando…</p>;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Resultado do mês" value={brl(summary.mes.resultado)} tone={summary.mes.resultado >= 0 ? 'good' : 'bad'} />
        <Card label="Entradas do mês" value={brl(summary.mes.entradas)} tone="good" />
        <Card label="Saídas do mês" value={brl(summary.mes.saidas)} tone="bad" />
        <Card label="Contas" value={String(summary.contas)} />
        <Card label="A receber" value={brl(summary.aReceber)} tone="good" />
        <Card label="A pagar" value={brl(summary.aPagar)} tone="bad" />
        <Card label="Receber vencido" value={brl(summary.aReceberVencido)} tone={summary.aReceberVencido > 0 ? 'warn' : undefined} />
        <Card label="Pagar vencido" value={brl(summary.aPagarVencido)} tone={summary.aPagarVencido > 0 ? 'warn' : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium">Saldo por conta</h2>
          {summary.byAccount.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma conta ainda. Crie uma na aba “Contas”.</p>
          ) : (
            <ul className="space-y-2">
              {summary.byAccount.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-sm">
                  <span>{a.name}</span>
                  <span className={a.balance >= 0 ? 'text-good' : 'text-bad'}>{brl(a.balance)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium">Top categorias do mês</h2>
          {summary.topCategorias.length === 0 ? (
            <p className="text-sm text-muted">Sem lançamentos categorizados este mês.</p>
          ) : (
            <ul className="space-y-2">
              {summary.topCategorias.map((c, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span>
                    {c.name} <span className="text-[11px] text-muted">({c.kind})</span>
                  </span>
                  <span className={c.kind === 'receita' ? 'text-good' : 'text-bad'}>{brl(c.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted">
        Bancos: {summary.bancos.conectados}/{summary.bancos.conexoes} conexão(ões) ativa(s)
        {summary.bancos.pluggyConfigurado ? ' · Open Finance (Pluggy) configurado' : ' · Pluggy não configurado (use OFX)'} ·
        fonte: {summary.source.tool} · {new Date(summary.source.generatedAt).toLocaleString('pt-BR')}
      </p>
    </div>
  );
}

// ---------------- Lançamentos ----------------
function Lancamentos(props: {
  txs: FinanceTransactionList | null;
  accounts: FinanceAccountList | null;
  categories: FinanceCategoryList | null;
  canEdit: boolean;
  token: string | null;
  filter: { status?: string; type?: string; accountId?: string };
  setFilter: (f: { status?: string; type?: string; accountId?: string }) => void;
  onChange: () => void;
  onError: (e: string) => void;
  onFlash: (m: string) => void;
}) {
  const { txs, accounts, categories, canEdit, token, filter, setFilter, onChange, onError, onFlash } = props;
  const [form, setForm] = useState({
    accountId: '', categoryId: '', type: 'saida' as FinanceTxTypeValue,
    status: 'realizado' as FinanceTxStatusValue, description: '', amount: '', date: today(), dueDate: '',
  });
  const [open, setOpen] = useState(false);

  const submit = () => {
    if (!form.accountId || !form.description || !form.amount) {
      onError('Preencha conta, descrição e valor.');
      return;
    }
    apiPost('/finance/transactions', {
      accountId: form.accountId,
      categoryId: form.categoryId || undefined,
      type: form.type,
      status: form.status,
      description: form.description,
      amount: Number(form.amount),
      date: form.date,
      dueDate: form.status === 'previsto' && form.dueDate ? form.dueDate : undefined,
    }, token)
      .then(() => {
        onFlash('✅ Lançamento criado.');
        setForm({ ...form, description: '', amount: '', dueDate: '' });
        setOpen(false);
        onChange();
      })
      .catch((e) => onError(e.message));
  };

  const setStatus = (id: string, status: FinanceTxStatusValue) =>
    apiPatch(`/finance/transactions/${id}`, { status }, token).then(() => { onFlash('Atualizado.'); onChange(); }).catch((e) => onError(e.message));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={inputCls} value={filter.status ?? ''} onChange={(e) => setFilter({ ...filter, status: e.target.value || undefined })}>
          <option value="">Todos status</option>
          <option value="previsto">Previsto (a pagar/receber)</option>
          <option value="realizado">Realizado</option>
          <option value="conciliado">Conciliado</option>
        </select>
        <select className={inputCls} value={filter.type ?? ''} onChange={(e) => setFilter({ ...filter, type: e.target.value || undefined })}>
          <option value="">Entradas e saídas</option>
          <option value="entrada">Só entradas</option>
          <option value="saida">Só saídas</option>
        </select>
        <select className={inputCls} value={filter.accountId ?? ''} onChange={(e) => setFilter({ ...filter, accountId: e.target.value || undefined })}>
          <option value="">Todas as contas</option>
          {accounts?.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {canEdit && (
          <button onClick={() => setOpen((o) => !o)} className="ml-auto rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            {open ? 'Fechar' : '+ Novo lançamento'}
          </button>
        )}
      </div>

      {open && canEdit && (
        <div className="grid gap-2 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
          <select className={inputCls} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">Conta…</option>
            {accounts?.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FinanceTxTypeValue })}>
            <option value="saida">Saída (despesa)</option>
            <option value="entrada">Entrada (receita)</option>
          </select>
          <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FinanceTxStatusValue })}>
            <option value="realizado">Realizado</option>
            <option value="previsto">Previsto (a pagar/receber)</option>
          </select>
          <input className={`${inputCls} sm:col-span-2`} placeholder="Descrição" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input className={inputCls} type="number" step="0.01" placeholder="Valor (R$)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <select className={inputCls} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Sem categoria</option>
            {categories?.items.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
          </select>
          <input className={inputCls} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          {form.status === 'previsto' && (
            <input className={inputCls} type="date" title="Vencimento" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          )}
          <button onClick={submit} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">Salvar</button>
        </div>
      )}

      {txs && (
        <div className="flex gap-4 text-sm">
          <span className="text-good">Entradas: {brl(txs.totals.entradas)}</span>
          <span className="text-bad">Saídas: {brl(txs.totals.saidas)}</span>
          <span className={txs.totals.saldo >= 0 ? 'text-good' : 'text-bad'}>Saldo: {brl(txs.totals.saldo)}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">Conta</th>
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Valor</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {txs?.items.length === 0 && (
              <tr><td colSpan={canEdit ? 7 : 6} className="px-3 py-6 text-center text-muted">Nenhum lançamento.</td></tr>
            )}
            {txs?.items.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-3 py-2 whitespace-nowrap">{dateBR(t.date)}</td>
                <td className="px-3 py-2">{t.description}{t.source !== 'manual' && <span className="ml-1 text-[10px] text-muted">({t.source})</span>}</td>
                <td className="px-3 py-2 text-muted">{t.accountName ?? '—'}</td>
                <td className="px-3 py-2 text-muted">{t.categoryName ?? '—'}</td>
                <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_CLS[t.status] ?? ''}`}>{t.status}</span></td>
                <td className={`px-3 py-2 text-right font-medium ${t.type === 'entrada' ? 'text-good' : 'text-bad'}`}>
                  {t.type === 'entrada' ? '+' : '−'}{brl(t.amount)}
                </td>
                {canEdit && (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {t.status === 'previsto' && (
                      <button onClick={() => setStatus(t.id, 'realizado')} className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-surface-2">Baixar</button>
                    )}
                    {t.status === 'realizado' && (
                      <button onClick={() => setStatus(t.id, 'conciliado')} className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-surface-2">Conciliar</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- Contas ----------------
function Contas(props: {
  accounts: FinanceAccountList | null;
  canEdit: boolean;
  token: string | null;
  onChange: () => void;
  onError: (e: string) => void;
  onFlash: (m: string) => void;
}) {
  const { accounts, canEdit, token, onChange, onError, onFlash } = props;
  const [form, setForm] = useState({ name: '', type: 'corrente', institution: '', openingBalance: '' });

  const submit = () => {
    if (!form.name) { onError('Informe o nome da conta.'); return; }
    apiPost('/finance/accounts', {
      name: form.name, type: form.type,
      institution: form.institution || undefined,
      openingBalance: form.openingBalance ? Number(form.openingBalance) : undefined,
    }, token)
      .then(() => { onFlash('✅ Conta criada.'); setForm({ name: '', type: 'corrente', institution: '', openingBalance: '' }); onChange(); })
      .catch((e) => onError(e.message));
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="grid gap-2 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
          <input className={inputCls} placeholder="Nome da conta" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {ACCOUNT_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <input className={inputCls} placeholder="Instituição (opcional)" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
          <input className={inputCls} type="number" step="0.01" placeholder="Saldo inicial" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
          <button onClick={submit} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">Criar conta</button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts?.items.length === 0 && <p className="text-sm text-muted">Nenhuma conta cadastrada.</p>}
        {accounts?.items.map((a) => (
          <div key={a.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{a.name}</div>
                <div className="text-[11px] uppercase tracking-wide text-muted">{a.type} · {a.provider}{a.institution ? ` · ${a.institution}` : ''}</div>
              </div>
            </div>
            <div className={`mt-3 text-lg font-semibold ${a.balance >= 0 ? 'text-good' : 'text-bad'}`}>{brl(a.balance)}</div>
            <div className="text-[11px] text-muted">saldo inicial: {brl(a.openingBalance)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Bancos (Open Finance / OFX) ----------------
function loadPluggyConnect(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.PluggyConnect) return resolve(w.PluggyConnect);
    const s = document.createElement('script');
    s.src = 'https://cdn.pluggy.ai/pluggy-connect/v2.9.0/pluggy-connect.js';
    s.onload = () => resolve((window as any).PluggyConnect);
    s.onerror = () => reject(new Error('Não foi possível carregar o Pluggy Connect.'));
    document.body.appendChild(s);
  });
}

function Bancos(props: {
  banks: BankConnectionList | null;
  accounts: FinanceAccountList | null;
  canBank: boolean;
  token: string | null;
  onChange: () => void;
  onError: (e: string) => void;
  onFlash: (m: string) => void;
}) {
  const { banks, accounts, canBank, token, onChange, onError, onFlash } = props;
  const [ofxAccount, setOfxAccount] = useState('');
  const [itemId, setItemId] = useState('');
  const [busy, setBusy] = useState(false);

  const importOfx = (file: File) => {
    if (!ofxAccount) { onError('Escolha a conta de destino do extrato.'); return; }
    setBusy(true);
    file.text()
      .then((content) => apiPost<{ imported: number; skipped: number }>('/finance/import/ofx', { accountId: ofxAccount, content }, token))
      .then((r) => { onFlash(`✅ OFX: ${r.imported} importado(s), ${r.skipped} já existente(s).`); onChange(); })
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false));
  };

  const connectPluggy = async () => {
    setBusy(true);
    try {
      const { accessToken } = await apiPost<{ accessToken: string }>('/finance/bank/pluggy/connect-token', {}, token);
      const PluggyConnect = await loadPluggyConnect();
      const widget = new PluggyConnect({
        connectToken: accessToken,
        includeSandbox: true,
        onSuccess: async (data: any) => {
          try {
            const id = data?.item?.id;
            if (!id) throw new Error('Pluggy não retornou o itemId.');
            await apiPost('/finance/bank/pluggy/item', { itemId: id }, token);
            onFlash('✅ Banco conectado e sincronizado.');
            onChange();
          } catch (e) { onError((e as Error).message); }
        },
        onError: (err: any) => onError(`Pluggy: ${err?.message ?? 'erro na conexão'}`),
      });
      widget.init();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const registerItem = () => {
    if (!itemId) { onError('Cole o itemId do Pluggy.'); return; }
    setBusy(true);
    apiPost('/finance/bank/pluggy/item', { itemId }, token)
      .then(() => { onFlash('✅ Item registrado e sincronizado.'); setItemId(''); onChange(); })
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false));
  };

  const sync = (id: string) => {
    setBusy(true);
    apiPost<{ accounts: number; transactions: number }>(`/finance/bank/connections/${id}/sync`, {}, token)
      .then((r) => { onFlash(`✅ Sync: ${r.accounts} conta(s), ${r.transactions} lançamento(s).`); onChange(); })
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-6">
      {/* OFX — funciona sem credencial */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Importar extrato OFX</h2>
        <p className="mt-1 text-xs text-muted">
          Exporte o extrato do seu banco em <strong>.ofx</strong> e importe aqui. Funciona sem nenhuma credencial.
          Lançamentos são deduplicados por FITID.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className={inputCls} value={ofxAccount} onChange={(e) => setOfxAccount(e.target.value)}>
            <option value="">Conta de destino…</option>
            {accounts?.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input
            type="file" accept=".ofx" disabled={!canBank || busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importOfx(f); e.currentTarget.value = ''; }}
            className="text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
          />
        </div>
        {!canBank && <p className="mt-2 text-[11px] text-muted">Requer permissão financeiro.conciliar.</p>}
      </div>

      {/* Open Finance (Pluggy) */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Open Finance (Pluggy)</h2>
        {banks?.pluggyConfigurado ? (
          <>
            <p className="mt-1 text-xs text-muted">Conecte a conta do banco via Open Finance para sincronizar contas e extrato automaticamente.</p>
            {canBank && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={connectPluggy} disabled={busy} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                  {busy ? 'Aguarde…' : 'Conectar banco'}
                </button>
                <span className="text-[11px] text-muted">ou cole um itemId:</span>
                <input className={inputCls} placeholder="itemId do Pluggy" value={itemId} onChange={(e) => setItemId(e.target.value)} />
                <button onClick={registerItem} disabled={busy} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2">Registrar</button>
              </div>
            )}
          </>
        ) : (
          <p className="mt-1 text-xs text-muted">
            🔒 Não configurado. Defina <code>PLUGGY_CLIENT_ID</code> e <code>PLUGGY_CLIENT_SECRET</code> em
            <code> ~/.config/root/pluggy.env</code> e reinicie a API. Enquanto isso, use a importação OFX acima.
          </p>
        )}
      </div>

      {/* Conexões existentes */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-medium">Conexões bancárias</h2>
        {banks?.items.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma conexão. Conecte um banco acima.</p>
        ) : (
          <ul className="space-y-2">
            {banks?.items.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{c.institutionName ?? c.provider} <span className="text-[11px] text-muted">({c.status})</span></div>
                  <div className="text-[11px] text-muted">
                    {c.accounts} conta(s) · último sync: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString('pt-BR') : '—'}
                    {c.lastError && <span className="text-bad"> · erro: {c.lastError}</span>}
                  </div>
                </div>
                {canBank && (
                  <button onClick={() => sync(c.id)} disabled={busy} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-2">Sincronizar</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
