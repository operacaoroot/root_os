'use client';

import { useEffect, useRef, useState } from 'react';
import { AgentSopEdicaoSchema, AgentSopSalvaSchema } from '@mktos/shared';
import { Lock, Plus, X } from 'lucide-react';
import { apiGet, apiPut, ErroDaApi } from '@/lib/api';
import { rotaNaoExiste } from './rota-ausente';

/*
 * O EDITOR DO PROCEDIMENTO (RF-N-02) — e o que ele NÃO edita.
 *
 * Sete campos, e a tela trata os três grupos de maneira diferente porque eles
 * são diferentes:
 *
 *   · propósito, gatilho, passos, definição de pronto → caixas de texto;
 *   · dono e pilar → mostrados, não editados AQUI. Eles são colunas do agente,
 *     não do procedimento, e a rota que os escreve ainda não existe (ver o
 *     relatório da fatia). Quando faltarem, a tela diz o que falta em vez de
 *     deixar a pessoa escrever um procedimento que a API vai recusar no fim;
 *   · escalação → CADEADO. O texto vem da API já resolvido com o nome do dono
 *     (`GET /agents/:slug` devolve `escalacao` e `escalacaoEditavel: false`), e
 *     não há caixa nenhuma. Não é uma cópia guardada no web de propósito: duas
 *     cópias do mesmo texto fixo é o tipo de coisa que diverge em silêncio.
 *
 * O QUE ESTA TELA TAMBÉM NÃO MOSTRA COMO EDITÁVEL: capacidades e autonomia. A
 * porta recusa capacidade fora da declaração do agente, então aquela lista é
 * superfície de segurança — alargá-la por uma caixa de seleção guardada só por
 * permissão de papel seria contornar a régua pela porta dos fundos. Elas
 * aparecem como leitura, na tela de fora.
 */

export interface ProcedimentoDetalhe {
  slug: string;
  nome: string;
  pilar: string | null;
  dono: { id: string; nome: string } | null;
  capacidades: string[];
  autonomiaAte: string;
  escalacao: string;
  escalacaoEditavel: false;
  sop: {
    proposito: string;
    gatilho: string;
    passos: string[];
    definicaoDePronto: string;
    observacoes: string | null;
    versao: number;
    atualizadoEm: string;
    atualizadoPor: string | null;
  } | null;
  formato: {
    campos: { campo: string; rotulo: string; onde: 'procedimento' | 'agente' | 'codigo' }[];
    faltando: string[];
  };
}

const VAZIO = { proposito: '', gatilho: '', passos: [''], definicaoDePronto: '', observacoes: '' };

const rotulo =
  'block font-os-mono text-[9.5px] uppercase tracking-[0.16em] text-dim';
const caixa =
  'mt-1 w-full rounded-root border border-border bg-bg px-2.5 py-2 text-[12px] leading-[1.6] text-text outline-none focus:border-brand';

type ProcedimentoProps = {
  slug: string;
  token: string | null;
  podeEditar: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
};

function camposDaSop(sop: ProcedimentoDetalhe['sop']) {
  return sop
    ? {
        proposito: sop.proposito,
        gatilho: sop.gatilho,
        passos: sop.passos.length ? [...sop.passos] : [''],
        definicaoDePronto: sop.definicaoDePronto,
        observacoes: sop.observacoes ?? '',
      }
    : { ...VAZIO, passos: [''] };
}

function conferirDetalhe(r: ProcedimentoDetalhe | null, slug: string) {
  if (!r || r.slug !== slug || r.sop === undefined ||
    (r.sop !== null && (!Number.isInteger(r.sop.versao) || r.sop.versao < 1))) {
    throw new Error('A versão do procedimento não pôde ser conferida.');
  }
  return r;
}

export function Procedimento(props: ProcedimentoProps) {
  return <EditorProcedimento key={JSON.stringify([props.slug, props.token])} {...props} />;
}

