'use client';

/*
 * O MENU DA COLUNA DO QUADRO: "Limite de cartões nesta etapa" (rodada de produção 2,
 * M1, S4, 22/10/2026).
 *
 * Quem pode editar a lista define o limite de cada etapa sem abrir o editor de
 * etapas: `PATCH /trabalho/statuses/:id/limite` com o limite novo e o que a tela
 * leu (`esperado`). A API grava só se ninguém mudou no meio (409), só de gente,
 * auditado. O limite AVISA, NÃO TRAVA: a coluna acima dele aparece marcada
 * (`3/2`) e o arraste continua passando. Vazio = sem limite.
 */
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { LIMITE_MAXIMO_DA_ETAPA, type TrabLimiteDaEtapaResultado } from '@mktos/shared';

import { apiPatch } from '@/lib/api';

export function LimiteDaColuna({ status, token, onMudou, onErro }: {
  status: { id: string; name: string; limite?: number | null };
  token: string | null;
  onMudou: () => void;
  onErro: (m: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  /** Onde o menu abre: fixo na janela, porque a coluna e o quadro cortam o que passa da borda deles. */
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);
  const atual = status.limite ?? null;

  function abrirOuFechar() {
    if (aberto) { fechar(); return; }
    const r = botao.current?.getBoundingClientRect();
    const largura = Math.min(256, window.innerWidth * 0.8);
    setPosicao(r ? { top: r.bottom + 4, left: Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8)) } : null);
    setAberto(true);
    setEditando(false);
    setAviso(null);
  }

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) fechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    // Rolar o quadro ou mudar a janela tira o menu do lugar: fecha.
    const sai = (e: Event) => { if (!(caixa.current && e.target instanceof Node && caixa.current.contains(e.target))) fechar(); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', fechar);
    document.addEventListener('scroll', sai, true);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', fechar);
      document.removeEventListener('scroll', sai, true);
    };
  }, [aberto]);

  function fechar() { setAberto(false); setEditando(false); setAviso(null); }

  async function salvar(limite: number | null) {
    if (limite === atual) { fechar(); return; }
    setSalvando(true);
    setAviso(null);
    try {
      await apiPatch<TrabLimiteDaEtapaResultado>(`/trabalho/statuses/${encodeURIComponent(status.id)}/limite`, { limite, esperado: atual }, token);
      fechar();
      onMudou();
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) { setAviso('O limite mudou desde que a tela foi lida. Recarregue e tente de novo.'); onMudou(); }
      else if (err.status === 403) setAviso(err.message || 'Sem permissão para definir o limite.');
      else onErro(err.message);
    } finally {
      setSalvando(false);
    }
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const v = valor.trim();
    if (v === '') { void salvar(null); return; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > LIMITE_MAXIMO_DA_ETAPA) { setAviso(`Use um número inteiro de 1 a ${LIMITE_MAXIMO_DA_ETAPA}, ou deixe vazio para tirar o limite.`); return; }
    void salvar(n);
  }

  return (
    <div ref={caixa} className="relative normal-case tracking-normal">
      <button
        type="button"
        aria-label={`Menu da etapa ${status.name}`}
        aria-haspopup="menu"
        aria-expanded={aberto}
        ref={botao}
        data-testid={`coluna-menu-${status.id}`}
        onClick={abrirOuFechar}
        className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-2 hover:text-text max-md:h-11 max-md:w-11"
      >
        <MoreHorizontal size={14} />
      </button>
      {aberto && (
        <div
          role="menu"
          data-testid="coluna-menu"
          style={posicao ? { position: 'fixed', top: posicao.top, left: posicao.left } : undefined}
          className={`${posicao ? '' : 'absolute right-0 top-full mt-1 '}z-50 w-[min(16rem,80vw)] rounded-md border border-border bg-surface p-1.5 text-[12px] shadow-lg`}
        >
          {!editando ? (
            <button
              type="button"
              role="menuitem"
              data-testid="coluna-menu-limite"
              onClick={() => { setEditando(true); setValor(atual == null ? '' : String(atual)); }}
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-surface-2"
            >
              Limite de cartões nesta etapa
              <span className="block text-[11px] text-muted">{atual == null ? 'sem limite' : `hoje: ${atual}`}</span>
            </button>
          ) : (
            <form onSubmit={enviar} noValidate className="space-y-1.5 px-1 py-1" data-testid="coluna-limite-form">
              <label className="block text-[11px] text-muted" htmlFor={`limite-${status.id}`}>
                Limite de cartões em {status.name}. Vazio tira o limite; o quadro avisa e não trava.
              </label>
              <input
                id={`limite-${status.id}`}
                data-testid="coluna-limite-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMITE_MAXIMO_DA_ETAPA}
                autoFocus
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="w-full rounded border border-border bg-surface-2 px-2 py-1 outline-none focus:border-brand-dim max-md:min-h-[44px]"
              />
              <div className="flex flex-wrap gap-1.5">
                <button type="submit" disabled={salvando} data-testid="coluna-limite-salvar" className="rounded border border-brand/50 px-2 py-1 text-brand hover:bg-brand/10 disabled:opacity-50 max-md:min-h-[44px]">
                  {salvando ? 'Salvando…' : 'Salvar'}
                </button>
                {atual != null && (
                  <button type="button" disabled={salvando} data-testid="coluna-limite-tirar" onClick={() => void salvar(null)} className="rounded border border-border px-2 py-1 hover:bg-surface-2 disabled:opacity-50 max-md:min-h-[44px]">
                    Sem limite
                  </button>
                )}
                <button type="button" onClick={fechar} className="rounded px-2 py-1 text-muted hover:text-text max-md:min-h-[44px]">Cancelar</button>
              </div>
            </form>
          )}
          {aviso && <p role="alert" data-testid="coluna-limite-aviso" className="mt-1 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-warn">{aviso}</p>}
        </div>
      )}
    </div>
  );
}
