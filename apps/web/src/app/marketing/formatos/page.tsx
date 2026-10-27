'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReguaDoFormato } from '@mktos/shared';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Marketing › PRODUÇÃO › Formatos. Cópia da tela Formatos do ROOT Estúdio
 * (public/pages/formatos.js): um painel por formato com referências, "Extrair régua",
 * a régua em tópicos e os parâmetros. O "Gerar com a régua" do post segue o que está aqui.
 * Comunidade Wpp traz também os arquivos da pasta canal-whatsapp/semanas para o Banco.
 */

const ROTULO_DO_PARAM: Record<string, string> = {
  slides_min: 'Mínimo de slides', slides_max: 'Máximo de slides', headline_max_palavras: 'Palavras na capa', densidade: 'Densidade de texto', cta: 'Chamada final',
  layout: 'Layout', duracao_max_s: 'Duração máxima (s)', clipe_abertura_max_s: 'Clipe de abertura (s)', legenda: 'Legenda', estrutura: 'Estrutura',
  palavras_min: 'Mínimo de palavras', palavras_max: 'Máximo de palavras', gancho: 'Primeira linha', subtipo: 'Tipo padrão', blocos_max: 'Blocos no máximo',
  enquete_pergunta_max: 'Pergunta da enquete (caracteres)', enquete_opcao_max: 'Opção da enquete (caracteres)',
};