function EditorProcedimento({ slug, token, podeEditar, aoFechar, aoSalvar }: ProcedimentoProps) {
  const [d, setD] = useState<ProcedimentoDetalhe | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [formInicial, setFormInicial] = useState(JSON.stringify(VAZIO));
  const [versaoLida, setVersaoLida] = useState<number | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [estadoEnvio, setEstadoEnvio] = useState<'edicao' | 'conflito' | 'incerto'>('edicao');
  const [conferencia, setConferencia] = useState<ProcedimentoDetalhe | null>(null);
  const ocupado = useRef(false);
  const vivo = useRef(true);
  const geracao = useRef(0);
  const permissaoAtual = useRef(podeEditar);
  permissaoAtual.current = podeEditar;

  function privar() {
    setD(null);
    setForm({ ...VAZIO, passos: [''] });
    setFormInicial(JSON.stringify(VAZIO));
    setVersaoLida(undefined);
    setConferencia(null);
    setAviso(null);
  }

  useEffect(() => {
    vivo.current = true;
    const rodada = ++geracao.current;
    if (!token) {
      setErro('Entre novamente para consultar o procedimento.');
    } else {
      apiGet<ProcedimentoDetalhe | null>(`/agents/${slug}`, token)
        .then((r) => {
          if (!vivo.current || rodada !== geracao.current) return;
          const detalhe = conferirDetalhe(r, slug);
          const campos = camposDaSop(detalhe.sop);
          setD(detalhe);
          setForm(campos);
          setFormInicial(JSON.stringify(campos));
          // Null vem somente de uma leitura autorizada que retornou sop:null.
          setVersaoLida(detalhe.sop === null ? null : detalhe.sop.versao);
        })
        .catch((e) => {
          if (vivo.current && rodada === geracao.current) setErro((e as Error).message);
        });
    }
    return () => {
      vivo.current = false;
      geracao.current++;
    };
  }, [slug, token]);

  const faltaNoAgente = (d?.formato.faltando ?? []).filter((c) => c === 'dono' || c === 'pilar');
  const podeMudarCampos = podeEditar && !salvando && !conferindo;

  function fechar() {
    const alterado = JSON.stringify(form) !== formInicial;
    if ((alterado || estadoEnvio !== 'edicao' || ocupado.current) &&
      !window.confirm(ocupado.current
        ? 'Há uma consulta ou envio em andamento. Fechar não cancela o envio. Fechar esta edição?'
        : 'Fechar esta edição e descartar o rascunho local?')) return;
    aoFechar();
  }

  async function salvar() {
    if (!token || !d || versaoLida === undefined || !permissaoAtual.current ||
      ocupado.current || estadoEnvio !== 'edicao') return;
    const input = AgentSopEdicaoSchema.safeParse({
      expectedSopVersion: versaoLida,
      procedimento: {
        proposito: form.proposito,
        gatilho: form.gatilho,
        passos: form.passos.map((p) => p.trim()).filter(Boolean),
        definicaoDePronto: form.definicaoDePronto,
        observacoes: form.observacoes.trim() || null,
      },
    });
    if (!input.success) {
      setErro(input.error.issues.map((i) => i.message).join(' · '));
      return;
    }
    const rodada = geracao.current;
    const vigente = () => vivo.current && rodada === geracao.current;
    ocupado.current = true;
    setErro(null);
    setAviso(null);
    setConferencia(null);
    setSalvando(true);
    try {
      const raw = await apiPut<unknown>(`/agents/${slug}/sop`, input.data, token);
      if (!vigente()) return;
      const resposta = AgentSopSalvaSchema.safeParse(raw);
      if (!resposta.success || resposta.data.versao !== (versaoLida ?? 0) + 1) {
        throw new Error('A resposta da gravação não pôde ser conferida.');
      }
      if (!permissaoAtual.current) {
        setEstadoEnvio('incerto');
        setErro('A permissão mudou durante o envio. Confira o estado atual antes de continuar.');
        return;
      }
      aoSalvar();
      aoFechar();
    } catch (e) {
      if (!vigente()) return;
      if (e instanceof ErroDaApi && [401, 403].includes(e.status)) {
        privar();
        setErro('Acesso ao procedimento recusado. Entre novamente ou confira suas permissões.');
      } else if (e instanceof ErroDaApi && e.status === 409) {
        setEstadoEnvio('conflito');
        setErro('O procedimento mudou. Seu rascunho e a versão lida foram preservados. Confira a versão atual antes de continuar.');
      } else if (e instanceof ErroDaApi && e.status === 400) {
        setErro(e.message);
      } else {
        setEstadoEnvio('incerto');
        setErro(rotaNaoExiste(e, 'PUT', `/agents/${slug}/sop`)
          ? 'A rota de gravação não está disponível. O rascunho foi preservado; confira o estado atual.'
          : 'A gravação não foi confirmada. O rascunho foi preservado; confira o estado atual antes de outro envio.');
      }
    } finally {
      if (vigente()) {
        ocupado.current = false;
        setSalvando(false);
      }
    }
  }

  async function conferirAtual() {
    if (!token || !d || ocupado.current) return;
    const rodada = geracao.current;
    const vigente = () => vivo.current && rodada === geracao.current;
    ocupado.current = true;
    setConferindo(true);
    setConferencia(null);
    try {
      const atual = await apiGet<ProcedimentoDetalhe | null>(`/agents/${slug}`, token);
      if (!vigente()) return;
      if (atual === null) {
        privar();
        setErro('O agente não foi localizado na consulta atual. O acesso foi retirado desta tela.');
        return;
      }
      setConferencia(conferirDetalhe(atual, slug));
    } catch (e) {
      if (!vigente()) return;
      if (e instanceof ErroDaApi && [401, 403, 404].includes(e.status)) privar();
      setErro(e instanceof ErroDaApi && [401, 403, 404].includes(e.status)
        ? 'O procedimento não está disponível para esta sessão. O acesso foi retirado desta tela.'
        : 'A consulta atual falhou. Seu rascunho e a versão lida continuam preservados.');
    } finally {
      if (vigente()) {
        ocupado.current = false;
        setConferindo(false);
      }
    }
  }

  function retomarEdicao(usarAtual: boolean) {
    if (!conferencia || ocupado.current || !permissaoAtual.current) return;
    const base = conferencia.sop === null ? null : conferencia.sop.versao;
    const nomeDaBase = base === null ? 'ausência de procedimento' : `versão ${base}`;
    if (!window.confirm(usarAtual
      ? `Descartar seu rascunho e usar o procedimento conferido (${nomeDaBase})? Nenhuma gravação será feita agora.`
      : `Retomar seu rascunho contra ${nomeDaBase}? A consulta não confirma a autoria do envio anterior. Nenhuma gravação será feita agora.`)) return;
    const camposAtuais = camposDaSop(conferencia.sop);
    if (usarAtual) setForm(camposAtuais);
    setFormInicial(JSON.stringify(camposAtuais));
    setD(conferencia);
    setVersaoLida(base);
    setConferencia(null);
    setEstadoEnvio('edicao');
    setErro(null);
    setAviso(`Edição retomada após sua conferência: ${nomeDaBase}. Salvar fará uma nova verificação dessa versão.`);
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={fechar}>
      <div
        className="h-full w-full max-w-[560px] overflow-y-auto border-l border-border bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-os-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
              procedimento · formato fixo de sete campos
            </p>
            <h2 className="mt-1 text-[15px] font-medium text-text">{d?.nome ?? slug}</h2>
          </div>
          <button type="button" onClick={fechar} className="text-muted hover:text-text">
            <X size={16} />
          </button>
        </div>

        {erro && (
          <div className="mt-4 rounded-root border border-bad/40 bg-bad/10 p-3 text-[12px] leading-[1.6] text-bad">
            {erro}
          </div>
        )}

        {aviso && <p className="mt-4 text-[12px] leading-[1.6] text-muted" role="status">{aviso}</p>}

        {d && estadoEnvio !== 'edicao' && (
          <div className="mt-4 space-y-3 rounded-root border border-warn/40 bg-warn/10 p-3 text-[12px] leading-[1.6]">
            <p className="text-warn">
              Rascunho iniciado com {versaoLida === null ? 'ausência de procedimento' : `versão ${versaoLida}`}.
              Nenhum envio será repetido automaticamente.
            </p>
            <button type="button" disabled={salvando || conferindo} onClick={conferirAtual}
              className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-brand disabled:opacity-50">
              {conferindo ? 'conferindo…' : 'conferir versão atual'}
            </button>
            {conferencia && (
              <div className="space-y-3 border-t border-warn/30 pt-3">
                <p className="text-text">
                  Estado atual conferido: {conferencia.sop === null ? 'sem procedimento' : `versão ${conferencia.sop.versao}`}.
                  Essa leitura não confirma a autoria do envio anterior.
                </p>
                {conferencia.sop && (
                  <dl className="space-y-2 whitespace-pre-wrap text-muted">
                    <div><dt className="font-medium text-text">Propósito</dt><dd>{conferencia.sop.proposito}</dd></div>
                    <div><dt className="font-medium text-text">Gatilho</dt><dd>{conferencia.sop.gatilho}</dd></div>
                    <div><dt className="font-medium text-text">Passos</dt><dd>{conferencia.sop.passos.map((passo, i) => `${i + 1}. ${passo}`).join('\n')}</dd></div>
                    <div><dt className="font-medium text-text">Definição de pronto</dt><dd>{conferencia.sop.definicaoDePronto}</dd></div>
                    <div><dt className="font-medium text-text">Observações</dt><dd>{conferencia.sop.observacoes ?? 'Sem observações.'}</dd></div>
                  </dl>
                )}
                {podeEditar && (
                  <div className="flex flex-wrap gap-3">
                    <button type="button" onClick={() => retomarEdicao(false)}
                      className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-brand">retomar com meu rascunho</button>
                    <button type="button" onClick={() => retomarEdicao(true)}
                      className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">usar procedimento atual</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!d && !erro && <p className="mt-6 text-sm text-muted">Carregando…</p>}

        {d && (
          <div className="mt-5 space-y-4">
            {/* 1 — propósito */}
            <div>
              <label className={rotulo} htmlFor="proposito">
                1 · propósito
              </label>
              <textarea
                id="proposito"
                rows={2}
                disabled={!podeMudarCampos}
                value={form.proposito}
                onChange={(e) => setForm({ ...form, proposito: e.target.value })}
                placeholder="para que este agente existe"
                className={caixa}
              />
            </div>

            {/* 2 — dono (do agente, não do procedimento) */}
            <div>
              <span className={rotulo}>2 · dono</span>
              <p className="mt-1 flex items-center gap-2 rounded-root border border-border bg-bg px-2.5 py-2 text-[12px] text-text">
                <Lock size={11} className="flex-none text-dim" />
                {d.dono ? (
                  d.dono.nome
                ) : (
                  <span className="text-warn">
                    sem dono — o procedimento não é aceito sem alguém para quem escalar
                  </span>
                )}
              </p>
            </div>

            {/* 3 — gatilho */}
            <div>
              <label className={rotulo} htmlFor="gatilho">
                3 · gatilho
              </label>
              <input
                id="gatilho"
                disabled={!podeMudarCampos}
                value={form.gatilho}
                onChange={(e) => setForm({ ...form, gatilho: e.target.value })}
                placeholder="o que faz este agente começar"
                className={caixa}
              />
            </div>

            {/* 4 — passos */}
            <div>
              <span className={rotulo}>4 · passos</span>
              <div className="mt-1 space-y-1.5">
                {form.passos.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="font-os-mono text-[10px] text-dim">{i + 1}.</span>
                    <input
                      disabled={!podeMudarCampos}
                      value={p}
                      onChange={(e) => {
                        const passos = [...form.passos];
                        passos[i] = e.target.value;
                        setForm({ ...form, passos });
                      }}
                      className={`${caixa} mt-0`}
                    />
                    {podeEditar && form.passos.length > 1 && (
                      <button
                        type="button"
                        disabled={!podeMudarCampos}
                        aria-label={`remover passo ${i + 1}`}
                        onClick={() =>
                          setForm({ ...form, passos: form.passos.filter((_, j) => j !== i) })
                        }
                        className="text-dim hover:text-bad"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {podeEditar && (
                <button
                  type="button"
                  disabled={!podeMudarCampos}
                  onClick={() => setForm({ ...form, passos: [...form.passos, ''] })}
                  className="mt-2 inline-flex items-center gap-1 font-os-mono text-[9.5px] uppercase tracking-[0.16em] text-brand hover:underline"
                >
                  <Plus size={11} /> mais um passo
                </button>
              )}
            </div>

            {/* 5 — definição de pronto */}
            <div>
              <label className={rotulo} htmlFor="pronto">
                5 · definição de pronto
              </label>
              <textarea
                id="pronto"
                rows={2}
                disabled={!podeMudarCampos}
                value={form.definicaoDePronto}
                onChange={(e) => setForm({ ...form, definicaoDePronto: e.target.value })}
                placeholder="como se sabe que terminou bem"
                className={caixa}
              />
            </div>

            {/* 6 — escalação: do código, com cadeado */}
            <div>
              <span className={rotulo}>6 · escalação</span>
              <div className="mt-1 rounded-root border border-border bg-bg px-2.5 py-2">
                <p className="flex items-center gap-1.5 font-os-mono text-[9px] uppercase tracking-[0.16em] text-dim">
                  <Lock size={10} /> texto fixo do sistema — injetado em toda SOP, não editável
                </p>
                <pre className="mt-1.5 whitespace-pre-wrap font-os-mono text-[11px] leading-[1.6] text-muted">
                  {d.escalacao}
                </pre>
              </div>
            </div>

            {/* 7 — pilar (do agente) */}
            <div>
              <span className={rotulo}>7 · pilar</span>
              <p className="mt-1 flex items-center gap-2 rounded-root border border-border bg-bg px-2.5 py-2 text-[12px] text-text">
                <Lock size={11} className="flex-none text-dim" />
                {d.pilar ?? (
                  <span className="text-warn">sem pilar — é por ele que o organograma agrupa</span>
                )}
              </p>
            </div>

            {/* fora dos sete, mas parte do procedimento */}
            <div>
              <label className={rotulo} htmlFor="observacoes">
                observações <span className="normal-case tracking-normal">(opcional)</span>
              </label>
              <textarea
                id="observacoes"
                rows={2}
                disabled={!podeMudarCampos}
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                className={caixa}
              />
            </div>

            {/* o que a porta usa, e esta tela não escreve */}
            <div className="rounded-root border border-border bg-bg px-2.5 py-2">
              <p className="flex items-center gap-1.5 font-os-mono text-[9px] uppercase tracking-[0.16em] text-dim">
                <Lock size={10} /> o que a porta usa — leitura
              </p>
              <p className="mt-1.5 font-os-mono text-[10px] leading-[1.7] text-muted">
                autonomia até <span className="text-text">{d.autonomiaAte}</span> · declara{' '}
                <span className="text-text">{d.capacidades.length}</span> capacidade(s)
                {d.capacidades.length > 0 && `: ${d.capacidades.join(' · ')}`}
              </p>
              <p className="mt-1 text-[10.5px] leading-[1.6] text-dim">
                Fora dessa lista a porta recusa. Mudar o alcance de um agente não é edição de
                procedimento e não sai daqui.
              </p>
            </div>

            {faltaNoAgente.length > 0 && (
              <p className="rounded-root border border-warn/40 bg-warn/10 p-2.5 text-[11.5px] leading-[1.6] text-warn">
                Falta {faltaNoAgente.join(' e ')} no agente. Sem os sete campos o procedimento é
                recusado — e {faltaNoAgente.join(' e ')} não se escreve por esta tela.
              </p>
            )}

            <div className="flex items-center gap-3 border-t border-border pt-4">
              {podeEditar ? (
                <button
                  type="button"
                  disabled={salvando || conferindo || versaoLida === undefined || estadoEnvio !== 'edicao'}
                  onClick={salvar}
                  className="rounded-root bg-brand px-3 py-1.5 font-os-mono text-[10px] uppercase tracking-[0.1em] text-ink disabled:opacity-50"
                >
                  {salvando ? 'salvando…' : 'salvar procedimento'}
                </button>
              ) : (
                <p className="font-os-mono text-[10px] text-dim">
                  leitura — falta permissão para editar procedimento
                </p>
              )}
              <span className="flex-1" />
              {d.sop && (
                <p className="font-os-mono text-[9.5px] text-dim">
                  versão lida {versaoLida} · {new Date(d.sop.atualizadoEm).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
