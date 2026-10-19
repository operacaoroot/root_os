'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  PROPOSTA_ROTULO_DA_SECAO,
  PROPOSTA_SECOES,
  PROPOSTA_TEXTO_MAX,
  type AnotacaoNaProposta,
  type EstadoDaSala,
  type OfertaNaSala,
  type PropostaNaSala,
  type PropostaSecao,
  type ReacoesNaPaginaDaProposta,
} from '@mktos/shared';

import { API_BASE, apiGet, apiPost } from '@/lib/api';
import { abrirPropostaDaSala, dataCurta, horaCurta, reais, ROTULO_DA_FORMA } from '@/lib/sala-do-cliente';

/*
 * A PROPOSTA COMPLETA — `/s/<token>/proposta` (rodada da implantação I4, prancheta 4).
 *
 * Sem login, como a sala (`/s` está em `PUBLICAS` do AppShell): o token na URL
 * é a credencial. A página lê o MESMO estado da sala (`GET /api/sala/:token`) e
 * mostra a proposta em três seções, cada uma com a barra de reação ("faz
 * sentido", "tenho uma dúvida", "anotar uma ideia") e o registro de leitura.
 *
 * LEITURA: a seção que ocupa a faixa do meio da tela, com a aba visível, soma
 * um segundo por segundo. A primeira batida sai com 2 s (é o "vi a seção", que
 * também grava o `proposta.lida` dos blocos dela no servidor), as seguintes a
 * cada 15 s, e o que sobrou sai quando a seção deixa a tela, quando a aba fica
 * oculta e quando a página fecha (`fetch` com `keepalive`). Nada além do token
 * e dos segundos vai junto.
 *
 * O texto que o cliente escreve volta da API já varrido de segredo e é
 * renderizado como texto (o React escapa); nunca como HTML.
 *
 * Nada aqui é inventado: o que a proposta não traz aparece como "[a decidir]".
 * O número do WhatsApp da Root é decisão pendente da mesa: o botão mostra o
 * marcador e não abre conversa nenhuma.
 */

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const INPUT = `w-full rounded-lg border border-border bg-bg px-3 py-2 text-[14px] outline-none focus:border-brand ${FOCO}`;
const BOTAO_PRIMARIO = `inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand px-4 py-3 text-[14px] font-semibold text-ink transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 ${FOCO}`;
const BOTAO = `inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border px-4 py-2 text-[14px] transition hover:border-brand disabled:opacity-50 ${FOCO}`;
const CHIP = `inline-flex min-h-[44px] items-center rounded-full border px-4 text-[13px] transition ${FOCO}`;
const CARTAO = 'rounded-xl border border-border bg-surface p-4';
const ROTULO = 'font-os-mono text-[10.5px] uppercase tracking-[0.16em] text-muted';
const A_DECIDIR = '[a decidir]';
const NUMERO_DA_ROOT = '[NÚMERO DA ROOT]';

/** Batidas de leitura: a primeira cedo (a seção foi vista), as seguintes espaçadas. */
const PRIMEIRA_BATIDA_S = 2;
const BATIDA_S = 15;
const MAX_POR_BATIDA_S = 60;

