'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KpiCard } from '@/components/KpiCard';
import { ProntidaoLocal } from '@/components/ProntidaoLocal';
import { Procedimento } from './Procedimento';
import { ControleDoAgente } from './ControleDoAgente';
import { Orcamento } from './Orcamento';
import { CriarAgente } from './CriarAgente';
import { ExecucaoLocal } from './ExecucaoLocal';
import { AgendaManual } from './AgendaManual';
import type { EstadoDeAgente, SituacaoDeAgente } from './estado';

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
  /* A DECISÃO do dono (coluna). Ver `estado.ts`. */
  estado: EstadoDeAgente;
  /* O que ESTÁ ACONTECENDO — derivado no servidor, nunca calculado aqui. */
  situacao: SituacaoDeAgente;
  estadoPor: string | null;
  estadoEm: string | null;
  estadoMotivo: string | null;
  transicoes: string[];
  autonomiaAte: string;
  rebaixadoAte: string | null;
  capacidades: string[];
  cron: string | null;
  ultimaExecucaoEm: string | null;
  ultimoStatus: string | null;
  execucoes: number;
  falhas: number;
  /*
   * AS HORAS, COM A PROCEDÊNCIA (fatia A3). `naSemana` é MEDIDO do log de
   * passagens — sessões com bom desfecho nos últimos sete dias —, e é o mesmo
   * cálculo que `/rotinas` faz. O campo `horasDevolvidas` de antes SAIU: ele era
   * acumulado de vida inteira com as passagens que falharam dentro, publicado
   * como se fosse semanal.
   */
  horas: {
    estado: 'sem-linha-de-base' | 'sem-historico' | 'medida';
    naSemana: number | null;
    passagensNaSemana: number;
    diasDaJanela: number;
    janelaCoberta: boolean;
    cobreDesde: string | null;
  };
  /** Vida inteira, e a tela diz isso. Nunca no lugar do semanal. */
  horasAcumuladas: number | null;
  passagensBemSucedidas: number;
  linhaDeBase: { minutosPorExecucao: number; informadaEm: string | null } | null;
  orcamento: {
    mensalUsd: number;
    ativo: boolean;
    definidoEm: string | null;
    definidoPor: string | null;
    motivo: string | null;
  } | null;
  temProcedimento: boolean;
  procedimento: { versao: number; atualizadoEm: string } | null;
  /** Dos SETE campos do formato fixo, quais faltam neste agente. */
  faltando: string[];
}

interface Roster {
  items: Agente[];
  kpis: {
    /* Quantos o dono deixou em operação (decisão) … */
    ativos: number;
    /* … e quantos têm sessão viva NESTE momento (medição). Ver o bloco de
       `kpis` em `agents.service.ts`: eram um número só, chamado "Rodando",
       que contava o estado declarado. */
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

export default function AgentesPage() {
  const { token, ready, can, user } = useAuth();
  const [data, setData] = useState<Roster | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [minutos, setMinutos] = useState('');
  const [criandoAgente, setCriandoAgente] = useState(false);
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

      <ProntidaoLocal tipo="agentes" />

      {can('automacoes.executar') && can('admin.usuarios') && <button type="button" onClick={() => setCriandoAgente(true)} className="rounded bg-brand px-3 py-2 text-sm text-ink">Criar agente</button>}
      {criandoAgente && user && <CriarAgente token={token} pessoaId={user.id} aoFechar={() => setCriandoAgente(false)} aoCriar={() => { setCriandoAgente(false); carregar(); }} />}

      {erro && <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</div>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {/*
          DOIS CARTÕES ONDE HAVIA UM, e é conserto de mentira: o cartão
          "Rodando" contava `estado === 'rodando'`, o estado DECLARADO — ou seja,
          dava o mesmo número para um agente trabalhando agora e para um parado
          há três semanas. Agora um diz a DECISÃO e o outro a MEDIÇÃO.
        */}
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
        {/*
          O CARTÃO DEIXOU DE MENTIR (fatia A3). Ele publicava a soma de
          `linha de base × execuções de vida inteira`, com as passagens que
          falharam dentro, embaixo do rótulo "Horas devolvidas" — ao lado do
          cartão de `/rotinas`, que diz "por semana". Agora é a medição da
          semana, do log real de passagens, e o `hint` diz a janela e quantos
          agentes ficaram fora da soma.
        */}
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
              {a.horas.naSemana != null ? (
                /*
                  A FÓRMULA CONTINUA NA TELA, e agora ela é a verdadeira: a
                  linha de base declarada × as passagens com bom desfecho DA
                  SEMANA. Antes era × `execucoes`, o contador de vida inteira
                  com as falhas dentro — mesma tela, mesma fórmula visível,
                  número que nunca aconteceu.

                  O acumulado não desapareceu: ele aparece ao lado, com o nome
                  "acumulado", que é o que ele é.
                */
                <p className="font-os-mono text-[10px] text-muted">
                  <span className="text-text">{a.horas.naSemana} h</span> devolvidas em{' '}
                  {a.horas.diasDaJanela} dias
                  <span className="text-dim">
                    {' '}
                    = {a.linhaDeBase!.minutosPorExecucao} min × {a.horas.passagensNaSemana} passagem(ns)
                  </span>
                  {a.horasAcumuladas != null && (
                    <span className="text-dim"> · {a.horasAcumuladas} h acumuladas na vida inteira</span>
                  )}
                </p>
              ) : a.horas.estado === 'sem-historico' ? (
                <p className="font-os-mono text-[10px] text-warn">
                  não deu para contar as passagens da semana — horas não medidas
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

            {/*
              O ORÇAMENTO MENSAL DE IA — fatia A3. `podeDefinir` é a MESMA dupla
              que a API exige em `CONFIGURAR_AGENTE`; cortesia de tela, quem
              recusa de verdade é a rota.
            */}
            <Orcamento
              slug={a.slug}
              orcamento={a.orcamento}
              token={token}
              podeDefinir={can('automacoes.executar') && can('admin.usuarios')}
              aoMudar={carregar}
            />

            {/*
              O ESTADO E OS BOTÕES — fatia A2.
              `podeComandar` é `admin.usuarios`, a MESMA chave do interruptor de
              conector; `podeInvocar` é a dupla que a API exige para fazer um
              agente rodar (`EXECUTAR_AGENTE` no controlador). As duas aqui são
              cortesia de tela: quem recusa de verdade é a API.
            */}
            {a.slug.startsWith('procedimento-') && user && <ExecucaoLocal slug={a.slug} token={token} pessoaId={user.id} podeExecutar={can('mcp.executar') && can('admin.usuarios') && can('obsidian.ver')} />}
            {a.slug.startsWith('procedimento-') && user && can('mcp.ver') && can('obsidian.ver') && <AgendaManual slug={a.slug} token={token} pessoaId={user.id} podeLer={can('mcp.ver') && can('obsidian.ver')} podeConfigurar={can('automacoes.executar') && can('admin.usuarios') && can('mcp.ver') && can('obsidian.ver')} podeExecutar={can('mcp.ver') && can('mcp.executar') && can('admin.usuarios') && can('obsidian.ver')} aoMudar={carregar} />}
            {user && <ControleDoAgente
              agente={a}
              token={token}
              pessoaId={user.id}
              podeComandar={can('admin.usuarios')}
              podeInvocar={!a.slug.startsWith('procedimento-') && can('mcp.executar') && can('admin.usuarios')}
              aoMudar={carregar}
            />}
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
