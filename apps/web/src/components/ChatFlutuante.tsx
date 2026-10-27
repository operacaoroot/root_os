'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, X, CornerDownLeft, Square } from 'lucide-react';
import { apiStream } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { enderecoDaCaixa, type EstadoDaCaixa } from '@/lib/caixa-whatsapp';
import { CaixaDoWhatsapp } from '@/app/whatsapp/_caixa/CaixaDoWhatsapp';
import { fraseDaBolha, textoDaBolha, useNaoLidasDoWhatsapp } from './whatsapp/bolha-do-whatsapp';
import { conterRodaDoMouse } from './whatsapp/rolagem-contida';

/*
 * O balão de conversa da central.
 *
 * "Conversa" NÃO é uma tela: conversar acontece aqui, e o registro do que foi
 * conversado é /sessoes. O protótipo tinha uma view `conversa` órfã que abria
 * em branco — o produto não é um chat, é uma central que também aceita
 * pergunta em português.
 *
 * O POPUP DO CHAT (leva 5, L7, 27/10/2026). Duas abas: "chat" (a caixa do
 * WhatsApp da empresa, aberta por padrão) e "a central". Três decisões desta
 * leva, todas por pedido do Rodrigo depois de testar as versões de 26/10:
 *
 *  1. A CAIXA É A MESMA DA TELA /whatsapp, RENDERIZADA AQUI, e não um iframe.
 *     O iframe recarregava a tela inteira a cada abertura (sessão, menu, tudo),
 *     abria no começo da conversa e deixava a roda do mouse escapar para a
 *     página atrás, porque a altura lá dentro era a da janela e não a do quadro.
 *     Renderizada direto (`embutida`), a caixa tem a altura do popup, guarda o
 *     estado em memória (nunca mexe no endereço da tela em que a pessoa está) e
 *     rola ao fim antes de pintar. O AppShell ainda sabe esconder a casca quando
 *     roda dentro de um iframe; esse caminho só não é mais usado por aqui.
 *  2. O POPUP FICA MONTADO DEPOIS DA PRIMEIRA ABERTURA. Fechar esconde
 *     (`hidden`); reabrir mostra o que estava, na mesma conversa e no fim. A caixa
 *     sabe quando está escondida (`visivel`) e para de reler a API até voltar.
 *  3. A RODA DO MOUSE NÃO SAI DO POPUP: `overscroll-contain` nos containers que
 *     rolam e, por cima, a trava de `rolagem-contida.ts`, porque o Chrome ignora
 *     o `overscroll-behavior` de um container que não transborda.
 *
 * O cabeçalho com as abas é `flex-none` fora de tudo o que rola; dentro de cada
 * aba só a lista rola, e a caixa de texto fica presa embaixo.
 */

type Evento =
  | { t: 'sessao'; sessionId: string; agente: string }
  | { t: 'contexto'; fontes: { titulo: string; ref?: string }[] }
  | { t: 'passo'; ordem: number; capacidade: string; args: string }
  | { t: 'passo_ok'; ordem: number; resultado: string; nivel: string; decisao: string }
  | { t: 'texto'; delta: string }
  | { t: 'aprovacao'; approvalId: string; resumo: string; nivel: string; motivo: string }
  | { t: 'fim'; status: string; custoUsd: number; duracaoMs: number; passos: number }
  | { t: 'erro'; mensagem: string };

interface Troca {
  pergunta: string;
  resposta: string;
  passos: { capacidade: string; args: string; resultado?: string; nivel?: string; decisao?: string }[];
  fontes: { titulo: string; ref?: string }[];
  aprovacoes: { approvalId: string; resumo: string; nivel: string }[];
  fim?: { status: string; custoUsd: number; duracaoMs: number };
  erro?: string;
}

const CHIPS = [
  { rotulo: 'o pulso de hoje', pergunta: 'como está a operação hoje? traga os números com a fonte.' },
  { rotulo: 'o que está travado', pergunta: 'o que está atrasado ou em risco agora?' },
  { rotulo: 'o caixa', pergunta: 'como está o caixa e o que vence nos próximos dias?' },
];

