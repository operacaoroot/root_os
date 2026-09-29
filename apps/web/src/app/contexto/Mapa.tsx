'use client';

import { useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import {
  DESLOCAMENTO_DO_ROTULO,
  LADO,
  LIMITE_DE_ROTULO_SEMPRE,
  MAX_LETRAS_DO_ROTULO,
  RAIO_DO_EIXO,
  RAIO_DO_NO,
  RAIO_DO_NUCLEO,
  posicaoDoExcedente,
  traco,
  type EixoDoMapa,
  type FamiliaKey,
  type Mapa as MapaDados,
  type NoDoMapa,
  type Tom,
} from './grafo';

/*
 * ============================================================================
 * O DESENHO — SVG e mais nada
 * ============================================================================
 *
 * NENHUMA BIBLIOTECA DE GRAFO. A posição de cada ponto já veio pronta de
 * `grafo.ts`; aqui só se desenha, se dá zoom e se escuta clique. Isso não é
 * economia de linha: dependência nova é decisão humana (registrada como
 * pergunta no relatório da fatia), e o que uma biblioteca de grafo traria de
 * útil — arrastar nó, simular força — é justamente o que esta tela NÃO quer,
 * porque posição instável quebra a leitura de quem apresenta o mapa a um
 * cliente.
 *
 * COR VEM DE `currentColor`. Cada nó entra num `<g>` com a classe de texto do
 * tom (`text-good`, `text-bad`…), e o círculo pinta com `currentColor`. Sem
 * isso seria preciso uma tabela de `fill-*` paralela à escala de estado do
 * painel — e duas escalas de cor é como uma tela passa a discordar da outra
 * sobre o mesmo conector.
 *
 * CADA PONTO É UM BOTÃO DE VERDADE: `role="button"`, foco pelo teclado e
 * `aria-label` com o rótulo e a segunda linha. O mapa é a tela principal do
 * produto; navegar nele só com o mouse deixaria de fora quem usa teclado ou
 * leitor de tela.
 */

const TOM_CLS: Record<Tom, string> = {
  brand: 'text-brand',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  muted: 'text-dim',
};

const ESCALA_MIN = 0.6;
const ESCALA_MAX = 2.6;
const PASSO = 0.25;

/**
 * O quanto o ponteiro pode andar e o gesto ainda ser CLIQUE, em pixels de tela.
 *
 * Acima disso é arrasto — e só então o mapa captura o ponteiro. Ver
 * `iniciarArrasto`.
 */
const LIMIAR_DE_ARRASTO = 4;

/**
 * Rótulo curto o bastante para caber sob o ponto sem encostar no vizinho.
 *
 * O corte e o espaçamento saem do MESMO número, em `grafo.ts`: a caixa do
 * rótulo é o que decide o passo entre dois pontos e até onde o anel externo
 * pode ir. Mudar o corte aqui sem mudar lá faria o nome invadir o vizinho — por
 * isso o limite é importado, e não digitado. O nome inteiro não se perde: ele
 * está no `<title>` do ponto (a dica do navegador), no `aria-label` e na gaveta.
 */
function curto(texto: string, max = MAX_LETRAS_DO_ROTULO): string {
  const limpo = (texto ?? '').trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
}

/** O que um arrasto em curso guarda. Vive num `ref`: não redesenha nada. */
interface ArrastoEmCurso {
  /** Último ponto visto, em pixels de tela. */
  x: number;
  y: number;
  /** Unidades do `viewBox` por pixel de tela. */
  razao: number;
  ponteiro: number;
  /** Distância acumulada, em pixels de tela. Decide se virou arrasto. */
  andou: number;
  capturou: boolean;
}

export interface PropsDoMapa {
  mapa: MapaDados;
  selecionado: string | null;
  /** `null` = nenhuma busca ativa. Vazio = busca que não achou nada. */
  destaque: Set<string> | null;
  ocultos: Set<FamiliaKey>;
  onSelecionar: (no: NoDoMapa) => void;
  onAbrirEixo: (eixo: EixoDoMapa) => void;
}

export function Mapa({
  mapa,
  selecionado,
  destaque,
  ocultos,
  onSelecionar,
  onAbrirEixo,
}: PropsDoMapa) {
  const [vista, setVista] = useState({ escala: 1, dx: 0, dy: 0 });
  const arrasto = useRef<ArrastoEmCurso | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const conexoesSelecionadas = selecionado ? new Set([selecionado, ...mapa.arestas.filter((a) => a.tipo === 'relacao' && (a.de === selecionado || a.para === selecionado)).flatMap((a) => [a.de, a.para])]) : null;
  const focados = destaque ?? conexoesSelecionadas;
  const visivel = (familia: FamiliaKey) => !ocultos.has(familia);
  const nos = mapa.nos.filter((n) => visivel(n.familia));
  const desenhadosPorEixo = new Map(mapa.eixos.map((e) => [e.key, e.mostrados]));
  const porId = new Map<string, { x: number; y: number }>([
    ['nucleo', { x: mapa.nucleo.x, y: mapa.nucleo.y }],
    ...mapa.eixos.map((e) => [`eixo:${e.key}`, { x: e.x, y: e.y }] as const),
    ...nos.map((n) => [n.id, { x: n.x, y: n.y }] as const),
  ]);

  const zoom = (delta: number) =>
    setVista((v) => ({
      ...v,
      escala: Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, Math.round((v.escala + delta) * 100) / 100)),
    }));

  /*
   * ==========================================================================
   * O ARRASTO SÓ CAPTURA O PONTEIRO DEPOIS DE ANDAR
   * ==========================================================================
   *
   * Esta é a linha de que depende o clique do mapa inteiro, e ela já esteve
   * errada aqui.
   *
   * `setPointerCapture` no `pointerdown` manda TODOS os eventos daquele ponteiro
   * para o elemento que capturou — inclusive o `pointerup`. E o navegador dispara
   * o `click` no ancestral comum entre onde o ponteiro desceu e onde ele subiu:
   * com a captura na raiz, o ancestral comum entre um ponto e a raiz É a raiz. O
   * grupo do ponto sai do caminho de propagação e NENHUM `onClick` de nó dispara.
   * A tela ficava navegável só pelo teclado e pela legenda, sem um erro sequer no
   * console — e com a suíte verde, porque o ambiente de teste não implementa
   * captura de ponteiro e o operador `?.` fazia a linha virar coisa nenhuma.
   *
   * Aqui a captura só entra quando o ponteiro já andou mais do que o limiar, isto
   * é, quando o gesto deixou de ser clique. Clique parado nunca captura, e o
   * `pointerup` cai no ponto, onde ele precisa cair. Arrasto captura — e continua
   * arrastando com o cursor fora do quadro, que é para isso que a captura serve.
   */
  const iniciarArrasto = (e: React.PointerEvent<SVGSVGElement>) => {
    const caixa = svgRef.current?.getBoundingClientRect();
    // Sem caixa medida (servidor, teste, elemento ainda não pintado) o arrasto
    // não tem escala — 1 para 1 é o palpite honesto e não divide por zero.
    const razao = caixa && caixa.width > 0 ? LADO / caixa.width : 1;
    arrasto.current = {
      x: e.clientX,
      y: e.clientY,
      razao,
      ponteiro: e.pointerId,
      andou: 0,
      capturou: false,
    };
  };

  const moverArrasto = (e: React.PointerEvent<SVGSVGElement>) => {
    const a = arrasto.current;
    if (!a) return;
    const dxTela = e.clientX - a.x;
    const dyTela = e.clientY - a.y;
    a.x = e.clientX;
    a.y = e.clientY;
    a.andou += Math.hypot(dxTela, dyTela);
    if (!a.capturou && a.andou > LIMIAR_DE_ARRASTO) {
      a.capturou = true;
      svgRef.current?.setPointerCapture?.(a.ponteiro);
    }
    setVista((v) => ({ ...v, dx: v.dx + dxTela * a.razao, dy: v.dy + dyTela * a.razao }));
  };

  const soltarArrasto = () => {
    const a = arrasto.current;
    arrasto.current = null;
    const svg = svgRef.current;
    // Só solta o que este componente prendeu: soltar um ponteiro que já foi
    // liberado (o navegador libera sozinho depois do `pointerup`) lança.
    if (a?.capturou && svg?.hasPointerCapture?.(a.ponteiro)) {
      svg.releasePointerCapture(a.ponteiro);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-root border border-border bg-surface">
      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
        <BotaoDaVista rotulo="Aproximar" onClick={() => zoom(PASSO)}>
          <Plus size={14} />
        </BotaoDaVista>
        <BotaoDaVista rotulo="Afastar" onClick={() => zoom(-PASSO)}>
          <Minus size={14} />
        </BotaoDaVista>
        <BotaoDaVista rotulo="Enquadrar" onClick={() => setVista({ escala: 1, dx: 0, dy: 0 })}>
          <Maximize2 size={13} />
        </BotaoDaVista>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${LADO} ${LADO}`}
        role="group"
        aria-label="Mapa do contexto"
        className="h-[clamp(420px,62vh,760px)] w-full touch-none select-none"
        onPointerDown={iniciarArrasto}
        onPointerMove={moverArrasto}
        onPointerUp={soltarArrasto}
        onPointerLeave={soltarArrasto}
      >
        <g transform={`translate(${vista.dx} ${vista.dy})`}>
          <g
            transform={`translate(${LADO / 2} ${LADO / 2}) scale(${vista.escala}) translate(${-LADO / 2} ${-LADO / 2})`}
          >
            {mapa.arestas.map((a) => {
              const de = porId.get(a.de);
              const para = porId.get(a.para);
              if (!de || !para) return null;
              return (
                <path
                  key={a.id}
                  d={traco(de, para, a.tipo)}
                  fill="none"
                  className={a.tipo === 'relacao' ? 'text-brand' : 'text-border-strong'}
                  stroke="currentColor"
                  strokeOpacity={conexoesSelecionadas && !(conexoesSelecionadas.has(a.de) && conexoesSelecionadas.has(a.para)) ? 0.08 : a.tipo === 'relacao' ? 0.8 : 0.55}
                  strokeWidth={a.tipo === 'relacao' ? 1.6 : 1}
                  strokeDasharray={a.tipo === 'relacao' ? '5 4' : undefined}
                />
              );
            })}

            <g className="text-brand">
              <circle
                cx={mapa.nucleo.x}
                cy={mapa.nucleo.y}
                r={RAIO_DO_NUCLEO}
                fill="currentColor"
                fillOpacity={0.12}
                stroke="currentColor"
                strokeOpacity={0.65}
              />
              <text
                x={mapa.nucleo.x}
                y={mapa.nucleo.y + 4}
                textAnchor="middle"
                className="fill-current font-os-mono text-[13px] font-semibold"
              >
                {curto(mapa.nucleo.rotulo, 12)}
              </text>
            </g>

            {mapa.eixos.map((eixo) => (
              <EixoDesenhado
                key={eixo.key}
                eixo={eixo}
                apagado={!visivel(eixo.key)}
                onAbrir={() => onAbrirEixo(eixo)}
              />
            ))}

            {nos.map((no) => (
              <PontoDoMapa
                key={no.id}
                no={no}
                selecionado={selecionado === no.id}
                marcado={focados !== null && focados.has(no.id)}
                apagado={focados !== null && !focados.has(no.id)}
                sempreComRotulo={(desenhadosPorEixo.get(no.familia) ?? 0) <= LIMITE_DE_ROTULO_SEMPRE}
                onSelecionar={() => onSelecionar(no)}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

function BotaoDaVista({
  rotulo,
  onClick,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      className="rounded-root border border-border bg-surface-2 p-1.5 text-muted hover:border-brand/40 hover:text-text"
    >
      {children}
    </button>
  );
}

/**
 * O eixo — e o "+N" dele.
 *
 * O NÚMERO DO EIXO É O DA API, não o de bolinhas desenhadas. Quando os dois
 * divergem (teto de desenho), quem aparece é o total, com o "+N" ao lado
 * dizendo o que ficou de fora e abrindo a lista inteira.
 */
function EixoDesenhado({
  eixo,
  apagado,
  onAbrir,
}: {
  eixo: EixoDoMapa;
  apagado: boolean;
  onAbrir: () => void;
}) {
  const excedente = posicaoDoExcedente(eixo.anguloGraus);
  const numero = eixo.total === null ? '—' : String(eixo.total);

  return (
    <g opacity={apagado ? 0.2 : 1}>
      <g
        role="button"
        tabIndex={0}
        aria-label={`${eixo.rotulo}: ${numero} — ${eixo.descricao}`}
        className="cursor-pointer text-muted focus:outline-none"
        onClick={onAbrir}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onAbrir();
          }
        }}
      >
        <circle
          cx={eixo.x}
          cy={eixo.y}
          r={RAIO_DO_EIXO}
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeOpacity={0.5}
        />
        <text
          x={eixo.x}
          y={eixo.y + 4}
          textAnchor="middle"
          className="fill-current font-os-mono text-[12px] font-semibold tabular-nums"
        >
          {numero}
        </text>
        <text
          x={eixo.x}
          y={eixo.y + RAIO_DO_EIXO + 14}
          textAnchor="middle"
          className="fill-current font-os-mono text-[10px] uppercase tracking-[0.14em]"
        >
          {eixo.rotulo}
        </text>
      </g>

      {eixo.excedente > 0 && (
        <g
          role="button"
          tabIndex={0}
          aria-label={`Ver os ${eixo.excedente} registros de ${eixo.rotulo} que não cabem no desenho`}
          className="cursor-pointer text-muted focus:outline-none"
          onClick={onAbrir}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onAbrir();
            }
          }}
        >
          <circle
            cx={excedente.x}
            cy={excedente.y}
            r={15}
            fill="currentColor"
            fillOpacity={0.1}
            stroke="currentColor"
            strokeOpacity={0.4}
            strokeDasharray="3 3"
          />
          <text
            x={excedente.x}
            y={excedente.y + 4}
            textAnchor="middle"
            className="fill-current font-os-mono text-[10px] tabular-nums"
          >
            +{eixo.excedente}
          </text>
        </g>
      )}
    </g>
  );
}

/**
 * Um ponto — e a regra do rótulo.
 *
 * Eixo com poucos registros escreve o nome de todos; eixo cheio escreve o do
 * ponto selecionado, o do que a busca marcou e o do que está sob o cursor. Sem
 * essa regra, vinte notas no mesmo anel viram uma faixa de texto ilegível, que é
 * o jeito mais rápido de um mapa bonito não servir para nada.
 */
function PontoDoMapa({
  no,
  selecionado,
  marcado,
  apagado,
  sempreComRotulo,
  onSelecionar,
}: {
  no: NoDoMapa;
  selecionado: boolean;
  marcado: boolean;
  apagado: boolean;
  sempreComRotulo: boolean;
  onSelecionar: () => void;
}) {
  const rotuloFixo = sempreComRotulo || selecionado || marcado;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${no.rotulo} — ${no.sub}`}
      className={`group cursor-pointer focus:outline-none ${TOM_CLS[no.tom]}`}
      opacity={apagado ? 0.22 : 1}
      onClick={onSelecionar}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelecionar();
        }
      }}
    >
      <title>{`${no.rotulo} — ${no.sub}`}</title>
      {selecionado && (
        <circle
          cx={no.x}
          cy={no.y}
          r={RAIO_DO_NO + 6}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.9}
          strokeWidth={1.5}
        />
      )}
      <circle
        cx={no.x}
        cy={no.y}
        r={RAIO_DO_NO}
        fill="currentColor"
        fillOpacity={selecionado ? 0.4 : 0.18}
        stroke="currentColor"
        strokeOpacity={0.75}
      />
      <text
        x={no.x}
        y={no.y + DESLOCAMENTO_DO_ROTULO}
        textAnchor="middle"
        className={`pointer-events-none fill-current font-os-mono text-[10px] ${
          rotuloFixo ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100'
        }`}
      >
        {curto(no.rotulo)}
      </text>
    </g>
  );
}
