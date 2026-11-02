'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ErroDaApi, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * ============================================================================
 * FLUXO DO CLIENTE — o caminho da proposta aceita até a continuidade ou o fim
 * ============================================================================
 *
 * Contexto da operação da ROOT (30/10/2026, da reunião de sócios de 29/10): 56
 * tarefas em 7 fases, cada uma com dono e "feito quando", e o que precisa estar
 * na área do cliente (o painel). Tela da ROOT, como
 * a Rodada da semana: a API recusa qualquer outra sessão com 403 e esta tela
 * explica em vez de quebrar. Só leitura. A fonte é um arquivo só,
 * `apps/api/src/platform/fluxo-do-cliente.json`; nova versão do fluxo = trocar
 * o arquivo.
 *
 * O desenho segue o mapa dos sócios: a espinha à esquerda (marcos, tarefas e
 * decisões, na ordem) e, ao lado de cada passo, o que corre em paralelo, o que
 * sai da decisão, as notas e o que está em aberto. O filtro por responsável
 * apaga o que não é dele em vez de esconder, para a ordem continuar legível.
 *
 * NA MEMÓRIA (02/11/2026, P-87). Os agentes não leem esta tela: eles buscam na
 * Memória. A faixa abaixo do cabeçalho diz se as dez notas que saem do MESMO
 * arquivo estão lá, e o botão "Levar para a Memória" cria as que faltam e grava a
 * versão nova das que a carga escreveu antes. Nota editada à mão ou arquivada na
 * Memória fica como está. Sem permissão de ver a Memória, a faixa não aparece.
 */

const CAMINHO = '/tenants/plataforma/operacao/fluxo-do-cliente';
const CAMINHO_DA_MEMORIA = `${CAMINHO}/memoria`;

type Tarefa = {
  numero: string;
  chave: string;
  responsavel: string;
  titulo: string;
  feito_quando: string;
  notas?: string[];
  em_aberto?: string[];
  em_paralelo?: { trilho: string; tarefas: Tarefa[] }[];
};
type Etapa =
  | { tipo: 'marco'; texto: string }
  | ({ tipo: 'tarefa' } & Tarefa)
  | { tipo: 'decisao'; chave: string; pergunta: string; segue_se: string; ramos?: Tarefa[]; notas?: string[] };
type Desvio = {
  de: string;
  resposta: string;
  para?: string;
  depois_volta_a?: string;
  volta_a?: string;
  pula_para?: string;
  depois?: string;
  prazo?: string;
  repete?: boolean;
};
type Fluxo = {
  nome: string;
  versao: string;
  data: string;
  fonte: string;
  total_tarefas: number;
  /** O que precisa estar no painel do cliente, com a tarefa que alimenta cada item (v6). */
  area_do_cliente?: { item: string; origem: string; tarefa: string | null }[];
  fases: { id: string; nome: string; etapas: Etapa[] }[];
  desvios: Desvio[];
};

/** Cópia do que `GET/POST …/fluxo-do-cliente/memoria` devolve; só os campos que a faixa usa. */
type SituacaoNaMemoria = 'falta' | 'em_dia' | 'desatualizada' | 'editada' | 'arquivada';
type FluxoNaMemoria = {
  versaoDoFluxo: string;
  notas: { chave: string; titulo: string; situacao: SituacaoNaMemoria; id: string | null; versao: number | null }[];
  contagem: Record<SituacaoNaMemoria, number>;
  criadas?: number;
  atualizadas?: number;
  falhas?: { chave: string; titulo: string; motivo: string }[];
};
const ROTULO_DA_SITUACAO: Record<SituacaoNaMemoria, string> = {
  falta: 'falta',
  em_dia: 'em dia',
  desatualizada: 'versão antiga',
  editada: 'editada na Memória · fica como está',
  arquivada: 'arquivada na Memória · fica como está',
};

