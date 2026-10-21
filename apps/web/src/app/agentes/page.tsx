'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ABAS_DO_CATALOGO,
  FILTROS_DE_ESTADO,
  FILTRO_PADRAO,
  ROTULO_DO_ESTADO,
  filtrarCatalogo,
  filtroParaUrl,
  lerFiltroDaUrl,
  type CatalogoDeFuncoes,
  type FiltroDoCatalogo,
  type LinhaDoCatalogo,
} from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KpiCard } from '@/components/KpiCard';
import { ProntidaoLocal } from '@/components/ProntidaoLocal';
import { Procedimento } from './Procedimento';
import { CriarAgente } from './CriarAgente';
import { CartaoDoAgente, type Agente } from './CartaoDoAgente';
import { rotaNaoExiste } from './rota-ausente';

/*
 * A TELA DE AGENTES EM TRÊS ABAS (rodada dos agentes, 21/10/2026, A7)
 *
 *  · Agentes: decidem com modelo;
 *  · Rotinas: rodam no relógio, sem modelo;
 *  · Automações e integrações: reagem a evento ou sincronizam.
 *
 * Cada linha vem do cadastro único com o estado do banco (`GET /agents/cadastro`):
 * para que serve, estado, dono efetivo, modelo e esforço, gatilho e frequência,
 * última e próxima execução, gasto do mês e onde mexer. Os filtros (estado,
 * área, dono e a aba) moram no ENDEREÇO da página, para o link ser
 * compartilhável; o padrão é "ativos" na aba Agentes.
 *
 * O CONTROLE DE HOJE NÃO SUMIU: a linha de um agente que tem registro `Agent`
 * abre o mesmo cartão de antes (`CartaoDoAgente`: estado, invocar, orçamento,
 * linha de base, procedimento e o procedimento local do Pedro). Os números de
 * cima (`GET /agents`) continuam iguais.
 *
 * SE O CATÁLOGO NÃO RESPONDER (rota ausente numa API mais velha que a tela, ou
 * resposta fora da forma), a página volta à grade de cartões de antes e diz
 * isso, em vez de esconder os agentes.
 */

interface Roster {
  items: Agente[];
  kpis: {
    /* Quantos o dono deixou em operação (decisão) … */
    ativos: number;
    /* … e quantos têm sessão viva NESTE momento (medição). */
    rodandoAgora: number;
    comErro: number;
    pausados: number;
    encerrados: number;
    horasSemana: number | null;
    /* O que a soma NÃO cobre — a tela publica isso junto com o número. */
    horasSemanaDe: {
      agentesContados: number;
      semLinhaDeBase: number;
      semHistorico: number;
      parciais: number;
      diasDaJanela: number;
    };
    semLinhaDeBase: number;
    comOrcamento: number;
    semProcedimento: number;
  };
}

const ROTULO_DA_ORIGEM_DO_MODELO: Record<string, string> = {
  registro: 'ajustado no registro',
  variavel: 'variável do ambiente',
  cadastro: 'cadastro',
  padrao: 'padrão do provedor',
};

