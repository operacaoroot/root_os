'use client';

import { useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { apiDelete, apiPost } from '@/lib/api';
import type { BioPageDetalhe } from './tipos';
import { Botao, Campo, Card, Chip, inputCls, Kpi, StatusConta } from './ui';

const iso = (d: string) => d.slice(0, 10);

export function AbaDesafio({
  detalhe,
  token,
  editavel,
  onMudou,
  onErro,
}: {
  detalhe: BioPageDetalhe;
  token: string | null;
  editavel: boolean;
  onMudou: () => void;
  onErro: (m: string) => void;
}) {
  const { page, desafio } = detalhe;
  const [titulo, setTitulo] = useState(desafio?.titulo ?? '1000 posts');
  const [inicio, setInicio] = useState(desafio ? iso(desafio.inicio) : '');
  const [fim, setFim] = useState(desafio ? iso(desafio.fim) : '');
  const [meta, setMeta] = useState(String(desafio?.meta ?? 1000));
  const [exibir, setExibir] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);

  const [plataforma, setPlataforma] = useState<'instagram' | 'tiktok'>('instagram');
  const [contaHandle, setContaHandle] = useState('');

  const chamar = (p: Promise<unknown>) => p.then(onMudou).catch((e: Error) => onErro(e.message));

  const salvar = () =>
    chamar(
      apiPost(
        '/bio/challenge',
        {
          ...(desafio ? { id: desafio.id } : {}),
          pageId: page.id,
          titulo,
          inicio,
          fim,
          metaPosts: Number(meta),
          exibir,
        },
        token,
      ),
    );

  const sincronizar = () => {
    setSincronizando(true);
    apiPost('/bio/challenge/sync', {}, token)
      .then(onMudou)
      .catch((e: Error) => onErro(e.message))
      .finally(() => setSincronizando(false));
  };

  return (
    <div className="space-y-5">
      {desafio && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Publicados" valor={desafio.contagem} />
          <Kpi label="Meta" valor={desafio.meta} />
          <Kpi label="Dia" valor={`${desafio.diaAtual}/${desafio.diasTotais}`} />
          <Kpi
            label={desafio.saldo >= 0 ? 'Adiantado' : 'Atrás do ritmo'}
            valor={Math.abs(desafio.saldo)}
            sufixo={desafio.diasRestantes > 0 ? ` · ${desafio.porDia}/dia` : undefined}
          />
        </div>
      )}

      <Card
        titulo="Configuração"
        acao={editavel && <Botao tone="brand" onClick={salvar}>Salvar</Botao>}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo label="Título">
            <input className={inputCls} value={titulo} disabled={!editavel} onChange={(e) => setTitulo(e.target.value)} />
          </Campo>
          <Campo label="Início">
            <input type="date" className={inputCls} value={inicio} disabled={!editavel} onChange={(e) => setInicio(e.target.value)} />
          </Campo>
          <Campo label="Fim">
            <input type="date" className={inputCls} value={fim} disabled={!editavel} onChange={(e) => setFim(e.target.value)} />
          </Campo>
          <Campo label="Meta de posts">
            <input type="number" className={inputCls} value={meta} disabled={!editavel} onChange={(e) => setMeta(e.target.value)} />
          </Campo>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={exibir} disabled={!editavel} onChange={(e) => setExibir(e.target.checked)} />
          Exibir o contador na página pública
        </label>
      </Card>

      <Card
        titulo="Contas monitoradas"
        acao={
          editavel && (
            <Botao onClick={sincronizar} disabled={sincronizando}>
              <span className="flex items-center gap-1.5">
                <RefreshCw size={13} className={sincronizando ? 'animate-spin' : ''} />
                {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
              </span>
            </Botao>
          )
        }
      >
        <div className="space-y-2">
          {desafio?.contas.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">@{c.handle}</span>
                <Chip>{c.plataforma}</Chip>
                <Chip tone={c.modo === 'conectado' ? 'brand' : 'muted'}>{c.modo}</Chip>
                <StatusConta status={c.status} />
                <span className="ml-auto text-sm font-semibold">{c.contagem}</span>
                {editavel && (
                  <button
                    type="button"
                    title="Remover conta"
                    onClick={() => chamar(apiDelete(`/bio/challenge/accounts/${c.id}`, token))}
                    className="text-muted hover:text-bad"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {c.ultimoErro && <p className="mt-1 text-[11px] text-bad">{c.ultimoErro}</p>}
              {editavel && c.modo === 'manual' && (
                <ContagemManual
                  onEnviar={(n) =>
                    chamar(
                      apiPost(`/bio/challenge/accounts/${c.id}/manual-count`, { contagem: n }, token),
                    )
                  }
                />
              )}
            </div>
          ))}
          {!desafio?.contas.length && (
            <p className="text-xs text-muted">
              {desafio ? 'Nenhuma conta monitorada ainda.' : 'Salve o desafio primeiro.'}
            </p>
          )}
        </div>

        {editavel && desafio && (
          <div className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-[150px_1fr_auto]">
            <select
              className={inputCls}
              value={plataforma}
              onChange={(e) => setPlataforma(e.target.value as 'instagram' | 'tiktok')}
            >
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
            </select>
            <input
              className={inputCls}
              placeholder="@ da conta"
              value={contaHandle}
              onChange={(e) => setContaHandle(e.target.value)}
            />
            <Botao
              onClick={() => {
                if (!contaHandle.trim()) return;
                chamar(
                  apiPost(
                    '/bio/challenge/accounts',
                    { challengeId: desafio.id, plataforma, handle: contaHandle.trim(), modo: 'manual' },
                    token,
                  ),
                ).then(() => setContaHandle(''));
              }}
            >
              Adicionar
            </Botao>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Contagem manual entra como snapshot: append-only, nunca sobrescreve o anterior. */
function ContagemManual({ onEnviar }: { onEnviar: (n: number) => void }) {
  const [valor, setValor] = useState('');
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="number"
        className="w-28 rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand-dim"
        placeholder="contagem"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          const n = Number(valor);
          if (Number.isFinite(n) && n >= 0) {
            onEnviar(n);
            setValor('');
          }
        }}
        className="text-[11px] text-brand hover:underline"
      >
        lançar
      </button>
    </div>
  );
}