const PAPEIS = ['COMERCIAL', 'FINANCEIRO', 'DONO DA CONTA', 'QUEM IMPLANTA', '2º SÓCIO', 'MARKETING', 'TI DO CLIENTE', 'QUEM RESPONDE'] as const;
const ROTULO_DO_PAPEL: Record<(typeof PAPEIS)[number], string> = {
  COMERCIAL: 'Comercial',
  FINANCEIRO: 'Financeiro',
  'DONO DA CONTA': 'Dono da conta',
  'QUEM IMPLANTA': 'Quem implanta',
  '2º SÓCIO': '2º sócio',
  MARKETING: 'Marketing',
  'TI DO CLIENTE': 'TI do cliente',
  'QUEM RESPONDE': 'Quem responde',
};

const ROTULO = 'font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted';
const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const dataBr = (iso: string) => iso.split('-').reverse().join('/');

function irPara(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Todas as tarefas do fluxo, inclusive as que correm em paralelo e as que saem de decisão. */
function tarefasDe(fluxo: Fluxo): Tarefa[] {
  return fluxo.fases.flatMap((f) =>
    f.etapas.flatMap((e) => {
      if (e.tipo === 'tarefa') return [e, ...(e.em_paralelo ?? []).flatMap((p) => p.tarefas)];
      if (e.tipo === 'decisao') return e.ramos ?? [];
      return [];
    }),
  );
}

export default function FluxoDoClientePage() {
  const { token, ready } = useAuth();
  const [fluxo, setFluxo] = useState<Fluxo | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [papel, setPapel] = useState<(typeof PAPEIS)[number] | ''>('');
  const [busca, setBusca] = useState('');
  const [soEmAberto, setSoEmAberto] = useState(false);
  /** `null` = ainda lendo ou sem permissão de ver a Memória (a faixa some). */
  const [naMemoria, setNaMemoria] = useState<FluxoNaMemoria | null>(null);
  const [levando, setLevando] = useState(false);
  const [erroDaMemoria, setErroDaMemoria] = useState<string | null>(null);

  const lerMemoria = useCallback(async () => {
    if (!token) return;
    try {
      setNaMemoria(await apiGet<FluxoNaMemoria>(CAMINHO_DA_MEMORIA, token));
    } catch {
      setNaMemoria(null);
    }
  }, [token]);

  const carregar = useCallback(async () => {
    if (!token) return;
    setErro(null);
    try {
      setFluxo(await apiGet<Fluxo>(CAMINHO, token));
      setAutorizado(true);
      void lerMemoria();
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 403) setAutorizado(false);
      else setErro((e as Error).message);
    }
  }, [token, lerMemoria]);

  const levarParaMemoria = async () => {
    if (!token) return;
    setLevando(true);
    setErroDaMemoria(null);
    try {
      setNaMemoria(await apiPost<FluxoNaMemoria>(CAMINHO_DA_MEMORIA, {}, token));
    } catch (e) {
      setErroDaMemoria(e instanceof ErroDaApi && e.status === 403 ? 'Levar para a Memória pede a permissão de editar a Memória.' : (e as Error).message);
    } finally {
      setLevando(false);
    }
  };

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  const todas = useMemo(() => (fluxo ? tarefasDe(fluxo) : []), [fluxo]);
  const porChave = useMemo(() => new Map(todas.map((t) => [t.chave, t])), [todas]);
  const perguntaPorChave = useMemo(
    () => new Map((fluxo?.fases ?? []).flatMap((f) => f.etapas).flatMap((e) => (e.tipo === 'decisao' ? [[e.chave, e.pergunta] as const] : []))),
    [fluxo],
  );
  const contaPorPapel = useMemo(
    () => Object.fromEntries(PAPEIS.map((p) => [p, todas.filter((t) => t.responsavel.includes(p)).length])) as Record<(typeof PAPEIS)[number], number>,
    [todas],
  );
  const emAberto = todas.filter((t) => t.em_aberto?.length).length;
  const filtrando = !!papel || !!busca.trim() || soEmAberto;
  const passa = useCallback(
    (t: Tarefa) => {
      if (papel && !t.responsavel.includes(papel)) return false;
      if (soEmAberto && !t.em_aberto?.length) return false;
      const b = semAcento(busca.trim());
      if (b && !semAcento(`${t.numero} ${t.titulo} ${t.feito_quando} ${t.responsavel}`).includes(b)) return false;
      return true;
    },
    [papel, soEmAberto, busca],
  );
  const visiveis = todas.filter(passa).length;

  if (!ready || (autorizado === null && !erro)) return <p className="text-[12.5px] text-muted">carregando…</p>;

  if (autorizado === false) {
    return (
      <div className="rounded border border-border bg-surface p-4">
        <p className="text-[13px] text-text">Esta área é da ROOT.</p>
        <p className="mt-1 text-[12px] leading-[1.6] text-muted">O fluxo do cliente é visto pela sessão de quem opera a plataforma.</p>
      </div>
    );
  }

  if (erro || !fluxo) {
    return (
      <div className="rounded border border-bad/40 bg-bad/10 p-4 text-[12.5px] text-bad">
        {erro ?? 'Não deu para ler o fluxo.'}{' '}
        <button type="button" onClick={() => void carregar()} className={`underline ${FOCO}`}>tentar de novo</button>
      </div>
    );
  }

  /** "03 · Cobrar o fechamento", com link; decisão vira a pergunta. */
  const Ref = ({ chave }: { chave: string }) => {
    const t = porChave.get(chave);
    if (!t) return <span className="text-text">{perguntaPorChave.get(chave) ?? chave}</span>;
    return (
      <button type="button" onClick={() => irPara(`t-${t.numero}`)} className={`text-left text-text underline decoration-border underline-offset-2 hover:text-brand ${FOCO}`}>
        <span className="font-os-mono">{t.numero}</span> · {t.titulo}
      </button>
    );
  };

  const fraseDoDesvio = (d: Desvio) => (
    <>
      <b className="font-semibold text-text">{d.resposta}</b>
      {': '}
      {d.para && <Ref chave={d.para} />}
      {d.para && d.depois && <> e <Ref chave={d.depois} /></>}
      {d.repete && ', em ciclo'}
      {d.depois_volta_a && <>, depois volta a <Ref chave={d.depois_volta_a} /></>}
      {d.volta_a && <>volta a <Ref chave={d.volta_a} /></>}
      {d.pula_para && <>pula para <Ref chave={d.pula_para} /></>}
      {d.prazo && <span className="text-muted"> ({d.prazo})</span>}
    </>
  );

  const Cartao = ({ t, compacto = false }: { t: Tarefa; compacto?: boolean }) => (
    <article
      id={`t-${t.numero}`}
      className={`scroll-mt-24 rounded border bg-surface ${compacto ? 'p-3' : 'p-4'} transition-opacity ${filtrando && !passa(t) ? 'border-border opacity-30' : filtrando ? 'border-brand' : 'border-border'}`}
    >
      <p className="font-os-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand">
        {t.numero} · {t.responsavel}
      </p>
      <h3 className={`mt-1 font-semibold leading-[1.35] text-text ${compacto ? 'text-[13px]' : 'text-[14.5px]'}`}>{t.titulo}</h3>
      <p className="mt-1.5 text-[12.5px] leading-[1.55] text-muted">
        <span className="text-text">Feito quando:</span> {t.feito_quando}
      </p>
    </article>
  );

  const Nota = ({ texto }: { texto: string }) => (
    <p className="rounded border border-dashed border-border px-3 py-2 text-[12px] leading-[1.55] text-muted">{texto}</p>
  );
  const EmAberto = ({ texto }: { texto: string }) => (
    <div className="rounded border border-warn/50 bg-warn/5 px-3 py-2">
      <p className={`${ROTULO} text-warn`}>Em aberto</p>
      <p className="mt-1 text-[12px] leading-[1.55] text-text">{texto.charAt(0).toUpperCase() + texto.slice(1)}</p>
    </div>
  );

  const Lado = ({ e }: { e: Etapa }) => {
    if (e.tipo === 'marco') return null;
    const itens: React.ReactNode[] = [];
    if (e.tipo === 'tarefa') {
      for (const p of e.em_paralelo ?? []) {
        itens.push(
          <div key={p.trilho} className="rounded border border-dashed border-brand/60 bg-brand/5 p-2.5">
            <p className={`${ROTULO} mb-2 text-brand`}>{p.trilho}</p>
            <div className="space-y-2">{p.tarefas.map((t) => <Cartao key={t.chave} t={t} compacto />)}</div>
          </div>,
        );
      }
      for (const n of e.notas ?? []) itens.push(<Nota key={n} texto={n} />);
      for (const a of e.em_aberto ?? []) itens.push(<EmAberto key={a} texto={a} />);
    } else {
      for (const r of e.ramos ?? []) {
        const d = fluxo.desvios.find((x) => x.de === e.chave && (x.para === r.chave || x.depois === r.chave));
        itens.push(
          <div key={r.chave}>
            {d && (
              <p className="mb-1 text-[11.5px] text-muted">
                <b className="font-semibold text-text">{d.resposta}</b>
                {d.depois_volta_a && <>, depois volta a <Ref chave={d.depois_volta_a} /></>}
                {d.prazo && <> ({d.prazo})</>}
                {d.repete && ', em ciclo'}
              </p>
            )}
            <Cartao t={r} compacto />
          </div>,
        );
      }
      for (const n of e.notas ?? []) itens.push(<Nota key={n} texto={n} />);
    }
    return itens.length ? <div className="space-y-2">{itens}</div> : null;
  };

  const Espinha = ({ e }: { e: Etapa }) => {
    if (e.tipo === 'marco') {
      return (
        <span className="inline-flex rounded-full border border-brand bg-brand/10 px-4 py-1.5 text-[13.5px] font-semibold text-brand">{e.texto}</span>
      );
    }
    if (e.tipo === 'tarefa') return <Cartao t={e} />;
    const soltos = fluxo.desvios.filter((d) => d.de === e.chave && !d.para);
    return (
      <div className={`rounded border border-text/25 bg-surface-2 p-4 transition-opacity ${filtrando ? 'opacity-60' : ''}`}>
        <p className={ROTULO}>Decisão</p>
        <p className="mt-1 text-[14.5px] font-semibold text-text">{e.pergunta}</p>
        <p className="mt-1.5 text-[12.5px] text-muted">
          Segue se <b className="font-semibold text-text">{e.segue_se}</b>
        </p>
        {soltos.map((d) => (
          <p key={`${d.resposta}-${d.volta_a ?? d.pula_para ?? d.para}`} className="mt-1 text-[12.5px] text-muted">{fraseDoDesvio(d)}</p>
        ))}
      </div>
    );
  };

  const Ponto = ({ e }: { e: Etapa }) =>
    e.tipo === 'decisao' ? (
      <span aria-hidden className="absolute -left-[6px] top-5 h-[11px] w-[11px] rotate-45 border-2 border-text bg-bg" />
    ) : (
      <span aria-hidden className={`absolute -left-[5px] top-4 h-[9px] w-[9px] rounded-full ${e.tipo === 'marco' ? 'bg-brand' : 'border-2 border-border bg-bg'}`} />
    );

  return (
    <div className="mx-auto max-w-[1080px] space-y-6 pb-16">
      <header className="space-y-1">
        <p className="max-w-[720px] text-[13px] leading-[1.6] text-text">
          Da proposta aceita até a continuidade ou o fim. Cada tarefa tem dono e o critério de feito.
        </p>
        <p className="font-os-mono text-[10.5px] text-muted">
          {fluxo.versao} · {dataBr(fluxo.data)} · {todas.length} tarefas · {fluxo.fases.length} fases · {emAberto} em aberto
        </p>
      </header>

      {naMemoria && (() => {
        const { contagem, notas } = naMemoria;
        const pendentes = contagem.falta + contagem.desatualizada;
        const ficam = contagem.editada + contagem.arquivada;
        const situacao =
          contagem.falta === notas.length
            ? `Nenhuma das ${notas.length} notas está na Memória. Os agentes do OS ainda não leem este fluxo.`
            : pendentes
              ? `${contagem.em_dia} de ${notas.length} notas em dia.${contagem.falta ? ` ${contagem.falta} ${contagem.falta === 1 ? 'falta' : 'faltam'}.` : ''}${contagem.desatualizada ? ` ${contagem.desatualizada} em versão antiga.` : ''}`
              : `As ${contagem.em_dia} notas do ${naMemoria.versaoDoFluxo} estão em dia. Os agentes do OS leem este fluxo.`;
        return (
          <section aria-labelledby="na-memoria" className="space-y-2 rounded border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-[240px] flex-1 space-y-1">
                <h2 id="na-memoria" className={ROTULO}>Na Memória</h2>
                <p className="text-[13px] leading-[1.6] text-text">{situacao}</p>
                {ficam > 0 && (
                  <p className="text-[12px] leading-[1.55] text-muted">
                    {ficam === 1
                      ? '1 nota foi editada ou arquivada na Memória e fica como está.'
                      : `${ficam} notas foram editadas ou arquivadas na Memória e ficam como estão.`}
                  </p>
                )}
                {(naMemoria.criadas !== undefined || naMemoria.atualizadas !== undefined) && (
                  <p className="text-[12px] text-muted">
                    Agora: <b className="font-os-mono text-text">{naMemoria.criadas ?? 0}</b> criadas e <b className="font-os-mono text-text">{naMemoria.atualizadas ?? 0}</b> atualizadas.
                  </p>
                )}
              </div>
              {pendentes > 0 && (
                <button
                  type="button"
                  onClick={() => void levarParaMemoria()}
                  disabled={levando}
                  className={`rounded-root bg-brand px-3 py-1.5 text-xs font-medium text-ink hover:opacity-90 disabled:opacity-60 ${FOCO}`}
                >
                  {levando ? 'Levando…' : 'Levar para a Memória'}
                </button>
              )}
            </div>
            {erroDaMemoria && <p className="text-[12px] text-bad">{erroDaMemoria}</p>}
            {!!naMemoria.falhas?.length && (
              <ul className="space-y-1 text-[12px] text-bad">
                {naMemoria.falhas.map((f) => <li key={f.chave}>{f.titulo}: {f.motivo}</li>)}
              </ul>
            )}
            <details className="border-t border-border pt-2">
              <summary className={`cursor-pointer text-[12px] text-muted hover:text-text ${FOCO}`}>Ver as {notas.length} notas</summary>
              <ul className="mt-2 space-y-1">
                {notas.map((n) => (
                  <li key={n.chave} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-[1.5]">
                    {n.id ? (
                      <Link href={`/contexto?nota=${n.id}`} className={`text-text underline decoration-border underline-offset-2 hover:text-brand ${FOCO}`}>{n.titulo}</Link>
                    ) : (
                      <span className="text-text">{n.titulo}</span>
                    )}
                    <span className={`text-[11.5px] ${n.situacao === 'em_dia' ? 'text-brand' : n.situacao === 'editada' || n.situacao === 'arquivada' ? 'text-warn' : 'text-muted'}`}>
                      {ROTULO_DA_SITUACAO[n.situacao]}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        );
      })()}

      <div className="space-y-3 rounded border border-border bg-surface p-4">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setPapel('')}
            className={`rounded-full border px-3 py-1 text-[12px] ${FOCO} ${!papel ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand'}`}
          >
            Todos
          </button>
          {PAPEIS.filter((p) => contaPorPapel[p] > 0).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPapel(papel === p ? '' : p)}
              aria-pressed={papel === p}
              className={`rounded-full border px-3 py-1 text-[12px] ${FOCO} ${papel === p ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand'}`}
            >
              {ROTULO_DO_PAPEL[p]} <b className="font-os-mono tabular-nums">{contaPorPapel[p]}</b>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar tarefa (ex.: VPS, nota, aditivo)"
            aria-label="Buscar tarefa"
            className={`min-w-[220px] flex-1 rounded border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-brand ${FOCO}`}
          />
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" checked={soEmAberto} onChange={(e) => setSoEmAberto(e.target.checked)} className="accent-brand" />
            Só o que está em aberto
          </label>
          {filtrando && (
            <span className="text-[12px] text-muted">
              <b className="font-os-mono text-text">{visiveis}</b> de {todas.length}
              {' · '}
              <button type="button" onClick={() => { setPapel(''); setBusca(''); setSoEmAberto(false); }} className={`underline ${FOCO}`}>limpar</button>
            </span>
          )}
        </div>
        <nav aria-label="Fases" className="flex flex-wrap gap-1.5 border-t border-border pt-3">
          {fluxo.fases.map((f, i) => (
            <button
              key={f.id}
              type="button"
              onClick={() => irPara(f.id)}
              className={`rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-text ${FOCO}`}
            >
              <span className="font-os-mono text-brand">{i + 1}</span> {f.nome}
            </button>
          ))}
          {!!fluxo.area_do_cliente?.length && (
            <button type="button" onClick={() => irPara('area-do-cliente')} className={`rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-text ${FOCO}`}>
              Área do cliente
            </button>
          )}
          <button type="button" onClick={() => irPara('desvios')} className={`rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-text ${FOCO}`}>
            Desvios e voltas
          </button>
        </nav>
      </div>

      {fluxo.fases.map((f, i) => {
        const daFase = f.etapas.flatMap((e) =>
          e.tipo === 'tarefa' ? [e, ...(e.em_paralelo ?? []).flatMap((p) => p.tarefas)] : e.tipo === 'decisao' ? e.ramos ?? [] : [],
        );
        return (
          <section key={f.id} id={f.id} className="scroll-mt-20">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`${ROTULO} text-brand`}>Fase {i + 1}</span>
              <h2 className="text-[18px] font-semibold text-text">{f.nome}</h2>
              <span className="font-os-mono text-[10.5px] text-muted">
                {daFase.length} tarefas · {daFase[0]?.numero}–{daFase[daFase.length - 1]?.numero}
              </span>
            </div>
            <ol className="ml-[5px]">
              {f.etapas.map((e, j) => (
                <li key={`${f.id}-${j}`} className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,340px)] md:gap-x-5">
                  <div className="relative border-l border-border pb-3 pl-5">
                    <Ponto e={e} />
                    <Espinha e={e} />
                  </div>
                  <div className="border-l border-border pb-3 pl-5 empty:hidden md:border-l-0 md:pl-0">
                    <Lado e={e} />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      {!!fluxo.area_do_cliente?.length && (
        <section id="area-do-cliente" className="scroll-mt-20 rounded border border-border bg-surface p-4">
          <h2 className={`${ROTULO} mb-1`}>Área do cliente (painel)</h2>
          <p className="mb-3 text-[12.5px] text-muted">O que precisa estar no painel do cliente e a tarefa do fluxo que alimenta cada item.</p>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {fluxo.area_do_cliente.map((a) => {
              const t = a.tarefa ? todas.find((x) => x.numero === a.tarefa) : undefined;
              return (
                <li key={a.item} className="flex items-baseline gap-2 border-b border-border pb-2 text-[12.5px] leading-[1.5] text-text">
                  <span className="flex-1">{a.item}</span>
                  {t ? (
                    <button type="button" onClick={() => irPara(`t-${t.numero}`)} title={t.titulo} className={`shrink-0 font-os-mono text-[11px] text-brand underline-offset-2 hover:underline ${FOCO}`}>
                      {t.numero}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted">sem tarefa</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section id="desvios" className="scroll-mt-20 rounded border border-border bg-surface p-4">
        <h2 className={`${ROTULO} mb-3`}>Desvios e voltas</h2>
        <ul className="space-y-2">
          {fluxo.desvios.map((d) => (
            <li key={`${d.de}-${d.resposta}`} className="text-[12.5px] leading-[1.6] text-muted">
              <span className="text-text">{perguntaPorChave.get(d.de) ?? d.de}</span> → {fraseDoDesvio(d)}
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted">Fonte: {fluxo.fonte}.</p>
      </section>
    </div>
  );
}
