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
 *
 * ============================================================================
 * O CONTRATO ÚNICO DE CONECTOR NA TELA — RF-X-01, RF-X-02 (fatia 5.4)
 * ============================================================================
 *
 * TRÊS CAMPOS, TRÊS PERGUNTAS, e a tela mostra os três sem misturar:
 *
 *   · `status`    — "esta empresa tem a integração montada?";
 *   · `desligado` — "alguém mandou o OS parar de usar isto agora?";
 *   · `saude`     — "esta empresa consegue usar isto AGORA?".
 *
 * A SAÚDE É O SELO PRINCIPAL, e o status virou linha de rodapé. O motivo é que
 * `status` responde a pergunta mais fraca das três: ele é registro de banco, e
 * registro de banco continua dizendo "conectado" depois de o token ter sido
 * revogado do lado do fornecedor. A saúde é uma TENTATIVA — verde só existe
 * depois de uma chamada de verdade, com o token desta empresa.
 *
 * NADA AQUI INVENTA FRASE. `mensagem` vem do conector, em português, e é ela
 * que aparece em vermelho. A tela não tem tabela de "erro conhecido → texto
 * bonito" de propósito: tabela assim envelhece em silêncio e, no dia em que o
 * fornecedor devolve um erro novo, ela mostra o texto errado com toda a
 * confiança.
 */
type EstadoDeConector = 'conectado' | 'nao_configurado' | 'erro' | 'nao_verificado';

type SaudeDeConector = {
  estado: EstadoDeConector;
  mensagem: string | null;
  apuracao: 'tentativa' | 'declaracao' | 'nao_verificado';
  verificadoEm: string;
  latenciaMs: number | null;
};

type ContratoDaLinha = {
  chave: string;
  rotulo: string;
  escopoDaCredencial: 'empresa' | 'processo';
  verbos: string[];
  linhasIrmas: string[];
};

type LinhaConexao = IntegrationCatalogRow & {
  desligado: boolean;
  desligadoEm: string | null;
  desligadoPor: string | null;
  motivoDesligado: string | null;
  grupo: string | null;
  aplicacaoDoDesligamento: 'recusa' | 'registro';
  textoDoDesligamento: string;
  contrato: ContratoDaLinha | null;
  saude: SaudeDeConector | null;
};

type CatalogoConexoes = Omit<IntegrationCatalog, 'items'> & { items: LinhaConexao[] };

type RespostaDeVerbo = {
  tipo: string;
  url?: string;
  instrucao?: string;
  motivo?: string;
  resumo?: string;
  detalhe?: string;
};

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

/**
 * As cores da saúde. `nao_verificado` é CINZA e nunca verde — ver o cabeçalho
 * do contrato na API: ele não é um estado de saúde, é a ausência de medição.
 */
const SAUDE_CLS: Record<EstadoDeConector, string> = {
  conectado: 'bg-good/15 text-good',
  nao_configurado: 'bg-surface-2 text-muted',
  erro: 'bg-bad/15 text-bad',
  nao_verificado: 'bg-surface-2 text-muted',
};
const SAUDE_LABEL: Record<EstadoDeConector, string> = {
  conectado: 'conectado',
  nao_configurado: 'não configurado',
  erro: 'erro',
  nao_verificado: 'não verificado',
};

/** Rótulo do grupo, para o botão dizer o que ele de fato desliga. */
const GRUPO_LABEL: Record<string, string> = { google: 'Google' };