export function ChatFlutuante() {
  const { token, can } = useAuth();
  const [aberto, setAberto] = useState(false);
  // Depois da primeira abertura o popup fica montado e só se esconde (ver o cabeçalho).
  const [montado, setMontado] = useState(false);
  // Layout 26/10: o chat vem primeiro (pedido do Lucas); a central fica na segunda aba.
  const [aba, setAba] = useState<'central' | 'whatsapp'>('whatsapp');
  // A caixa só monta na primeira vez que a aba "chat" aparece (não pesa o resto) e depois fica.
  const [whatsMontado, setWhatsMontado] = useState(false);
  // O filtro e a conversa abertos no popup, para "abrir inteira" cair no mesmo lugar.
  const [estadoDaCaixa, setEstadoDaCaixa] = useState<EstadoDaCaixa>({ filtro: 'todas', q: '', conversa: null });
  const [texto, setTexto] = useState('');
  const [trocas, setTrocas] = useState<Troca[]>([]);
  const [rodando, setRodando] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const cancelar = useRef<(() => void) | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const listaDaCentral = useRef<HTMLDivElement>(null);
  const campoDaCentral = useRef<HTMLInputElement>(null);

  const podeCentral = can('mcp.executar');
  const podeWhats = can('leads.ver');
  const abaAtual = !podeCentral ? 'whatsapp' : !podeWhats ? 'central' : aba;
  const chatVisivel = aberto && abaAtual === 'whatsapp';

  useEffect(() => {
    if (aberto) setMontado(true);
  }, [aberto]);

  useEffect(() => {
    if (chatVisivel) setWhatsMontado(true);
  }, [chatVisivel]);

  // A trava da roda do mouse vive enquanto o popup estiver montado.
  useEffect(() => conterRodaDoMouse(raiz.current), [montado]);

  // A central rola ao fim pelo PRÓPRIO container, antes de pintar. `scrollIntoView`
  // numa div dentro de um popup fixo podia arrastar a página atrás junto.
  useLayoutEffect(() => {
    const el = listaDaCentral.current;
    if (el && aberto && abaAtual === 'central') el.scrollTop = el.scrollHeight;
  }, [trocas, aberto, abaAtual]);

  useEffect(() => {
    if (aberto && abaAtual === 'central' && !rodando) campoDaCentral.current?.focus({ preventScroll: true });
  }, [aberto, abaAtual, rodando]);

  // Sair da tela no meio de uma resposta aborta a requisição: sem isso o laço
  // do agente continua rodando — e gastando — para ninguém.
  useEffect(() => () => cancelar.current?.(), []);

  // Layout 26/10: as mensagens não abertas do WhatsApp, no selo vermelho da aba "Chat" e do botão fechado
  // (a mesma conta da bolha do menu, relida a cada 30 s).
  const naoLidas = useNaoLidasDoWhatsapp(token, can('leads.ver'), aba);
  const selo = textoDaBolha(naoLidas);
  const seloVermelho = (cls: string) => selo && naoLidas != null ? (
    <span role="img" aria-label={fraseDaBolha(naoLidas)} title={fraseDaBolha(naoLidas)} data-testid="chat-nao-lidas" className={`min-w-[18px] rounded-full bg-bad px-1 text-center font-os-mono text-[10px] font-semibold leading-[18px] tracking-normal text-white ${cls}`}>{selo}</span>
  ) : null;

  const aoMudarEstadoDaCaixa = useCallback((e: EstadoDaCaixa) => setEstadoDaCaixa(e), []);

  if (!podeCentral && !podeWhats) return null;

  async function perguntar(pergunta: string) {
    if (!pergunta.trim() || rodando) return;
    setTexto('');
    setRodando(true);
    const i = trocas.length;
    setTrocas((t) => [...t, { pergunta, resposta: '', passos: [], fontes: [], aprovacoes: [] }]);

    const mexer = (fn: (t: Troca) => Troca) =>
      setTrocas((ts) => ts.map((t, j) => (j === i ? fn(t) : t)));

    const { pronto, cancelar: abortar } = apiStream<Evento>(
      '/agents/assistente/stream',
      { pedido: pergunta, canal: 'web', sessionId },
      token,
      (e) => {
        switch (e.t) {
          case 'sessao':
            setSessionId(e.sessionId);
            break;
          case 'contexto':
            mexer((t) => ({ ...t, fontes: e.fontes }));
            break;
          case 'passo':
            mexer((t) => ({ ...t, passos: [...t.passos, { capacidade: e.capacidade, args: e.args }] }));
            break;
          case 'passo_ok':
            mexer((t) => ({
              ...t,
              passos: t.passos.map((p, k) =>
                k === t.passos.length - 1
                  ? { ...p, resultado: e.resultado, nivel: e.nivel, decisao: e.decisao }
                  : p,
              ),
            }));
            break;
          case 'texto':
            mexer((t) => ({ ...t, resposta: t.resposta + e.delta }));
            break;
          case 'aprovacao':
            mexer((t) => ({
              ...t,
              aprovacoes: [...t.aprovacoes, { approvalId: e.approvalId, resumo: e.resumo, nivel: e.nivel }],
            }));
            break;
          case 'fim':
            mexer((t) => ({ ...t, fim: { status: e.status, custoUsd: e.custoUsd, duracaoMs: e.duracaoMs } }));
            break;
          case 'erro':
            mexer((t) => ({ ...t, erro: e.mensagem }));
            break;
        }
      },
    );
    cancelar.current = abortar;
    try {
      await pronto;
    } catch (err) {
      mexer((t) => ({ ...t, erro: (err as Error).message }));
    } finally {
      cancelar.current = null;
      setRodando(false);
    }
  }

  return (
    <>
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          title="Chat: a central e as conversas do WhatsApp"
          className="fixed bottom-5 right-5 z-40 flex h-11 items-center gap-2 rounded-root border border-brand/30 bg-brand px-4 font-os-mono text-[11px] uppercase tracking-[0.14em] text-ink shadow-lg transition-transform hover:scale-[1.02]"
        >
          <MessageSquare size={15} />
          chat
          {seloVermelho('absolute -right-2 -top-2 shadow')}
        </button>
      )}

      {montado && (
        <div
          ref={raiz}
          data-testid="chat-popup"
          aria-hidden={aberto ? undefined : true}
          className={`fixed bottom-5 right-5 z-40 flex flex-col overflow-hidden overscroll-contain rounded-root border border-border bg-bg2 shadow-2xl ${aberto ? '' : 'hidden'} ${abaAtual === 'whatsapp' ? 'h-[min(680px,85vh)] w-[min(460px,94vw)]' : 'h-[min(620px,80vh)] w-[min(440px,92vw)]'}`}
        >
          {/* O cabeçalho com as abas fica fora de tudo o que rola: `flex-none`. */}
          <header className="flex flex-none items-center gap-1 border-b border-border px-2 py-1.5 font-os-mono">
            <div role="tablist" aria-label="O que abrir" className="flex items-center gap-1">
              {podeWhats && (
                <button type="button" role="tab" aria-selected={abaAtual === 'whatsapp'} onClick={() => setAba('whatsapp')} className={`rounded-root px-2 py-1 text-[11px] uppercase tracking-[0.14em] transition-colors ${abaAtual === 'whatsapp' ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}>
                  <span className="inline-flex items-center gap-1.5">chat{seloVermelho('')}</span>
                </button>
              )}
              {podeCentral && (
                <button type="button" role="tab" aria-selected={abaAtual === 'central'} onClick={() => setAba('central')} className={`rounded-root px-2 py-1 text-[11px] uppercase tracking-[0.14em] transition-colors ${abaAtual === 'central' ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}>
                  a central
                </button>
              )}
            </div>
            <span className="flex-1" />
            {abaAtual === 'whatsapp' && (
              <Link href={enderecoDaCaixa(estadoDaCaixa)} title="Abrir a caixa inteira, nesta conversa" className="text-[9.5px] uppercase tracking-[0.1em] text-brand hover:underline">
                abrir inteira
              </Link>
            )}
            {abaAtual === 'central' && sessionId && (
              <Link
                href={`/sessoes/${sessionId}`}
                title="Abrir esta sessão no registro"
                className="text-[9.5px] uppercase tracking-[0.1em] text-brand hover:underline"
              >
                ver no registro
              </Link>
            )}
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" className="text-muted hover:text-text">
              <X size={15} />
            </button>
          </header>

          {/* A aba "chat": a caixa do WhatsApp, embutida. Só a lista rola; a caixa de texto fica embaixo. */}
          {whatsMontado && (
            <div data-testid="chat-aba-whatsapp" className={`min-h-0 flex-1 flex-col bg-bg ${abaAtual === 'whatsapp' ? 'flex' : 'hidden'}`}>
              <CaixaDoWhatsapp embutida visivel={chatVisivel} aoMudarEstado={aoMudarEstadoDaCaixa} />
            </div>
          )}

          <div ref={listaDaCentral} className={`min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3 ${abaAtual === 'central' ? '' : 'hidden'}`}>
            {trocas.length === 0 && (
              <div className="space-y-3">
                <p className="text-[12px] leading-[1.6] text-muted">
                  Pergunte em português. A central busca nas fontes ligadas e responde citando de onde
                  veio cada número.
                </p>
                <div className="flex flex-wrap gap-[6px]">
                  {CHIPS.map((c) => (
                    <button
                      key={c.rotulo}
                      type="button"
                      onClick={() => perguntar(c.pergunta)}
                      className="rounded-root border border-border px-[9px] py-[5px] font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-muted transition-colors hover:border-brand/40 hover:text-text"
                    >
                      {c.rotulo}
                    </button>
                  ))}
                </div>
                <p className="font-os-mono text-[9px] uppercase tracking-[0.12em] text-dim">
                  toda troca daqui vira uma sessão no registro
                </p>
              </div>
            )}

            {trocas.map((t, i) => (
              <div key={i} className="space-y-2">
                <p className="rounded-root bg-surface-2 px-[10px] py-[7px] text-[12px] leading-[1.55] text-text">
                  {t.pergunta}
                </p>

                {t.passos.length > 0 && (
                  <ul className="space-y-[3px] border-l border-border pl-[9px]">
                    {t.passos.map((p, k) => (
                      <li key={k} className="font-os-mono text-[9.5px] text-muted">
                        <span className="text-dim">▸</span> {p.capacidade}
                        {p.args !== 'sem argumento' && <span className="text-dim"> · {p.args}</span>}
                        {p.decisao && p.decisao !== 'executado' && (
                          <span className="ml-1 text-warn">· {p.decisao.replace('_', ' ')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {t.resposta && (
                  <p className="whitespace-pre-wrap text-[12.5px] leading-[1.65] text-text">{t.resposta}</p>
                )}

                {t.aprovacoes.map((a) => (
                  <div key={a.approvalId} className="rounded-root border border-warn/40 bg-warn/10 px-[10px] py-[7px]">
                    <p className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-warn">
                      {a.nivel} · aguarda sua aprovação
                    </p>
                    <p className="mt-1 text-[11.5px] leading-[1.5] text-text">{a.resumo}</p>
                    <Link href="/atendimento" className="mt-1 inline-block text-[10px] text-brand hover:underline">
                      abrir a fila
                    </Link>
                  </div>
                ))}

                {t.fontes.length > 0 && (
                  <p className="font-os-mono text-[9px] leading-[1.5] text-dim">
                    fonte: {t.fontes.map((f) => f.titulo).join(' · ')}
                  </p>
                )}

                {t.erro && (
                  <p className="rounded-root border border-bad/40 bg-bad/10 px-[10px] py-[7px] text-[11.5px] text-bad">
                    {t.erro}
                  </p>
                )}

                {t.fim && (
                  <p className="font-os-mono text-[9px] uppercase tracking-[0.1em] text-dim">
                    {t.fim.status} · {(t.fim.duracaoMs / 1000).toFixed(1)}s ·{' '}
                    {t.fim.custoUsd > 0 ? `US$ ${t.fim.custoUsd.toFixed(4)}` : 'custo não medido'}
                  </p>
                )}
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              perguntar(texto);
            }}
            className={`flex flex-none items-center gap-2 border-t border-border px-3 py-2 ${abaAtual === 'central' ? '' : 'hidden'}`}
          >
            <input
              ref={campoDaCentral}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              disabled={rodando}
              placeholder={rodando ? 'a central está trabalhando…' : 'pergunte alguma coisa'}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-dim disabled:opacity-60"
            />
            {rodando ? (
              <button
                type="button"
                onClick={() => cancelar.current?.()}
                title="Parar"
                className="text-muted hover:text-bad"
              >
                <Square size={14} />
              </button>
            ) : (
              <button type="submit" disabled={!texto.trim()} title="Enviar" className="text-muted hover:text-brand disabled:opacity-40">
                <CornerDownLeft size={15} />
              </button>
            )}
          </form>
        </div>
      )}
    </>
  );
}
