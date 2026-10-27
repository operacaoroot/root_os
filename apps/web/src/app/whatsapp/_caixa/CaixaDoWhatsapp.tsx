'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ROTULO_DO_FILTRO,
  TETO_DA_RESPOSTA_DA_CAIXA,
  formatarWhatsappBr,
  fraseDoTetoDaMidia,
  iniciaisDaConversa,
  rotuloDoTipoDeMensagem,
  tetoDaMidiaParaEnviar,
  tipoDaMidiaParaEnviar,
  type ConversaAberta,
  type ConversaDaCaixa,
  type FiltroDaCaixa,
  type ListaDaCaixa,
  type MensagemDaCaixa,
  type RespostaEnviada,
} from '@mktos/shared';

import { VinculoDaConversa } from '@/components/whatsapp/VinculoDaConversa';
import { ErroDaApi, apiFormulario, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  CHIPS_DA_CAIXA,
  RELEITURA_DA_CAIXA_MS,
  diaDoInstante,
  ehMidia,
  enderecoDaCaixa,
  estadoDoEndereco,
  horaDaLista,
  horaDoBalao,
  juntarMensagens,
  previaDaLista,
  razaoParaNaoResponder,
  remetenteDoBalao,
  numeroDoBalao,
  rotaDaConversa,
  rotaDaLista,
  rotuloDoDia,
  tamanhoLegivel,
  textoEnviavel,
  type EstadoDaCaixa,
} from '@/lib/caixa-whatsapp';

import { BOTAO, BOTAO_PRIMARIO, Chip, ErroDaAcao, FOCO, INPUT } from '../../comercial/_ui';
import { MidiaDoBalao } from './MidiaDoBalao';

