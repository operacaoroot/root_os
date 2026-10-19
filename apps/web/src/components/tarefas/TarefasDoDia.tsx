'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  type AreaDeTarefa, type PainelDeTarefas, type ResultadoDeCriar, type SituacaoDoPrazo, type TarefaDoDia,
} from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { abrirFicha } from '@/lib/ficha';
import { Numero, Quadro } from '@/components/painel';
import { Barras, type Fatia } from './graficos';

/*
 * DIA A DIA › TAREFAS: todas as tarefas de todas as áreas num lugar (19/10/2026).
 *
 * Uma lista só, vista de três jeitos (Quadro, Lista, Calendário) — as abas nunca
 * copiam a tarefa, só mudam o desenho. O resumo em gráfico mora em Visão geral da
 * empresa (`ResumoDeTarefas`, abaixo), e cada clique dele abre esta lista filtrada. Filtros na URL (?pessoa=…&area=…), para
 * o voltar do navegador desfazer o clique e o link poder ser mandado a alguém.
 * O detalhe abre por cima (?tarefa=id), com × e Esc, como a ficha do cliente.
 *
 * CADA ÁREA TEM A SUA ABA (Comercial › Tarefas, Marketing › Tarefas, …): é este
 * mesmo componente com `area` fixa. Lê a mesma lista e só esconde as das outras
 * áreas; a tarefa criada ali já nasce com a área. Nada é copiado.
 */

type Ver = 'quadro' | 'lista' | 'calendario';
type Agrupar = 'pessoa' | 'area' | 'situacao';
type Recorte = 'atrasada' | 'emdia' | 'sem_prazo' | 'hoje' | 'semana' | 'depois' | 'feita';
interface Filtro { pessoa?: string; area?: string; cliente?: string; situacao?: Recorte; q?: string }
const CHAVES: (keyof Filtro)[] = ['pessoa', 'area', 'cliente', 'situacao', 'q'];
const SEM = 'sem';

const NOME_DA_SITUACAO: Record<SituacaoDoPrazo, string> = {
  atrasada: 'Atrasadas', hoje: 'Hoje', semana: 'Até domingo', depois: 'Depois', sem_prazo: 'Sem prazo', feita: 'Feitas',
};
const NOME_DO_RECORTE: Record<Recorte, string> = { ...NOME_DA_SITUACAO, emdia: 'Em dia' };
/** Um acento só (lima cheio, médio, fraco); vermelho só para o problema (atrasada). */
const FORTE = 'rgb(var(--os-ac))';
const MEDIO = 'rgb(var(--os-ac) / 0.45)';
const FRACO = 'rgb(var(--os-tx2) / 0.3)';
const VERMELHO = 'rgb(var(--os-err))';
const COR_DA_SITUACAO: Record<SituacaoDoPrazo, string> = {
  atrasada: VERMELHO, hoje: FORTE, semana: MEDIO, depois: MEDIO, sem_prazo: FRACO, feita: FORTE,
};
const ABERTAS: SituacaoDoPrazo[] = ['atrasada', 'hoje', 'semana', 'depois', 'sem_prazo'];

const dd = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const primeiro = (nome: string) => nome.split(' ')[0];

function lerUrl() {
  const q = new URLSearchParams(window.location.search);
  const f: Filtro = {};
  for (const k of CHAVES) { const v = q.get(k); if (v) (f as Record<string, string>)[k] = v; }
  const v = q.get('ver');
  const a = q.get('agrupar');
  return {
    ver: (v === 'lista' || v === 'calendario' ? v : 'quadro') as Ver,
    agrupar: (a === 'area' || a === 'situacao' ? a : 'pessoa') as Agrupar,
    filtro: f,
    tarefa: q.get('tarefa'),
  };
}
function escreverUrl(ver: Ver, agrupar: Agrupar, filtro: Filtro, tarefa: string | null, empilhar: boolean) {
  const q = new URLSearchParams();
  if (ver !== 'quadro') q.set('ver', ver);
  if (ver === 'quadro' && agrupar !== 'pessoa') q.set('agrupar', agrupar);
  for (const k of CHAVES) if (filtro[k]) q.set(k, filtro[k]!);
  if (tarefa) q.set('tarefa', tarefa);
  const url = `${window.location.pathname}${q.toString() ? `?${q}` : ''}`;
  if (empilhar) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

function passa(t: TarefaDoDia, f: Filtro) {
  if (f.pessoa && (f.pessoa === SEM ? !!t.pessoa : t.pessoa?.id !== f.pessoa)) return false;
  if (f.area && (f.area === SEM ? !!t.area : t.area?.id !== f.area)) return false;
  if (f.cliente && t.cliente?.id !== f.cliente) return false;
  if (f.situacao) {
    if (f.situacao === 'emdia') { if (!['hoje', 'semana', 'depois'].includes(t.situacao)) return false; }
    else if (t.situacao !== f.situacao) return false;
  } else if (t.situacao === 'feita') return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!`${t.titulo} ${t.cliente?.titulo ?? ''}`.toLowerCase().includes(q)) return false;
  }
  return true;
}
const ordem = (a: TarefaDoDia, b: TarefaDoDia) =>
  (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999') || a.titulo.localeCompare(b.titulo, 'pt');

function useAlturaAteOFim(ref: React.RefObject<HTMLElement | null>, folga = 16) {
  const [altura, setAltura] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => { if (ref.current) setAltura(Math.max(340, window.innerHeight - ref.current.getBoundingClientRect().top - folga)); };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  });
  return altura;
}

