'use client';

import { useCallback, useEffect, useState } from 'react';
import { PAUTA_TETO_DA_ESTRATEGIA, type PautaEstrategiaPainel } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { apiGet, apiPost, apiPut } from '@/lib/api';

/*
 * MK4 na tela. Um documento por mês: a IA propõe, a pessoa edita, e a última
 * palavra é dela — por isso o texto fica num campo editável e não num painel
 * de leitura com botão de "aceitar".
 *
 * A rota vive sob `/marketing` porque é ali que o bloco vai morar (mapa da MK0);
 * o item no menu entra na MK7, com a reorganização.
 */

/** `AAAA-MM` de hoje, no relógio de quem abre. */
function mesDeHoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const botaoCls =
  'rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

export default function EstrategiaPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [mes, setMes] = useState(mesDeHoje);
  const [painel, setPainel] = useState<PautaEstrategiaPainel | null>(null);
  const [documento, setDocumento] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'salvar' | 'gerar' | null>(null);

  const carregar = useCallback(
    async (m: string) => {
      if (!token) return;
      setErro(null);
      try {
        const p = await apiGet<PautaEstrategiaPainel>(`/pauta/estrategia/${m}`, token);
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
          ? await apiPut<PautaEstrategiaPainel>(
              `/pauta/estrategia/${mes}`,
              { documento, versao: painel?.versao ?? undefined },
              token,
            )
          : await apiPost<PautaEstrategiaPainel>(`/pauta/estrategia/${mes}/gerar`, {}, token);
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
        <h1 className="text-xl font-semibold">Estratégia do mês</h1>
        <p className="mt-1 text-sm text-muted">
          O que este mês prioriza: os pilares da vez, a cadência, as metas, as apostas e o que
          parar. A IA propõe a partir da marca, dos pilares, do que rende nos perfis observados e do
          que foi publicado no mês passado — e você reescreve o que quiser.
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

      {erro && (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{erro}</div>
      )}

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
            O documento de {mes}
          </h2>
          <span className="font-os-mono text-[11px] tabular-nums text-muted">
            {documento.length} / {PAUTA_TETO_DA_ESTRATEGIA}
            {painel?.versao ? ` · versão ${painel.versao}` : ''}
            {painel?.origem === 'promocao' ? ' · proposta pela IA' : painel?.origem ? ' · escrita à mão' : ''}
          </span>
        </div>

        <textarea
          value={documento}
          onChange={(e) => setDocumento(e.target.value)}
          disabled={!editavel}
          rows={22}
          placeholder="Ainda não há estratégia para este mês. Peça uma proposta à IA, ou escreva a sua."
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
              {ocupado === 'gerar'
                ? 'A IA está propondo…'
                : painel?.documento
                  ? 'Propor de novo'
                  : 'Pedir uma proposta'}
            </button>
            {painel?.documento && (
              <span className="text-xs text-muted">
                Propor de novo substitui o texto; a versão de agora fica no histórico da nota.
              </span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
