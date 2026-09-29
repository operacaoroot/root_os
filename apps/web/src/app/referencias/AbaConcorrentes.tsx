'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PAUTA_METRICAS_DO_CONCORRENTE,
  type PautaAnaliseDoConcorrente,
  type PautaDossieDoConcorrente,
  type PautaFaixaDoIndice,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { Botao, Card, Chip } from './ui';

interface Props {
  token: string | null;
  editavel: boolean;
  onErro: (m: string | null) => void;
  bump: number;
}

interface NaLista {
  id: string;
  nome: string;
  handle: string;
  plataforma: string;
  ativo: boolean;
  posts: number;
}

type Analise = PautaAnaliseDoConcorrente & { dossie: PautaDossieDoConcorrente | null };

/*
 * MK2 na tela. O que esta aba mostra é o ÍNDICE, não o número grande: cada post
 * contra a mediana do próprio perfil. É por isso que a coluna que importa é a
 * do índice e não a de visualizações — número absoluto de perfil grande não diz
 * nada sobre o que a gente consegue fazer.
 */

const ROTULO_DA_FAIXA: Record<PautaFaixaDoIndice, string> = {
  estourou: 'estourou',
  acima: 'acima da média dele',
  'na-media': 'na média dele',
  abaixo: 'abaixo',
};

const TOM_DA_FAIXA: Record<PautaFaixaDoIndice, 'brand' | 'good' | 'warn' | 'muted'> = {
  estourou: 'brand',
  acima: 'good',
  'na-media': 'muted',
  abaixo: 'warn',
};

const ROTULO_DA_METRICA: Record<(typeof PAUTA_METRICAS_DO_CONCORRENTE)[number], string> = {
  visualizacoes: 'visualizações',
  curtidas: 'curtidas',
  comentarios: 'comentários',
  compartilhamentos: 'compartilhamentos',
};

const numero = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR'));

