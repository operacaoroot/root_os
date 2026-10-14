'use client';

/*
 * O PAINEL DO LEAD (lane UX, 13/10/2026). Toda ação sobre um lead abre aqui,
 * por cima da tela em que a pessoa está: no desktop um painel à direita (720
 * px, nunca mais de 90% da largura); no celular uma folha de baixo para cima,
 * na tela inteira. As abas são as telas de antes (fio, sessão, dinheiro,
 * decisões) e chamam as MESMAS rotas: nada aqui grava etapa nem contorna portão.
 *
 * Acessibilidade: `role="dialog"` com `aria-modal` e o nome do lead como
 * rótulo; o foco entra no título, fica preso dentro e volta a quem abriu; `Esc`
 * e o clique no fundo fecham (com confirmação só se houver texto digitado e
 * não salvo); a página de trás fica inerte e sem rolagem, sem salto de layout.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DecisaoNaFila, FichaDoLead } from '@mktos/shared';
import { COMERCIAL_ROTULO_DA_ETAPA, ehSaida } from '@mktos/shared';

import { AUSENTE, numeroOuAusente } from '@/lib/cockpit';

import { BarraDaSaude, BOTAO, Chip, Erro, FOCO, useCarregar } from '../_ui';
import { ABAS_DO_PAINEL, ROTULO_DA_ABA, linkDoWhatsApp, type AbaDoPainel, type EstadoDoPainel } from './estado';
import { usePainel } from './provedor';
import { AbaFio } from './AbaFio';
import { AbaSessao } from './AbaSessao';
import { AbaDinheiro } from './AbaDinheiro';
import { AbaDecisoes } from './AbaDecisoes';

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Há texto digitado no painel que nenhum envio levou? (campo de texto, de senha ou área de texto com valor). */
export function temTextoNaoSalvo(raiz: HTMLElement | null): boolean {
  if (!raiz) return false;
  const campos = raiz.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input:not([type]), input[type="text"], input[type="password"], input[type="search"], input[type="email"]');
  return Array.from(campos).some((c) => !c.disabled && !c.hasAttribute('data-painel-ignorar') && c.value.trim().length > 0);
}

export const PERGUNTA_DO_TEXTO_NAO_SALVO = 'Há texto digitado e não salvo no painel. Fechar e perder o texto?';

/** As respostas que o painel lê do lead: a ficha (uma chamada), as decisões e, com o provedor simulado, a sala. */
function useLeadDoPainel(leadId: string) {
  const ficha = useCarregar<FichaDoLead>(`/comercial/lead/${encodeURIComponent(leadId)}`, 30_000);
  const decisoes = useCarregar<DecisaoNaFila[]>('/comercial/decisoes', 30_000);
  // O simulador só existe com o provedor simulado: fora dele a rota falha e o painel usa o telefone.
  const celular = useCarregar<{ linkDaSala: string | null }>(`/comercial/simulador/lead/${encodeURIComponent(leadId)}`);
  return { ficha, decisoes, celular };
}

