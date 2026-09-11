'use client';

import { useEffect, useState } from 'react';
import type { IntegrationCatalog, IntegrationCatalogRow } from '@mktos/shared';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * O DESLIGAMENTO DE CONECTOR NA TELA — RF-G-06.
 *
 * A API devolve campos a mais por linha. Eles são declarados AQUI, como extensão
 * do tipo de `@mktos/shared`, porque o pacote compartilhado é de outra fatia —
 * supertipo local resolve sem tocar em arquivo alheio. (Que o contrato
 * compartilhado ainda não conheça estes campos está registrado em FORA DO
 * ESCOPO: hoje ninguém valida a resposta, mas é o artefato que qualquer pessoa
 * pegaria para validar.)
 *
 * DESLIGADO NÃO É DESCONECTADO, e a tela mostra os dois separados de propósito:
 * o selo de status continua dizendo se a integração está montada, e o selo de
 * desligamento diz se alguém mandou o OS parar de usá-la. Um conector conectado
 * E desligado é o caso normal de suspensão — juntar os dois num selo só faria a
 * tela mentir sobre o que aconteceria ao religar.
 *
 * E `aplicacaoDoDesligamento` DIZ O QUE O BOTÃO FAZ NESTA LINHA, HOJE. A
 * primeira versão desta tela oferecia o interruptor para as dezesseis linhas e
 * afirmava, no aviso do topo, que toda ferramenta do conector era recusada com
 * motivo e ficava no rastro. Era verdade para UMA delas. O texto abaixo não
 * volta a prometer nada que o código não cumpra: cada linha carrega a frase que
 * a API mandou, e a API a monta do mesmo lugar onde a recusa é (ou não é)
 * aplicada.
 */
type LinhaConexao = IntegrationCatalogRow & {
  desligado: boolean;
  desligadoEm: string | null;
  desligadoPor: string | null;
  motivoDesligado: string | null;
  grupo: string | null;
  aplicacaoDoDesligamento: 'recusa' | 'registro';
  textoDoDesligamento: string;
};

type CatalogoConexoes = Omit<IntegrationCatalog, 'items'> & { items: LinhaConexao[] };

const STATUS_CLS: Record<string, string> = {
  connected: 'bg-good/15 text-good',
  disconnected: 'bg-surface-2 text-muted',
  error: 'bg-bad/15 text-bad',
};
const STATUS_LABEL: Record<string, string> = {
  connected: 'conectado',
  disconnected: 'desconectado',
  error: 'erro',
};

/** Rótulo do grupo, para o botão dizer o que ele de fato desliga. */
const GRUPO_LABEL: Record<string, string> = { google: 'Google' };

