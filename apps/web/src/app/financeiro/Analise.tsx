'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '@/lib/api';

/*
 * Aba "Análise" do financeiro. Abre com a leitura da IA (guardada por dia no
 * servidor: reabrir não gasta modelo) e, embaixo, os números que ela leu:
 * acordos (o que foi entregue × o que virou caixa), contas recorrentes,
 * fôlego do caixa, próximos 90 dias e dependência de cliente.
 */

type Tipo = 'pagante' | 'permuta' | 'repasse' | 'parceria';
type Linha = { id: string; cliente: string; produto: string; tipo: Tipo; valor: number; observacao: string | null; apelidos: string | null; recebido: number; aReceber: number; semRastro: number };
type Recorrente = { id: string; tipo: 'entrada' | 'saida'; descricao: string; quem: string | null; valor: number; periodicidade: string; dia: number; porMes: number };
type Resumo = {
  caixa: { saldo: number; aReceber: number; aPagar: number; folegoMeses: number | null };
  acordos: { linhas: Linha[]; porTipo: { tipo: Tipo; acordos: number; valor: number; recebido: number; aReceber: number }[]; entregue: number; viraCaixa: number; semCaixaPct: number; semRastro: number };
  recorrentes: { linhas: Recorrente[]; custoMensal: number; receitaMensal: number; coberturaPct: number | null };
  proximos: { dias: number; entra: number; sai: number }[];
  dependencia: { pagador: string; valor: number; pct: number; total90: number } | null;
  pendencias: { semClassificacao: number; vencidoReceber: number; vencidoPagar: number };
};
type Leitura = { texto: string; geradaEm: string; guardada: boolean };

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ROTULO: Record<Tipo, string> = { pagante: 'Pagante', permuta: 'Permuta', repasse: 'Repasse', parceria: 'Parceria' };
const EXPLICA: Record<Tipo, string> = {
  pagante: 'o dinheiro entra na ROOT',
  permuta: 'paga com produto ou serviço, sem caixa',
  repasse: 'entregue pela ROOT, dinheiro foi para outro',
  parceria: 'entregue sem cobrança',
};
const COR: Record<Tipo, string> = { pagante: 'bg-good', permuta: 'bg-brand', repasse: 'bg-warn', parceria: 'bg-muted' };
const inputCls = 'rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim';
const Rotulo = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">{children}</h2>
);

