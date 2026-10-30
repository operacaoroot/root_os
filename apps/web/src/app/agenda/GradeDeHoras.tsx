'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SocioDaAgenda } from '@mktos/shared';

import { horaNoFuso, noFuso, rotulosDoDia } from './semana';
import {
  CLASSE_DO_TOM,
  aparenciaDo,
  alturaEfetiva,
  corDaEtiqueta,
  foraNoDia,
  horaDeMinutos,
  janelaDeHoras,
  layoutDoDia,
  minutosDoEvento,
  type AlturaDaHora,
  type EventoV2,
  type FaixaDoTopo,
  type MaisNaGrade,
} from './v2';

/*
 * A GRADE DE HORAS DA AGENDA V2 (29/10/2026, lane G3) — desenho `Main`.
 *
 * Colunas por dia, a hora na régua da esquerda, a linha do agora, o feriado que
 * fecha a coluna, até três simultâneos lado a lado em terços e "+N" a partir do
 * quarto. Cor só onde informa, sempre com a palavra junto (a etiqueta em mono).
 *
 * ARRASTAR E ESTICAR com ponteiro nativo (sem biblioteca): arrastar o bloco
 * move, puxar a borda de baixo estica, Esc desiste. Soltar NÃO grava: entrega
 * o destino (`aoSoltar`) e a página abre o painel de editar com a régua, onde
 * a pessoa confirma. O teclado e o celular editam pelo mesmo painel (Editar no
 * detalhe), então arrastar nunca é o único caminho.
 *
 * Clique no vazio abre o painel naquele horário (arredondado a 15 min).
 */

export interface NovoNaGrade {
  dia: string;
  inicio: number;
  fim: number;
  titulo: string;
}

export interface DestinoDoArrasto {
  dia: string;
  inicio: number;
  fim: number;
}

interface Props {
  dias: string[];
  eventos: EventoV2[];
  choques: ReadonlySet<string>;
  faixas: FaixaDoTopo[];
  hoje: string;
  agora: Date;
  altura: AlturaDaHora;
  /** Ctrl + roda do mouse: +1 aumenta, −1 diminui. */
  aoRodar?: (sentido: 1 | -1) => void;
  /** O compromisso que está sendo marcado (tracejado verde). */
  novo?: NovoNaGrade | null;
  podeMover?: (e: EventoV2) => boolean;
  /** Minutos de trajeto antes de um presencial (das Regras), para o marcador. */
  trajetoDe?: (e: EventoV2) => number;
  aoClicarEvento: (e: EventoV2) => void;
  aoClicarVazio?: (dia: string, minuto: number) => void;
  aoSoltar?: (e: EventoV2, destino: DestinoDoArrasto) => void;
  aoEscolherDia?: (dia: string) => void;
  diaAberto?: string;
  prazosPorDia?: Map<string, number>;
}

interface Arrasto {
  evento: EventoV2;
  modo: 'mover' | 'esticar';
  x0: number;
  y0: number;
  dia0: string;
  ini0: number;
  fim0: number;
  dia: string;
  ini: number;
  fim: number;
  moveu: boolean;
}

const PASSO = 15;

