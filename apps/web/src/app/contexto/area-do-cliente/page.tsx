'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErroDaApi, apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * ============================================================================
 * ÁREA DO CLIENTE — o mapa da construção do portal do cliente dentro da Sala
 * ============================================================================
 *
 * Desenho de 30/10/2026 sobre o Fluxo do cliente v6: os quatro blocos que o
 * cliente vê, os 15 itens do painel com a fonte no OS e a tarefa do fluxo que
 * alimenta cada um, o motor que serve a todos, as levas (o backlog em ordem) e
 * as decisões abertas. Tela da ROOT, como o Fluxo: a API recusa qualquer outra
 * sessão com 403 e esta tela explica em vez de quebrar. Só leitura. A fonte é
 * um arquivo só, `apps/api/src/platform/area-do-cliente.json`; nova versão do
 * desenho = trocar o arquivo.
 *
 * É o mapa da CONSTRUÇÃO, não o estado da área de um cliente. O estado por
 * cliente é a aba "Área do cliente" do painel do lead (leva A, M4).
 */

const CAMINHO = '/tenants/plataforma/operacao/area-do-cliente';
const FLUXO = '/contexto/fluxo-do-cliente';

type EstadoDaConstrucao = 'backlog' | 'em_construcao' | 'no_ar';
type Bloco = { id: string; ordem: number; nome: string; para_o_cliente: string };
type EstadoDoItem = { id: string; rotulo: string; quem_ve: string; descricao: string };
type Item = {
  id: string;
  numero: string;
  item: string;
  bloco: string;
  tarefa_do_fluxo: string | null;
  entra_na_fase: string;
  como_chega: string;
  fonte_no_os: { hoje: string; codigo: string[] };
  o_que_o_cliente_ve: string;
  feito_quando: string;
  leva: string;
  estado: EstadoDaConstrucao;
  depende_de?: string[];
  em_aberto?: string[];
};
type Motor = {
  id: string;
  nome: string;
  o_que_e: string;
  onde: string[];
  feito_quando: string;
  leva: string;
  estado: EstadoDaConstrucao;
  em_aberto?: string[];
};
type Leva = { id: string; nome: string; quando: string; entrega: string; itens: string[]; prova: string };
type Decisao = { id: string; pergunta: string; recomendacao: string; trava: string[] };
type Area = {
  nome: string;
  versao: string;
  data: string;
  fonte: string;
  onde_mora: string;
  regra_de_ouro: string;
  blocos: Bloco[];
  estados_da_construcao: Record<EstadoDaConstrucao, string>;
  estados_do_item_para_o_cliente: EstadoDoItem[];
  itens: Item[];
  motor: Motor[];
  levas: Leva[];
  decisoes_abertas: Decisao[];
};

const ROTULO = 'font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted';
const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
const CHIP = 'rounded-full border px-3 py-1 text-[12px]';
const ROTULO_DO_ESTADO: Record<EstadoDaConstrucao, string> = { backlog: 'backlog', em_construcao: 'em construção', no_ar: 'no ar' };
/** A cor nunca anda sozinha: o estado vai sempre com a palavra. OK é ciano, atenção é âmbar, neutro é cinza. */
const COR_DO_ESTADO: Record<EstadoDaConstrucao, string> = {
  backlog: 'border-border text-muted',
  em_construcao: 'border-warn/60 text-warn',
  no_ar: 'border-good/60 text-good',
};
const FASE: Record<string, string> = {
  'fase-1': 'Fechamento',
  'fase-2': 'Abertura',
  'fase-3': 'Primeira semana',
  'fase-4': 'Construção',
  'fase-5': 'Acompanhamento',
  'fase-6': 'Satisfação',
  'fase-7': 'Continuidade ou fim',
};
const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const dataBr = (iso: string) => iso.split('-').reverse().join('/');

