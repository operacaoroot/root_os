'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_FORMATO_DA_SEMANA_ROTULO,
  PAUTA_TETO_DA_CHAMADA_DO_STORY,
  PAUTA_TETO_DO_TEXTO_DO_SLIDE,
  PAUTA_TETO_DO_TEXTO_DO_STORY,
  PAUTA_TETO_DO_TITULO_DO_SLIDE,
  PautaPalavraChaveSchema,
  conferirTrechoDoCorte,
  diaNoFuso,
  horaNoFuso,
  motivoParaNaoDerivar,
  motivoParaNaoEditarASemana,
  tempoDoCapitulo,
  type PautaEpisodioDetalhe,
  type PautaEpisodioStatus,
  type PautaPecaDaSemana,
  type PautaPecaStatus,
  type PautaSemanaDePosts,
  type PautaSemanaGerada,
} from '@mktos/shared';
import { apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { Botao, Chip, inputCls } from '../referencias/ui';

/*
 * A SEMANA DE POSTS (MC15), dentro do detalhe da aba Episódios: por matéria,
 * um carrossel, um story e um corte vertical, com a prévia em texto (slides,
 * story, trecho do corte com os tempos), aprovar, descartar e editar. Nada é
 * publicado daqui — o Instagram é manual até a D-MC8. Os renders (PNG e mp4)
 * saem no Mac pela /root-midia. A peça aprovada vai para a agenda na aba
 * Semana (MC16), que mostra aqui o slot dela.
 */

interface Props {
  token: string | null;
  detalhe: PautaEpisodioDetalhe;
  editavel: boolean;
  /** Gerar gasta IA (uma chamada por matéria): exige `automacoes.executar`. */
  podeGastarIa: boolean;
  onErro: (m: string | null) => void;
  /** Gerar leva o episódio do Pacote à Derivação: a página relê o detalhe. */
  onMudou: () => void;
}

/** Só do Pacote em diante há semana para ler. */
const STATUS_COM_SEMANA: readonly PautaEpisodioStatus[] = ['pacote', 'derivacao', 'agendado', 'concluido'];

const TOM_DO_STATUS: Record<PautaPecaStatus, 'muted' | 'good' | 'brand' | 'bad'> = {
  rascunho: 'muted',
  aprovada: 'good',
  publicada: 'brand',
  descartada: 'bad',
};

const ROTULO_DO_STATUS: Record<PautaPecaStatus, string> = {
  rascunho: 'Rascunho',
  aprovada: 'Aprovada',
  publicada: 'Publicada',
  descartada: 'Descartada',
};

const tempo = (s: number | undefined) => (typeof s === 'number' ? tempoDoCapitulo(s) : '—');

/** O slot da semana (MC16), no relógio de São Paulo: `29/09 12:00`. */
function naAgenda(iso: string): string {
  const d = new Date(iso);
  const dia = diaNoFuso(d);
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)} ${horaNoFuso(d)}`;
}

function estadoDoRender(p: PautaPecaDaSemana, apelido: string): string {
  if (p.formato === 'corte') {
    if (p.video?.sha256) return `mp4 no OS (${Math.round(p.video.bytes / 1024 / 1024)} MB)`;
    if (p.video?.arquivo) return `mp4 só no Mac (${p.video.arquivo.split('/').pop()}) — /root-midia cortes ${apelido} sobe`;
    return `sem mp4 — /root-midia cortes ${apelido}`;
  }
  const esperadas = p.formato === 'story' ? 1 : (p.slides?.length ?? 0);
  if (!p.imagens.length) return `sem PNG — /root-midia ${p.formato === 'story' ? 'stories' : 'carrosseis'} ${apelido}`;
  const jpegs = p.jpegs?.length ?? 0;
  return `${p.imagens.length} de ${esperadas} PNG${jpegs < esperadas ? ` · ${jpegs} JPEG (a Meta só aceita JPEG)` : ''}`;
}

type Rascunho = {
  titulo: string;
  legenda: string;
  slides: Array<{ titulo: string; texto: string }>;
  palavraChave: string;
  texto: string;
  chamada: string;
  inicio: string;
  fim: string;
};

function rascunhoDe(p: PautaPecaDaSemana): Rascunho {
  return {
    titulo: p.titulo,
    legenda: p.corpo,
    // O último slide é o CTA da palavra: o sistema o refaz, não se edita à mão.
    slides: (p.slides ?? []).slice(0, -1).map((s) => ({ ...s })),
    palavraChave: p.palavraChave ?? '',
    texto: p.corpo,
    chamada: p.chamada ?? '',
    inicio: typeof p.inicio === 'number' ? String(p.inicio) : '',
    fim: typeof p.fim === 'number' ? String(p.fim) : '',
  };
}

function numero(v: string): number {
  return Number(v.replace(',', '.'));
}

const mesmoTempo = (a: number | undefined, b: number) => typeof a === 'number' && Math.abs(a - b) <= 0.01;

/**
 * O corpo do PUT com só os campos do formato. No corte, o trecho só vai quando
 * mudou: mandá-lo faz a API descartar o mp4 já renderizado.
 */
function corpoDaEdicao(p: PautaPecaDaSemana, r: Rascunho): Record<string, unknown> {
  if (p.formato === 'carrossel') {
    return { titulo: r.titulo, legenda: r.legenda, slides: r.slides, palavraChave: r.palavraChave.trim().toUpperCase() };
  }
  if (p.formato === 'story') return { titulo: r.titulo, texto: r.texto, chamada: r.chamada };
  const inicio = numero(r.inicio);
  const fim = numero(r.fim);
  const trechoIgual = mesmoTempo(p.inicio, inicio) && mesmoTempo(p.fim, fim);
  return { titulo: r.titulo, legenda: r.legenda, ...(trechoIgual ? {} : { inicio, fim }) };
}

function erroDaEdicao(p: PautaPecaDaSemana, r: Rascunho, duracaoSeg: number | null): string | null {
  if (!r.titulo.trim()) return 'O título não pode ficar vazio.';
  if (p.formato === 'carrossel') {
    if (!PautaPalavraChaveSchema.safeParse(r.palavraChave.trim().toUpperCase()).success) {
      return 'A palavra-chave tem de 3 a 20 letras ou números, sem acento nem espaço.';
    }
    if (r.slides.some((s) => !s.titulo.trim() && !s.texto.trim())) return 'Slide vazio: escreva o título ou o texto.';
    return null;
  }
  if (p.formato === 'story') {
    if (!r.texto.trim()) return 'O texto do story não pode ficar vazio.';
    if (!r.chamada.trim()) return 'A chamada não pode ficar vazia.';
    return null;
  }
  return conferirTrechoDoCorte(numero(r.inicio), numero(r.fim), duracaoSeg);
}

function PecaDaSemana({
  peca,
  apelido,
  duracaoSeg,
  editavel,
  textoTravado,
  semPaginaDeLinks,
  escrevendo,
  onStatus,
  onSalvar,
}: {
  peca: PautaPecaDaSemana;
  apelido: string;
  duracaoSeg: number | null;
  editavel: boolean;
  /** Depois de agendado, o texto é o que vai ao ar: sem Editar. */
  textoTravado: boolean;
  /** O story chama para o link da bio, e a página de links do episódio ainda não está no ar. */
  semPaginaDeLinks: boolean;
  escrevendo: boolean;
  onStatus: (p: PautaPecaDaSemana, status: PautaPecaStatus) => void;
  onSalvar: (p: PautaPecaDaSemana, corpo: Record<string, unknown>) => Promise<boolean>;
}) {
  const [edicao, setEdicao] = useState<Rascunho | null>(null);
  const rotulo = PAUTA_FORMATO_DA_SEMANA_ROTULO[peca.formato];
  const firme = peca.status === 'publicada';
  const erro = edicao ? erroDaEdicao(peca, edicao, duracaoSeg) : null;
  const muda = (parcial: Partial<Rascunho>) => setEdicao((r) => (r ? { ...r, ...parcial } : r));

  const salvar = async () => {
    if (!edicao || erro) return;
    if (await onSalvar(peca, corpoDaEdicao(peca, edicao))) setEdicao(null);
  };

  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border bg-surface-2 p-3" aria-label={rotulo}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-os-mono text-[11px] font-semibold uppercase tracking-wide text-muted">{rotulo}</span>
        <Chip tone={TOM_DO_STATUS[peca.status]}>{ROTULO_DO_STATUS[peca.status]}</Chip>
        {peca.palavraChave && <Chip tone="brand">{peca.palavraChave}</Chip>}
        {peca.agendadaPara && !peca.postada && <Chip>{`na agenda: ${naAgenda(peca.agendadaPara)}`}</Chip>}
        {peca.postada && <Chip>{`postada ${naAgenda(peca.postada.em)}${peca.postada.manual ? ' à mão' : ''}`}</Chip>}
      </div>
      <p className="break-words text-sm font-medium">{peca.titulo}</p>

      {peca.formato === 'carrossel' && (
        <ol className="list-decimal space-y-1 pl-5 text-xs" aria-label="Slides">
          {(peca.slides ?? []).map((s, i) => (
            <li key={i} className="break-words">
              <span className="font-medium">{s.titulo}</span>
              {s.texto && <span className="text-muted"> — {s.texto}</span>}
            </li>
          ))}
        </ol>
      )}
      {peca.formato === 'story' && (
        <div className="space-y-1 text-sm">
          <p className="break-words">{peca.corpo}</p>
          <p className="break-words text-xs text-muted">&gt; {peca.chamada}</p>
          {semPaginaDeLinks && (
            <p className="text-xs text-warn">A página de links do episódio ainda não está no ar: publique-a antes de postar o story.</p>
          )}
        </div>
      )}
      {peca.formato === 'corte' && (
        <div className="space-y-1 text-sm">
          <p className="font-mono text-xs" aria-label="Trecho do corte">
            {tempo(peca.inicio)} – {tempo(peca.fim)}
            {typeof peca.inicio === 'number' && typeof peca.fim === 'number' && ` (${Math.round(peca.fim - peca.inicio)} s)`}
          </p>
          {peca.trecho && <blockquote className="break-words border-l-2 border-border pl-2 text-xs text-muted">{peca.trecho}</blockquote>}
        </div>
      )}
      {peca.formato !== 'story' && peca.corpo && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Legenda</summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{peca.corpo}</p>
        </details>
      )}

      <p className="text-[11px] text-muted">{estadoDoRender(peca, apelido)}</p>
      {peca.transcricaoMudou && <p className="text-xs text-warn">A transcrição mudou depois desta peça: gere de novo.</p>}
      {peca.avisos.map((a) => (
        <p key={a} className="break-words text-xs text-warn">
          {a}
        </p>
      ))}

      {editavel && !firme && !edicao && peca.agendadaPara && (
        <p className="text-[11px] text-muted">
          {textoTravado ? 'Descartar' : 'Editar ou descartar'} tira a peça da agenda ({naAgenda(peca.agendadaPara)}); depois é distribuir de
          novo na aba Semana.
        </p>
      )}
      {editavel && !firme && !edicao && (
        <div className="flex flex-wrap gap-2">
          {peca.status === 'rascunho' && (
            <Botao tone="brand" onClick={() => onStatus(peca, 'aprovada')} disabled={escrevendo}>
              Aprovar
            </Botao>
          )}
          {peca.status === 'descartada' ? (
            <Botao onClick={() => onStatus(peca, 'rascunho')} disabled={escrevendo}>
              Recuperar
            </Botao>
          ) : (
            <>
              {!textoTravado && (
                <Botao onClick={() => setEdicao(rascunhoDe(peca))} disabled={escrevendo}>
                  Editar
                </Botao>
              )}
              <Botao tone="bad" onClick={() => onStatus(peca, 'descartada')} disabled={escrevendo}>
                Descartar
              </Botao>
            </>
          )}
        </div>
      )}

      {edicao && (
        <div className="space-y-2" aria-label={`Editar ${rotulo.toLowerCase()}`}>
          <label className="block text-xs">
            <span className="mb-1 block text-muted">Título</span>
            <input className={inputCls} value={edicao.titulo} maxLength={120} onChange={(e) => muda({ titulo: e.target.value })} />
          </label>
          {peca.formato === 'carrossel' && (
            <>
              {edicao.slides.map((s, i) => (
                <fieldset key={i} className="space-y-1 rounded border border-border p-2">
                  <legend className="px-1 text-[11px] text-muted">Slide {i + 1}</legend>
                  <input
                    className={inputCls}
                    aria-label={`Título do slide ${i + 1}`}
                    value={s.titulo}
                    maxLength={PAUTA_TETO_DO_TITULO_DO_SLIDE}
                    onChange={(e) => muda({ slides: edicao.slides.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)) })}
                  />
                  <textarea
                    className={inputCls}
                    aria-label={`Texto do slide ${i + 1}`}
                    rows={2}
                    value={s.texto}
                    maxLength={PAUTA_TETO_DO_TEXTO_DO_SLIDE}
                    onChange={(e) => muda({ slides: edicao.slides.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)) })}
                  />
                </fieldset>
              ))}
              <label className="block text-xs">
                <span className="mb-1 block text-muted">Palavra-chave do CTA (o último slide se refaz com ela)</span>
                <input className={inputCls} value={edicao.palavraChave} maxLength={20} onChange={(e) => muda({ palavraChave: e.target.value })} />
              </label>
            </>
          )}
          {peca.formato === 'story' && (
            <>
              <label className="block text-xs">
                <span className="mb-1 block text-muted">Texto do story</span>
                <textarea className={inputCls} rows={3} value={edicao.texto} maxLength={PAUTA_TETO_DO_TEXTO_DO_STORY} onChange={(e) => muda({ texto: e.target.value })} />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block text-muted">Chamada para o episódio</span>
                <input className={inputCls} value={edicao.chamada} maxLength={PAUTA_TETO_DA_CHAMADA_DO_STORY} onChange={(e) => muda({ chamada: e.target.value })} />
              </label>
            </>
          )}
          {peca.formato === 'corte' && (
            <div className="flex flex-wrap gap-2">
              <label className="min-w-0 flex-1 text-xs">
                <span className="mb-1 block text-muted">Início (s)</span>
                <input className={inputCls} inputMode="decimal" value={edicao.inicio} onChange={(e) => muda({ inicio: e.target.value })} />
              </label>
              <label className="min-w-0 flex-1 text-xs">
                <span className="mb-1 block text-muted">Fim (s)</span>
                <input className={inputCls} inputMode="decimal" value={edicao.fim} onChange={(e) => muda({ fim: e.target.value })} />
              </label>
            </div>
          )}
          {peca.formato !== 'story' && (
            <label className="block text-xs">
              <span className="mb-1 block text-muted">Legenda</span>
              <textarea className={inputCls} rows={4} value={edicao.legenda} onChange={(e) => muda({ legenda: e.target.value })} />
            </label>
          )}
          {erro && <p className="text-xs text-bad">{erro}</p>}
          <p className="text-[11px] text-muted">Salvar volta a peça para rascunho e descarta o render feito com o texto anterior.</p>
          <div className="flex flex-wrap gap-2">
            <Botao tone="brand" onClick={salvar} disabled={escrevendo || !!erro}>
              Salvar
            </Botao>
            <Botao tone="ghost" onClick={() => setEdicao(null)}>
              Cancelar
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}

export function SecaoSemana({ token, detalhe, editavel, podeGastarIa, onErro, onMudou }: Props) {
  const [semana, setSemana] = useState<PautaSemanaDePosts | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<Pick<PautaSemanaGerada, 'conta' | 'avisos'> | null>(null);

  const { id, apelido, status } = detalhe;
  const temSemana = STATUS_COM_SEMANA.includes(status);
  const motivo = motivoParaNaoDerivar(status, detalhe.transcricao.length, detalhe.itens.length);
  const travado = motivoParaNaoEditarASemana(status);
  const escrevendo = ocupado !== null;
  const semIa = !podeGastarIa ? 'Gerar gasta IA: precisa da permissão automacoes.executar.' : undefined;
  const temPecas = !!semana?.materias.some((m) => Object.keys(m.pecas).length > 0);

  const recarregar = useCallback(async () => {
    if (!token) return;
    setSemana(await apiGet<PautaSemanaDePosts>(`/pauta/episodios/${id}/semana`, token));
  }, [token, id]);

  useEffect(() => {
    setConfirmando(false);
    setResultado(null);
    setCarregado(false);
    if (!token || !temSemana) {
      setSemana(null);
      setCarregado(true);
      return;
    }
    let vivo = true;
    apiGet<PautaSemanaDePosts>(`/pauta/episodios/${id}/semana`, token)
      .then((s) => {
        if (vivo) setSemana(s);
      })
      .catch((e: Error) => {
        if (vivo) onErro(`A semana de posts não carregou: ${e.message}`);
      })
      .finally(() => {
        if (vivo) setCarregado(true);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, temSemana, detalhe.transcricao.length]);

  const gerar = async (substituir: boolean) => {
    setConfirmando(false);
    onErro(null);
    setOcupado('gerar');
    try {
      const r = await apiPost<PautaSemanaGerada>(`/pauta/episodios/${id}/semana/gerar`, { substituir }, token);
      setSemana(r);
      setResultado({ conta: r.conta, avisos: r.avisos });
      if (r.status !== status) onMudou();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const mudarStatus = async (p: PautaPecaDaSemana, novo: PautaPecaStatus) => {
    onErro(null);
    setOcupado(`status-${p.id}`);
    try {
      await apiPatch(`/pauta/pecas/${p.id}`, { status: novo }, token);
      await recarregar();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const salvar = async (p: PautaPecaDaSemana, corpo: Record<string, unknown>) => {
    onErro(null);
    setOcupado(`editar-${p.id}`);
    try {
      setSemana(await apiPut<PautaSemanaDePosts>(`/pauta/pecas/${p.id}/semana`, corpo, token));
      return true;
    } catch (e) {
      onErro((e as Error).message);
      return false;
    } finally {
      setOcupado(null);
    }
  };

  return (
    <section className="space-y-3" aria-label="Semana de posts">
      <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Semana de posts</h3>
      <p className="text-xs text-muted">
        Por matéria: um carrossel, um story e um corte vertical para revisar. Nada é publicado daqui — o Instagram
        segue manual (D-MC8). Os PNG e o mp4 saem no Mac: <span className="font-mono">/root-midia carrosseis|stories|cortes {apelido}</span>.
      </p>

      {motivo && !temPecas && carregado && <p className="text-sm text-muted">{motivo}</p>}
      {travado && temPecas && <p className="text-xs text-muted">{travado}</p>}

      {!motivo && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirmando && (
            <Botao
              tone={temPecas ? 'default' : 'brand'}
              onClick={() => (temPecas ? setConfirmando(true) : gerar(false))}
              disabled={!editavel || !podeGastarIa || escrevendo || !carregado}
              title={semIa}
            >
              {ocupado === 'gerar' ? 'Gerando…' : temPecas ? 'Gerar de novo' : 'Gerar a semana'}
            </Botao>
          )}
          {confirmando && (
            <>
              <span className="text-sm">Substituir os rascunhos? As peças aprovadas e publicadas ficam como estão.</span>
              <Botao tone="bad" onClick={() => gerar(true)} disabled={escrevendo}>
                Substituir
              </Botao>
              <Botao tone="ghost" onClick={() => setConfirmando(false)}>
                Cancelar
              </Botao>
            </>
          )}
          {semIa && <span className="text-xs text-muted">{semIa}</span>}
        </div>
      )}

      {resultado && (
        <div className="space-y-1 text-xs" aria-label="Resultado da geração">
          <p className="text-muted">
            {resultado.conta.criadas} nova(s) · {resultado.conta.substituidas} substituída(s) · {resultado.conta.mantidas} mantida(s)
            {resultado.conta.falharam > 0 ? ` · ${resultado.conta.falharam} não saíram` : ''}
          </p>
          {resultado.avisos.map((a) => (
            <p key={a} className="break-words text-warn">
              {a}
            </p>
          ))}
        </div>
      )}

      {semana && temPecas && (
        <div className="space-y-4">
          {semana.materias.map((m) => (
            <article key={m.itemId} className="space-y-2" aria-label={`Matéria ${m.n}`}>
              <div className="flex flex-wrap items-start gap-1.5 text-sm">
                <span className="font-mono text-xs text-muted">{m.n}.</span>
                {m.link ? (
                  <a href={m.link} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-start gap-1 break-words text-brand hover:underline">
                    <span className="break-words">{m.titulo}</span>
                    <ExternalLink size={12} className="mt-1 shrink-0" />
                  </a>
                ) : (
                  <span className="min-w-0 break-words">
                    {m.titulo} <span className="text-xs text-muted">(sem link público)</span>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {PAUTA_FORMATOS_DA_SEMANA.map((f) => {
                  const p = m.pecas[f];
                  return p ? (
                    <PecaDaSemana
                      key={f}
                      peca={p}
                      apelido={apelido}
                      duracaoSeg={semana.duracaoSeg}
                      editavel={editavel}
                      textoTravado={!!travado}
                      semPaginaDeLinks={!semana.paginaDeLinks}
                      escrevendo={escrevendo}
                      onStatus={mudarStatus}
                      onSalvar={salvar}
                    />
                  ) : (
                    <p key={f} className="rounded-lg border border-dashed border-border p-3 text-xs text-muted">
                      {PAUTA_FORMATO_DA_SEMANA_ROTULO[f]}: não saiu — gere de novo.
                    </p>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
