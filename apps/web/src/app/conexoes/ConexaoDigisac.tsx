'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConexaoDoDigisac, ServicoDoDigisac } from '@mktos/shared';
import { apiGet, apiPost, apiPut } from '@/lib/api';

/*
 * O WHATSAPP PELO DIGISAC EM CONEXÕES (Interface 20/10, lane U6).
 *
 * O comercial manda e recebe WhatsApp pelo DigiSac quando a API está com o
 * provedor `digisac`. Daqui se guarda o endereço da conta, o token e o id da
 * conexão no cofre da empresa (o token nunca volta para a tela), se listam as
 * conexões da conta, se revoga, e se copia a URL do webhook a cadastrar no
 * DigiSac. O estado do selo é a sonda do conector, não o que está guardado.
 */

interface Saude {
  estado: 'conectado' | 'nao_configurado' | 'erro' | 'nao_verificado';
  mensagem: string | null;
  verificadoEm: string;
}

const SELO: Record<Saude['estado'], { texto: string; cor: string }> = {
  conectado: { texto: 'conectado', cor: 'bg-good/15 text-good' },
  erro: { texto: 'erro', cor: 'bg-bad/15 text-bad' },
  nao_configurado: { texto: 'não configurado', cor: 'bg-surface-2 text-muted' },
  nao_verificado: { texto: 'não verificado', cor: 'bg-surface-2 text-muted' },
};

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

