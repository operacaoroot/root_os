'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as EventoDePonteiro, type ReactNode } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, QrCode, Ticket } from 'lucide-react';
import type { TotemCatalogoCampanha } from '@mktos/shared';

import { Juta, Reticula, Selo } from './Marca';
import { destinoDoArrasto, indiceAnterior, indiceSeguro, proximoIndice } from './vitrine';

/*
 * O CARROSSEL DE BANNERS: a vitrine da tela de início e o descanso de tela.
 * Cada banner é uma campanha do painel, no desenho dos posts da marca
 * (chamada em caixa alta, tarja do benefício, juta e retícula quando não há
 * foto). Sem campanha nenhuma, fica o painel da casa: selo e boas-vindas.
 *
 * O texto escala pela largura do próprio banner (`cqw`), porque o mesmo
 * componente ocupa um terço da tela em pé, metade dela deitada e a tela
 * inteira no descanso.
 */

const TROCA_MS = 7000;
const INICIO_DO_ARRASTO_PX = 12;

const TINTA = '#16200F';
const LARANJA = '#CB8139';
const CREME = '#F5F3EC';
const VEU = 'rgba(22,32,15,.55)';
const DEGRADE_DA_FOTO = 'linear-gradient(to top, rgba(31,43,23,.92), rgba(31,43,23,.55) 45%, rgba(31,43,23,0) 75%)';

export type ModoDosBanners = 'vitrine' | 'espera';

export interface BannersProps {
  campanhas: readonly TotemCatalogoCampanha[];
  modo: ModoDosBanners;
  online: boolean;
  cadastroLigado: boolean;
  logoUrl: string | null;
  nomeExibicao: string;
  boasVindas: string;
  aoTocar?: (campanha: TotemCatalogoCampanha) => void;
  className?: string;
}

const CONTEINER = { containerType: 'inline-size' } as CSSProperties;

function Tarja({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-full">
      <span
        className="px-[.4em] py-[.08em] font-[family-name:var(--q-fonte-chamada)] text-[clamp(20px,3cqw,36px)] font-medium uppercase leading-[1.4] tracking-[.06em] [-webkit-box-decoration-break:clone] [box-decoration-break:clone]"
        style={{ backgroundColor: LARANJA, color: TINTA }}
      >
        {children}
      </span>
    </p>
  );
}

function AcaoDoBanner({
  campanha,
  online,
  cadastroLigado,
  aoTocar,
}: {
  campanha: TotemCatalogoCampanha;
  online: boolean;
  cadastroLigado: boolean;
  aoTocar?: (campanha: TotemCatalogoCampanha) => void;
}) {
  const texto = campanha.textoBotao?.trim();
  if (!texto || campanha.acao === 'nenhuma' || !aoTocar) return null;
  if (campanha.acao === 'produtos' && campanha.produtoIds.length === 0) return null;
  if (campanha.acao === 'cadastro') {
    if (!cadastroLigado) return null;
    if (!online) {
      return (
        <p
          className="inline-flex max-w-full items-center gap-3 rounded-[10px] px-5 py-3 text-[clamp(20px,2.6cqw,28px)] font-medium leading-snug"
          style={{ backgroundColor: VEU, color: CREME }}
        >
          <QrCode aria-hidden className="h-8 w-8 shrink-0" />
          Para se cadastrar, aponte o celular para o QR da etiqueta.
        </p>
      );
    }
  }
  const Icone = campanha.acao === 'cadastro' ? Ticket : ArrowRight;
  return (
    <button
      type="button"
      onClick={() => aoTocar(campanha)}
      className="mt-[clamp(4px,1cqw,12px)] inline-flex min-h-[76px] max-w-full items-center gap-4 rounded-[10px] px-8 font-[family-name:var(--q-fonte-chamada)] text-[clamp(24px,3.2cqw,36px)] font-bold uppercase tracking-[.04em] shadow-[0_6px_18px_rgba(22,32,15,.28)] active:translate-y-px active:brightness-95"
      style={{ backgroundColor: LARANJA, color: TINTA }}
    >
      <span className="min-w-0 truncate">{texto}</span>
      <Icone aria-hidden className="h-8 w-8 shrink-0" strokeWidth={2.5} />
    </button>
  );
}

