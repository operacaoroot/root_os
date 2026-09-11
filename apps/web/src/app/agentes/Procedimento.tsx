'use client';

import { useEffect, useState } from 'react';
import { Lock, Plus, X } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api';
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

export function Procedimento({
  slug,
  token,
  podeEditar,
  aoFechar,
  aoSalvar,
}: {
  slug: string;
  token: string | null;
  podeEditar: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [d, setD] = useState<ProcedimentoDetalhe | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    apiGet<ProcedimentoDetalhe>(`/agents/${slug}`, token)
      .then((r) => {
        if (!vivo) return;
        setD(r);
        setForm(
          r.sop
            ? {
                proposito: r.sop.proposito,
                gatilho: r.sop.gatilho,
                passos: r.sop.passos.length ? r.sop.passos : [''],
                definicaoDePronto: r.sop.definicaoDePronto,
                observacoes: r.sop.observacoes ?? '',
              }
            : VAZIO,
        );
      })
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [slug, token]);

  // Os dois campos que moram no agente: sem eles a API recusa, e dizer isso
  // ANTES é mais honesto do que deixar escrever e recusar no fim.
  const faltaNoAgente = (d?.formato.faltando ?? []).filter((c) => c === 'dono' || c === 'pilar');

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      await apiPut(
        `/agents/${slug}/sop`,
        {
          proposito: form.proposito,
          gatilho: form.gatilho,
          passos: form.passos.map((p) => p.trim()).filter(Boolean),
          definicaoDePronto: form.definicaoDePronto,
          observacoes: form.observacoes.trim() || null,
        },
        token,
      );
      aoSalvar();
      aoFechar();
    } catch (e) {
      /*
       * A rota EXISTE desde a estabilização da onda 9. Este ramo ficou como rede
       * de segurança: se ela sumir outra vez, dizer isso com todas as letras
       * evita meia hora de caça ao erro errado — mas só quando a causa for mesmo
       * a ausência de rota. Um 404 de "agente não existe" tem de aparecer como
       * ele é. Ver `rota-ausente.ts`.
       */
      if (rotaNaoExiste(e, 'PUT', `/agents/${slug}/sop`)) {
        setErro(
          'a rota PUT /agents/' +
            slug +
            '/sop não está ligada nesta API — a validação e a gravação existem no serviço, falta a rota no controller de agentes',
        );
      } else {
        setErro((e as Error).message);
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={aoFechar}>
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
          <button type="button" onClick={aoFechar} className="text-muted hover:text-text">
            <X size={16} />
          </button>
        </div>

        {erro && (
          <div className="mt-4 rounded-root border border-bad/40 bg-bad/10 p-3 text-[12px] leading-[1.6] text-bad">
            {erro}
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
                disabled={!podeEditar}
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
                disabled={!podeEditar}
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
                      disabled={!podeEditar}
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
                disabled={!podeEditar}
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
                disabled={!podeEditar}
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
                  disabled={salvando}
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
                  versão {d.sop.versao} · {new Date(d.sop.atualizadoEm).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