export default function PropostaDaSalaPage() {
  const { token } = useParams<{ token: string }>();
  const base = `/sala/${token}`;
  const [estado, setEstado] = useState<EstadoDaSala | null>(null);
  const [reacoes, setReacoes] = useState<ReacoesNaPaginaDaProposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    abrirPropostaDaSala<EstadoDaSala>(
      base,
      (caminho, corpo) => apiPost<EstadoDaSala>(caminho, corpo),
      (caminho) => apiGet<EstadoDaSala>(caminho),
    )
      .then((e) => {
        setEstado(e);
        if (e.proposta) return apiGet<ReacoesNaPaginaDaProposta>(`${base}/proposta/reacoes`).then(setReacoes).catch(() => undefined);
        return undefined;
      })
      .catch((e: Error & { status?: number }) => setErro(e.status === 404 || /não encontrada/.test(e.message) ? 'Este endereço não existe ou já expirou. Fale com a Root pelo WhatsApp.' : e.message));
  }, [base]);

  const sentinela = useLeituraPorSecao(base, estado?.proposta?.versao ?? null);

  const reagir = useCallback(
    async (corpo: { secao: PropostaSecao; tipo: 'faz_sentido' | 'duvida' | 'ideia'; texto?: string }) => {
      const versao = estado?.proposta?.versao;
      if (!versao) throw new Error('a proposta ainda não foi publicada');
      const r = await apiPost<ReacoesNaPaginaDaProposta>(`${base}/proposta/reacao`, { ...corpo, versao });
      setReacoes(r);
      return r;
    },
    [base, estado?.proposta?.versao],
  );

  if (erro) {
    return (
      <Casca>
        <Marca />
        <p className={`${CARTAO} text-[14px]`} role="alert">{erro}</p>
      </Casca>
    );
  }
  if (!estado) {
    return (
      <Casca>
        <Marca />
        <p className="text-[13px] text-muted" aria-busy>abrindo a sua proposta…</p>
      </Casca>
    );
  }
  const p = estado.proposta;
  if (!p) {
    return (
      <Casca>
        <Marca />
        <p className={`${CARTAO} text-[14px]`}>A proposta ainda não foi publicada nesta sala. Ela aparece aqui assim que estiver pronta.</p>
        <a href={`/s/${encodeURIComponent(token)}`} className={`${BOTAO} mt-3`}>voltar para a sala</a>
      </Casca>
    );
  }

  const anotacoesDa = (s: PropostaSecao) => (reacoes?.anotacoes ?? []).filter((a) => a.secao === s);
  const barra = (s: PropostaSecao) => (
    <BarraDeReacao secao={s} marcadoFazSentido={reacoes?.fazSentido.includes(s) ?? false} reagir={reagir} anotacoes={anotacoesDa(s)} duvidas={p.duvidas ?? []} />
  );

  return (
    <Casca largo>
      <Marca />
      <header className="mb-5">
        <p className={ROTULO}>proposta para</p>
        <h1 className="text-[24px] font-bold leading-tight">{estado.empresa}</h1>
        <p className="mt-1 font-os-mono text-[11px] text-muted">
          versão {p.versao} · publicada {dataCurta(p.publicadaEm)} · {p.validaAte ? `vale até ${dataCurta(p.validaAte)}` : `validade ${A_DECIDIR}`}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0 space-y-5">
          <Secao secao="montar" n={1} refLeitura={sentinela('montar')} barra={barra('montar')}>
            <OQueVamosMontar p={p} />
          </Secao>
          <Secao secao="funciona" n={2} refLeitura={sentinela('funciona')} barra={barra('funciona')}>
            <ComoFunciona p={p} />
          </Secao>
          <Secao secao="investimento" n={3} refLeitura={sentinela('investimento')} barra={barra('investimento')}>
            <Investimento p={p} />
          </Secao>
        </main>
        <Rail estado={estado} p={p} token={token} reacoes={reacoes} />
      </div>

      <p className="mt-6 text-center text-[11px] text-muted">
        Este endereço é só seu e vale até {dataCurta(estado.validoAte)}. Registramos quais partes da proposta você leu e por quanto tempo, para a conversa ir direto ao que importa. Senha, token e dado bancário nunca entram por aqui.
      </p>
    </Casca>
  );
}

// ---------------------------------------------------------------------------
// As seções
// ---------------------------------------------------------------------------

function Secao({ secao, n, refLeitura, barra, children }: { secao: PropostaSecao; n: number; refLeitura: (el: HTMLElement | null) => void; barra: React.ReactNode; children: React.ReactNode }) {
  const id = useId();
  return (
    <section ref={refLeitura} aria-labelledby={id} data-secao={secao} className={`${CARTAO} space-y-4`}>
      <h2 id={id} className="font-os-mono text-[11.5px] font-semibold uppercase tracking-[0.14em] text-brand">
        {`// ${String(n).padStart(2, '0')} · ${PROPOSTA_ROTULO_DA_SECAO[secao]}`}
      </h2>
      {children}
      {barra}
    </section>
  );
}

