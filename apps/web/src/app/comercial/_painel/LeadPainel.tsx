'use client';

/*
 * O PAINEL DO LEAD (lane UX, 13/10/2026; enxuto na leva 5, L4, 27/10/2026).
 * Toda ação sobre um lead abre aqui, por cima da tela em que a pessoa está:
 * no desktop uma janela no centro; no celular uma folha de baixo para cima,
 * na tela inteira.
 *
 * LEVA 5 (L4, itens 11 e 16 da reunião de 26/10): "mais visual e mais
 * objetivo, não precisa de tantas informações". A primeira tela é a aba GERAL
 * (três cartões: Quem · Origem · Negócio, no modelo da ficha Sessão
 * Estratégica); a segunda, PENDÊNCIAS E SUGESTÕES (o que falta preencher e os
 * próximos passos, com "fazer" e "marcar como feito"); depois Sala e WhatsApp.
 * Fio, Dinheiro, Decisões e Sessão saíram da fila (`estado.ts`) mas seguem
 * vivas por link direto, e o que elas mostravam continua gravado: o
 * "Histórico" do cabeçalho abre o AuditLog do lead. Os editores que moravam
 * no cabeçalho (nome e empresa, tipo do negócio, valor, vendedor, canal)
 * agora são campos da Geral.
 *
 * Acessibilidade: `role="dialog"` com `aria-modal` e o nome do lead como
 * rótulo; o foco entra no título, fica preso dentro e volta a quem abriu; `Esc`
 * e o clique no fundo fecham (com confirmação só se houver texto digitado e
 * não salvo); a página de trás fica inerte e sem rolagem, sem salto de layout.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { DecisaoNaFila, FichaDoLead, FichaGeralExtra } from '@mktos/shared';
import { COMERCIAL_ROTULO_DA_ETAPA, ehSaida } from '@mktos/shared';

import { PastaDoCliente } from '@/components/clientes/PastaDoCliente';
import { AUSENTE, numeroOuAusente } from '@/lib/cockpit';

import { BarraDaSaude, BOTAO, Chip, Erro, FOCO, NivelDoRotulo, useCarregar } from '../_ui';
import { ROTULO_DA_ABA, abasNaTela, linkDoWhatsApp, type AbaDoPainel, type EstadoDoPainel } from './estado';
import { ListaDeAvisos, usePainel } from './provedor';
import { podeSairSemPerder } from './texto-nao-salvo';
import { HistoricoDaEntidade, TIPO_DA_ENTIDADE_DO_LEAD } from './historico';
import { useVarianteDoPainel } from './variante';
import { AbaGeral } from './AbaGeral';
import { AbaPendencias } from './AbaPendencias';
import { AbaFio } from './AbaFio';
import { AbaSessao } from './AbaSessao';
import { AbaDinheiro } from './AbaDinheiro';
import { AbaDecisoes } from './AbaDecisoes';
import { AbaSala } from './AbaSala';
import { AbaWhatsapp } from './AbaWhatsapp';

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** As respostas que o painel lê do lead: a ficha, o extra da Geral (leva 5), as decisões e, com o provedor simulado, a sala. */
function useLeadDoPainel(leadId: string) {
  const ficha = useCarregar<FichaDoLead>(`/comercial/lead/${encodeURIComponent(leadId)}`, 30_000);
  const extra = useCarregar<FichaGeralExtra>(`/comercial/lead/${encodeURIComponent(leadId)}/geral`, 60_000);
  // As abertas vêm por consulta própria: a lista geral da empresa para em 200 e as abertas não podem ficar de fora.
  const abertas = useCarregar<DecisaoNaFila[]>('/comercial/decisoes?estado=aberta', 30_000);
  const decisoes = useCarregar<DecisaoNaFila[]>('/comercial/decisoes', 30_000);
  // O simulador só existe com o provedor simulado: fora dele a rota falha e o painel usa o telefone.
  const celular = useCarregar<{ linkDaSala: string | null }>(`/comercial/simulador/lead/${encodeURIComponent(leadId)}`);
  return { ficha, extra, abertas, decisoes, celular };
}

/** O teto da lista de decisões da API (`decisoes.service.ts`, take 200): chegou nele, a lista do lead pode estar incompleta. */
const TETO_DA_LISTA_DE_DECISOES = 200;

