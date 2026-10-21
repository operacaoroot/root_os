'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConexaoDaEvolution, EstadoDaEvolution, QrDaEvolution } from '@mktos/shared';
import { apiGet, apiPost, apiPut } from '@/lib/api';

/*
 * O WHATSAPP PELA EVOLUTION EM INTEGRAÇÕES (Rodada de produção 1, 21/10/2026, P8).
 *
 * O comercial manda e recebe o WhatsApp do lead pela Evolution quando a API
 * está com o provedor `evolution`. Daqui se guarda o endereço da Evolution, a
 * chave da API e o nome da instância no cofre da empresa (a chave nunca volta
 * para a tela), se vê o estado da instância (conectada, QR pendente, erro), se
 * gera o QR para ligar o número e se copia a URL do webhook.
 */

const SELO: Record<EstadoDaEvolution['estado'] | 'nao_verificado', { texto: string; cor: string }> = {
  open: { texto: 'conectada', cor: 'bg-good/15 text-good' },
  connecting: { texto: 'QR pendente', cor: 'bg-warn/15 text-warn' },
  close: { texto: 'desconectada', cor: 'bg-warn/15 text-warn' },
  erro: { texto: 'erro', cor: 'bg-bad/15 text-bad' },
  desconhecido: { texto: 'não verificado', cor: 'bg-surface-2 text-muted' },
  nao_configurada: { texto: 'não configurada', cor: 'bg-surface-2 text-muted' },
  desligada: { texto: 'desligado', cor: 'bg-warn/15 text-warn' },
  nao_verificado: { texto: 'não verificado', cor: 'bg-surface-2 text-muted' },
};

