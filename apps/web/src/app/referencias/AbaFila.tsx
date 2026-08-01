'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PautaCapturaList, PautaCapturaStatus } from '@mktos/shared';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { Botao, Card, Chip } from './ui';

interface Props {
  token: string | null;
  editavel: boolean;
  onErro: (m: string | null) => void;
  bump: number;
  onMudou: () => void;
}

const TOM: Record<PautaCapturaStatus, 'muted' | 'warn' | 'good' | 'bad'> = {
  rascunho: 'muted',
  processando: 'warn',
  ficha: 'good',
  descartada: 'muted',
  erro: 'bad',
};

export function AbaFila({ token, editavel, onErro, bump, onMudou }: Props) {
  const [data, setData] = useState<PautaCapturaList | null>(null);
  const [filtro, setFiltro] = useState<string>('rascunho');
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const q = filtro ? `?status=${filtro}` : '';
    apiGet<PautaCapturaList>(`/pauta/capturas${q}`, token)
      .then(setData)
      .catch((e: Error) => onErro(e.message));
  }, [token, filtro, bump, onErro]);

  const processar = async (id: string) => {
    onErro(null);
    setOcupado(id);
    try {
      await apiPost(`/pauta/capturas/${id}/processar`, {}, token);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
      onMudou(); // o status virou "erro" no banco — recarrega para mostrar
    } finally {
      setOcupado(null);
    }
  };

  const descartar = async (id: string) => {
    onErro(null);
    try {
      await apiDelete(`/pauta/capturas/${id}`, token);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const total = data?.porStatus.reduce((s, p) => s + p.count, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFiltro('')}
          className={`rounded-lg border px-3 py-1.5 text-sm ${
            filtro === '' ? 'border-brand text-brand' : 'border-border text-muted hover:text-text'
          }`}
        >
          Todas ({total})
        </button>
        {(['rascunho', 'ficha', 'erro', 'descartada'] as PautaCapturaStatus[]).map((s) => {
          const n = data?.porStatus.find((p) => p.status === s)?.count ?? 0;
          return (
            <button
              key={s}
              onClick={() => setFiltro(s)}
              className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${
                filtro === s ? 'border-brand text-brand' : 'border-border text-muted hover:text-text'
              }`}
            >
              {s} ({n})
            </button>
          );
        })}
      </div>

      {data && data.items.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Nada aqui. Capture alguma coisa na aba Captura — ou ligue um perfil no Radar.
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {data?.items.map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={TOM[c.status]}>{c.status}</Chip>
                <Chip>{c.tipo}</Chip>
                {c.fonte && <Chip tone="brand">{c.fonte.nome}</Chip>}
                {c.custoUsd !== null && (
                  <Chip>
                    US$ {c.custoUsd.toFixed(4).replace('.', ',')}
                  </Chip>
                )}
              </div>
              <p className="mt-1 truncate text-sm">
                {c.titulo || c.url || '(sem título)'}
              </p>
              {c.erro && <p className="mt-0.5 text-xs text-bad">{c.erro}</p>}
              <p className="mt-0.5 text-[11px] text-muted">
                {new Date(c.capturadoEm).toLocaleString('pt-BR')}
                {c.imagens.length > 0 && ` · ${c.imagens.length} imagem(ns)`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {c.url && (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted hover:text-text"
                  title="Abrir original"
                >
                  <ExternalLink size={15} />
                </a>
              )}
              {!c.temFicha && c.status !== 'descartada' && (
                <Botao
                  tone="brand"
                  onClick={() => processar(c.id)}
                  disabled={!editavel || ocupado === c.id}
                >
                  {ocupado === c.id ? 'Processando…' : 'Virar ficha'}
                </Botao>
              )}
              {c.temFicha && <Chip tone="good">ficha pronta</Chip>}
              {c.status !== 'descartada' && (
                <Botao tone="ghost" onClick={() => descartar(c.id)} disabled={!editavel}>
                  Descartar
                </Botao>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
