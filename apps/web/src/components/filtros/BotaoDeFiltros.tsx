'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  contarFiltrosAtivos,
  type DefinicaoDeFiltro,
  type ValoresDeFiltro,
} from './filtros';

export type { DefinicaoDeFiltro, ValoresDeFiltro } from './filtros';

/*
 * O BOTÃO "FILTROS (n)" E O PAINEL (rodada da interface U2, 20/10/2026).
 *
 * Um botão só no cabeçalho, ao lado das vistas salvas. Abre um painel com todos
 * os filtros que a tela declarou: popover no desktop, folha de baixo para cima
 * no celular. Cada filtro tem "limpar"; o painel tem "Limpar tudo". Fechar não
 * perde nada: o valor já foi escrito (a tela guarda no endereço).
 *
 * Acessibilidade: `role="dialog"` com o título "Filtros", o foco entra no
 * primeiro controle, Tab e Shift+Tab giram dentro do painel enquanto ele está
 * aberto, Esc fecha e devolve o foco ao botão. Clique fora fecha. O "limpar"
 * de um filtro some ao ser clicado e o "Limpar tudo" fica desabilitado: nos dois
 * casos o foco vai a um controle do painel (o do filtro limpo, ou o primeiro),
 * em vez de cair no body com o painel aberto. Sem biblioteca: o painel é
 * posicionado por CSS relativo ao botão.
 */

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
const CAMPO = `w-full rounded border border-border bg-surface px-2 py-1.5 text-[13px] text-text outline-none max-md:min-h-[44px] ${FOCO}`;

