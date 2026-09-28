'use client';

import { useCallback, useEffect, useState } from 'react';
import { PAUTA_TETO_DO_RELATORIO, type PautaRelatorioPainel } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { apiGet, apiPost, apiPut } from '@/lib/api';

/*
 * MK6 na tela. O relatório fecha um mês: o que foi ao ar sai da consulta, a
 * narrativa sai da IA, e a pessoa reescreve o que quiser.
 *
 * O mês que abre é o ANTERIOR ao de hoje, e não o corrente: relatório se faz de
 * mês fechado, e abrir no mês em curso convidaria a fechar o que ainda anda.
 */

function mesAnteriorDeHoje(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const botaoCls = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

export default function RelatorioPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [mes, setMes] = useState(mesAnteriorDeHoje);
  const [painel, setPainel] = useState<PautaRelatorioPainel | null>(null);
  const [documento, setDocumento] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'salvar' | 'gerar' | null>(null);

  const carregar = useCallback(
    async (m: string) => {
      if (!token) return;
      setErro(null);
      try {
        const p = await apiGet<PautaRelatorioPainel>(`/pauta/relatorio/${m}`, token);
        setPainel(p);
        setDocumento(p.documento);
      } catch (e) {
        setErro((e as Error).message);
      }
    },
    [token],
  );

  useEffect(() => {
    if (ready) void carregar(mes);
  }, [ready, mes, carregar]);

  async function agir(qual: 'salvar' | 'gerar') {
    setOcupado(qual);
    setErro(null);
    try {
      const p =
        qual === 'salvar'
          ? await apiPut<PautaRelatorioPainel>(
              `/pauta/relatorio/${mes}`,
              { documento, versao: painel?.versao ?? undefined },
              token,
            )
          : await apiPost<PautaRelatorioPainel>(`/pauta/relatorio/${mes}/gerar`, {}, token);
      setPainel(p);
      setDocumento(p.documento);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  if (!ready) return <p className="text-muted">Carregando…</p>;

  const mudou = painel !== null && documento !== painel.documento;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Relatório do mês</h1>
        <p className="mt-1 text-sm text-muted">
          O fechamento de um mês: o que foi ao ar, o que foi decidido, como rendeu, o que vem e a
          estratégia que valia. <strong>Os números saem da consulta, não do modelo</strong> — a IA
          escreve só a leitura, as decisões e os próximos passos.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">Mês</span>
          <input
            type="month"
            value={mes}
            onChange={(e) => e.target.value && setMes(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
          />
        </label>
        {painel ? (
          <span className="font-os-mono text-xs text-muted">
            {painel.publicadas} peça(s) publicada(s) em {mes}
          </span>
        ) : null}
        {painel?.meses.length ? (
          <div className="flex flex-wrap gap-1">
            {painel.meses.map((m) => (
              <button
                key={m}
                onClick={() => setMes(m)}
                className={`rounded px-2 py-0.5 font-os-mono text-xs ${
                  m === mes ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-muted hover:text-text'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {erro && <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{erro}</div>}

      {painel?.avisos.length ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {painel.avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
            O relatório de {mes}
          </h2>
          <span className="font-os-mono text-[11px] tabular-nums text-muted">
            {documento.length} / {PAUTA_TETO_DO_RELATORIO}
            {painel?.versao ? ` · versão ${painel.versao}` : ''}
            {painel?.origem === 'promocao' ? ' · gerado pela IA' : painel?.origem ? ' · escrito à mão' : ''}
          </span>
        </div>

        <textarea
          value={documento}
          onChange={(e) => setDocumento(e.target.value)}
          disabled={!editavel}
          rows={24}
          placeholder="Este mês ainda não foi fechado. Gere o relatório, ou escreva o seu."
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-os-mono text-sm outline-none focus:border-brand-dim disabled:opacity-50"
        />

        {editavel && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => agir('salvar')}
              disabled={ocupado !== null || !documento.trim() || !mudou}
              className={`${botaoCls} bg-brand text-bg hover:bg-brand/90`}
            >
              {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              onClick={() => agir('gerar')}
              disabled={ocupado !== null || !painel?.iaConfigurada}
              title={painel?.iaConfigurada ? undefined : 'A IA não está configurada nesta instalação.'}
              className={`${botaoCls} border border-border bg-surface-2 hover:border-brand-dim`}
            >
              {ocupado === 'gerar' ? 'A IA está escrevendo…' : painel?.documento ? 'Gerar de novo' : 'Fechar o mês'}
            </button>
            <span className="text-xs text-muted">
              A rotina mensal existe e nasce desligada; enquanto ninguém a liga, o fechamento é por
              aqui. Ela nunca refaz mês que já tem relatório.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