export function AbaConcorrentes({ token, editavel, onErro, bump }: Props) {
  const [lista, setLista] = useState<NaLista[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiGet<NaLista[]>('/pauta/concorrentes', token).then(setLista).catch((e: Error) => onErro(e.message));
  }, [token, bump, onErro]);

  const abrir = useCallback(
    async (id: string) => {
      setAberto(id);
      setAnalise(null);
      onErro(null);
      try {
        setAnalise(await apiGet<Analise>(`/pauta/concorrentes/${id}`, token));
      } catch (e) {
        onErro((e as Error).message);
      }
    },
    [token, onErro],
  );

  async function gerarDossie(id: string) {
    setOcupado(id);
    onErro(null);
    try {
      const d = await apiPost<PautaDossieDoConcorrente>(`/pauta/concorrentes/${id}/dossie`, {}, token);
      setAnalise((a) => (a ? { ...a, dossie: d } : a));
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  if (!lista) return <Card titulo="Concorrentes">Carregando…</Card>;

  if (!lista.length) {
    return (
      <Card titulo="Concorrentes">
        <p className="text-muted">
          Nenhum perfil cadastrado ainda. Cadastre um perfil na aba <strong>Radar</strong> e rode a
          coleta: é dela que saem os posts que viram número aqui.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card titulo="Perfis observados">
        <div className="flex flex-col gap-2">
          {lista.map((f) => (
            <button
              key={f.id}
              onClick={() => abrir(f.id)}
              className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
                aberto === f.id ? 'border-brand-dim' : 'border-border hover:border-brand-dim'
              }`}
            >
              <span className="font-medium">{f.nome}</span>
              <span className="font-os-mono text-xs text-muted">
                @{f.handle} · {f.plataforma}
              </span>
              <span className="ml-auto font-os-mono text-xs tabular-nums text-muted">
                {f.posts} post{f.posts === 1 ? '' : 's'}
              </span>
              {!f.ativo && <Chip tone="warn">pausado</Chip>}
            </button>
          ))}
        </div>
      </Card>

      {aberto && !analise && <Card titulo="Análise">Lendo os posts…</Card>}

      {analise && (
        <>
          <Card titulo={`@${analise.handle}`}>
            {analise.avisos.map((a) => (
              <p key={a} className="mb-2 text-sm text-muted">
                {a}
              </p>
            ))}
            {analise.medivel && (
              <>
                <p className="mb-3 text-sm text-muted">
                  Cada post abaixo é medido contra a mediana deste perfil — não contra a nossa, nem
                  contra outro perfil. Índice 2 quer dizer o dobro do que ele costuma fazer.
                </p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {PAUTA_METRICAS_DO_CONCORRENTE.map((m) => (
                    <div key={m}>
                      <div className="font-os-mono text-xs uppercase tracking-wide text-muted">
                        mediana · {ROTULO_DA_METRICA[m]}
                        {analise.metricaDeReferencia === m ? ' (a régua)' : ''}
                      </div>
                      <div className="font-os-mono text-lg tabular-nums">{numero(analise.medianas[m])}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card titulo="Os posts, do que mais rendeu para o que menos">
            <div className="flex flex-col gap-2">
              {analise.posts.map((p) => {
                const ref = analise.metricaDeReferencia;
                const ind = ref ? p.indices[ref] : null;
                return (
                  <div key={p.capturaId} className="flex flex-wrap items-center gap-2 border-b border-os-line py-2">
                    <span className="font-os-mono text-sm tabular-nums" style={{ minWidth: '4rem' }}>
                      {ind === null ? '—' : `${ind.toFixed(2)}×`}
                    </span>
                    {p.faixa && <Chip tone={TOM_DA_FAIXA[p.faixa]}>{ROTULO_DA_FAIXA[p.faixa]}</Chip>}
                    <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline">
                      {p.titulo || p.url}
                    </a>
                    <span className="font-os-mono text-xs tabular-nums text-muted">
                      {numero(p.metricas.visualizacoes)} vis · {numero(p.metricas.curtidas)} curt
                      {p.metricas.duracaoSeg !== null ? ` · ${p.metricas.duracaoSeg}s` : ''}
                    </span>
                    <span className="font-os-mono text-xs text-muted">
                      {p.publicadoEm ? p.publicadoEm.slice(0, 10) : 'sem data'}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card titulo="Dossiê">
            {analise.dossie ? (
              <div className="flex flex-col gap-3">
                <p>{analise.dossie.oQueRende}</p>
                {([
                  ['Como abrem', analise.dossie.aberturas],
                  ['Assuntos que se repetem', analise.dossie.assuntos],
                  ['O que pedem no fim', analise.dossie.ctas],
                  ['O que dá para aproveitar', analise.dossie.oQueAproveitar],
                ] as const).map(([titulo, itens]) =>
                  itens.length ? (
                    <div key={titulo}>
                      <div className="font-os-mono text-xs uppercase tracking-wide text-muted">{titulo}</div>
                      <ul className="ml-4 list-disc">
                        {itens.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )}
                <p className="font-os-mono text-xs text-muted">
                  gerado em {analise.dossie.geradoEm.slice(0, 10)} · modelo {analise.dossie.modelo}
                </p>
              </div>
            ) : (
              <p className="text-muted">
                Nenhum dossiê ainda. A IA lê os posts com o índice de cada um e escreve o que dá para
                aprender com este perfil.
              </p>
            )}
            {editavel && (
              <div className="mt-3">
                <Botao
                  tone="brand"
                  onClick={() => gerarDossie(analise.fonteId)}
                  disabled={ocupado === analise.fonteId || !analise.postsContados}
                >
                  {ocupado === analise.fonteId
                    ? 'A IA está lendo…'
                    : analise.dossie
                      ? 'Gerar de novo'
                      : 'Gerar dossiê'}
                </Botao>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
