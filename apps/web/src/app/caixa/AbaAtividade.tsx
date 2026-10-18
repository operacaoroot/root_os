'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  CaixaAtividade,
  CaixaAtividadeResposta,
  CaixaLimparResposta,
  CaixaMudanca,
} from '@mktos/shared';

import { apiGet, apiPost } from '@/lib/api';
import {
  BOTAO,
  BOTAO_PEQUENO,
  CARTAO,
  Carregando,
  ErroComRetentativa,
  FOCO,
  Vazio,
  dia,
  fraseDoQuadro,
  haQuanto,
  quandoCompleto,
} from './comum';

/*
 * A ABA ATIVIDADE — o que aconteceu nas tarefas em que você é o responsável.
 *
 * A lista é uma LEITURA da auditoria que o quadro grava e dos comentários; o
 * único botão que escreve é o Limpar, e ele grava só a SUA marca de leitura
 * (o item some da sua caixa e continua no histórico, e na caixa de quem mais
 * acompanha a tarefa). Por padrão aparecem as mudanças feitas por OUTRAS
 * pessoas, como na caixa do ClickUp; "mostrar o que eu fiz" traz as suas.
 */

const ROTULO_DO_CAMPO: Record<CaixaMudanca['campo'], string> = {
  status: 'Status',
  responsavel: 'Responsável',
  vencimento: 'Vencimento',
  titulo: 'Título',
  prioridade: 'Prioridade',
};

const VERBO: Record<CaixaAtividade['tipo'], string> = {
  status: 'mudou o status',
  atribuicao: 'mudou o responsável',
  vencimento: 'mudou o vencimento',
  comentario: 'comentou',
  criacao: 'criou a tarefa',
  edicao: 'editou a tarefa',
};

function valor(m: CaixaMudanca, v: string | null): string {
  if (v === null) return m.campo === 'vencimento' ? 'sem prazo' : 'vazio';
  return m.campo === 'vencimento' ? dia(v) : v;
}

function caminho(antesDe: string | null, incluirMeus: boolean, incluirLimpos: boolean): string {
  const q = new URLSearchParams();
  if (antesDe) q.set('antesDe', antesDe);
  if (incluirMeus) q.set('incluirMeus', '1');
  if (incluirLimpos) q.set('incluirLimpos', '1');
  const s = q.toString();
  return `/caixa/atividade${s ? `?${s}` : ''}`;
}

