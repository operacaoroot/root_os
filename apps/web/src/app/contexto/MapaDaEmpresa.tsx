'use client';

import { useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { BookOpen, Bot, Building2, Cable, Folder, Maximize2, Minus, Plus, UserRound, Workflow, type LucideIcon } from 'lucide-react';
import { AREAS, FAMILIAS, type FiltroDeArea, type FamiliaKey, type NoDoMapa, type Tom } from './grafo';
import type { PropsDoMapa } from './Mapa';

const LARGURA = 1200;
const ALTURA = 1040;
const CENTRO = { x: LARGURA / 2, y: ALTURA / 2 };
const RAIO_DAS_AREAS = 240;
const LIMITE_POR_AREA = 9;
const ICONES: Record<FamiliaKey, LucideIcon> = { memoria: BookOpen, agentes: Bot, rotinas: Workflow, conexoes: Cable, gente: UserRound };
const TONS: Record<Tom, string> = { brand: 'text-brand', good: 'text-good', warn: 'text-warn', bad: 'text-bad', info: 'text-info', muted: 'text-muted' };
const curto = (v: string, max = 16) => v.length > max ? `${v.slice(0, max - 1)}…` : v;
const linhasDoRotulo = (rotulo: string) => {
  const exibido = rotulo.replace(/^Configurações\b/, 'Config.');
  const palavras = exibido.split(' ');
  if (exibido.length <= 14 || palavras.length < 2) return [exibido];
  let corte = 1;
  for (let i = 2; i < palavras.length; i++) {
    const diferenca = (n: number) => Math.abs(palavras.slice(0, n).join(' ').length - palavras.slice(n).join(' ').length);
    if (diferenca(i) < diferenca(corte)) corte = i;
  }
  return [palavras.slice(0, corte).join(' '), palavras.slice(corte).join(' ')];
};
const polar = (angulo: number, raio: number) => ({ x: CENTRO.x + Math.cos(angulo) * raio, y: CENTRO.y + Math.sin(angulo) * raio });
const AREAS_DO_DESENHO = [...AREAS, { key: 'sem-area' as const, rotulo: 'Sem área definida' }];

interface Arrasto {
  ponteiro: number; inicioX: number; inicioY: number; x: number; y: number; razao: number; capturou: boolean;
}

/** Áreas organizam o desenho. Registros e relações continuam usando os IDs recebidos. */
export function MapaDaEmpresa({ mapa, recorteAtivo = false, selecionado, destaque, ocultos, onSelecionar,
  onAbrirEixo, areaSelecionada, onSelecionarArea }: PropsDoMapa & {
    areaSelecionada: FiltroDeArea;
    onSelecionarArea: (area: FiltroDeArea, origem?: Element) => void;
  }) {
  const [vista, setVista] = useState({ escala: 1, dx: 0, dy: 0 });
  const svg = useRef<SVGSVGElement>(null);
  const arrasto = useRef<Arrasto | null>(null);
  const arrastou = useRef(false);
  const gradeId = `grade-contexto-${useId().replace(/:/g, '')}`;

  const desenho = useMemo(() => {
    const itens = FAMILIAS.flatMap((f) => mapa.catalogo[f.key]).filter((item) => !ocultos.has(item.familia));
    const areas = AREAS_DO_DESENHO.map((area, indice) => {
      const angulo = -Math.PI / 2 + indice * Math.PI * 2 / AREAS_DO_DESENHO.length;
      const membros = itens.filter((item) => area.key === 'sem-area' ? item.areas.length === 0 : item.areas.includes(area.key));
      // Um registro com várias áreas aparece uma vez e mantém todas as linhas de organização declaradas.
      const principais = membros.filter((item) => area.key === 'sem-area' || item.areas[0] === area.key);
      const desenhados = principais.slice(0, LIMITE_POR_AREA).map((item, numero): NoDoMapa => {
        const anel = Math.floor(numero / 3);
        const noAnel = Math.min(3, Math.min(principais.length, LIMITE_POR_AREA) - anel * 3);
        const lugar = numero % 3;
        const desvio = (lugar - (noAnel - 1) / 2) * 11 * Math.PI / 180;
        return { ...item, ...polar(angulo + desvio, 335 + anel * 50) };
      });
      return { ...area, angulo, ...polar(angulo, RAIO_DAS_AREAS), membros,
        desenhados, excedente: Math.max(0, principais.length - LIMITE_POR_AREA) };
    });
    const nos = areas.flatMap((area) => area.desenhados);
    return { areas, nos, porId: new Map(nos.map((no) => [no.id, no])),
      porArea: new Map(areas.map((area) => [area.key, area])) };
  }, [mapa, ocultos]);

  const relacoes = mapa.arestas.filter((a) => a.tipo === 'relacao' && desenho.porId.has(a.de) && desenho.porId.has(a.para));
  const ligados = selecionado ? new Set([selecionado, ...relacoes.filter((a) => a.de === selecionado || a.para === selecionado)
    .flatMap((a) => [a.de, a.para])]) : null;
  const focados = destaque ?? ligados;
  const incertas = mapa.eixos.filter((eixo) => eixo.estado === 'erro' || eixo.estado === 'sem_permissao' || eixo.estado === 'carregando').length;
  const zoom = (passo: number) => setVista((v) => ({ ...v, escala: Math.max(0.6, Math.min(2.6, Math.round((v.escala + passo) * 100) / 100)) }));

  const iniciar = (evento: PointerEvent<SVGSVGElement>) => {
    if (evento.button !== 0) return;
    arrastou.current = false;
    const ctm = svg.current?.getScreenCTM?.();
    const largura = svg.current?.getBoundingClientRect().width;
    arrasto.current = { ponteiro: evento.pointerId, inicioX: evento.clientX, inicioY: evento.clientY,
      x: evento.clientX, y: evento.clientY, razao: ctm?.a ? 1 / ctm.a : largura ? LARGURA / largura : 1, capturou: false };
  };
  const mover = (evento: PointerEvent<SVGSVGElement>) => {
    const a = arrasto.current;
    if (!a || a.ponteiro !== evento.pointerId) return;
    const totalX = evento.clientX - a.inicioX, totalY = evento.clientY - a.inicioY;
    if (!a.capturou && Math.hypot(totalX, totalY) <= 4) return;
    if (!a.capturou) { a.capturou = true; svg.current?.setPointerCapture?.(a.ponteiro); }
    const dx = evento.clientX - a.x, dy = evento.clientY - a.y;
    a.x = evento.clientX; a.y = evento.clientY;
    setVista((v) => ({ ...v, dx: v.dx + dx * a.razao, dy: v.dy + dy * a.razao }));
  };
  const soltar = () => {
    const a = arrasto.current; arrasto.current = null; arrastou.current = !!a?.capturou;
    if (a?.capturou && svg.current?.hasPointerCapture?.(a.ponteiro)) svg.current.releasePointerCapture(a.ponteiro);
  };

  return (
    <div className="flex min-w-0 flex-col bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="font-os-mono text-[10px] uppercase tracking-[0.14em] text-muted">Áreas da empresa · registros carregados</div>
        <div className="flex items-center gap-1">
          <Controle rotulo="Afastar" onClick={() => zoom(-0.25)}><Minus size={15} /></Controle>
          <span aria-live="polite" className="w-12 text-center font-os-mono text-[11px] tabular-nums text-muted">{Math.round(vista.escala * 100)}%</span>
          <Controle rotulo="Aproximar" onClick={() => zoom(0.25)}><Plus size={15} /></Controle>
          <Controle rotulo="Enquadrar" onClick={() => setVista({ escala: 1, dx: 0, dy: 0 })}><Maximize2 size={14} /></Controle>
        </div>
      </div>
      <svg ref={svg} viewBox="100 30 1000 1000" role="group" aria-label="Mapa do contexto"
        className="h-[420px] w-full cursor-grab touch-none select-none active:cursor-grabbing sm:h-[560px] lg:h-[clamp(570px,70vh,850px)]"
        onPointerDown={iniciar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
        onPointerLeave={() => { if (!arrasto.current?.capturou) soltar(); }}
        onClickCapture={(evento) => { if (arrastou.current) { evento.stopPropagation(); arrastou.current = false; } }}>
        <defs><pattern id={gradeId} width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.7" className="text-border" opacity="0.55" />
        </pattern></defs>
        <rect width={LARGURA} height={ALTURA} fill={`url(#${gradeId})`} />
        <g transform={`translate(${vista.dx} ${vista.dy}) translate(${CENTRO.x} ${CENTRO.y}) scale(${vista.escala}) translate(${-CENTRO.x} ${-CENTRO.y})`}>
          <circle {...{ cx: CENTRO.x, cy: CENTRO.y }} r={RAIO_DAS_AREAS} fill="none" stroke="currentColor" className="text-border" strokeDasharray="3 12" />
          {desenho.areas.map((area) => <line key={`area:${area.key}`} x1={CENTRO.x} y1={CENTRO.y} x2={area.x} y2={area.y}
            stroke="currentColor" strokeWidth="1" opacity="0.35" className="text-border-strong"><title>Organização da visualização: {area.rotulo}</title></line>)}
          {desenho.nos.flatMap((no) => (no.areas.length ? no.areas : ['sem-area' as const]).map((key) => {
            const area = desenho.porArea.get(key); if (!area) return null;
            return <line key={`organiza:${key}:${no.id}`} x1={area.x} y1={area.y} x2={no.x} y2={no.y}
              stroke="currentColor" className="text-border-strong" opacity="0.6" strokeWidth="1">
              <title>{no.areas.length ? `Área declarada: ${area.rotulo}` : 'Registro sem área definida'}</title>
            </line>;
          }))}
          {relacoes.map((aresta) => {
            const de = desenho.porId.get(aresta.de)!, para = desenho.porId.get(aresta.para)!;
            const apagada = ligados && !(ligados.has(aresta.de) && ligados.has(aresta.para));
            return <path key={aresta.id} d={`M${de.x},${de.y} Q${CENTRO.x},${CENTRO.y} ${para.x},${para.y}`}
              fill="none" stroke="currentColor" className="text-brand" strokeWidth="2" strokeDasharray="6 5" opacity={apagada ? 0.12 : 0.8}>
              <title>Vínculo declarado entre {de.rotulo} e {para.rotulo}</title>
            </path>;
          })}
          <g transform={`translate(${CENTRO.x} ${CENTRO.y})`} className="text-brand">
            <circle r="78" fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeOpacity="0.15" />
            <circle r="65" fill="currentColor" fillOpacity="0.09" stroke="currentColor" strokeOpacity="0.55" />
            <Building2 x="-14" y="-40" size={28} aria-hidden="true" />
            <text y="14" textAnchor="middle" className="fill-current font-os-mono text-[26px] font-semibold">{curto(mapa.nucleo.rotulo, 20)}</text>
            <text y="43" textAnchor="middle" className="fill-current font-os-mono text-[16px] uppercase tracking-widest">Contexto</text>
          </g>
          {desenho.areas.map((area) => {
            const selecionada = areaSelecionada === area.key;
            const linhas = linhasDoRotulo(area.rotulo);
            return <g key={area.key} transform={`translate(${area.x} ${area.y})`} role="button" tabIndex={0}
              aria-label={`${area.rotulo}: ${area.membros.length} registros carregados${incertas ? '; algumas fontes ainda não puderam ser consultadas' : ''}`}
              aria-pressed={selecionada} className={`group cursor-pointer focus:outline-none ${selecionada ? 'text-brand' : 'text-muted'}`}
              onClick={(evento) => onSelecionarArea(selecionada ? '' : area.key, evento.currentTarget)}
              onKeyDown={(evento) => { if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); onSelecionarArea(selecionada ? '' : area.key, evento.currentTarget); } }}>
              <title>{area.rotulo} · área de navegação · {area.membros.length} registros carregados</title>
              <circle r="36" fill="rgb(var(--os-bg))" stroke="currentColor" strokeOpacity={selecionada ? 0.95 : 0.45}
                strokeWidth={selecionada ? 2 : 1} strokeDasharray={area.membros.length ? undefined : '3 4'} />
              <circle r="43" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-0 group-focus-visible:opacity-100" />
              <Folder x="-12" y="-28" size={24} aria-hidden="true" />
              <text y="24" textAnchor="middle" className="fill-current font-os-mono text-[24px] font-semibold tabular-nums">{area.membros.length || (incertas ? '—' : '0')}</text>
              {linhas.map((linha, indice) => <text key={indice} y={65 + indice * 26} textAnchor="middle" className="pointer-events-none fill-current font-os-mono text-[22px]">{linha}</text>)}
              {area.excedente > 0 && <text y={65 + linhas.length * 26} textAnchor="middle" className="fill-current font-os-mono text-[18px]">+{area.excedente} no diretório</text>}
            </g>;
          })}
          {desenho.nos.map((no) => {
            const Icone = ICONES[no.familia];
            const escolhido = selecionado === no.id;
            const destacado = !!focados?.has(no.id);
            return <g key={no.id} transform={`translate(${no.x} ${no.y})`} role="button" tabIndex={0}
              aria-label={`${no.rotulo} — ${no.sub}`} className={`group cursor-pointer focus:outline-none ${TONS[no.tom]}`}
              opacity={focados && !destacado ? 0.24 : 1}
              onClick={(evento) => onSelecionar(no, evento.currentTarget)}
              onKeyDown={(evento) => { if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); onSelecionar(no, evento.currentTarget); } }}>
              <title>{no.rotulo} · {no.sub}</title>
              <circle r="26" fill="transparent" />
              <circle r="19" fill="rgb(var(--os-bg))" stroke="currentColor" strokeWidth={escolhido ? 2 : 1.1} strokeOpacity="0.85" />
              {(escolhido || destacado) && <circle r="25" fill="none" stroke="currentColor" strokeWidth="1.4" />}
              <circle r="26" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-0 group-focus-visible:opacity-100" />
              <Icone x="-10" y="-10" size={20} aria-hidden="true" />
              <text y="43" textAnchor="middle" className={`pointer-events-none fill-current font-os-mono text-[20px] ${escolhido || destacado ? '' : `opacity-0 group-hover:opacity-100 group-focus:opacity-100 ${desenho.nos.length <= 8 ? 'lg:opacity-100' : ''}`}`}>{curto(no.rotulo, 15)}</text>
            </g>;
          })}
        </g>
      </svg>
      <div className="flex flex-wrap gap-1 border-t border-border px-3 py-2" aria-label="Abrir registros por tipo">
        {mapa.eixos.map((eixo) => {
          const Icone = ICONES[eixo.key];
          const total = eixo.estado === 'sem_permissao' ? 'sem acesso' : eixo.estado === 'erro' ? 'falhou' : eixo.total === null ? '…' : recorteAtivo ? eixo.totalNoRecorte : eixo.total;
          return <button key={eixo.key} type="button" onClick={(evento) => onAbrirEixo(eixo, evento.currentTarget)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-root px-3 text-[11px] text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${ocultos.has(eixo.key) ? 'opacity-40' : ''}`}>
            <Icone size={14} aria-hidden="true" /> {eixo.rotulo} <span className="font-os-mono">{total}</span>
          </button>;
        })}
      </div>
    </div>
  );
}

function Controle({ rotulo, onClick, children }: { rotulo: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={rotulo} title={rotulo} onClick={onClick}
    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-root border border-border text-muted hover:border-brand-dim hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">{children}</button>;
}
