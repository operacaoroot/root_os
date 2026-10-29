'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Cashflow } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * FLUXO DE CAIXA PROJETADO EM 6 MESES (layout 26/10/2026, P-25).
 *
 * A mesma conta do gráfico de 30 dias (`/finance/cashflow`, que aceita qualquer
 * janela), somada por mês: entradas sobem em verde, saídas descem em vermelho e
 * o saldo no fim de cada mês fica marcado em cima. Mês sem nada lançado é
 * sinalizado: a projeção só enxerga o que já está lançado (contrato recorrente
 * que ainda não gerou a parcela não aparece).
 */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const curto = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1000 ? `${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: a >= 10000 ? 0 : 1 })} mil` : a.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  return `${n < 0 ? '−' : ''}R$ ${s}`;
};
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Mes { chave: string; rotulo: string; entradas: number; saidas: number; saldo: number; vazio: boolean; estimativa: number; saldoEst: number }

export function FluxoSeisMeses() {
  const { token, ready } = useAuth();
  const [fluxo, setFluxo] = useState<Cashflow | null>(null);
  const [erro, setErro] = useState(false);
  const [foco, setFoco] = useState<string | null>(null);
  // Layout 26/10: o desenho usa a largura real da caixa (1 unidade = 1 px). Antes o SVG esticava
  // junto com a tela e os textos e barras ficavam gigantes em monitor largo.
  const [caixa, setCaixa] = useState<HTMLDivElement | null>(null);
  const [larguraDaCaixa, setLarguraDaCaixa] = useState(720);
  useEffect(() => {
    if (!caixa) return;
    const medir = () => setLarguraDaCaixa(Math.max(520, Math.round(caixa.clientWidth)));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(caixa);
    return () => ro.disconnect();
  }, [caixa]);

  useEffect(() => {
    if (!ready || !token) return;
    const hoje = new Date();
    const de = hoje.toISOString().slice(0, 10);
    const ate = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 6, 0)).toISOString().slice(0, 10);
    apiGet<Cashflow>(`/finance/cashflow?from=${de}&to=${ate}`, token).then(setFluxo).catch(() => setErro(true));
  }, [ready, token]);

  const meses = useMemo<Mes[]>(() => {
    if (!fluxo) return [];
    const porMes = new Map<string, Mes>();
    for (const d of fluxo.days) {
      const chave = d.date.slice(0, 7);
      const m = porMes.get(chave) ?? { chave, rotulo: `${MESES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}`, entradas: 0, saidas: 0, saldo: d.acumulado, vazio: true, estimativa: 0, saldoEst: d.acumulado };
      m.entradas += d.entradas; m.saidas += d.saidas; m.saldo = d.acumulado;
      m.estimativa += d.estimativa ?? 0; m.saldoEst = d.acumuladoComEstimativa ?? d.acumulado;
      if (d.entradas || d.saidas) m.vazio = false;
      porMes.set(chave, m);
    }
    return [...porMes.values()].sort((a, b) => a.chave.localeCompare(b.chave)).slice(0, 6);
  }, [fluxo]);

  if (erro) return null;
  if (!fluxo) return <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">Carregando a projeção de 6 meses…</div>;

  // Escala: barras de entrada para cima e de saída para baixo, a partir da linha do zero.
  const maior = Math.max(1, ...meses.map((m) => Math.max(m.entradas, m.saidas + m.estimativa)));
  const temEstimativa = meses.some((m) => m.estimativa > 0);
  const ultimo = meses[meses.length - 1];
  const L = larguraDaCaixa, A = 190, topo = 40, base = 26, meio = topo + (A - topo - base) / 2, meiaAltura = (A - topo - base) / 2 - 6;
  const passo = L / Math.max(1, meses.length), largura = Math.min(36, passo * 0.3);
  const alt = (v: number) => (v / maior) * meiaAltura;
  const sel = meses.find((m) => m.chave === foco) ?? null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4" data-testid="fluxo-seis-meses">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">Fluxo de caixa · próximos 6 meses</h2>
          <p className="text-[12px] text-muted">
            entradas para cima, saídas para baixo, saldo no fim de cada mês · clique num mês
            {temEstimativa && <> · em cinza, a estimativa de variáveis (não lançada)</>}
          </p>
        </div>
        {ultimo && (
          <span className="text-right text-sm text-muted">
            saldo em {ultimo.rotulo}: <b className="font-os-mono text-text">{brl(ultimo.saldo)}</b>
            {temEstimativa && <span className="block text-[11px]">{brl(ultimo.saldoEst)} com a estimativa de variáveis</span>}
          </span>
        )}
      </div>
      <div ref={setCaixa} className="overflow-x-auto">
        <svg viewBox={`0 0 ${L} ${A}`} width={L} height={A} className="block max-w-none" role="img" aria-label="Entradas, saídas e saldo por mês nos próximos 6 meses">
          <line x1="0" x2={L} y1={meio} y2={meio} stroke="rgb(var(--os-line-strong))" strokeWidth="1" />
          {meses.map((m, i) => {
            const cx = passo * i + passo / 2;
            const ativo = foco === m.chave;
            return (
              <g key={m.chave} onClick={() => setFoco(ativo ? null : m.chave)} className="cursor-pointer">
                <rect x={passo * i + 2} y={topo - 6} width={passo - 4} height={A - topo - base + 12} fill={ativo ? 'rgb(var(--os-s2))' : 'transparent'} rx="6" />
                <text x={cx} y={18} textAnchor="middle" fontSize="12" fontWeight="600" fill={m.saldo < 0 ? 'rgb(var(--os-err))' : 'rgb(var(--os-tx))'} className="font-os-mono">{curto(m.saldo)}</text>
                <text x={cx} y={32} textAnchor="middle" fontSize="10" fill="rgb(var(--os-tx3))">saldo no fim</text>
                {m.entradas > 0 && (
                  <>
                    <rect x={cx - largura - 2} y={meio - alt(m.entradas)} width={largura} height={alt(m.entradas)} rx="3" fill="rgb(var(--os-ok))" />
                    <text x={cx - largura / 2 - 2} y={meio - alt(m.entradas) - 4} textAnchor="middle" fontSize="10" fill="rgb(var(--os-tx2))">{curto(m.entradas)}</text>
                  </>
                )}
                {m.saidas > 0 && (
                  <rect x={cx + 2} y={meio} width={largura} height={alt(m.saidas)} rx="3" fill="rgb(var(--os-err))" />
                )}
                {m.estimativa > 0 && (
                  <rect x={cx + 2} y={meio + alt(m.saidas)} width={largura} height={alt(m.estimativa)} rx="3" fill="rgb(var(--os-tx3))" opacity="0.45" />
                )}
                {(m.saidas > 0 || m.estimativa > 0) && (
                  <text x={cx + largura / 2 + 2} y={meio + alt(m.saidas + m.estimativa) + 12} textAnchor="middle" fontSize="10" fill="rgb(var(--os-tx2))">{curto(m.saidas)}</text>
                )}
                {m.vazio && <text x={cx} y={meio - 6} textAnchor="middle" fontSize="10" fill="rgb(var(--os-tx3))">nada lançado</text>}
                <text x={cx} y={A - 10} textAnchor="middle" fontSize="12" fill="rgb(var(--os-tx2))">{m.rotulo}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {sel && (
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-sm">
          <b>{sel.rotulo}</b>
          <span className="text-muted">entradas <b className="font-os-mono text-good">{brl(sel.entradas)}</b></span>
          <span className="text-muted">saídas <b className="font-os-mono text-bad">{brl(sel.saidas)}</b></span>
          <span className="text-muted">resultado <b className="font-os-mono text-text">{brl(sel.entradas - sel.saidas)}</b></span>
          <span className="text-muted">saldo no fim <b className="font-os-mono text-text">{brl(sel.saldo)}</b></span>
          {sel.estimativa > 0 && (
            <span className="text-muted">estimativa de variáveis <b className="font-os-mono text-text">{brl(sel.estimativa)}</b> · saldo com ela <b className="font-os-mono text-text">{brl(sel.saldoEst)}</b></span>
          )}
          {sel.vazio && <span className="text-muted">Nenhum lançamento previsto neste mês.</span>}
        </div>
      )}
    </div>
  );
}
