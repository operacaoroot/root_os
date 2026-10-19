'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConexaoDoGranola, SenhaDoGranola } from '@mktos/shared';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { abrirFicha } from '@/lib/ficha';

/*
 * O GRANOLA EM CONEXÕES. Granola → Zapier → OS: a nota que cai na pasta do
 * Granola vira um POST do Zap, e o OS grava a reunião na ficha do cliente.
 * Daqui se liga e desliga (o mesmo interruptor dos outros conectores), se gera
 * ou troca a senha do Zap (guardada cifrada no cofre, mostrada uma vez) e se vê
 * o que chegou.
 */

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

function Numero({ rotulo, valor, href }: { rotulo: string; valor: number; href?: string }) {
  const corpo = (
    <>
      <div className="text-[11px] uppercase tracking-wide text-muted">{rotulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-text">{valor}</div>
    </>
  );
  return href ? (
    <a href={href} className="rounded-lg border border-border bg-surface-2 px-3 py-2 hover:border-brand">{corpo}</a>
  ) : (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">{corpo}</div>
  );
}

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}
      className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] text-brand"
    >
      {ok ? 'copiado' : 'copiar'}
    </button>
  );
}

export function ConexaoGranola({ token, gerenciar }: { token: string; gerenciar: boolean }) {
  const [c, setC] = useState<ConexaoDoGranola | null>(null);
  const [senha, setSenha] = useState<SenhaDoGranola | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<'desligar' | 'revogar' | 'trocar' | null>(null);

  const carregar = useCallback(() => {
    apiGet<ConexaoDoGranola>('/trabalho/fichas/granola/conexao', token).then(setC).catch((e) => setErro((e as Error).message));
  }, [token]);

  useEffect(() => carregar(), [carregar]);

  const fazer = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      setConfirmar(null);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  if (!c) return erro ? <p className="text-sm text-bad">{erro}</p> : null;

  const endereco = `${typeof window !== 'undefined' ? window.location.origin : ''}${c.caminho}`;
  const estado = c.desligado
    ? { texto: 'Desligado', cor: 'bg-warn/15 text-warn' }
    : c.senha.ativa
      ? { texto: 'Recebendo', cor: 'bg-good/15 text-good' }
      : { texto: 'Sem senha', cor: 'bg-surface-2 text-muted' };

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[1.05rem] font-semibold text-text">Granola · reuniões dos clientes</h2>
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${estado.cor}`}>{estado.texto}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            A nota que cai na pasta do Granola vai pelo Zapier até o OS, que grava a reunião na ficha do cliente.
          </p>
        </div>
        {gerenciar && (
          <div className="flex flex-wrap gap-2">
            {c.desligado ? (
              <button type="button" disabled={ocupado} onClick={() => void fazer(() => apiDelete('/integrations/granola/desligamento', token))}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50">Ligar</button>
            ) : (
              <button type="button" disabled={ocupado} onClick={() => setConfirmar('desligar')}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted disabled:opacity-50">Desligar</button>
            )}
            <button type="button" disabled={ocupado} onClick={() => (c.senha.ativa ? setConfirmar('trocar') : void fazer(async () => setSenha(await apiPost<SenhaDoGranola>('/trabalho/fichas/granola/senha', {}, token))))}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-brand disabled:opacity-50">
              {c.senha.ativa ? 'Trocar senha' : 'Gerar senha'}
            </button>
            {c.senha.ativa && (
              <button type="button" disabled={ocupado} onClick={() => setConfirmar('revogar')}
                className="rounded-lg border border-bad/40 px-3 py-1.5 text-xs text-bad disabled:opacity-50">Revogar senha</button>
            )}
          </div>
        )}
      </div>

      {confirmar && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
          <span className="text-text">
            {confirmar === 'desligar' && 'Desligar: o OS recusa o que o Zap mandar até religar. A senha continua guardada.'}
            {confirmar === 'trocar' && 'Trocar: a senha atual para de valer agora. O Zap só volta a entrar com a nova.'}
            {confirmar === 'revogar' && 'Revogar: a senha é queimada e o Zap para na hora. Para voltar, gere outra.'}
          </span>
          <button type="button" disabled={ocupado} className="font-medium text-bad disabled:opacity-50"
            onClick={() => void fazer(async () => {
              if (confirmar === 'desligar') await apiPost('/integrations/granola/desligamento', { motivo: 'Desligado no painel do Granola' }, token);
              if (confirmar === 'revogar') await apiPost('/integrations/granola/revogacao', { motivo: 'Revogada no painel do Granola' }, token);
              if (confirmar === 'trocar') setSenha(await apiPost<SenhaDoGranola>('/trabalho/fichas/granola/senha', {}, token));
            })}>
            confirmar
          </button>
          <button type="button" onClick={() => setConfirmar(null)} className="text-muted">cancelar</button>
        </div>
      )}
      {erro && <p className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{erro}</p>}

      {senha && (
        <div className="mt-3 rounded-lg border border-brand/50 bg-surface-2 p-3 text-xs">
          <p className="font-medium text-text">Senha nova. Copie agora para o Zap: ela não aparece de novo.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-[12px] text-text">{senha.senha}</code>
            <Copiar texto={senha.senha} />
          </div>
          <button type="button" onClick={() => setSenha(null)} className="mt-2 text-muted underline">já colei no Zap, esconder</button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-md">
        <Numero rotulo="Recebidas" valor={c.total} />
        <Numero rotulo="Últimos 30 dias" valor={c.ultimos30Dias} />
        <Numero rotulo="Esperando cliente" valor={c.semCliente} href={c.semCliente ? '/leads' : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 text-xs">
          <div className="text-[11px] uppercase tracking-wide text-muted">No Zap (Webhooks by Zapier · POST · json)</div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-muted">URL</span>
            <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-text">{endereco}</code>
            <Copiar texto={endereco} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-muted">Cabeçalho</span>
            <code className="rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-text">{c.cabecalho}</code>
            <span className="text-muted">= a senha</span>
          </div>
          <p className="text-muted">
            Campos: title, transcript, my_notes, attendees, start_time, link.
            {' '}Senha {c.senha.ativa ? `ativa${c.senha.usadaEm ? `, último uso em ${quando(c.senha.usadaEm)}` : ', ainda não usada'}` : c.senha.revogadaEm ? `revogada em ${quando(c.senha.revogadaEm)}` : 'ainda não gerada'}.
            {c.desligado && ` Desligado em ${quando(c.desligadoEm)}.`}
          </p>
          <p className="text-muted">O OS acha o cliente pelo e-mail, pelo domínio do e-mail ou pelo nome. Preencha o E-mail ou o Site na ficha.</p>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">O que chegou</div>
          {c.ultimas.length === 0 ? (
            <p className="mt-2 text-xs text-muted">Nenhuma reunião recebida pelo Zap ainda.</p>
          ) : (
            <ul className="mt-1 divide-y divide-border text-xs">
              {c.ultimas.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-1.5">
                  <span className="w-24 shrink-0 tabular-nums text-muted">{quando(r.recebidaEm)}</span>
                  <span className="min-w-0 flex-1 truncate text-text" title={r.titulo}>{r.titulo}</span>
                  {r.taskId ? (
                    <button type="button" onClick={() => abrirFicha(r.taskId!)} className="max-w-[40%] truncate text-brand" title={r.cliente ?? ''}>{r.cliente}</button>
                  ) : (
                    <a href="/leads" className="text-warn">sem cliente</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
