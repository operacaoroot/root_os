'use client';

/*
 * A ABA GERAL DO PAINEL DO LEAD (leva 5, L4, 27/10/2026): a primeira tela.
 *
 * Três cartões, no modelo da ficha Sessão Estratégica do escritório (só a
 * estrutura): QUEM (empresa, contato, tipo de pessoa, WhatsApp, e-mail,
 * preferências), ORIGEM (como conheceu, origem da indicação, vendedor, sócio
 * responsável) e NEGÓCIO (produto, tipo do negócio, valor negociado, parcelas,
 * 1ª parcela, link da proposta, etapa). Cada campo tem o rótulo pequeno em cima
 * e o valor grande embaixo; vazio aparece em cinza com "preencher" e vira
 * editável no clique (Enter salva, Esc desfaz, o salvar é otimista e volta se a
 * API negar). Nada de texto corrido.
 *
 * Cada campo grava pelo caminho que já existia: nome, empresa, tipo do negócio,
 * valor, vendedor e canal viram FATO do fio (pela rota `PATCH .../ficha`, que
 * despacha para `ficha.service.ts`); o WhatsApp vai por
 * `PUT /whatsapp/vinculos/lead/:id/telefone`; a etapa, por `POST .../mover`
 * (o mesmo mover do funil, com a confirmação de E8/E9 e o motivo da saída).
 *
 * Duas variantes para o Rodrigo comparar (`variante.ts`): A) os três cartões
 * lado a lado com a etapa como faixa no topo; B) os cartões numa coluna e, à
 * direita, a linha do tempo resumida (5 últimos fatos) com "ver tudo".
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  COMERCIAL_PRODUTOS,
  COMERCIAL_ROTULO_DA_ETAPA,
  COMERCIAL_TIPOS_DE_NEGOCIO,
  COMO_CONHECEU,
  ROTULO_DO_BLOCO,
  ROTULO_DO_COMO_CONHECEU,
  ROTULO_DO_TIPO_DE_NEGOCIO,
  ROTULO_DO_TIPO_DE_PESSOA,
  TIPOS_DE_PESSOA,
  canalPedeOrigemDaIndicacao,
  ehSaida,
  formatarWhatsappBr,
  lerWhatsappBr,
  rotuloDoCanal,
  type CartaoDoFunil,
  type ComercialDestinoDoMover,
  type ComercialMoverInput,
  type FichaDoLead,
  type FichaGeralExtra,
  type LinhaDoFio,
  type LinkDaSalaCopiado,
  type ListaDaCaixa,
  type VarianteDoPainel,
} from '@mktos/shared';

import { apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAvatares } from '@/lib/avatares';
import { ROTULO_DA_FONTE, ROTULO_DO_PRODUTO, quandoCurtoSP, reaisOuAusente } from '@/lib/cockpit';
import { soDaEquipe, useIdsDaEquipe } from '@/components/trabalho/ResponsavelDaTarefa';

import { BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Chip, ErroDaAcao, FOCO, INPUT, Rotulo } from '../_ui';
import { avisoDaConfirmacao, fraseDoErro, moverCartao, opcoesDoMenu, precisaDeConfirmacao } from '../_funil/mover';
import { linkDoWhatsApp } from './estado';
import { usePainel } from './provedor';

const ROTULO_DO_CAMPO = 'font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-muted';
const VALOR = 'min-h-[28px] break-words text-[15px] font-medium leading-snug text-text md:text-[16px]';
const PREENCHER = `rounded-sm text-left text-[14px] text-dim underline decoration-dotted underline-offset-4 hover:text-brand max-md:min-h-[44px] ${FOCO}`;

/** O número da tela: "1.234,56" ou "1234.56" vira 1234.56; vazio vira nulo; torto vira NaN. */
export function lerReais(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (limpo === '') return null;
  return Number(limpo);
}

/** Centavos como a pessoa digita de volta (sem o "R$"). */
function reaisParaEditar(centavos: number | null): string {
  return centavos == null ? '' : (centavos / 100).toFixed(2).replace('.', ',');
}

type Editor =
  | { tipo: 'texto'; placeholder?: string; maxLength?: number; inputMode?: 'text' | 'email' | 'url' | 'tel' | 'decimal' | 'numeric' }
  | { tipo: 'opcoes'; opcoes: { valor: string; rotulo: string }[]; vazio?: string };

