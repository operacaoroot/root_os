'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [conexoes, setConexoes] = useState<{ versao: number; items: BioConexaoRow[] } | null>(null);
  const [credenciais, setCredenciais] = useState<{ versao: number; items: BioCredencialRow[] } | null>(null);
  const [resultado, setResultado] = useState<{ versao: number; texto: string } | null>(null);
  const [bump, setBump] = useState(0);
  const montado = useRef(false);
  const sessao = useRef({ token, admin, editavel, podePublicar, versao: 0 });
  if (
    sessao.current.token !== token || sessao.current.admin !== admin ||
    sessao.current.editavel !== editavel || sessao.current.podePublicar !== podePublicar
  ) {
    sessao.current = { token, admin, editavel, podePublicar, versao: sessao.current.versao + 1 };
  }
  const atual = (versao: number) => montado.current && sessao.current.versao === versao;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      sessao.current.versao += 1;
    };
  }, []);

  useEffect(() => setResultado(null), [token, admin]);

  useEffect(() => {
    if (!token) return;
    const versao = sessao.current.versao;
    let vivo = true;
    apiGet<Lista<BioConexaoRow>>('/bio/connections', token)
      .then((r) => { if (vivo && atual(versao)) setConexoes({ versao, items: r.items }); })
      .catch((e: Error) => { if (vivo && atual(versao)) onErro(e.message); });
    if (admin) {
      apiGet<Lista<BioCredencialRow>>('/bio/credentials', token)
        .then((r) => { if (vivo && atual(versao)) setCredenciais({ versao, items: r.items }); })
        .catch((e: Error) => { if (vivo && atual(versao)) onErro(e.message); });
    }
    return () => { vivo = false; };
  }, [token, admin, editavel, podePublicar, bump, onErro]);

  const conectar = (plataforma: string) => {
    const versao = sessao.current.versao;
    apiGet<{ url: string }>(`/bio/connections/${plataforma}/start`, token)
      .then((r) => {
        if (atual(versao)) window.location.href = r.url;
      })
      .catch((e: Error) => { if (atual(versao)) onErro(e.message); });
  };

  const desconectar = (id: string) => {
    const versao = sessao.current.versao;
    apiDelete(`/bio/connections/${id}`, token)
      .then(() => { if (atual(versao)) setBump((b) => b + 1); })
      .catch((e: Error) => { if (atual(versao)) onErro(e.message); });
  };

  const salvar = async (plataforma: string, appId: string, segredo: string, global: boolean) => {
    const versao = sessao.current.versao;
    setResultado(null);
    try {
      await apiPost(`/bio/credentials/${plataforma}`, { appId, segredo, global }, token);
      if (!atual(versao)) return false;
      setResultado({ versao, texto: `Cadastro do app ${plataforma} ${global ? 'compartilhado' : 'desta empresa'} salvo. Faça o login na plataforma para autorizar o novo app.` });
      setBump((b) => b + 1);
      return true;
    } catch (e) {
      if (atual(versao)) onErro((e as Error).message);
      return false;
    }
  };

  const remover = async (plataforma: string, global: boolean) => {
    const versao = sessao.current.versao;
    setResultado(null);
    try {
      await apiDelete(`/bio/credentials/${plataforma}${global ? '?global=true' : ''}`, token);
      if (!atual(versao)) return false;
      setResultado({ versao, texto: `App ${plataforma} ${global ? 'compartilhado' : 'desta empresa'} removido.` });
      setBump((b) => b + 1);
      return true;
    } catch (e) {
      if (atual(versao)) onErro((e as Error).message);
      return false;
    }
  };

  const conexoesAtuais = conexoes?.versao === sessao.current.versao ? conexoes.items : [];
  const credenciaisAtuais = admin && credenciais?.versao === sessao.current.versao ? credenciais.items : [];

  return (
    <div className="space-y-5">
      {aviso && <MensagemDeRetorno motivo={aviso} />}
      {resultado?.versao === sessao.current.versao && <p role="status" className="rounded-lg border border-good/40 bg-good/10 px-4 py-3 text-sm text-good">{resultado.texto}</p>}

      <Card titulo="Contas conectadas">
        <div className="space-y-2">
          {conexoesAtuais.map((c) => (
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
                  onClick={() => desconectar(c.id)}
                  className="text-muted hover:text-bad"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {conexoesAtuais.length === 0 && <p className="text-xs text-muted">Nenhuma conta conectada.</p>}
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
            {credenciaisAtuais.map((c) => (
              <LinhaCredencial
                key={`${token}:${c.plataforma}`}
                cred={c}
                onSalvar={(appId, segredo, global) => salvar(c.plataforma, appId, segredo, global)}
                onRemover={(global) => remover(c.plataforma, global)}
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
  onSalvar: (appId: string, segredo: string, global: boolean) => Promise<boolean>;
  onRemover: (global: boolean) => Promise<boolean>;
}) {
  const [appId, setAppId] = useState('');
  const [segredo, setSegredo] = useState('');
  const [abrir, setAbrir] = useState(false);
  const [escopo, setEscopo] = useState<'empresa' | 'global'>('empresa');
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const salvar = async () => {
    if (!appId.trim() || !segredo.trim() || ocupado) return;
    setOcupado(true);
    try {
      if (await onSalvar(appId.trim(), segredo.trim(), escopo === 'global')) {
        setAppId('');
        setSegredo('');
        setAbrir(false);
      }
    } finally {
      setOcupado(false);
    }
  };

  const remover = async () => {
    if (!confirmar || ocupado) return;
    setOcupado(true);
    try {
      if (await onRemover(true)) setConfirmar(false);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div role="group" aria-label={`Credencial ${cred.plataforma}`} className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm capitalize">{cred.plataforma}</span>
        {cred.configurada ? (
          <Chip tone="good">{cred.origem}</Chip>
        ) : (
          <Chip tone="warn">não configurada</Chip>
        )}
        {cred.appIdParcial && <span className="text-[11px] text-muted">{cred.appIdParcial}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => { setAbrir((a) => !a); setConfirmar(false); setEscopo('empresa'); }}
            className="text-[11px] text-brand hover:underline disabled:opacity-50"
          >
            {abrir ? 'cancelar edição' : 'configurar app'}
          </button>
          {cred.temGlobal && (
            <button type="button" disabled={ocupado} onClick={() => { setConfirmar(true); setAbrir(false); }} className="text-[11px] text-muted hover:text-bad disabled:opacity-50">
              remover app compartilhado
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {cred.origem === 'perfil'
          ? 'App desta empresa cadastrado.'
          : cred.origem === 'global'
            ? 'App compartilhado disponível nesta empresa.'
            : cred.origem === 'ambiente'
              ? 'App do ambiente disponível nesta empresa.'
              : 'Nenhum app disponível nesta empresa.'}
        {cred.temDoPerfil && cred.temGlobal && ' O app compartilhado só é considerado quando não há app da empresa; editá-lo não troca o cadastro da empresa.'}
      </p>

      {confirmar && (
        <div className="mt-3 rounded-lg border border-bad/40 bg-bad/5 p-3 text-xs">
          <p>Remover o app compartilhado? A conta conectada permanece, mas novas autorizações podem precisar de outro app.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Botao tone="bad" disabled={ocupado} onClick={remover}>Confirmar remoção do compartilhado</Botao>
            <Botao disabled={ocupado} onClick={() => setConfirmar(false)}>Cancelar</Botao>
          </div>
        </div>
      )}

      {abrir && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Campo label="Onde salvar o app">
            <select className={inputCls} value={escopo} disabled={ocupado} onChange={(e) => setEscopo(e.target.value as 'empresa' | 'global')}>
              <option value="empresa">Desta empresa</option>
              <option value="global">Compartilhado entre empresas</option>
            </select>
          </Campo>
          <p className="self-end text-[11px] text-muted sm:col-span-2">{escopo === 'global' && cred.temDoPerfil ? 'O app desta empresa continuará cadastrado. O compartilhado só será considerado quando não houver app da empresa.' : 'Salvar o app não reconecta a conta. Depois, faça o login na plataforma.'}</p>
          <Campo label={cred.plataforma === 'instagram' ? 'App ID' : 'Client key'}>
            <input className={inputCls} value={appId} disabled={ocupado} onChange={(e) => setAppId(e.target.value)} />
          </Campo>
          <Campo label={cred.plataforma === 'instagram' ? 'App secret' : 'Client secret'}>
            <input
              type="password"
              autoComplete="new-password"
              className={inputCls}
              value={segredo}
              disabled={ocupado}
              onChange={(e) => setSegredo(e.target.value)}
            />
          </Campo>
          <div className="flex items-end">
            <Botao
              tone="brand"
              disabled={ocupado || !appId.trim() || !segredo.trim()}
              onClick={salvar}
            >
              {ocupado ? 'Salvando…' : `Salvar app ${escopo === 'empresa' ? 'desta empresa' : 'compartilhado'}`}
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
    publicacao_mantida:
      'Esta conta é a de publicação da empresa, e a conexão pela bio não a troca nem tira dela o publicar: nada mudou. Para reconectar, use a aba Semana da Pauta.',
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
