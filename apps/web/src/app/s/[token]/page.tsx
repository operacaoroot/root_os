'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { EstadoDaSala, OfertaNaSala, SalaBlocoDaProposta } from '@mktos/shared';

import { apiPost, apiUpload } from '@/lib/api';
import { Acompanhamento, type EstadoDaSalaComAcompanhamento } from './Acompanhamento';
import { AreaDoCliente } from './AreaDoCliente';
import { SalaPublicada } from './SalaPublicada';
import { abrirSalaMarcando, dataCurta, localSPParaIso, reais, ROTULO_DA_FORMA, rotuloDoHorario, soDigitos } from '@/lib/sala-do-cliente';

/*
 * A SALA DO CLIENTE — `/s/<token>`, telas 02, 07 e 08 do desenho (Lane B, 13/10/2026).
 *
 * Sem login (a rota está em `PUBLICAS` do AppShell): o token na URL é a
 * credencial, e é o MESMO do primeiro contato ao kickoff. Cada estágio acende
 * quando o fato chega ao fio do lead: conversa, diagnóstico, proposta,
 * contrato, começo. A página não guarda progresso: o estado é o da API a cada
 * resposta. Leitura da proposta é rastreada por bloco (o bloco que aparece na
 * tela por um segundo conta como lido, uma vez por visita).
 *
 * Produto da Operação ROOT: tema e componentes do próprio OS, claro e escuro.
 *
 * L6 (leva 5): o bloco "acompanhamento" (etapa em palavras de cliente, o que
 * vem agora, documentos trocados, contato da Root) vem DERIVADO da API a cada
 * leitura, com ou sem versão publicada. Sem versão publicada o contato entra no
 * bloco; com versão, o botão fixo do WhatsApp da `SalaPublicada` usa o número
 * derivado quando a mesa já o escreveu.
 */

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const INPUT = `w-full rounded-lg border border-border bg-bg px-3 py-2 text-[14px] outline-none focus:border-brand ${FOCO}`;
const BOTAO_PRIMARIO = `rounded-lg bg-brand px-4 py-3 text-[14px] font-semibold text-ink transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 ${FOCO}`;
const BOTAO = `rounded-lg border border-border px-4 py-3 text-[14px] transition hover:border-brand disabled:opacity-50 ${FOCO}`;
const CARTAO = 'rounded-xl border border-border bg-surface p-4';
const ROTULO = 'font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted';