/**
 * UM CAMPO DA FICHA: rótulo em cima, valor embaixo; vazio = "preencher". O
 * clique abre o editor no lugar; Enter (ou sair do campo) salva, Esc desfaz. O
 * valor novo aparece na hora e volta se a API negar (o erro fica ao lado).
 */
function Campo({
  chave,
  rotulo,
  valor,
  valorParaEditar,
  editor,
  podeEditar,
  focar,
  apoio,
  formatar,
  aoSalvar,
  acoes,
}: {
  chave: string;
  rotulo: string;
  /** O valor pronto para mostrar; nulo = vazio. */
  valor: string | null;
  /** O que o editor começa mostrando (padrão: o valor). */
  valorParaEditar?: string;
  editor: Editor;
  podeEditar: boolean;
  /** Abre o editor ao montar (o "um clique leva ao campo" das pendências, o "vincular WhatsApp" do menu). */
  focar?: boolean;
  /** Uma linha de apoio embaixo do valor (um link, uma dica). */
  apoio?: React.ReactNode;
  /** Como o valor recém-digitado aparece enquanto a API não responde (padrão: o texto digitado). */
  formatar?: (cru: string) => string | null;
  /** Grava. Lança em erro: o campo volta ao que era. `null` = a pessoa apagou. */
  aoSalvar: (novo: string | null) => Promise<void>;
  /** Botões ao lado do valor (ex.: "vincular a contato"). */
  acoes?: React.ReactNode;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  // O valor mostrado enquanto a API não responde (otimista); `undefined` = o da ficha.
  const [pendente, setPendente] = useState<string | null | undefined>(undefined);
  const [erro, setErro] = useState<unknown>(null);
  const salvando = useRef(false);

  // A ficha chegou com o valor novo: o otimista cumpriu o papel.
  useEffect(() => setPendente(undefined), [valor]);

  useEffect(() => {
    if (!focar || !podeEditar) return;
    setEditando(true);
    // O jsdom da suíte não rola: a chamada é opcional.
    raiz.current?.scrollIntoView?.({ block: 'center' });
  }, [focar, podeEditar]);

  useEffect(() => {
    if (editando) campo.current?.focus();
  }, [editando]);

  function abrir() {
    if (!podeEditar) return;
    setTexto(valorParaEditar ?? valor ?? '');
    setErro(null);
    setEditando(true);
  }

  async function salvar(cru: string) {
    if (salvando.current) return;
    const novo = cru.trim() === '' ? null : cru;
    const antes = valorParaEditar ?? valor ?? '';
    setEditando(false);
    if ((novo ?? '') === antes) return;
    salvando.current = true;
    setErro(null);
    setPendente(novo == null ? null : formatar ? formatar(novo) : novo);
    try {
      await aoSalvar(novo);
    } catch (e) {
      setPendente(undefined);
      setErro(e);
    } finally {
      salvando.current = false;
    }
  }

  const mostrado = pendente === undefined ? valor : pendente;

  return (
    <div ref={raiz} className="min-w-0" data-testid={`ficha-campo-${chave}`}>
      <dt className={ROTULO_DO_CAMPO}>{rotulo}</dt>
      <dd className="mt-0.5 min-w-0">
        {editando ? (
          editor.tipo === 'opcoes' ? (
            <select
              ref={campo as React.RefObject<HTMLSelectElement>}
              data-testid={`ficha-editor-${chave}`}
              aria-label={rotulo}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                void salvar(e.target.value);
              }}
              onBlur={() => setEditando(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditando(false);
                }
              }}
              className={INPUT}
            >
              <option value="">{editor.vazio ?? 'sem informação'}</option>
              {editor.opcoes.map((o) => (
                <option key={o.valor} value={o.valor}>{o.rotulo}</option>
              ))}
            </select>
          ) : (
            <input
              ref={campo as React.RefObject<HTMLInputElement>}
              data-testid={`ficha-editor-${chave}`}
              aria-label={rotulo}
              value={texto}
              maxLength={editor.maxLength ?? 400}
              inputMode={editor.inputMode}
              placeholder={editor.placeholder}
              onChange={(e) => setTexto(e.target.value)}
              onBlur={() => void salvar(texto)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void salvar(texto);
                } else if (e.key === 'Escape') {
                  // O Esc é do campo: desfaz e não fecha o painel.
                  e.preventDefault();
                  e.stopPropagation();
                  setEditando(false);
                }
              }}
              className={INPUT}
            />
          )
        ) : mostrado != null ? (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {podeEditar ? (
              <button type="button" data-testid={`ficha-valor-${chave}`} onClick={abrir} title="clique para editar" className={`${VALOR} rounded-sm text-left hover:text-brand ${FOCO} ${pendente !== undefined ? 'opacity-70' : ''}`}>
                {mostrado}
              </button>
            ) : (
              <span data-testid={`ficha-valor-${chave}`} className={VALOR}>{mostrado}</span>
            )}
            {acoes}
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {podeEditar ? (
              <button type="button" data-testid={`ficha-valor-${chave}`} onClick={abrir} className={PREENCHER}>
                preencher
              </button>
            ) : (
              <span data-testid={`ficha-valor-${chave}`} className="text-[14px] text-dim">sem informação</span>
            )}
            {acoes}
          </div>
        )}
        {apoio && <div className="mt-0.5 text-[11.5px] text-dim">{apoio}</div>}
        <ErroDaAcao erro={erro} />
      </dd>
    </div>
  );
}