function quando(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

function dolares(v: number): string {
  return `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function ondeMexer(l: LinhaDoCatalogo): { href: string; rotulo: string } | null {
  if (l.aba === 'rotinas' || l.rotina) return { href: '/rotinas', rotulo: 'rotinas' };
  if (l.area === 'Canais e integrações') return { href: '/conexoes', rotulo: 'integrações' };
  return null;
}

export default function AgentesPage() {
  const { token, ready, can, user } = useAuth();
  const [data, setData] = useState<Roster | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoDeFuncoes | null>(null);
  const [semCatalogo, setSemCatalogo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criandoAgente, setCriandoAgente] = useState(false);
  const [procedimentoDe, setProcedimentoDe] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [filtro, setFiltroAgora] = useState<FiltroDoCatalogo>(() =>
    typeof window === 'undefined' ? FILTRO_PADRAO : lerFiltroDaUrl(window.location.search),
  );

  const carregar = () => {
    if (!token) return;
    apiGet<Roster>('/agents', token).then(setData).catch((e) => setErro(e.message));
    apiGet<CatalogoDeFuncoes>('/agents/cadastro', token)
      .then((r) => {
        if (r && Array.isArray((r as Partial<CatalogoDeFuncoes>).linhas)) {
          setCatalogo(r);
          setSemCatalogo(null);
        } else {
          setSemCatalogo('a resposta do catálogo veio fora da forma');
        }
      })
      .catch((e) =>
        setSemCatalogo(
          rotaNaoExiste(e, 'GET', '/agents/cadastro')
            ? 'a rota do catálogo não está ligada nesta API'
            : (e as Error).message,
        ),
      );
  };
  useEffect(carregar, [ready, token]);

  /* O filtro vai ao endereço sem empilhar histórico (trocar de aba não é navegação). */
  const mudarFiltro = (parcial: Partial<FiltroDoCatalogo>) => {
    const novo = { ...filtro, ...parcial };
    setFiltroAgora(novo);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}${filtroParaUrl(novo)}`);
    }
  };

  const linhas = catalogo?.linhas ?? [];
  const visiveis = useMemo(() => filtrarCatalogo(linhas, filtro), [linhas, filtro]);
  const contagem = (aba: FiltroDoCatalogo['aba']) => filtrarCatalogo(linhas, { ...filtro, aba }).length;
  const areas = useMemo(() => [...new Set(linhas.map((l) => l.area))], [linhas]);
  const donos = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of linhas) if (l.dono.efetivo) m.set(l.dono.efetivo.id, l.dono.efetivo.nome);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [linhas]);
  const doRoster = (slug: string) => data?.items.find((i) => i.slug === slug);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Agentes decidem com modelo; rotinas rodam no relógio; automações reagem a evento ou
        sincronizam uma integração. Cada um tem um dono humano e só o que declarou. Fora da
        declaração, a régua recusa.
      </p>

      <ProntidaoLocal tipo="agentes" />

      {can('automacoes.executar') && can('admin.usuarios') && <button type="button" onClick={() => setCriandoAgente(true)} className="rounded bg-brand px-3 py-2 text-sm text-ink">Criar agente</button>}
      {criandoAgente && user && <CriarAgente token={token} pessoaId={user.id} aoFechar={() => setCriandoAgente(false)} aoCriar={() => { setCriandoAgente(false); carregar(); }} />}

      {erro && <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</div>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="Em operação"
          value={data?.kpis.ativos ?? '—'}
          hint="estado declarado pelo dono — não quer dizer que estão rodando agora"
          icon="Users"
          tone="brand"
        />
        <KpiCard
          label="Rodando agora"
          value={data?.kpis.rodandoAgora ?? '—'}
          hint={
            data && data.kpis.comErro > 0
              ? `sessão viva neste momento · ${data.kpis.comErro} com erro na última passagem`
              : 'sessão viva neste momento'
          }
          icon="Activity"
          tone={data && data.kpis.comErro > 0 ? 'warn' : 'default'}
        />
        <KpiCard
          label={`Horas devolvidas · ${data?.kpis.horasSemanaDe.diasDaJanela ?? 7} dias`}
          value={data?.kpis.horasSemana ?? '—'}
          hint={
            data == null
              ? 'medindo…'
              : data.kpis.horasSemana == null
                ? 'ninguém informou a linha de base ainda — sem ela não há o que contar'
                : `medido de ${data.kpis.horasSemanaDe.agentesContados} agente(s)` +
                  (data.kpis.horasSemanaDe.semLinhaDeBase > 0
                    ? ` · ${data.kpis.horasSemanaDe.semLinhaDeBase} fora por falta de linha de base`
                    : '') +
                  (data.kpis.horasSemanaDe.semHistorico > 0
                    ? ` · ${data.kpis.horasSemanaDe.semHistorico} sem histórico`
                    : '')
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

      {!data && !erro && !catalogo && <p className="text-sm text-muted">Carregando…</p>}

      {catalogo && (
        <section aria-label="Catálogo de agentes, rotinas e automações" className="space-y-3">
          <div role="tablist" aria-label="Tipo" className="flex flex-wrap gap-2 border-b border-border">
            {ABAS_DO_CATALOGO.map((a) => (
              <button
                key={a.chave}
                type="button"
                role="tab"
                aria-selected={filtro.aba === a.chave}
                title={a.dica}
                onClick={() => { setAberto(null); mudarFiltro({ aba: a.chave }); }}
                className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${filtro.aba === a.chave ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'}`}
              >
                {a.rotulo} <span className="font-os-mono text-[10px] text-dim">{contagem(a.chave)}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 font-os-mono text-[10px] text-muted">
            <label className="flex items-center gap-1">
              estado
              <select
                aria-label="Estado"
                value={filtro.estado}
                onChange={(e) => mudarFiltro({ estado: e.target.value as FiltroDoCatalogo['estado'] })}
                className="rounded-root border border-border bg-bg px-2 py-1 text-text"
              >
                {FILTROS_DE_ESTADO.map((e) => <option key={e.chave} value={e.chave}>{e.rotulo}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1">
              área
              <select
                aria-label="Área"
                value={filtro.area ?? ''}
                onChange={(e) => mudarFiltro({ area: e.target.value || null })}
                className="rounded-root border border-border bg-bg px-2 py-1 text-text"
              >
                <option value="">todas</option>
                {areas.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1">
              dono
              <select
                aria-label="Dono"
                value={filtro.dono ?? ''}
                onChange={(e) => mudarFiltro({ dono: e.target.value || null })}
                className="rounded-root border border-border bg-bg px-2 py-1 text-text"
              >
                <option value="">todos</option>
                {donos.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                <option value="sem-dono">sem dono</option>
              </select>
            </label>
            <span className="text-dim">
              provedor {catalogo.provedor} · padrão {catalogo.padrao.modelo} ({catalogo.padrao.esforco})
              {catalogo.mes && ` · gasto de ${catalogo.mes}`}
            </span>
          </div>

          {visiveis.length === 0 && (
            <p className="rounded-root border border-border bg-surface p-4 text-sm text-muted">
              Nada nesta aba com estes filtros.
            </p>
          )}

          <ul className="space-y-2">
            {visiveis.map((l) => {
              const item = l.registrado ? doRoster(l.slug) : undefined;
              const link = ondeMexer(l);
              const expandido = aberto === l.slug;
              return (
                <li key={l.slug} data-testid={`linha-${l.slug}`} className="rounded-root border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-text">
                        {l.nome}
                        {l.id && <span className="ml-2 font-os-mono text-[9.5px] text-dim">{l.id}</span>}
                        {l.soNoPapel && <span className="ml-2 font-os-mono text-[9.5px] text-warn">só no papel</span>}
                      </p>
                      <p className="text-[11.5px] leading-[1.5] text-muted">{l.paraQueServe}</p>
                    </div>
                    <span
                      className={`font-os-mono text-[9.5px] uppercase tracking-[0.1em] ${l.estado === 'ativo' ? 'text-brand' : l.estado === 'desligado' ? 'text-warn' : 'text-dim'}`}
                      title={l.estadoMotivo ?? undefined}
                    >
                      {ROTULO_DO_ESTADO[l.estado]}
                    </span>
                  </div>

                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 font-os-mono text-[10px] sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <dt className="inline text-dim">dono </dt>
                      <dd className={`inline ${l.dono.efetivo ? 'text-muted' : 'text-warn'}`}>
                        {l.dono.efetivo ? `${l.dono.efetivo.nome}${l.dono.origem === 'padrao' ? ' (padrão)' : ''}` : 'sem dono'}
                      </dd>
                    </div>
                    {l.modelo && (
                      <div>
                        <dt className="inline text-dim">modelo </dt>
                        <dd className="inline text-muted" title={ROTULO_DA_ORIGEM_DO_MODELO[l.modelo.origem]}>
                          {l.modelo.modelo} · {l.modelo.esforco}
                          <span className="text-dim"> ({ROTULO_DA_ORIGEM_DO_MODELO[l.modelo.origem]})</span>
                        </dd>
                      </div>
                    )}
                    {!l.modelo && l.modeloExterno && (
                      <div>
                        <dt className="inline text-dim">modelo externo </dt>
                        <dd className="inline text-muted">{l.modeloExterno}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="inline text-dim">quando </dt>
                      <dd className="inline text-muted">{l.gatilho} · {l.frequencia}</dd>
                    </div>
                    <div>
                      <dt className="inline text-dim">última </dt>
                      <dd className="inline text-muted">
                        {l.ultima ? `${quando(l.ultima.em)}${l.ultima.status ? ` · ${l.ultima.status}` : ''}` : 'sem registro'}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-dim">próxima </dt>
                      <dd className="inline text-muted">{l.proxima ? quando(l.proxima.em) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="inline text-dim">gasto no mês </dt>
                      <dd className="inline text-muted">
                        {l.gastoMes ? `${dolares(l.gastoMes.totalUsd)} · ${l.gastoMes.chamadas} chamada(s)` : '—'}
                      </dd>
                    </div>
                    {l.estadoMotivo && (
                      <div className="sm:col-span-2 lg:col-span-3">
                        <dt className="inline text-dim">estado </dt>
                        <dd className="inline text-warn">{l.estadoMotivo}</dd>
                      </div>
                    )}
                    <div className="sm:col-span-2 lg:col-span-3">
                      <dt className="inline text-dim">onde mexer </dt>
                      <dd className="inline break-all text-muted">
                        {l.onde}
                        {link && (
                          <Link href={link.href} className="ml-2 text-brand hover:underline">
                            {link.rotulo} →
                          </Link>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {item && (
                    <div className="mt-2">
                      <button
                        type="button"
                        aria-expanded={expandido}
                        onClick={() => setAberto(expandido ? null : l.slug)}
                        className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-brand hover:underline"
                      >
                        {expandido ? 'fechar o controle' : 'abrir o controle'}
                      </button>
                      {expandido && (
                        <div className="mt-2">
                          <CartaoDoAgente a={item} aoMudar={carregar} aoAbrirProcedimento={setProcedimentoDe} />
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/*
        O DESVIO: sem catálogo, a grade de cartões de antes, inteira. Nenhum
        controle some porque a API é mais velha que a tela.
      */}
      {!catalogo && semCatalogo && data && (
        <>
          <p className="rounded-root border border-warn/40 bg-warn/10 p-3 text-[12px] leading-[1.6] text-warn">
            Catálogo indisponível ({semCatalogo}): a tela mostra só os agentes registrados, como antes,
            sem as abas de rotinas e automações.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {data.items.map((a) => (
              <CartaoDoAgente key={a.slug} a={a} aoMudar={carregar} aoAbrirProcedimento={setProcedimentoDe} />
            ))}
          </div>
        </>
      )}

      {procedimentoDe && (
        <Procedimento
          slug={procedimentoDe}
          token={token}
          /*
           * A MESMA DUPLA QUE A API EXIGE PARA CONFIGURAR AGENTE
           * (`CONFIGURAR_AGENTE` em agents.controller.ts). Cortesia de tela:
           * quem recusa de verdade é a API.
           */
          podeEditar={can('automacoes.executar') && can('admin.usuarios')}
          aoFechar={() => setProcedimentoDe(null)}
          aoSalvar={carregar}
        />
      )}
    </div>
  );
}