export default function SalaPage() {
  const { token } = useParams<{ token: string }>();
  const base = `/sala/${token}`;
  const [estado, setEstado] = useState<EstadoDaSalaComAcompanhamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erroDe, setErroDe] = useState<Record<string, string>>({});
  /*
   * I3 (rodada da implantação): o aceite começa por um clique em "aceitar" (na
   * sala ou na página da proposta, que traz `#aceite`). Antes, o bloco só existia
   * a partir do estágio contrato, e o botão rolava para um lugar que não existia:
   * o formulário que leva AO contrato morava dentro dele.
   */
  const [querAceitar, setQuerAceitar] = useState(false);
  useEffect(() => {
    if (window.location.hash === '#aceite') setQuerAceitar(true);
  }, []);
  const temEstado = Boolean(estado);
  useEffect(() => {
    if (!querAceitar || !temEstado) return;
    requestAnimationFrame(() => document.getElementById('aceite')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [querAceitar, temEstado]);

  // B-11: abrir a página é a visita (POST, uma vez); o GET da sala só lê.
  useEffect(() => {
    // I4: a sala marca a visita na aba, para a página da proposta não contar a mesma visita de novo.
    abrirSalaMarcando<EstadoDaSalaComAcompanhamento>(base, (caminho, corpo) => apiPost<EstadoDaSalaComAcompanhamento>(caminho, corpo))
      .then(setEstado)
      .catch((e: Error & { status?: number }) => setErro(e.status === 404 || /não encontrada/.test(e.message) ? 'Este endereço não abre: a sala não existe, venceu ou ganhou um link novo. Peça à Root o link atual pelo WhatsApp.' : e.message));
  }, [base]);

  const agir = useCallback(
    async (chave: string, caminho: string, corpo: unknown) => {
      setOcupado(chave);
      setErroDe((x) => ({ ...x, [chave]: '' }));
      try {
        const novo = await apiPost<EstadoDaSalaComAcompanhamento>(`${base}/${caminho}`, corpo);
        setEstado(novo);
        return true;
      } catch (e) {
        setErroDe((x) => ({ ...x, [chave]: (e as Error).message }));
        return false;
      } finally {
        setOcupado(null);
      }
    },
    [base],
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
        <p className="text-[13px] text-muted" aria-busy>abrindo a sua sala…</p>
      </Casca>
    );
  }

  const i = estado.estagios.findIndex((e) => e.chave === estado.estagio);
  const chegou = (chave: EstadoDaSala['estagio']) => estado.estagios.findIndex((e) => e.chave === chave) <= i;
  const aceiteAntes = chegou('contrato') && estado.proposta;
  const aceiteDepois = !chegou('contrato') && estado.estagio === 'proposta' && estado.proposta && querAceitar;

  const blocos = (
    <div className="mt-5 space-y-4">
      {/* L6: o acompanhamento vem primeiro; com versão publicada o contato é o botão fixo da SalaPublicada. */}
      <Acompanhamento estado={estado} token={token} semContato={Boolean(estado.publicada)} />
      {estado.estagio === 'comeco' && <Comeco estado={estado} agir={agir} ocupado={ocupado} erro={erroDe.kickoff} />}
      {aceiteAntes && <Aceite estado={estado} agir={agir} ocupado={ocupado} erroDe={erroDe} />}
      {chegou('proposta') && estado.proposta && <Proposta estado={estado} base={base} token={token} agir={agir} ocupado={ocupado} erroDe={erroDe} aoAceitar={() => setQuerAceitar(true)} />}
      {aceiteDepois && <Aceite estado={estado} agir={agir} ocupado={ocupado} erroDe={erroDe} />}
      {estado.diagnostico && <Diagnostico estado={estado} />}
      <Conversa estado={estado} agir={agir} ocupado={ocupado} erroDe={erroDe} base={base} aoEnviarArquivo={setEstado} />
      {!estado.publicada && <Plano estado={estado} />}
    </div>
  );

  // Leva A (30/10/2026): depois do fechamento (ou do card da implantação) o mesmo link é a ÁREA DO CLIENTE:
  // os quatro blocos com os quinze itens. O que ainda pede ação do cliente (kickoff, aceite de um lead
  // iniciado antes do fechamento) continua embaixo, vindo dos mesmos blocos de sempre.
  if (estado.modo === 'area' && estado.area) {
    return (
      <AreaDoCliente area={estado.area} estado={estado} token={token} base={base} marca={<Marca rotulo="área do cliente" />} whatsapp={estado.acompanhamento?.contato.whatsapp ?? null} aoAtualizar={setEstado}>
        <div className="space-y-4" data-testid="area-acoes">
          {estado.estagio === 'comeco' && <Comeco estado={estado} agir={agir} ocupado={ocupado} erro={erroDe.kickoff} />}
          {estado.estagio === 'proposta' && estado.proposta && <Proposta estado={estado} base={base} token={token} agir={agir} ocupado={ocupado} erroDe={erroDe} aoAceitar={() => setQuerAceitar(true)} />}
          {(aceiteAntes || aceiteDepois) && !estado.aceite?.contrato?.assinadoClienteEm && <Aceite estado={estado} agir={agir} ocupado={ocupado} erroDe={erroDe} />}
        </div>
      </AreaDoCliente>
    );
  }

  // I3: com versão publicada, o cliente lê a sala da versão (onde estamos, passos, publicados, o combinado);
  // o que é ação dele continua logo abaixo. Sem versão, a sala de antes.
  if (estado.publicada) {
    return (
      <SalaPublicada publicada={estado.publicada} estado={estado} token={token} marca={<Marca />} whatsapp={estado.acompanhamento?.contato.whatsapp ?? null}>
        {blocos}
      </SalaPublicada>
    );
  }

  return (
    <Casca>
      <Marca />
      <header className="mb-4">
        <p className={ROTULO}>sala da</p>
        <h1 className="text-[22px] font-bold leading-tight">{estado.empresa}</h1>
        {estado.contato && estado.contato !== estado.empresa && <p className="text-[13px] text-muted">com {estado.contato}</p>}
      </header>

      <Estagios estado={estado} />

      {blocos}

      <p className="mt-6 text-center text-[11px] text-muted">
        Este endereço é só seu e vale até {dataCurta(estado.validoAte)}. Senha, token e dado bancário nunca entram por aqui.
      </p>
    </Casca>
  );
}

