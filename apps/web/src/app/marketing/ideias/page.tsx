'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_IDEIA_PRIORIDADES,
  PAUTA_TETO_DE_IDEIAS_PROPOSTAS,
  transicaoDaIdeia,
  type PautaFormatoDaSemana,
  type PautaIdeiaNaLista,
  type PautaIdeiaStatus,
  type PautaIdeiasPainel,
} from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

/*
 * MK3 na tela. A IA propõe e gente aprova — por isso não há botão que gere e
 * aprove de uma vez. Aprovar cria a peça da semana, e é por isso que o botão
 * diz o que vai acontecer em vez de só dizer "aprovar".
 */

const ROTULO_DO_STATUS: Record<PautaIdeiaStatus, string> = {
  ideia: 'ideia',
  em_producao: 'em produção',
  aprovada: 'virou peça',
  descartada: 'descartada',
};

const TOM_DO_STATUS: Record<PautaIdeiaStatus, string> = {
  ideia: 'bg-surface-2 text-muted',
  em_producao: 'bg-warn/15 text-warn',
  aprovada: 'bg-brand/15 text-brand',
  descartada: 'bg-surface-2 text-muted line-through',
};

const botaoCls = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';
const pequeno = 'rounded border border-border bg-surface-2 px-2 py-1 text-xs hover:border-brand-dim disabled:opacity-40';

export default function IdeiasPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [painel, setPainel] = useState<PautaIdeiasPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  // formulário de proposta
  const [pilar, setPilar] = useState('');
  const [formato, setFormato] = useState<PautaFormatoDaSemana>('carrossel');
  const [quantas, setQuantas] = useState(3);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const p = await apiGet<PautaIdeiasPainel>('/pauta/ideias', token);
      setPainel(p);
      setPilar((atual) => atual || p.pilares[0]?.nome || '');
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  async function propor() {
    setOcupado('propor');
    setErro(null);
    try {
      await apiPost('/pauta/ideias/propor', { pilar, formato, quantas }, token);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function mudar(i: PautaIdeiaNaLista, status: PautaIdeiaStatus) {
    setOcupado(i.id);
    setErro(null);
    try {
      await apiPatch(`/pauta/ideias/${i.id}/status`, { status }, token);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  if (!ready) return <p className="text-muted">Carregando…</p>;

  const cor = (nome: string) => painel?.pilares.find((p) => p.nome.toLowerCase() === nome.toLowerCase())?.cor;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Banco de ideias</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          O que a casa quer dizer, por pilar. A IA propõe e você decide; a ideia aprovada vira peça
          na agenda da Semana, junto das que saem dos episódios.
        </p>
      </div>

      {erro && <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{erro}</div>}

      {painel?.avisos.length ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {painel.avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      ) : null}

      {editavel && painel?.pilares.length ? (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
            Pedir ideias à IA
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Pilar</span>
              <select
                value={pilar}
                onChange={(e) => setPilar(e.target.value)}
                className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
              >
                {painel.pilares.map((p) => (
                  <option key={p.chave} value={p.nome}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Formato</span>
              <select
                value={formato}
                onChange={(e) => setFormato(e.target.value as PautaFormatoDaSemana)}
                className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
              >
                {PAUTA_FORMATOS_DA_SEMANA.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Quantas</span>
              <input
                type="number"
                min={1}
                max={PAUTA_TETO_DE_IDEIAS_PROPOSTAS}
                value={quantas}
                onChange={(e) => setQuantas(Math.max(1, Math.min(PAUTA_TETO_DE_IDEIAS_PROPOSTAS, +e.target.value || 1)))}
                className="w-20 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
              />
            </label>
            <button
              onClick={propor}
              disabled={ocupado !== null || !painel.iaConfigurada || !pilar}
              title={painel.iaConfigurada ? undefined : 'A IA não está configurada nesta instalação.'}
              className={`${botaoCls} bg-brand text-bg hover:bg-brand/90`}
            >
              {ocupado === 'propor' ? 'A IA está propondo…' : 'Propor'}
            </button>
            <span className="text-xs text-muted">Elas entram como ideia crua, para você triar.</span>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
          {painel?.ideias.length ?? 0} ideia(s)
        </h2>

        {!painel?.ideias.length ? (
          <p className="text-sm text-muted">
            Nada aqui ainda. {painel?.pilares.length ? 'Peça uma proposta à IA acima.' : 'Escreva os pilares na tela de Marca primeiro.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {painel.ideias.map((i) => {
              const podeProduzir = transicaoDaIdeia(i.status, 'em_producao');
              const podeAprovar = transicaoDaIdeia(i.status, 'aprovada');
              const podeDescartar = transicaoDaIdeia(i.status, 'descartada');
              const podeReabrir = transicaoDaIdeia(i.status, 'ideia');
              return (
                <div key={i.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{ backgroundColor: `${cor(i.pilar) ?? '#888'}22`, color: cor(i.pilar) ?? undefined }}
                    >
                      {i.pilar}
                    </span>
                    <button onClick={() => setAberta(aberta === i.id ? null : i.id)} className="min-w-0 flex-1 text-left font-medium">
                      {i.titulo}
                    </button>
                    <span className="font-os-mono text-[10px] text-muted">{i.formato}</span>
                    {i.origem === 'ia' && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">IA</span>}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${TOM_DO_STATUS[i.status]}`}>
                      {ROTULO_DO_STATUS[i.status]}
                    </span>
                  </div>

                  {aberta === i.id && (
                    <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
                      {i.ganchoFala && (
                        <p>
                          <span className="font-os-mono text-[10px] uppercase tracking-wide text-muted">fala </span>
                          {i.ganchoFala}
                        </p>
                      )}
                      {i.ganchoTela && (
                        <p>
                          <span className="font-os-mono text-[10px] uppercase tracking-wide text-muted">tela </span>
                          {i.ganchoTela}
                        </p>
                      )}
                      {i.roteiro && <pre className="whitespace-pre-wrap font-os-mono text-xs text-muted">{i.roteiro}</pre>}
                      {i.legenda && <p className="text-muted">{i.legenda}</p>}
                      {i.cta && <p className="text-muted">CTA: {i.cta}</p>}
                      {i.porque && <p className="text-xs text-muted">Por quê: {i.porque}</p>}
                      {i.pecaId && (
                        <p className="font-os-mono text-[11px] text-brand">
                          virou peça — ela está na aba Semana, esperando slot
                        </p>
                      )}
                    </div>
                  )}

                  {editavel && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {podeProduzir && (
                        <button className={pequeno} disabled={ocupado === i.id} onClick={() => mudar(i, 'em_producao')}>
                          Pôr em produção
                        </button>
                      )}
                      {podeAprovar && (
                        <button className={pequeno} disabled={ocupado === i.id} onClick={() => mudar(i, 'aprovada')}>
                          Aprovar e criar a peça
                        </button>
                      )}
                      {podeReabrir && i.status !== 'ideia' && (
                        <button className={pequeno} disabled={ocupado === i.id} onClick={() => mudar(i, 'ideia')}>
                          Reabrir
                        </button>
                      )}
                      {podeDescartar && (
                        <button className={pequeno} disabled={ocupado === i.id} onClick={() => mudar(i, 'descartada')}>
                          Descartar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
