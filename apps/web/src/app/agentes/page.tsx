'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KpiCard } from '@/components/KpiCard';
import { Procedimento } from './Procedimento';

/*
 * Rótulo em português dos sete campos do procedimento. O nome técnico vem da
 * API (`faltando: ['proposito','dono',...]`); o que a pessoa lê é isto.
 */
const ROTULO: Record<string, string> = {
  proposito: 'propósito',
  dono: 'dono',
  gatilho: 'gatilho',
  passos: 'passos',
  definicaoDePronto: 'definição de pronto',
  escalacao: 'escalação',
  pilar: 'pilar',
};

interface Agente {
  slug: string;
  nome: string;
  iniciais: string;
  missao: string;
  pilar: string | null;
  dono: { id: string; nome: string } | null;
  tipo: 'llm' | 'conector';
  estado: string;
  autonomiaAte: string;
  rebaixadoAte: string | null;
  capacidades: string[];
  cron: string | null;
  ultimaExecucaoEm: string | null;
  ultimoStatus: string | null;
  execucoes: number;
  falhas: number;
  horasDevolvidas: number | null;
  linhaDeBase: { minutosPorExecucao: number; informadaEm: string | null } | null;
  temProcedimento: boolean;
  procedimento: { versao: number; atualizadoEm: string } | null;
  /** Dos SETE campos do formato fixo, quais faltam neste agente. */
  faltando: string[];
}

interface Roster {
  items: Agente[];
  kpis: {
    rodando: number;
    horasSemana: number | null;
    semLinhaDeBase: number;
    semProcedimento: number;
  };
}