export function LeadPainel({ estado }: { estado: EstadoDoPainel }) {
  const painel = usePainel();
  const { leadId, aba, campo } = estado;
  const { ficha, extra, abertas, decisoes, celular } = useLeadDoPainel(leadId);
  const caixa = useRef<HTMLDivElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const idTitulo = useId();
  const idAbas = useId();
  const [alvo, setAlvo] = useState<HTMLElement | null>(null);
  // Leva 5: o Histórico (AuditLog do lead) abre por um link discreto no cabeçalho; a variante A/B da Geral.
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [variante, alternarVariante] = useVarianteDoPainel();

  // O portal vai para o <body>, fora da árvore que fica inerte.
  useEffect(() => setAlvo(document.body), []);

  const f = ficha.dados;
  const abertasDoLead = (abertas.dados ?? []).filter((d) => d.leadId === leadId && d.estado === 'aberta');
  const fechadasDoLead = (decisoes.dados ?? []).filter((d) => d.leadId === leadId && d.estado !== 'aberta');
  const listaParcial = (decisoes.dados?.length ?? 0) >= TETO_DA_LISTA_DE_DECISOES;

  const fecharComCuidado = useCallback(() => {
    if (!podeSairSemPerder(caixa.current)) return;
    painel.fechar();
  }, [painel]);

  /** Trocar de aba desmonta a de agora: com texto digitado, pergunta antes. `campo` leva o foco a um campo da Geral. */
  const irParaAba = useCallback(
    (nova: AbaDoPainel, campoAFocar?: string | null) => {
      if (nova === aba && !campoAFocar) return true;
      if (nova !== aba && !podeSairSemPerder(caixa.current)) return false;
      painel.trocarAba(nova, campoAFocar ?? null);
      return true;
    },
    [aba, painel],
  );

  /**
   * Depois de uma ação no painel: relê o lead, o extra e as decisões, e a tela
   * de trás relê a lista. Se o botão que tinha o foco sumiu (a decisão saiu, a
   * saída foi registrada), o foco vai ao título do painel e não cai no <body>.
   */
  const aoMudar = useCallback(async () => {
    await Promise.all([ficha.recarregar(), extra.recarregar(), abertas.recarregar(), decisoes.recarregar()]);
    painel.mudou();
    requestAnimationFrame(() => {
      const ativo = document.activeElement;
      if (!ativo || ativo === document.body || !caixa.current?.contains(ativo)) titulo.current?.focus();
    });
  }, [ficha, extra, abertas, decisoes, painel]);

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

  // Esc fecha, de onde estiver o foco (com o Histórico aberto, fecha só ele).
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      // Esc durante a composição de um acento (método de entrada) não fecha nada.
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      e.preventDefault();
      if (historicoAberto) {
        setHistoricoAberto(false);
        return;
      }
      fecharComCuidado();
    }
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [fecharComCuidado, historicoAberto]);

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

  const abas = abasNaTela(aba);

  function teclaNasAbas(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = abas.indexOf(aba);
    let j: number | null = null;
    if (e.key === 'ArrowRight') j = (i + 1) % abas.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + abas.length) % abas.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = abas.length - 1;
    if (j == null) return;
    e.preventDefault();
    const nova = abas[j];
    if (!irParaAba(nova)) return;
    requestAnimationFrame(() => document.getElementById(`${idAbas}-${nova}`)?.focus());
  }

  if (!alvo) return null;

  const nome = f ? f.empresa ?? f.nome : 'Lead';
  const sala = celular.dados?.linkDaSala ?? null;
  const whats = celular.dados ? `/whatsapp/simulador?conversa=${encodeURIComponent(leadId)}` : linkDoWhatsApp(f?.telefone);

  return createPortal(
    <div data-painel-do-lead data-os-app className="fixed inset-0 z-[60]">
      {/* Layout 26/10: no computador abre no centro, como a janela do Financeiro (antes era gaveta à direita). */}
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
        className="absolute inset-0 flex flex-col bg-bg text-text shadow-2xl motion-safe:animate-[folha-sobe_220ms_ease-out] md:inset-auto md:left-1/2 md:top-[4vh] md:h-[92vh] md:w-[min(1040px,94vw)] md:-translate-x-1/2 md:overflow-hidden md:rounded-xl md:border md:border-border md:motion-safe:animate-[fundo-entra_160ms_ease-out]"
      >
        <header className="shrink-0 border-b border-border bg-bg2 px-4 pt-3 md:px-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {/* O título recebe o foco ao abrir só para o leitor de tela anunciar o lead: sem contorno. */}
              <h2 id={idTitulo} ref={titulo} tabIndex={-1} style={{ outline: 'none' }} title={nome} className="truncate text-[18px] font-semibold leading-tight md:text-[19px]">
                {nome}
              </h2>
              <p className="mt-0.5 truncate text-[12.5px] text-muted">
                {f ? (f.empresa && f.empresa !== f.nome ? f.nome : f.telefone ?? 'telefone ausente') : ' '}
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
                {/* CO-10 (rodada dos agentes): a pasta do cliente no Drive, ou "Criar pasta" (de novo, se falhou). */}
                {f.pasta?.partnerId && <PastaDoCliente partnerId={f.pasta.partnerId} url={f.pasta.url} erro={f.pasta.erro} compacto />}
              </>
            ) : (
              <span className="h-5 w-48 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" aria-hidden />
            )}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {/* Leva 5: o Histórico (quem, quando, antes e depois) e a variante A/B da Geral, discretos. */}
              <button
                type="button"
                data-testid="painel-historico"
                onClick={() => setHistoricoAberto(true)}
                className={`rounded-sm text-[12px] text-muted underline decoration-border underline-offset-2 hover:text-brand max-md:min-h-[44px] ${FOCO}`}
              >
                Histórico
              </button>
              {aba === 'geral' && (
                <button
                  type="button"
                  data-testid="painel-variante"
                  onClick={alternarVariante}
                  title={variante === 'A' ? 'A: três cartões lado a lado. Clique para ver a B (cartões e linha do tempo).' : 'B: cartões à esquerda e linha do tempo à direita. Clique para ver a A.'}
                  className={`rounded border border-border px-1.5 font-os-mono text-[10px] text-muted hover:border-brand hover:text-text max-md:min-h-[44px] ${FOCO}`}
                >
                  Variante {variante}
                </button>
              )}
              {sala ? (
                <a href={sala} target="_blank" rel="noreferrer" className={BOTAO}>abrir sala</a>
              ) : f?.ligadoA.sala ? (
                <span className={`${BOTAO} cursor-default opacity-60`} title="o link da sala só é reescrito pelo simulador nesta versão">sala aberta, link indisponível</span>
              ) : (
                <span className={`${BOTAO} cursor-default opacity-50`} title="a sala ainda não existe">sala ausente</span>
              )}
              {whats && whats.startsWith('/') ? (
                <Link href={whats} className={BOTAO}>WhatsApp</Link>
              ) : whats ? (
                <a href={whats} target="_blank" rel="noreferrer" className={BOTAO}>WhatsApp</a>
              ) : (
                <span className={`${BOTAO} cursor-default opacity-50`} title="telefone ausente">WhatsApp</span>
              )}
            </span>
          </div>

          <div role="tablist" aria-label="partes do lead" onKeyDown={teclaNasAbas} className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 md:-mx-5 md:px-5">
            {abas.map((a) => {
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
                  onClick={() => irParaAba(a)}
                  className={`shrink-0 border-b-2 px-3 pb-2 pt-1.5 text-[13px] transition max-md:min-h-[44px] ${ativa ? 'border-brand font-semibold text-text' : 'border-transparent text-muted hover:text-text'} ${FOCO}`}
                >
                  {ROTULO_DA_ABA[a]}
                  {conta != null && <span className="ml-1.5 rounded bg-brand/15 px-1.5 font-os-mono text-[10.5px] tabular-nums text-brand">{conta}</span>}
                </button>
              );
            })}
          </div>
        </header>

        {/* tabIndex 0: o corpo rola pelo teclado mesmo quando a aba não tem nada focável (fio de um lead fechado). */}
        <div
          id={`${idAbas}-painel`}
          role="tabpanel"
          aria-labelledby={`${idAbas}-${aba}`}
          tabIndex={0}
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-5 ${FOCO}`}
        >
          <NivelDoRotulo.Provider value="h3">
            <Erro erro={ficha.erro} aoTentar={() => void ficha.recarregar()} />
            {aba === 'geral' && (
              <AbaGeral
                leadId={leadId}
                ficha={f}
                extra={extra.dados}
                carregando={ficha.carregando && !f}
                variante={variante}
                campoFocado={campo ?? null}
                aoMudar={aoMudar}
                abrirHistorico={() => setHistoricoAberto(true)}
              />
            )}
            {aba === 'pendencias' && (
              <AbaPendencias leadId={leadId} ficha={f} extra={extra.dados} aoMudar={aoMudar} irParaAba={irParaAba} />
            )}
            {aba === 'fio' && <AbaFio leadId={leadId} ficha={f} carregando={ficha.carregando && !f} aoMudar={aoMudar} />}
            {aba === 'sessao' && <AbaSessao leadId={leadId} aoMudar={aoMudar} irParaDecisoes={() => irParaAba('decisoes')} />}
            {aba === 'dinheiro' && <AbaDinheiro leadId={leadId} ficha={f} aoMudar={aoMudar} />}
            {aba === 'sala' && <AbaSala leadId={leadId} aoMudar={aoMudar} />}
            {aba === 'whatsapp' && <AbaWhatsapp leadId={leadId} ficha={f} aoMudar={aoMudar} />}
            {aba === 'decisoes' && (
              <AbaDecisoes
                abertas={abertasDoLead}
                fechadas={fechadasDoLead}
                listaParcial={listaParcial}
                carregando={abertas.carregando && !abertas.dados}
                erro={abertas.erro ?? decisoes.erro}
                aoTentar={() => void Promise.all([abertas.recarregar(), decisoes.recarregar()])}
                aoMudar={aoMudar}
              />
            )}
          </NivelDoRotulo.Provider>
        </div>
        <ListaDeAvisos avisos={painel.avisos} aoFechar={painel.dispensar} />
        {/* Leva 5 (L2/L4): o AuditLog do lead, por cima do painel. O componente é do agente do L2. */}
        {historicoAberto && (
          <HistoricoDaEntidade entityId={leadId} entityType={TIPO_DA_ENTIDADE_DO_LEAD} titulo={`Histórico de ${nome}`} aberto={historicoAberto} onFechar={() => setHistoricoAberto(false)} />
        )}
      </div>
    </div>,
    alvo,
  );
}

export type { AbaDoPainel };
