'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ROTULO_DO_FILTRO,
  TETO_DA_RESPOSTA_DA_CAIXA,
  formatarWhatsappBr,
  iniciaisDaConversa,
  rotuloDoTipoDeMensagem,
  type ConversaAberta,
  type ConversaDaCaixa,
  type FiltroDaCaixa,
  type ListaDaCaixa,
  type MensagemDaCaixa,
  type RespostaEnviada,
} from '@mktos/shared';

import { VinculoDaConversa } from '@/components/whatsapp/VinculoDaConversa';
import { ErroDaApi, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  CHIPS_DA_CAIXA,
  RELEITURA_DA_CAIXA_MS,
  diaDoInstante,
  duracaoLegivel,
  ehMidia,
  enderecoDaCaixa,
  estadoDoEndereco,
  horaDaLista,
  horaDoBalao,
  juntarMensagens,
  previaDaLista,
  razaoParaNaoResponder,
  remetenteDoBalao,
  rotaDaConversa,
  rotaDaLista,
  rotuloDoDia,
  tamanhoLegivel,
  textoEnviavel,
  type EstadoDaCaixa,
} from '@/lib/caixa-whatsapp';

import { BOTAO, BOTAO_PRIMARIO, Chip, ErroDaAcao, FOCO, INPUT } from '../../comercial/_ui';

/*
 * A CAIXA DE WHATSAPP (produção 22C, W2, 22/10/2026).
 *
 * Toda conversa do número da empresa, 1:1 e grupo, com quem falou, o quê e
 * quando. À esquerda as conversas (mais recente primeiro), com os chips
 * Todas · Leads · Clientes · Grupos · Sem vínculo · Equipe (e Arquivadas no
 * fim) e a busca por nome, número e texto. À direita o histórico, com rolagem
 * própria, o cabeçalho com o vínculo (componente da lane C) e a caixa de
 * resposta.
 *
 * Responder é ato de GENTE com a permissão `whatsapp.conversar`: a tela só
 * mostra a caixa de resposta ligada quando a API diz `podeResponder`, e a API
 * confere de novo no banco. Nenhum agente responde por aqui.
 *
 * O endereço guarda o filtro, a busca e a conversa aberta
 * (`/whatsapp?filtro=leads&conversa=<id>`), para o Dia a dia linkar direto.
 * Desktop: duas colunas, a página não rola, cada coluna rola. Celular
 * (< 768 px): lista e conversa em telas separadas, com "Voltar".
 */

const COLUNA = 'flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-border bg-surface';

function Avatar({ conversa, tamanho = 'h-10 w-10' }: { conversa: Pick<ConversaDaCaixa, 'nome' | 'fotoUrl' | 'grupo'>; tamanho?: string }) {
  const [falhou, setFalhou] = useState(false);
  if (conversa.fotoUrl && !falhou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={conversa.fotoUrl}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFalhou(true)}
        className={`${tamanho} shrink-0 rounded-full border border-border object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${tamanho} inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 font-os-mono text-[12px] text-muted`}
    >
      {iniciaisDaConversa(conversa.nome)}
    </span>
  );
}

function rotuloDoVinculo(c: ConversaDaCaixa): { texto: string; tom: 'brand' | 'info' | 'neutro' } | null {
  if (c.vinculo?.tipo === 'lead') return { texto: 'lead', tom: 'brand' };
  if (c.vinculo?.tipo === 'cliente') return { texto: 'cliente', tom: 'info' };
  if (c.equipe) return { texto: 'equipe', tom: 'neutro' };
  return null;
}