export function AnaliseView({ token, canEdit, onError }: { token: string | null; canEdit: boolean; onError: (e: unknown) => void }) {
  const [r, setR] = useState<Resumo | null>(null);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erroIa, setErroIa] = useState<string | null>(null);
  const [form, setForm] = useState({ cliente: '', produto: '', valor: '', tipo: 'pagante' as Tipo, observacao: '', apelidos: '' });
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<Resumo>('/finance/analise', token).then(setR).catch(onError);
  }, [token, onError]);

  const ler = useCallback((refazer = false) => {
    if (!token) return;
    setLendo(true);
    setErroIa(null);
    apiPost<Leitura>('/finance/analise/leitura', { refazer }, token)
      .then(setLeitura)
      .catch((e) => setErroIa(e instanceof Error ? e.message : String(e)))
      .finally(() => setLendo(false));
  }, [token]);

  useEffect(() => { carregar(); ler(false); }, [carregar, ler]);

  const salvar = () => {
    if (!form.cliente || !form.produto || !form.valor) { onError(new Error('Preencha cliente, produto e valor.')); return; }
    apiPost('/finance/analise/acordos', {
      cliente: form.cliente, produto: form.produto, valor: Number(form.valor), tipo: form.tipo,
      observacao: form.observacao || null, apelidos: form.apelidos || null,
    }, token)
      .then(() => { setForm({ cliente: '', produto: '', valor: '', tipo: 'pagante', observacao: '', apelidos: '' }); setAberto(false); carregar(); })
      .catch(onError);
  };
  const apagar = (id: string) => apiDelete(`/finance/analise/acordos/${id}`, token).then(carregar).catch(onError);

  if (!r) return <p className="text-sm text-muted">Carregando…</p>;
  const max = Math.max(1, ...r.acordos.porTipo.map((t) => t.valor));

  return (
    <div className="space-y-6">
      {/* caixa */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Bloco rotulo="Na conta" valor={brl(r.caixa.saldo)} />
        <Bloco rotulo="Fôlego do caixa" valor={r.caixa.folegoMeses == null ? '—' : `${r.caixa.folegoMeses.toFixed(1)} meses`} nota="saldo ÷ contas recorrentes do mês" />
        <Bloco rotulo="Recorrente entra / mês" valor={brl(r.recorrentes.receitaMensal)} />
        <Bloco rotulo="Recorrente sai / mês" valor={brl(r.recorrentes.custoMensal)}
          nota={r.recorrentes.coberturaPct == null ? undefined : `a receita recorrente cobre ${r.recorrentes.coberturaPct.toFixed(0)}%`} />
      </div>

      {/* acordos */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Rotulo>Entregue × virou caixa</Rotulo>
          <span className="text-sm text-muted">
            {brl(r.acordos.entregue)} entregues · {brl(r.acordos.viraCaixa)} em acordos pagantes · <b className="text-text">{r.acordos.semCaixaPct.toFixed(0)}%</b> sem caixa para a ROOT
          </span>
        </div>
        <div className="mt-2 space-y-2">
          {r.acordos.porTipo.filter((t) => t.acordos > 0).map((t) => (
            <div key={t.tipo} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm">
              <span>{ROTULO[t.tipo]} <span className="text-muted">({t.acordos})</span></span>
              <span className="h-2.5 overflow-hidden rounded bg-surface-2" title={EXPLICA[t.tipo]}>
                <span className={`block h-full ${COR[t.tipo]}`} style={{ width: `${(t.valor / max) * 100}%` }} />
              </span>
              <span className="w-28 text-right tabular-nums">{brl(t.valor)}</span>
            </div>
          ))}
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pr-3">Cliente</th><th className="py-2 pr-3">Acordo</th><th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3 text-right">Valor</th><th className="py-2 pr-3 text-right">Entrou</th>
                <th className="py-2 pr-3 text-right">A receber</th><th className="py-2 pr-3 text-right">Sem rastro</th>{canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {r.acordos.linhas.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-muted">Nenhum acordo cadastrado.</td></tr>}
              {r.acordos.linhas.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2 pr-3">{l.cliente}</td>
                  <td className="py-2 pr-3 text-muted">{l.produto}{l.observacao && <span className="block text-[12px]">{l.observacao}</span>}</td>
                  <td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${COR[l.tipo]}`} />{ROTULO[l.tipo]}</span></td>
                  <td className="py-2 pr-3 text-right tabular-nums">{brl(l.valor)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.recebido ? brl(l.recebido) : '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.aReceber ? brl(l.aReceber) : '—'}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${l.semRastro > 0 ? 'text-warn' : 'text-muted'}`}>{l.semRastro ? brl(l.semRastro) : '—'}</td>
                  {canEdit && <td className="py-2 text-right"><button onClick={() => apagar(l.id)} className="text-[12px] text-muted hover:text-bad">remover</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-muted">
          "Entrou" casa o nome do cliente (ou um apelido) com as entradas do extrato. "Sem rastro" é o que um acordo pagante deveria ter trazido e não aparece nem como recebido nem como a receber.
        </p>
        {canEdit && (
          <div className="mt-3">
            {!aberto ? (
              <button onClick={() => setAberto(true)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">+ Acordo</button>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <input className={inputCls} placeholder="Cliente" value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} />
                <input className={inputCls} placeholder="Produto (ex.: Operação ROOT)" value={form.produto} onChange={(e) => setForm({ ...form, produto: e.target.value })} />
                <input className={inputCls} type="number" step="0.01" placeholder="Valor" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
                <select className={inputCls} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Tipo })}>
                  {(Object.keys(ROTULO) as Tipo[]).map((t) => <option key={t} value={t}>{ROTULO[t]} — {EXPLICA[t]}</option>)}
                </select>
                <input className={inputCls} placeholder="Observação (ex.: valor foi para o Pedro)" value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
                <input className={inputCls} placeholder="Nome no extrato (vírgula separa)" value={form.apelidos} onChange={(e) => setForm({ ...form, apelidos: e.target.value })} />
                <div className="flex gap-2">
                  <button onClick={salvar} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">Salvar</button>
                  <button onClick={() => setAberto(false)} className="rounded-lg border border-border px-3 py-2 text-sm">Cancelar</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* recorrentes */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <Rotulo>Contas recorrentes</Rotulo>
          {r.recorrentes.linhas.length === 0 ? (
            <p className="text-sm text-muted">Nenhum contrato ativo. Cadastre em A Pagar/Receber → Contratos.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {r.recorrentes.linhas.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <span className={`w-14 shrink-0 text-[11px] uppercase ${c.tipo === 'entrada' ? 'text-good' : 'text-muted'}`}>{c.tipo === 'entrada' ? 'entra' : 'sai'}</span>
                  <span className="min-w-0 flex-1 truncate">{c.descricao}<span className="ml-2 text-muted">dia {c.dia}{c.periodicidade !== 'mensal' ? ` · ${c.periodicidade}` : ''}</span></span>
                  <span className="w-28 shrink-0 text-right tabular-nums">{brl(c.porMes)}<span className="text-[11px] text-muted">/mês</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* próximos e dependência */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <Rotulo>Próximos dias</Rotulo>
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="py-1">Em</th><th className="py-1 text-right">Entra</th><th className="py-1 text-right">Sai</th><th className="py-1 text-right">Fica</th></tr></thead>
              <tbody>
                {r.proximos.map((p) => (
                  <tr key={p.dias} className="border-t border-border">
                    <td className="py-1.5">{p.dias} dias</td>
                    <td className="py-1.5 text-right tabular-nums text-good">{brl(p.entra)}</td>
                    <td className="py-1.5 text-right tabular-nums">{brl(p.sai)}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{brl(r.caixa.saldo + p.entra - p.sai)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5 text-sm">
            <Rotulo>Dependência e pendências</Rotulo>
            {r.dependencia && (
              <p><b>{r.dependencia.pct.toFixed(0)}%</b> do que entrou em 90 dias veio de <b>{r.dependencia.pagador}</b> ({brl(r.dependencia.valor)} de {brl(r.dependencia.total90)}).</p>
            )}
            <ul className="mt-2 space-y-1 text-muted">
              <li>{r.pendencias.semClassificacao} movimento(s) sem conta do plano</li>
              <li>{brl(r.pendencias.vencidoReceber)} a receber vencido · {brl(r.pendencias.vencidoPagar)} a pagar vencido</li>
              {r.acordos.semRastro > 0 && <li className="text-warn">{brl(r.acordos.semRastro)} de acordos pagantes sem rastro no caixa</li>}
            </ul>
          </div>
        </div>
      </div>
      {/* leitura da IA */}
      <div className="rounded-xl border border-brand/30 bg-surface p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <Rotulo>Leitura da IA</Rotulo>
          <button onClick={() => ler(true)} disabled={lendo} className="rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:text-text disabled:opacity-50">
            {lendo ? 'Lendo os números…' : 'Refazer a leitura'}
          </button>
        </div>
        {erroIa && <p className="text-sm text-bad">{erroIa}</p>}
        {!leitura && !erroIa && <p className="text-sm text-muted">Lendo os números…</p>}
        {leitura && (
          <>
            <ul className="space-y-2 text-[15px] leading-relaxed">
              {leitura.texto.split('\n').map((l) => l.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean).map((l, i) => {
                const [fato, acao] = l.split(' → ');
                return (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                    <span>{fato}{acao && <span className="text-brand"> → {acao}</span>}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[11px] text-muted">
              {leitura.guardada ? 'Leitura de hoje, guardada' : 'Leitura nova'} · {new Date(leitura.geradaEm).toLocaleString('pt-BR')}
            </p>
          </>
        )}
      </div>

    </div>
  );
}

function Bloco({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted">{rotulo}</div>
      <div className="mt-1 text-xl font-semibold">{valor}</div>
      {nota && <div className="mt-1 text-[12px] text-muted">{nota}</div>}
    </div>
  );
}