function quando(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

/**
 * A IDADE DA MEDIÇÃO, em palavras — e ela é obrigatória, não enfeite.
 *
 * A API guarda cada sonda por pouco tempo (trinta segundos) para que abrir a
 * tela, agir e recarregar não vire uma rajada de chamadas externas contra
 * credenciais compartilhadas. Guardar assim é honesto SÓ ENQUANTO A IDADE
 * APARECE: o que seria desonesto é escrever "sondado agora" sobre uma medição de
 * meia hora atrás. Por isso a tela mostra "há quanto tempo", e não só a hora —
 * ninguém lê "10:12:36" e calcula a diferença de cabeça.
 */
function idade(iso: string | null, agora = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const seg = Math.max(0, Math.round((agora - t) / 1000));
  if (seg < 60) return `há ${seg}s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `há ${min}min`;
  const h = Math.round(min / 60);
  return h < 48 ? `há ${h}h` : quando(iso);
}

export default function IntegracoesPage() {
  const { token, ready, can } = useAuth();
  const [data, setData] = useState<CatalogoConexoes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
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

  // --- Os quatro verbos do contrato (fatia 5.4) -------------------------
  const [verbando, setVerbando] = useState<string | null>(null);
  const [queimando, setQueimando] = useState<string | null>(null);
  const [motivoQueima, setMotivoQueima] = useState('');

  /**
   * Toda resposta de verbo passa por aqui, e nenhuma delas é traduzida: o que a
   * API mandou (`instrucao`, `motivo`, `resumo`) é o que a pessoa lê. Um
   * `nao_se_aplica` não é erro — é o conector explicando por que aquele verbo não
   * existe para ele, e some se a gente o esconder atrás de um botão desabilitado.
   */
  const contar = (r: RespostaDeVerbo) => {
    const texto = r.resumo ?? r.instrucao ?? r.motivo ?? r.detalhe ?? null;
    if (r.tipo === 'redirecionar' && r.url) {
      window.location.href = r.url;
      return;
    }
    setAviso(texto);
  };

  const chamarVerbo = (chave: string, caminho: string, corpo: unknown = {}) => {
    setVerbando(`${chave}:${caminho}`);
    setError(null);
    setAviso(null);
    apiPost<RespostaDeVerbo>(`/integrations/${chave}/${caminho}`, corpo, token)
      .then((r) => {
        contar(r);
        load();
      })
      .catch((e) => setError(e.message))
      .finally(() => setVerbando(null));
  };

  /**
   * VERIFICAR — a sonda de UMA linha, sob demanda.
   *
   * O botão não promete "agora" porque a API pode devolver a medição dos últimos
   * trinta segundos (ver `idade`): prometer o que não se cumpre numa tela de
   * diagnóstico é o defeito que esta fatia inteira veio consertar, em pequeno.
   * O que muda o estado — autorizar, sincronizar, revogar, desligar, religar —
   * esquece a medição guardada do lado de lá, então depois de agir a sonda é
   * sempre nova.
   *
   * Atualiza a saúde de TODAS as linhas que compartilham a credencial
   * (`linhasIrmas`): sondar o Google é uma chamada só, e mostrar o Gmail verde
   * com o Drive vermelho depois dela seria inventar uma diferença que não existe.
   */
  const verificar = (linha: LinhaConexao) => {
    if (!linha.contrato) return;
    const chave = linha.contrato.chave;
    setVerbando(`${chave}:saude`);
    setError(null);
    apiGet<SaudeDeConector>(`/integrations/${chave}/saude`, token)
      .then((s) => {
        const alcance = new Set([linha.key, ...linha.contrato!.linhasIrmas]);
        setData((atual) =>
          atual
            ? {
                ...atual,
                items: atual.items.map((i) => (alcance.has(i.key) ? { ...i, saude: s } : i)),
              }
            : atual,
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setVerbando(null));
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

  const comContrato = data?.items.filter((i) => i.contrato) ?? [];
  const emErro = comContrato.filter((i) => i.saude?.estado === 'erro');
  const conectados = comContrato.filter((i) => i.saude?.estado === 'conectado');
  const offs = data?.items.filter((i) => i.desligado) ?? [];
  // As duas contas separadas: é a diferença entre "a chamada é barrada" e "a
  // decisão ficou registrada". O aviso do topo só pode afirmar cada uma sobre o
  // seu próprio grupo.
  const barrados = offs.filter((i) => i.aplicacaoDoDesligamento === 'recusa');
  const soRegistrados = offs.filter((i) => i.aplicacaoDoDesligamento === 'registro');

  return (
    <div className="space-y-6">
      <a href="/marketing/preparacao" className="underline">Dono e operadores das contas de Marketing</a>
      <div>
        <p className="text-sm text-muted">
          {data
            ? `${conectados.length} de ${comContrato.length} conector(es) com contrato responderam agora`
            : 'Carregando…'}{' '}
          · o hub de conectores. O selo de cada card é uma <strong>sonda de verdade</strong>: verde
          só aparece depois de uma chamada que o fornecedor respondeu, para esta empresa.
        </p>
      </div>

      {/*
        A DEGRADAÇÃO, DITA COM NOME. Um conector fora do ar não derruba a tela nem
        os outros: ele vira uma linha desta lista, com a mensagem real dele, e o
        resto continua respondendo. É esta caixa que prova, para quem olha, que a
        promessa "degrada só o que depende dele" está sendo cumprida agora.
      */}
      {emErro.length > 0 && (
        <div className="space-y-1 rounded-lg border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">
          <div>
            <strong>{emErro.length} conector(es) com problema.</strong> Só o que depende deles está
            degradado — o resto da lista respondeu normalmente.
          </div>
          {emErro.map((i) => (
            <div key={i.key} className="text-xs">
              <strong>{i.label}</strong>: {i.saude?.mensagem}
            </div>
          ))}
        </div>
      )}

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
      {aviso && (
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm">
          {aviso}
          <button onClick={() => setAviso(null)} className="ml-2 text-[11px] text-muted underline">
            fechar
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((i) => (
          <div
            key={i.key}
            className={`flex flex-col rounded-xl border bg-surface p-4 ${
              i.saude?.estado === 'erro'
                ? 'border-bad/50'
                : i.desligado
                  ? 'border-warn/50'
                  : 'border-border'
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
                {/* O selo PRINCIPAL é a saúde — ver o cabeçalho. Sem contrato,
                    cai para o status legado, que é o que existia antes. */}
                {i.saude ? (
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${SAUDE_CLS[i.saude.estado]}`}>
                    {SAUDE_LABEL[i.saude.estado]}
                  </span>
                ) : (
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_CLS[i.status] ?? ''}`}>
                    {STATUS_LABEL[i.status] ?? i.status}
                  </span>
                )}
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

              {/* A MENSAGEM REAL do conector. Vermelha quando é erro; cinza
                  quando é "falta alguma coisa" — que não é falha de ninguém. */}
              {i.saude?.mensagem && (
                <span
                  className={`mt-1 block text-[10px] ${
                    i.saude.estado === 'erro' ? 'text-bad' : 'text-muted'
                  }`}
                >
                  {i.saude.mensagem}
                </span>
              )}
              {i.saude && (
                <span
                  className="mt-1 block text-[10px] text-muted"
                  title={quando(i.saude.verificadoEm)}
                >
                  {i.saude.apuracao === 'tentativa'
                    ? `sondado ${idade(i.saude.verificadoEm)}${
                        i.saude.latenciaMs !== null ? ` · ${i.saude.latenciaMs} ms` : ''
                      }`
                    : i.saude.apuracao === 'declaracao'
                      ? `declarado pelo conector · ${idade(i.saude.verificadoEm)}`
                      : `não sondado · ${idade(i.saude.verificadoEm)}`}
                  {i.contrato && i.contrato.linhasIrmas.length > 0 && (
                    <> · mesma credencial de {i.contrato.linhasIrmas.join(', ')}</>
                  )}
                </span>
              )}

              {i.lastSyncAt && (
                <span className="mt-1 block text-[10px]">
                  último sync: {quando(i.lastSyncAt)}
                </span>
              )}
              {/* Sem contrato não há sonda, então o registro do banco é tudo o
                  que existe — e aí ele vira a informação, não rodapé. */}
              {!i.saude && i.lastError && (
                <span className="mt-1 block text-[10px] text-bad">erro: {i.lastError}</span>
              )}
              {i.saude && (
                <span className="mt-1 block text-[10px] text-muted">
                  registro no banco: {STATUS_LABEL[i.status] ?? i.status}
                </span>
              )}
              {i.desligado && (
                <>
                  <span className="mt-1 block text-[10px] text-warn">
                    desligado em {quando(i.desligadoEm)}
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
              {/*
                OS QUATRO VERBOS DO CONTRATO (fatia 5.4). Aparecem em toda linha
                que tem contrato, iguais para todo conector — é isso que faz
                conector novo não precisar de tela nova. O que varia é a RESPOSTA:
                quem não tem autorização automática devolve a instrução manual, e
                quem tem credencial de processo explica por que revogar não se
                aplica e aponta o desligamento.
              */}
              {i.contrato && (
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => verificar(i)}
                    disabled={verbando === `${i.contrato.chave}:saude`}
                    title={
                      'Mede de novo. Uma medição feita nos últimos 30 segundos é reaproveitada — ' +
                      'a linha abaixo do card sempre diz de quando ela é.'
                    }
                    className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text disabled:opacity-60"
                  >
                    {verbando === `${i.contrato.chave}:saude` ? 'Sondando…' : 'Verificar'}
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => chamarVerbo(i.contrato!.chave, 'autorizacao')}
                        disabled={verbando === `${i.contrato.chave}:autorizacao`}
                        className="rounded-lg border border-border px-2 py-1 text-[11px] text-brand hover:bg-surface-2 disabled:opacity-60"
                      >
                        {verbando === `${i.contrato.chave}:autorizacao` ? 'Abrindo…' : 'Autorizar'}
                      </button>
                      <button
                        onClick={() => chamarVerbo(i.contrato!.chave, 'sincronizacao')}
                        disabled={verbando === `${i.contrato.chave}:sincronizacao`}
                        className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text disabled:opacity-60"
                      >
                        {verbando === `${i.contrato.chave}:sincronizacao`
                          ? 'Sincronizando…'
                          : 'Sincronizar'}
                      </button>
                    </>
                  )}
                </div>
              )}

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
              ) : !i.contrato ? (
                <span className="inline-block rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] text-muted">
                  Requer OAuth + credencial (em breve)
                </span>
              ) : null}

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

              {/*
                REVOGAR ≠ DESLIGAR, e a tela separa os dois com todas as letras.
                O botão só aparece em conector cuja credencial é DESTA EMPRESA:
                onde a credencial é do processo, revogar por empresa não existe, e
                oferecer o botão só para receber um "não se aplica" ensinaria a
                pessoa errada no dia errado. A confirmação é em duas etapas, com o
                aviso de que não tem volta, porque não tem mesmo.
              */}
              {canManage && i.contrato?.escopoDaCredencial === 'empresa' && (
                queimando === i.contrato.chave ? (
                  <div className="space-y-2 rounded-lg border border-bad/40 bg-bad/5 p-2">
                    <p className="text-[11px] text-bad">
                      Queimar a credencial de <strong>{i.contrato.rotulo}</strong> desta empresa.
                      Isto <strong>não tem volta</strong>: alguém vai precisar autorizar de novo.
                      Para só pausar, use “Desligar”.
                    </p>
                    <input
                      value={motivoQueima}
                      onChange={(e) => setMotivoQueima(e.target.value)}
                      maxLength={500}
                      placeholder="motivo (vai para o rastro)"
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          chamarVerbo(i.contrato!.chave, 'revogacao', {
                            motivo: motivoQueima || undefined,
                          });
                          setQueimando(null);
                          setMotivoQueima('');
                        }}
                        className="flex-1 rounded-lg bg-bad px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90"
                      >
                        Queimar credencial
                      </button>
                      <button
                        onClick={() => { setQueimando(null); setMotivoQueima(''); }}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setQueimando(i.contrato!.chave); setMotivoQueima(''); }}
                    className="w-full rounded-lg border border-bad/40 px-3 py-1.5 text-[11px] text-bad hover:bg-bad/10"
                  >
                    Revogar credencial de {i.contrato.rotulo} (não tem volta)
                  </button>
                )
              )}
            </div>
          </div>
        ))}
      </div>

      {data && (
        <p className="text-[11px] text-muted">
          Fonte: {data.source.tool} · gerado {quando(data.source.generatedAt)}
        </p>
      )}
    </div>
  );
}