export function AbaAtividade({ token }: { token: string }) {
  const [incluirMeus, setIncluirMeus] = useState(false);
  const [incluirLimpos, setIncluirLimpos] = useState(false);
  const [resposta, setResposta] = useState<CaixaAtividadeResposta | null>(null);
  const [itens, setItens] = useState<CaixaAtividade[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [maisCarregando, setMaisCarregando] = useState(false);
  const [limpando, setLimpando] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);
  const pedido = useRef(0);
  const botaoLimparTudo = useRef<HTMLButtonElement>(null);
  const topo = useRef<HTMLDivElement>(null);
  /*
   * Para onde o foco vai quando o item limpo sai da tela (revisão do painel, P3):
   * o "Limpar" do item seguinte, ou do anterior, ou o "Limpar tudo"; sem nada
   * disso, o topo da aba. Antes o botão sumia do DOM e o foco caía no body.
   */
  const focarDepois = useRef<string | null>(null);

  const buscar = useCallback(async () => {
    const n = ++pedido.current;
    setCarregando(true);
    setErro(null);
    try {
      const r = await apiGet<CaixaAtividadeResposta>(caminho(null, incluirMeus, incluirLimpos), token);
      if (n !== pedido.current) return;
      setResposta(r);
      setItens(r.itens);
    } catch (e) {
      if (n === pedido.current) setErro((e as Error).message);
    } finally {
      if (n === pedido.current) setCarregando(false);
    }
  }, [token, incluirMeus, incluirLimpos]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  async function maisAntigos() {
    if (!resposta?.proximo) return;
    setMaisCarregando(true);
    try {
      const r = await apiGet<CaixaAtividadeResposta>(
        caminho(resposta.proximo, incluirMeus, incluirLimpos),
        token,
      );
      setResposta(r);
      setItens((atuais) => {
        const vistos = new Set(atuais.map((i) => i.id));
        return [...atuais, ...r.itens.filter((i) => !vistos.has(i.id))];
      });
    } catch (e) {
      setAviso(`Não foi possível carregar os mais antigos: ${(e as Error).message}`);
    } finally {
      setMaisCarregando(false);
    }
  }

  async function limparUm(id: string) {
    setLimpando((s) => new Set(s).add(id));
    setAviso(null);
    const visiveis = itens.filter((i) => !i.limpo);
    const pos = visiveis.findIndex((i) => i.id === id);
    const vizinho = visiveis[pos + 1] ?? visiveis[pos - 1] ?? null;
    try {
      await apiPost<CaixaLimparResposta>('/caixa/limpar', { ids: [id] }, token);
      focarDepois.current = vizinho ? vizinho.id : '';
      setItens((atuais) =>
        incluirLimpos
          ? atuais.map((i) => (i.id === id ? { ...i, limpo: true } : i))
          : atuais.filter((i) => i.id !== id),
      );
    } catch (e) {
      setAviso(`Não foi possível limpar: ${(e as Error).message}`);
    } finally {
      setLimpando((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function limparTudo() {
    if (!resposta) return;
    setAviso(null);
    try {
      // Até o instante desta leitura: o que chegar depois continua na caixa.
      await apiPost<CaixaLimparResposta>('/caixa/limpar', { tudo: true, ate: resposta.agora }, token);
      await buscar();
    } catch (e) {
      setAviso(`Não foi possível limpar tudo: ${(e as Error).message}`);
    }
  }

  useEffect(() => {
    const alvo = focarDepois.current;
    if (alvo === null) return;
    focarDepois.current = null;
    const doVizinho = alvo
      ? Array.from(topo.current?.querySelectorAll<HTMLButtonElement>('[data-testid^="caixa-limpar-"]') ?? []).find(
          (b) => b.dataset.testid === `caixa-limpar-${alvo}`,
        )
      : null;
    const tudo = botaoLimparTudo.current && !botaoLimparTudo.current.disabled ? botaoLimparTudo.current : null;
    (doVizinho ?? tudo ?? topo.current)?.focus();
  }, [itens]);

  const agora = resposta ? new Date(resposta.agora) : new Date();
  const fraseDeEstado = resposta ? fraseDoQuadro(resposta.estado) : null;
  const pendentes = itens.filter((i) => !i.limpo).length;

  return (
    <div ref={topo} tabIndex={-1} className="space-y-3 outline-none">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="inline-flex items-center gap-2 text-[12.5px] text-muted max-md:min-h-[44px]">
          <input
            type="checkbox"
            data-testid="caixa-incluir-meus"
            checked={incluirMeus}
            onChange={(e) => setIncluirMeus(e.target.checked)}
            className={FOCO}
          />
          Mostrar o que eu fiz
        </label>
        <label className="inline-flex items-center gap-2 text-[12.5px] text-muted max-md:min-h-[44px]">
          <input
            type="checkbox"
            data-testid="caixa-incluir-limpos"
            checked={incluirLimpos}
            onChange={(e) => setIncluirLimpos(e.target.checked)}
            className={FOCO}
          />
          Ver também os já limpos
        </label>
        <button
          ref={botaoLimparTudo}
          type="button"
          data-testid="caixa-limpar-tudo"
          onClick={() => void limparTudo()}
          disabled={!resposta || pendentes === 0}
          className={`${BOTAO} ml-auto`}
        >
          Limpar tudo
        </button>
      </div>

      {aviso && (
        <p role="status" className="text-xs text-warn">
          {aviso}
        </p>
      )}

      {erro ? (
        <ErroComRetentativa mensagem={erro} onTentar={() => void buscar()} />
      ) : carregando && !resposta ? (
        <Carregando texto="Lendo a atividade das suas tarefas..." />
      ) : fraseDeEstado ? (
        <Vazio>{fraseDeEstado}</Vazio>
      ) : itens.length === 0 ? (
        <Vazio>
          {incluirLimpos
            ? 'Nenhuma atividade nas suas tarefas por enquanto.'
            : 'Nada novo nas suas tarefas. O que você já limpou continua em "Ver também os já limpos".'}
        </Vazio>
      ) : (
        <ol className={`${CARTAO} divide-y divide-border overflow-hidden`} aria-label="Atividade das suas tarefas">
          {itens.map((i) => (
            <li
              key={i.id}
              data-testid={`caixa-item-${i.id}`}
              className={`flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-3 ${
                i.limpo ? 'opacity-60' : ''
              }`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-[13px] leading-snug">
                  <span className="font-medium text-text">{i.quem ?? 'Alguém'}</span>
                  {i.porMim && <span className="text-muted"> (você)</span>}{' '}
                  <span className="text-muted">{VERBO[i.tipo]} em</span>{' '}
                  <Link
                    href={`/trabalho?tarefa=${encodeURIComponent(i.tarefaId)}`}
                    className={`break-words font-medium text-brand hover:underline ${FOCO}`}
                  >
                    {i.tarefaTitulo}
                  </Link>
                </p>
                {i.mudancas.length > 0 && (
                  <ul className="space-y-0.5">
                    {i.mudancas.map((m) => (
                      <li key={m.campo} className="text-[12.5px] text-muted">
                        <span className="font-os-mono text-[10.5px] uppercase tracking-[0.12em]">
                          {ROTULO_DO_CAMPO[m.campo]}
                        </span>{' '}
                        <span className="line-through decoration-muted/60">{valor(m, m.de)}</span>
                        <span aria-hidden="true"> → </span>
                        <span className="sr-only"> para </span>
                        <span className="text-text">{valor(m, m.para)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {i.trecho && (
                  <p className="break-words text-[12.5px] text-muted">
                    “{i.trecho}”
                    {i.trechoCortado && <span className="text-dim"> (trecho; o resto está no quadro)</span>}
                  </p>
                )}
                <p className="font-os-mono text-[10.5px] text-muted">
                  <time dateTime={i.quando} title={quandoCompleto(i.quando)}>
                    {haQuanto(i.quando, agora)}
                  </time>
                  {i.lista && <> · {i.lista}</>}
                  {i.limpo && <> · limpo</>}
                </p>
              </div>
              {!i.limpo && (
                <button
                  type="button"
                  data-testid={`caixa-limpar-${i.id}`}
                  onClick={() => void limparUm(i.id)}
                  disabled={limpando.has(i.id)}
                  aria-label={`Limpar: ${VERBO[i.tipo]} em ${i.tarefaTitulo}`}
                  className={`${BOTAO_PEQUENO} self-start`}
                >
                  Limpar
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {resposta?.proximo && itens.length > 0 && (
        <button type="button" onClick={() => void maisAntigos()} disabled={maisCarregando} className={BOTAO}>
          {maisCarregando ? 'Carregando...' : 'Carregar mais antigos'}
        </button>
      )}

      {resposta && resposta.estado === 'ok' && resposta.identidades.length > 0 && (
        <p className="text-xs text-muted">
          O responsável de uma tarefa é texto livre (veio do ClickUp), então a caixa procura você por
          nome: <span className="text-text">{resposta.identidades.join(', ')}</span>. Se no quadro o seu
          nome está escrito de outro jeito, as tarefas não aparecem aqui.
          {resposta.tarefasTruncadas && ' Você tem muitas tarefas: a atividade olha as mil mexidas por último.'}
        </p>
      )}
    </div>
  );
}
