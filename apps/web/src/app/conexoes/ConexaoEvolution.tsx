'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConexaoDaEvolution, EstadoDaEvolution, QrDaEvolution, SegredoDoWebhookDaEvolution } from '@mktos/shared';
import { apiGet, apiPost, apiPut } from '@/lib/api';

/*
 * O WHATSAPP PELA EVOLUTION EM INTEGRAÇÕES (Rodada de produção 1, 21/10/2026, P8).
 *
 * O comercial manda e recebe o WhatsApp do lead pela Evolution quando a API
 * está com o provedor `evolution`. Daqui se guarda o endereço da Evolution, a
 * chave da API e o nome da instância no cofre da empresa (a chave nunca volta
 * para a tela), se vê o estado da instância, se gera o QR para ligar o número e
 * se copia a URL do webhook.
 *
 * Desde a rodada dos agentes (A6, 21/10/2026) este é o CONTEÚDO PRÓPRIO do
 * cartão "WhatsApp do comercial (Evolution)": o `CartaoDeConexao` mostra o
 * estado sondado, quem usa e as ações comuns (Testar, Desconectar, Desligar);
 * aqui fica só o que a Evolution tem de seu.
 */

/** O estado da INSTÂNCIA (detalhe da Evolution); o estado do conector é o do cartão. */
const INSTANCIA: Record<EstadoDaEvolution['estado'], string> = {
  open: 'aberta (número ligado)',
  connecting: 'aguardando a leitura do QR',
  close: 'fechada (gere o QR para ligar o número)',
  erro: 'erro ao consultar',
  desconhecido: 'não consultada',
  nao_configurada: 'não configurada',
  desligada: 'conector desligado',
};

const PROVEDOR: Record<string, string> = {
  evolution: 'evolution (esta conexão)',
  simulado: 'simulado (nada sai do sistema)',
};

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';

function ehConexao(v: unknown): v is ConexaoDaEvolution {
  return !!v && typeof v === 'object' && typeof (v as ConexaoDaEvolution).caminhoDoWebhook === 'string';
}

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}
      className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] text-brand"
    >
      {ok ? 'copiado' : 'copiar'}
    </button>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-muted">{rotulo}</span>
      {children}
    </label>
  );
}

const entrada = 'w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm text-text';