function Cartao({ titulo, children, testId }: { titulo: string; children: React.ReactNode; testId: string }) {
  return (
    <section className={`${CARTAO} min-w-0`} aria-label={titulo} data-testid={testId}>
      <Rotulo>{titulo}</Rotulo>
      <dl className="mt-3 grid gap-3.5">{children}</dl>
    </section>
  );
}

/**
 * O WHATSAPP DO LEAD: o telefone (editável pela rota do vínculo, que casa a
 * conversa 1:1 de novo) e "vincular a contato", que lista as conversas do
 * número da Root ainda sem lead nem cliente e liga a escolhida a este lead.
 */
function CampoDoWhatsapp({ leadId, telefone, podeEditar, focar, aoMudar }: { leadId: string; telefone: string | null; podeEditar: boolean; focar: boolean; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const [listando, setListando] = useState(false);
  const [conversas, setConversas] = useState<ListaDaCaixa['conversas'] | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const lido = telefone ? lerWhatsappBr(telefone) : null;
  const mostrado = telefone ? (lido?.ok ? lido.formatado : formatarWhatsappBr(telefone)) : null;
  const wa = linkDoWhatsApp(telefone);

  useEffect(() => {
    if (!listando) return;
    let vivo = true;
    setConversas(null);
    setErro(null);
    apiGet<ListaDaCaixa>('/whatsapp/conversas?filtro=sem_vinculo&limite=60', token)
      .then((r) => {
        if (vivo) setConversas((r?.conversas ?? []).filter((c) => !c.grupo));
      })
      .catch((e) => {
        if (vivo) setErro(e);
      });
    return () => {
      vivo = false;
    };
  }, [listando, token]);

  // O "vincular WhatsApp" do menu do lead já abre a lista.
  useEffect(() => {
    if (focar && podeEditar) setListando(true);
  }, [focar, podeEditar]);

  async function vincular(conversaId: string) {
    setOcupada(conversaId);
    setErro(null);
    try {
      await apiPost(`/whatsapp/vinculos/${encodeURIComponent(conversaId)}`, { tipo: 'lead', id: leadId }, token);
      setListando(false);
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setOcupada(null);
    }
  }

  return (
    <>
      <Campo
        chave="telefone"
        rotulo="WhatsApp"
        valor={mostrado}
        valorParaEditar={lido?.ok ? lido.formatado : telefone ?? ''}
        editor={{ tipo: 'texto', placeholder: '(32) 99999-0000', inputMode: 'tel', maxLength: 40 }}
        podeEditar={podeEditar}
        focar={focar}
        formatar={(cru) => {
          const l = lerWhatsappBr(cru);
          return l.ok ? l.formatado : cru;
        }}
        aoSalvar={async (novo) => {
          if (novo) {
            const l = lerWhatsappBr(novo);
            if (!l.ok) throw new Error(l.motivo);
          }
          await apiPut(`/whatsapp/vinculos/lead/${encodeURIComponent(leadId)}/telefone`, { telefone: novo }, token);
          await aoMudar();
        }}
        apoio={wa ? <a href={wa} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-brand">abrir no WhatsApp</a> : 'Com o número preenchido, a conversa 1:1 liga sozinha.'}
        acoes={
          podeEditar ? (
            <button type="button" data-testid="ficha-whatsapp-vincular" aria-expanded={listando} onClick={() => setListando((v) => !v)} className={`text-[11.5px] text-muted underline decoration-border underline-offset-2 hover:text-brand max-md:min-h-[44px] ${FOCO}`}>
              vincular a contato
            </button>
          ) : null
        }
      />
      {listando && (
        <div className="-mt-1 rounded border border-border bg-surface-2 p-2 text-[12.5px]" data-testid="ficha-whatsapp-conversas">
          <p className="mb-1 text-[11px] text-muted">Conversas do número da Root sem lead nem cliente. Clique para ligar a este lead.</p>
          <ErroDaAcao erro={erro} />
          {conversas == null && !erro && <Carregando linhas={2} altura="h-6" />}
          {conversas && conversas.length === 0 && <p className="text-dim">Nenhuma conversa sem vínculo agora.</p>}
          {conversas && conversas.length > 0 && (
            <ul className="max-h-48 divide-y divide-border overflow-y-auto">
              {conversas.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid={`ficha-whatsapp-conversa-${c.id}`}
                    disabled={!!ocupada}
                    onClick={() => void vincular(c.id)}
                    className={`flex w-full min-w-0 items-center justify-between gap-2 rounded px-1.5 py-1.5 text-left hover:bg-surface disabled:opacity-50 ${FOCO}`}
                  >
                    <span className="min-w-0 truncate">{c.nome}</span>
                    <span className="shrink-0 font-os-mono text-[11px] text-dim">{c.numero ? formatarWhatsappBr(c.numero) : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setListando(false)} className="mt-1 text-[11.5px] text-muted underline">fechar</button>
        </div>
      )}
    </>
  );
}

/**
 * A ETAPA ATUAL: só leitura, com o mover que o funil já tem (todas as etapas; a
 * saída pede o motivo; E8 e E9 pedem a confirmação com o aviso da regra).
 */
function EtapaAtual({ leadId, ficha: f, podeEditar, focar, aoMudar }: { leadId: string; ficha: FichaDoLead; podeEditar: boolean; focar: boolean; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const painel = usePainel();
  const [destino, setDestino] = useState<ComercialDestinoDoMover | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (focar) select.current?.focus();
  }, [focar]);
  const cartao: Pick<CartaoDoFunil, 'etapa' | 'voltaPara'> = { etapa: f.etapa, voltaPara: null };

  async function mover(d: ComercialDestinoDoMover, motivoDaSaida?: string) {
    setOcupado(true);
    setErro(null);
    try {
      const corpo: ComercialMoverInput = { para: d.para, ...(motivoDaSaida ? { motivo: motivoDaSaida } : {}) };
      const r = await moverCartao(leadId, corpo, token);
      painel.avisar(r.mensagem || `Movido para ${COMERCIAL_ROTULO_DA_ETAPA[r.para]}.`, r.pendencias?.length ? 'neutro' : 'bom');
      setDestino(null);
      setMotivo('');
      await aoMudar();
    } catch (e) {
      setErro(fraseDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  function escolher(para: string) {
    const d = opcoesDoMenu(cartao).find((o) => o.para === para);
    if (!d || !d.permitido) return;
    if (d.caminho === 'saida' || precisaDeConfirmacao(d)) {
      setDestino(d);
      return;
    }
    void mover(d);
  }

  return (
    <div className="min-w-0" data-testid="ficha-campo-etapa">
      <dt className={ROTULO_DO_CAMPO}>Etapa atual</dt>
      <dd className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
        <Chip tom={ehSaida(f.etapa) ? 'alerta' : f.etapa === 'fechado' ? 'bom' : 'brand'}>{COMERCIAL_ROTULO_DA_ETAPA[f.etapa]}</Chip>
        <span className="text-[11.5px] text-dim">desde {quandoCurtoSP(f.etapaDesde)}</span>
        {podeEditar && (
          <select
            ref={select}
            data-testid="ficha-mover"
            aria-label="mover para outra etapa"
            value=""
            disabled={ocupado}
            onChange={(e) => escolher(e.target.value)}
            className="rounded border border-border bg-bg px-1.5 py-0.5 text-[11.5px] text-text disabled:opacity-60"
          >
            <option value="">mover para…</option>
            {opcoesDoMenu(cartao).map((d) => (
              <option key={d.para} value={d.para}>{COMERCIAL_ROTULO_DA_ETAPA[d.para]}{d.caminho === 'saida' ? ' (pede motivo)' : ''}</option>
            ))}
          </select>
        )}
      </dd>
      {destino && (
        <form
          data-testid="ficha-mover-confirmar"
          onSubmit={(e) => {
            e.preventDefault();
            void mover(destino, destino.caminho === 'saida' && motivo.trim() ? motivo.trim() : undefined);
          }}
          className="mt-2 space-y-1.5 rounded border border-border bg-surface-2 p-2 text-[12px]"
        >
          <p>Mover para <strong>{COMERCIAL_ROTULO_DA_ETAPA[destino.para]}</strong>?</p>
          {destino.caminho === 'saida' ? (
            <label className="block">
              <span className="text-muted">motivo</span>
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={400} placeholder="escreva o motivo" className={INPUT} data-testid="ficha-mover-motivo" />
              <span className="mt-0.5 block text-[11px] text-dim">Sem motivo escrito, fica &quot;sem motivo informado&quot; e o cartão ganha o aviso.</span>
            </label>
          ) : (
            <p className="text-[11.5px] text-warn">{avisoDaConfirmacao(destino)}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button type="submit" disabled={ocupado} className={BOTAO_PRIMARIO}>{destino.caminho === 'saida' ? 'mover para a saída' : 'mover mesmo assim'}</button>
            <button type="button" onClick={() => setDestino(null)} className={BOTAO}>cancelar</button>
          </div>
        </form>
      )}
      {erro && <p role="alert" className="mt-1 text-[12px] text-bad">{erro}</p>}
    </div>
  );
}

/** O LINK DA PROPOSTA: o escrito à mão, o da proposta do serviço vinculada ou a versão da sala (com "copiar link"). */
function CampoDoLinkDaProposta({ leadId, extra, podeEditar, focar, aoSalvar }: { leadId: string; extra: FichaGeralExtra | null; podeEditar: boolean; focar: boolean; aoSalvar: (novo: string | null) => Promise<void> }) {
  const { token } = useAuth();
  const painel = usePainel();
  const [copiando, setCopiando] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const p = extra?.proposta ?? null;
  const valor = p?.link ?? (p?.origem === 'servico' ? `proposta do serviço: ${p.ref?.replace(/^servico:/, '') ?? ''}` : p?.origem === 'sala' && p.versao ? `proposta v${p.versao} na sala` : null);

  async function copiarDaSala() {
    setCopiando(true);
    try {
      const r = await apiPost<LinkDaSalaCopiado>(`/comercial/lead/${encodeURIComponent(leadId)}/sala/link`, {}, token);
      try {
        await navigator.clipboard.writeText(r.link);
        painel.avisar('Link da sala copiado.');
      } catch {
        setManual(r.link);
      }
    } catch (e) {
      painel.avisar(fraseDoErro(e), 'ruim');
    } finally {
      setCopiando(false);
    }
  }

  return (
    <>
      <Campo
        chave="linkDaProposta"
        rotulo="Link da proposta"
        valor={valor}
        valorParaEditar={p?.link ?? ''}
        editor={{ tipo: 'texto', placeholder: 'https://…', inputMode: 'url', maxLength: 500 }}
        podeEditar={podeEditar}
        focar={focar}
        aoSalvar={aoSalvar}
        apoio={
          p?.origem === 'manual' && p.link ? (
            <a href={p.link} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-brand">abrir a proposta</a>
          ) : p?.origem === 'servico' ? (
            <Link href="/propostas" className="underline underline-offset-2 hover:text-brand">ver em Propostas</Link>
          ) : p?.origem === 'sala' ? (
            'O link da sala só sai copiado: nunca fica escrito na ficha.'
          ) : null
        }
        acoes={
          p?.origem === 'sala' && podeEditar ? (
            <button type="button" data-testid="ficha-copiar-link-da-sala" disabled={copiando} onClick={() => void copiarDaSala()} className={`text-[11.5px] text-muted underline decoration-border underline-offset-2 hover:text-brand max-md:min-h-[44px] ${FOCO}`}>
              {copiando ? 'copiando…' : 'copiar link da sala'}
            </button>
          ) : null
        }
      />
      {manual && (
        <label className="-mt-1 block text-[11.5px] text-muted">
          Copie o link à mão:
          <input className={INPUT} readOnly value={manual} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
    </>
  );
}

/** A LINHA DO TEMPO RESUMIDA (variante B): os cinco últimos fatos do fio, do mais novo para o mais antigo. */
function LinhaDoTempo({ fio, abrirHistorico }: { fio: LinhaDoFio[]; abrirHistorico: () => void }) {
  const ultimos = [...fio].slice(-5).reverse();
  return (
    <aside className={`${CARTAO} min-w-0`} aria-label="linha do tempo" data-testid="ficha-linha-do-tempo">
      <div className="flex items-baseline justify-between gap-2">
        <Rotulo>linha do tempo</Rotulo>
        <button type="button" data-testid="ficha-ver-tudo" onClick={abrirHistorico} className={`text-[11.5px] text-muted underline decoration-border underline-offset-2 hover:text-brand ${FOCO}`}>
          ver tudo
        </button>
      </div>
      {ultimos.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-dim">Nenhum fato ainda.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {ultimos.map((l) => (
            <li key={l.eventoId} className="min-w-0 border-l-2 border-border pl-2.5">
              <p className="break-words text-[12.5px] leading-snug">{l.resumo}</p>
              <p className="text-[11px] text-dim">{quandoCurtoSP(l.em)} · {ROTULO_DA_FONTE[l.fonte] ?? l.fonte}</p>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

export function AbaGeral({
  leadId,
  ficha: f,
  extra,
  carregando,
  variante,
  campoFocado,
  aoMudar,
  abrirHistorico,
}: {
  leadId: string;
  ficha: FichaDoLead | null;
  extra: FichaGeralExtra | null;
  carregando: boolean;
  variante: VarianteDoPainel;
  campoFocado: string | null;
  aoMudar: () => Promise<void>;
  abrirHistorico: () => void;
}) {
  const { token, can } = useAuth();
  const pode = can('leads.editar');
  const pessoas = useAvatares(token);
  const equipe = useIdsDaEquipe(token);
  if (carregando) return <Carregando linhas={3} altura="h-40" />;
  if (!f) return null;

  const id = encodeURIComponent(leadId);
  const patch = async (corpo: Record<string, unknown>) => {
    await apiPatch(`/comercial/lead/${id}/ficha`, corpo, token);
    await aoMudar();
  };
  const foco = (chave: string) => campoFocado === chave;
  const daEquipe = soDaEquipe(pessoas ?? [], equipe, [f.vendedor?.id]);
  const opcoesDePessoas = daEquipe.map((p) => ({ valor: p.id, rotulo: p.nome }));
  const opcoesDeNomes = daEquipe.map((p) => ({ valor: p.nome, rotulo: p.nome }));
  if (f.socioDaConta?.nome && !opcoesDeNomes.some((o) => o.valor === f.socioDaConta?.nome)) opcoesDeNomes.push({ valor: f.socioDaConta.nome, rotulo: f.socioDaConta.nome });
  const opcoesDeCanal: { valor: string; rotulo: string }[] = COMO_CONHECEU.map((c) => ({ valor: c, rotulo: ROTULO_DO_COMO_CONHECEU[c] }));
  if (f.canal && !opcoesDeCanal.some((o) => o.valor === f.canal)) opcoesDeCanal.unshift({ valor: f.canal, rotulo: rotuloDoCanal(f.canal) ?? f.canal });
  const negocioTravado = !!extra?.negocioTravado;
  const avisoDoNegocio = negocioTravado ? 'Depois do aceite, produto, parcelas e 1ª parcela são do contrato (aba Dinheiro).' : null;
  const moeda = (cru: string) => {
    const n = lerReais(cru);
    return n == null || !Number.isFinite(n) ? cru : reaisOuAusente(Math.round(n * 100));
  };
  const reaisOuErro = (novo: string | null) => {
    if (novo == null) return null;
    const n = lerReais(novo);
    if (n == null || !Number.isFinite(n) || n < 0) throw new Error('Escreva um valor em reais, como 1.200,00.');
    return n;
  };

  const quem = (
    <Cartao titulo={ROTULO_DO_BLOCO.quem} testId="ficha-cartao-quem">
      <Campo chave="empresa" rotulo="Empresa" valor={f.empresa} editor={{ tipo: 'texto', placeholder: 'ex.: Sr. aGranel', maxLength: 200 }} podeEditar={pode} focar={foco('empresa')} aoSalvar={(v) => patch({ empresa: v })} />
      <Campo chave="nome" rotulo="Contato" valor={f.nome} editor={{ tipo: 'texto', placeholder: 'quem fala pela empresa', maxLength: 120 }} podeEditar={pode} focar={foco('nome')} aoSalvar={(v) => patch({ nome: v ?? '' })} />
      <Campo
        chave="tipoDePessoa"
        rotulo="Tipo de pessoa"
        valor={extra?.tipoDePessoa ? ROTULO_DO_TIPO_DE_PESSOA[extra.tipoDePessoa] : null}
        valorParaEditar={extra?.tipoDePessoa ?? ''}
        editor={{ tipo: 'opcoes', opcoes: TIPOS_DE_PESSOA.map((t) => ({ valor: t, rotulo: ROTULO_DO_TIPO_DE_PESSOA[t] })) }}
        podeEditar={pode}
        focar={foco('tipoDePessoa')}
        formatar={(c) => ROTULO_DO_TIPO_DE_PESSOA[c as 'PJ' | 'PF'] ?? c}
        aoSalvar={(v) => patch({ tipoDePessoa: v })}
      />
      <CampoDoWhatsapp leadId={leadId} telefone={f.telefone} podeEditar={pode} focar={foco('telefone') || foco('whatsapp')} aoMudar={aoMudar} />
      <Campo chave="email" rotulo="E-mail" valor={f.email} editor={{ tipo: 'texto', placeholder: 'nome@empresa.com.br', inputMode: 'email', maxLength: 200 }} podeEditar={pode} focar={foco('email')} aoSalvar={(v) => patch({ email: v })} />
      <Campo
        chave="preferenciasDeAtendimento"
        rotulo="Preferências de atendimento"
        valor={extra?.preferenciasDeAtendimento ?? null}
        editor={{ tipo: 'texto', placeholder: 'ex.: só de manhã, pelo WhatsApp, falar com o Lucas', maxLength: 400 }}
        podeEditar={pode}
        focar={foco('preferenciasDeAtendimento')}
        aoSalvar={(v) => patch({ preferenciasDeAtendimento: v })}
      />
    </Cartao>
  );

  const origem = (
    <Cartao titulo={ROTULO_DO_BLOCO.origem} testId="ficha-cartao-origem">
      <Campo
        chave="canal"
        rotulo="Como conheceu"
        valor={rotuloDoCanal(f.canal)}
        valorParaEditar={f.canal ?? ''}
        editor={{ tipo: 'opcoes', opcoes: opcoesDeCanal }}
        podeEditar={pode}
        focar={foco('canal')}
        formatar={(c) => rotuloDoCanal(c)}
        aoSalvar={(v) => patch({ canal: v })}
      />
      <Campo
        chave="origemIndicacao"
        rotulo="Origem da indicação"
        valor={f.origemIndicacao}
        editor={{ tipo: 'texto', placeholder: 'quem indicou', maxLength: 200 }}
        podeEditar={pode}
        focar={foco('origemIndicacao')}
        apoio={canalPedeOrigemDaIndicacao(f.canal) && !f.origemIndicacao ? 'O canal é indicação: diga de quem veio.' : null}
        aoSalvar={(v) => patch({ origemIndicacao: v })}
      />
      <Campo
        chave="vendedorId"
        rotulo="Vendedor"
        valor={f.vendedor?.nome ?? null}
        valorParaEditar={f.vendedor?.id ?? ''}
        editor={{ tipo: 'opcoes', opcoes: opcoesDePessoas, vazio: 'sem vendedor' }}
        podeEditar={pode}
        focar={foco('vendedorId')}
        formatar={(c) => opcoesDePessoas.find((o) => o.valor === c)?.rotulo ?? c}
        apoio={f.dono?.nome ? `dono (quem cuida agora): ${f.dono.nome}` : null}
        aoSalvar={(v) => patch({ vendedorId: v })}
      />
      <Campo
        chave="socioDaConta"
        rotulo="Sócio responsável"
        valor={f.socioDaConta?.nome ?? null}
        editor={{ tipo: 'opcoes', opcoes: opcoesDeNomes, vazio: 'sem sócio responsável' }}
        podeEditar={pode}
        focar={foco('socioDaConta')}
        aoSalvar={(v) => patch({ socioDaConta: v })}
      />
    </Cartao>
  );

  const negocio = (
    <Cartao titulo={ROTULO_DO_BLOCO.negocio} testId="ficha-cartao-negocio">
      <Campo
        chave="produto"
        rotulo="Produto"
        valor={f.produto ? ROTULO_DO_PRODUTO[f.produto] ?? f.produto : null}
        valorParaEditar={f.produto ?? ''}
        editor={{ tipo: 'opcoes', opcoes: COMERCIAL_PRODUTOS.map((p) => ({ valor: p, rotulo: ROTULO_DO_PRODUTO[p] })) }}
        podeEditar={pode && !negocioTravado}
        focar={foco('produto')}
        formatar={(c) => ROTULO_DO_PRODUTO[c as (typeof COMERCIAL_PRODUTOS)[number]] ?? c}
        apoio={avisoDoNegocio}
        aoSalvar={(v) => patch({ produto: v })}
      />
      <Campo
        chave="tipoNegocio"
        rotulo="Tipo do negócio"
        valor={ROTULO_DO_TIPO_DE_NEGOCIO[f.tipoNegocio ?? 'pagante']}
        valorParaEditar={f.tipoNegocio ?? 'pagante'}
        editor={{ tipo: 'opcoes', opcoes: COMERCIAL_TIPOS_DE_NEGOCIO.map((t) => ({ valor: t, rotulo: ROTULO_DO_TIPO_DE_NEGOCIO[t] })), vazio: 'pagante' }}
        podeEditar={pode}
        focar={foco('tipoNegocio')}
        formatar={(c) => ROTULO_DO_TIPO_DE_NEGOCIO[c as (typeof COMERCIAL_TIPOS_DE_NEGOCIO)[number]] ?? c}
        apoio="Pagante gera caixa; parceria, permuta e repasse não."
        aoSalvar={(v) => patch({ tipoNegocio: v ?? 'pagante' })}
      />
      <Campo
        chave="valorNegociado"
        rotulo="Valor negociado"
        valor={f.valorNegociadoCentavos != null ? reaisOuAusente(f.valorNegociadoCentavos) : null}
        valorParaEditar={reaisParaEditar(f.valorNegociadoCentavos ?? null)}
        editor={{ tipo: 'texto', placeholder: 'R$', inputMode: 'decimal', maxLength: 20 }}
        podeEditar={pode}
        focar={foco('valorNegociado')}
        formatar={moeda}
        apoio={f.valorCentavos != null && f.valorCentavos !== f.valorNegociadoCentavos ? `proposta: ${reaisOuAusente(f.valorCentavos)}` : null}
        aoSalvar={(v) => patch({ valorNegociado: reaisOuErro(v) })}
      />
      <Campo
        chave="parcelas"
        rotulo="Quantidade de parcelas"
        valor={f.parcelas != null ? `${f.parcelas}×` : null}
        valorParaEditar={f.parcelas != null ? String(f.parcelas) : ''}
        editor={{ tipo: 'texto', placeholder: 'ex.: 10', inputMode: 'numeric', maxLength: 3 }}
        podeEditar={pode && !negocioTravado}
        focar={foco('parcelas')}
        formatar={(c) => `${c}×`}
        apoio={avisoDoNegocio}
        aoSalvar={(v) => {
          if (v == null) return patch({ parcelas: null });
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 120) throw new Error('Escreva um número inteiro de parcelas (1 a 120).');
          return patch({ parcelas: n });
        }}
      />
      <Campo
        chave="parcela"
        rotulo="1ª parcela"
        valor={extra?.parcelaCentavos != null ? reaisOuAusente(extra.parcelaCentavos) : null}
        valorParaEditar={reaisParaEditar(extra?.parcelaCentavos ?? null)}
        editor={{ tipo: 'texto', placeholder: 'R$', inputMode: 'decimal', maxLength: 20 }}
        podeEditar={pode && !negocioTravado}
        focar={foco('parcela')}
        formatar={moeda}
        apoio={avisoDoNegocio}
        aoSalvar={(v) => patch({ parcela: reaisOuErro(v) })}
      />
      <CampoDoLinkDaProposta leadId={leadId} extra={extra} podeEditar={pode} focar={foco('linkDaProposta')} aoSalvar={(v) => patch({ linkDaProposta: v })} />
      {variante === 'B' && <EtapaAtual leadId={leadId} ficha={f} podeEditar={pode} focar={foco('etapa')} aoMudar={aoMudar} />}
    </Cartao>
  );

  if (variante === 'B') {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]" data-testid="ficha-geral" data-variante="B">
        <div className="space-y-3">
          {quem}
          {origem}
          {negocio}
        </div>
        <LinhaDoTempo fio={f.fio} abrirHistorico={abrirHistorico} />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="ficha-geral" data-variante="A">
      {/* A etapa como faixa no topo: a única coisa que a pessoa lê antes dos cartões. */}
      <section className="rounded border border-border bg-bg2 px-4 py-2.5" aria-label="etapa">
        <dl>
          <EtapaAtual leadId={leadId} ficha={f} podeEditar={pode} focar={foco('etapa')} aoMudar={aoMudar} />
        </dl>
      </section>
      <div className="grid gap-3 lg:grid-cols-3">
        {quem}
        {origem}
        {negocio}
      </div>
    </div>
  );
}
