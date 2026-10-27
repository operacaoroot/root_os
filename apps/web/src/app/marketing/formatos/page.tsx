'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReguaDoFormato } from '@mktos/shared';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { btn, btnPrimario } from '@/components/maquina/pecas';

/*
 * Produção › FORMATOS, as réguas do ROOT Estúdio (26/10/2026). Cada formato tem
 * referências (link ou texto), a régua em tópicos e parâmetros. "Extrair régua"
 * lê as referências e propõe a régua (você revisa e salva). O "Gerar com a régua"
 * do post segue o que está salvo aqui.
 */

const campo = 'w-full rounded border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-brand';

export default function FormatosPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [reguas, setReguas] = useState<ReguaDoFormato[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      setReguas(await apiGet<ReguaDoFormato[]>('/marketing/estudio/formatos', token));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token]);
  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  if (ready && !can('pauta.ver')) return <p className="text-muted">Acesso insuficiente para Marketing.</p>;
  if (!reguas) return erro ? <p className="text-bad">{erro}</p> : <p className="text-muted">Carregando…</p>;

  return (
    <div className="com-tema space-y-4">
      <p className="text-sm text-muted">A régua de cada formato é o que a IA segue ao escrever um post e ao montar os cards da triagem.</p>
      {aviso && (
        <p role="status" className="rounded border border-brand-dim bg-brand/5 px-3 py-2 text-sm">
          {aviso}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {erro}
        </p>
      )}
      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        {reguas.map((r) => (
          <BlocoDoFormato
            key={r.formato}
            regua={r}
            editavel={editavel}
            token={token}
            onSalvo={(nova) => setReguas((a) => a!.map((x) => (x.formato === nova.formato ? nova : x)))}
            setErro={setErro}
            setAviso={setAviso}
            extra={
              r.formato === 'Comunidade Wpp' && editavel ? (
                <button
                  className={btn}
                  disabled={importando}
                  onClick={async () => {
                    setImportando(true);
                    try {
                      const x = await apiPost<{ lidos: number; criados: number; jaExistiam: number; ignorados: number }>('/marketing/estudio/comunidade/importar', {}, token);
                      setAviso(`Pasta semanas: ${x.lidos} arquivos, ${x.criados} posts novos no Banco, ${x.jaExistiam} já estavam lá${x.ignorados ? `, ${x.ignorados} não são peça` : ''}.`);
                    } catch (e) {
                      setErro((e as Error).message);
                    } finally {
                      setImportando(false);
                    }
                  }}
                >
                  {importando ? 'Importando…' : 'Trazer da pasta semanas'}
                </button>
              ) : null
            }
          />
        ))}
      </div>
    </div>
  );
}

function BlocoDoFormato(props: {
  regua: ReguaDoFormato;
  editavel: boolean;
  token: string | null;
  onSalvo: (r: ReguaDoFormato) => void;
  setErro: (s: string | null) => void;
  setAviso: (s: string | null) => void;
  extra: React.ReactNode;
}) {
  const r = props.regua;
  const [regras, setRegras] = useState(r.regras);
  const [params, setParams] = useState(() => Object.entries(r.params).map(([k, v]) => `${k}: ${v}`).join('\n'));
  const [ref, setRef] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const caminho = `/marketing/estudio/formatos/${encodeURIComponent(r.formato)}`;
  const mudou = regras !== r.regras || params !== Object.entries(r.params).map(([k, v]) => `${k}: ${v}`).join('\n');

  const agir = async (qual: string, fn: () => Promise<void>) => {
    setOcupado(qual);
    props.setErro(null);
    try {
      await fn();
    } catch (e) {
      props.setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };
  const lerParams = () =>
    Object.fromEntries(
      params
        .split(/\r?\n/)
        .map((l) => /^\s*([\w-]+)\s*:\s*(.*)$/.exec(l))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => [m[1], /^-?\d+(\.\d+)?$/.test(m[2].trim()) ? Number(m[2]) : m[2].trim()]),
    );

  return (
    <section className="space-y-3 rounded border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{r.formato}</h2>
        <div className="flex flex-wrap gap-2">{props.extra}</div>
      </div>

      <div>
        <h3 className="com-rotulo mb-1">Referências ({r.referencias.length})</h3>
        {r.referencias.length === 0 && <p className="text-sm text-muted">Nenhuma ainda. Cole um link de post que você quer imitar, ou um texto.</p>}
        <ul className="space-y-1 text-sm">
          {r.referencias.map((x) => (
            <li key={x.id} className="flex items-start gap-2">
              <span className="min-w-0 flex-1 truncate">
                {x.tipo === 'link' ? (
                  <a href={x.url} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                    {x.url}
                  </a>
                ) : (
                  <span className="text-muted">{x.texto?.slice(0, 120)}</span>
                )}
              </span>
              {props.editavel && (
                <button
                  className="text-dim hover:text-bad"
                  aria-label="Tirar referência"
                  onClick={() => void agir('tirar', async () => props.onSalvo(await apiDelete<ReguaDoFormato>(`${caminho}/referencias/${x.id}`, props.token)))}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {props.editavel && (
          <div className="mt-2 flex gap-2">
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Link ou texto de referência" className={campo} />
            <button
              className={btn}
              disabled={!ref.trim() || !!ocupado}
              onClick={() =>
                void agir('ref', async () => {
                  const v = ref.trim();
                  props.onSalvo(await apiPost<ReguaDoFormato>(`${caminho}/referencias`, /^https?:\/\//i.test(v) ? { url: v } : { texto: v }, props.token));
                  setRef('');
                })
              }
            >
              Adicionar
            </button>
          </div>
        )}
      </div>

      <label className="block">
        <span className="com-rotulo mb-1 block">Régua</span>
        <textarea rows={8} value={regras} onChange={(e) => setRegras(e.target.value)} readOnly={!props.editavel} className={campo} />
      </label>
      <label className="block">
        <span className="com-rotulo mb-1 block">Parâmetros (um por linha, chave: valor)</span>
        <textarea rows={4} value={params} onChange={(e) => setParams(e.target.value)} readOnly={!props.editavel} className={`${campo} font-os-mono text-[0.8rem]`} />
      </label>
      {props.editavel && (
        <div className="flex flex-wrap gap-2">
          {r.referencias.length > 0 && (
            <button
              className={btn}
              disabled={!!ocupado}
              onClick={() =>
                void agir('extrair', async () => {
                  const x = await apiPost<{ regras: string; params: Record<string, string | number> }>(`${caminho}/extrair`, {}, props.token);
                  setRegras(x.regras);
                  setParams(Object.entries(x.params).map(([k, v]) => `${k}: ${v}`).join('\n'));
                  props.setAviso(`Régua de ${r.formato} extraída das referências. Revise e salve.`);
                })
              }
            >
              {ocupado === 'extrair' ? 'Lendo as referências…' : 'Extrair régua'}
            </button>
          )}
          <button
            className={btnPrimario}
            disabled={!mudou || !!ocupado}
            onClick={() =>
              void agir('salvar', async () => {
                props.onSalvo(await apiPut<ReguaDoFormato>(caminho, { regras, params: lerParams() }, props.token));
                props.setAviso(`Régua de ${r.formato} salva.`);
              })
            }
          >
            Salvar
          </button>
        </div>
      )}
    </section>
  );
}