/** `area`: nome da área (ex.: 'Comercial') quando a tela é a aba Tarefas de uma área. */
export function TarefasDoDia({ area: nomeDaArea }: { area?: string } = {}) {
  const { token, ready, can } = useAuth();
  const podeEditar = can('tarefas.editar');
  const [p, setP] = useState<PainelDeTarefas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ver, setVer] = useState<Ver>('quadro');
  const [agrupar, setAgrupar] = useState<Agrupar>('pessoa');
  const [filtro, setFiltro] = useState<Filtro>({});
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<PainelDeTarefas>('/trabalho/todas', token).then((x) => { setP(x); setErro(null); }).catch((e) => setErro(e.message));
  }, [token]);
  useEffect(() => { if (ready) carregar(); }, [ready, carregar]);
  useEffect(() => {
    const ler = () => { const u = lerUrl(); setVer(u.ver); setAgrupar(u.agrupar); setFiltro(u.filtro); setAberta(u.tarefa); };
    ler();
    window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, []);

  const ir = (v: Ver, f: Filtro = filtro, g: Agrupar = agrupar) => {
    setVer(v); setFiltro(f); setAgrupar(g); escreverUrl(v, g, f, null, true); setAberta(null);
  };
  const mudarFiltro = (f: Filtro) => { setFiltro(f); escreverUrl(ver, agrupar, f, aberta, false); };
  const abrirTarefa = (id: string) => {
    setAberta(id);
    escreverUrl(ver, agrupar, filtro, id, true);
    // Tarefa criada agora (ou por outra pessoa) ainda não está na tela: busca de novo.
    if (!p?.tarefas.some((t) => t.id === id)) carregar();
  };
  const fecharTarefa = () => { setAberta(null); escreverUrl(ver, agrupar, filtro, null, false); };

  /** Troca a tarefa no estado sem recarregar tudo (concluir, arrastar, editar). */
  const trocar = (t: TarefaDoDia) => setP((x) => (x ? { ...x, tarefas: x.tarefas.map((o) => (o.id === t.id ? t : o)) } : x));
  const alternarFeita = async (t: TarefaDoDia) => {
    if (!token) return;
    try { trocar(await apiPost<TarefaDoDia>(`/trabalho/todas/${t.id}/feita`, { expectedUpdatedAt: t.updatedAt }, token)); carregar(); }
    catch (e) { setErro((e as Error).message); carregar(); }
  };
  const editar = async (t: TarefaDoDia, mudanca: Record<string, unknown>) => {
    if (!token) return;
    try { trocar(await apiPatch<TarefaDoDia>(`/trabalho/todas/${t.id}`, { expectedUpdatedAt: t.updatedAt, ...mudanca }, token)); carregar(); }
    catch (e) { setErro((e as Error).message); carregar(); }
  };
  const criarArea = async (): Promise<AreaDeTarefa | null> => {
    const nome = window.prompt('Nome da nova área:')?.trim();
    if (!nome || !token) return null;
    try { const a = await apiPost<AreaDeTarefa>('/trabalho/todas/areas', { nome }, token); carregar(); return a; }
    catch (e) { setErro((e as Error).message); return null; }
  };

  // A área fixa é achada pelo nome: o id muda de empresa para empresa.
  const areaFixa = nomeDaArea && p ? p.areas.find((a) => a.nome.toLowerCase() === nomeDaArea.toLowerCase()) ?? null : null;
  const faltaArea = !!nomeDaArea && !!p && !areaFixa;
  const filtroDaTela: Filtro = useMemo(() => (areaFixa ? { ...filtro, area: areaFixa.id } : filtro), [filtro, areaFixa]);
  const daTela = useMemo(
    () => (p ? (areaFixa ? p.tarefas.filter((t) => t.area?.id === areaFixa.id) : faltaArea ? [] : p.tarefas) : []),
    [p, areaFixa, faltaArea],
  );
  const lista = useMemo(() => daTela.filter((t) => passa(t, filtroDaTela)).sort(ordem), [daTela, filtroDaTela]);
  const tarefaAberta = p?.tarefas.find((t) => t.id === aberta) ?? null;
  const agruparNaTela: Agrupar = areaFixa && agrupar === 'area' ? 'pessoa' : agrupar;

  return (
    <div className="com-tema mx-auto max-w-[1240px] space-y-5 text-text">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <div className="flex gap-1">
          {(['quadro', 'lista', 'calendario'] as Ver[]).map((v) => (
            <button
              key={v}
              onClick={() => ir(v)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[0.95rem] ${ver === v ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {v === 'quadro' ? 'Quadro' : v === 'lista' ? `Lista (${lista.length})` : 'Calendário'}
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-5">
          {p && (
            <>
              {nomeDaArea && <Link href="/dia-a-dia" className="text-sm text-muted hover:text-brand">todas as áreas →</Link>}
              <span className="text-sm text-muted">Abertas: <b className="com-num text-text">{daTela.filter((t) => t.situacao !== 'feita').length}</b></span>
              <span className="text-sm text-muted">Atrasadas: <b className="com-num text-bad">{daTela.filter((t) => t.situacao === 'atrasada').length}</b></span>
            </>
          )}
          {podeEditar && !faltaArea && (
            <button onClick={() => setNova(true)} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90">
              + Nova tarefa
            </button>
          )}
        </div>
      </div>

      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      {!p && !erro && <p className="text-muted">Carregando…</p>}

      {faltaArea && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-muted">
          A área {nomeDaArea} ainda não existe nesta empresa. Crie numa tarefa em <Link href="/dia-a-dia" className="text-brand">Dia a dia › Tarefas</Link>.
        </p>
      )}
      {p && !faltaArea && <Filtros p={p} filtro={filtro} mudar={mudarFiltro} areaFixa={!!areaFixa} />}
      {p && !faltaArea && ver === 'quadro' && (
        <QuadroDeTarefas
          p={p} tarefas={lista} agrupar={agruparNaTela} podeEditar={podeEditar} areaFixa={areaFixa?.id}
          trocarAgrupar={(g) => ir('quadro', filtro, g)} abrir={abrirTarefa} alternar={alternarFeita} editar={editar}
          criado={carregar} token={token}
        />
      )}
      {p && !faltaArea && ver === 'lista' && <ListaDeTarefas tarefas={lista} abrir={abrirTarefa} alternar={alternarFeita} podeEditar={podeEditar} mostrarArea={!areaFixa} />}
      {p && !faltaArea && ver === 'calendario' && (
        <CalendarioDeTarefas tarefas={lista} hoje={p.hoje} podeEditar={podeEditar} abrir={abrirTarefa} mudarPrazo={(t, prazo) => editar(t, { prazo })} />
      )}

      {p && tarefaAberta && (
        <JanelaDaTarefa
          t={tarefaAberta} p={p} podeEditar={podeEditar} fechar={fecharTarefa}
          alternar={() => alternarFeita(tarefaAberta)} editar={(m) => editar(tarefaAberta, m)} criarArea={criarArea}
        />
      )}
      {p && nova && (
        <NovaTarefa
          p={p} token={token} filtro={filtroDaTela} criarArea={criarArea}
          fechar={() => setNova(false)} criada={(id) => { setNova(false); carregar(); abrirTarefa(id); }} abrir={(id) => { setNova(false); abrirTarefa(id); }}
        />
      )}
    </div>
  );
}

// ---------------- Resumo (Visão geral da empresa) ----------------

/** URL da lista de tarefas já filtrada: é para onde todo clique do resumo leva. */
function urlDaLista(f: Filtro) {
  const q = new URLSearchParams({ ver: 'lista' });
  for (const k of CHAVES) if (f[k]) q.set(k, f[k]!);
  return `/dia-a-dia?${q}`;
}

/**
 * O resumo das tarefas de todas as áreas, para Visão geral da empresa: números
 * grandes, carga por prazo, por responsável e por área, e a tabela de cada
 * pessoa. Todo número e toda coluna abrem Dia a dia › Tarefas já filtrada.
 */
export function ResumoDeTarefas() {
  const { token, ready } = useAuth();
  const [p, setP] = useState<PainelDeTarefas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !token) return;
    apiGet<PainelDeTarefas>('/trabalho/todas', token).then(setP).catch((e) => setErro(e.message));
  }, [ready, token]);
  if (erro) return <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>;
  if (!p) return <p className="text-muted">Carregando…</p>;
  const abrirLista = (f: Filtro) => { window.location.href = urlDaLista(f); };

  const abertas = p.tarefas.filter((t) => t.situacao !== 'feita');
  const conta = (s: SituacaoDoPrazo) => abertas.filter((t) => t.situacao === s).length;
  const semDono = abertas.filter((t) => !t.pessoa).length;
  const feitas = p.tarefas.filter((t) => t.situacao === 'feita').length;

  const porSituacao: Fatia[] = ABERTAS.map((s) => ({
    chave: s, rotulo: NOME_DA_SITUACAO[s], valor: conta(s), cor: COR_DA_SITUACAO[s], onClick: () => abrirLista({ situacao: s }),
  }));
  const atrasadasDe = (lista: TarefaDoDia[]) => `${lista.filter((t) => t.situacao === 'atrasada').length} atrasadas`;
  const porPessoa: Fatia[] = [
    ...p.pessoas.map((pe) => {
      const delas = abertas.filter((t) => t.pessoa?.id === pe.id);
      return { chave: pe.id, rotulo: primeiro(pe.nome), valor: delas.length, cor: FORTE, dica: atrasadasDe(delas), onClick: () => abrirLista({ pessoa: pe.id }) };
    }),
    ...(semDono ? [{ chave: SEM, rotulo: 'Sem responsável', valor: semDono, cor: FRACO, onClick: () => abrirLista({ pessoa: SEM }) }] : []),
  ];
  const semArea = abertas.filter((t) => !t.area).length;
  const porArea: Fatia[] = [
    ...p.areas.map((a) => {
      const delas = abertas.filter((t) => t.area?.id === a.id);
      return { chave: a.id, rotulo: a.nome, valor: delas.length, cor: FORTE, dica: atrasadasDe(delas), onClick: () => abrirLista({ area: a.id }) };
    }),
    ...(semArea ? [{ chave: SEM, rotulo: 'Sem área', valor: semArea, cor: FRACO, onClick: () => abrirLista({ area: SEM }) }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { r: 'Tarefas abertas', v: abertas.length, n: 'todas as áreas', f: {} as Filtro },
          { r: 'Atrasadas', v: conta('atrasada'), n: 'prazo já passou', f: { situacao: 'atrasada' } as Filtro },
          { r: 'Não atribuídas', v: semDono, n: 'sem responsável', f: { pessoa: SEM } as Filtro },
          { r: 'Feitas na semana', v: feitas, n: 'últimos 7 dias', f: { situacao: 'feita' } as Filtro },
        ].map((c) => (
          <div key={c.r} className="rounded-md border border-border bg-surface px-4 py-3">
            <Numero rotulo={c.r} valor={String(c.v)} nota={c.n} onClick={() => abrirLista(c.f)} />
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Quadro titulo="Carga por prazo" nota="tarefas abertas · clique numa coluna">
          <Barras itens={porSituacao} />
        </Quadro>
        <Quadro titulo="Tarefas por responsável" nota="abertas · clique numa pessoa">
          <Barras itens={porPessoa} />
        </Quadro>
      </div>

      <Quadro titulo="Tarefas por área" nota="abertas em cada área · clique numa coluna">
        <Barras itens={porArea} />
      </Quadro>

      <Quadro titulo="Cada pessoa" nota="o que está atrasado, em dia e sem prazo · clique num número">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left">
                <th className="com-rotulo pb-2 font-normal">Pessoa</th>
                {(['Atrasadas', 'Em dia', 'Sem prazo', 'Feitas na semana'] as const).map((h) => (
                  <th key={h} className="com-rotulo pb-2 text-right font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.resumo.map((r) => {
                const id = r.pessoa?.id ?? SEM;
                const celula = (v: number, s: Recorte, mal = false) => (
                  <td className="py-2 text-right">
                    <button
                      disabled={!v}
                      onClick={() => abrirLista({ pessoa: id, situacao: s })}
                      className={`com-num rounded px-2 py-0.5 hover:bg-surface-2 disabled:text-muted/60 disabled:hover:bg-transparent ${mal && v ? 'font-bold text-bad' : ''}`}
                    >
                      {v}
                    </button>
                  </td>
                );
                return (
                  <tr key={id}>
                    <td className="py-2">{r.pessoa?.nome ?? 'Sem responsável'}</td>
                    {celula(r.atrasadas, 'atrasada', true)}
                    {celula(r.emDia, 'emdia')}
                    {celula(r.semPrazo, 'sem_prazo')}
                    {celula(r.feitasNaSemana, 'feita')}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Quadro>
    </div>
  );
}

// ---------------- Filtros ----------------

function Filtros({ p, filtro, mudar, areaFixa }: { p: PainelDeTarefas; filtro: Filtro; mudar: (f: Filtro) => void; areaFixa: boolean }) {
  const set = (k: keyof Filtro, v: string) => { const f = { ...filtro }; if (v) (f as Record<string, string>)[k] = v; else delete f[k]; mudar(f); };
  const sel = 'rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus:border-brand';
  const ativos = CHAVES.filter((k) => filtro[k] && !(areaFixa && k === 'area')).length;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={filtro.q ?? ''}
        onChange={(e) => set('q', e.target.value)}
        placeholder="Buscar tarefa ou cliente"
        className={`${sel} w-56`}
      />
      <select value={filtro.pessoa ?? ''} onChange={(e) => set('pessoa', e.target.value)} className={sel}>
        <option value="">Todas as pessoas</option>
        {p.pessoas.map((pe) => <option key={pe.id} value={pe.id}>{pe.nome}</option>)}
        <option value={SEM}>Sem responsável</option>
      </select>
      {!areaFixa && (
        <select value={filtro.area ?? ''} onChange={(e) => set('area', e.target.value)} className={sel}>
          <option value="">Todas as áreas</option>
          {p.areas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
          <option value={SEM}>Sem área</option>
        </select>
      )}
      <select value={filtro.situacao ?? ''} onChange={(e) => set('situacao', e.target.value)} className={sel}>
        <option value="">Abertas</option>
        {(Object.keys(NOME_DO_RECORTE) as Recorte[]).map((s) => <option key={s} value={s}>{NOME_DO_RECORTE[s]}</option>)}
      </select>
      {p.clientes.length > 0 && (
        <select value={filtro.cliente ?? ''} onChange={(e) => set('cliente', e.target.value)} className={sel}>
          <option value="">Todos os clientes</option>
          {p.clientes.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
        </select>
      )}
      {ativos > 0 && <button onClick={() => mudar({})} className="text-sm text-muted hover:text-brand">limpar filtros</button>}
    </div>
  );
}

// ---------------- Cartão ----------------

function Bolinha({ t, alternar, podeEditar }: { t: TarefaDoDia; alternar: (t: TarefaDoDia) => void; podeEditar: boolean }) {
  const feita = t.situacao === 'feita';
  return (
    <button
      aria-label={feita ? 'Reabrir' : 'Concluir'}
      title={feita ? 'Reabrir' : 'Concluir'}
      disabled={!podeEditar}
      onClick={(e) => { e.stopPropagation(); alternar(t); }}
      className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px] ${feita ? 'border-brand bg-brand' : 'border-border-strong bg-surface hover:border-brand'}`}
    />
  );
}

function Meta({ t, mostrarArea, mostrarPessoa }: { t: TarefaDoDia; mostrarArea: boolean; mostrarPessoa: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
      {mostrarArea && <span>{t.area?.nome ?? 'sem área'}</span>}
      {t.cliente && (
        <span
          role="link"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); abrirFicha(t.cliente!.id); }}
          className="cursor-pointer rounded-full border border-border px-2 py-0.5 hover:border-brand hover:text-brand"
        >
          {t.cliente.titulo}
        </span>
      )}
      {mostrarPessoa && <span>{t.pessoa ? primeiro(t.pessoa.nome) : t.responsavelTexto ?? 'sem responsável'}</span>}
      {t.prazo && <span className={`com-num ${t.situacao === 'atrasada' ? 'font-semibold text-bad' : ''}`}>{dd(t.prazo)}</span>}
    </div>
  );
}

// ---------------- Quadro ----------------

interface Coluna { chave: string; nome: string; itens: TarefaDoDia[] }

function QuadroDeTarefas(props: {
  p: PainelDeTarefas; tarefas: TarefaDoDia[]; agrupar: Agrupar; podeEditar: boolean;
  trocarAgrupar: (g: Agrupar) => void; abrir: (id: string) => void; alternar: (t: TarefaDoDia) => void;
  editar: (t: TarefaDoDia, m: Record<string, unknown>) => void; criado: () => void; token: string | null;
  /** Id da área quando o quadro é a aba de uma área: some a coluna por área e a tarefa nova nasce nela. */
  areaFixa?: string;
}) {
  const { p, tarefas, agrupar, areaFixa } = props;
  const ref = useRef<HTMLDivElement>(null);
  const altura = useAlturaAteOFim(ref);
  const [arrastando, setArrastando] = useState<TarefaDoDia | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [novoEm, setNovoEm] = useState<string | null>(null);

  const colunas: Coluna[] = agrupar === 'pessoa'
    ? [
      ...p.pessoas.map((pe) => ({ chave: pe.id, nome: pe.nome, itens: tarefas.filter((t) => t.pessoa?.id === pe.id) })),
      { chave: SEM, nome: 'Sem responsável', itens: tarefas.filter((t) => !t.pessoa) },
    ]
    : agrupar === 'area'
      ? [
        ...p.areas.map((a) => ({ chave: a.id, nome: a.nome, itens: tarefas.filter((t) => t.area?.id === a.id) })),
        { chave: SEM, nome: 'Sem área', itens: tarefas.filter((t) => !t.area) },
      ]
      : ABERTAS.map((s) => ({ chave: s, nome: NOME_DA_SITUACAO[s], itens: tarefas.filter((t) => t.situacao === s) }));
  const visiveis = colunas.filter((c) => c.chave !== SEM || c.itens.length > 0);

  const soltar = (chave: string) => {
    const t = arrastando;
    setArrastando(null); setSobre(null);
    if (!t || agrupar === 'situacao') return;
    if (agrupar === 'pessoa' && (t.pessoa?.id ?? SEM) !== chave) props.editar(t, { pessoaId: chave === SEM ? null : chave });
    if (agrupar === 'area' && (t.area?.id ?? SEM) !== chave && chave !== SEM) props.editar(t, { areaId: chave });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Colunas por</span>
        {(['pessoa', 'area', 'situacao'] as Agrupar[]).filter((g) => !areaFixa || g !== 'area').map((g) => (
          <button
            key={g}
            onClick={() => props.trocarAgrupar(g)}
            className={`rounded-full border px-3 py-1 ${agrupar === g ? 'border-brand text-text' : 'border-border text-muted hover:text-text'}`}
          >
            {g === 'pessoa' ? 'Pessoa' : g === 'area' ? 'Área' : 'Prazo'}
          </button>
        ))}
      </div>
      <div ref={ref} className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2" style={{ height: altura ?? undefined }}>
        {visiveis.map((c) => {
          const atrasadas = c.itens.filter((t) => t.situacao === 'atrasada').length;
          return (
            <section
              key={c.chave}
              onDragOver={(e) => { if (arrastando && agrupar !== 'situacao') { e.preventDefault(); setSobre(c.chave); } }}
              onDragLeave={() => setSobre((s) => (s === c.chave ? null : s))}
              onDrop={() => soltar(c.chave)}
              className={`flex h-full w-64 shrink-0 flex-col rounded-md border bg-surface ${sobre === c.chave ? 'border-brand' : 'border-border'}`}
            >
              <div className={`shrink-0 border-b border-t-[3px] border-b-border px-3 py-2.5 ${c.chave === 'atrasada' ? 'border-t-bad' : 'border-t-brand'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{c.nome}</span>
                  <span className="com-num text-sm text-muted">{c.itens.length}</span>
                </div>
                <div className="text-xs text-muted">{atrasadas ? <span className="font-semibold text-bad">{atrasadas} atrasadas</span> : 'nada atrasado'}</div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {props.podeEditar && agrupar !== 'situacao' && (novoEm === c.chave ? (
                  <CriarRapido
                    p={p} token={props.token}
                    base={agrupar === 'pessoa' ? { pessoaId: c.chave === SEM ? null : c.chave, areaId: areaFixa } : { areaId: c.chave === SEM ? undefined : c.chave }}
                    fechar={() => setNovoEm(null)} criado={() => { setNovoEm(null); props.criado(); }} abrir={props.abrir}
                  />
                ) : (
                  <button onClick={() => setNovoEm(c.chave)} className="rounded-md px-2 py-1 text-left text-sm text-muted hover:bg-surface-2 hover:text-brand">
                    + Adicionar tarefa
                  </button>
                ))}
                {c.itens.map((t) => (
                  <div
                    key={t.id}
                    draggable={props.podeEditar && agrupar !== 'situacao'}
                    onDragStart={() => setArrastando(t)}
                    onDragEnd={() => { setArrastando(null); setSobre(null); }}
                    onClick={() => props.abrir(t.id)}
                    className={`flex shrink-0 cursor-pointer gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 hover:border-brand/60 ${arrastando?.id === t.id ? 'opacity-40' : ''}`}
                  >
                    <Bolinha t={t} alternar={props.alternar} podeEditar={props.podeEditar} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium leading-snug">{t.titulo}</div>
                      <Meta t={t} mostrarArea={agrupar !== 'area' && !areaFixa} mostrarPessoa={agrupar !== 'pessoa'} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- Lista ----------------

type Coluninha = 'titulo' | 'area' | 'cliente' | 'pessoa' | 'prazo';
function ListaDeTarefas({ tarefas, abrir, alternar, podeEditar, mostrarArea = true }: {
  tarefas: TarefaDoDia[]; abrir: (id: string) => void; alternar: (t: TarefaDoDia) => void; podeEditar: boolean; mostrarArea?: boolean;
}) {
  const [por, setPor] = useState<Coluninha>('prazo');
  const chave: Record<Coluninha, (t: TarefaDoDia) => string> = {
    titulo: (t) => t.titulo, area: (t) => t.area?.nome ?? '~', cliente: (t) => t.cliente?.titulo ?? '~',
    pessoa: (t) => t.pessoa?.nome ?? '~', prazo: (t) => t.prazo ?? '9999',
  };
  const linhas = [...tarefas].sort((a, b) => chave[por](a).localeCompare(chave[por](b), 'pt') || ordem(a, b));
  const th = (k: Coluninha, n: string) => (
    <th className="com-rotulo pb-2 pr-3 font-normal">
      <button onClick={() => setPor(k)} className={`hover:text-text ${por === k ? 'text-text' : ''}`}>{n}{por === k ? ' ↓' : ''}</button>
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface px-4 py-3">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="text-left">
            <th className="w-6 pb-2" />
            {th('titulo', 'Tarefa')}{mostrarArea && th('area', 'Área')}{th('cliente', 'Cliente')}{th('pessoa', 'Responsável')}{th('prazo', 'Prazo')}
            <th className="com-rotulo pb-2 font-normal">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linhas.map((t) => (
            <tr key={t.id} onClick={() => abrir(t.id)} className="cursor-pointer hover:bg-surface-2">
              <td className="py-2 pr-2"><Bolinha t={t} alternar={alternar} podeEditar={podeEditar} /></td>
              <td className={`py-2 pr-3 font-medium ${t.situacao === 'feita' ? 'text-muted line-through' : ''}`}>{t.titulo}</td>
              {mostrarArea && <td className="py-2 pr-3 text-muted">{t.area?.nome ?? 'sem área'}</td>}
              <td className="py-2 pr-3 text-muted">{t.cliente?.titulo ?? '—'}</td>
              <td className="py-2 pr-3 text-muted">{t.pessoa?.nome ?? t.responsavelTexto ?? '—'}</td>
              <td className={`com-num py-2 pr-3 ${t.situacao === 'atrasada' ? 'font-semibold text-bad' : 'text-muted'}`}>{dd(t.prazo) || '—'}</td>
              <td className="py-2 text-muted">{t.status.nome}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {linhas.length === 0 && <p className="py-3 text-muted">Nada com esses filtros.</p>}
    </div>
  );
}

// ---------------- Calendário ----------------

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** Soma dias a um AAAA-MM-DD sem passar pelo fuso local (o dia não escorrega). */
const somaDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * As tarefas no dia do prazo, mês a mês (o mesmo molde do calendário do Funil).
 * Arrastar para outro dia muda o prazo; as sem prazo ficam numa faixa embaixo e
 * também podem ser arrastadas para um dia. A tarefa continua uma só.
 */
function CalendarioDeTarefas({ tarefas, hoje, podeEditar, abrir, mudarPrazo }: {
  tarefas: TarefaDoDia[]; hoje: string; podeEditar: boolean;
  abrir: (id: string) => void; mudarPrazo: (t: TarefaDoDia, prazo: string) => void;
}) {
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [arrastando, setArrastando] = useState<TarefaDoDia | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [ano, m] = mes.split('-').map(Number);
  const primeiroDia = `${mes}-01`;
  const diaDaSemana = new Date(`${primeiroDia}T12:00:00Z`).getUTCDay();
  const inicio = somaDias(primeiroDia, -((diaDaSemana + 6) % 7)); // a grade começa na segunda
  const dias = Array.from({ length: 42 }, (_, i) => somaDias(inicio, i));
  const porDia = new Map<string, TarefaDoDia[]>();
  for (const t of tarefas) if (t.prazo) porDia.set(t.prazo, [...(porDia.get(t.prazo) ?? []), t]);
  const semPrazo = tarefas.filter((t) => !t.prazo);
  const irMes = (n: number) => {
    const d = new Date(Date.UTC(ano, m - 1 + n, 1));
    setMes(d.toISOString().slice(0, 7));
  };
  const soltar = (dia: string) => {
    const t = arrastando;
    setArrastando(null);
    setSobre(null);
    if (t && t.prazo !== dia) mudarPrazo(t, dia);
  };
  const botao = 'rounded-md border border-border px-2.5 py-1 text-sm hover:border-brand';
  const arrastavel = (t: TarefaDoDia) => ({
    draggable: podeEditar,
    onDragStart: () => setArrastando(t),
    onDragEnd: () => { setArrastando(null); setSobre(null); },
    onClick: () => abrir(t.id),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => irMes(-1)} className={botao} aria-label="Mês anterior">‹</button>
          <button onClick={() => setMes(hoje.slice(0, 7))} className={botao}>hoje</button>
          <button onClick={() => irMes(1)} className={botao} aria-label="Próximo mês">›</button>
        </div>
        <span className="text-[1.05rem] font-semibold">{MESES[m - 1]} {ano}</span>
        {podeEditar && <span className="ml-auto text-sm text-muted">arraste uma tarefa para mudar o prazo</span>}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-md border border-border bg-surface">
        {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => (
          <div key={d} className="com-rotulo border-b border-border px-2 py-1.5">{d}</div>
        ))}
        {dias.map((dia) => {
          const doDia = porDia.get(dia) ?? [];
          const foraDoMes = dia.slice(0, 7) !== mes;
          return (
            <div
              key={dia}
              onDragOver={(e) => { if (arrastando) { e.preventDefault(); setSobre(dia); } }}
              onDragLeave={() => setSobre((x) => (x === dia ? null : x))}
              onDrop={() => soltar(dia)}
              className={`min-h-[6.5rem] border-b border-r border-border p-1.5 ${foraDoMes ? 'bg-surface-2/40' : ''} ${sobre === dia ? 'bg-brand/10' : ''}`}
            >
              <span className={`com-num text-xs ${dia === hoje ? 'rounded-full bg-brand px-1.5 text-ink' : foraDoMes ? 'text-muted/60' : 'text-muted'}`}>
                {Number(dia.slice(8))}
              </span>
              <div className="mt-1 max-h-28 space-y-1 overflow-y-auto">
                {doDia.map((t) => (
                  <div
                    key={t.id}
                    {...arrastavel(t)}
                    title={[t.titulo, t.pessoa ? primeiro(t.pessoa.nome) : null, t.area?.nome].filter(Boolean).join(' · ')}
                    className={`cursor-pointer truncate rounded border-l-2 bg-surface-2 px-1.5 py-0.5 text-xs hover:bg-brand/15 ${t.situacao === 'atrasada' ? 'border-bad text-bad' : t.situacao === 'feita' ? 'border-border text-muted line-through' : 'border-brand'}`}
                  >
                    {t.titulo}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {semPrazo.length > 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-3">
          <div className="com-rotulo mb-2">Sem prazo · {semPrazo.length}{podeEditar ? ' · arraste para um dia' : ''}</div>
          <div className="flex flex-wrap gap-2">
            {semPrazo.map((t) => (
              <div key={t.id} {...arrastavel(t)} className="cursor-pointer rounded-md border border-border bg-surface-2 px-2.5 py-1 text-sm hover:border-brand/60">
                {t.titulo}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Criar (no quadro e na janela) ----------------

type Aviso = Extract<ResultadoDeCriar, { criada: false }>['aviso'];

function AvisoDeCriar({ aviso, criarAssim, abrir, cancelar }: { aviso: Aviso; criarAssim: () => void; abrir: (id: string) => void; cancelar: () => void }) {
  const botao = 'rounded-md border border-border bg-surface px-2.5 py-1 text-xs hover:border-brand';
  return (
    <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
      {aviso.tipo === 'nao_parece_tarefa' ? (
        <>
          <b className="block">Isso não parece tarefa.</b>
          <span className="text-muted">{aviso.motivo} Casa dele: {aviso.casa}.</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button className={botao} onClick={criarAssim}>É tarefa, criar</button>
            <button className={botao} onClick={cancelar}>Cancelar</button>
          </div>
        </>
      ) : (
        <>
          <b className="block">{aviso.tipo === 'igual' ? 'Essa tarefa já existe.' : 'Já existe uma parecida.'}</b>
          <span className="text-muted">“{aviso.tarefa.titulo}”{aviso.tarefa.area ? ` · ${aviso.tarefa.area.nome}` : ''}{aviso.tarefa.pessoa ? ` · ${primeiro(aviso.tarefa.pessoa.nome)}` : ''}</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button className="rounded-md border border-brand bg-brand px-2.5 py-1 text-xs font-medium text-ink hover:opacity-90" onClick={() => abrir(aviso.tarefa.id)}>Abrir essa</button>
            {aviso.tipo === 'parecida' && <button className={botao} onClick={criarAssim}>É outra, criar</button>}
            <button className={botao} onClick={cancelar}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}

async function pedirCriacao(token: string | null, corpo: Record<string, unknown>) {
  return apiPost<ResultadoDeCriar>('/trabalho/todas', corpo, token);
}

function CriarRapido({ p, token, base, fechar, criado, abrir }: {
  p: PainelDeTarefas; token: string | null; base: { pessoaId?: string | null; areaId?: string };
  fechar: () => void; criado: () => void; abrir: (id: string) => void;
}) {
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const areaId = base.areaId ?? p.areas[0]?.id;
  const enviar = async (confirmar = false) => {
    if (!texto.trim() || !areaId) return;
    setErro(null);
    try {
      const r = await pedirCriacao(token, { titulo: texto.trim(), areaId, pessoaId: base.pessoaId ?? null, confirmar });
      if (r.criada) { setTexto(''); criado(); } else setAviso(r.aviso);
    } catch (e) { setErro((e as Error).message); }
  };
  return (
    <div className="space-y-1.5">
      <input
        autoFocus
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setAviso(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') enviar(); if (e.key === 'Escape') fechar(); }}
        placeholder="O que precisa ser feito? Enter cria"
        className="w-full rounded-md border border-brand bg-surface-2 px-2.5 py-1.5 text-sm outline-none"
      />
      {!base.areaId && <p className="text-[0.7rem] text-muted">entra em {p.areas[0]?.nome}; troque na tarefa</p>}
      {aviso && <AvisoDeCriar aviso={aviso} criarAssim={() => enviar(true)} abrir={abrir} cancelar={() => { setAviso(null); fechar(); }} />}
      {erro && <p className="text-xs text-bad">{erro}</p>}
    </div>
  );
}

// ---------------- Janelas ----------------

function Janela({ titulo, fechar, children }: { titulo: string; fechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = antes; window.removeEventListener('keydown', esc); };
  }, [fechar]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3 min-[820px]:p-8" onClick={fechar}>
      <div
        role="dialog" aria-modal="true" aria-label={titulo}
        className="relative max-h-full w-full max-w-[720px] overflow-y-auto rounded-lg border border-border bg-bg p-5 shadow-2xl min-[820px]:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={fechar} aria-label="Fechar" className="absolute right-3 top-3 rounded-md px-2 py-0.5 text-xl leading-none text-muted hover:bg-surface-2 hover:text-text">×</button>
        {children}
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="com-rotulo mb-1 block">{rotulo}</span>
      {children}
    </label>
  );
}
const ENTRADA = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-60';

function JanelaDaTarefa({ t, p, podeEditar, fechar, alternar, editar, criarArea }: {
  t: TarefaDoDia; p: PainelDeTarefas; podeEditar: boolean; fechar: () => void; alternar: () => void;
  editar: (m: Record<string, unknown>) => void; criarArea: () => Promise<AreaDeTarefa | null>;
}) {
  const [titulo, setTitulo] = useState(t.titulo);
  useEffect(() => setTitulo(t.titulo), [t.titulo]);
  const feita = t.situacao === 'feita';
  return (
    <Janela titulo={t.titulo} fechar={fechar}>
      <div className="flex items-start gap-3 pr-8">
        <button
          aria-label={feita ? 'Reabrir' : 'Concluir'} disabled={!podeEditar} onClick={alternar}
          className={`mt-2 h-5 w-5 shrink-0 rounded-full border-2 ${feita ? 'border-brand bg-brand' : 'border-border-strong hover:border-brand'}`}
        />
        <input
          value={titulo} disabled={!podeEditar}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={() => { if (titulo.trim() && titulo.trim() !== t.titulo) editar({ titulo: titulo.trim() }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[1.3rem] font-semibold outline-none hover:border-border focus:border-brand"
        />
      </div>
      <div className="mt-1 pl-9 text-sm text-muted">
        {feita ? 'Feita' : NOME_DA_SITUACAO[t.situacao]} · {t.status.nome}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Área">
          <select
            disabled={!podeEditar} value={t.area?.id ?? ''} className={ENTRADA}
            onChange={async (e) => {
              if (e.target.value === '__nova') { const a = await criarArea(); if (a) editar({ areaId: a.id }); return; }
              editar({ areaId: e.target.value || null });
            }}
          >
            {!t.area && <option value="">— sem área —</option>}
            {p.areas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            <option value="__nova">+ adicionar nova área…</option>
          </select>
        </Campo>
        <Campo rotulo="Responsável">
          <select disabled={!podeEditar} value={t.pessoa?.id ?? ''} className={ENTRADA} onChange={(e) => editar({ pessoaId: e.target.value || null })}>
            <option value="">{t.responsavelTexto ? `${t.responsavelTexto} (sem conta)` : '— ninguém —'}</option>
            {p.pessoas.map((pe) => <option key={pe.id} value={pe.id}>{pe.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Prazo">
          <input type="date" disabled={!podeEditar} value={t.prazo ?? ''} className={ENTRADA} onChange={(e) => editar({ prazo: e.target.value || null })} />
        </Campo>
        <Campo rotulo="Cliente">
          <select disabled={!podeEditar} value={t.cliente?.id ?? ''} className={ENTRADA} onChange={(e) => editar({ clienteId: e.target.value || null })}>
            <option value="">— nenhum —</option>
            {p.clientes.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
          </select>
        </Campo>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
        <span className="flex flex-wrap gap-3 text-muted">
          <Link href={`/trabalho?lista=${t.lista.id}&tarefa=${t.id}`} className="hover:text-brand">descrição, comentários e subtarefas →</Link>
          {t.cliente && <button onClick={() => abrirFicha(t.cliente!.id)} className="hover:text-brand">ficha de {t.cliente.titulo} →</button>}
          {t.externalUrl && <a href={t.externalUrl} target="_blank" rel="noopener noreferrer" className="hover:text-brand">no ClickUp ↗</a>}
        </span>
        {podeEditar && (
          <button onClick={alternar} className="rounded-md bg-brand px-4 py-2 font-medium text-ink hover:opacity-90">
            {feita ? 'Reabrir' : 'Concluir'}
          </button>
        )}
      </div>
    </Janela>
  );
}

function NovaTarefa({ p, token, filtro, criarArea, fechar, criada, abrir }: {
  p: PainelDeTarefas; token: string | null; filtro: Filtro; criarArea: () => Promise<AreaDeTarefa | null>;
  fechar: () => void; criada: (id: string) => void; abrir: (id: string) => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [areaId, setAreaId] = useState(filtro.area && filtro.area !== SEM ? filtro.area : '');
  const [pessoaId, setPessoaId] = useState(filtro.pessoa && filtro.pessoa !== SEM ? filtro.pessoa : '');
  const [prazo, setPrazo] = useState('');
  const [clienteId, setClienteId] = useState(filtro.cliente ?? '');
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [areas, setAreas] = useState(p.areas);

  const enviar = async (confirmar = false) => {
    if (!titulo.trim()) return setErro('Escreva o que precisa ser feito.');
    if (!areaId) return setErro('Escolha a área.');
    try {
      const r = await pedirCriacao(token, {
        titulo: titulo.trim(), areaId, pessoaId: pessoaId || null, prazo: prazo || null, clienteId: clienteId || null, confirmar,
      });
      if (r.criada) criada(r.tarefa.id); else setAviso(r.aviso);
    } catch (e) { setErro((e as Error).message); }
  };

  return (
    <Janela titulo="Nova tarefa" fechar={fechar}>
      <div className="com-rotulo">Nova tarefa</div>
      <input
        autoFocus value={titulo}
        onChange={(e) => { setTitulo(e.target.value); setAviso(null); setErro(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') enviar(); }}
        placeholder="O que precisa ser feito?"
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-[1.15rem] font-medium outline-none focus:border-brand"
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Área">
          <select
            value={areaId} className={ENTRADA}
            onChange={async (e) => {
              if (e.target.value === '__nova') { const a = await criarArea(); if (a) { setAreas((x) => [...x, a]); setAreaId(a.id); } return; }
              setAreaId(e.target.value);
            }}
          >
            <option value="">— escolha —</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            <option value="__nova">+ adicionar nova área…</option>
          </select>
        </Campo>
        <Campo rotulo="Responsável">
          <select value={pessoaId} className={ENTRADA} onChange={(e) => setPessoaId(e.target.value)}>
            <option value="">— ninguém —</option>
            {p.pessoas.map((pe) => <option key={pe.id} value={pe.id}>{pe.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Prazo"><input type="date" value={prazo} className={ENTRADA} onChange={(e) => setPrazo(e.target.value)} /></Campo>
        <Campo rotulo="Cliente">
          <select value={clienteId} className={ENTRADA} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">— nenhum —</option>
            {p.clientes.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
          </select>
        </Campo>
      </div>
      {aviso && <div className="mt-4"><AvisoDeCriar aviso={aviso} criarAssim={() => enviar(true)} abrir={abrir} cancelar={() => setAviso(null)} /></div>}
      {erro && <p className="mt-3 text-sm text-bad">{erro}</p>}
      <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
        <button onClick={fechar} className="rounded-md border border-border px-4 py-2 text-sm hover:border-brand">Cancelar</button>
        <button onClick={() => enviar()} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90">Criar tarefa</button>
      </div>
    </Janela>
  );
}