export default function IntegracoesPage() {
  const { token, ready, can } = useAuth();
  const [data, setData] = useState<CatalogoConexoes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = can('admin.usuarios');

  const load = () => {
    if (!token) return;
    apiGet<CatalogoConexoes>('/integrations/catalog', token).then(setData).catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (!ready || !token) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token]);

  const toggle = (row: LinhaConexao) => {
    const status = row.status === 'connected' ? 'disconnected' : 'connected';
    apiPut(`/integrations/${row.key}`, { status }, token).then(load).catch((e) => setError(e.message));
  };

  // --- Desligamento (RF-G-06) -------------------------------------------
  // `alvo` é a chave do grupo quando existe: um clique em qualquer card do
  // Google desliga as quatro superfícies, que é o que "desligar o Google"
  // significa para quem opera — a credencial é uma só.
  const alvoDe = (row: LinhaConexao) => row.grupo ?? row.key;
  const nomeDoAlvo = (row: LinhaConexao) =>
    row.grupo ? (GRUPO_LABEL[row.grupo] ?? row.grupo) : row.label;

  const [abrindoMotivo, setAbrindoMotivo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [emCurso, setEmCurso] = useState<string | null>(null);

  // Duas rotas, não um booleano: desligar e religar são duas capacidades com
  // níveis diferentes na régua (R3 e R4). Ver `integrations.controller.ts`.
  const mandar = (alvo: string, desligar: boolean, motivoTexto?: string) => {
    setEmCurso(alvo);
    setError(null);
    const chamada = desligar
      ? apiPost(`/integrations/${alvo}/desligamento`, { motivo: motivoTexto || undefined }, token)
      : apiDelete(`/integrations/${alvo}/desligamento`, token);
    chamada
      .then(() => {
        setAbrindoMotivo(null);
        setMotivo('');
        load();
      })
      .catch((e) => setError(e.message))
      .finally(() => setEmCurso(null));
  };

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const canSync = can('tarefas.editar');
  const syncClickup = () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    apiPost<{ tasks: number; content: number; lists: number }>('/integrations/clickup/sync', {}, token)
      .then((r) => { setSyncMsg(`✅ ${r.tasks} tarefa(s) + ${r.content} conteúdo(s).`); load(); })
      .catch((e) => setError(e.message))
      .finally(() => setSyncing(false));
  };

  const connected = data?.items.filter((i) => i.status === 'connected').length ?? 0;
  const offs = data?.items.filter((i) => i.desligado) ?? [];
  // As duas contas separadas: é a diferença entre "a chamada é barrada" e "a
  // decisão ficou registrada". O aviso do topo só pode afirmar cada uma sobre o
  // seu próprio grupo.
  const barrados = offs.filter((i) => i.aplicacaoDoDesligamento === 'recusa');
  const soRegistrados = offs.filter((i) => i.aplicacaoDoDesligamento === 'registro');

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">
          {data ? `${connected}/${data.items.length} conectada(s)` : 'Carregando…'} · o hub de
          conectores. Os de <strong>OAuth</strong> (Instagram, Gmail, Drive) precisam de credencial
          própria do root — entram quando o acesso for gerado.
        </p>
      </div>

      {offs.length > 0 && (
        <div className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">
          <div>
            {offs.length} conector(es) <strong>desligado(s)</strong> para esta empresa. A credencial
            continua guardada — religar não pede autorização de novo.
          </div>
          {barrados.length > 0 && (
            <div>
              <strong>{barrados.map((i) => i.label).join(', ')}</strong>: toda ferramenta que dependa
              deles é recusada com motivo, e a recusa fica no rastro.
            </div>
          )}
          {soRegistrados.length > 0 && (
            <div>
              <strong>{soRegistrados.map((i) => i.label).join(', ')}</strong>: a decisão está
              registrada (autor, data e motivo), mas a chamada <strong>ainda não é barrada</strong> —
              a trava vale quando o gancho da porta entrar. Até lá, não conte com o desligamento
              destes para conter um incidente.
            </div>
          )}
        </div>
      )}

      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((i) => (
          <div
            key={i.key}
            className={`flex flex-col rounded-xl border bg-surface p-4 ${
              i.desligado ? 'border-warn/50' : 'border-border'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{i.label}</div>
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  {i.category} · fase {i.phase} · {i.authType}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_CLS[i.status] ?? ''}`}>
                  {STATUS_LABEL[i.status] ?? i.status}
                </span>
                {i.desligado && (
                  <span
                    title={i.textoDoDesligamento}
                    className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn"
                  >
                    {i.aplicacaoDoDesligamento === 'recusa' ? 'desligado' : 'desligado · só registro'}
                  </span>
                )}
              </div>
            </div>

            <p className="mt-2 flex-1 text-xs text-muted">
              {i.managed ? 'Requer: ' : '🔒 '}
              {i.requires}
              {i.lastSyncAt && (
                <span className="mt-1 block text-[10px]">
                  último sync: {new Date(i.lastSyncAt).toLocaleString('pt-BR')}
                </span>
              )}
              {i.lastError && <span className="mt-1 block text-[10px] text-bad">erro: {i.lastError}</span>}
              {i.desligado && (
                <>
                  <span className="mt-1 block text-[10px] text-warn">
                    desligado em{' '}
                    {i.desligadoEm ? new Date(i.desligadoEm).toLocaleString('pt-BR') : '—'}
                    {i.desligadoPor ? ` por ${i.desligadoPor}` : ''}
                    {i.motivoDesligado ? ` — ${i.motivoDesligado}` : ''}
                  </span>
                  {/* A frase vem da API, do mesmo arquivo que aplica (ou ainda
                      não aplica) a recusa — ver `conectores.ts`. */}
                  <span className="mt-1 block text-[10px] text-warn">{i.textoDoDesligamento}</span>
                </>
              )}
            </p>

            <div className="mt-3 space-y-2">
              {i.key === 'clickup' && canSync && (
                <>
                  <button
                    onClick={syncClickup}
                    disabled={syncing}
                    className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-60"
                  >
                    {syncing ? 'Sincronizando…' : 'Sincronizar tarefas'}
                  </button>
                  {syncMsg && <p className="text-[11px] text-good">{syncMsg}</p>}
                </>
              )}
              {i.managed ? (
                canManage ? (
                  <button
                    onClick={() => toggle(i)}
                    className={`w-full rounded-lg px-3 py-1.5 text-sm font-medium ${
                      i.status === 'connected'
                        ? 'border border-border text-muted hover:bg-surface-2 hover:text-text'
                        : 'bg-brand text-ink hover:opacity-90'
                    }`}
                  >
                    {i.status === 'connected' ? 'Desconectar' : 'Conectar'}
                  </button>
                ) : (
                  <span className="text-[11px] text-muted">Gerência restrita a admin.</span>
                )
              ) : ['gmail', 'gcal', 'gdocs', 'drive'].includes(i.key) ? (
                <a href="/google" className="inline-block rounded-lg border border-border px-3 py-1.5 text-[11px] text-brand hover:bg-surface-2">
                  Conectar/gerenciar em Google →
                </a>
              ) : (
                <span className="inline-block rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] text-muted">
                  Requer OAuth + credencial (em breve)
                </span>
              )}

              {/* RF-G-06 — o interruptor. Vale para TODO conector, inclusive os
                  de OAuth: é a única coisa nesta tela que funciona no Google.
                  O QUE ele faz em cada linha — barrar a chamada ou só registrar
                  a decisão — está escrito logo abaixo do botão, com o texto que
                  a API mandou. */}
              {canManage &&
                (i.desligado ? (
                  <button
                    onClick={() => mandar(alvoDe(i), false)}
                    disabled={emCurso === alvoDe(i)}
                    className="w-full rounded-lg border border-warn/50 px-3 py-1.5 text-sm font-medium text-warn hover:bg-warn/10 disabled:opacity-60"
                  >
                    {emCurso === alvoDe(i) ? 'Religando…' : `Religar ${nomeDoAlvo(i)}`}
                  </button>
                ) : abrindoMotivo === i.key ? (
                  <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/5 p-2">
                    <label className="block text-[11px] text-muted" htmlFor={`motivo-${i.key}`}>
                      Motivo (vai para o rastro
                      {i.aplicacaoDoDesligamento === 'recusa' ? ' e para a frase da recusa' : ''})
                    </label>
                    <input
                      id={`motivo-${i.key}`}
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      maxLength={500}
                      placeholder="ex.: suspeita de vazamento de token"
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => mandar(alvoDe(i), true, motivo)}
                        disabled={emCurso === alvoDe(i)}
                        className="flex-1 rounded-lg bg-bad px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-60"
                      >
                        {emCurso === alvoDe(i) ? 'Desligando…' : 'Desligar agora'}
                      </button>
                      <button
                        onClick={() => { setAbrindoMotivo(null); setMotivo(''); }}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { setAbrindoMotivo(i.key); setMotivo(''); }}
                      className="w-full rounded-lg border border-border px-3 py-1.5 text-[11px] text-muted hover:border-warn/50 hover:text-warn"
                    >
                      Desligar {nomeDoAlvo(i)}
                      {i.grupo ? ' (todas as superfícies)' : ''}
                    </button>
                    {/* A promessa do botão, ANTES do clique. Sem isto a tela
                        continuaria oferecendo em quinze linhas uma trava que só
                        existe numa — e quem clica em emergência para de procurar
                        outro jeito de parar a máquina. */}
                    <p
                      className={`text-[10px] ${
                        i.aplicacaoDoDesligamento === 'recusa' ? 'text-muted' : 'text-warn'
                      }`}
                    >
                      {i.textoDoDesligamento}
                    </p>
                  </>
                ))}
            </div>
          </div>
        ))}
      </div>

      {data && (
        <p className="text-[11px] text-muted">
          Fonte: {data.source.tool} · gerado {new Date(data.source.generatedAt).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  );
}