function OQueVamosMontar({ p }: { p: PropostaNaSala }) {
  return (
    <div className="space-y-3">
      <div>
        <p className={ROTULO}>o que ouvimos de você</p>
        {p.ouvimos.length ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px]">
            {p.ouvimos.map((o) => <li key={o}>{o}</li>)}
          </ul>
        ) : (
          <p className="mt-1 text-[14px] text-muted">{A_DECIDIR}</p>
        )}
      </div>
      <div className="rounded-lg border border-brand/50 p-3">
        <p className={`${ROTULO} text-brand`}>o que recomendamos</p>
        <p className="mt-1 text-[18px] font-bold">{p.recomendada.rotulo}</p>
        <p className="mt-1 text-[14px] text-muted">{p.recomendada.descricao || A_DECIDIR}</p>
      </div>
    </div>
  );
}

function linhaDaOferta(o: OfertaNaSala): string {
  const formas = o.formas.length ? o.formas.map((f) => ROTULO_DA_FORMA[f] ?? f).join(', ') : A_DECIDIR;
  return `${o.parcelas}× de ${reais(o.parcelaCentavos)} · ${formas}${o.descontoPct ? ` · ${o.descontoPct}% de desconto` : ''}`;
}

function ComoFunciona({ p }: { p: PropostaNaSala }) {
  const r = p.recomendada;
  return (
    <div className="space-y-3 text-[14px]">
      <dl className="grid gap-2 sm:grid-cols-3">
        <Dado rotulo="parcelas" valor={`${r.parcelas}× de ${reais(r.parcelaCentavos)}`} />
        <Dado rotulo="formas" valor={r.formas.length ? r.formas.map((f) => ROTULO_DA_FORMA[f] ?? f).join(', ') : A_DECIDIR} />
        <Dado rotulo="validade" valor={p.validaAte ? `até ${dataCurta(p.validaAte)}` : A_DECIDIR} />
      </dl>
      <p className="text-muted">A 1ª parcela no aceite, as outras com aviso no WhatsApp antes de cada vencimento.</p>
      {p.alternativa && (
        <div className="rounded-lg border border-border p-3">
          <p className={ROTULO}>outra opção</p>
          <p className="mt-1 font-semibold">{p.alternativa.rotulo} · {reais(p.alternativa.valorCentavos)}</p>
          <p className="font-os-mono text-[12px] text-muted">{linhaDaOferta(p.alternativa)}</p>
          {p.alternativa.descricao && <p className="mt-1 text-muted">{p.alternativa.descricao}</p>}
        </div>
      )}
    </div>
  );
}

function Investimento({ p }: { p: PropostaNaSala }) {
  const r = p.recomendada;
  const c = p.custosDeTerceiros;
  return (
    <div className="space-y-4">
      <div>
        <p className={ROTULO}>{r.rotulo}</p>
        <p className="mt-1 font-os-mono text-[34px] font-bold leading-none tracking-tight text-brand sm:text-[44px]" data-testid="preco">{reais(r.valorCentavos)}</p>
        <p className="mt-1 font-os-mono text-[12.5px] text-muted">{linhaDaOferta(r)}</p>
      </div>
      <div>
        <p className={ROTULO}>custos de terceiros, no seu nome</p>
        <table className="mt-2 w-full border-collapse text-[13.5px]">
          <caption className="sr-only">custos de terceiros por mês</caption>
          <tbody>
            <LinhaDeCusto rotulo="mês normal" valor={c?.mesNormalCentavos ?? null} />
            <LinhaDeCusto rotulo="pior mês" valor={c?.piorMesCentavos ?? null} />
            {/* A proposta ainda não traz este número: decisão da mesa, nunca inventado aqui. */}
            <LinhaDeCusto rotulo="Claude do 1º mês" valor={null} />
          </tbody>
        </table>
        {c?.exemplo && <p className="mt-2 text-[12px] text-muted">valores de exemplo, ainda não são os da sua empresa</p>}
      </div>
    </div>
  );
}

