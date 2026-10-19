'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  CaixaFiltroDeVencimento,
  CaixaMinhaTarefa,
  CaixaMotivoDaParada,
  CaixaTarefasResposta,
  TrabComentarioDto,
  TrabTarefaDetalhe,
} from '@mktos/shared';

import { apiGet } from '@/lib/api';
import { useTarefaNaUrl } from '@/lib/tarefa-na-url';
import { TarefaFlutuante } from '@/components/trabalho/TrabalhoView';
import {
  BOTAO_PEQUENO,
  CARTAO,
  Carregando,
  ErroComRetentativa,
  FOCO,
  ROTULO,
  SELECT,
  Vazio,
  dia,
  fraseDoQuadro,
  haQuanto,
} from './comum';

/*
 * A ABA MINHAS TAREFAS — a tabela das suas tarefas, com filtros e colunas.
 *
 * Só leitura: mexer na tarefa é no quadro (`/trabalho`), que tem a permissão e
 * as travas dele. Os comentários abrem num balão sem sair da tela, lidos da rota
 * dona (`GET /trabalho/tarefas/:id`). No celular a tabela vira lista de cartões.
 */

export const COLUNAS = ['lista', 'status', 'vencimento', 'responsaveis', 'comentarios'] as const;
export type Coluna = (typeof COLUNAS)[number];
const ROTULO_DA_COLUNA: Record<Coluna, string> = {
  lista: 'Lista',
  status: 'Status',
  vencimento: 'Vencimento',
  responsaveis: 'Responsáveis',
  comentarios: 'Comentários',
};
export const CHAVE_DAS_COLUNAS = 'caixa.tarefas.colunas.v1';

const FRASE_DO_MOTIVO: Record<CaixaMotivoDaParada, string> = {
  prazo_vencido: 'prazo vencido',
  sem_movimento: 'parada há mais de uma semana',
  presa_com_agente: 'travada com um agente',
};

const ROTULO_DO_VENCIMENTO: Record<CaixaFiltroDeVencimento, string> = {
  vencidas: 'Vencidas',
  hoje: 'Vencem hoje',
  semana: 'Próximos 7 dias',
};

function lerColunas(): Set<Coluna> {
  try {
    const bruto = window.localStorage.getItem(CHAVE_DAS_COLUNAS);
    if (!bruto) return new Set(COLUNAS);
    const lidas = (JSON.parse(bruto) as unknown[]).filter((c): c is Coluna =>
      (COLUNAS as readonly string[]).includes(c as string),
    );
    return new Set(lidas);
  } catch {
    return new Set(COLUNAS);
  }
}

interface Filtros {
  lista: string; // '' | 'lista:<id>' | 'pasta:<id>'
  status: string;
  vencimento: '' | CaixaFiltroDeVencimento;
  responsavel: 'eu' | 'qualquer';
}

function caminho(f: Filtros): string {
  const q = new URLSearchParams();
  if (f.lista.startsWith('lista:')) q.set('listaId', f.lista.slice(6));
  if (f.lista.startsWith('pasta:')) q.set('pastaId', f.lista.slice(6));
  if (f.status) q.set('status', f.status);
  if (f.vencimento) q.set('vencimento', f.vencimento);
  if (f.responsavel !== 'eu') q.set('responsavel', f.responsavel);
  const s = q.toString();
  return `/caixa/tarefas${s ? `?${s}` : ''}`;
}

/* ------------------------------------------------------------------------ *
 * O balão de comentários
 * ------------------------------------------------------------------------ */

const ULTIMOS = 5;

/*
 * O balão é um diálogo leve (revisão do painel, P3 de 18/10/2026): Esc e o botão
 * "fechar" DEVOLVEM O FOCO ao botão que o abriu; o clique fora fecha e deixa o
 * foco onde a pessoa clicou. O clique no próprio botão de origem não conta como
 * "fora": é o botão que alterna, e antes o mousedown fechava e o click reabria.
 */