function ItemDaLista({ conversa, ativa, onAbrir }: { conversa: ConversaDaCaixa; ativa: boolean; onAbrir: () => void }) {
  const selo = rotuloDoVinculo(conversa);
  const previa = previaDaLista(conversa.previa, conversa.grupo);
  return (
    <button
      type="button"
      data-testid={`caixa-conversa-${conversa.id}`}
      aria-current={ativa ? 'true' : undefined}
      onClick={onAbrir}
      className={`flex w-full min-w-0 items-center gap-2.5 rounded px-2 py-2 text-left transition hover:bg-surface-2 max-md:min-h-[56px] ${ativa ? 'bg-surface-2' : ''} ${FOCO}`}
    >
      <Avatar conversa={conversa} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span title={conversa.nome} className={`min-w-0 flex-1 truncate text-[13.5px] ${conversa.naoLidas ? 'font-semibold text-text' : 'text-text'}`}>
            {conversa.nome}
          </span>
          <span className={`shrink-0 font-os-mono text-[10.5px] tabular-nums ${conversa.naoLidas ? 'text-brand' : 'text-muted'}`}>
            {horaDaLista(conversa.ultimaMensagemEm ?? conversa.previa?.timestamp)}
          </span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {conversa.grupo && (
            <span data-testid={`caixa-selo-grupo-${conversa.id}`} className="shrink-0">
              <Chip title="Conversa em grupo">grupo{conversa.participantes != null ? ` · ${conversa.participantes}` : ''}</Chip>
            </span>
          )}
          {selo && <span className="shrink-0"><Chip tom={selo.tom}>{selo.texto}</Chip></span>}
          <span data-testid={`caixa-previa-${conversa.id}`} title={previa} className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
            {previa}
          </span>
          {conversa.naoLidas > 0 && (
            <span
              data-testid={`caixa-nao-lidas-${conversa.id}`}
              aria-label={`${conversa.naoLidas} não lidas`}
              className="ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 font-os-mono text-[10.5px] font-semibold tabular-nums text-ink"
            >
              {conversa.naoLidas > 99 ? '99+' : conversa.naoLidas}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function CartaoDaMidia({ m }: { m: MensagemDaCaixa }) {
  const partes = [rotuloDoTipoDeMensagem(m.tipo), m.midia?.nome, m.midia?.mime, tamanhoLegivel(m.midia?.tamanho), duracaoLegivel(m.midia?.segundos)].filter(
    (x): x is string => !!x,
  );
  return (
    <span data-testid={`caixa-midia-${m.id}`} className="block rounded border border-dashed border-border bg-bg/40 px-2 py-1.5 text-[12px]">
      <span className="block break-words">{partes.join(' · ')}</span>
      <span className="block font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">mídia não baixada</span>
    </span>
  );
}

function Balao({ m, grupo }: { m: MensagemDaCaixa; grupo: boolean }) {
  if (m.tipo === 'protocolo') {
    return (
      <li data-testid={`caixa-balao-${m.id}`} className="my-1 text-center text-[11.5px] text-muted">
        {m.texto?.trim() || rotuloDoTipoDeMensagem(m.tipo)} · {horaDoBalao(m.timestamp)}
      </li>
    );
  }
  const lado = m.deMim ? 'ml-auto items-end' : 'mr-auto items-start';
  const cor = m.deMim ? 'border-brand/30 bg-brand/10' : 'border-border bg-surface-2';
  return (
    <li data-testid={`caixa-balao-${m.id}`} data-de-mim={m.deMim ? 'sim' : 'nao'} className={`flex max-w-[85%] flex-col md:max-w-[70%] ${lado}`}>
      <div className={`min-w-0 max-w-full rounded border px-2.5 py-1.5 text-[13px] ${cor}`}>
        {grupo && !m.deMim && <p className="mb-0.5 truncate text-[11.5px] font-semibold text-brand">{remetenteDoBalao(m)}</p>}
        {m.cita && (
          <p data-testid={`caixa-citacao-${m.id}`} className="mb-1 line-clamp-3 border-l-2 border-brand/50 pl-2 text-[12px] text-muted">
            <span className="font-semibold">{m.cita.deMim ? 'Você' : m.cita.remetenteNome?.trim() || 'mensagem citada'}</span>
            {': '}
            {m.cita.texto?.trim() || (m.cita.tipo ? rotuloDoTipoDeMensagem(m.cita.tipo) : 'mensagem que não está gravada')}
          </p>
        )}
        {m.tipo === 'reaction' ? (
          <p className="text-[12.5px] text-muted">reagiu com {m.texto?.trim() || 'uma reação'}</p>
        ) : (
          <>
            {ehMidia(m.tipo) && <CartaoDaMidia m={m} />}
            {m.texto?.trim() ? (
              <p className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${ehMidia(m.tipo) ? 'mt-1' : ''}`}>{m.texto}</p>
            ) : (
              !ehMidia(m.tipo) && <p className="text-muted">{rotuloDoTipoDeMensagem(m.tipo)}</p>
            )}
          </>
        )}
        <p className="mt-0.5 text-right font-os-mono text-[10px] tabular-nums text-muted">
          {m.tipo === 'edicao' ? 'editada · ' : ''}
          {horaDoBalao(m.timestamp)}
        </p>
      </div>
      {m.enviadaPor && (
        <p data-testid={`caixa-enviada-por-${m.id}`} className="mt-0.5 text-[11px] text-muted">
          enviada por {m.enviadaPor.nome}
        </p>
      )}
    </li>
  );
}

function Historico({ mensagens, grupo }: { mensagens: MensagemDaCaixa[]; grupo: boolean }) {
  const itens: React.ReactNode[] = [];
  let diaAnterior = '';
  for (const m of mensagens) {
    const dia = diaDoInstante(m.timestamp);
    if (dia && dia !== diaAnterior) {
      itens.push(
        <li key={`dia-${dia}`} className="my-2 text-center">
          <span className="rounded bg-surface-2 px-2 py-0.5 font-os-mono text-[10.5px] text-muted">{rotuloDoDia(dia)}</span>
        </li>,
      );
      diaAnterior = dia;
    }
    itens.push(<Balao key={m.id} m={m} grupo={grupo} />);
  }
  return <ol className="flex flex-col gap-1.5">{itens}</ol>;
}

function lerEndereco(): EstadoDaCaixa {
  return typeof window === 'undefined' ? { filtro: 'todas', q: '', conversa: null } : estadoDoEndereco(window.location.search);
}

function visivel(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function CaixaDoWhatsapp() {
  const { token, ready } = useAuth();
  const [estado, setEstado] = useState<EstadoDaCaixa>(lerEndereco);
  const [busca, setBusca] = useState(estado.q);
  const [lista, setLista] = useState<ListaDaCaixa | null>(null);
  const [erroDaLista, setErroDaLista] = useState<unknown>(null);
  const [aberta, setAberta] = useState<ConversaAberta | null>(null);
  const [mensagens, setMensagens] = useState<MensagemDaCaixa[]>([]);
  const [maisAntigas, setMaisAntigas] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [erroDaConversa, setErroDaConversa] = useState<unknown>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroDoEnvio, setErroDoEnvio] = useState<unknown>(null);
  const [arquivando, setArquivando] = useState(false);
  const [erroDaAcao, setErroDaAcao] = useState<unknown>(null);

  const historico = useRef<HTMLDivElement | null>(null);
  const pedidoDaLista = useRef(0);
  const conversaAtual = useRef<string | null>(estado.conversa);
  conversaAtual.current = estado.conversa;
  // A rolagem a refazer depois de pintar: 'fim' (abriu, chegou mensagem, respondeu) ou a altura de antes (mais antigas).
  const rolar = useRef<'fim' | { altura: number; topo: number } | null>(null);

  // ------------------------------------------------------------------ endereço

  const irPara = useCallback((novo: EstadoDaCaixa, modo: 'push' | 'replace' = 'replace') => {
    setEstado(novo);
    const url = enderecoDaCaixa(novo);
    if (typeof window !== 'undefined' && `${window.location.pathname}${window.location.search}` !== url) {
      window.history[modo === 'push' ? 'pushState' : 'replaceState'](null, '', url);
    }
  }, []);

  useEffect(() => {
    const aoVoltar = () => {
      const e = lerEndereco();
      setEstado(e);
      setBusca(e.q);
    };
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, []);

  // A busca vai ao endereço e à API depois de uma pausa na digitação.
  useEffect(() => {
    if (busca.trim() === estado.q) return;
    const t = window.setTimeout(() => irPara({ ...estado, q: busca.trim() }), 350);
    return () => window.clearTimeout(t);
  }, [busca, estado, irPara]);

  // ---------------------------------------------------------------------- lista

  const carregarLista = useCallback(async () => {
    if (!token) return;
    const este = ++pedidoDaLista.current;
    try {
      const l = await apiGet<ListaDaCaixa>(rotaDaLista(estado), token);
      if (este !== pedidoDaLista.current) return;
      setLista(l);
      setErroDaLista(null);
    } catch (e) {
      if (este === pedidoDaLista.current) setErroDaLista(e);
    }
  }, [token, estado.filtro, estado.q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !token) return;
    void carregarLista();
    const t = window.setInterval(() => {
      if (visivel()) void carregarLista();
    }, RELEITURA_DA_CAIXA_MS);
    return () => window.clearInterval(t);
  }, [ready, token, carregarLista]);

  // ------------------------------------------------------------------- conversa

  const marcarLida = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        await apiPost<{ lidas: number }>(`/whatsapp/conversas/${encodeURIComponent(id)}/lida`, {}, token);
        setLista((l) => (l ? { ...l, conversas: l.conversas.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)) } : l));
        setAberta((a) => (a && a.conversa.id === id ? { ...a, conversa: { ...a.conversa, naoLidas: 0 } } : a));
      } catch {
        /* marcar como lida é conforto: a falha não atrapalha a leitura */
      }
    },
    [token],
  );

  const carregarConversa = useCallback(
    async (id: string, primeira: boolean) => {
      if (!token) return;
      try {
        const r = await apiGet<ConversaAberta>(rotaDaConversa(id), token);
        if (conversaAtual.current !== id) return;
        const el = historico.current;
        const pertoDoFim = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        setAberta(r);
        setErroDaConversa(null);
        if (primeira) {
          setMensagens(r.mensagens);
          setMaisAntigas(r.maisAntigas);
          rolar.current = 'fim';
        } else {
          setMensagens((atuais) => {
            const juntas = juntarMensagens(atuais, r.mensagens);
            if (juntas.length !== atuais.length && pertoDoFim) rolar.current = 'fim';
            return juntas;
          });
        }
        if (primeira || r.conversa.naoLidas > 0) void marcarLida(id);
      } catch (e) {
        if (conversaAtual.current === id) setErroDaConversa(e);
      }
    },
    [token, marcarLida],
  );

  useEffect(() => {
    setAberta(null);
    setMensagens([]);
    setMaisAntigas(false);
    setErroDaConversa(null);
    setErroDoEnvio(null);
    setErroDaAcao(null);
    setTexto('');
    if (!ready || !token || !estado.conversa) return;
    const id = estado.conversa;
    void carregarConversa(id, true);
    const t = window.setInterval(() => {
      if (visivel()) void carregarConversa(id, false);
    }, RELEITURA_DA_CAIXA_MS);
    return () => window.clearInterval(t);
  }, [ready, token, estado.conversa, carregarConversa]);

  const carregarAntigas = useCallback(async () => {
    const id = estado.conversa;
    const primeira = mensagens[0];
    if (!token || !id || !primeira || carregandoAntigas || !maisAntigas) return;
    setCarregandoAntigas(true);
    try {
      const r = await apiGet<ConversaAberta>(rotaDaConversa(id, primeira), token);
      if (conversaAtual.current !== id) return;
      const el = historico.current;
      if (el) rolar.current = { altura: el.scrollHeight, topo: el.scrollTop };
      setMensagens((atuais) => juntarMensagens(r.mensagens, atuais));
      setMaisAntigas(r.maisAntigas);
    } catch (e) {
      if (conversaAtual.current === id) setErroDaConversa(e);
    } finally {
      setCarregandoAntigas(false);
    }
  }, [token, estado.conversa, mensagens, carregandoAntigas, maisAntigas]);

  useLayoutEffect(() => {
    const el = historico.current;
    const r = rolar.current;
    if (!el || !r) return;
    rolar.current = null;
    if (r === 'fim') el.scrollTop = el.scrollHeight;
    else el.scrollTop = el.scrollHeight - r.altura + r.topo;
  }, [mensagens]);

  function aoRolar() {
    const el = historico.current;
    if (el && el.scrollTop < 40 && maisAntigas && !carregandoAntigas) void carregarAntigas();
  }

  // ------------------------------------------------------------------- ações

  async function responder() {
    const id = estado.conversa;
    if (!token || !id || !aberta || enviando || !textoEnviavel(texto)) return;
    setEnviando(true);
    setErroDoEnvio(null);
    try {
      const r = await apiPost<RespostaEnviada>(`/whatsapp/conversas/${encodeURIComponent(id)}/responder`, { texto }, token);
      if (conversaAtual.current === id) {
        setTexto('');
        rolar.current = 'fim';
        setMensagens((atuais) => juntarMensagens(atuais, [r.mensagem]));
      }
      void carregarLista();
    } catch (e) {
      setErroDoEnvio(e);
    } finally {
      setEnviando(false);
    }
  }

  async function alternarArquivo() {
    const id = estado.conversa;
    if (!token || !id || !aberta || arquivando) return;
    setArquivando(true);
    setErroDaAcao(null);
    try {
      const c = await apiPost<ConversaDaCaixa>(`/whatsapp/conversas/${encodeURIComponent(id)}/arquivar`, { arquivada: !aberta.conversa.arquivada }, token);
      setAberta((a) => (a && a.conversa.id === id ? { ...a, conversa: c } : a));
      void carregarLista();
    } catch (e) {
      setErroDaAcao(e);
    } finally {
      setArquivando(false);
    }
  }

  async function aoMudarVinculo() {
    if (estado.conversa) await carregarConversa(estado.conversa, false);
    await carregarLista();
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void responder();
    }
  }

  // ---------------------------------------------------------------------- tela

  const vista = estado.conversa ? 'conversa' : 'lista';
  const conversa = aberta?.conversa ?? lista?.conversas.find((c) => c.id === estado.conversa) ?? null;
  const podeResponder = aberta?.podeResponder ?? lista?.podeResponder ?? false;
  const podeVincular = aberta?.podeVincular ?? lista?.podeVincular ?? false;
  const razao = conversa ? razaoParaNaoResponder(conversa, podeResponder) : null;
  const naoAchou = erroDaConversa instanceof ErroDaApi && erroDaConversa.status === 404;
  const tamanho = texto.replace(/\r\n/g, '\n').trim().length;

  const chips = CHIPS_DA_CAIXA;

  return (
    // A altura é a da tela menos o topo do OS e a faixa do botão flutuante "Perguntar":
    // a página não rola, cada coluna rola por dentro.
    <div data-testid="caixa" className="flex h-[calc(100dvh-52px-2rem-3.75rem)] min-h-[30rem] min-w-0 flex-col gap-3 min-[820px]:h-[calc(100dvh-46px-3rem-3.5rem)]">
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[13px] text-muted">As conversas do número da empresa com leads, clientes e equipe.</p>
        <Link href="/whatsapp/simulador" data-testid="caixa-ir-para-celulares" className={`text-[12.5px] text-muted underline underline-offset-2 hover:text-brand ${FOCO}`}>
          Celulares do comercial
        </Link>
      </header>

      <div
        data-testid="caixa-grade"
        data-vista={vista}
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]"
      >
        {/* ------------------------------------------------------------ lista */}
        <section aria-label="Conversas" data-testid="caixa-coluna-lista" className={`${COLUNA} ${vista === 'lista' ? '' : 'max-md:hidden'}`}>
          <div className="shrink-0 space-y-2 border-b border-border p-2">
            <label className="block">
              <span className="sr-only">Buscar por nome, número ou texto</span>
              <input
                data-testid="caixa-busca"
                type="search"
                className={INPUT}
                placeholder="Buscar por nome, número ou texto"
                value={busca}
                maxLength={100}
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>
            <div role="group" aria-label="Filtros" className="flex flex-wrap gap-1">
              {chips.map((f: FiltroDaCaixa) => {
                const ativo = estado.filtro === f;
                const n = lista?.contagens[f];
                return (
                  <button
                    key={f}
                    type="button"
                    data-testid={`caixa-filtro-${f}`}
                    aria-pressed={ativo}
                    onClick={() => irPara({ ...estado, filtro: f, conversa: estado.conversa })}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition max-md:min-h-[36px] ${
                      ativo ? 'border-brand bg-brand/15 text-text' : 'border-border text-muted hover:border-brand'
                    } ${f === 'arquivadas' ? 'ml-auto' : ''} ${FOCO}`}
                  >
                    {ROTULO_DO_FILTRO[f]}
                    {n != null && <span className="font-os-mono text-[10.5px] tabular-nums opacity-80">{n}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
            {erroDaLista ? <ErroDaAcao erro={erroDaLista} /> : null}
            {!lista && !erroDaLista && <p className="p-2 text-[13px] text-muted">Carregando conversas…</p>}
            {lista && lista.conversas.length === 0 && (
              <p data-testid="caixa-vazia" className="m-1 rounded border border-dashed border-border px-3 py-4 text-[13px] text-muted">
                {estado.q ? 'Nada com essa busca.' : estado.filtro === 'todas' ? 'Nenhuma conversa ainda. As mensagens que chegarem ao número aparecem aqui.' : `Nenhuma conversa em ${ROTULO_DO_FILTRO[estado.filtro]}.`}
              </p>
            )}
            <ul data-testid="caixa-lista" className="space-y-0.5">
              {lista?.conversas.map((c) => (
                <li key={c.id}>
                  <ItemDaLista conversa={c} ativa={c.id === estado.conversa} onAbrir={() => irPara({ ...estado, conversa: c.id }, 'push')} />
                </li>
              ))}
            </ul>
            {lista?.mais && <p className="p-2 text-center text-[12px] text-muted">Há mais conversas. Use a busca ou um filtro.</p>}
          </div>
        </section>

        {/* --------------------------------------------------------- conversa */}
        <section aria-label="Conversa aberta" data-testid="caixa-coluna-conversa" className={`${COLUNA} ${vista === 'conversa' ? '' : 'max-md:hidden'}`}>
          {!estado.conversa && (
            <p className="m-auto max-w-xs p-4 text-center text-[13px] text-muted">Escolha uma conversa à esquerda.</p>
          )}
          {estado.conversa && (
            <>
              <header className="shrink-0 space-y-2 border-b border-border p-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    data-testid="caixa-voltar"
                    onClick={() => irPara({ ...estado, conversa: null }, 'push')}
                    className={`${BOTAO} md:hidden`}
                  >
                    Voltar
                  </button>
                  {conversa && <Avatar conversa={conversa} />}
                  <div className="min-w-0 flex-1">
                    <h2 data-testid="caixa-titulo" title={conversa?.nome} className="truncate text-[14.5px] font-semibold">
                      {conversa?.nome ?? (naoAchou ? 'Conversa não encontrada' : 'Abrindo…')}
                    </h2>
                    {conversa && (
                      <p data-testid="caixa-subtitulo" className="truncate text-[12px] text-muted">
                        {conversa.grupo
                          ? `grupo · ${conversa.participantes ?? aberta?.participantes.length ?? 0} participantes`
                          : conversa.numero
                            ? formatarWhatsappBr(conversa.numero)
                            : 'número não informado'}
                      </p>
                    )}
                  </div>
                  {aberta && podeResponder && (
                    <button type="button" data-testid="caixa-arquivar" onClick={() => void alternarArquivo()} disabled={arquivando} className={`${BOTAO} shrink-0`}>
                      {aberta.conversa.arquivada ? 'Voltar para a caixa' : 'Arquivar conversa'}
                    </button>
                  )}
                </div>
                {aberta && (
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <VinculoDaConversa conversa={aberta.conversa} podeVincular={podeVincular} aoMudar={aoMudarVinculo} />
                    {aberta.conversa.grupo && aberta.participantes.length > 0 && (
                      <details data-testid="caixa-participantes" className="text-[12px] text-muted">
                        <summary className={`cursor-pointer rounded-sm ${FOCO}`}>ver participantes</summary>
                        <ul className="mt-1 space-y-0.5">
                          {aberta.participantes.map((p, i) => (
                            <li key={`${p.numero ?? 'sem'}-${i}`} className="break-words">
                              {p.nome ?? 'sem nome'}
                              {p.numero ? ` · ${formatarWhatsappBr(p.numero)}` : ''}
                              {p.admin ? ' · admin' : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
                <ErroDaAcao erro={erroDaAcao} />
              </header>

              <div
                ref={historico}
                data-testid="caixa-historico"
                onScroll={aoRolar}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2"
              >
                {naoAchou ? (
                  <p className="p-4 text-center text-[13px] text-muted">Esta conversa não existe ou não é desta empresa.</p>
                ) : (
                  <>
                    {erroDaConversa ? <ErroDaAcao erro={erroDaConversa} /> : null}
                    {maisAntigas && (
                      <div className="mb-2 text-center">
                        <button type="button" data-testid="caixa-mais-antigas" onClick={() => void carregarAntigas()} disabled={carregandoAntigas} className={BOTAO}>
                          {carregandoAntigas ? 'Carregando…' : 'Carregar mais antigas'}
                        </button>
                      </div>
                    )}
                    {aberta && mensagens.length === 0 && <p className="p-4 text-center text-[13px] text-muted">Sem mensagens gravadas nesta conversa.</p>}
                    {!aberta && !erroDaConversa && <p className="p-4 text-center text-[13px] text-muted">Abrindo a conversa…</p>}
                    <Historico mensagens={mensagens} grupo={!!aberta?.conversa.grupo} />
                  </>
                )}
              </div>

              {aberta && (
                <form
                  className="shrink-0 space-y-1 border-t border-border p-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void responder();
                  }}
                >
                  {razao && (
                    <p data-testid="caixa-sem-resposta" className="text-[12px] text-muted">
                      {razao}
                    </p>
                  )}
                  <div className="flex items-end gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Mensagem</span>
                      <textarea
                        data-testid="caixa-resposta"
                        rows={2}
                        value={texto}
                        maxLength={TETO_DA_RESPOSTA_DA_CAIXA + 200}
                        disabled={!!razao || enviando}
                        onChange={(e) => setTexto(e.target.value)}
                        onKeyDown={aoTeclar}
                        placeholder={razao ? '' : 'Escreva a resposta. Enter envia, Shift+Enter quebra a linha.'}
                        className={`${INPUT} max-h-40 min-h-[44px] resize-y disabled:cursor-not-allowed disabled:opacity-60`}
                      />
                    </label>
                    <button type="submit" data-testid="caixa-enviar" disabled={!!razao || enviando || !textoEnviavel(texto)} className={BOTAO_PRIMARIO}>
                      {enviando ? 'Enviando…' : 'Enviar'}
                    </button>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <ErroDaAcao erro={erroDoEnvio} />
                    <span data-testid="caixa-contador" className={`ml-auto shrink-0 font-os-mono text-[10.5px] tabular-nums ${tamanho > TETO_DA_RESPOSTA_DA_CAIXA ? 'text-bad' : 'text-muted'}`}>
                      {tamanho}/{TETO_DA_RESPOSTA_DA_CAIXA}
                    </span>
                  </div>
                  {!razao && <p className="text-[11px] text-muted">Sai pelo número da empresa, com o seu nome no registro.</p>}
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