function LinhaDeCusto({ rotulo, valor }: { rotulo: string; valor: number | null }) {
  return (
    <tr className="border-t border-border">
      <th scope="row" className="py-2 pr-3 text-left font-normal text-muted">{rotulo}</th>
      <td className="py-2 text-right font-os-mono tabular-nums">{valor == null ? A_DECIDIR : reais(valor)}</td>
    </tr>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <dt className={ROTULO}>{rotulo}</dt>
      <dd className="mt-0.5 font-os-mono text-[13px]">{valor}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A barra de reação
// ---------------------------------------------------------------------------

type Reagir = (corpo: { secao: PropostaSecao; tipo: 'faz_sentido' | 'duvida' | 'ideia'; texto?: string }) => Promise<ReacoesNaPaginaDaProposta>;

function BarraDeReacao({
  secao,
  marcadoFazSentido,
  reagir,
  anotacoes,
  duvidas,
}: {
  secao: PropostaSecao;
  marcadoFazSentido: boolean;
  reagir: Reagir;
  anotacoes: AnotacaoNaProposta[];
  duvidas: { pergunta: string; resposta: string | null }[];
}) {
  const [aberto, setAberto] = useState<'duvida' | 'ideia' | null>(null);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const chips = { duvida: useRef<HTMLButtonElement>(null), ideia: useRef<HTMLButtonElement>(null) };
  const idForm = useId();
  const idContador = useId();

  useEffect(() => {
    if (aberto) campo.current?.focus();
  }, [aberto]);

  function fechar(devolverFoco = true) {
    const quem = aberto;
    setAberto(null);
    setTexto('');
    setErro(null);
    if (devolverFoco && quem) requestAnimationFrame(() => chips[quem].current?.focus());
  }

  async function enviar(tipo: 'faz_sentido' | 'duvida' | 'ideia', t?: string) {
    setOcupado(true);
    setErro(null);
    try {
      await reagir({ secao, tipo, ...(t ? { texto: t } : {}) });
      if (tipo !== 'faz_sentido') fechar();
    } catch (e) {
      setErro((e as Error).message || 'Não deu para enviar agora. Tente de novo em instantes.');
    } finally {
      setOcupado(false);
    }
  }

  const restante = PROPOSTA_TEXTO_MAX - texto.length;
  return (
    <div className="border-t border-border pt-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="o que você achou desta parte">
        <button
          type="button"
          aria-pressed={marcadoFazSentido}
          disabled={ocupado}
          onClick={() => !marcadoFazSentido && void enviar('faz_sentido')}
          className={`${CHIP} ${marcadoFazSentido ? 'border-brand bg-brand/15 font-semibold' : 'border-border hover:border-brand'}`}
        >
          faz sentido
        </button>
        {(['duvida', 'ideia'] as const).map((t) => (
          <button
            key={t}
            ref={chips[t]}
            type="button"
            aria-pressed={aberto === t}
            aria-controls={aberto === t ? idForm : undefined}
            onClick={() => (aberto === t ? fechar(false) : (setAberto(t), setTexto(''), setErro(null)))}
            className={`${CHIP} ${aberto === t ? 'border-brand bg-brand/15 font-semibold' : 'border-border hover:border-brand'}`}
          >
            {t === 'duvida' ? 'tenho uma dúvida' : 'anotar uma ideia'}
          </button>
        ))}
      </div>

      {aberto && (
        <form
          id={idForm}
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (texto.trim() && !ocupado) void enviar(aberto, texto.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              fechar();
            }
          }}
        >
          <label className="block text-[13px]">
            {aberto === 'duvida' ? 'Qual é a sua dúvida sobre esta parte?' : 'Qual é a sua ideia para esta parte?'}
            <textarea
              ref={campo}
              className={`${INPUT} mt-1`}
              rows={3}
              maxLength={PROPOSTA_TEXTO_MAX}
              value={texto}
              aria-describedby={idContador}
              onChange={(e) => setTexto(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={idContador} className={`font-os-mono text-[11px] tabular-nums ${restante < 50 ? 'text-mag' : 'text-muted'}`} aria-live="polite">
              {texto.length}/{PROPOSTA_TEXTO_MAX}
            </p>
            <div className="flex gap-2">
              <button type="button" className={BOTAO} onClick={() => fechar()}>cancelar</button>
              <button type="submit" disabled={!texto.trim() || ocupado} className={BOTAO_PRIMARIO}>{ocupado ? 'enviando…' : 'enviar'}</button>
            </div>
          </div>
        </form>
      )}
      {erro && <p role="alert" className="mt-2 text-[12.5px] text-bad">{erro}</p>}

      {anotacoes.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="as suas anotações nesta parte">
          {anotacoes.map((a) => {
            const resposta = a.tipo === 'duvida' ? duvidas.find((d) => d.pergunta === a.texto)?.resposta ?? null : null;
            return (
              <li key={a.id} className="rounded-lg border border-brand/40 bg-brand/5 p-3 text-[13.5px]">
                <p className="font-os-mono text-[10.5px] uppercase tracking-[0.12em] text-brand">
                  {a.tipo === 'duvida' ? 'a sua dúvida' : 'a sua anotação'} · enviada {horaCurta(a.em)}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{a.texto}</p>
                {a.tipo === 'duvida' && <p className="mt-1 text-muted">{resposta ?? 'Recebemos. Respondemos aqui e na sala.'}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O rail
// ---------------------------------------------------------------------------

function Rail({ estado, p, token, reacoes }: { estado: EstadoDaSala; p: PropostaNaSala; token: string; reacoes: ReacoesNaPaginaDaProposta | null }) {
  const r = p.recomendada;
  const aceita = Boolean(estado.aceite?.forma);
  const n = reacoes?.contagem ?? { anotacoes: 0, duvidas: 0 };
  const idWhats = useId();
  return (
    <aside aria-label="resumo da proposta" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
      <div className={`${CARTAO} space-y-3`}>
        <p className={ROTULO}>resumo</p>
        <div>
          <p className="text-[15px] font-bold">{r.rotulo}</p>
          <p className="font-os-mono text-[20px] font-bold text-brand">{reais(r.valorCentavos)}</p>
          <p className="font-os-mono text-[11.5px] text-muted">{r.parcelas}× de {reais(r.parcelaCentavos)} · {p.validaAte ? `vale até ${dataCurta(p.validaAte)}` : `validade ${A_DECIDIR}`}</p>
        </div>
        {aceita ? (
          <a href={`/s/${encodeURIComponent(token)}#aceite`} className={`${BOTAO} w-full`}>você aceitou · ver na sala</a>
        ) : (
          <a href={`/s/${encodeURIComponent(token)}#aceite`} className={`${BOTAO_PRIMARIO} w-full`}>aceitar a proposta</a>
        )}
        {/* O número da Root é decisão pendente da mesa: o botão mostra o marcador e não abre conversa nenhuma. */}
        <button type="button" aria-disabled="true" aria-describedby={idWhats} className={`${BOTAO} w-full cursor-not-allowed opacity-70`} onClick={(e) => e.preventDefault()}>
          falar no WhatsApp
        </button>
        <p id={idWhats} className="font-os-mono text-[11px] text-muted">{NUMERO_DA_ROOT}</p>
        <p className="border-t border-border pt-3 font-os-mono text-[12px] tabular-nums" aria-live="polite" data-testid="contador">
          {n.anotacoes} {n.anotacoes === 1 ? 'anotação' : 'anotações'} · {n.duvidas} {n.duvidas === 1 ? 'dúvida' : 'dúvidas'}
        </p>
        <a href={`/s/${encodeURIComponent(token)}`} className={`inline-flex min-h-[44px] items-center text-[13px] text-muted underline underline-offset-2 ${FOCO}`}>voltar para a sala</a>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// O registro de leitura
// ---------------------------------------------------------------------------

/**
 * Devolve, por seção, o `ref` que liga o observador. A seção conta como
 * visível quando cruza a faixa do meio da tela (a margem corta 20% em cima e
 * embaixo): seção mais alta que a tela também conta, coisa que um limiar de
 * 50% nunca alcançaria no celular.
 */
function useLeituraPorSecao(base: string, versao: number | null) {
  const visiveis = useRef(new Set<PropostaSecao>());
  const pendente = useRef<Record<string, number>>({});
  const vista = useRef(new Set<PropostaSecao>());
  const observadores = useRef(new Map<PropostaSecao, IntersectionObserver>());
  const versaoAtual = useRef(versao);
  versaoAtual.current = versao;

  const enviar = useCallback(
    (secao: PropostaSecao) => {
      const v = versaoAtual.current;
      let s = Math.floor(pendente.current[secao] ?? 0);
      if (!v || s < 1) return;
      pendente.current[secao] = 0;
      const url = `${API_BASE}${base}/proposta/leitura`;
      while (s > 0) {
        const parte = Math.min(s, MAX_POR_BATIDA_S);
        s -= parte;
        const corpo = JSON.stringify({ secao, segundos: parte, versao: v });
        try {
          void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo, keepalive: true }).catch(() => undefined);
        } catch {
          // Sem `fetch` com keepalive: o beacon leva a batida mesmo com a página fechando.
          if (typeof navigator !== 'undefined' && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([corpo], { type: 'application/json' }));
        }
      }
    },
    [base],
  );

  const enviarTudo = useCallback(() => {
    for (const s of PROPOSTA_SECOES) enviar(s);
  }, [enviar]);

  useEffect(() => {
    if (!versao) return;
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      for (const s of visiveis.current) {
        pendente.current[s] = (pendente.current[s] ?? 0) + 1;
        const limite = vista.current.has(s) ? BATIDA_S : PRIMEIRA_BATIDA_S;
        if (pendente.current[s] >= limite) {
          vista.current.add(s);
          enviar(s);
        }
      }
    }, 1000);
    const oculta = () => {
      if (document.visibilityState === 'hidden') enviarTudo();
    };
    document.addEventListener('visibilitychange', oculta);
    window.addEventListener('pagehide', enviarTudo);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', oculta);
      window.removeEventListener('pagehide', enviarTudo);
      enviarTudo();
    };
  }, [versao, enviar, enviarTudo]);

  useEffect(() => {
    const obs = observadores.current;
    return () => {
      for (const o of obs.values()) o.disconnect();
      obs.clear();
    };
  }, []);

  // Um `ref` estável por seção: uma função nova a cada render faria o React
  // desligar e religar o observador em toda atualização da página.
  const refs = useMemo(() => {
    const porSecao = {} as Record<PropostaSecao, (el: HTMLElement | null) => void>;
    for (const secao of PROPOSTA_SECOES) {
      porSecao[secao] = (el) => {
        observadores.current.get(secao)?.disconnect();
        observadores.current.delete(secao);
        if (!el) {
          visiveis.current.delete(secao);
          return;
        }
        if (typeof IntersectionObserver === 'undefined') return;
        const o = new IntersectionObserver(
          ([e]) => {
            if (e?.isIntersecting) visiveis.current.add(secao);
            else {
              visiveis.current.delete(secao);
              // Saiu da tela: o que ela acumulou sai agora, se já passou de 1 s.
              if (vista.current.has(secao)) enviar(secao);
            }
          },
          { rootMargin: '-20% 0px -20% 0px', threshold: 0 },
        );
        o.observe(el);
        observadores.current.set(secao, o);
      };
    }
    return porSecao;
  }, [enviar]);

  return useCallback((secao: PropostaSecao) => refs[secao], [refs]);
}

// ---------------------------------------------------------------------------

function Casca({ children, largo = false }: { children: React.ReactNode; largo?: boolean }) {
  return (
    <div data-os-app className="min-h-screen bg-bg p-4 text-text [overflow-wrap:anywhere]">
      <div className={`mx-auto w-full min-w-0 py-6 ${largo ? 'max-w-md md:max-w-2xl lg:max-w-5xl' : 'max-w-md md:max-w-xl'}`}>{children}</div>
    </div>
  );
}

function Marca() {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span aria-hidden className="grid h-10 w-10 place-items-center rounded-root border border-brand/30 bg-brand/10 text-[20px] font-extrabold italic leading-none tracking-[-0.05em] text-brand" style={{ transform: 'skewX(-10deg)', textShadow: 'var(--os-logo-shadow, none)' }}>
        R
      </span>
      <div className="font-os-mono">
        <div className="text-[13px] font-bold">Operação ROOT</div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">proposta</div>
      </div>
    </div>
  );
}