type Agir = (chave: string, caminho: string, corpo: unknown) => Promise<boolean>;

// ---------------------------------------------------------------------------

function Estagios({ estado }: { estado: EstadoDaSala }) {
  return (
    <ol className="grid grid-cols-[repeat(5,minmax(0,1fr))] gap-1.5" aria-label="estágios">
      {estado.estagios.map((e) => (
        <li key={e.chave} className="min-w-0" aria-current={e.estado === 'atual' ? 'step' : undefined}>
          <div className={`h-[3px] rounded-full ${e.estado === 'atual' ? 'bg-brand' : e.estado === 'passou' ? 'bg-brand/40' : 'bg-surface-3'}`} />
          <div title={e.rotulo} className={`mt-1 truncate text-[11px] ${e.estado === 'vem' ? 'text-dim' : 'font-semibold'}`}>{e.rotulo}</div>
        </li>
      ))}
    </ol>
  );
}

function Plano({ estado }: { estado: EstadoDaSala }) {
  return (
    <section className={CARTAO}>
      <h2 className={ROTULO}>nosso plano juntos</h2>
      <ul className="mt-2 space-y-1.5">
        {estado.planoDeAcao.map((p) => (
          <li key={p.texto} className="flex items-start gap-2 text-[13.5px]">
            <span aria-hidden className={`mt-0.5 font-os-mono text-[11px] ${p.feito ? 'text-brand' : 'text-dim'}`}>{p.feito ? '✓' : '○'}</span>
            <span className={p.feito ? '' : 'text-muted'}>{p.texto}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Conversa (telas 01 e 02)
// ---------------------------------------------------------------------------

function Conversa({
  estado,
  agir,
  ocupado,
  erroDe,
  base,
  aoEnviarArquivo,
}: {
  estado: EstadoDaSala;
  agir: Agir;
  ocupado: string | null;
  erroDe: Record<string, string>;
  base: string;
  aoEnviarArquivo: (e: EstadoDaSala) => void;
}) {
  const c = estado.conversa;
  const respondeu = c.oQueContou.length > 0;
  const atual = estado.estagio === 'conversa';
  return (
    <section className={`${CARTAO} ${atual ? 'border-brand/50' : ''}`}>
      <h2 className={ROTULO}>sua conversa</h2>
      {c.horario ? (
        <div className="mt-1">
          <p className="text-[18px] font-semibold">{rotuloDoHorario(c.horario)}</p>
          <p className="text-[13px] text-muted">{c.duracaoMin} minutos com um dos sócios. O link da chamada abre aqui 10 minutos antes. A conversa é gravada para virar o seu diagnóstico.</p>
        </div>
      ) : respondeu && c.horariosOferecidos.length ? (
        <div className="mt-2">
          <p className="text-[13.5px]">Escolha um horário com um dos sócios ({c.duracaoMin} minutos):</p>
          <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
            {c.horariosOferecidos.map((h) => (
              <button key={h} type="button" disabled={ocupado === 'agenda'} onClick={() => agir('agenda', 'agenda', { horario: h })} className={BOTAO}>
                {rotuloDoHorario(h)}
              </button>
            ))}
          </div>
          {erroDe.agenda && <p role="alert" className="mt-2 text-[12.5px] text-bad">{erroDe.agenda}</p>}
        </div>
      ) : !respondeu ? (
        <Formulario agir={agir} ocupado={ocupado} erro={erroDe.form} />
      ) : (
        <p className="mt-1 text-[13.5px] text-muted">Os horários aparecem aqui em instantes.</p>
      )}

      {respondeu && (
        <div className="mt-4">
          <h3 className={ROTULO}>o que você já contou</h3>
          <p className="mt-1 text-[13.5px]">{c.oQueContou.join(' · ')}</p>
        </div>
      )}

      {atual && respondeu && <Arquivo base={base} aoEnviar={aoEnviarArquivo} />}
    </section>
  );
}

function Formulario({ agir, ocupado, erro }: { agir: Agir; ocupado: string | null; erro?: string }) {
  const [sistema, setSistema] = useState('');
  const [base, setBase] = useState<'' | 'sim' | 'nao'>('');
  const [dor, setDor] = useState('');
  const [equipe, setEquipe] = useState('');
  const pronto = sistema.trim() && base && dor.trim() && equipe.trim() !== '' && Number.isInteger(Number(equipe));
  return (
    <form
      className="mt-2 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pronto) return;
        void agir('form', 'form', { sistema: sistema.trim(), baseOrganizada: base === 'sim', maiorDor: dor.trim(), equipeFinanceiro: Number(equipe) });
      }}
    >
      <p className="text-[13.5px]">Quatro perguntas para a conversa começar pelos seus números.</p>
      <label className="block text-[13px]">
        Qual sistema vocês usam?
        <input className={`${INPUT} mt-1`} value={sistema} onChange={(e) => setSistema(e.target.value)} maxLength={120} placeholder="Omie, Conta Azul, Bling, planilha…" />
      </label>
      <fieldset className="text-[13px]">
        <legend>A base de dados está organizada?</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {(['sim', 'nao'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={base === v} onClick={() => setBase(v)} className={`${BOTAO} min-w-[6rem] flex-1 py-2 ${base === v ? 'border-brand bg-brand/10' : ''}`}>
              {v === 'sim' ? 'sim' : 'ainda não'}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block text-[13px]">
        Qual é a maior dor hoje?
        <textarea className={`${INPUT} mt-1`} rows={2} value={dor} onChange={(e) => setDor(e.target.value)} maxLength={400} />
      </label>
      <label className="block text-[13px]">
        Quantas pessoas no financeiro?
        <input className={`${INPUT} mt-1`} inputMode="numeric" value={equipe} onChange={(e) => setEquipe(soDigitos(e.target.value))} maxLength={5} />
      </label>
      <button type="submit" disabled={!pronto || ocupado === 'form'} className={`${BOTAO_PRIMARIO} w-full`}>
        {ocupado === 'form' ? 'enviando…' : 'Enviar respostas'}
      </button>
      {erro && <p role="alert" className="text-[12.5px] text-bad">{erro}</p>}
    </form>
  );
}

function Arquivo({ base, aoEnviar }: { base: string; aoEnviar: (e: EstadoDaSala) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <div className="mt-4 rounded-lg border border-dashed border-border p-3">
      <p className={ROTULO}>opcional · deixe pronto</p>
      <p className="mt-1 text-[13px]">Um relatório de fechamento do mês passado ajuda a conversa a ir direto ao ponto.</p>
      <label className={`${BOTAO} mt-2 inline-block cursor-pointer py-2 text-[13px]`}>
        {enviando ? 'enviando…' : 'enviar arquivo'}
        <input
          type="file"
          className="sr-only"
          accept=".pdf,.csv,.txt,.xls,.xlsx,.png,.jpg,.jpeg"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setEnviando(true);
            setMsg(null);
            try {
              aoEnviar(await apiUpload<EstadoDaSala>(`${base}/arquivo`, f));
              setMsg(`${f.name} recebido.`);
            } catch (err) {
              setMsg((err as Error).message);
            } finally {
              setEnviando(false);
            }
          }}
        />
      </label>
      {msg && <p className="mt-1 text-[12.5px] text-muted" role="status">{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

function Diagnostico({ estado }: { estado: EstadoDaSala }) {
  const d = estado.diagnostico!;
  return (
    <section className={`${CARTAO} ${estado.estagio === 'diagnostico' ? 'border-brand/50' : ''}`}>
      <h2 className={ROTULO}>o seu diagnóstico</h2>
      <ol className="mt-2 space-y-2">
        {d.dores.map((dor) => (
          <li key={dor.n} className="text-[13.5px]">
            <span className="font-os-mono text-[11px] text-brand">{String(dor.n).padStart(2, '0')}</span> {dor.texto}
            {dor.minuto && <span className="ml-1 font-os-mono text-[10.5px] text-muted">minuto {dor.minuto}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Proposta (tela 07)
// ---------------------------------------------------------------------------

function useLeitura(base: string, versao: number) {
  const enviados = useRef(new Set<string>());
  return useCallback(
    (bloco: SalaBlocoDaProposta) => (el: HTMLElement | null) => {
      if (!el || typeof IntersectionObserver === 'undefined') return;
      let t: ReturnType<typeof setTimeout> | null = null;
      const obs = new IntersectionObserver(
        ([e]) => {
          if (e.isIntersecting && !enviados.current.has(bloco)) {
            t = setTimeout(() => {
              enviados.current.add(bloco);
              void apiPost(`${base}/proposta/lida`, { bloco, versao }).catch(() => undefined);
              obs.disconnect();
            }, 1000);
          } else if (t) {
            clearTimeout(t);
          }
        },
        { threshold: 0.5 },
      );
      obs.observe(el);
    },
    [base, versao],
  );
}

function Proposta({ estado, base, token, agir, ocupado, erroDe, aoAceitar }: { estado: EstadoDaSala; base: string; token: string; agir: Agir; ocupado: string | null; erroDe: Record<string, string>; aoAceitar: () => void }) {
  const p = estado.proposta!;
  const ler = useLeitura(base, p.versao);
  const [aberto, setAberto] = useState<'duvida' | 'ajuste' | null>(null);
  const [texto, setTexto] = useState('');
  const [desconto, setDesconto] = useState('');
  const aceitando = estado.estagio !== 'proposta';
  return (
    <section className={`space-y-3 ${estado.estagio === 'proposta' ? '' : 'opacity-90'}`}>
      {/* I4: a proposta inteira, por seção, com a barra de reação (`/s/<token>/proposta`). */}
      <a href={`/s/${encodeURIComponent(token)}/proposta`} data-testid="abrir-proposta-completa" className={`${CARTAO} flex min-h-[44px] items-center justify-between gap-3 border-brand/50 text-[14px] font-semibold transition hover:border-brand ${FOCO}`}>
        <span>abrir a proposta completa</span>
        <span aria-hidden className="font-os-mono text-[12px] text-brand">→</span>
      </a>
      <div ref={ler('ouvimos')} className={CARTAO}>
        <h2 className={ROTULO}>o que ouvimos de você</h2>
        <p className="mt-1 text-[13.5px]">{p.ouvimos.join(' · ')}</p>
      </div>
      <div ref={ler('recomendada')}>
        <Oferta oferta={p.recomendada} rotulo="recomendada" destaque aceitar={aceitando ? undefined : aoAceitar} versao={p.versao} />
      </div>
      {p.alternativa && (
        <div ref={ler('alternativa')}>
          <Oferta oferta={p.alternativa} rotulo="outra opção" versao={p.versao} />
        </div>
      )}
      {p.custosDeTerceiros && (
        <div ref={ler('custos')} className={CARTAO}>
          <h2 className={ROTULO}>custos de terceiros, no seu nome</h2>
          <p className="mt-1 text-[13.5px]">
            mês normal {reais(p.custosDeTerceiros.mesNormalCentavos)} · pior mês {reais(p.custosDeTerceiros.piorMesCentavos)}
          </p>
          {p.custosDeTerceiros.exemplo && <p className="mt-1 text-[12px] text-muted">valores de exemplo, ainda não são os da sua empresa</p>}
        </div>
      )}
      <div ref={ler('validade')} className={`${CARTAO} flex flex-wrap items-center justify-between gap-2`}>
        <div>
          <p className={ROTULO}>vale até</p>
          <p className="text-[16px] font-semibold">{p.validaAte ? dataCurta(p.validaAte) : '[a decidir]'}</p>
          <p className="font-os-mono text-[10px] text-muted">versão {p.versao}</p>
        </div>
        {!aceitando && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${BOTAO} py-2 text-[13px]`} aria-expanded={aberto === 'duvida'} onClick={() => setAberto(aberto === 'duvida' ? null : 'duvida')}>tirar uma dúvida</button>
            <button type="button" className={`${BOTAO} py-2 text-[13px]`} aria-expanded={aberto === 'ajuste'} onClick={() => setAberto(aberto === 'ajuste' ? null : 'ajuste')}>pedir ajuste</button>
          </div>
        )}
      </div>

      {aberto && (
        <form
          className={`${CARTAO} space-y-2`}
          onSubmit={async (e) => {
            e.preventDefault();
            const ok =
              aberto === 'duvida'
                ? await agir('duvida', 'proposta/duvida', { pergunta: texto.trim() })
                : await agir('ajuste', 'proposta/ajuste', { pedido: texto.trim(), ...(desconto ? { descontoPct: Number(desconto) } : {}) });
            if (ok) {
              setTexto('');
              setDesconto('');
              setAberto(null);
            }
          }}
        >
          <label className="block text-[13px]">
            {aberto === 'duvida' ? 'Qual é a sua dúvida?' : 'O que você gostaria de ajustar?'}
            <textarea className={`${INPUT} mt-1`} rows={3} maxLength={600} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </label>
          {aberto === 'ajuste' && (
            <label className="block text-[13px]">
              Se for desconto, quanto (%)? <span className="text-muted">opcional</span>
              <input className={`${INPUT} mt-1 w-28`} inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
          )}
          <button type="submit" disabled={!texto.trim() || ocupado === aberto} className={BOTAO_PRIMARIO}>
            {ocupado === aberto ? 'enviando…' : 'Enviar'}
          </button>
          {erroDe[aberto] && <p role="alert" className="text-[12.5px] text-bad">{erroDe[aberto]}</p>}
        </form>
      )}

      {p.ajustePendente && (
        <p className="rounded-lg border border-brand/40 bg-brand/10 p-3 text-[13px]" role="status">
          Recebemos o seu pedido de ajuste. Um dos sócios responde aqui na sala, e você é avisado pelo WhatsApp.
        </p>
      )}
      {(p.duvidas ?? []).length > 0 && (
        <div className={CARTAO}>
          <h2 className={ROTULO}>suas dúvidas</h2>
          <ul className="mt-2 space-y-2">
            {(p.duvidas ?? []).map((d) => (
              <li key={d.em} className="text-[13.5px]">
                <p className="font-semibold">{d.pergunta}</p>
                <p className="text-muted">{d.resposta ?? 'Recebemos. Respondemos aqui, nesta sala.'}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Oferta({ oferta, rotulo, destaque = false, aceitar }: { oferta: OfertaNaSala; rotulo: string; destaque?: boolean; aceitar?: () => void; versao: number }) {
  return (
    <div className={`${CARTAO} ${destaque ? 'border-brand/60' : ''}`}>
      <p className={`${ROTULO} ${destaque ? 'text-brand' : ''}`}>{rotulo}</p>
      <p className="mt-1 text-[17px] font-bold">{oferta.rotulo}</p>
      <p className="text-[14px]">
        {reais(oferta.valorCentavos)} · {oferta.parcelas}× de {reais(oferta.parcelaCentavos)}
        {oferta.formas.length ? ` · ${oferta.formas.map((f) => ROTULO_DA_FORMA[f] ?? f).join(', ')}` : ''}
        {oferta.descontoPct ? ` · ${oferta.descontoPct}% de desconto` : ''}
      </p>
      {oferta.descricao && <p className="mt-1 text-[13px] text-muted">{oferta.descricao}</p>}
      {aceitar && (
        <button type="button" onClick={aceitar} className={`${BOTAO_PRIMARIO} mt-3 py-2 text-[13px]`}>
          aceitar esta
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aceite (tela 08): dados, pagamento, contrato
// ---------------------------------------------------------------------------

function Aceite({ estado, agir, ocupado, erroDe }: { estado: EstadoDaSala; agir: Agir; ocupado: string | null; erroDe: Record<string, string> }) {
  const p = estado.proposta!;
  const a = estado.aceite;
  const ofertas = useMemo(() => [p.recomendada, ...(p.alternativa ? [p.alternativa] : [])], [p]);
  const aceita = Boolean(a?.forma);
  const [produto, setProduto] = useState(a?.produto ?? p.recomendada.produto);
  const oferta = ofertas.find((o) => o.produto === produto) ?? p.recomendada;
  const [forma, setForma] = useState<string>(a?.forma ?? oferta.formas[0] ?? '');
  const [dados, setDados] = useState({ cnpj: a?.dados?.cnpj ?? '', razaoSocial: a?.dados?.razaoSocial ?? '', endereco: a?.dados?.endereco ?? '', quemAssina: a?.dados?.quemAssina ?? '', email: a?.dados?.email ?? '' });
  const [editarDados, setEditarDados] = useState(!a?.dados);
  const dadosOk = soDigitos(dados.cnpj).length >= 11 && dados.razaoSocial.trim() && dados.endereco.trim() && dados.quemAssina.trim() && /@/.test(dados.email);

  return (
    <section id="aceite" className={`${CARTAO} space-y-4 border-brand/50`}>
      <h2 className={ROTULO}>aceite</h2>

      <div>
        <p className="text-[13.5px] font-semibold">1 · seus dados</p>
        {!editarDados && a?.dados ? (
          <div className="mt-1 text-[13px]">
            <p>{a.dados.razaoSocial} · {a.dados.cnpj}</p>
            <p className="text-muted">{a.dados.endereco}</p>
            <p>Quem assina: {a.dados.quemAssina} · {a.dados.email}</p>
            {!aceita && <button type="button" className="mt-1 text-[12.5px] underline underline-offset-2" onClick={() => setEditarDados(true)}>corrigir</button>}
          </div>
        ) : (
          <form
            className="mt-2 grid gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!dadosOk) return;
              const ok = await agir('dados', 'aceite/dados', { ...dados, cnpj: soDigitos(dados.cnpj), email: dados.email.trim() });
              if (ok) setEditarDados(false);
            }}
          >
            {(
              [
                ['cnpj', 'CNPJ (ou CPF)', 'numeric'],
                ['razaoSocial', 'Razão social', 'text'],
                ['endereco', 'Endereço', 'text'],
                ['quemAssina', 'Quem assina pela empresa', 'text'],
                ['email', 'E-mail de quem assina', 'email'],
              ] as const
            ).map(([k, rotulo, modo]) => (
              <label key={k} className="block text-[13px]">
                {rotulo}
                <input className={`${INPUT} mt-1`} inputMode={modo === 'numeric' ? 'numeric' : undefined} type={modo === 'email' ? 'email' : 'text'} value={dados[k]} onChange={(e) => setDados((d) => ({ ...d, [k]: e.target.value }))} />
              </label>
            ))}
            <button type="submit" disabled={!dadosOk || ocupado === 'dados'} className={BOTAO_PRIMARIO}>{ocupado === 'dados' ? 'conferindo…' : 'Conferi os dados'}</button>
            {erroDe.dados && <p role="alert" className="text-[12.5px] text-bad">{erroDe.dados}</p>}
          </form>
        )}
      </div>

      <div className={a?.dados ? '' : 'opacity-50'}>
        <p className="text-[13.5px] font-semibold">2 · pagamento</p>
        {aceita ? (
          <div className="mt-1 text-[13px]">
            <p>
              {ofertas.find((o) => o.produto === a!.produto)?.rotulo ?? a!.produto} · {reais(a!.valorCentavos)} em {a!.parcelas}× · {ROTULO_DA_FORMA[a!.forma!] ?? a!.forma}
            </p>
            {a!.cobranca ? (
              <div className="mt-2 space-y-1">
                <p>1ª parcela: {reais(a!.cobranca.primeiraParcelaCentavos)} · {a!.cobranca.estado}</p>
                {a!.cobranca.pixCopiaECola && (
                  <label className="block text-[12.5px]">
                    Pix copia e cola
                    <input readOnly className={`${INPUT} mt-1 font-os-mono text-[11px]`} value={a!.cobranca.pixCopiaECola} onFocus={(e) => e.target.select()} />
                  </label>
                )}
                {a!.cobranca.linkPagamento && <a href={a!.cobranca.linkPagamento} target="_blank" rel="noreferrer" className="text-[13px] text-brand underline underline-offset-2">abrir a cobrança</a>}
              </div>
            ) : (
              <p className="mt-1 text-muted">A cobrança está sendo gerada. Ela aparece aqui em instantes.</p>
            )}
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {ofertas.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {ofertas.map((o) => (
                  <button key={o.produto} type="button" aria-pressed={produto === o.produto} onClick={() => { setProduto(o.produto); setForma(o.formas[0] ?? ''); }} className={`${BOTAO} min-w-[7rem] flex-1 py-2 text-[13px] ${produto === o.produto ? 'border-brand bg-brand/10' : ''}`}>
                    {o.rotulo}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {oferta.formas.map((f) => (
                <button key={f} type="button" aria-pressed={forma === f} onClick={() => setForma(f)} className={`${BOTAO} min-w-[7rem] flex-1 py-2 text-[13px] ${forma === f ? 'border-brand bg-brand/10' : ''}`}>
                  {ROTULO_DA_FORMA[f] ?? f}
                </button>
              ))}
            </div>
            <p className="text-[13px] text-muted">{oferta.parcelas}× de {reais(oferta.parcelaCentavos)} · a 1ª agora, as outras com aviso no WhatsApp.</p>
            <button type="button" disabled={!a?.dados || !forma || ocupado === 'pagamento'} onClick={() => agir('pagamento', 'aceite/pagamento', { produto, forma, versao: p.versao })} className={`${BOTAO_PRIMARIO} w-full`}>
              {ocupado === 'pagamento' ? 'aceitando…' : `Aceitar ${oferta.rotulo}`}
            </button>
            {erroDe.pagamento && <p role="alert" className="text-[12.5px] text-bad">{erroDe.pagamento}</p>}
          </div>
        )}
      </div>

      <div className={aceita ? '' : 'opacity-50'}>
        <p className="text-[13.5px] font-semibold">3 · contrato</p>
        {a?.contrato ? (
          <div className="mt-1 text-[13px]">
            <p>Gerado com os seus dados. Assina pelo celular, sem imprimir.</p>
            {a.contrato.assinadoClienteEm ? <p className="text-brand">você assinou {dataCurta(a.contrato.assinadoClienteEm)}</p> : a.contrato.linkAssinatura && <a href={a.contrato.linkAssinatura} target="_blank" rel="noreferrer" className={`${BOTAO_PRIMARIO} mt-2 inline-block py-2`}>assinar o contrato</a>}
            <p className="text-muted">{a.contrato.assinadoRootEm ? `A Root assinou ${dataCurta(a.contrato.assinadoRootEm)}.` : 'A Root assina em seguida.'}</p>
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-muted">{aceita ? 'O contrato está sendo gerado com os dados ao lado. O link de assinatura aparece aqui.' : 'Gerado com os seus dados depois do aceite.'}</p>
        )}
      </div>

      {estado.estagio === 'contrato' && <p className="text-[12.5px] text-muted">Quando o pagamento cair e o contrato estiver assinado, o começo abre aqui: você recebe o convite do grupo no WhatsApp e escolhe o horário do kickoff nesta mesma página.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Começo
// ---------------------------------------------------------------------------

function Comeco({ estado, agir, ocupado, erro }: { estado: EstadoDaSala; agir: Agir; ocupado: string | null; erro?: string }) {
  const c = estado.comeco;
  const [quando, setQuando] = useState('');
  return (
    <section className={`${CARTAO} border-brand/50`}>
      <h2 className={ROTULO}>começo</h2>
      <p className="mt-1 text-[13.5px]">{c?.grupoCriado ? 'O grupo da sua empresa com a Root está criado no WhatsApp.' : 'O convite do grupo no WhatsApp chega em instantes.'}</p>
      {c?.kickoffEm ? (
        <p className="mt-2 text-[15px] font-semibold">Kickoff: {rotuloDoHorario(c.kickoffEm)}</p>
      ) : (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const iso = localSPParaIso(quando);
            if (iso) void agir('kickoff', 'kickoff/horario', { horario: iso });
          }}
        >
          <label className="block text-[13px]">
            Escolha o horário do kickoff (horário de Brasília)
            <input type="datetime-local" className={`${INPUT} mt-1`} value={quando} onChange={(e) => setQuando(e.target.value)} />
          </label>
          <button type="submit" disabled={!localSPParaIso(quando) || ocupado === 'kickoff'} className={BOTAO_PRIMARIO}>{ocupado === 'kickoff' ? 'marcando…' : 'Marcar o kickoff'}</button>
          {erro && <p role="alert" className="text-[12.5px] text-bad">{erro}</p>}
        </form>
      )}
      {c?.linkDoTrilho && (
        <a href={c.linkDoTrilho} className={`${BOTAO_PRIMARIO} mt-3 inline-block py-2`}>abrir o seu onboarding</a>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/*
 * Lane P6: a coluna acompanha a tela (448 px no celular, até 672 px no
 * desktop) e quebra palavra comprida em qualquer ponto: nome de empresa,
 * e-mail, link e Pix copia e cola ficam dentro do cartão.
 */
function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div data-os-app className="min-h-screen bg-bg p-4 text-text [overflow-wrap:anywhere]">
      <div className="mx-auto w-full min-w-0 max-w-md py-6 md:max-w-xl lg:max-w-2xl">{children}</div>
    </div>
  );
}

function Marca({ rotulo = 'sala do cliente' }: { rotulo?: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span aria-hidden className="grid h-10 w-10 place-items-center rounded-root border border-brand/30 bg-brand/10 text-[20px] font-extrabold italic leading-none tracking-[-0.05em] text-brand" style={{ transform: 'skewX(-10deg)', textShadow: 'var(--os-logo-shadow, none)' }}>
        R
      </span>
      <div className="font-os-mono">
        <div className="text-[13px] font-bold">Operação ROOT</div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{rotulo}</div>
      </div>
    </div>
  );
}