export function GradeDeHoras(props: Props) {
  const { dias, eventos, choques, faixas, hoje, agora, altura, novo, podeMover, trajetoDe, aoClicarEvento, aoClicarVazio, aoSoltar, aoEscolherDia, diaAberto, prazosPorDia } = props;
  const rolagem = useRef<HTMLDivElement>(null);
  const colunas = useRef(new Map<string, HTMLDivElement>());
  const [disponivel, setDisponivel] = useState(0);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const arrastoRef = useRef<Arrasto | null>(null);
  const acabouDeArrastar = useRef(false);
  const [listaDoMais, setListaDoMais] = useState<{ dia: string; mais: MaisNaGrade } | null>(null);

  // A janela cabe também o compromisso novo (marcar às 07h ou às 22h alarga a grade).
  const janela = useMemo(() => {
    const j = janelaDeHoras(eventos);
    if (!novo) return j;
    return { inicio: Math.min(j.inicio, Math.floor(novo.inicio / 60) * 60), fim: Math.max(j.fim, Math.min(24 * 60, Math.ceil(novo.fim / 60) * 60)) };
  }, [eventos, novo]);
  const porDia = useMemo(() => dias.map((d) => layoutDoDia(eventos, d, janela)), [dias, eventos, janela]);
  const px = alturaEfetiva(altura, disponivel, janela);
  const pxPorMin = px / 60;
  const horas = useMemo(() => {
    const h: number[] = [];
    for (let m = janela.inicio; m < janela.fim; m += 60) h.push(m);
    return h;
  }, [janela]);
  const alturaTotal = ((janela.fim - janela.inicio) / 60) * px;
  const topo = (min: number) => ((min - janela.inicio) / 60) * px;

  // A altura disponível (para o "auto"): a da área de rolagem, medida no navegador.
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const medir = () => setDisponivel(el.clientHeight);
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl + roda muda a altura (o navegador daria zoom na página inteira).
  useEffect(() => {
    const el = rolagem.current;
    if (!el || !props.aoRodar) return;
    const rodar = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      props.aoRodar?.(ev.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', rodar, { passive: false });
    return () => el.removeEventListener('wheel', rodar);
  }, [props.aoRodar]); // eslint-disable-line react-hooks/exhaustive-deps

  // O arrasto vive na janela: o ponteiro pode sair do bloco.
  useEffect(() => {
    if (!arrasto) return;
    const diaSob = (x: number): string | null => {
      for (const [dia, el] of colunas.current) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && x >= r.left && x < r.right) return dia;
      }
      return null;
    };
    const mover = (ev: PointerEvent) => {
      const a = arrastoRef.current;
      if (!a) return;
      const dx = (ev.clientX ?? a.x0) - a.x0;
      const dy = (ev.clientY ?? a.y0) - a.y0;
      const delta = Math.round(dy / pxPorMin / PASSO) * PASSO;
      const dur = a.fim0 - a.ini0;
      let { dia, ini, fim } = a;
      if (a.modo === 'mover') {
        ini = Math.min(24 * 60 - dur, Math.max(0, a.ini0 + delta));
        fim = ini + dur;
        dia = diaSob(ev.clientX ?? a.x0) ?? a.dia0;
      } else {
        fim = Math.min(24 * 60, Math.max(a.ini0 + PASSO, a.fim0 + delta));
      }
      const proximo = { ...a, dia, ini, fim, moveu: a.moveu || Math.abs(dx) > 4 || Math.abs(dy) > 4 };
      arrastoRef.current = proximo;
      setArrasto(proximo);
    };
    const soltar = () => {
      const a = arrastoRef.current;
      arrastoRef.current = null;
      setArrasto(null);
      if (!a || !a.moveu) return;
      // O clique que o navegador manda logo depois de soltar não abre o detalhe.
      acabouDeArrastar.current = true;
      setTimeout(() => { acabouDeArrastar.current = false; }, 0);
      if (a.dia !== a.dia0 || a.ini !== a.ini0 || a.fim !== a.fim0) aoSoltar?.(a.evento, { dia: a.dia, inicio: a.ini, fim: a.fim });
    };
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      arrastoRef.current = null;
      setArrasto(null);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      window.removeEventListener('keydown', tecla);
    };
  }, [arrasto !== null, pxPorMin, aoSoltar]); // eslint-disable-line react-hooks/exhaustive-deps

  const comecarArrasto = (ev: React.PointerEvent, e: EventoV2, modo: Arrasto['modo']) => {
    if (!podeMover?.(e) || !aoSoltar) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    const m = minutosDoEvento(e);
    if (!m) return;
    ev.stopPropagation();
    const a: Arrasto = { evento: e, modo, x0: ev.clientX ?? 0, y0: ev.clientY ?? 0, dia0: m.dia, ini0: m.inicio, fim0: m.fim, dia: m.dia, ini: m.inicio, fim: m.fim, moveu: false };
    arrastoRef.current = a;
    setArrasto(a);
  };

  const clicarNoVazio = (ev: React.MouseEvent<HTMLDivElement>, dia: string) => {
    if (!aoClicarVazio || ev.target !== ev.currentTarget) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const min = janela.inicio + (ev.clientY - r.top) / pxPorMin;
    aoClicarVazio(dia, Math.min(24 * 60 - PASSO, Math.max(0, Math.floor(min / PASSO) * PASSO)));
  };

  const agoraNoFuso = noFuso(agora);
  const colunasCss = { gridTemplateColumns: `2.75rem repeat(${dias.length}, minmax(0, 1fr))` };
  const comDiaInteiro = porDia.some((d) => d.diaInteiro.some((e) => e.leitura.tipo !== 'fora' && e.leitura.tipo !== 'feriado'));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[3px] border border-border bg-surface" data-visao-da-agenda="grade">
      <div className="grid border-b border-border" style={colunasCss}>
        <div />
        {dias.map((dia) => {
          const r = rotulosDoDia(dia);
          const prazos = prazosPorDia?.get(dia) ?? 0;
          return (
            <button
              key={dia}
              type="button"
              onClick={() => aoEscolherDia?.(dia)}
              aria-label={r.extenso}
              aria-current={dia === hoje ? 'date' : undefined}
              className={`min-w-0 border-l border-border px-1 py-2 text-center first:border-l-0 ${dia === diaAberto ? 'bg-surface-2' : ''}`}
            >
              <span className="block font-os-mono text-[10px] uppercase tracking-[0.2em] text-muted">{r.semana}</span>
              <span className={`font-os-mono text-[13px] ${dia === hoje ? 'rounded-[3px] bg-brand px-1.5 font-semibold text-ink' : dia < hoje ? 'text-muted' : 'text-text'}`}>{r.data}</span>
              {prazos > 0 && <span className="block truncate font-os-mono text-[10px] text-brand">{prazos} prazo{prazos === 1 ? '' : 's'}</span>}
            </button>
          );
        })}
      </div>

      {comDiaInteiro && (
        <div className="grid border-b border-border" style={colunasCss} data-faixa-dia-inteiro="">
          <div className="px-1 py-1 text-right font-os-mono text-[9px] leading-tight text-muted">dia inteiro</div>
          {porDia.map(({ dia, diaInteiro }) => (
            <div key={dia} className="min-w-0 space-y-0.5 border-l border-border p-0.5">
              {diaInteiro
                .filter((e) => e.leitura.tipo !== 'fora' && e.leitura.tipo !== 'feriado')
                .map((e) => {
                  const ap = aparenciaDo(e);
                  return (
                    <button key={e.id} type="button" onClick={() => aoClicarEvento(e)} title={ap.titulo} className={`block w-full min-w-0 truncate rounded-[3px] px-1 py-0.5 text-left text-[10px] ${CLASSE_DO_TOM[ap.tom]}`}>
                      {ap.titulo}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      )}

      <div ref={rolagem} className="min-h-[18rem] flex-1 overflow-y-auto overflow-x-hidden" data-rolagem-da-grade="">
        <div className="relative grid" style={{ ...colunasCss, height: alturaTotal }}>
          <div className="relative">
            {horas.map((m) => (
              <span key={m} className="absolute right-1.5 font-os-mono text-[10px] text-muted" style={{ top: topo(m) + 2 }}>
                {`${String(m / 60).padStart(2, '0')}h`}
              </span>
            ))}
          </div>
          {porDia.map(({ dia, blocos, mais }) => {
            const feriado = faixas.find((f) => f.tipo === 'feriado' && f.dia === dia && f.fecha);
            const fora = foraNoDia(faixas, dia);
            const ehHoje = dia === hoje && agoraNoFuso.dia === dia && agoraNoFuso.minutos >= janela.inicio && agoraNoFuso.minutos <= janela.fim;
            const fantasma = arrasto?.moveu && arrasto.dia === dia ? arrasto : null;
            return (
              <div
                key={dia}
                ref={(el) => { if (el) colunas.current.set(dia, el); else colunas.current.delete(dia); }}
                className={`relative min-w-0 border-l border-border ${aoClicarVazio ? 'cursor-cell' : ''}`}
                data-coluna-do-dia={dia}
                onClick={(ev) => clicarNoVazio(ev, dia)}
              >
                {horas.map((m) => (
                  <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: topo(m) }} />
                ))}
                {feriado && (
                  <div className="pointer-events-none absolute inset-1.5 flex flex-col items-center justify-center gap-1.5 rounded-[3px] border border-dashed border-border-strong bg-surface-2/60 px-2 text-center" data-feriado={feriado.texto}>
                    <span className="font-os-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted">Feriado</span>
                    <span className="text-[13px] text-muted">{feriado.texto}</span>
                    <span className="font-os-mono text-[10px] text-dim">a régua não deixa marcar aqui sem &quot;marcar assim mesmo&quot;</span>
                  </div>
                )}

                {blocos.map(({ evento: e, inicio, fim, coluna, colunas: n }) => {
                  const ap = aparenciaDo(e);
                  const choque = choques.has(e.id);
                  const tom = choque ? 'choque' : ap.tom;
                  const etiqueta = choque ? 'choque' : ap.etiqueta;
                  const foraAqui = e.leitura.responsaveis.filter((s) => fora.includes(s as SocioDaAgenda));
                  const largura = `calc(${100 / n}% - 4px)`;
                  const esquerda = `calc(${(coluna / n) * 100}% + 2px)`;
                  const alturaDoBloco = Math.max(18, ((fim - inicio) / 60) * px - 2);
                  const movel = !!podeMover?.(e) && !!aoSoltar;
                  const sendoArrastado = arrasto?.moveu && arrasto.evento.id === e.id;
                  const trajeto = trajetoDe?.(e) ?? 0;
                  return (
                    <div key={e.id}>
                      {trajeto > 0 && inicio - trajeto >= janela.inicio && (
                        <div
                          className="pointer-events-none absolute overflow-hidden border-l-2 border-border-strong px-1.5"
                          style={{ top: topo(inicio - trajeto), height: Math.max(12, (trajeto / 60) * px - 2), left: esquerda, width: largura }}
                          data-trajeto={e.id}
                        >
                          <span className="font-os-mono text-[10px] text-muted">trajeto {trajeto} min</span>
                        </div>
                      )}
                      <button
                        type="button"
                        data-evento={e.id}
                        data-tom={tom}
                        onPointerDown={(ev) => comecarArrasto(ev, e, 'mover')}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (acabouDeArrastar.current) { acabouDeArrastar.current = false; return; }
                          aoClicarEvento(e);
                        }}
                        title={`${horaNoFuso(e.inicio)}–${horaNoFuso(e.fim)} · ${ap.titulo}${etiqueta ? ` · ${etiqueta}` : ''}`}
                        className={`absolute flex flex-col gap-0.5 overflow-hidden rounded-[3px] px-1.5 py-1 text-left ${CLASSE_DO_TOM[tom]} ${movel ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${sendoArrastado ? 'opacity-40' : ''}`}
                        style={{ top: topo(inicio), height: alturaDoBloco, left: esquerda, width: largura }}
                      >
                        {etiqueta && (
                          <span className={`font-os-mono text-[9.5px] font-bold uppercase leading-none tracking-[0.08em] ${corDaEtiqueta(tom, ap.semMeet)}`}>{etiqueta}</span>
                        )}
                        <span className={`line-clamp-2 text-[11.5px] font-medium leading-tight ${ap.tom === 'fechado' || ap.tom === 'pessoal' ? 'text-muted' : 'text-text'}`}>{ap.titulo}</span>
                        <span className="font-os-mono text-[10px] leading-none text-muted">{horaNoFuso(e.inicio)}{e.local ? ` · ${e.local}` : ''}</span>
                        {foraAqui.length > 0 && (
                          <span className="font-os-mono text-[9.5px] font-bold uppercase tracking-[0.08em] text-warn">{foraAqui.join(', ')} Fora</span>
                        )}
                        {movel && (
                          <span
                            aria-hidden
                            data-borda-de-esticar={e.id}
                            onPointerDown={(ev) => comecarArrasto(ev, e, 'esticar')}
                            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                          />
                        )}
                      </button>
                    </div>
                  );
                })}

                {mais.map((m) => (
                  <button
                    key={`mais-${m.inicio}`}
                    type="button"
                    data-mais={m.ocultos}
                    onClick={(ev) => { ev.stopPropagation(); setListaDoMais({ dia, mais: m }); }}
                    title={`mais ${m.ocultos} neste horário`}
                    className={`absolute flex items-center justify-center rounded-[3px] ${CLASSE_DO_TOM.interna}`}
                    style={{ top: topo(m.inicio), height: Math.max(18, ((m.fim - m.inicio) / 60) * px - 2), left: 'calc(66.666% + 2px)', width: 'calc(33.333% - 4px)' }}
                  >
                    <span className="font-os-mono text-[13px] font-bold text-brand">+{m.ocultos}</span>
                  </button>
                ))}

                {novo && novo.dia === dia && (
                  <div
                    className={`pointer-events-none absolute inset-x-0.5 flex flex-col gap-0.5 overflow-hidden rounded-[3px] px-1.5 py-1 ${CLASSE_DO_TOM.novo}`}
                    style={{ top: topo(Math.max(novo.inicio, janela.inicio)), height: Math.max(18, ((novo.fim - novo.inicio) / 60) * px - 2) }}
                    data-compromisso-novo=""
                  >
                    <span className="font-os-mono text-[9.5px] font-bold uppercase tracking-[0.08em] text-brand">novo</span>
                    <span className="line-clamp-2 text-[11.5px] font-medium leading-tight text-text">{novo.titulo}</span>
                  </div>
                )}

                {fantasma && (
                  <div
                    className={`pointer-events-none absolute inset-x-0.5 rounded-[3px] px-1.5 py-1 ${CLASSE_DO_TOM.novo}`}
                    style={{ top: topo(fantasma.ini), height: Math.max(18, ((fantasma.fim - fantasma.ini) / 60) * px - 2) }}
                    data-fantasma=""
                  >
                    <span className="font-os-mono text-[10px] text-brand">{horaDeMinutos(fantasma.ini)}–{horaDeMinutos(fantasma.fim)}</span>
                  </div>
                )}

                {ehHoje && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-mag" style={{ top: topo(agoraNoFuso.minutos) }} data-linha-do-agora="">
                    <span className="absolute -top-2 right-0.5 bg-surface px-0.5 font-os-mono text-[9px] uppercase text-mag">agora</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {listaDoMais && (
        <div role="dialog" aria-label="Neste horário" className="absolute inset-x-6 top-16 z-20 rounded-[3px] border border-border-strong bg-surface p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-os-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              {rotulosDoDia(listaDoMais.dia).semana} {rotulosDoDia(listaDoMais.dia).data} · {horaDeMinutos(listaDoMais.mais.inicio)} · {listaDoMais.mais.eventos.length} no horário
            </span>
            <button type="button" onClick={() => setListaDoMais(null)} aria-label="Fechar a lista" className="px-2 text-muted hover:text-text">×</button>
          </div>
          <ul className="divide-y divide-border">
            {listaDoMais.mais.eventos.map((e) => {
              const ap = aparenciaDo(e);
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => { setListaDoMais(null); aoClicarEvento(e); }} className="flex w-full items-baseline gap-2 py-1.5 text-left text-sm hover:text-brand">
                    <span className="font-os-mono text-xs text-muted">{horaNoFuso(e.inicio)}–{horaNoFuso(e.fim)}</span>
                    <span className="min-w-0 truncate">{ap.titulo}</span>
                    {(choques.has(e.id) || ap.etiqueta) && (
                      <span className={`ml-auto shrink-0 font-os-mono text-[9.5px] uppercase ${corDaEtiqueta(choques.has(e.id) ? 'choque' : ap.tom, ap.semMeet)}`}>{choques.has(e.id) ? 'choque' : ap.etiqueta}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