function ehConexao(v: unknown): v is ConexaoDoDigisac {
  return !!v && typeof v === 'object' && typeof (v as ConexaoDoDigisac).caminhoDoWebhook === 'string';
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

export function ConexaoDigisac({ token, gerenciar }: { token: string; gerenciar: boolean }) {
  const [c, setC] = useState<ConexaoDoDigisac | null>(null);
  const [saude, setSaude] = useState<Saude | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarRevogar, setConfirmarRevogar] = useState(false);
  const [servicos, setServicos] = useState<ServicoDoDigisac[] | null>(null);
  const [form, setForm] = useState({ url: '', token: '', servicoId: '', segredo: '' });

  const sondar = useCallback(() => {
    apiGet<Saude>('/integrations/digisac/saude', token)
      .then((s) => setSaude(s && typeof s === 'object' && 'estado' in s ? s : null))
      .catch(() => setSaude(null));
  }, [token]);

  const carregar = useCallback(() => {
    apiGet<ConexaoDoDigisac>('/integrations/digisac/conexao', token)
      .then((r) => {
        if (!ehConexao(r)) return;
        setC(r);
        setForm((f) => ({ ...f, url: f.url || r.url || '', servicoId: f.servicoId || r.servicoId || '' }));
      })
      .catch((e) => setErro(`Não foi possível carregar o DigiSac: ${(e as Error).message}`));
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
      const corpo: Record<string, string> = { url: form.url.trim(), servicoId: form.servicoId.trim() };
      if (form.token.trim()) corpo.token = form.token.trim();
      if (form.segredo.trim()) corpo.segredoDoWebhook = form.segredo.trim();
      const r = await apiPut<ConexaoDoDigisac>('/integrations/digisac/credencial', corpo, token);
      // O token e o segredo saem do formulário assim que o cofre os guarda.
      setForm((f) => ({ ...f, token: '', segredo: '' }));
      if (ehConexao(r)) setC(r);
      setAviso('Guardado no cofre da empresa.');
      sondar();
    });

  const listar = () =>
    fazer(async () => {
      const r = await apiGet<{ servicos: ServicoDoDigisac[] }>('/integrations/digisac/servicos', token);
      setServicos(r.servicos ?? []);
    });

  const revogar = () =>
    fazer(async () => {
      await apiPost('/integrations/digisac/revogacao', { motivo: 'Revogado no cartão do DigiSac' }, token);
      setConfirmarRevogar(false);
      setServicos(null);
      carregar();
    });

  if (!c) return erro ? <p className="text-sm text-bad">{erro}</p> : null;

  const origem = typeof window !== 'undefined' ? window.location.origin : '';
  const urlDoWebhook = `${origem}${c.caminhoDoWebhook}?${c.parametroDoSegredo}=`;
  const selo = c.desligado ? { texto: 'desligado', cor: 'bg-warn/15 text-warn' } : saude ? SELO[saude.estado] : SELO.nao_verificado;

  return (
    <section className="rounded-xl border border-border bg-surface p-5" aria-label="WhatsApp (DigiSac)">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[1.05rem] font-semibold text-text">WhatsApp (DigiSac)</h2>
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${selo.cor}`}>{selo.texto}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            O WhatsApp do comercial sai e chega pelo DigiSac quando a API usa o provedor digisac. O envio ao lead continua
            pedindo a assinatura de outra pessoa.
          </p>
          {saude?.mensagem && <p className="mt-1 text-xs text-muted">{saude.mensagem}{saude.verificadoEm ? ` (${quando(saude.verificadoEm)})` : ''}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={ocupado} onClick={sondar} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted disabled:opacity-50">
            Verificar
          </button>
          {gerenciar && c.tokenGuardado && (
            <button type="button" disabled={ocupado} onClick={() => setConfirmarRevogar(true)} className="rounded-lg border border-bad/40 px-3 py-1.5 text-xs text-bad disabled:opacity-50">
              Revogar
            </button>
          )}
        </div>
      </div>

      {confirmarRevogar && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
          <span className="text-text">Revogar queima o token, a conexão e o segredo do webhook no cofre. Nada sai nem entra até salvar de novo.</span>
          <button type="button" disabled={ocupado} onClick={() => void revogar()} className="font-medium text-bad disabled:opacity-50">confirmar</button>
          <button type="button" onClick={() => setConfirmarRevogar(false)} className="text-muted">cancelar</button>
        </div>
      )}
      {erro && <p className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{erro}</p>}
      {aviso && <p className="mt-3 rounded-lg border border-good/30 bg-good/10 px-3 py-2 text-xs text-good">{aviso}</p>}

      <dl className="mt-4 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted">Conta</dt>
        <dd className="text-text">{c.url ?? 'não configurada'}</dd>
        <dt className="text-muted">Conexão</dt>
        <dd className="text-text">{c.servicoId ?? 'não configurada'}</dd>
        <dt className="text-muted">Token</dt>
        <dd className="text-text">
          {c.tokenGuardado
            ? `guardado no cofre${c.tokenAtualizadoEm ? ` em ${quando(c.tokenAtualizadoEm)}` : ''}`
            : c.tokenRevogadoEm
              ? `revogado em ${quando(c.tokenRevogadoEm)}`
              : c.origem === 'ambiente'
                ? 'do ambiente da casa'
                : 'não guardado'}
        </dd>
        <dt className="text-muted">Segredo do webhook</dt>
        <dd className="text-text">{c.segredoDoWebhook ? 'configurado' : 'não configurado: as respostas do lead não entram'}</dd>
      </dl>

      {gerenciar && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <Campo rotulo="Endereço da conta">
            <input className={entrada} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://suaconta.digisac.me" autoComplete="off" />
          </Campo>
          <Campo rotulo="Id da conexão de WhatsApp">
            <input className={entrada} value={form.servicoId} onChange={(e) => setForm({ ...form, servicoId: e.target.value })} autoComplete="off" />
          </Campo>
          <Campo rotulo="Token de acesso (Conta › API › Tokens)">
            <input
              className={entrada}
              type="password"
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              placeholder={c.tokenGuardado ? 'guardado; deixe em branco para manter' : ''}
              autoComplete="new-password"
            />
          </Campo>
          <Campo rotulo="Segredo do webhook (32 ou mais caracteres)">
            <input
              className={entrada}
              type="password"
              value={form.segredo}
              onChange={(e) => setForm({ ...form, segredo: e.target.value })}
              placeholder={c.segredoDoWebhook ? 'configurado; deixe em branco para manter' : ''}
              autoComplete="new-password"
            />
          </Campo>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={ocupado} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50">
              Salvar no cofre
            </button>
            <button type="button" disabled={ocupado || c.origem === 'nenhuma'} onClick={() => void listar()} className="rounded-lg border border-border px-3 py-1.5 text-xs text-brand disabled:opacity-50">
              Listar conexões
            </button>
          </div>
        </form>
      )}

      {servicos && (
        <div className="mt-3 text-xs">
          <div className="text-[11px] uppercase tracking-wide text-muted">Conexões da conta</div>
          {servicos.length === 0 ? (
            <p className="mt-1 text-muted">A conta não tem conexões.</p>
          ) : (
            <ul className="mt-1 divide-y divide-border">
              {servicos.map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-text">{s.nome}</span>
                  <span className="text-muted">{s.tipo ?? ''}{s.arquivado ? ' · arquivada' : ''}</span>
                  <code className="font-mono text-[11px] text-muted">{s.id}</code>
                  {gerenciar && (
                    <button type="button" onClick={() => setForm({ ...form, servicoId: s.id })} className="text-brand">
                      usar esta
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 space-y-2 text-xs">
        <div className="text-[11px] uppercase tracking-wide text-muted">No DigiSac (Conta › API › Webhook)</div>
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-muted">URL</span>
          <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-text" data-testid="url-do-webhook-digisac">
            {urlDoWebhook}
          </code>
          <Copiar texto={urlDoWebhook} />
        </div>
        <p className="text-muted">
          Depois de <code className="font-mono">{c.parametroDoSegredo}=</code>, cole o segredo do webhook que você salvou acima. O formulário de
          webhook do DigiSac não tem cabeçalho próprio, por isso o segredo vai na URL; ele não aparece de novo nesta tela. Tipo
          Conexão, a mesma do id acima, com o evento de mensagem criada. Quem põe um intermediário pode mandar o segredo no
          cabeçalho <code className="font-mono">{c.cabecalhoDoSegredo}</code>.
        </p>
      </div>
    </section>
  );
}