/*
 * A CAIXA DE WHATSAPP (produção 22C, W2, 22/10/2026).
 *
 * Toda conversa do número da empresa, 1:1 e grupo, com quem falou, o quê e
 * quando. À esquerda as conversas (mais recente primeiro), com os chips
 * Todas · Leads · Clientes · Grupos · Sem vínculo · Equipe · Comunidade (layout
 * 26/10), Arquivadas no fim, e a busca por nome, número e texto. À direita o
 * histórico, com rolagem
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
 *
 * EMBUTIDA NO CHAT (leva 5, L7, 27/10/2026): o popup do canto inferior monta
 * esta mesma caixa com `embutida`. Ali o estado (filtro, busca, conversa) fica
 * em memória e NUNCA vai ao endereço da página (a pessoa pode estar em qualquer
 * tela), é sempre uma coluna por vez (o popup tem 460 px) e a altura é a do
 * popup, não a da janela. `visivel` diz se o popup está aberto nesta aba: fechado,
 * a caixa para de reler a API e, ao reaparecer, relê e rola ao fim antes do
 * primeiro quadro. Antes era um iframe de `/whatsapp`, que recarregava a tela
 * inteira a cada abertura e deixava a roda do mouse escapar para a página.
 *
 * ROLAGEM (L7): ao abrir e ao trocar de conversa a lista vai ao FIM num
 * `useLayoutEffect` (antes de pintar, sem animação), e a caixa de texto recebe
 * o foco. Mensagem própria rola ao fim; mensagem nova de fora só rola se a
 * pessoa já estava no fim, senão aparece "novas mensagens" para descer. Trocar
 * de conversa não desmonta a lista: a anterior fica, esmaecida, até a nova
 * chegar.
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
  // Layout 26/10: o quarto tipo de conversa, com o selo pequeno na lista.
  if (c.comunidade) return { texto: 'comunidade', tom: 'neutro' };
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
      className={`flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-3 text-left transition hover:bg-surface-2 max-md:min-h-[64px] ${ativa ? 'bg-surface-2' : ''} ${FOCO}`}
    >
      <Avatar conversa={conversa} tamanho="h-12 w-12" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span title={conversa.nome} className={`min-w-0 flex-1 truncate text-[14.5px] ${conversa.naoLidas ? 'font-semibold text-text' : 'text-text'}`}>
            {conversa.nome}
          </span>
          <span className={`shrink-0 font-os-mono text-[10.5px] tabular-nums ${conversa.naoLidas ? 'text-brand' : 'text-muted'}`}>
            {horaDaLista(conversa.ultimaMensagemEm ?? conversa.previa?.timestamp)}
          </span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          {conversa.grupo && (
            <span data-testid={`caixa-selo-grupo-${conversa.id}`} className="shrink-0">
              <Chip title="Conversa em grupo">grupo{conversa.participantes != null ? ` · ${conversa.participantes}` : ''}</Chip>
            </span>
          )}
          {selo && <span className="shrink-0"><Chip tom={selo.tom}>{selo.texto}</Chip></span>}
          <span data-testid={`caixa-previa-${conversa.id}`} title={previa} className="min-w-0 flex-1 truncate text-[13px] text-muted">
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

function Balao({ m, grupo, continua = false }: { m: MensagemDaCaixa; grupo: boolean; continua?: boolean }) {
  if (m.tipo === 'protocolo') {
    return (
      <li data-testid={`caixa-balao-${m.id}`} className="my-1 text-center text-[11.5px] text-muted">
        {m.texto?.trim() || rotuloDoTipoDeMensagem(m.tipo)} · {horaDoBalao(m.timestamp)}
      </li>
    );
  }
  // Layout 26/10 (Lucas): balões com a cara do WhatsApp (branco de quem chega, verde-claro do que sai,
  // nome colorido por pessoa, resposta citada com barra colorida, hora no canto do balão).
  // Layout 26/10 (respiro): mensagens seguidas da mesma pessoa ficam juntas (2 px, sem repetir o nome);
  // quando muda quem fala, um respiro maior, como no WhatsApp.
  const lado = `${m.deMim ? 'ml-auto items-end' : 'mr-auto items-start'} ${continua ? 'mt-0.5' : 'mt-3'}`;
  const ponta = continua ? '' : m.deMim ? 'rounded-tr-sm' : 'rounded-tl-sm';
  const hora = (
    <span className="wz-meta float-right ml-2 mt-1.5 translate-y-0.5 whitespace-nowrap text-[10.5px] tabular-nums leading-none">
      {m.tipo === 'edicao' ? 'editada · ' : ''}
      {horaDoBalao(m.timestamp)}
    </span>
  );
  const nomeDaCitacao = m.cita ? (m.cita.deMim ? 'Você' : m.cita.remetenteNome?.trim() || 'mensagem citada') : '';
  return (
    <li data-testid={`caixa-balao-${m.id}`} data-de-mim={m.deMim ? 'sim' : 'nao'} className={`flex max-w-[80%] flex-col md:max-w-[62%] ${lado}`}>
      <div className={`wz-balao min-w-0 max-w-full rounded-lg px-2.5 pb-2 pt-1.5 text-[14px] leading-[1.4] ${m.deMim ? 'wz-sai' : 'wz-entra'} ${ponta}`}>
        {grupo && !m.deMim && !continua && (
          <p className="mb-0.5 flex min-w-0 items-baseline justify-between gap-3 text-[12.5px]">
            <span className="truncate font-semibold" style={{ color: corDaPessoa(remetenteDoBalao(m)) }}>{remetenteDoBalao(m)}</span>
            {m.remetenteNome?.trim() && numeroDoBalao(m.remetenteNumero) && <span data-testid={`caixa-numero-${m.id}`} className="wz-meta shrink-0 text-[11px]">{numeroDoBalao(m.remetenteNumero)}</span>}
          </p>
        )}
        {m.cita && (
          <div data-testid={`caixa-citacao-${m.id}`} className="wz-citacao mb-1 overflow-hidden rounded-md border-l-4 px-2 py-1 text-[12.5px]" style={{ borderLeftColor: corDaPessoa(nomeDaCitacao) }}>
            <p className="truncate font-semibold" style={{ color: corDaPessoa(nomeDaCitacao) }}>{nomeDaCitacao}</p>
            <p className="wz-meta line-clamp-3 break-words">
              {m.cita.texto?.trim() || (m.cita.tipo ? rotuloDoTipoDeMensagem(m.cita.tipo) : 'mensagem que não está gravada')}
            </p>
          </div>
        )}
        {m.tipo === 'reaction' ? (
          <p className="wz-meta text-[13px]">reagiu com {m.texto?.trim() || 'uma reação'}{hora}</p>
        ) : (
          <>
            {/* Layout 27/10: o arquivo de verdade (foto, áudio, vídeo, documento), no lugar do cartão "mídia não baixada". */}
            {ehMidia(m.tipo) && <MidiaDoBalao m={m} />}
            {m.texto?.trim() ? (
              <p className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${ehMidia(m.tipo) ? 'mt-1' : ''}`}>{m.texto}{hora}</p>
            ) : (
              <p className="wz-meta">{!ehMidia(m.tipo) && rotuloDoTipoDeMensagem(m.tipo)}{hora}</p>
            )}
          </>
        )}
      </div>
      {m.enviadaPor && (
        <p data-testid={`caixa-enviada-por-${m.id}`} className="wz-meta mt-0.5 text-[11px]">
          enviada por {m.enviadaPor.nome}
        </p>
      )}
    </li>
  );
}

/** Layout 26/10: cada pessoa com uma cor fixa no nome, como no WhatsApp de grupo. */
const CORES_DAS_PESSOAS = ['#1f7aec', '#c2228e', '#028a6b', '#c4532d', '#7f66ff', '#a62c71', '#0a7d8c', '#b8860b'];
function corDaPessoa(nome: string): string {
  let h = 0;
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_DAS_PESSOAS[h % CORES_DAS_PESSOAS.length];
}

/** Layout 26/10 (respiro): a mensagem continua a vez de quem falou antes (mesma pessoa, até 10 min depois). */
function mesmaVez(anterior: MensagemDaCaixa | null, m: MensagemDaCaixa): boolean {
  if (!anterior || m.tipo === 'protocolo' || anterior.deMim !== m.deMim) return false;
  if (!m.deMim && remetenteDoBalao(anterior) !== remetenteDoBalao(m)) return false;
  if (m.deMim && (anterior.enviadaPor?.nome ?? '') !== (m.enviadaPor?.nome ?? '')) return false;
  const ms = new Date(m.timestamp).getTime() - new Date(anterior.timestamp).getTime();
  return Number.isFinite(ms) && ms >= 0 && ms <= 10 * 60_000;
}

function Historico({ mensagens, grupo }: { mensagens: MensagemDaCaixa[]; grupo: boolean }) {
  const itens: React.ReactNode[] = [];
  let diaAnterior = '';
  let anterior: MensagemDaCaixa | null = null;
  for (const m of mensagens) {
    const dia = diaDoInstante(m.timestamp);
    if (dia && dia !== diaAnterior) {
      itens.push(
        <li key={`dia-${dia}`} className="mb-1 mt-4 text-center first:mt-1">
          <span className="wz-dia rounded-lg px-2.5 py-1 text-[11.5px]">{rotuloDoDia(dia)}</span>
        </li>,
      );
      diaAnterior = dia;
      anterior = null;
    }
    itens.push(<Balao key={m.id} m={m} grupo={grupo} continua={mesmaVez(anterior, m)} />);
    anterior = m.tipo === 'protocolo' ? null : m;
  }
  return <ol className="flex flex-col">{itens}</ol>;
}

const ESTADO_INICIAL: EstadoDaCaixa = { filtro: 'todas', q: '', conversa: null };

function lerEndereco(): EstadoDaCaixa {
  return typeof window === 'undefined' ? ESTADO_INICIAL : estadoDoEndereco(window.location.search);
}

function visivel(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** Quantas mensagens novas chegaram enquanto a pessoa lia mais acima. */
function contarNovas(antes: MensagemDaCaixa[], depois: MensagemDaCaixa[]): number {
  const ids = new Set(antes.map((m) => m.id));
  return depois.filter((m) => !ids.has(m.id)).length;
}

/** A pessoa está lendo o fim da conversa (ou perto dele)? */
function pertoDoFim(el: HTMLElement | null): boolean {
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

export function CaixaDoWhatsapp({
  embutida = false,
  visivel: estaVisivel = true,
  aoMudarEstado,
}: {
  /** Dentro do Chat flutuante: estado em memória, uma coluna, altura do popup. */
  embutida?: boolean;
  /** O popup está aberto nesta aba? Fechado, a caixa não relê a API. */
  visivel?: boolean;
  /** Para o popup montar o link "abrir inteira" com a conversa de agora. */
  aoMudarEstado?: (estado: EstadoDaCaixa) => void;
} = {}) {
  const { token, ready } = useAuth();
  const [estado, setEstado] = useState<EstadoDaCaixa>(() => (embutida ? ESTADO_INICIAL : lerEndereco()));
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
  // Layout 27/10: o arquivo escolhido para mandar (clipe, colar imagem ou arrastar para a conversa); o texto vira a legenda.
  const [anexo, setAnexo] = useState<File | null>(null);
  const [previaDoAnexo, setPreviaDoAnexo] = useState<string | null>(null);
  const [erroDoAnexo, setErroDoAnexo] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const seletorDeArquivo = useRef<HTMLInputElement | null>(null);
  const [arquivando, setArquivando] = useState(false);
  const [erroDaAcao, setErroDaAcao] = useState<unknown>(null);
  // L7: a conversa anterior continua na tela, esmaecida, enquanto a nova não chega.
  const [trocando, setTrocando] = useState(false);
  // L7: mensagens de fora que chegaram com a pessoa lendo mais acima.
  const [novasAbaixo, setNovasAbaixo] = useState(0);

  const historico = useRef<HTMLDivElement | null>(null);
  const caixaDeTexto = useRef<HTMLTextAreaElement | null>(null);
  const pedidoDaLista = useRef(0);
  const conversaAtual = useRef<string | null>(estado.conversa);
  conversaAtual.current = estado.conversa;
  const visivelAgora = useRef(estaVisivel);
  visivelAgora.current = estaVisivel;
  // A rolagem a refazer depois de pintar: 'fim' (abriu, chegou mensagem, respondeu) ou a altura de antes (mais antigas).
  const rolar = useRef<'fim' | { altura: number; topo: number } | null>(null);

  // ------------------------------------------------------------------ endereço

  const irPara = useCallback(
    (novo: EstadoDaCaixa, modo: 'push' | 'replace' = 'replace') => {
      setEstado(novo);
      aoMudarEstado?.(novo);
      // Embutida, a caixa não é dona do endereço: a pessoa está em outra tela.
      if (embutida || typeof window === 'undefined') return;
      const url = enderecoDaCaixa(novo);
      if (`${window.location.pathname}${window.location.search}` !== url) {
        window.history[modo === 'push' ? 'pushState' : 'replaceState'](null, '', url);
      }
    },
    [embutida, aoMudarEstado],
  );

  useEffect(() => {
    if (embutida) return;
    const aoVoltar = () => {
      const e = lerEndereco();
      setEstado(e);
      setBusca(e.q);
    };
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, [embutida]);

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
      if (visivel() && visivelAgora.current) void carregarLista();
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
        const noFim = pertoDoFim(historico.current);
        setAberta(r);
        setErroDaConversa(null);
        if (primeira) {
          setMensagens(r.mensagens);
          setMaisAntigas(r.maisAntigas);
          setTrocando(false);
          setNovasAbaixo(0);
          rolar.current = 'fim';
        } else {
          setMensagens((atuais) => {
            const juntas = juntarMensagens(atuais, r.mensagens);
            if (juntas.length === atuais.length) return juntas;
            // No fim, a lista acompanha; mais acima, só o aviso "novas mensagens" aparece.
            if (noFim) rolar.current = 'fim';
            else setNovasAbaixo((n) => n + contarNovas(atuais, juntas));
            return juntas;
          });
        }
        if (primeira || r.conversa.naoLidas > 0) void marcarLida(id);
      } catch (e) {
        if (conversaAtual.current === id) {
          setErroDaConversa(e);
          setTrocando(false);
        }
      }
    },
    [token, marcarLida],
  );

  useEffect(() => {
    // Trocar de conversa não limpa a lista: a anterior fica esmaecida até a nova chegar (L7).
    // Voltar à lista (sem conversa) limpa tudo.
    setAberta(null);
    setMaisAntigas(false);
    setErroDaConversa(null);
    setErroDoEnvio(null);
    setErroDaAcao(null);
    setTexto('');
    setAnexo(null);
    setErroDoAnexo(null);
    setNovasAbaixo(0);
    if (!estado.conversa) {
      setMensagens([]);
      setTrocando(false);
      return;
    }
    setTrocando(true);
    if (!ready || !token) return;
    const id = estado.conversa;
    void carregarConversa(id, true);
    const t = window.setInterval(() => {
      if (visivel() && visivelAgora.current) void carregarConversa(id, false);
    }, RELEITURA_DA_CAIXA_MS);
    return () => window.clearInterval(t);
  }, [ready, token, estado.conversa, carregarConversa]);

  // L7: ao REAPARECER (popup reaberto, aba trocada), relê na hora o que ficou parado.
  // Na montagem quem lê são os efeitos acima; este só vale da segunda vez em diante.
  const jaMontou = useRef(false);
  useEffect(() => {
    if (!jaMontou.current) {
      jaMontou.current = true;
      return;
    }
    if (!estaVisivel || !ready || !token) return;
    void carregarLista();
    if (estado.conversa) void carregarConversa(estado.conversa, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estaVisivel]);

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

  /*
   * L7: a conversa abre no FIM e com a caixa de texto em foco. Antes de pintar
   * (`useLayoutEffect`), sem animação: `scrollIntoView smooth` depois do render
   * era o que fazia a conversa aparecer no começo e descer rolando. Vale ao
   * trocar de conversa, ao popup reaparecer e ao a lista chegar pela primeira
   * vez. O foco só vai sozinho onde há teclado físico (desktop ou o popup): no
   * celular, abrir o teclado por conta própria cobre metade da conversa.
   */
  const idAberta = aberta?.conversa.id ?? null;
  useLayoutEffect(() => {
    if (!estaVisivel || !idAberta) return;
    const el = historico.current;
    if (el) el.scrollTop = el.scrollHeight;
    const comTeclado = embutida || (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)')?.matches);
    if (comTeclado && caixaDeTexto.current && !caixaDeTexto.current.disabled) {
      caixaDeTexto.current.focus({ preventScroll: true });
    }
  }, [estaVisivel, idAberta, embutida]);

  function aoRolar() {
    const el = historico.current;
    if (!el) return;
    if (el.scrollTop < 40 && maisAntigas && !carregandoAntigas) void carregarAntigas();
    if (novasAbaixo > 0 && pertoDoFim(el)) setNovasAbaixo(0);
  }

  function descerAoFim() {
    const el = historico.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNovasAbaixo(0);
  }

  // ------------------------------------------------------------------- ações

  // Layout 27/10: a miniatura da foto escolhida, solta quando o arquivo sai ou muda.
  useEffect(() => {
    if (!anexo || !anexo.type.startsWith('image/')) {
      setPreviaDoAnexo(null);
      return;
    }
    const url = URL.createObjectURL(anexo);
    setPreviaDoAnexo(url);
    return () => URL.revokeObjectURL(url);
  }, [anexo]);

  /** Layout 27/10: confere o teto do WhatsApp antes de aceitar o arquivo (a API confere de novo). */
  function escolherArquivo(f: File | null | undefined) {
    if (!f) return;
    const tipo = tipoDaMidiaParaEnviar(f.type);
    if (!f.size) {
      setErroDoAnexo('O arquivo está vazio.');
      return;
    }
    if (f.size > tetoDaMidiaParaEnviar(tipo)) {
      setErroDoAnexo(fraseDoTetoDaMidia(tipo));
      return;
    }
    setErroDoAnexo(null);
    setErroDoEnvio(null);
    setAnexo(f);
  }

  function tirarAnexo() {
    setAnexo(null);
    setErroDoAnexo(null);
    if (seletorDeArquivo.current) seletorDeArquivo.current.value = '';
  }

  async function responder() {
    const id = estado.conversa;
    const comArquivo = anexo;
    const legendaCabe = texto.replace(/\r\n/g, '\n').trim().length <= TETO_DA_RESPOSTA_DA_CAIXA;
    if (!token || !id || !aberta || enviando || (comArquivo ? !legendaCabe : !textoEnviavel(texto))) return;
    setEnviando(true);
    setErroDoEnvio(null);
    try {
      let r: RespostaEnviada;
      if (comArquivo) {
        const form = new FormData();
        form.append('arquivo', comArquivo, comArquivo.name);
        form.append('legenda', texto);
        r = await apiFormulario<RespostaEnviada>(`/whatsapp/conversas/${encodeURIComponent(id)}/midia`, form, token);
      } else {
        r = await apiPost<RespostaEnviada>(`/whatsapp/conversas/${encodeURIComponent(id)}/responder`, { texto }, token);
      }
      if (conversaAtual.current === id) {
        // O áudio sai sem legenda: o que estava escrito fica na caixa para mandar depois.
        if (!comArquivo || tipoDaMidiaParaEnviar(comArquivo.type) !== 'audio') setTexto('');
        if (comArquivo) tirarAnexo();
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
  // Layout 27/10: com arquivo, o texto é a legenda (pode ficar vazia); o áudio sai sem legenda.
  const tipoDoAnexo = anexo ? tipoDaMidiaParaEnviar(anexo.type) : null;
  const podeEnviar = !razao && !enviando && (anexo ? tamanho <= TETO_DA_RESPOSTA_DA_CAIXA : textoEnviavel(texto));
  const recebeArquivo = !!aberta && !razao;

  /** Layout 27/10: arrastar um arquivo para a conversa o deixa pronto para mandar. */
  const arrasto = {
    onDragOver: (e: React.DragEvent) => {
      if (!recebeArquivo || !Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      e.preventDefault();
      if (!arrastando) setArrastando(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!recebeArquivo) return;
      e.preventDefault();
      setArrastando(false);
      escolherArquivo(e.dataTransfer?.files?.[0]);
    },
  };

  const chips = CHIPS_DA_CAIXA;
  // Embutida no popup é sempre UMA coluna por vez, seja qual for a largura da janela;
  // na página, as duas colunas a partir de 768 px (`max-md:hidden`).
  const esconder = embutida ? 'hidden' : 'max-md:hidden';

  return (
    // Na página, a altura é a da tela menos o topo do OS e a faixa do botão flutuante:
    // a página não rola, cada coluna rola por dentro. No popup, a altura é a que o popup der.
    <div
      data-testid="caixa"
      data-embutida={embutida ? 'sim' : undefined}
      className={
        embutida
          ? 'flex min-h-0 min-w-0 flex-1 flex-col'
          : 'flex h-[calc(100dvh-52px-2rem-3.75rem)] min-h-[30rem] min-w-0 flex-col gap-3 min-[820px]:h-[calc(100dvh-46px-3rem-3.5rem)]'
      }
    >
      {!embutida && (
        <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-[13px] text-muted">As conversas do número da empresa com leads, clientes, equipe e comunidade.</p>
          <Link href="/whatsapp/simulador" data-testid="caixa-ir-para-celulares" className={`text-[12.5px] text-muted underline underline-offset-2 hover:text-brand ${FOCO}`}>
            Celulares do comercial
          </Link>
        </header>
      )}

      <div
        data-testid="caixa-grade"
        data-vista={vista}
        className={
          embutida
            ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]'
            : 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]'
        }
      >
        {/* ------------------------------------------------------------ lista */}
        <section aria-label="Conversas" data-testid="caixa-coluna-lista" className={`${COLUNA} ${embutida ? 'rounded-none border-0' : ''} ${vista === 'lista' ? '' : esconder}`}>
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
            <ul data-testid="caixa-lista" className="space-y-1">
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
        <section
          aria-label="Conversa aberta"
          data-testid="caixa-coluna-conversa"
          data-arrastando={arrastando ? 'sim' : undefined}
          className={`${COLUNA} relative ${embutida ? 'rounded-none border-0' : ''} ${vista === 'conversa' ? '' : esconder}`}
          {...arrasto}
        >
          {arrastando && (
            <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded border-2 border-dashed border-brand bg-surface/85 text-[14px] font-semibold">
              Solte o arquivo para mandar nesta conversa
            </div>
          )}
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
                    className={`${BOTAO} ${embutida ? '' : 'md:hidden'}`}
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
                    <button type="button" data-testid="caixa-arquivar" aria-label={aberta.conversa.arquivada ? 'Voltar para a caixa' : 'Arquivar conversa'} onClick={() => void alternarArquivo()} disabled={arquivando} className={`${BOTAO} shrink-0`}>
                      {/* No celular (e no popup) o rótulo encolhe, para o nome da conversa caber ao lado do Voltar. */}
                      <span className={embutida ? 'hidden' : 'max-md:hidden'}>{aberta.conversa.arquivada ? 'Voltar para a caixa' : 'Arquivar conversa'}</span>
                      <span className={embutida ? '' : 'md:hidden'}>{aberta.conversa.arquivada ? 'Desarquivar' : 'Arquivar'}</span>
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

              {/* O envelope é `relative` para o aviso de novas mensagens flutuar sobre a lista sem entrar na rolagem. */}
              <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                  ref={historico}
                  data-testid="caixa-historico"
                  onScroll={aoRolar}
                  aria-busy={trocando || undefined}
                  className={`wz-fundo min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 ${embutida ? '' : 'md:px-[5%]'}`}
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
                      {/* L7: a lista anterior fica, esmaecida, até a nova chegar; nada desmonta. */}
                      {trocando && !erroDaConversa && (
                        <p data-testid="caixa-abrindo" className="sticky top-0 z-[1] mx-auto mb-2 w-fit rounded-lg bg-surface/90 px-2.5 py-1 text-center text-[11.5px] text-muted">
                          {mensagens.length ? 'Abrindo a conversa…' : 'Abrindo…'}
                        </p>
                      )}
                      <div className={trocando && mensagens.length ? 'opacity-40 transition-opacity' : 'transition-opacity'}>
                        <Historico mensagens={mensagens} grupo={!!aberta?.conversa.grupo} />
                      </div>
                    </>
                  )}
                </div>
                {novasAbaixo > 0 && (
                  <button
                    type="button"
                    data-testid="caixa-novas-mensagens"
                    onClick={descerAoFim}
                    className={`absolute bottom-2 right-3 z-[1] rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-text shadow ${FOCO}`}
                  >
                    {novasAbaixo === 1 ? '1 nova mensagem ↓' : `${novasAbaixo} novas mensagens ↓`}
                  </button>
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
                  {/* Layout 27/10: o arquivo escolhido, com a miniatura da foto e o "x" para tirar. */}
                  {anexo && (
                    <div data-testid="caixa-anexo" className="flex min-w-0 items-center gap-2 rounded border border-border bg-bg/40 p-1.5">
                      {previaDoAnexo ? (
                        <img data-testid="caixa-anexo-previa" src={previaDoAnexo} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                      ) : (
                        <span aria-hidden className="flex h-12 w-10 shrink-0 items-center justify-center rounded bg-surface-2 font-os-mono text-[9px] uppercase text-muted">
                          {(anexo.name.split('.').pop() ?? 'arq').slice(0, 4)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span data-testid="caixa-anexo-nome" className="block truncate text-[13px]" title={anexo.name}>
                          {anexo.name}
                        </span>
                        <span className="block text-[11px] text-muted">
                          {rotuloDoTipoDeMensagem(tipoDoAnexo ?? 'document')} · {tamanhoLegivel(anexo.size)}
                        </span>
                      </span>
                      <button
                        type="button"
                        data-testid="caixa-anexo-tirar"
                        aria-label="Tirar o arquivo"
                        onClick={tirarAnexo}
                        disabled={enviando}
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-[18px] leading-none text-muted hover:text-text disabled:opacity-50 ${FOCO}`}
                      >
                        ×
                      </button>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">{anexo ? 'Legenda' : 'Mensagem'}</span>
                      <textarea
                        ref={caixaDeTexto}
                        data-testid="caixa-resposta"
                        rows={2}
                        value={texto}
                        maxLength={TETO_DA_RESPOSTA_DA_CAIXA + 200}
                        disabled={!!razao || enviando}
                        onChange={(e) => setTexto(e.target.value)}
                        onKeyDown={aoTeclar}
                        onPaste={(e) => {
                          // Layout 27/10: colar uma imagem (print) a deixa pronta para mandar.
                          const f = e.clipboardData?.files?.[0];
                          if (f && !razao) {
                            e.preventDefault();
                            escolherArquivo(f);
                          }
                        }}
                        placeholder={
                          razao
                            ? ''
                            : tipoDoAnexo === 'audio'
                              ? 'O áudio sai como mensagem de voz, sem legenda.'
                              : anexo
                                ? 'Legenda (opcional). Enter envia.'
                                : 'Escreva a resposta. Enter envia, Shift+Enter quebra a linha.'
                        }
                        className={`${INPUT} max-h-40 min-h-[44px] resize-y disabled:cursor-not-allowed disabled:opacity-60`}
                      />
                    </label>
                    <input
                      ref={seletorDeArquivo}
                      type="file"
                      data-testid="caixa-anexo-input"
                      className="hidden"
                      tabIndex={-1}
                      aria-hidden
                      onChange={(e) => escolherArquivo(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      data-testid="caixa-anexar"
                      aria-label="Anexar arquivo"
                      title="Anexar foto, vídeo, áudio ou documento"
                      onClick={() => seletorDeArquivo.current?.click()}
                      disabled={!!razao || enviando}
                      className={`${BOTAO} shrink-0 px-2.5`}
                    >
                      <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                      </svg>
                    </button>
                    <button type="submit" data-testid="caixa-enviar" disabled={!podeEnviar} className={BOTAO_PRIMARIO}>
                      {enviando ? 'Enviando…' : 'Enviar'}
                    </button>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {erroDoAnexo && (
                        <p role="alert" data-testid="caixa-anexo-erro" className="text-[12.5px] text-bad">
                          {erroDoAnexo}
                        </p>
                      )}
                      <ErroDaAcao erro={erroDoEnvio} />
                    </div>
                    <span data-testid="caixa-contador" className={`ml-auto shrink-0 font-os-mono text-[10.5px] tabular-nums ${tamanho > TETO_DA_RESPOSTA_DA_CAIXA ? 'text-bad' : 'text-muted'}`}>
                      {tamanho}/{TETO_DA_RESPOSTA_DA_CAIXA}
                    </span>
                  </div>
                  {/* Layout 26/10: a mensagem sai como ROOT; o nome de quem enviou fica só aqui dentro. */}
                  {!razao && (
                    <p data-testid="caixa-aviso-envio" className="text-[11px] text-muted">
                      {tipoDoAnexo === 'audio'
                        ? 'O áudio sai pelo número da empresa como mensagem de voz, sem o seu nome.'
                        : anexo
                          ? 'O arquivo sai pelo número da empresa, com o seu nome em negrito na legenda.'
                          : 'Sai pelo número da empresa, com o seu nome em negrito no topo, para o cliente saber quem está falando. O clipe manda foto, vídeo, áudio ou documento.'}
                    </p>
                  )}
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
