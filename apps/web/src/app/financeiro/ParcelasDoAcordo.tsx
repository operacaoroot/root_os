'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';

/*
 * PARCELAS DO ACORDO (29/10/2026). O que o contrato manda receber, parcela a
 * parcela. A cobrança que existe no Asaas cria ou veste a parcela sozinha (não
 * vira outra linha) e o recebimento do extrato a dá como paga. Aqui só se
 * cadastra o que o Asaas não sabe: a parcela que ainda não virou cobrança ("a
 * gerar", entra no fluxo na data dela) e o que entrou por fora. Parcela com
 * cobrança ou paga não muda valor nem data aqui: o Asaas manda.
 */

type Estado = 'paga' | 'cobranca_gerada' | 'a_gerar';
type Parcela = {
  id?: string; numero: number; posicao?: number; valor: number; vencimento: string; pagaEm: string | null; notaFiscal: string | null;
  estado: Estado; vencida?: boolean; caiEm?: string | null; liquido?: number | null;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const cls = 'rounded border border-border bg-surface-2 px-2 py-1 text-[13px] outline-none focus:border-brand-dim';
const ROTULO: Record<Estado, string> = { paga: 'paga', cobranca_gerada: 'cobrança gerada', a_gerar: 'cobrança a gerar' };

function maisMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export function ParcelasDoAcordo({ acordoId, valorDoAcordo, token, canEdit, onError, onSalvo }: {
  acordoId: string; valorDoAcordo: number; token: string | null; canEdit: boolean;
  onError: (e: unknown) => void; onSalvo: () => void;
}) {
  const [linhas, setLinhas] = useState<Parcela[] | null>(null);
  const [serie, setSerie] = useState({ quantas: '', valor: '', primeira: '' });
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<{ parcelas: Parcela[] }>(`/finance/analise/acordos/${acordoId}/parcelas`, token).then((r) => setLinhas(r.parcelas)).catch(onError);
  }, [acordoId, token, onError]);
  useEffect(() => { carregar(); }, [carregar]);

  if (!linhas) return <p className="py-2 text-[12px] text-muted">Carregando parcelas…</p>;
  const travada = (p: Parcela) => p.estado !== 'a_gerar';
  const soma = linhas.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const mudar = (i: number, campo: Partial<Parcela>) => setLinhas(linhas.map((p, j) => (j === i ? { ...p, ...campo } : p)));
  const proximoNumero = () => Math.max(0, ...linhas.map((p) => p.numero)) + 1;

  const gerarSerie = () => {
    const n = Number(serie.quantas), v = Number(serie.valor);
    if (!(n > 0) || !(v > 0) || !serie.primeira) { onError(new Error('Diga quantas parcelas, o valor de cada uma e o primeiro vencimento.')); return; }
    const inicio = proximoNumero();
    setLinhas([...linhas, ...Array.from({ length: n }, (_, k) => ({
      numero: inicio + k, valor: v, vencimento: maisMeses(serie.primeira, k), pagaEm: null, notaFiscal: null, estado: 'a_gerar' as Estado,
    }))]);
    setSerie({ quantas: '', valor: '', primeira: '' });
  };

  const salvar = () => {
    setSalvando(true);
    setAviso(null);
    apiPut<{ parcelas: Parcela[]; mantidas: number[] }>(`/finance/analise/acordos/${acordoId}/parcelas`, {
      parcelas: linhas.map((p) => ({ numero: p.numero, valor: Number(p.valor), vencimento: p.vencimento, pagaEm: p.pagaEm || null, notaFiscal: p.notaFiscal || null })),
    }, token)
      .then((r) => {
        setLinhas(r.parcelas);
        setAviso(r.mantidas.length
          ? `Salvo. As parcelas ${r.mantidas.join(', ')} já têm cobrança ou pagamento: valor e data delas ficaram como estavam.`
          : 'Salvo. Uma cobrança que já exista no Asaas veste a parcela na próxima passagem do sync (em segundos).');
        onSalvo();
      })
      .catch(onError)
      .finally(() => setSalvando(false));
  };

  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3">
      <table className="w-full text-[13px]">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
          <tr><th className="py-1 pr-2">Nº</th><th className="py-1 pr-2">Valor</th><th className="py-1 pr-2">Vencimento</th><th className="py-1 pr-2">Situação</th><th className="py-1 pr-2">NF</th>{canEdit && <th />}</tr>
        </thead>
        <tbody>
          {linhas.length === 0 && <tr><td colSpan={6} className="py-2 text-muted">Nenhuma parcela. Gere a série do contrato abaixo.</td></tr>}
          {linhas.map((p, i) => (
            <tr key={p.id ?? `nova-${p.numero}`} className="border-t border-border">
              <td className="py-1 pr-2 tabular-nums">{p.posicao ?? '·'}</td>
              <td className="py-1 pr-2">
                {canEdit && !travada(p)
                  ? <input aria-label={`Valor da parcela ${p.numero}`} className={`${cls} w-28`} type="number" step="0.01" value={p.valor} onChange={(e) => mudar(i, { valor: Number(e.target.value) })} />
                  : <span className="tabular-nums">{brl(p.valor)}</span>}
              </td>
              <td className="py-1 pr-2">
                {canEdit && !travada(p)
                  ? <input aria-label={`Vencimento da parcela ${p.numero}`} className={cls} type="date" value={p.vencimento} onChange={(e) => mudar(i, { vencimento: e.target.value })} />
                  : dataBR(p.vencimento)}
              </td>
              <td className="py-1 pr-2">
                {p.estado === 'paga' && p.pagaEm ? <span className="text-good">paga em {dataBR(p.pagaEm)}</span>
                  : <span className={p.vencida ? 'text-warn' : p.estado === 'a_gerar' ? 'text-muted' : ''}>{ROTULO[p.estado]}{p.vencida ? ', vencida' : ''}</span>}
                {p.estado === 'cobranca_gerada' && p.caiEm && p.liquido != null && (p.caiEm !== p.vencimento || p.liquido !== p.valor) && (
                  <span className="block text-[11px] text-muted">cai em {dataBR(p.caiEm)}, {brl(p.liquido)} líquido</span>
                )}
                {canEdit && p.estado !== 'paga' && (
                  <label className="ml-2 text-[11px] text-muted">entrou por fora em{' '}
                    <input aria-label={`Paga em (parcela ${p.numero})`} className={`${cls} py-0`} type="date" value={p.pagaEm ?? ''} onChange={(e) => mudar(i, { pagaEm: e.target.value || null })} />
                  </label>
                )}
              </td>
              <td className="py-1 pr-2">
                {canEdit
                  ? <input aria-label={`Nota fiscal da parcela ${p.numero}`} className={`${cls} w-24`} placeholder="nº da NF" value={p.notaFiscal ?? ''} onChange={(e) => mudar(i, { notaFiscal: e.target.value || null })} />
                  : p.notaFiscal ?? '—'}
              </td>
              {canEdit && (
                <td className="py-1 text-right">
                  {!travada(p) && <button className="text-[12px] text-muted hover:text-bad" onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}>tirar</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`mt-2 text-[12px] ${Math.abs(soma - valorDoAcordo) > 0.05 && linhas.length ? 'text-warn' : 'text-muted'}`}>
        {linhas.length} parcela(s) somam {brl(soma)}; o acordo é de {brl(valorDoAcordo)}.
      </p>
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-end gap-2 text-[13px]">
          <input aria-label="Quantas parcelas" className={`${cls} w-20`} type="number" min="1" placeholder="quantas" value={serie.quantas} onChange={(e) => setSerie({ ...serie, quantas: e.target.value })} />
          <span className="text-muted">de</span>
          <input aria-label="Valor de cada parcela" className={`${cls} w-28`} type="number" step="0.01" placeholder="R$ cada" value={serie.valor} onChange={(e) => setSerie({ ...serie, valor: e.target.value })} />
          <span className="text-muted">mensais a partir de</span>
          <input aria-label="Primeiro vencimento" className={cls} type="date" value={serie.primeira} onChange={(e) => setSerie({ ...serie, primeira: e.target.value })} />
          <button className="rounded border border-border px-2 py-1 hover:bg-surface-2" onClick={gerarSerie}>+ série</button>
          <button className="rounded border border-border px-2 py-1 hover:bg-surface-2"
            onClick={() => setLinhas([...linhas, { numero: proximoNumero(), valor: 0, vencimento: new Date().toISOString().slice(0, 10), pagaEm: null, notaFiscal: null, estado: 'a_gerar' }])}>+ parcela</button>
          <button disabled={salvando} className="ml-auto rounded bg-brand px-3 py-1 font-medium text-ink hover:opacity-90 disabled:opacity-50" onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar parcelas'}</button>
        </div>
      )}
      {aviso && <p className="mt-2 text-[12px] text-muted">{aviso}</p>}
    </div>
  );
}