export default function FormatosPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [reguas, setReguas] = useState<ReguaDoFormato[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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

  if (ready && !can('pauta.ver')) return <div className="estudio"><p className="muted">Acesso insuficiente para Marketing.</p></div>;

  return (
    <div className="estudio">
      <p className="muted" style={{ margin: '0 0 18px' }}>
        A régua é o padrão de cada formato, tirado das suas referências. A IA segue a régua toda vez que produz uma peça.
      </p>
      {aviso && <div className="notice">{aviso}</div>}
      {erro && <div className="notice warn">{erro}</div>}
      {!reguas ? (
        <p className="muted">Carregando…</p>
      ) : (
        <div className="formatos-grid">
          {reguas.map((r) => (
            <Bloco
              key={r.formato}
              regua={r}
              editavel={editavel}
              token={token}
              onSalvo={(nova) => setReguas((a) => a!.map((x) => (x.formato === nova.formato ? nova : x)))}
              setErro={setErro}
              setAviso={setAviso}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Bloco(props: { regua: ReguaDoFormato; editavel: boolean; token: string | null; onSalvo: (r: ReguaDoFormato) => void; setErro: (s: string | null) => void; setAviso: (s: string | null) => void }) {
  const r = props.regua;
  const [regras, setRegras] = useState(r.regras);
  const [params, setParams] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, String(v)])));
  const [adicionando, setAdicionando] = useState<'link' | 'texto' | null>(null);
  const [valor, setValor] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const caminho = `/marketing/estudio/formatos/${encodeURIComponent(r.formato)}`;
  const temRegua = !!r.atualizadaEm;

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

  return (
    <section className="panel formatos-block">
      <div className="row between">
        <h2>{r.formato}</h2>
        <span className={`badge ${temRegua ? 'success' : ''}`}>{temRegua ? 'Com régua' : 'Régua de partida'}</span>
      </div>
      <h3 className="formatos-sub">Referências</h3>
      {r.referencias.length ? (
        <ul className="formatos-refs">
          {r.referencias.map((x) => (
            <li key={x.id} className="formatos-ref">
              <span className="formatos-thumb formatos-thumb-icon">{x.tipo === 'link' ? 'Link' : 'Texto'}</span>
              <div className="formatos-ref-main">
                {x.tipo === 'link' ? (
                  <a href={x.url} target="_blank" rel="noopener noreferrer">
                    {x.url}
                  </a>
                ) : (
                  <span className="formatos-excerpt">
                    {(x.texto ?? '').slice(0, 180)}
                    {(x.texto ?? '').length > 180 ? '…' : ''}
                  </span>
                )}
                {x.nota && <span className="muted tiny">{x.nota}</span>}
              </div>
              {props.editavel && (
                <button className="ghost small danger" title="Remover" onClick={() => void agir('tirar', async () => props.onSalvo(await apiDelete<ReguaDoFormato>(`${caminho}/referencias/${x.id}`, props.token)))}>
                  Remover
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted tiny">Nenhuma referência ainda. Adicione posts que você quer usar de modelo.</p>
      )}
      {props.editavel && (
        <>
          <div className="row formatos-add">
            <button className="small" onClick={() => setAdicionando('link')}>
              + Link
            </button>
            <button className="small" onClick={() => setAdicionando('texto')}>
              + Texto
            </button>
            {r.referencias.length > 0 && (
              <button
                className="small dark"
                disabled={!!ocupado}
                onClick={() =>
                  void agir('extrair', async () => {
                    const x = await apiPost<{ regras: string; params: Record<string, string | number> }>(`${caminho}/extrair`, {}, props.token);
                    setRegras(x.regras);
                    setParams(Object.fromEntries(Object.entries(x.params).map(([k, v]) => [k, String(v)])));
                    props.setAviso(`Régua de ${r.formato} extraída das referências. Revise e salve.`);
                  })
                }
              >
                {ocupado === 'extrair' ? 'Lendo as referências…' : 'Extrair régua'}
              </button>
            )}
            {r.formato === 'Comunidade Wpp' && (
              <button
                className="small"
                disabled={!!ocupado}
                onClick={() =>
                  void agir('importar', async () => {
                    const x = await apiPost<{ lidos: number; criados: number; jaExistiam: number; ignorados: number }>('/marketing/estudio/comunidade/importar', {}, props.token);
                    props.setAviso(`Pasta semanas: ${x.criados} posts novos no Banco, ${x.jaExistiam} já estavam lá.`);
                  })
                }
              >
                {ocupado === 'importar' ? 'Trazendo…' : 'Trazer da pasta semanas'}
              </button>
            )}
          </div>
          {adicionando && (
            <form
              className="formatos-dialog"
              style={{ margin: '0 0 14px' }}
              onSubmit={(e) => {
                e.preventDefault();
                const v = valor.trim();
                if (!v) return;
                void agir('ref', async () => {
                  props.onSalvo(await apiPost<ReguaDoFormato>(`${caminho}/referencias`, adicionando === 'link' ? { url: v } : { texto: v }, props.token));
                  setValor('');
                  setAdicionando(null);
                });
              }}
            >
              {adicionando === 'link' ? (
                <label>
                  Link de referência
                  <input autoFocus type="url" required value={valor} onChange={(e) => setValor(e.target.value)} placeholder="https://www.instagram.com/p/…" />
                </label>
              ) : (
                <label>
                  Texto de referência
                  <textarea autoFocus rows={4} value={valor} onChange={(e) => setValor(e.target.value)} />
                </label>
              )}
              <div className="row">
                <button className="primary" type="submit" disabled={ocupado === 'ref'}>
                  Adicionar
                </button>
                <button type="button" onClick={() => setAdicionando(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </>
      )}
      <form
        className="formatos-form"
        onSubmit={(e) => {
          e.preventDefault();
          const p = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v.trim()]));
          void agir('salvar', async () => {
            props.onSalvo(await apiPut<ReguaDoFormato>(caminho, { regras, params: p }, props.token));
            props.setAviso(`Régua de ${r.formato} salva.`);
          });
        }}
      >
        <label>
          Régua
          <textarea rows={8} value={regras} onChange={(e) => setRegras(e.target.value)} readOnly={!props.editavel} placeholder="- Um tópico por linha. Ex.: capa com frase de até 8 palavras" />
        </label>
        <div className="formatos-params">
          {Object.entries(params).map(([k, v]) => (
            <label key={k}>
              {ROTULO_DO_PARAM[k] ?? k}
              <input value={v} maxLength={300} readOnly={!props.editavel} onChange={(e) => setParams({ ...params, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        {props.editavel && (
          <div className="row">
            <button className="primary" type="submit" disabled={!!ocupado}>
              Salvar
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
