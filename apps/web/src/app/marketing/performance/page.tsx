'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PAUTA_METRICAS_DA_CASA,
  type PautaFaixaDoIndice,
  type PautaMetricaDaCasa,
  type PautaPerformancePainel,
} from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { apiGet, apiPost } from '@/lib/api';

/*
 * MK5 na tela. A coluna que ordena é o ÍNDICE — quantas vezes a mediana da
 * própria casa cada post fez —, e não a visualização crua: número absoluto diz
 * o tamanho da conta, não o que funcionou.
 *
 * Sem Instagram conectado a tela INSTRUI, não estoura: o Instagram da Root não
 * está ligado hoje, e uma tela em vermelho ensinaria que o módulo quebrou
 * quando ele só está esperando uma conexão.
 */

function mesAnteriorDeHoje(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const ROTULO_DA_FAIXA: Record<PautaFaixaDoIndice, string> = {
  estourou: 'estourou',
  acima: 'acima da nossa média',
  'na-media': 'na nossa média',
  abaixo: 'abaixo',
};

const TOM_DA_FAIXA: Record<PautaFaixaDoIndice, string> = {
  estourou: 'bg-brand/15 text-brand',
  acima: 'bg-good/15 text-good',
  'na-media': 'bg-surface-2 text-muted',
  abaixo: 'bg-warn/15 text-warn',
};

const ROTULO_DA_METRICA: Record<PautaMetricaDaCasa, string> = {
  visualizacoes: 'visualizações',
  curtidas: 'curtidas',
  comentarios: 'comentários',
  salvamentos: 'salvamentos',
  compartilhamentos: 'compartilhamentos',
};

const numero = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR'));

export default function PerformancePage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [mes, setMes] = useState(mesAnteriorDeHoje);
  const [painel, setPainel] = useState<PautaPerformancePainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(
    async (m: string) => {
      if (!token) return;
      setErro(null);
      try {
        setPainel(await apiGet<PautaPerformancePainel>(`/pauta/performance/${m}`, token));
      } catch (e) {
        setErro((e as Error).message);
      }
    },
    [token],
  );

  useEffect(() => {
    if (ready) void carregar(mes);
  }, [ready, mes, carregar]);

  async function coletar() {
    setOcupado(true);
    setErro(null);
    try {
      setPainel(await apiPost<PautaPerformancePainel>(`/pauta/performance/${mes}/coletar`, {}, token));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!ready) return <p className="text-muted">Carregando…</p>;

  const s = painel?.snapshot ?? null;
  const ref = s?.metricaDeReferencia ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Performance</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Como cada post rendeu <strong>contra a mediana da própria casa</strong> — a mesma régua que
          usamos nos perfis observados. Número grande de conta grande não diz nada sobre o que
          funcionou; o índice diz.
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
        {editavel && painel?.conectado && (
          <button
            onClick={coletar}
            disabled={ocupado}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-bg hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ocupado ? 'Lendo a conta…' : s ? 'Coletar de novo' : 'Coletar os números'}
          </button>
        )}
      </div>

      {erro && <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{erro}</div>}

      {painel && !painel.conectado && (
        <section className="rounded-xl border border-warn/40 bg-warn/10 p-5">
          <h2 className="mb-2 font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-warn">
            Ainda não dá para medir
          </h2>
          <p className="text-sm text-warn">{painel.comoConectar}</p>
        </section>
      )}

      {s?.avisos.length ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {s.avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      ) : null}

      {s && (
        <>
          <section className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
                {s.medidos} de {s.publicados} post(s) medido(s)
              </h2>
              <span className="font-os-mono text-[11px] text-muted">
                fotografia de {s.coletadoEm.slice(0, 10)}
                {s.seguidores !== null ? ` · ${numero(s.seguidores)} seguidores` : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {PAUTA_METRICAS_DA_CASA.map((m) => (
                <div key={m}>
                  <div className="font-os-mono text-[10px] uppercase tracking-wide text-muted">
                    mediana · {ROTULO_DA_METRICA[m]}
                    {ref === m ? ' (a régua)' : ''}
                  </div>
                  <div className="font-os-mono text-lg tabular-nums">{numero(s.medianas[m])}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
              Do que mais rendeu para o que menos
            </h2>
            <div className="flex flex-col gap-2">
              {s.posts.map((p) => {
                const ind = ref ? p.indices[ref] : null;
                return (
                  <div key={p.pecaId} className="flex flex-wrap items-center gap-2 border-b border-border py-2">
                    <span className="font-os-mono text-sm tabular-nums" style={{ minWidth: '4rem' }}>
                      {ind === null ? '—' : `${ind.toFixed(2)}×`}
                    </span>
                    {p.faixa && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${TOM_DA_FAIXA[p.faixa]}`}>
                        {ROTULO_DA_FAIXA[p.faixa]}
                      </span>
                    )}
                    {p.urlPublicada ? (
                      <a href={p.urlPublicada} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline">
                        {p.titulo}
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{p.titulo}</span>
                    )}
                    <span className="font-os-mono text-xs tabular-nums text-muted">
                      {numero(p.numeros.visualizacoes)} vis · {numero(p.numeros.salvamentos)} salv
                    </span>
                    <span className="font-os-mono text-xs text-muted">{p.publicadaEm?.slice(0, 10) ?? 'sem data'}</span>
                    {p.semNumero && (
                      <p className="w-full font-os-mono text-[11px] text-warn">{p.semNumero}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {painel?.conectado && !s && (
        <p className="text-sm text-muted">
          Este mês ainda não foi medido. Clique em <strong>Coletar os números</strong> — a leitura
          passa pela porta do OS e fica gravada como a fotografia daquele dia.
        </p>
      )}
    </div>
  );
}