export function ConexaoEvolution({ token, gerenciar, aoMudar }: { token: string; gerenciar: boolean; aoMudar?: () => void }) {
  const [c, setC] = useState<ConexaoDaEvolution | null>(null);
  const [estado, setEstado] = useState<EstadoDaEvolution | null>(null);
  const [qr, setQr] = useState<QrDaEvolution | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [form, setForm] = useState({ url: '', chave: '', instancia: '' });
  // Produção 22, M4: o segredo do webhook DESTA empresa, só a pedido e só em memória (some ao esconder).
  const [segredo, setSegredo] = useState<SegredoDoWebhookDaEvolution | null>(null);

  const consultarInstancia = useCallback(() => {
    apiGet<EstadoDaEvolution>('/integrations/evolution/estado', token)
      .then((s) => {
        const ok = s && typeof s === 'object' && 'estado' in s ? s : null;
        setEstado(ok);
        if (ok?.estado === 'open') setQr(null);
      })
      .catch(() => setEstado(null));
  }, [token]);

  const carregar = useCallback(() => {
    apiGet<ConexaoDaEvolution>('/integrations/evolution/conexao', token)
      .then((r) => {
        if (!ehConexao(r)) return;
        setC(r);
        setForm((f) => ({ ...f, url: f.url || r.url || '', instancia: f.instancia || r.instancia || '' }));
      })
      .catch((e) => setErro(`Não foi possível carregar a Evolution: ${(e as Error).message}`));
    consultarInstancia();
  }, [token, consultarInstancia]);

  useEffect(() => carregar(), [carregar]);

  const fazer = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await fn();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const salvar = () =>
    fazer(async () => {
      const corpo: Record<string, string> = { url: form.url.trim(), instancia: form.instancia.trim() };
      if (form.chave.trim()) corpo.chave = form.chave.trim();
      const r = await apiPut<ConexaoDaEvolution>('/integrations/evolution/credencial', corpo, token);
      // A chave sai do formulário assim que o cofre a guarda.
      setForm((f) => ({ ...f, chave: '' }));
      if (ehConexao(r)) setC(r);
      setAviso('Guardado no cofre da empresa.');
      consultarInstancia();
      aoMudar?.();
    });

  const gerarQr = () =>
    fazer(async () => {
      const r = await apiPost<QrDaEvolution>('/integrations/evolution/qr', {}, token);
      setQr(r);
      setEstado((s) => (s ? { ...s, estado: r.estado } : s));
    });

  const mostrarSegredo = () =>
    fazer(async () => {
      const r = await apiGet<SegredoDoWebhookDaEvolution>('/integrations/evolution/segredo-do-webhook', token);
      setSegredo(r && typeof r === 'object' && 'ligado' in r ? r : null);
    });

  if (!c) return erro ? <p className="text-xs text-bad">{erro}</p> : null;

  const origem = typeof window !== 'undefined' ? window.location.origin : '';
  const urlDoWebhook = `${origem}${c.caminhoDoWebhook}`;
  const podeGerarQr = gerenciar && c.origem !== 'nenhuma' && !c.desligado && estado?.estado !== 'open';

  return (
    <div className="space-y-3 text-xs" data-testid="conteudo-evolution">
      <p className="text-muted">
        Provedor do comercial agora: <span className="text-text">{PROVEDOR[c.provedorDoComercial] ?? c.provedorDoComercial}</span>. O envio
        ao lead continua pedindo a assinatura de outra pessoa.
      </p>

      <dl className="grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-[8.5rem_1fr]">
        <dt className="text-muted">Instância</dt>
        <dd className="min-w-0 break-words text-text" data-testid="instancia-evolution">
          {c.instancia ?? 'não configurada'}
          {estado ? ` · ${INSTANCIA[estado.estado]}` : ''}
          {estado?.verificadoEm ? ` (${quando(estado.verificadoEm)})` : ''}
        </dd>
        <dt className="text-muted">Endereço</dt>
        <dd className="min-w-0 break-all text-text">{c.url ?? 'não configurado'}</dd>
        <dt className="text-muted">Chave da API</dt>
        <dd className="text-text">
          {c.chaveGuardada
            ? `guardada no cofre${c.chaveAtualizadaEm ? ` em ${quando(c.chaveAtualizadaEm)}` : ''}`
            : c.chaveRevogadaEm
              ? `revogada em ${quando(c.chaveRevogadaEm)}`
              : c.origem === 'ambiente'
                ? 'do ambiente da casa'
                : 'não guardada'}
        </dd>
      </dl>

      {podeGerarQr && (
        <button type="button" disabled={ocupado} onClick={() => void gerarQr()} className="rounded-lg border border-brand/50 px-3 py-1.5 text-xs text-brand disabled:opacity-50">
          Gerar QR
        </button>
      )}
      {erro && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-bad">{erro}</p>}
      {aviso && <p className="rounded-lg border border-good/30 bg-good/10 px-3 py-2 text-good">{aviso}</p>}

      {qr && (
        <div className="flex flex-wrap items-start gap-4 rounded-lg border border-border bg-surface-2 p-3" data-testid="qr-da-evolution">
          {qr.base64 ? (
            // O QR vem como data: de imagem, da Evolution, e não é guardado.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.base64} alt="QR para ligar o número" className="h-48 w-48 shrink-0 rounded bg-white p-1" />
          ) : null}
          <div className="min-w-0 space-y-1">
            <p className="text-text">{qr.mensagem}</p>
            {qr.codigoDePareamento && (
              <p className="text-muted">
                Ou use o código de pareamento: <code className="font-mono text-text">{qr.codigoDePareamento}</code>
              </p>
            )}
            <button type="button" onClick={() => { consultarInstancia(); aoMudar?.(); }} className="mt-1 rounded border border-border px-2 py-0.5 text-[11px] text-brand">
              Já li o QR
            </button>
          </div>
        </div>
      )}

      {gerenciar && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <Campo rotulo="Endereço da Evolution">
            <input className={entrada} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://evolution.suaempresa.com.br" autoComplete="off" />
          </Campo>
          <Campo rotulo="Nome da instância">
            <input className={entrada} value={form.instancia} onChange={(e) => setForm({ ...form, instancia: e.target.value })} autoComplete="off" />
          </Campo>
          <Campo rotulo="Chave da API (apikey)">
            <input
              className={entrada}
              type="password"
              value={form.chave}
              onChange={(e) => setForm({ ...form, chave: e.target.value })}
              placeholder={c.chaveGuardada ? 'guardada; deixe em branco para manter' : ''}
              autoComplete="new-password"
            />
          </Campo>
          <div className="flex items-end">
            <button type="submit" disabled={ocupado} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50">
              Salvar no cofre
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted">Na Evolution (webhook da instância)</div>
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-muted">URL</span>
          <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-text" data-testid="url-do-webhook-evolution">
            {urlDoWebhook}
          </code>
          <Copiar texto={urlDoWebhook} />
        </div>
        <p className="text-muted">
          Ligue o webhook da instância com o evento de mensagem nova (MESSAGES_UPSERT) e o cabeçalho{' '}
          <code className="font-mono">{c.cabecalhoDoSegredo}</code> com o segredo do webhook desta empresa. Cada empresa tem o
          seu; o de uma não vale para outra. A resposta de quem já é lead vai para o comercial; o resto segue para o canal de
          aprovação.
        </p>
        {gerenciar && c.entradaLigada && !segredo && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void mostrarSegredo()}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-brand disabled:opacity-50"
            data-testid="mostrar-segredo-evolution"
          >
            Mostrar o segredo do webhook
          </button>
        )}
        {segredo?.segredo && (
          <div className="flex items-center gap-2" data-testid="segredo-do-webhook-evolution">
            <span className="w-12 shrink-0 text-muted">Segredo</span>
            <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-text">{segredo.segredo}</code>
            <Copiar texto={segredo.segredo} />
            <button type="button" onClick={() => setSegredo(null)} className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] text-muted">
              esconder
            </button>
          </div>
        )}
        {!c.entradaLigada && (
          <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-warn">
            A entrada está fechada: o segredo do canal de aprovação não está configurado no servidor. As respostas do lead não entram.
          </p>
        )}
      </div>
    </div>
  );
}
