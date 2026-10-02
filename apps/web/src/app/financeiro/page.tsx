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
  ChartAccountList,
  Dre,
  PartnerList,
  Contract,
  ContractList,
  GerarContratoResposta,
  Payables,
  Conciliacao,
  Kpis,
  Cashflow,
} from '@mktos/shared';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
// O cartão local que existia aqui sombreava o compartilhado e deixava a tela
// financeira com o visual antigo ao lado do novo. Mesmas props, um só cartão.
import { KpiCard } from '@/components/KpiCard';

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
  { key: 'dre', label: 'DRE' },
  { key: 'apar', label: 'A Pagar/Receber' },
  { key: 'conciliacao', label: 'Conciliação' },
  { key: 'lancamentos', label: 'Lançamentos' },
  { key: 'plano', label: 'Plano de Contas' },
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
  const [chart, setChart] = useState<ChartAccountList | null>(null);
  const [dre, setDre] = useState<Dre | null>(null);
  const [dreMonth, setDreMonth] = useState<string>(today().slice(0, 7));
  const [partners, setPartners] = useState<PartnerList | null>(null);
  const [contracts, setContracts] = useState<ContractList | null>(null);
  const [payables, setPayables] = useState<Payables | null>(null);
  const [concil, setConcil] = useState<Conciliacao | null>(null);
  const [concilAcc, setConcilAcc] = useState<string>('');
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [cashflow, setCashflow] = useState<Cashflow | null>(null);

  const [txFilter, setTxFilter] = useState<{ status?: string; type?: string; accountId?: string }>({});

  const loadAll = useCallback(() => {
    if (!token) return;
    setError(null);
    apiGet<FinanceSummary>('/finance/summary', token).then(setSummary).catch((e) => setError(e.message));
    apiGet<FinanceAccountList>('/finance/accounts', token).then(setAccounts).catch(() => {});
    apiGet<FinanceCategoryList>('/finance/categories', token).then(setCategories).catch(() => {});
    apiGet<BankConnectionList>('/finance/bank/connections', token).then(setBanks).catch(() => {});
    apiGet<ChartAccountList>('/finance/chart-accounts', token).then(setChart).catch(() => {});
    apiGet<PartnerList>('/finance/partners', token).then(setPartners).catch(() => {});
    apiGet<Kpis>('/finance/kpis', token).then(setKpis).catch(() => {});
    apiGet<Cashflow>('/finance/cashflow', token).then(setCashflow).catch(() => {});
  }, [token]);

  const loadApar = useCallback(() => {
    if (!token) return;
    apiGet<Payables>('/finance/payables', token).then(setPayables).catch((e) => setError(e.message));
    apiGet<ContractList>('/finance/contracts', token).then(setContracts).catch(() => {});
  }, [token]);

  const loadConcil = useCallback(() => {
    if (!token) return;
    const q = concilAcc ? `?accountId=${concilAcc}` : '';
    apiGet<Conciliacao>(`/finance/conciliacao${q}`, token).then(setConcil).catch((e) => setError(e.message));
  }, [token, concilAcc]);

  const loadDre = useCallback(() => {
    if (!token) return;
    apiGet<Dre>(`/finance/dre?month=${dreMonth}`, token).then(setDre).catch((e) => setError(e.message));
  }, [token, dreMonth]);

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

  useEffect(() => {
    if (!ready || !token) return;
    loadDre();
  }, [ready, token, loadDre]);

  useEffect(() => {
    if (!ready || !token) return;
    loadApar();
  }, [ready, token, loadApar]);

  useEffect(() => {
    if (!ready || !token) return;
    loadConcil();
  }, [ready, token, loadConcil]);

  const flash = (m: string) => {
    setMsg(m);
    setError(null);
    setTimeout(() => setMsg(null), 4000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
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

      {tab === 'visao' && <Visao summary={summary} kpis={kpis} cashflow={cashflow} />}
      {tab === 'dre' && <DreView dre={dre} month={dreMonth} setMonth={setDreMonth} />}
      {tab === 'apar' && (
        <ApAr
          payables={payables}
          contracts={contracts}
          partners={partners}
          accounts={accounts}
          chart={chart}
          canEdit={canEdit}
          token={token}
          onChange={() => { loadApar(); loadAll(); loadTxs(); }}
          onError={setError}
          onFlash={flash}
        />
      )}
      {tab === 'conciliacao' && (
        <ConciliacaoView
          concil={concil}
          accounts={accounts}
          accountId={concilAcc}
          setAccountId={setConcilAcc}
          canBank={canBank}
          token={token}
          onChange={() => { loadConcil(); loadAll(); loadApar(); }}
          onError={setError}
          onFlash={flash}
        />
      )}
      {tab === 'plano' && <PlanoContas chart={chart} />}
      {tab === 'lancamentos' && (
        <Lancamentos
          txs={txs}
          accounts={accounts}
          categories={categories}
          chart={chart}
          partners={partners}
          canEdit={canEdit}
          token={token}
          filter={txFilter}
          setFilter={setTxFilter}
          onChange={() => { loadTxs(); loadAll(); loadDre(); loadApar(); }}
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

function CashflowChart({ cashflow }: { cashflow: Cashflow | null }) {
  if (!cashflow || cashflow.days.length === 0) return null;
  const vals = cashflow.days.map((d) => d.acumulado);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const range = max - min || 1;
  const W = 100, H = 34;
  const pts = cashflow.days.map((d, i) => {
    const x = (i / Math.max(cashflow.days.length - 1, 1)) * W;
    const y = H - ((d.acumulado - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const zeroY = H - ((0 - min) / range) * H;
  const last = vals[vals.length - 1];
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Fluxo de caixa projetado (30 dias)</h2>
        <span className={`text-sm font-semibold ${last >= 0 ? 'text-good' : 'text-bad'}`}>{brl(last)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full">
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="currentColor" strokeWidth="0.3" className="text-border" />
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="0.8" className={last >= 0 ? 'text-good' : 'text-bad'} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted">
        <span>{cashflow.window.from}</span><span>abertura {brl(cashflow.openingBalance)}</span><span>{cashflow.window.to}</span>
      </div>
    </div>
  );
}

function Visao({ summary, kpis, cashflow }: { summary: FinanceSummary | null; kpis: Kpis | null; cashflow: Cashflow | null }) {
  if (!summary) return <p className="text-sm text-muted">Carregando…</p>;
  return (
    <div className="space-y-6">
      {kpis && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard label="Margem bruta" value={`${kpis.margens.bruta.toFixed(1)}%`} hint="MC / Faturamento líq." tone={kpis.margens.bruta >= 0 ? 'good' : 'bad'} />
            <KpiCard label="Margem EBITDA" value={`${kpis.margens.ebitda.toFixed(1)}%`} tone={kpis.margens.ebitda >= 0 ? 'good' : 'bad'} />
            <KpiCard label="Margem líquida" value={`${kpis.margens.liquida.toFixed(1)}%`} hint={`LL ${brl(kpis.dre.ll)}`} tone={kpis.margens.liquida >= 0 ? 'good' : 'bad'} />
            <KpiCard label="Inadimplência" value={`${kpis.inadimplencia.toFixed(1)}%`} hint={`${brl(kpis.aReceberVencido)} vencido`} tone={kpis.inadimplencia > 0 ? 'warn' : 'good'} />
            <KpiCard label="Índice de acurácia" value={`${kpis.acuracidade.toFixed(0)}%`} hint={`${kpis.bankConciliado}/${kpis.bankTotal} conciliados`} tone={kpis.acuracidade >= 90 ? 'good' : 'warn'} />
          </div>
          <CashflowChart cashflow={cashflow} />
        </>
      )}
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
          <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Saldo por conta</h2>
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
          <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Top categorias do mês</h2>
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
        {summary.bancos.pluggyConfigurado ? ' · Pluggy ✓' : ''}
        {summary.bancos.asaasConfigurado ? ' · Asaas ✓' : ''} ·
        fonte: {summary.source.tool} · {new Date(summary.source.generatedAt).toLocaleString('pt-BR')}
      </p>
    </div>
  );
}

// ---------------- DRE (Motor Vortex) ----------------
function DreView({ dre, month, setMonth }: { dre: Dre | null; month: string; setMonth: (m: string) => void }) {
  const fmt = (l: { valor: number; isPercent: boolean }) =>
    l.isPercent ? `${l.valor.toFixed(1)}%` : brl(l.valor);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted">Competência (mês)</label>
        <input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} />
        {dre && <span className="text-sm text-muted">{dre.period.label}</span>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 w-16">Cód.</th>
              <th className="px-3 py-2">Linha</th>
              <th className="px-3 py-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {!dre && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">Carregando…</td></tr>}
            {dre?.lines.filter((l) => l.visivel).map((l) => {
              const strong = l.tipo === 'calculado' || l.tipo === 'grupo';
              const isResult = l.codigo === 'LL' || l.codigo === 'EBITDA' || l.codigo === 'FL' || l.codigo === 'MC';
              return (
                <tr key={l.codigo} className={`border-t border-border ${strong ? 'bg-surface-2/40 font-medium' : ''}`}>
                  <td className="px-3 py-1.5 text-[11px] text-muted">{l.codigo}</td>
                  <td className={`px-3 py-1.5 ${l.tipo === 'origem' ? 'pl-6 text-muted' : ''}`}>
                    <span className="mr-1 text-[11px] text-muted">{l.operador !== '( )' ? l.operador : ''}</span>{l.nome}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${
                    l.isPercent ? 'text-muted' : isResult ? (l.valor >= 0 ? 'text-good' : 'text-bad') : ''
                  }`}>
                    {fmt(l)}
                  </td>
                </tr>
              );
            })}
            {dre && dre.lines.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">Sem template de DRE. Rode o seed FinOps.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">
        O DRE soma os lançamentos <strong>realizados/conciliados</strong> do mês, classificados pela conta do
        plano de contas. Categorize os lançamentos (aba Lançamentos) para as linhas se preencherem.
      </p>
    </div>
  );
}

// ---------------- Plano de Contas ----------------
function PlanoContas({ chart }: { chart: ChartAccountList | null }) {
  if (!chart) return <p className="text-sm text-muted">Carregando…</p>;
  if (chart.items.length === 0)
    return <p className="text-sm text-muted">Plano de contas vazio. Rode o seed FinOps (<code>db:seed:finops</code>).</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{chart.total} contas · plano de contas gerencial FullBPO (mapeado ao DRE).</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 w-20">Código</th>
              <th className="px-3 py-2">Conta</th>
              <th className="px-3 py-2 w-24">Tipo</th>
              <th className="px-3 py-2 w-24">DRE</th>
            </tr>
          </thead>
          <tbody>
            {chart.items.map((c) => (
              <tr key={c.id} className={`border-t border-border ${c.nivel < 3 ? 'bg-surface-2/30 font-medium' : ''}`}>
                <td className="px-3 py-1.5 text-[11px] text-muted tabular-nums">{c.codigo}</td>
                <td className="px-3 py-1.5" style={{ paddingLeft: `${0.75 + (c.nivel - 1) * 1}rem` }}>
                  {c.nome}{!c.ativo && <span className="ml-1 text-[10px] text-muted">(inativo)</span>}
                </td>
                <td className="px-3 py-1.5">
                  <span className={`text-[11px] ${c.tipo === 'receita' ? 'text-good' : 'text-muted'}`}>{c.tipo}</span>
                </td>
                <td className="px-3 py-1.5 text-[11px] text-muted">{c.dreCodigo ?? (c.permiteLancamento ? '—' : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- Conciliação bancária (score) ----------------
function ConciliacaoView(props: {
  concil: Conciliacao | null;
  accounts: FinanceAccountList | null;
  accountId: string;
  setAccountId: (a: string) => void;
  canBank: boolean;
  token: string | null;
  onChange: () => void;
  onError: (e: string) => void;
  onFlash: (m: string) => void;
}) {
  const { concil, accounts, accountId, setAccountId, canBank, token, onChange, onError, onFlash } = props;
  const [sel, setSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const auto = () => {
    setBusy(true);
    apiPost<{ conciliados: number; sugestoes: number }>(`/finance/conciliacao/auto${accountId ? `?accountId=${accountId}` : ''}`, {}, token)
      .then((r) => { onFlash(`✅ ${r.conciliados} conciliado(s) automaticamente · ${r.sugestoes} sugestão(ões) restante(s).`); onChange(); })
      .catch((e) => onError(e.message)).finally(() => setBusy(false));
  };
  const conciliar = (movimentoId: string, tituloId: string) => {
    if (!tituloId) { onError('Escolha um título para conciliar.'); return; }
    apiPost<{ score: number }>('/finance/conciliacao/match', { movimentoId, tituloId }, token)
      .then((r) => { onFlash(`Conciliado (score ${r.score}).`); onChange(); }).catch((e) => onError(e.message));
  };

  const titulos = concil?.titulos ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Todas as contas</option>
          {accounts?.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {concil && <span className="text-sm text-muted">{concil.stats.movimentosAbertos} movimento(s) · {concil.stats.titulosAbertos} título(s) em aberto</span>}
        {canBank && (
          <button onClick={auto} disabled={busy} className="ml-auto rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-60">
            {busy ? 'Conciliando…' : 'Auto-conciliar'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted">
        Movimentos bancários (OFX/Pluggy) ainda não conciliados. O score combina valor (50%) + data (30%) + tipo (20%);
        ≥0,85 concilia automático, 0,50–0,84 fica como sugestão para confirmar.
      </p>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Movimento</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Sugestão</th>
              <th className="px-3 py-2">Título</th>
              {canBank && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {concil?.movimentos.length === 0 && <tr><td colSpan={canBank ? 6 : 5} className="px-3 py-6 text-center text-muted">Nenhum movimento a conciliar. Importe um OFX (aba Bancos) ou conecte o Pluggy.</td></tr>}
            {concil?.movimentos.map((m) => {
              const chosen = sel[m.id] ?? m.sugestaoTituloId ?? '';
              return (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{dateBR(m.date)}</td>
                  <td className="px-3 py-2">{m.description}</td>
                  <td className={`px-3 py-2 text-right font-medium ${m.type === 'entrada' ? 'text-good' : 'text-bad'}`}>{brl(m.amount)}</td>
                  <td className="px-3 py-2">
                    {m.sugestaoTituloId
                      ? <span className={`rounded px-1.5 py-0.5 text-[11px] ${m.sugestaoAuto ? 'bg-good/15 text-good' : 'bg-warn/15 text-warn'}`}>{Math.round(m.sugestaoScore * 100)}%{m.sugestaoAuto ? ' auto' : ''}</span>
                      : <span className="text-[11px] text-muted">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <select className={`${inputCls} py-1 text-[12px]`} value={chosen} onChange={(e) => setSel({ ...sel, [m.id]: e.target.value })}>
                      <option value="">Escolher título…</option>
                      {titulos.filter((t) => t.type === m.type).map((t) => (
                        <option key={t.id} value={t.id}>{t.description} · {brl(t.amount)} · {dateBR(t.dueDate)}</option>
                      ))}
                    </select>
                  </td>
                  {canBank && (
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => conciliar(m.id, chosen)} className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-surface-2">Conciliar</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- A Pagar / Receber (AP/AR) ----------------
const APPROVAL_CLS: Record<string, string> = {
  aguardando: 'bg-warn/15 text-warn',
  aprovado: 'bg-good/15 text-good',
  rejeitado: 'bg-bad/15 text-bad',
  nao_requer: 'text-muted',
};

function ApAr(props: {
  payables: Payables | null;
  contracts: ContractList | null;
  partners: PartnerList | null;
  accounts: FinanceAccountList | null;
  chart: ChartAccountList | null;
  canEdit: boolean;
  token: string | null;
  onChange: () => void;
  onError: (e: string) => void;
  onFlash: (m: string) => void;
}) {
  const { payables, contracts, partners, accounts, chart, canEdit, token, onChange, onError, onFlash } = props;
  const [pForm, setPForm] = useState({ razaoSocial: '', cnpjCpf: '', isCliente: false, isFornecedor: true });
  const [cForm, setCForm] = useState({
    tipo: 'saida', descricao: '', valor: '', diaVencimento: '5', periodicidade: 'mensal',
    partnerId: '', accountId: '', chartAccountId: '', dataInicio: today(),
  });
  const [gerando, setGerando] = useState<string | null>(null);
  const lancaveis = (chart?.items ?? []).filter((c) => c.permiteLancamento && c.ativo);

  const doApprove = (id: string, aprovar: boolean) =>
    apiPost(`/finance/transactions/${id}/approve`, { aprovar }, token)
      .then(() => { onFlash(aprovar ? 'Aprovado.' : 'Rejeitado.'); onChange(); }).catch((e) => onError(e.message));
  const baixar = (id: string) =>
    apiPatch(`/finance/transactions/${id}`, { status: 'realizado' }, token)
      .then(() => { onFlash('Baixado (realizado).'); onChange(); }).catch((e) => onError(e.message));
  // O vencimento vai no pedido: repetir o mesmo devolve o lançamento já gravado
  // (`replayed`) em vez de gerar a parcela seguinte.
  const gerar = (c: Contract) => {
    setGerando(c.id);
    apiPost<GerarContratoResposta>(`/finance/contracts/${c.id}/gerar`, { vencimento: c.proximoVencimento }, token)
      .then((r) => {
        onFlash(r.replayed
          ? 'Este vencimento já tinha sido gerado. Nenhum lançamento novo.'
          : 'Lançamento gerado a partir do contrato.');
        onChange();
      })
      .catch((e) => onError(e.message))
      .finally(() => setGerando(null));
  };
  const addPartner = () => {
    if (!pForm.razaoSocial) { onError('Informe a razão social.'); return; }
    apiPost('/finance/partners', pForm, token)
      .then(() => { onFlash('Parceiro criado.'); setPForm({ razaoSocial: '', cnpjCpf: '', isCliente: false, isFornecedor: true }); onChange(); })
      .catch((e) => onError(e.message));
  };
  const addContract = () => {
    if (!cForm.descricao || !cForm.valor || !cForm.accountId) { onError('Contrato: descrição, valor e conta bancária.'); return; }
    apiPost('/finance/contracts', {
      tipo: cForm.tipo, descricao: cForm.descricao, valor: Number(cForm.valor),
      diaVencimento: Number(cForm.diaVencimento), periodicidade: cForm.periodicidade,
      partnerId: cForm.partnerId || undefined, accountId: cForm.accountId,
      chartAccountId: cForm.chartAccountId || undefined, dataInicio: cForm.dataInicio,
    }, token)
      .then(() => { onFlash('Contrato criado.'); setCForm({ ...cForm, descricao: '', valor: '' }); onChange(); })
      .catch((e) => onError(e.message));
  };

  const t = payables?.totals;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card label="A pagar" value={brl(t?.aPagar ?? 0)} tone="bad" />
        <Card label="A receber" value={brl(t?.aReceber ?? 0)} tone="good" />
        <Card label="Vencido a pagar" value={brl(t?.vencidoPagar ?? 0)} tone={t && t.vencidoPagar > 0 ? 'warn' : undefined} />
        <Card label="Vencido a receber" value={brl(t?.vencidoReceber ?? 0)} tone={t && t.vencidoReceber > 0 ? 'warn' : undefined} />
        <Card label="Aguardando aprovação" value={String(t?.aguardandoAprovacao ?? 0)} tone={t && t.aguardandoAprovacao > 0 ? 'warn' : undefined} />
      </div>
      {payables && <p className="text-[11px] text-muted">Limite de aprovação: saídas acima de {brl(payables.approvalLimit)} exigem aprovação humana antes da baixa.</p>}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">Parceiro</th>
              <th className="px-3 py-2">Vencimento</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Aprovação</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {payables?.items.length === 0 && <tr><td colSpan={canEdit ? 7 : 6} className="px-3 py-6 text-center text-muted">Nada previsto. Crie lançamentos “previstos” ou gere de um contrato.</td></tr>}
            {payables?.items.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2"><span className={r.tipo === 'saida' ? 'text-bad' : 'text-good'}>{r.tipo === 'saida' ? 'pagar' : 'receber'}</span></td>
                <td className="px-3 py-2">{r.description}{r.chartCodigo && <span className="ml-1 text-[10px] text-muted">[{r.chartCodigo}]</span>}</td>
                <td className="px-3 py-2 text-muted">{r.partnerName ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {dateBR(r.dueDate)}{r.vencido && <span className="ml-1 text-[10px] text-warn">({r.diasAtraso}d atraso)</span>}
                </td>
                <td className={`px-3 py-2 text-right font-medium ${r.tipo === 'saida' ? 'text-bad' : 'text-good'}`}>{brl(r.amount)}</td>
                <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[11px] ${APPROVAL_CLS[r.approvalStatus] ?? ''}`}>{r.approvalStatus.replace('_', ' ')}</span></td>
                {canEdit && (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.approvalStatus === 'aguardando' ? (
                      <>
                        <button onClick={() => doApprove(r.id, true)} className="rounded border border-border px-2 py-0.5 text-[11px] text-good hover:bg-surface-2">Aprovar</button>
                        <button onClick={() => doApprove(r.id, false)} className="ml-1 rounded border border-border px-2 py-0.5 text-[11px] text-bad hover:bg-surface-2">Rejeitar</button>
                      </>
                    ) : r.approvalStatus !== 'rejeitado' ? (
                      <button onClick={() => baixar(r.id)} className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-surface-2">Baixar</button>
                    ) : null}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Contratos recorrentes */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-2 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Contratos recorrentes</h2>
        {canEdit && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select className={inputCls} value={cForm.tipo} onChange={(e) => setCForm({ ...cForm, tipo: e.target.value })}>
              <option value="saida">A pagar</option><option value="entrada">A receber</option>
            </select>
            <input className={inputCls} placeholder="Descrição" value={cForm.descricao} onChange={(e) => setCForm({ ...cForm, descricao: e.target.value })} />
            <input className={inputCls} type="number" step="0.01" placeholder="Valor" value={cForm.valor} onChange={(e) => setCForm({ ...cForm, valor: e.target.value })} />
            <input className={inputCls} type="number" min="1" max="31" placeholder="Dia venc." value={cForm.diaVencimento} onChange={(e) => setCForm({ ...cForm, diaVencimento: e.target.value })} />
            <select className={inputCls} value={cForm.accountId} onChange={(e) => setCForm({ ...cForm, accountId: e.target.value })}>
              <option value="">Conta bancária…</option>
              {accounts?.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className={inputCls} value={cForm.chartAccountId} onChange={(e) => setCForm({ ...cForm, chartAccountId: e.target.value })}>
              <option value="">Conta contábil (DRE)…</option>
              {lancaveis.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
            </select>
            <select className={inputCls} value={cForm.partnerId} onChange={(e) => setCForm({ ...cForm, partnerId: e.target.value })}>
              <option value="">Parceiro…</option>
              {partners?.items.map((p) => <option key={p.id} value={p.id}>{p.razaoSocial}</option>)}
            </select>
            <button onClick={addContract} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">+ Contrato</button>
          </div>
        )}
        <ul className="space-y-1 text-sm">
          {contracts?.items.length === 0 && <li className="text-muted">Nenhum contrato.</li>}
          {contracts?.items.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span>
                <span className={c.tipo === 'saida' ? 'text-bad' : 'text-good'}>{c.tipo === 'saida' ? 'pagar' : 'receber'}</span> · {c.descricao} · {brl(c.valor)} / {c.periodicidade}
                <span className="ml-2 text-[11px] text-muted">próx.: {dateBR(c.proximoVencimento)}</span>
              </span>
              {canEdit && (
                <button onClick={() => gerar(c)} disabled={gerando !== null} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-2 disabled:opacity-60">
                  {gerando === c.id ? 'Gerando…' : 'Gerar lançamento'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Parceiros */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-2 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Fornecedores / clientes</h2>
        {canEdit && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input className={inputCls} placeholder="Razão social" value={pForm.razaoSocial} onChange={(e) => setPForm({ ...pForm, razaoSocial: e.target.value })} />
            <input className={inputCls} placeholder="CNPJ/CPF" value={pForm.cnpjCpf} onChange={(e) => setPForm({ ...pForm, cnpjCpf: e.target.value })} />
            <label className="flex items-center gap-1 text-sm text-muted"><input type="checkbox" checked={pForm.isFornecedor} onChange={(e) => setPForm({ ...pForm, isFornecedor: e.target.checked })} /> fornecedor</label>
            <label className="flex items-center gap-1 text-sm text-muted"><input type="checkbox" checked={pForm.isCliente} onChange={(e) => setPForm({ ...pForm, isCliente: e.target.checked })} /> cliente</label>
            <button onClick={addPartner} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">+ Parceiro</button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {partners?.items.length === 0 && <span className="text-sm text-muted">Nenhum parceiro.</span>}
          {partners?.items.map((p) => (
            <span key={p.id} className="rounded-lg border border-border px-2 py-1 text-[12px]">
              {p.razaoSocial} <span className="text-[10px] text-muted">{[p.isFornecedor && 'forn.', p.isCliente && 'cli.'].filter(Boolean).join('/')}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- Lançamentos ----------------
function Lancamentos(props: {
  txs: FinanceTransactionList | null;
  accounts: FinanceAccountList | null;
  categories: FinanceCategoryList | null;
  chart: ChartAccountList | null;
  partners: PartnerList | null;
  canEdit: boolean;
  token: string | null;
  filter: { status?: string; type?: string; accountId?: string };
  setFilter: (f: { status?: string; type?: string; accountId?: string }) => void;
  onChange: () => void;
  onError: (e: string) => void;
  onFlash: (m: string) => void;
}) {
  const { txs, accounts, categories, chart, partners, canEdit, token, filter, setFilter, onChange, onError, onFlash } = props;
  const [form, setForm] = useState({
    accountId: '', categoryId: '', chartAccountId: '', partnerId: '', type: 'saida' as FinanceTxTypeValue,
    status: 'realizado' as FinanceTxStatusValue, description: '', amount: '', date: today(), dueDate: '',
  });
  const [open, setOpen] = useState(false);
  const lancaveis = (chart?.items ?? []).filter((c) => c.permiteLancamento && c.ativo);

  const submit = () => {
    if (!form.accountId || !form.description || !form.amount) {
      onError('Preencha conta, descrição e valor.');
      return;
    }
    apiPost('/finance/transactions', {
      accountId: form.accountId,
      categoryId: form.categoryId || undefined,
      chartAccountId: form.chartAccountId || undefined,
      partnerId: form.partnerId || undefined,
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
          <button onClick={() => setOpen((o) => !o)} className="ml-auto rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">
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
          <select className={inputCls} value={form.chartAccountId} onChange={(e) => setForm({ ...form, chartAccountId: e.target.value })}>
            <option value="">Conta contábil / DRE (opcional)…</option>
            {lancaveis.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}{c.dreCodigo ? ` [${c.dreCodigo}]` : ''}</option>)}
          </select>
          <select className={inputCls} value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value })}>
            <option value="">Fornecedor / cliente (opcional)…</option>
            {partners?.items.map((p) => <option key={p.id} value={p.id}>{p.razaoSocial}</option>)}
          </select>
          <input className={inputCls} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          {form.status === 'previsto' && (
            <input className={inputCls} type="date" title="Vencimento" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          )}
          <button onClick={submit} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">Salvar</button>
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
          <button onClick={submit} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">Criar conta</button>
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

  const connectAsaas = () => {
    setBusy(true);
    apiPost<{ transactions: number; receivables: number }>('/finance/bank/asaas/connect', {}, token)
      .then((r) => { onFlash(`✅ Asaas conectado: ${r.transactions} lançamento(s), ${r.receivables} a receber.`); onChange(); })
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-6">
      {/* OFX — funciona sem credencial */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Importar extrato OFX</h2>
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
            className="text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
          />
        </div>
        {!canBank && <p className="mt-2 text-[11px] text-muted">Requer permissão financeiro.conciliar.</p>}
      </div>

      {/* Open Finance (Pluggy) */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Open Finance (Pluggy)</h2>
        {banks?.pluggyConfigurado ? (
          <>
            <p className="mt-1 text-xs text-muted">Conecte a conta do banco via Open Finance para sincronizar contas e extrato automaticamente.</p>
            {canBank && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={connectPluggy} disabled={busy} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-60">
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

      {/* Asaas — gateway de cobranças + conta digital */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Asaas (cobranças + conta digital)</h2>
        {banks?.asaasConfigurado ? (
          <>
            <p className="mt-1 text-xs text-muted">
              Puxa <strong>tudo</strong> da sua conta Asaas: extrato (caixa realizado), cobranças em aberto (contas a receber) e
              saldo. Depois de conectar, sincroniza sozinho a cada 6h. Deduplica por id do Asaas.
            </p>
            {canBank && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={connectAsaas} disabled={busy} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-60">
                  {busy ? 'Aguarde…' : 'Conectar e sincronizar'}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="mt-1 text-xs text-muted">
            🔒 Não configurado. Defina <code>ASAAS_API_KEY</code> em <code>~/.config/root/asaas.env</code> e reinicie a API.
            A chave sai no painel do Asaas em <em>Configurações → Integrações → API</em>.
          </p>
        )}
      </div>

      {/* Conexões existentes */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-2 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Conexões bancárias</h2>
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
