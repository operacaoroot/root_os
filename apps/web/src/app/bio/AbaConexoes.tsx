'use client';

import { useEffect, useState } from 'react';
import { Plug, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import type { BioConexaoRow, BioCredencialRow, Lista } from './tipos';
import { Botao, Campo, Card, Chip, inputCls, StatusConta } from './ui';

const PLATAFORMAS = [
  { v: 'instagram', label: 'Instagram' },
  { v: 'tiktok', label: 'TikTok' },
] as const;

export function AbaConexoes({
  token,
  editavel,
  podePublicar,
  admin,
  aviso,
  onErro,
}: {
  token: string | null;
  editavel: boolean;
  /** `pauta.publicar`: a conta de publicação só sai por quem pode conectá-la. */
  podePublicar: boolean;
  admin: boolean;
  aviso: string | null;
  onErro: (m: string) => void;
}) {
  const [conexoes, setConexoes] = useState<BioConexaoRow[]>([]);
  const [credenciais, setCredenciais] = useState<BioCredencialRow[]>([]);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (!token) return;
    apiGet<Lista<BioConexaoRow>>('/bio/connections', token)
      .then((r) => setConexoes(r.items))
      .catch((e: Error) => onErro(e.message));
    if (admin) {
      apiGet<Lista<BioCredencialRow>>('/bio/credentials', token)
        .then((r) => setCredenciais(r.items))
        .catch(() => undefined);
    }
  }, [token, admin, bump, onErro]);

  const conectar = (plataforma: string) =>
    apiGet<{ url: string }>(`/bio/connections/${plataforma}/start`, token)
      .then((r) => {
        window.location.href = r.url;
      })
      .catch((e: Error) => onErro(e.message));

  return (
    <div className="space-y-5">
      {aviso && <MensagemDeRetorno motivo={aviso} />}

      <Card titulo="Contas conectadas">
        <div className="space-y-2">
          {conexoes.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2"
            >
              <span className="text-sm">@{c.handle}</span>
              <Chip>{c.plataforma}</Chip>
              {c.finalidade === 'publicacao' && <Chip tone="brand">publicação</Chip>}
              <StatusConta status={c.status} />
              {c.expiraEm && (
                <span className="text-[11px] text-muted">
                  vence {new Date(c.expiraEm).toLocaleDateString('pt-BR')}
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted">
                {c._count.contas} conta(s) no desafio
              </span>
              {editavel && (c.finalidade !== 'publicacao' || podePublicar) && (
                <button
                  type="button"
                  title="Desconectar"
                  onClick={() =>
                    apiDelete(`/bio/connections/${c.id}`, token)
                      .then(() => setBump((b) => b + 1))
                      .catch((e: Error) => onErro(e.message))
                  }
                  className="text-muted hover:text-bad"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {conexoes.length === 0 && <p className="text-xs text-muted">Nenhuma conta conectada.</p>}
        </div>

        {editavel && (
          <div className="mt-4 flex gap-2 border-t border-border pt-4">
            {PLATAFORMAS.map((p) => (
              <Botao key={p.v} onClick={() => conectar(p.v)}>
                <span className="flex items-center gap-1.5">
                  <Plug size={13} /> Conectar {p.label}
                </span>
              </Botao>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted">
          O token fica cifrado e nunca é exibido de novo. A sincronização periódica é o que mantém a
          conexão do Instagram viva — ele expira de vez após 60 dias sem uso.
        </p>
      </Card>

      {admin && (
        <Card titulo="Credenciais dos apps">
          <div className="space-y-3">
            {credenciais.map((c) => (
              <LinhaCredencial
                key={c.plataforma}
                cred={c}
                onSalvar={(appId, segredo) =>
                  apiPost(`/bio/credentials/${c.plataforma}`, { appId, segredo, global: true }, token)
                    .then(() => setBump((b) => b + 1))
                    .catch((e: Error) => onErro(e.message))
                }
                onRemover={() =>
                  apiDelete(`/bio/credentials/${c.plataforma}?global=true`, token)
                    .then(() => setBump((b) => b + 1))
                    .catch((e: Error) => onErro(e.message))
                }
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function LinhaCredencial({
  cred,
  onSalvar,
  onRemover,
}: {
  cred: BioCredencialRow;
  onSalvar: (appId: string, segredo: string) => void;
  onRemover: () => void;
}) {
  const [appId, setAppId] = useState('');
  const [segredo, setSegredo] = useState('');
  const [abrir, setAbrir] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm capitalize">{cred.plataforma}</span>
        {cred.configurada ? (
          <Chip tone="good">{cred.origem}</Chip>
        ) : (
          <Chip tone="warn">não configurada</Chip>
        )}
        {cred.appIdParcial && <span className="text-[11px] text-muted">{cred.appIdParcial}</span>}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setAbrir((a) => !a)} className="text-[11px] text-brand hover:underline">
            {abrir ? 'cancelar' : cred.temGlobal ? 'substituir' : 'configurar'}
          </button>
          {cred.temGlobal && (
            <button type="button" onClick={onRemover} className="text-[11px] text-muted hover:text-bad">
              remover
            </button>
          )}
        </div>
      </div>

      {abrir && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Campo label={cred.plataforma === 'instagram' ? 'App ID' : 'Client key'}>
            <input className={inputCls} value={appId} onChange={(e) => setAppId(e.target.value)} />
          </Campo>
          <Campo label={cred.plataforma === 'instagram' ? 'App secret' : 'Client secret'}>
            <input
              type="password"
              className={inputCls}
              value={segredo}
              onChange={(e) => setSegredo(e.target.value)}
            />
          </Campo>
          <div className="flex items-end">
            <Botao
              tone="brand"
              onClick={() => {
                if (!appId.trim() || !segredo.trim()) return;
                onSalvar(appId.trim(), segredo.trim());
                setAppId('');
                setSegredo('');
                setAbrir(false);
              }}
            >
              Salvar
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}

function MensagemDeRetorno({ motivo }: { motivo: string }) {
  const texto: Record<string, string> = {
    ok: 'Conta conectada.',
    cancelado: 'Você cancelou a autorização na tela da plataforma.',
    expirado: 'O pedido de conexão expirou. Tente de novo.',
    sem_credencial: 'Falta cadastrar a credencial do app dessa plataforma.',
    conta_pessoal: 'Conta pessoal não tem API. Converta para Profissional (Criador ou Empresa) e tente de novo.',
    publicacao_perdida:
      'Conta conectada à bio. Ela era a conta de publicação, e esta autorização não inclui publicar: reconecte pela aba Semana da Pauta.',
    erro: 'Não foi possível concluir a conexão.',
  };
  const bom = motivo === 'ok';
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        bom ? 'border-good/40 bg-good/10 text-good' : 'border-warn/40 bg-warn/10 text-warn'
      }`}
    >
      {texto[motivo] ?? texto.erro}
    </div>
  );
}
