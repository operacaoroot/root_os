'use client';

import { useEffect, useState } from 'react';
import type { PeriodoFinanceiro } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * ENTRADA × SAÍDA NO PERÍODO (29/10/2026). Um resumo só, para o período que a
 * pessoa escolhe: o que entrou e saiu (realizado), o que está previsto (lançado,
 * parcela a gerar e conta fixa projetada) e o total. A estimativa de variáveis
 * fica numa linha à parte, porque não é lançamento.
 */

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const cls = 'rounded border border-border bg-surface-2 px-2 py-1 text-[13px] outline-none focus:border-brand-dim';

type Escolha = 'mes' | 'proximo' | 'trimestre' | 'tres' | 'intervalo';
const ROTULO: Record<Escolha, string> = { mes: 'Este mês', proximo: 'Próximo mês', trimestre: 'Este trimestre', tres: 'Próximos 3 meses', intervalo: 'Intervalo' };

function intervalo(e: Escolha): { de: string; ate: string } | null {
  const h = new Date();
  const a = h.getFullYear(), m = h.getMonth();
  const mes = (ano: number, mm: number) => ({ de: iso(new Date(Date.UTC(ano, mm, 1))), ate: iso(new Date(Date.UTC(ano, mm + 1, 0))) });
  if (e === 'mes') return mes(a, m);
  if (e === 'proximo') return mes(a, m + 1);
  if (e === 'trimestre') { const t = Math.floor(m / 3) * 3; return { de: iso(new Date(Date.UTC(a, t, 1))), ate: iso(new Date(Date.UTC(a, t + 3, 0))) }; }
  if (e === 'tres') return { de: iso(new Date(Date.UTC(a, m, h.getDate()))), ate: iso(new Date(Date.UTC(a, m + 3, 0))) };
  return null;
}

export function EntradaSaidaPeriodo() {
  const { token, ready } = useAuth();
  const [escolha, setEscolha] = useState<Escolha>('mes');
  const [livre, setLivre] = useState(() => intervalo('mes')!);
  const [p, setP] = useState<PeriodoFinanceiro | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const alvo = escolha === 'intervalo' ? livre : intervalo(escolha)!;

  useEffect(() => {
    if (!ready || !token || !alvo.de || !alvo.ate) return;
    setErro(null);
    apiGet<PeriodoFinanceiro>(`/finance/periodo?de=${alvo.de}&ate=${alvo.ate}`, token).then(setP).catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, [ready, token, alvo.de, alvo.ate]);

  const linha = (rotulo: string, real: number, prev: number, total: number, tom?: 'good' | 'bad') => (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-3">{rotulo}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{brl(real)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{brl(prev)}</td>
      <td className={`py-1.5 text-right font-medium tabular-nums ${tom === 'good' ? 'text-good' : tom === 'bad' ? 'text-bad' : ''}`}>{brl(total)}</td>
    </tr>
  );

  return (
    <div className="rounded-xl border border-border bg-surface p-4" data-testid="entrada-saida-periodo">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[15px] font-semibold">Entradas e saídas no período</h2>
        {(Object.keys(ROTULO) as Escolha[]).map((e) => (
          <button key={e} type="button" onClick={() => setEscolha(e)} aria-pressed={escolha === e}
            className={`rounded-full border px-3 py-1 text-[12px] ${escolha === e ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-text'}`}>{ROTULO[e]}</button>
        ))}
      </div>
      {escolha === 'intervalo' && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          de <input aria-label="Começo do período" type="date" className={cls} value={livre.de} onChange={(e) => setLivre({ ...livre, de: e.target.value })} />
          até <input aria-label="Fim do período" type="date" className={cls} value={livre.ate} onChange={(e) => setLivre({ ...livre, ate: e.target.value })} />
        </div>
      )}
      {erro && <p className="text-sm text-bad">{erro}</p>}
      {!p ? <p className="text-sm text-muted">Carregando…</p> : (
        <>
          <p className="mb-2 text-[12px] text-muted">{p.de.split('-').reverse().join('/')} a {p.ate.split('-').reverse().join('/')}</p>
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="py-1 pr-3" /><th className="py-1 pr-3 text-right">Aconteceu</th><th className="py-1 pr-3 text-right">Previsto</th><th className="py-1 text-right">Total</th></tr>
            </thead>
            <tbody>
              {linha('Entrou / entra', p.realizado.entrou, p.previsto.entra, p.total.entra, 'good')}
              {linha('Saiu / sai', p.realizado.saiu, p.previsto.sai, p.total.sai, 'bad')}
              {linha('Resultado', p.realizado.resultado, p.previsto.resultado, p.total.resultado, p.total.resultado >= 0 ? 'good' : 'bad')}
              {p.estimativaVariavel.valor > 0 && (
                <tr className="border-t border-dashed border-border text-muted">
                  <td className="py-1.5 pr-3">Estimativa de variáveis <span className="text-[11px]">({brl(p.estimativaVariavel.porMes)}/mês, {p.estimativaVariavel.dias} dias que faltam)</span></td>
                  <td /><td className="py-1.5 pr-3 text-right tabular-nums">−{brl(p.estimativaVariavel.valor)}</td>
                  <td className={`py-1.5 text-right font-medium tabular-nums ${p.total.resultadoComEstimativa >= 0 ? 'text-good' : 'text-bad'}`}>{brl(p.total.resultadoComEstimativa)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {(p.vencidoEmAberto.aReceber > 0 || p.vencidoEmAberto.aPagar > 0) && (
            <p className="mt-2 text-[11px] text-warn">
              Venceu no período e segue em aberto: {p.vencidoEmAberto.aReceber > 0 && `a receber ${brl(p.vencidoEmAberto.aReceber)}`}
              {p.vencidoEmAberto.aReceber > 0 && p.vencidoEmAberto.aPagar > 0 && ' · '}
              {p.vencidoEmAberto.aPagar > 0 && `a pagar ${brl(p.vencidoEmAberto.aPagar)}`} (fora do total).
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted">
            "Aconteceu" é o extrato ({p.realizado.lancamentos} lançamentos). "Previsto" é o que está lançado daqui em diante, as parcelas a gerar e as contas fixas projetadas.
          </p>
        </>
      )}
    </div>
  );
}