export function BotaoDeFiltros({
  filtros,
  valores,
  aoMudar,
  aoLimparTudo,
  testId = 'filtros',
  alinhar = 'direita',
  rotulo = 'Filtros',
}: {
  filtros: readonly DefinicaoDeFiltro[];
  valores: ValoresDeFiltro;
  aoMudar: (chave: string, valor: string) => void;
  aoLimparTudo: () => void;
  /** Prefixo dos `data-testid` (`<testId>-botao`, `<testId>-painel`, `<testId>-<chave>`). */
  testId?: string;
  alinhar?: 'esquerda' | 'direita';
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const idTitulo = useId();
  const ativos = contarFiltrosAtivos(filtros, valores);

  const primeiroControle = () =>
    painel.current?.querySelector<HTMLElement>('[data-corpo] select, [data-corpo] input')
      ?? painel.current?.querySelector<HTMLElement>('button:not([disabled])');

  const fechar = (devolverFoco = true) => {
    setAberto(false);
    if (devolverFoco) requestAnimationFrame(() => botao.current?.focus());
  };

  useEffect(() => {
    if (!aberto) return;
    // O foco entra no primeiro filtro, não no X de fechar.
    primeiroControle()?.focus();

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        fechar();
        return;
      }
      if (e.key !== 'Tab' || !painel.current) return;
      const todos = Array.from(
        painel.current.querySelectorAll<HTMLElement>('select, input, button:not([disabled]), a[href]'),
      );
      // Só os visíveis; sem medida de layout (jsdom), todos.
      const visiveis = todos.filter((el) => el.getClientRects().length > 0);
      const controles = visiveis.length ? visiveis : todos;
      if (!controles.length) return;
      const prim = controles[0];
      const ult = controles[controles.length - 1];
      if (e.shiftKey && document.activeElement === prim) { e.preventDefault(); ult.focus(); }
      else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); prim.focus(); }
    }
    function aoClicarFora(e: MouseEvent | TouchEvent) {
      const alvo = e.target as Node;
      if (painel.current?.contains(alvo) || botao.current?.contains(alvo)) return;
      fechar(false);
    }
    document.addEventListener('keydown', aoTeclar);
    document.addEventListener('mousedown', aoClicarFora);
    document.addEventListener('touchstart', aoClicarFora);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('mousedown', aoClicarFora);
      document.removeEventListener('touchstart', aoClicarFora);
    };
    // fechar é estável o bastante: só mexe em estado e no ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  return (
    <div className="relative">
      <button
        ref={botao}
        type="button"
        data-testid={`${testId}-botao`}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={() => (aberto ? fechar() : setAberto(true))}
        className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[12.5px] max-md:min-h-[44px] ${ativos ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-muted hover:text-text'} ${FOCO}`}
      >
        <SlidersHorizontal size={14} aria-hidden />
        {rotulo}
        {ativos > 0 && <span data-testid={`${testId}-contagem`} aria-label={`${ativos} ativo${ativos === 1 ? '' : 's'}`}>({ativos})</span>}
      </button>

      {aberto && (
        <>
          <div aria-hidden className="fixed inset-0 z-40 bg-black/50 md:hidden" />
          <div
            ref={painel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={idTitulo}
            data-testid={`${testId}-painel`}
            className={[
              'z-50 flex flex-col border border-border bg-bg2 shadow-lg',
              'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[80dvh] max-md:rounded-t-lg',
              'md:absolute md:top-full md:mt-1 md:max-h-[70vh] md:w-[340px] md:rounded',
              alinhar === 'direita' ? 'md:right-0' : 'md:left-0',
            ].join(' ')}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <h2 id={idTitulo} className="text-[13px] font-semibold text-text">{rotulo}</h2>
              <button type="button" aria-label="Fechar filtros" onClick={() => fechar()} className={`grid h-8 w-8 place-items-center text-muted hover:text-text max-md:h-11 max-md:w-11 ${FOCO}`}>
                <X size={16} aria-hidden />
              </button>
            </div>
            <div data-corpo className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {filtros.map((d) => (
                <CampoDeFiltro key={d.chave} def={d} valor={valores[d.chave] ?? ''} aoMudar={aoMudar} testId={testId} />
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
              <button
                type="button"
                data-testid={`${testId}-limpar-tudo`}
                disabled={ativos === 0}
                onClick={() => {
                  aoLimparTudo();
                  // O botão fica desabilitado: o foco vai ao primeiro filtro, não ao body.
                  primeiroControle()?.focus();
                }}
                className={`rounded border border-border px-2.5 py-1.5 text-[12.5px] text-muted hover:text-text disabled:opacity-50 max-md:min-h-[44px] ${FOCO}`}
              >
                Limpar tudo
              </button>
              <button type="button" onClick={() => fechar()} className={`rounded bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-ink max-md:min-h-[44px] ${FOCO}`}>
                Pronto
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CampoDeFiltro({ def, valor, aoMudar, testId }: {
  def: DefinicaoDeFiltro;
  valor: string;
  aoMudar: (chave: string, valor: string) => void;
  testId: string;
}) {
  const id = useId();
  const controle = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const guardar = (el: HTMLInputElement | HTMLSelectElement | null) => { controle.current = el; };
  const ativo = valor.trim() !== '';
  const limpar = ativo ? (
    <button
      type="button"
      data-testid={`${testId}-limpar-${def.chave}`}
      aria-label={`Limpar ${def.rotulo}`}
      onClick={() => {
        aoMudar(def.chave, '');
        // O "limpar" some com o valor: o foco vai ao controle do filtro, não ao body.
        controle.current?.focus();
      }}
      className={`text-[11px] text-muted underline-offset-2 hover:text-text hover:underline ${FOCO}`}
    >
      limpar
    </button>
  ) : null;

  if (def.tipo === 'booleano') {
    const marcado = def.valorMarcado ?? '1';
    return (
      <div className="flex items-center justify-between gap-2 py-1.5">
        <label htmlFor={id} className="flex items-center gap-2 text-[13px] text-text max-md:min-h-[44px]">
          <input
            ref={guardar}
            id={id}
            type="checkbox"
            data-testid={`${testId}-${def.chave}`}
            checked={valor === marcado}
            onChange={(e) => aoMudar(def.chave, e.target.checked ? marcado : '')}
            className={FOCO}
          />
          {def.rotulo}
        </label>
        {limpar}
      </div>
    );
  }

  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] uppercase tracking-[0.08em] text-muted">{def.rotulo}</label>
        {limpar}
      </div>
      {def.tipo === 'texto' ? (
        <input
          ref={guardar}
          id={id}
          type="search"
          data-testid={`${testId}-${def.chave}`}
          value={valor}
          placeholder={def.placeholder}
          onChange={(e) => aoMudar(def.chave, e.target.value)}
          className={CAMPO}
        />
      ) : (
        <select
          ref={guardar}
          id={id}
          data-testid={`${testId}-${def.chave}`}
          value={valor}
          onChange={(e) => aoMudar(def.chave, e.target.value)}
          className={CAMPO}
        >
          <option value="">{def.vazio ?? 'Todos'}</option>
          {(def.opcoes ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          {/* Valor do endereço que não está nas opções (link antigo, opção que ainda carrega): mostra em vez de sumir. */}
          {ativo && !(def.opcoes ?? []).some((o) => o.valor === valor) && <option value={valor}>{valor}</option>}
        </select>
      )}
      {!def.opcoes?.length && def.tipo !== 'texto' && def.semOpcoes && <p className="mt-1 text-[11px] text-muted">{def.semOpcoes}</p>}
      {def.dica && <p className="mt-1 text-[11px] text-muted">{def.dica}</p>}
    </div>
  );
}