function Banner({
  campanha,
  modo,
  online,
  cadastroLigado,
  aoTocar,
  prioridade,
}: {
  campanha: TotemCatalogoCampanha;
  modo: ModoDosBanners;
  online: boolean;
  cadastroLigado: boolean;
  aoTocar?: (campanha: TotemCatalogoCampanha) => void;
  prioridade: boolean;
}) {
  const [fotoQuebrada, setFotoQuebrada] = useState<string | null>(null);
  const foto = campanha.imagemUrl && fotoQuebrada !== campanha.imagemUrl ? campanha.imagemUrl : null;
  const espera = modo === 'espera';

  return (
    <div className="relative flex h-full w-full flex-col justify-end overflow-hidden bg-[color:var(--q-primaria)]" style={CONTEINER}>
      {foto ? (
        <>
          <img
            src={foto}
            alt=""
            draggable={false}
            decoding="async"
            loading={prioridade ? 'eager' : 'lazy'}
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setFotoQuebrada(foto)}
          />
          <div aria-hidden className="absolute inset-0" style={{ background: DEGRADE_DA_FOTO }} />
        </>
      ) : (
        <>
          <Juta />
          <Reticula className="right-0 top-0 h-[48%] w-[36%]" passo={espera ? 30 : 22} />
        </>
      )}

      <div
        className={`relative flex flex-col items-start gap-[clamp(12px,2cqw,28px)] px-[clamp(24px,5cqw,80px)] pt-[112px] ${
          espera ? 'pb-[clamp(32px,6cqw,96px)]' : 'pb-[clamp(24px,4.5cqw,64px)]'
        }`}
      >
        {campanha.beneficio?.trim() && <Tarja>{campanha.beneficio}</Tarja>}
        <h2
          className={`line-clamp-3 max-w-full break-words py-[.06em] font-[family-name:var(--q-fonte-chamada)] font-bold uppercase leading-[.9] ${
            espera ? 'text-[clamp(48px,9cqw,140px)]' : 'text-[clamp(36px,7.5cqw,92px)]'
          } ${foto ? 'text-[#F5F3EC]' : 'text-[color:var(--q-primaria-chamada)]'}`}
        >
          {campanha.chamada}
        </h2>
        {campanha.textoApoio?.trim() && (
          <p
            className={`line-clamp-3 max-w-[60ch] font-[family-name:var(--q-fonte-chamada)] font-bold uppercase leading-[1.08] tracking-[.02em] ${
              espera ? 'text-[clamp(26px,3.8cqw,56px)]' : 'text-[clamp(22px,3.2cqw,40px)]'
            } ${foto ? 'text-[#EEEAC4]' : 'text-[color:var(--q-primaria-apoio)]'}`}
          >
            {campanha.textoApoio}
          </p>
        )}
        {!espera && <AcaoDoBanner campanha={campanha} online={online} cadastroLigado={cadastroLigado} aoTocar={aoTocar} />}
      </div>
    </div>
  );
}

function PainelDaCasa({
  modo,
  logoUrl,
  nomeExibicao,
  boasVindas,
}: {
  modo: ModoDosBanners;
  logoUrl: string | null;
  nomeExibicao: string;
  boasVindas: string;
}) {
  const espera = modo === 'espera';
  return (
    <div
      className="relative flex h-full w-full flex-col justify-center gap-[clamp(16px,3cqw,40px)] overflow-hidden bg-[color:var(--q-primaria)] px-[clamp(24px,6cqw,96px)] py-10 text-[color:var(--q-sobre-primaria)]"
      style={CONTEINER}
    >
      <Juta />
      <Reticula className="bottom-0 right-0 h-[55%] w-[40%]" passo={espera ? 30 : 22} />
      <Selo src={logoUrl} className="relative" />
      {espera && (
        <p className="relative font-[family-name:var(--q-fonte-chamada)] text-[clamp(22px,3cqw,40px)] font-medium uppercase tracking-[.12em] text-[color:var(--q-primaria-rotulo)]">
          {nomeExibicao}
        </p>
      )}
      <p
        className={`relative max-w-[22ch] font-[family-name:var(--q-fonte-display)] font-semibold leading-[1.12] ${
          espera ? 'text-[clamp(40px,6.4cqw,96px)]' : 'text-[clamp(28px,5cqw,60px)]'
        }`}
      >
        {boasVindas}
      </p>
    </div>
  );
}

function BotaoDeSeta({ direcao, aoTocar }: { direcao: 'anterior' | 'proximo'; aoTocar: () => void }) {
  const Icone = direcao === 'anterior' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={aoTocar}
      aria-label={direcao === 'anterior' ? 'Banner anterior' : 'Próximo banner'}
      className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full active:brightness-75"
      style={{ backgroundColor: VEU, color: CREME }}
    >
      <Icone aria-hidden className="h-10 w-10" strokeWidth={2.5} />
    </button>
  );
}