export default function AgentesPage() {
  const { token, ready, can } = useAuth();
  const [data, setData] = useState<Roster | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [minutos, setMinutos] = useState('');
  const [procedimentoDe, setProcedimentoDe] = useState<string | null>(null);

  const carregar = () => {
    if (!token) return;
    apiGet<Roster>('/agents', token).then(setData).catch((e) => setErro(e.message));
  };
  useEffect(carregar, [ready, token]);

  async function salvarBase(slug: string) {
    try {
      await apiPost(`/agents/${slug}/linha-de-base`, { minutos: Number(minutos) }, token);
      setEditando(null);
      setMinutos('');
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Cada um com uma missão, um dono humano e as ferramentas que declarou. Fora da declaração, a
        régua recusa.
      </p>

      {erro && <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</div>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Rodando" value={data?.kpis.rodando ?? '—'} icon="Users" tone="brand" />
        <KpiCard
          label="Horas devolvidas"
          value={data?.kpis.horasSemana ?? '—'}
          hint={
            data?.kpis.horasSemana == null
              ? 'ninguém informou a linha de base ainda'
              : 'soma das linhas de base declaradas'
          }
          icon="Clock"
        />
        <KpiCard
          label="Sem linha de base"
          value={data?.kpis.semLinhaDeBase ?? '—'}
          hint="não dá para medir hora devolvida sem ela"
          tone={data && data.kpis.semLinhaDeBase > 0 ? 'warn' : 'default'}
          icon="Gauge"
        />
        <KpiCard
          label="Sem procedimento"
          value={data?.kpis.semProcedimento ?? '—'}
          hint="agente sem os sete campos não tem método escrito"
          tone={data && data.kpis.semProcedimento > 0 ? 'warn' : 'default'}
          icon="ScrollText"
        />
      </div>

      {!data && !erro && <p className="text-sm text-muted">Carregando…</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {data?.items.map((a) => (
          <div key={a.slug} className="rounded-root border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-root border border-brand/30 bg-brand/10 font-os-mono text-[10px] font-bold text-brand">
                {a.iniciais}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-text">{a.nome}</p>
                <p className="text-[11.5px] leading-[1.5] text-muted">{a.missao}</p>
              </div>
              <span className="font-os-mono text-[9px] uppercase tracking-[0.1em] text-dim">
                {a.tipo}
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-os-mono text-[10px]">
              <div>
                <dt className="inline text-dim">dono </dt>
                <dd className={`inline ${a.dono ? 'text-muted' : 'text-warn'}`}>
                  {a.dono?.nome ?? 'sem dono'}
                </dd>
              </div>
              <div>
                <dt className="inline text-dim">sozinho até </dt>
                <dd className="inline text-muted">{a.autonomiaAte}</dd>
              </div>
              <div>
                <dt className="inline text-dim">quando </dt>
                <dd className="inline text-muted">{a.cron ?? 'sob demanda'}</dd>
              </div>
              <div>
                <dt className="inline text-dim">execuções </dt>
                <dd className="inline text-muted">
                  {a.execucoes}
                  {a.falhas > 0 && <span className="text-bad"> · {a.falhas} falha(s)</span>}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="inline text-dim">última </dt>
                <dd className="inline text-muted">
                  {a.ultimaExecucaoEm
                    ? `${new Date(a.ultimaExecucaoEm).toLocaleString('pt-BR')} · ${a.ultimoStatus}`
                    : 'ainda não rodou'}
                </dd>
              </div>
            </dl>

            {a.capacidades.length > 0 && (
              <p className="mt-2 font-os-mono text-[9.5px] leading-[1.6] text-dim">
                declara {a.capacidades.length}:{' '}
                <span className="text-muted">{a.capacidades.slice(0, 4).join(' · ')}</span>
                {a.capacidades.length > 4 && ` +${a.capacidades.length - 4}`}
              </p>
            )}

            {/*
              O PROCEDIMENTO (RF-N-02). A linha diz o estado real dos sete
              campos: o que falta aparece com nome, porque "sem procedimento"
              sozinho não diz o que fazer a respeito.
            */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setProcedimentoDe(a.slug)}
                className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-brand hover:underline"
              >
                {a.temProcedimento ? 'ver procedimento' : 'escrever procedimento'}
              </button>
              {a.procedimento && (
                <span className="font-os-mono text-[9px] text-dim">v{a.procedimento.versao}</span>
              )}
              {a.faltando.length > 0 && (
                <span className="font-os-mono text-[9px] leading-[1.6] text-warn">
                  falta {a.faltando.map((c) => ROTULO[c] ?? c).join(', ')}
                </span>
              )}
            </div>

            {a.rebaixadoAte && new Date(a.rebaixadoAte) > new Date() && (
              <p className="mt-2 font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-warn">
                autonomia rebaixada até {new Date(a.rebaixadoAte).toLocaleString('pt-BR')}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-baseline gap-2 border-t border-border pt-3">
              {a.horasDevolvidas != null ? (
                <p className="font-os-mono text-[10px] text-muted">
                  <span className="text-text">{a.horasDevolvidas} h</span> devolvidas
                  <span className="text-dim">
                    {' '}
                    = {a.linhaDeBase!.minutosPorExecucao} min × {a.execucoes} execuções
                  </span>
                </p>
              ) : editando === a.slug ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={minutos}
                    onChange={(e) => setMinutos(e.target.value)}
                    placeholder="minutos por execução"
                    className="w-[150px] rounded-root border border-border bg-bg px-2 py-1 font-os-mono text-[10px] text-text outline-none focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={() => salvarBase(a.slug)}
                    className="rounded-root bg-brand px-2 py-1 font-os-mono text-[9.5px] uppercase text-ink"
                  >
                    salvar
                  </button>
                  <button type="button" onClick={() => setEditando(null)} className="font-os-mono text-[9.5px] text-muted">
                    cancelar
                  </button>
                </div>
              ) : (
                <>
                  <p className="font-os-mono text-[10px] text-dim">horas devolvidas —</p>
                  {can('automacoes.executar') && (
                    <button
                      type="button"
                      onClick={() => setEditando(a.slug)}
                      className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-brand hover:underline"
                    >
                      informar a linha de base
                    </button>
                  )}
                </>
              )}
              <span className="flex-1" />
              <Link
                href={`/sessoes?agente=${a.slug}`}
                className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-muted hover:text-text"
              >
                sessões
              </Link>
            </div>
          </div>
        ))}
      </div>

      {procedimentoDe && (
        <Procedimento
          slug={procedimentoDe}
          token={token}
          /*
           * A MESMA DUPLA QUE A API EXIGE PARA CONFIGURAR AGENTE
           * (`CONFIGURAR_AGENTE` em agents.controller.ts, usada hoje pela linha
           * de base). Isto aqui é cortesia de tela: quem recusa de verdade é a
           * API. Sem as duas, o editor abre em leitura em vez de prometer um
           * botão que a rota vai negar.
           */
          podeEditar={can('automacoes.executar') && can('admin.usuarios')}
          aoFechar={() => setProcedimentoDe(null)}
          aoSalvar={carregar}
        />
      )}
    </div>
  );
}
