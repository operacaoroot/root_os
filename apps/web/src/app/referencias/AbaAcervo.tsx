'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Search, Star } from 'lucide-react';
import {
  PAUTA_FAMILIA_LABEL,
  PAUTA_OBJETIVO_LABEL,
  type PautaFamilia,
  type PautaObjetivo,
  type PautaReferenciaItem,
  type PautaReferenciaList,
} from '@mktos/shared';
import { apiDelete, apiGet, apiPatch } from '@/lib/api';
import { Botao, Card, Chip, Kpi, inputCls } from './ui';

interface Props {
  token: string | null;
  editavel: boolean;
  onErro: (m: string | null) => void;
  bump: number;
  onMudou: () => void;
}

// Os 14 campos da ficha, na ordem em que o método os lê.
const CAMPOS: Array<{ k: keyof PautaReferenciaItem; label: string }> = [
  { k: 'materiaPrima', label: 'Matéria-prima' },
  { k: 'tensaoCentral', label: 'Tensão central' },
  { k: 'emocaoAlvo', label: 'Emoção-alvo do 1º segundo' },
  { k: 'motorPsicologico', label: 'Motor psicológico' },
  { k: 'formulaHeadline', label: 'Fórmula da headline/gancho' },
  { k: 'estruturaCorpo', label: 'Estrutura do corpo' },
  { k: 'prova', label: 'Prova' },
  { k: 'cta', label: 'CTA' },
  { k: 'preRequisitos', label: 'Pré-requisitos do criador' },
  { k: 'antiPadroes', label: 'Anti-padrões' },
  { k: 'teoriaImplicita', label: 'Teoria implícita' },
];

export function AbaAcervo({ token, editavel, onErro, bump, onMudou }: Props) {
  const [data, setData] = useState<PautaReferenciaList | null>(null);
  const [familia, setFamilia] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [soCampeas, setSoCampeas] = useState(false);
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const p = new URLSearchParams();
    if (familia) p.set('familia', familia);
    if (objetivo) p.set('objetivo', objetivo);
    if (soCampeas) p.set('campea', 'true');
    if (q) p.set('q', q);
    apiGet<PautaReferenciaList>(`/pauta/referencias${p.toString() ? `?${p}` : ''}`, token)
      .then(setData)
      .catch((e: Error) => onErro(e.message));
  }, [token, familia, objetivo, soCampeas, q, bump, onErro]);

  const marcarCampea = async (r: PautaReferenciaItem) => {
    onErro(null);
    try {
      await apiPatch(`/pauta/referencias/${r.id}`, { campea: !r.campea }, token);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const remover = async (id: string) => {
    onErro(null);
    try {
      await apiDelete(`/pauta/referencias/${id}`, token);
      setAberta(null);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Fichas no acervo" valor={data?.total ?? 0} />
        <Kpi label="Campeãs" valor={data?.campeas ?? 0} />
        <Kpi
          label="Família mais frequente"
          valor={
            data?.porFamilia.length
              ? [...data.porFamilia].sort((a, b) => b.count - a.count)[0].key
              : '—'
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className={`${inputCls} w-64 pl-8`}
            placeholder="Busca semântica ou por texto…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setQ(busca.trim())}
          />
        </div>
        <Botao onClick={() => setQ(busca.trim())}>Buscar</Botao>

        <select
          className={`${inputCls} w-auto`}
          value={familia}
          onChange={(e) => setFamilia(e.target.value)}
        >
          <option value="">Todas as famílias</option>
          {(Object.keys(PAUTA_FAMILIA_LABEL) as PautaFamilia[]).map((f) => (
            <option key={f} value={f}>
              {f} — {PAUTA_FAMILIA_LABEL[f]}
            </option>
          ))}
        </select>

        <select
          className={`${inputCls} w-auto`}
          value={objetivo}
          onChange={(e) => setObjetivo(e.target.value)}
        >
          <option value="">Todos os objetivos</option>
          {(Object.keys(PAUTA_OBJETIVO_LABEL) as PautaObjetivo[]).map((o) => (
            <option key={o} value={o}>
              {o} — {PAUTA_OBJETIVO_LABEL[o]}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={soCampeas}
            onChange={(e) => setSoCampeas(e.target.checked)}
          />
          só campeãs
        </label>

        {data?.source.tool === 'busca-semantica' && <Chip tone="brand">busca semântica</Chip>}
        {data && data.items.length < data.total && (
          <span className="text-xs text-muted">
            mostrando {data.items.length} de {data.total} — refine o filtro para ver o resto
          </span>
        )}
      </div>

      {data && data.items.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Nenhuma ficha ainda. Processe uma captura na aba Fila, ou rode o importador do acervo
            do vault (<code className="text-xs">pnpm --filter @mktos/api import:pauta</code>).
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {data?.items.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-surface">
            <button
              onClick={() => setAberta(aberta === r.id ? null : r.id)}
              className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="brand">{r.familia}</Chip>
                  <Chip>{r.objetivo}</Chip>
                  {r.campea && <Chip tone="good">campeã</Chip>}
                  {r.plataforma && <Chip>{r.plataforma}</Chip>}
                  {r.autor && <Chip>{r.autor}</Chip>}
                  {r.similaridade !== undefined && (
                    <Chip tone="warn">{Math.round(r.similaridade * 100)}%</Chip>
                  )}
                </div>
                <p className="mt-1 truncate text-sm">{r.titulo}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted">{r.formulaHeadline}</p>
              </div>
            </button>

            {aberta === r.id && (
              <div className="border-t border-border px-4 py-3">
                <dl className="space-y-2">
                  {CAMPOS.map(({ k, label }) => {
                    const v = r[k];
                    if (!v || typeof v !== 'string') return null;
                    return (
                      <div key={String(k)} className="grid gap-1 sm:grid-cols-[200px_1fr]">
                        <dt className="text-xs text-muted">{label}</dt>
                        <dd className="text-sm">{v}</dd>
                      </div>
                    );
                  })}
                  {r.metricas && (
                    <div className="grid gap-1 sm:grid-cols-[200px_1fr]">
                      <dt className="text-xs text-muted">Métricas</dt>
                      <dd className="text-sm">
                        {Object.entries(r.metricas)
                          .map(([k, v]) => `${k}: ${Number(v).toLocaleString('pt-BR')}`)
                          .join(' · ')}
                      </dd>
                    </div>
                  )}
                  {r.vaultPath && (
                    <div className="grid gap-1 sm:grid-cols-[200px_1fr]">
                      <dt className="text-xs text-muted">Espelho</dt>
                      <dd className="text-xs text-muted">{r.vaultPath}</dd>
                    </div>
                  )}
                </dl>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <Botao onClick={() => marcarCampea(r)} disabled={!editavel}>
                    <span className="flex items-center gap-1.5">
                      <Star size={13} className={r.campea ? 'fill-current text-good' : ''} />
                      {r.campea ? 'Tirar de campeã' : 'Marcar campeã'}
                    </span>
                  </Botao>
                  {r.url && (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-text"
                    >
                      <ExternalLink size={13} /> Original
                    </a>
                  )}
                  <Botao tone="bad" onClick={() => remover(r.id)} disabled={!editavel}>
                    Remover
                  </Botao>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