export function LeadPainel({ estado }: { estado: EstadoDoPainel }) {
  const painel = usePainel();
  const { leadId, aba } = estado;
  const { ficha, decisoes, celular } = useLeadDoPainel(leadId);
  const caixa = useRef<HTMLDivElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const idTitulo = useId();
  const idAbas = useId();
  const [alvo, setAlvo] = useState<HTMLElement | null>(null);

  // O portal vai para o <body>, fora da árvore que fica inerte.
  useEffect(() => setAlvo(document.body), []);

  const f = ficha.dados;
  const abertasDoLead = (decisoes.dados ?? []).filter((d) => d.leadId === leadId && d.estado === 'aberta');
  const doLead = (decisoes.dados ?? []).filter((d) => d.leadId === leadId);

  const fecharComCuidado = useCallback(() => {
    if (temTextoNaoSalvo(caixa.current) && !window.confirm(PERGUNTA_DO_TEXTO_NAO_SALVO)) return;
    painel.fechar();
  }, [painel]);

  /** Depois de uma ação no painel: relê o lead e as decisões, e a tela de trás relê a lista. */
  const aoMudar = useCallback(async () => {
    await Promise.all([ficha.recarregar(), decisoes.recarregar()]);
    painel.mudou();
  }, [ficha, decisoes, painel]);

  // Foco no título ao abrir; a página de trás fica inerte e sem rolagem.
  useEffect(() => {
    if (!alvo) return;
    titulo.current?.focus();
    const body = document.body;
    const largura = window.innerWidth - document.documentElement.clientWidth;
    const antes = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    body.style.overflow = 'hidden';
    if (largura > 0) body.style.paddingRight = `${largura}px`;
    const inertes: Element[] = [];
    for (const el of Array.from(body.children)) {
      if (el.hasAttribute('data-painel-do-lead') || el.hasAttribute('data-avisos-do-canto') || el.tagName === 'SCRIPT') continue;
      if (el.hasAttribute('inert')) continue;
      el.setAttribute('inert', '');
      inertes.push(el);
    }
    return () => {
      body.style.overflow = antes.overflow;
      body.style.paddingRight = antes.paddingRight;
      for (const el of inertes) el.removeAttribute('inert');
    };
  }, [alvo]);

  // Esc fecha, de onde estiver o foco.
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      fecharComCuidado();
    }
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [fecharComCuidado]);

  // O foco fica preso dentro do painel enquanto ele está aberto.
  function prenderFoco(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !caixa.current) return;
    const lista = Array.from(caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)).filter((el) => el.tabIndex >= 0 && !el.closest('[inert], [hidden]'));
    if (lista.length === 0) {
      e.preventDefault();
      titulo.current?.focus();
      return;
    }
    const primeiro = lista[0];
    const ultimo = lista[lista.length - 1];
    const ativo = document.activeElement;
    if (e.shiftKey && (ativo === primeiro || ativo === titulo.current || !caixa.current.contains(ativo))) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (ativo === ultimo || !caixa.current.contains(ativo))) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  function teclaNasAbas(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = ABAS_DO_PAINEL.indexOf(aba);
    let j: number | null = null;
    if (e.key === 'ArrowRight') j = (i + 1) % ABAS_DO_PAINEL.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + ABAS_DO_PAINEL.length) % ABAS_DO_PAINEL.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = ABAS_DO_PAINEL.length - 1;
    if (j == null) return;
    e.preventDefault();
    const nova = ABAS_DO_PAINEL[j];
    painel.trocarAba(nova);
    requestAnimationFrame(() => document.getElementById(`${idAbas}-${nova}`)?.focus());
  }

  if (!alvo) return null;

  const nome = f ? f.empresa ?? f.nome : ficha.erro ? 'Lead' : 'Carregando o lead…';
  const sala = celular.dados?.linkDaSala ?? null;
  const whats = celular.dados ? `/comercial/simulador?conversa=${encodeURIComponent(leadId)}` : linkDoWhatsApp(f?.telefone);

  return createPortal(
    <div data-painel-do-lead data-os-app className="fixed inset-0 z-[60]">
      <div
        aria-hidden
        data-fundo-do-painel
        className="absolute inset-0 bg-black/55 motion-safe:animate-[fundo-entra_160ms_ease-out]"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) fecharComCuidado();
        }}
      />
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onKeyDown={prenderFoco}
        className="absolute inset-0 flex flex-col bg-bg text-text shadow-2xl motion-safe:animate-[folha-sobe_220ms_ease-out] md:inset-y-0 md:left-auto md:right-0 md:w-[min(720px,90vw)] md:border-l md:border-border md:motion-safe:animate-[painel-entra_200ms_ease-out]"
      >
        <header className="shrink-0 border-b border-border bg-bg2 px-4 pt-3 md:px-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={idTitulo} ref={titulo} tabIndex={-1} className="truncate text-[18px] font-semibold leading-tight outline-none md:text-[19px]">
                {nome}
              </h2>
              <p className="mt-0.5 truncate text-[12.5px] text-muted">
                {f ? (f.empresa && f.empresa !== f.nome ? f.nome : f.telefone ?? 'telefone ausente') : ' '}
              </p>
            </div>
            <button type="button" onClick={fecharComCuidado} aria-label="fechar o painel do lead" className={`${BOTAO} shrink-0 max-md:min-w-[44px]`}>
              fechar
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
            {f ? (
              <>
                <Chip tom={ehSaida(f.etapa) ? 'alerta' : f.etapa === 'fechado' ? 'bom' : 'brand'}>{COMERCIAL_ROTULO_DA_ETAPA[f.etapa]}</Chip>
                <span className="flex w-28 flex-col">
                  <BarraDaSaude saude={f.saude} />
                  <span className="mt-0.5 text-[11px] text-dim">saúde {numeroOuAusente(f.saude)}</span>
                </span>
                <span className="text-muted">dono: <span className="text-text">{f.dono?.nome ?? AUSENTE}</span></span>
              </>
            ) : (
              <span className="h-5 w-48 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" aria-hidden />
            )}
            <span className="ml-auto flex gap-2">
              {sala ? (
                <a href={sala} target="_blank" rel="noreferrer" className={BOTAO}>abrir sala</a>
              ) : (
                <span className={`${BOTAO} cursor-default opacity-50`} title="a sala ainda não existe ou o link não pôde ser lido">sala ausente</span>
              )}
              {whats ? (
                <a href={whats} target={whats.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={BOTAO}>WhatsApp</a>
              ) : (
                <span className={`${BOTAO} cursor-default opacity-50`} title="telefone ausente">WhatsApp</span>
              )}
            </span>
          </div>

          <div role="tablist" aria-label="partes do lead" onKeyDown={teclaNasAbas} className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 md:-mx-5 md:px-5">
            {ABAS_DO_PAINEL.map((a) => {
              const ativa = a === aba;
              const conta = a === 'decisoes' && abertasDoLead.length > 0 ? abertasDoLead.length : null;
              return (
                <button
                  key={a}
                  id={`${idAbas}-${a}`}
                  type="button"
                  role="tab"
                  aria-selected={ativa}
                  aria-controls={`${idAbas}-painel`}
                  tabIndex={ativa ? 0 : -1}
                  onClick={() => painel.trocarAba(a)}
                  className={`shrink-0 border-b-2 px-3 pb-2 pt-1.5 text-[13px] transition max-md:min-h-[44px] ${ativa ? 'border-brand font-semibold text-text' : 'border-transparent text-muted hover:text-text'} ${FOCO}`}
                >
                  {ROTULO_DA_ABA[a]}
                  {conta != null && <span className="ml-1.5 rounded bg-brand/15 px-1.5 font-os-mono text-[10.5px] tabular-nums text-brand">{conta}</span>}
                </button>
              );
            })}
          </div>
        </header>

        <div id={`${idAbas}-painel`} role="tabpanel" aria-labelledby={`${idAbas}-${aba}`} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 outline-none md:px-5">
          <Erro erro={ficha.erro} aoTentar={() => void ficha.recarregar()} />
          {aba === 'fio' && <AbaFio leadId={leadId} ficha={f} carregando={ficha.carregando && !f} aoMudar={aoMudar} />}
          {aba === 'sessao' && <AbaSessao leadId={leadId} aoMudar={aoMudar} irParaDecisoes={() => painel.trocarAba('decisoes')} />}
          {aba === 'dinheiro' && <AbaDinheiro leadId={leadId} ficha={f} aoMudar={aoMudar} />}
          {aba === 'decisoes' && (
            <AbaDecisoes decisoes={doLead} carregando={decisoes.carregando && !decisoes.dados} erro={decisoes.erro} aoTentar={() => void decisoes.recarregar()} aoMudar={aoMudar} />
          )}
        </div>
      </div>
    </div>,
    alvo,
  );
}

export type { AbaDoPainel };
