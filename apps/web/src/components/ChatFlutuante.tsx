'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, X, CornerDownLeft, Square } from 'lucide-react';
import { apiStream } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * O balão de conversa da central.
 *
 * "Conversa" NÃO é uma tela: conversar acontece aqui, e o registro do que foi
 * conversado é /sessoes. O protótipo tinha uma view `conversa` órfã que abria
 * em branco — o produto não é um chat, é uma central que também aceita
 * pergunta em português.
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
  // Layout 26/10 (P-27): a aba WhatsApp mostra a caixa de conversas aqui mesmo, de qualquer tela.
  // Ela só monta na primeira vez que a aba abre (não pesa o resto) e depois fica montada.
  const [aba, setAba] = useState<'central' | 'whatsapp'>('central');
  const [whatsMontado, setWhatsMontado] = useState(false);
  const [texto, setTexto] = useState('');
  const [trocas, setTrocas] = useState<Troca[]>([]);
  const [rodando, setRodando] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const cancelar = useRef<(() => void) | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth' });
  }, [trocas, aberto]);

  // Sair da tela no meio de uma resposta aborta a requisição: sem isso o laço
  // do agente continua rodando — e gastando — para ninguém.
  useEffect(() => () => cancelar.current?.(), []);

  const podeCentral = can('mcp.executar');
  const podeWhats = can('leads.ver');
  if (!podeCentral && !podeWhats) return null;
  const abaAtual = !podeCentral ? 'whatsapp' : !podeWhats ? 'central' : aba;
  if (abaAtual === 'whatsapp' && aberto && !whatsMontado) setWhatsMontado(true);

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

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Perguntar à central"
        className="fixed bottom-5 right-5 z-40 flex h-11 items-center gap-2 rounded-root border border-brand/30 bg-brand px-4 font-os-mono text-[11px] uppercase tracking-[0.14em] text-ink shadow-lg transition-transform hover:scale-[1.02]"
      >
        <MessageSquare size={15} />
        perguntar
      </button>
    );
  }

  return (
    <div className={`fixed bottom-5 right-5 z-40 flex flex-col rounded-root border border-border bg-bg2 shadow-2xl ${abaAtual === 'whatsapp' ? 'h-[min(680px,85vh)] w-[min(460px,94vw)]' : 'h-[min(620px,80vh)] w-[min(440px,92vw)]'}`}>
      <header className="flex flex-none items-center gap-1 border-b border-border px-2 py-1.5 font-os-mono">
        <div role="tablist" aria-label="O que abrir" className="flex items-center gap-1">
          {podeCentral && (
            <button type="button" role="tab" aria-selected={abaAtual === 'central'} onClick={() => setAba('central')} className={`rounded-root px-2 py-1 text-[11px] uppercase tracking-[0.14em] transition-colors ${abaAtual === 'central' ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}>
              a central
            </button>
          )}
          {podeWhats && (
            <button type="button" role="tab" aria-selected={abaAtual === 'whatsapp'} onClick={() => setAba('whatsapp')} className={`rounded-root px-2 py-1 text-[11px] uppercase tracking-[0.14em] transition-colors ${abaAtual === 'whatsapp' ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}>
              whatsapp
            </button>
          )}
        </div>
        <span className="flex-1" />
        {abaAtual === 'whatsapp' && (
          <Link href="/whatsapp" title="Abrir a caixa inteira" className="text-[9.5px] uppercase tracking-[0.1em] text-brand hover:underline">
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

      {whatsMontado && (
        <iframe
          src="/whatsapp"
          title="Conversas do WhatsApp"
          className={`min-h-0 w-full flex-1 rounded-b-root border-0 bg-bg ${abaAtual === 'whatsapp' ? '' : 'hidden'}`}
        />
      )}

      <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 ${abaAtual === 'central' ? '' : 'hidden'}`}>
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
        <div ref={fim} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          perguntar(texto);
        }}
        className={`flex flex-none items-center gap-2 border-t border-border px-3 py-2 ${abaAtual === 'central' ? '' : 'hidden'}`}
      >
        <input
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
  );
}