function BalaoDeComentarios({
  tarefa,
  token,
  ancora,
  origem,
  onFechar,
}: {
  tarefa: CaixaMinhaTarefa;
  token: string;
  ancora: DOMRect | null;
  origem: HTMLElement | null;
  onFechar: (devolverFoco: boolean) => void;
}) {
  const [comentarios, setComentarios] = useState<TrabComentarioDto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  const buscar = useCallback(async () => {
    setErro(null);
    try {
      const d = await apiGet<TrabTarefaDetalhe>(`/trabalho/tarefas/${encodeURIComponent(tarefa.id)}`, token);
      setComentarios(d.comentarios.slice(0, ULTIMOS));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [tarefa.id, token]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  useEffect(() => {
    caixa.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar(true);
    };
    const clique = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (origem?.contains(alvo)) return;
      if (caixa.current && !caixa.current.contains(alvo)) onFechar(false);
    };
    document.addEventListener('keydown', tecla);
    document.addEventListener('mousedown', clique);
    return () => {
      document.removeEventListener('keydown', tecla);
      document.removeEventListener('mousedown', clique);
    };
  }, [onFechar, origem]);

  // Fixo na tela, perto do botão e dentro da janela: dentro da tabela, que rola
  // de lado, um balão absoluto seria cortado. No celular, ocupa a base da tela.
  const largura = 340;
  const estilo: React.CSSProperties | undefined =
    ancora && typeof window !== 'undefined' && window.innerWidth >= 768
      ? {
          top: Math.min(ancora.bottom + 6, window.innerHeight - 320),
          left: Math.max(8, Math.min(ancora.right - largura, window.innerWidth - largura - 8)),
          width: largura,
        }
      : undefined;
  const agora = new Date();

  return (
    <div
      ref={caixa}
      role="dialog"
      aria-label={`Comentários de ${tarefa.titulo}`}
      tabIndex={-1}
      data-testid={`caixa-balao-${tarefa.id}`}
      style={estilo}
      className={`fixed z-50 max-h-[320px] overflow-y-auto rounded border border-border bg-surface p-3 shadow-lg ${FOCO} ${
        estilo ? '' : 'inset-x-2 bottom-2'
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[12.5px] font-medium">{tarefa.titulo}</p>
        <button type="button" onClick={() => onFechar(true)} className={BOTAO_PEQUENO} aria-label="Fechar comentários">
          fechar
        </button>
      </div>
      {erro ? (
        <ErroComRetentativa mensagem={erro} onTentar={() => void buscar()} />
      ) : !comentarios ? (
        <Carregando texto="Lendo os comentários..." />
      ) : comentarios.length === 0 ? (
        <p className="text-[12.5px] text-muted">Ninguém comentou nesta tarefa ainda.</p>
      ) : (
        <ol className="space-y-2">
          {comentarios.map((c) => (
            <li key={c.id} className="space-y-0.5">
              <p className="text-[11.5px] text-muted">
                <span className="text-text">{c.authorName}</span> ·{' '}
                <time dateTime={c.createdAt}>{haQuanto(c.createdAt, agora)}</time>
              </p>
              <p className="whitespace-pre-wrap break-words text-[12.5px]">{c.text}</p>
            </li>
          ))}
        </ol>
      )}
      {tarefa.comentarios > ULTIMOS && (
        <p className="mt-2 text-[11.5px] text-muted">
          Mostrando os {ULTIMOS} últimos de {tarefa.comentarios}.{' '}
          <Link
            href={`/trabalho?lista=${encodeURIComponent(tarefa.listaId)}&tarefa=${encodeURIComponent(tarefa.id)}`}
            className="text-brand hover:underline"
          >
            ver todos no quadro
          </Link>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * A aba
 * ------------------------------------------------------------------------ */

export function AbaMinhasTarefas({ token }: { token: string }) {
  // A tarefa abre num pop-up por cima da tabela (rodada do trabalho T2): ninguém sai de Pendências.
  const popup = useTarefaNaUrl();
  const abrirNoClique = (id: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    popup.abrir(id);
  };
  const [filtros, setFiltros] = useState<Filtros>({ lista: '', status: '', vencimento: '', responsavel: 'eu' });
  const [colunas, setColunas] = useState<Set<Coluna>>(() => new Set(COLUNAS));
  const [resposta, setResposta] = useState<CaixaTarefasResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [balao, setBalao] = useState<{ tarefa: CaixaMinhaTarefa; ancora: DOMRect | null; origem: HTMLElement | null } | null>(null);
  const origemDoBalao = useRef<HTMLElement | null>(null);
  const pedido = useRef(0);

  useEffect(() => {
    setColunas(lerColunas());
  }, []);

  function alternarColuna(c: Coluna) {
    setColunas((atual) => {
      const n = new Set(atual);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      try {
        window.localStorage.setItem(CHAVE_DAS_COLUNAS, JSON.stringify(COLUNAS.filter((x) => n.has(x))));
      } catch {
        /* sem localStorage (aba anônima com bloqueio): a escolha vale só nesta visita */
      }
      return n;
    });
  }

  const buscar = useCallback(async () => {
    const n = ++pedido.current;
    setCarregando(true);
    setErro(null);
    try {
      const r = await apiGet<CaixaTarefasResposta>(caminho(filtros), token);
      if (n === pedido.current) setResposta(r);
    } catch (e) {
      if (n === pedido.current) setErro((e as Error).message);
    } finally {
      if (n === pedido.current) setCarregando(false);
    }
  }, [filtros, token]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  const pastas = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of resposta?.listas ?? []) if (l.pastaId && l.pasta) m.set(l.pastaId, l.pasta);
    return [...m.entries()];
  }, [resposta]);

  const fecharBalao = useCallback((devolverFoco: boolean) => {
    const origem = origemDoBalao.current;
    origemDoBalao.current = null;
    setBalao(null);
    if (devolverFoco) origem?.focus();
  }, []);
  const alternarBalao = (t: CaixaMinhaTarefa, botao: HTMLElement) => {
    if (balao?.tarefa.id === t.id) {
      fecharBalao(false);
      return;
    }
    origemDoBalao.current = botao;
    setBalao({ tarefa: t, ancora: botao.getBoundingClientRect(), origem: botao });
  };
  const agora = resposta ? new Date(resposta.agora) : new Date();
  const fraseDeEstado = resposta ? fraseDoQuadro(resposta.estado) : null;
  const ver = (c: Coluna) => colunas.has(c);

  // Os ids de teste são únicos na página: a tabela e os cartões estão os dois
  // no DOM (um deles escondido por CSS), e um seletor que casasse com dois
  // elementos quebraria o roteiro do Playwright.
  const botaoDeComentarios = (t: CaixaMinhaTarefa, noCartao = false) => (
    <button
      type="button"
      data-testid={noCartao ? `caixa-comentarios-cartao-${t.id}` : `caixa-comentarios-${t.id}`}
      onClick={(e) => alternarBalao(t, e.currentTarget)}
      aria-haspopup="dialog"
      aria-expanded={balao?.tarefa.id === t.id}
      aria-label={`${t.comentarios} comentário(s) em ${t.titulo}`}
      className={BOTAO_PEQUENO}
    >
      {t.comentarios} {t.comentarios === 1 ? 'comentário' : 'comentários'}
    </button>
  );

  const prazo = (t: CaixaMinhaTarefa) => (
    <span className={t.motivos.includes('prazo_vencido') ? 'text-bad' : ''}>{dia(t.prazo)}</span>
  );

  return (
    <div className="space-y-3">
      {/* -------------------------------------------------------- filtros */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Lista ou pasta</span>
          <select
            data-testid="caixa-filtro-lista"
            value={filtros.lista}
            onChange={(e) => setFiltros((f) => ({ ...f, lista: e.target.value }))}
            className={SELECT}
          >
            <option value="">Todas</option>
            {pastas.length > 0 && (
              <optgroup label="Pastas">
                {pastas.map(([id, nome]) => (
                  <option key={id} value={`pasta:${id}`}>
                    {nome}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Listas">
              {(resposta?.listas ?? []).map((l) => (
                <option key={l.id} value={`lista:${l.id}`}>
                  {l.pasta ? `${l.pasta} / ${l.nome}` : l.nome}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Status</span>
          <select
            data-testid="caixa-filtro-status"
            value={filtros.status}
            onChange={(e) => setFiltros((f) => ({ ...f, status: e.target.value }))}
            className={SELECT}
          >
            <option value="">Abertos</option>
            {(resposta?.status ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Vencimento</span>
          <select
            data-testid="caixa-filtro-vencimento"
            value={filtros.vencimento}
            onChange={(e) =>
              setFiltros((f) => ({ ...f, vencimento: e.target.value as Filtros['vencimento'] }))
            }
            className={SELECT}
          >
            <option value="">Qualquer</option>
            {(Object.keys(ROTULO_DO_VENCIMENTO) as CaixaFiltroDeVencimento[]).map((v) => (
              <option key={v} value={v}>
                {ROTULO_DO_VENCIMENTO[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Responsável</span>
          <select
            data-testid="caixa-filtro-responsavel"
            value={filtros.responsavel}
            onChange={(e) =>
              setFiltros((f) => ({ ...f, responsavel: e.target.value as Filtros['responsavel'] }))
            }
            className={SELECT}
          >
            <option value="eu">Eu</option>
            <option value="qualquer">Qualquer pessoa</option>
          </select>
        </label>
        <details className="relative ml-auto">
          <summary className={`${BOTAO_PEQUENO} cursor-pointer list-none`} data-testid="caixa-colunas">
            Colunas
          </summary>
          <fieldset className={`${CARTAO} absolute right-0 z-20 mt-1 w-48 space-y-1 p-3`}>
            <legend className="sr-only">Colunas visíveis</legend>
            {COLUNAS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-[12.5px] max-md:min-h-[40px]">
                <input
                  type="checkbox"
                  data-testid={`caixa-coluna-${c}`}
                  checked={colunas.has(c)}
                  onChange={() => alternarColuna(c)}
                  className={FOCO}
                />
                {ROTULO_DA_COLUNA[c]}
              </label>
            ))}
          </fieldset>
        </details>
      </div>

      {/* ---------------------------------------------------------- lista */}
      {erro ? (
        <ErroComRetentativa mensagem={erro} onTentar={() => void buscar()} />
      ) : carregando && !resposta ? (
        <Carregando texto="Lendo as suas tarefas..." />
      ) : fraseDeEstado ? (
        <Vazio>{fraseDeEstado}</Vazio>
      ) : !resposta || resposta.itens.length === 0 ? (
        <Vazio>
          {filtros.lista || filtros.status || filtros.vencimento
            ? 'Nenhuma tarefa com estes filtros.'
            : 'Nenhuma tarefa aberta com você como responsável.'}
        </Vazio>
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className={`${CARTAO} hidden overflow-x-auto md:block`}>
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={`${ROTULO} px-3 py-2 font-normal`}>
                    Nome
                  </th>
                  {COLUNAS.filter(ver).map((c) => (
                    <th key={c} scope="col" className={`${ROTULO} px-3 py-2 font-normal`}>
                      {ROTULO_DA_COLUNA[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resposta.itens.map((t) => (
                  <tr key={t.id} data-testid={`caixa-tarefa-${t.id}`} onClick={() => popup.abrir(t.id)} className="cursor-pointer align-top hover:bg-surface-2">
                    <td className="max-w-[320px] px-3 py-2">
                      <a
                        href={`?aba=tarefas&tarefa=${encodeURIComponent(t.id)}`}
                        onClick={(e) => { e.stopPropagation(); abrirNoClique(t.id)(e); }}
                        className={`break-words font-medium text-text hover:text-brand hover:underline ${FOCO}`}
                      >
                        {t.titulo}
                      </a>
                      {t.motivos.length > 0 && (
                        <span className="mt-0.5 block text-[11px] text-warn">
                          {t.motivos.map((m) => FRASE_DO_MOTIVO[m]).join(' · ')}
                        </span>
                      )}
                    </td>
                    {ver('lista') && (
                      <td className="px-3 py-2 text-muted">
                        {t.pasta ? <span className="text-dim">{t.pasta} / </span> : null}
                        {t.lista}
                      </td>
                    )}
                    {ver('status') && (
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: t.statusCor }}
                          />
                          {t.status}
                        </span>
                      </td>
                    )}
                    {ver('vencimento') && <td className="whitespace-nowrap px-3 py-2">{prazo(t)}</td>}
                    {ver('responsaveis') && (
                      <td className="px-3 py-2 text-muted">{t.responsavel ?? 'ninguém'}</td>
                    )}
                    {ver('comentarios') && <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>{botaoDeComentarios(t)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: cartões */}
          <ul className="space-y-2 md:hidden">
            {resposta.itens.map((t) => (
              <li key={t.id} data-testid={`caixa-tarefa-cartao-${t.id}`} className={`${CARTAO} relative space-y-1.5 p-3`}>
                <a
                  href={`?aba=tarefas&tarefa=${encodeURIComponent(t.id)}`}
                  onClick={abrirNoClique(t.id)}
                  className={`block break-words text-[13px] font-medium text-text after:absolute after:inset-0 after:content-[''] hover:text-brand ${FOCO}`}
                >
                  {t.titulo}
                </a>
                {t.motivos.length > 0 && (
                  <p className="text-[11px] text-warn">{t.motivos.map((m) => FRASE_DO_MOTIVO[m]).join(' · ')}</p>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                  {ver('lista') && (
                    <>
                      <dt className="text-muted">Lista</dt>
                      <dd className="break-words">{t.pasta ? `${t.pasta} / ${t.lista}` : t.lista}</dd>
                    </>
                  )}
                  {ver('status') && (
                    <>
                      <dt className="text-muted">Status</dt>
                      <dd>{t.status}</dd>
                    </>
                  )}
                  {ver('vencimento') && (
                    <>
                      <dt className="text-muted">Vencimento</dt>
                      <dd>{prazo(t)}</dd>
                    </>
                  )}
                  {ver('responsaveis') && (
                    <>
                      <dt className="text-muted">Responsáveis</dt>
                      <dd className="break-words">{t.responsavel ?? 'ninguém'}</dd>
                    </>
                  )}
                </dl>
                {ver('comentarios') && <div className="relative z-10">{botaoDeComentarios(t, true)}</div>}
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted">
            {resposta.itens.length} tarefa(s)
            {resposta.truncado && `, mostrando as ${resposta.teto} primeiras pelo prazo. Use os filtros para achar o resto`}
            . Atualizado {haQuanto(resposta.agora, agora)}.
          </p>
        </>
      )}

      {balao && token && (
        <BalaoDeComentarios tarefa={balao.tarefa} token={token} ancora={balao.ancora} origem={balao.origem} onFechar={fecharBalao} />
      )}
      <TarefaFlutuante tarefa={popup} onMudou={() => void buscar()} />
    </div>
  );
}