export function Banners({
  campanhas,
  modo,
  online,
  cadastroLigado,
  logoUrl,
  nomeExibicao,
  boasVindas,
  aoTocar,
  className = '',
}: BannersProps) {
  const total = campanhas.length;
  const [indice, setIndice] = useState(0);
  const atual = indiceSeguro(indice, total);
  const [deslocamento, setDeslocamento] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const arrasto = useRef<{ id: number; x: number; y: number; ativo: boolean } | null>(null);
  const arrastou = useRef(false);

  useEffect(() => {
    if (total <= 1 || arrastando) return;
    const relogio = setTimeout(() => setIndice((i) => proximoIndice(indiceSeguro(i, total), total)), TROCA_MS);
    return () => clearTimeout(relogio);
  }, [atual, total, arrastando]);

  if (total === 0) {
    return (
      <div className={`relative h-full w-full overflow-hidden ${className}`}>
        <PainelDaCasa modo={modo} logoUrl={logoUrl} nomeExibicao={nomeExibicao} boasVindas={boasVindas} />
      </div>
    );
  }

  const vitrine = modo === 'vitrine';

  function apertou(e: EventoDePonteiro<HTMLDivElement>) {
    arrastou.current = false;
    if (total <= 1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    arrasto.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ativo: false };
  }

  function moveu(e: EventoDePonteiro<HTMLDivElement>) {
    const a = arrasto.current;
    if (!a || a.id !== e.pointerId) return;
    const dx = e.clientX - a.x;
    if (!a.ativo) {
      if (Math.abs(dx) < INICIO_DO_ARRASTO_PX || Math.abs(dx) <= Math.abs(e.clientY - a.y)) return;
      a.ativo = true;
      arrastou.current = true;
      setArrastando(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* sem captura o arrasto segue enquanto o dedo estiver no banner */
      }
    }
    setDeslocamento(dx);
  }

  function soltou(e: EventoDePonteiro<HTMLDivElement>, valeu: boolean) {
    const a = arrasto.current;
    if (!a || a.id !== e.pointerId) return;
    arrasto.current = null;
    if (!a.ativo) return;
    if (valeu) setIndice(destinoDoArrasto(atual, total, e.clientX - a.x, e.currentTarget.clientWidth));
    setDeslocamento(0);
    setArrastando(false);
  }

  return (
    <div
      role="region"
      aria-roledescription="carrossel"
      aria-label="Destaques da loja"
      className={`relative h-full w-full touch-pan-y select-none overflow-hidden ${className}`}
      onPointerDown={apertou}
      onPointerMove={moveu}
      onPointerUp={(e) => soltou(e, true)}
      onPointerCancel={(e) => soltou(e, false)}
      onClickCapture={(e) => {
        if (!arrastou.current) return;
        arrastou.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        className={`flex h-full ${arrastando ? '' : 'transition-transform duration-500 ease-out motion-reduce:transition-none'}`}
        style={{ transform: `translateX(calc(${-atual * 100}% + ${deslocamento}px))` }}
      >
        {campanhas.map((c, i) => {
          const visivel = i === atual;
          return (
            <div
              key={c.id}
              role="group"
              aria-roledescription="banner"
              aria-label={`${i + 1} de ${total}`}
              aria-hidden={!visivel}
              inert={!visivel}
              className="h-full w-full shrink-0"
            >
              <Banner
                campanha={c}
                modo={modo}
                online={online}
                cadastroLigado={cadastroLigado}
                aoTocar={aoTocar}
                prioridade={i === 0 || visivel}
              />
            </div>
          );
        })}
      </div>

      {total > 1 && (
        <div className="absolute right-[clamp(16px,2.5vw,40px)] top-[clamp(16px,2.5vw,40px)] z-10 flex items-center gap-3">
          {vitrine && <BotaoDeSeta direcao="anterior" aoTocar={() => setIndice(indiceAnterior(atual, total))} />}
          <div className="flex h-[44px] items-center gap-2 rounded-full px-4" style={{ backgroundColor: VEU }}>
            {campanhas.map((c, i) => (
              <span
                key={c.id}
                aria-hidden
                className={`block h-3 rounded-full transition-all duration-300 motion-reduce:transition-none ${
                  i === atual ? 'w-9 bg-[#CB8139]' : 'w-3 bg-[#F5F3EC]/70'
                }`}
              />
            ))}
            <span className="sr-only">
              Banner {atual + 1} de {total}
            </span>
          </div>
          {vitrine && <BotaoDeSeta direcao="proximo" aoTocar={() => setIndice(proximoIndice(atual, total))} />}
        </div>
      )}
    </div>
  );
}