const PROVEDOR: Record<string, string> = {
  evolution: 'evolution (esta conexão)',
  simulado: 'simulado (nada sai do sistema)',
  meta: 'meta',
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

export function ConexaoEvolution({ token, gerenciar }: { token: string; gerenciar: boolean }) {
  const [c, setC] = useState<ConexaoDaEvolution | null>(null);
  const [estado, setEstado] = useState<EstadoDaEvolution | null>(null);
  const [qr, setQr] = useState<QrDaEvolution | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarRevogar, setConfirmarRevogar] = useState(false);
  const [form, setForm] = useState({ url: '', chave: '', instancia: '' });

  const sondar = useCallback(() => {
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
    sondar();
  }, [token, sondar]);

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
      sondar();
    });

  const gerarQr = () =>
    fazer(async () => {
      const r = await apiPost<QrDaEvolution>('/integrations/evolution/qr', {}, token);
      setQr(r);
      setEstado((s) => (s ? { ...s, estado: r.estado } : s));
    });

  const revogar = () =>
    fazer(async () => {
      await apiPost('/integrations/evolution/revogacao', { motivo: 'Revogado no cartão da Evolution' }, token);
      setConfirmarRevogar(false);
      setQr(null);
      carregar();
    });

  if (!c) return erro ? <p className="text-sm text-bad">{erro}</p> : null;

  const origem = typeof window !== 'undefined' ? window.location.origin : '';
  const urlDoWebhook = `${origem}${c.caminhoDoWebhook}`;
  const selo = c.desligado ? SELO.desligada : estado ? SELO[estado.estado] : SELO.nao_verificado;
  const podeGerarQr = gerenciar && c.origem !== 'nenhuma' && !c.desligado && estado?.estado !== 'open';

  return (
    <section className="rounded-xl border border-border bg-surface p-5" aria-label="WhatsApp (Evolution)">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[1.05rem] font-semibold text-text">WhatsApp (Evolution)</h2>
            <span data-testid="selo-evolution" className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${selo.cor}`}>{selo.texto}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            O WhatsApp do comercial sai e chega pela Evolution quando a API usa o provedor evolution. O envio ao lead continua
            pedindo a assinatura de outra pessoa.
          </p>
          <p className="mt-1 text-xs text-muted">
            Provedor do comercial agora: <span className="text-text">{PROVEDOR[c.provedorDoComercial] ?? c.provedorDoComercial}</span>.
          </p>
          {estado?.mensagem && (
            <p className="mt-1 text-xs text-muted">
              {estado.mensagem}
              {estado.verificadoEm ? ` (${quando(estado.verificadoEm)})` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={ocupado} onClick={sondar} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted disabled:opacity-50">
            Verificar
          </button>
          {podeGerarQr && (
            <button type="button" disabled={ocupado} onClick={() => void gerarQr()} className="rounded-lg border border-brand/50 px-3 py-1.5 text-xs text-brand disabled:opacity-50">
              Gerar QR
            </button>
          )}
          {gerenciar && c.chaveGuardada && (
            <button type="button" disabled={ocupado} onClick={() => setConfirmarRevogar(true)} className="rounded-lg border border-bad/40 px-3 py-1.5 text-xs text-bad disabled:opacity-50">
              Revogar
            </button>
          )}
        </div>
      </div>

      {confirmarRevogar && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
          <span className="text-text">Revogar queima o endereço, a chave e a instância no cofre. Nada sai até salvar de novo.</span>
          <button type="button" disabled={ocupado} onClick={() => void revogar()} className="font-medium text-bad disabled:opacity-50">confirmar</button>
          <button type="button" onClick={() => setConfirmarRevogar(false)} className="text-muted">cancelar</button>
        </div>
      )}
      {erro && <p className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{erro}</p>}
      {aviso && <p className="mt-3 rounded-lg border border-good/30 bg-good/10 px-3 py-2 text-xs text-good">{aviso}</p>}

      {qr && (
        <div className="mt-4 flex flex-wrap items-start gap-4 rounded-lg border border-border bg-surface-2 p-3" data-testid="qr-da-evolution">
          {qr.base64 ? (
            // O QR vem como data: de imagem, da Evolution, e não é guardado.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.base64} alt="QR para ligar o número" className="h-48 w-48 shrink-0 rounded bg-white p-1" />
          ) : null}
          <div className="min-w-0 space-y-1 text-xs">
            <p className="text-text">{qr.mensagem}</p>
            {qr.codigoDePareamento && (
              <p className="text-muted">
                Ou use o código de pareamento: <code className="font-mono text-text">{qr.codigoDePareamento}</code>
              </p>
            )}
            <button type="button" onClick={sondar} className="mt-1 rounded border border-border px-2 py-0.5 text-[11px] text-brand">
              Já li o QR
            </button>
          </div>
        </div>
      )}

      <dl className="mt-4 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted">Endereço</dt>
        <dd className="min-w-0 break-all text-text">{c.url ?? 'não configurado'}</dd>
        <dt className="text-muted">Instância</dt>
        <dd className="text-text">{c.instancia ?? 'não configurada'}</dd>
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

      {gerenciar && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
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

      <div className="mt-4 space-y-2 text-xs">
        <div className="text-[11px] uppercase tracking-wide text-muted">Na Evolution (webhook da instância)</div>
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-muted">URL</span>
          <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-text" data-testid="url-do-webhook-evolution">
            {urlDoWebhook}
          </code>
          <Copiar texto={urlDoWebhook} />
        </div>
        <p className="text-muted">
          Ligue o webhook da instância com o evento de mensagem nova (MESSAGES_UPSERT) e o cabeçalho{' '}
          <code className="font-mono">{c.cabecalhoDoSegredo}</code> com o segredo do canal de aprovação. Quem administra o servidor
          tem o valor; ele não aparece nesta tela. A resposta de quem já é lead vai para o comercial; o resto segue para o canal
          de aprovação.
        </p>
        {!c.entradaLigada && (
          <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-warn">
            A entrada está fechada: o segredo do canal de aprovação não está configurado no servidor. As respostas do lead não entram.
          </p>
        )}
      </div>
    </section>
  );
}