function irPara(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function AreaDoClientePage() {
  const { token, ready } = useAuth();
  const [area, setArea] = useState<Area | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [leva, setLeva] = useState('');
  const [estado, setEstado] = useState<EstadoDaConstrucao | ''>('');
  const [bloco, setBloco] = useState('');
  const [busca, setBusca] = useState('');
  const [soEmAberto, setSoEmAberto] = useState(false);

  const carregar = useCallback(async () => {
    if (!token) return;
    setErro(null);
    try {
      setArea(await apiGet<Area>(CAMINHO, token));
      setAutorizado(true);
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 403) setAutorizado(false);
      else setErro((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  const itens = useMemo(() => area?.itens ?? [], [area]);
  const motor = useMemo(() => area?.motor ?? [], [area]);
  const nomePorId = useMemo(
    () => new Map<string, string>([...itens.map((i) => [i.id, i.item] as const), ...motor.map((m) => [m.id, m.nome] as const)]),
    [itens, motor],
  );
  const filtrando = !!leva || !!estado || !!bloco || !!busca.trim() || soEmAberto;
  const passaItem = useCallback(
    (i: Item) => {
      if (leva && i.leva !== leva) return false;
      if (estado && i.estado !== estado) return false;
      if (bloco && i.bloco !== bloco) return false;
      if (soEmAberto && !i.em_aberto?.length) return false;
      const b = semAcento(busca.trim());
      if (b && !semAcento(`${i.numero} ${i.item} ${i.fonte_no_os.hoje} ${i.o_que_o_cliente_ve} ${i.feito_quando} ${i.tarefa_do_fluxo ?? ''}`).includes(b)) return false;
      return true;
    },
    [leva, estado, bloco, soEmAberto, busca],
  );
  const passaMotor = useCallback(
    (m: Motor) => {
      if (leva && m.leva !== leva) return false;
      if (estado && m.estado !== estado) return false;
      if (bloco) return false;
      if (soEmAberto && !m.em_aberto?.length) return false;
      const b = semAcento(busca.trim());
      if (b && !semAcento(`${m.nome} ${m.o_que_e} ${m.feito_quando}`).includes(b)) return false;
      return true;
    },
    [leva, estado, bloco, soEmAberto, busca],
  );
  const visiveis = itens.filter(passaItem).length + motor.filter(passaMotor).length;
  const total = itens.length + motor.length;
  const contaPorEstado = useMemo(() => {
    const c: Record<EstadoDaConstrucao, number> = { backlog: 0, em_construcao: 0, no_ar: 0 };
    for (const x of [...itens, ...motor]) c[x.estado] += 1;
    return c;
  }, [itens, motor]);
  const emAberto = [...itens, ...motor].filter((x) => x.em_aberto?.length).length;

  if (!ready || (autorizado === null && !erro)) return <p className="text-[12.5px] text-muted">carregando…</p>;

  if (autorizado === false) {
    return (
      <div className="rounded border border-border bg-surface p-4">
        <p className="text-[13px] text-text">Esta área é da ROOT.</p>
        <p className="mt-1 text-[12px] leading-[1.6] text-muted">O desenho da área do cliente é visto pela sessão de quem opera a plataforma.</p>
      </div>
    );
  }

  if (erro || !area) {
    return (
      <div className="rounded border border-bad/40 bg-bad/10 p-4 text-[12.5px] text-bad">
        {erro ?? 'Não deu para ler o desenho da área do cliente.'}{' '}
        <button type="button" onClick={() => void carregar()} className={`underline ${FOCO}`}>tentar de novo</button>
      </div>
    );
  }

  const Estado = ({ e }: { e: EstadoDaConstrucao }) => (
    <span className={`rounded border px-1.5 py-0.5 font-os-mono text-[10px] uppercase tracking-[0.08em] ${COR_DO_ESTADO[e]}`}>{ROTULO_DO_ESTADO[e]}</span>
  );
  const LevaPill = ({ l }: { l: string }) => (
    <span className="rounded border border-border px-1.5 py-0.5 font-os-mono text-[10px] uppercase tracking-[0.08em] text-muted">leva {l}</span>
  );
  /** "09 · Definir o cronograma" leva ao cartão da tarefa no Fluxo do cliente. */
  const Tarefa = ({ numero }: { numero: string | null }) =>
    numero ? (
      <a href={`${FLUXO}#t-${numero}`} className={`font-os-mono text-[11px] text-brand underline-offset-2 hover:underline ${FOCO}`}>
        tarefa {numero}
      </a>
    ) : (
      <span className="font-os-mono text-[11px] text-warn">sem tarefa no fluxo</span>
    );
  const Ref = ({ id }: { id: string }) => (
    <button type="button" onClick={() => irPara(`i-${id}`)} className={`text-left text-text underline decoration-border underline-offset-2 hover:text-brand ${FOCO}`}>
      {nomePorId.get(id) ?? id}
    </button>
  );
  const EmAberto = ({ texto }: { texto: string }) => (
    <div className="rounded border border-warn/50 bg-warn/5 px-3 py-2">
      <p className={`${ROTULO} text-warn`}>Em aberto</p>
      <p className="mt-1 text-[12px] leading-[1.55] text-text">{texto}</p>
    </div>
  );
  const apagado = (passa: boolean) => (filtrando && !passa ? 'opacity-30' : filtrando ? 'border-brand' : '');

  const CartaoDoItem = ({ i }: { i: Item }) => (
    <article id={`i-${i.id}`} className={`scroll-mt-24 rounded border border-border bg-surface p-4 transition-opacity ${apagado(passaItem(i))}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-os-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand">{i.numero} · {area.blocos.find((b) => b.id === i.bloco)?.nome}</p>
        <Estado e={i.estado} />
        <LevaPill l={i.leva} />
      </div>
      <h3 className="mt-1 text-[14.5px] font-semibold leading-[1.35] text-text">{i.item}</h3>
      <dl className="mt-2 grid gap-x-5 gap-y-2 text-[12.5px] leading-[1.55] md:grid-cols-2">
        <div>
          <dt className={ROTULO}>O cliente vê</dt>
          <dd className="mt-0.5 text-text">{i.o_que_o_cliente_ve}</dd>
        </div>
        <div>
          <dt className={ROTULO}>Feito quando</dt>
          <dd className="mt-0.5 text-muted">{i.feito_quando}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className={ROTULO}>Fonte no OS · {i.como_chega} · entra na {FASE[i.entra_na_fase] ?? i.entra_na_fase} · <Tarefa numero={i.tarefa_do_fluxo} /></dt>
          <dd className="mt-0.5 text-muted">{i.fonte_no_os.hoje}</dd>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {i.fonte_no_os.codigo.map((c) => (
              <code key={c} className="rounded border border-border bg-bg px-1.5 py-0.5 font-os-mono text-[10.5px] text-dim">{c}</code>
            ))}
          </dd>
        </div>
        {!!i.depende_de?.length && (
          <div className="md:col-span-2">
            <dt className={ROTULO}>Depende de</dt>
            <dd className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
              {i.depende_de.map((d) => <Ref key={d} id={d} />)}
            </dd>
          </div>
        )}
      </dl>
      {!!i.em_aberto?.length && <div className="mt-3 space-y-2">{i.em_aberto.map((a) => <EmAberto key={a} texto={a} />)}</div>}
    </article>
  );

  const CartaoDoMotor = ({ m }: { m: Motor }) => (
    <article id={`i-${m.id}`} className={`scroll-mt-24 rounded border border-border bg-surface p-4 transition-opacity ${apagado(passaMotor(m))}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-os-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand">{m.id.split('-')[0]} · motor</p>
        <Estado e={m.estado} />
        <LevaPill l={m.leva} />
      </div>
      <h3 className="mt-1 text-[14.5px] font-semibold leading-[1.35] text-text">{m.nome}</h3>
      <p className="mt-1.5 text-[12.5px] leading-[1.55] text-text">{m.o_que_e}</p>
      <p className="mt-1.5 text-[12.5px] leading-[1.55] text-muted"><span className="text-text">Feito quando:</span> {m.feito_quando}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {m.onde.map((c) => (
          <code key={c} className="rounded border border-border bg-bg px-1.5 py-0.5 font-os-mono text-[10.5px] text-dim">{c}</code>
        ))}
      </div>
      {!!m.em_aberto?.length && <div className="mt-3 space-y-2">{m.em_aberto.map((a) => <EmAberto key={a} texto={a} />)}</div>}
    </article>
  );

  const blocos = [...area.blocos].sort((a, b) => a.ordem - b.ordem);

  return (
    <div className="mx-auto max-w-[1080px] space-y-6 pb-16">
      <header className="space-y-2">
        <p className="max-w-[720px] text-[13px] leading-[1.6] text-text">{area.onde_mora}</p>
        <p className="max-w-[720px] text-[12.5px] leading-[1.6] text-muted">{area.regra_de_ouro}</p>
        <p className="font-os-mono text-[10.5px] text-muted">
          {area.versao} · {dataBr(area.data)} · {itens.length} itens · {blocos.length} blocos · {motor.length} peças do motor · {area.levas.length} levas · {area.decisoes_abertas.length} decisões abertas
        </p>
      </header>

      <div className="space-y-3 rounded border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${ROTULO} mr-1`}>Leva</span>
          <button type="button" onClick={() => setLeva('')} className={`${CHIP} ${FOCO} ${!leva ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand'}`}>Todas</button>
          {area.levas.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLeva(leva === l.id ? '' : l.id)}
              aria-pressed={leva === l.id}
              title={l.nome}
              className={`${CHIP} ${FOCO} ${leva === l.id ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand'}`}
            >
              <b className="font-os-mono">{l.id}</b> {l.nome}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${ROTULO} mr-1`}>Estado</span>
          {(Object.keys(ROTULO_DO_ESTADO) as EstadoDaConstrucao[]).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEstado(estado === e ? '' : e)}
              aria-pressed={estado === e}
              className={`${CHIP} ${FOCO} ${estado === e ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand'}`}
            >
              {ROTULO_DO_ESTADO[e]} <b className="font-os-mono tabular-nums">{contaPorEstado[e]}</b>
            </button>
          ))}
          <span className={`${ROTULO} ml-3 mr-1`}>Bloco</span>
          {blocos.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBloco(bloco === b.id ? '' : b.id)}
              aria-pressed={bloco === b.id}
              className={`${CHIP} ${FOCO} ${bloco === b.id ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand'}`}
            >
              {b.nome}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar item (ex.: cofre, ata, Frota)"
            aria-label="Buscar item"
            className={`min-w-[220px] flex-1 rounded border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-brand ${FOCO}`}
          />
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" checked={soEmAberto} onChange={(e) => setSoEmAberto(e.target.checked)} className="accent-brand" />
            Só o que está em aberto ({emAberto})
          </label>
          {filtrando && (
            <span className="text-[12px] text-muted">
              <b className="font-os-mono text-text">{visiveis}</b> de {total}
              {' · '}
              <button type="button" onClick={() => { setLeva(''); setEstado(''); setBloco(''); setBusca(''); setSoEmAberto(false); }} className={`underline ${FOCO}`}>limpar</button>
            </span>
          )}
        </div>
        <nav aria-label="Seções" className="flex flex-wrap gap-1.5 border-t border-border pt-3">
          {[
            ['o-que-o-cliente-ve', 'O que o cliente vê'],
            ['itens', 'Item a item'],
            ['motor', 'Motor'],
            ['levas', 'Levas (backlog)'],
            ['decisoes', 'Decisões abertas'],
            ['estados', 'Estados de um item'],
          ].map(([id, nome]) => (
            <button key={id} type="button" onClick={() => irPara(id)} className={`rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-text ${FOCO}`}>
              {nome}
            </button>
          ))}
          <a href={FLUXO} className={`rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-text ${FOCO}`}>Fluxo do cliente</a>
        </nav>
      </div>

      <section id="o-que-o-cliente-ve" className="scroll-mt-20">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`${ROTULO} text-brand`}>1</span>
          <h2 className="text-[18px] font-semibold text-text">O que o cliente vê</h2>
          <span className="font-os-mono text-[10.5px] text-muted">quatro blocos, de cima para baixo; no celular, uma coluna</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {blocos.map((b, n) => {
            const doBloco = itens.filter((i) => i.bloco === b.id);
            const noAr = doBloco.filter((i) => i.estado === 'no_ar').length;
            return (
              <div key={b.id} className={`rounded border bg-surface p-3 transition-opacity ${bloco && bloco !== b.id ? 'border-border opacity-40' : bloco ? 'border-brand' : 'border-border'}`}>
                <p className={`${ROTULO} text-brand`}>bloco {n + 1}</p>
                <h3 className="mt-0.5 text-[15px] font-semibold text-text">{b.nome}</h3>
                <p className="mt-1 text-[12px] leading-[1.5] text-muted">{b.para_o_cliente}</p>
                <p className="mt-2 font-os-mono text-[10.5px] text-dim">{noAr} de {doBloco.length} no ar</p>
                <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
                  {doBloco.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => irPara(`i-${i.id}`)}
                        className={`flex w-full items-start gap-2 text-left text-[12.5px] leading-[1.45] hover:text-brand ${FOCO} ${filtrando && !passaItem(i) ? 'opacity-30' : 'text-text'}`}
                      >
                        <span className="mt-[3px] font-os-mono text-[10.5px] text-muted">{i.numero}</span>
                        <span className="flex-1">{i.item}</span>
                        <span className={`mt-[2px] h-2 w-2 shrink-0 rounded-full border ${i.estado === 'no_ar' ? 'border-good bg-good/40' : i.estado === 'em_construcao' ? 'border-warn bg-warn/30' : 'border-border bg-bg'}`} aria-label={ROTULO_DO_ESTADO[i.estado]} title={ROTULO_DO_ESTADO[i.estado]} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section id="itens" className="scroll-mt-20">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`${ROTULO} text-brand`}>2</span>
          <h2 className="text-[18px] font-semibold text-text">Item a item</h2>
          <span className="font-os-mono text-[10.5px] text-muted">como chega, de onde vem, o que o cliente vê e quando está feito</span>
        </div>
        <div className="space-y-3">
          {blocos.map((b) => (
            <div key={b.id} className="space-y-3">
              <p className={`${ROTULO} pt-2`}>{b.nome}</p>
              {itens.filter((i) => i.bloco === b.id).map((i) => <CartaoDoItem key={i.id} i={i} />)}
            </div>
          ))}
        </div>
      </section>

      <section id="motor" className="scroll-mt-20">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`${ROTULO} text-brand`}>3</span>
          <h2 className="text-[18px] font-semibold text-text">Motor</h2>
          <span className="font-os-mono text-[10.5px] text-muted">o que serve a todos os itens</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {motor.map((m) => <CartaoDoMotor key={m.id} m={m} />)}
        </div>
      </section>

      <section id="levas" className="scroll-mt-20">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`${ROTULO} text-brand`}>4</span>
          <h2 className="text-[18px] font-semibold text-text">Levas</h2>
          <span className="font-os-mono text-[10.5px] text-muted">o backlog em ordem: uma leva por vez, cada uma com a sua prova</span>
        </div>
        <ol className="grid gap-3 md:grid-cols-2">
          {area.levas.map((l) => {
            const dela = l.itens.map((id) => itens.find((i) => i.id === id) ?? motor.find((m) => m.id === id)).filter(Boolean) as (Item | Motor)[];
            const noAr = dela.filter((x) => x.estado === 'no_ar').length;
            const emConstrucao = dela.filter((x) => x.estado === 'em_construcao').length;
            return (
              <li key={l.id} className={`rounded border bg-surface p-4 transition-opacity ${leva && leva !== l.id ? 'border-border opacity-40' : leva ? 'border-brand' : 'border-border'}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-os-mono text-[18px] font-bold text-brand">{l.id}</span>
                  <h3 className="text-[15px] font-semibold text-text">{l.nome}</h3>
                </div>
                <p className="mt-0.5 font-os-mono text-[10.5px] text-muted">{l.quando} · {noAr} no ar · {emConstrucao} em construção · {dela.length - noAr - emConstrucao} no backlog</p>
                <p className="mt-2 text-[12.5px] leading-[1.55] text-text">{l.entrega}</p>
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                  {l.itens.map((id) => <li key={id}><Ref id={id} /></li>)}
                </ul>
                <p className="mt-3 border-t border-border pt-2 text-[12px] leading-[1.55] text-muted"><span className="text-text">Prova:</span> {l.prova}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section id="decisoes" className="scroll-mt-20 rounded border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`${ROTULO} text-brand`}>5</span>
          <h2 className="text-[18px] font-semibold text-text">Decisões abertas</h2>
          <span className="font-os-mono text-[10.5px] text-muted">para a mesa; a recomendação vale até alguém decidir diferente</span>
        </div>
        <ol className="divide-y divide-border">
          {area.decisoes_abertas.map((d) => (
            <li key={d.id} className="grid gap-x-5 gap-y-1 py-3 md:grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)]">
              <span className="font-os-mono text-[13px] font-bold text-warn">{d.id}</span>
              <p className="text-[13px] font-semibold leading-[1.45] text-text">{d.pergunta}</p>
              <div className="text-[12.5px] leading-[1.55] text-muted">
                <p><span className="text-text">Recomendação:</span> {d.recomendacao}</p>
                <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11.5px]">
                  <span className={ROTULO}>trava</span>
                  {d.trava.map((t) => <Ref key={t} id={t} />)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="estados" className="scroll-mt-20 rounded border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`${ROTULO} text-brand`}>6</span>
          <h2 className="text-[18px] font-semibold text-text">Estados de um item</h2>
          <span className="font-os-mono text-[10.5px] text-muted">o que o cliente vê e o que só a bancada vê, por cliente</span>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {area.estados_do_item_para_o_cliente.map((e, n) => (
            <li key={e.id} className="rounded border border-border bg-bg p-3">
              <p className="flex items-center gap-2">
                <span className="font-os-mono text-[10.5px] text-dim">{n + 1}</span>
                <span className="font-os-mono text-[12px] font-semibold text-text">{e.rotulo}</span>
                <span className="ml-auto font-os-mono text-[10px] uppercase tracking-[0.08em] text-muted">{e.quem_ve}</span>
              </p>
              <p className="mt-1 text-[12px] leading-[1.5] text-muted">{e.descricao}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-2 border-t border-border pt-3 text-[12px] text-muted sm:grid-cols-3">
          {(Object.keys(area.estados_da_construcao) as EstadoDaConstrucao[]).map((e) => (
            <p key={e} className="flex items-start gap-2"><Estado e={e} /> <span>{area.estados_da_construcao[e]}</span></p>
          ))}
        </div>
        <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted">Fonte: {area.fonte}</p>
      </section>
    </div>
  );
}
