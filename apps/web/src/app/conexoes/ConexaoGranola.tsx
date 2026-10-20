'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConexaoDoGranola, SenhaDoGranola, TrabGranolaConexaoDireta } from '@mktos/shared';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { abrirFicha } from '@/lib/ficha';

/*
 * O GRANOLA EM CONEXÕES. Granola → Zapier → OS: a nota que cai na pasta do
 * Granola vira um POST do Zap, e o OS grava a reunião na ficha do cliente.
 * Daqui se liga e desliga (o mesmo interruptor dos outros conectores), se gera
 * ou troca a senha do Zap (guardada cifrada no cofre, mostrada uma vez) e se vê
 * o que chegou.
 *
 * O MODO DIRETO (rodada da interface, 20/10/2026): "Conectar ao Granola" abre a
 * autorização do Granola no navegador (OAuth do servidor MCP dele, verbo
 * `autorizar` do contrato). O retorno cai numa rota do OS, o token vai para o
 * cofre da empresa, e a tela volta para cá com `?granola=<motivo>`. Daí em
 * diante, Trabalho › Atas lista as reuniões e gera a ata da transcrição. O Zap
 * continua funcionando como antes, ao lado.
 */

const RETORNO_DO_GRANOLA: Record<string, { texto: string; bom: boolean }> = {
  ok: { texto: 'Granola conectado. As reuniões aparecem em Trabalho › Atas.', bom: true },
  cancelado: { texto: 'A autorização foi cancelada na tela do Granola. Nada mudou.', bom: false },
  expirado: { texto: 'A autorização expirou antes de voltar. Clique em "Conectar ao Granola" de novo.', bom: false },
  sem_cofre: { texto: 'O cofre não está de pé neste servidor: a autorização não foi guardada.', bom: false },
  erro: { texto: 'O Granola não completou a autorização. Tente de novo; se repetir, avise quem cuida das integrações.', bom: false },
};

function retornoDoEndereco(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('granola');
}

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
  const [confirmar, setConfirmar] = useState<'desligar' | 'revogar' | 'trocar' | 'desconectar' | null>(null);
  const [direto, setDireto] = useState<TrabGranolaConexaoDireta | null>(null);
  const [retorno] = useState<string | null>(() => retornoDoEndereco());

  const carregar = useCallback(() => {
    // Resposta sem o formato do painel (API antiga, dublê de teste) não derruba a tela de Conexões: o cartão some.
    apiGet<ConexaoDoGranola | null>('/trabalho/fichas/granola/conexao', token)
      .then((x) => setC(x && typeof x === 'object' && x.senha ? x : null))
      .catch((e) => setErro((e as Error).message));
    apiGet<TrabGranolaConexaoDireta | null>('/trabalho/granola/direto', token)
      .then((d) => setDireto(d && typeof d.conectado === 'boolean' ? d : null))
      .catch(() => setDireto(null));
  }, [token]);

  const conectarDireto = async () => {
    const r = await apiPost<{ tipo: string; url?: string; instrucao?: string; detalhe?: string; motivo?: string }>('/integrations/granola/autorizacao', {}, token);
    if (r.tipo === 'redirecionar' && r.url) {
      window.location.assign(r.url);
      return;
    }
    if (r.tipo !== 'pronto') throw new Error(r.instrucao ?? r.motivo ?? 'O Granola não devolveu a página de autorização.');
  };

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
      : direto?.conectado
        ? { texto: 'Conectado direto', cor: 'bg-good/15 text-good' }
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
            {(c.senha.ativa || direto?.conectado) && (
              <button type="button" disabled={ocupado} onClick={() => setConfirmar('revogar')}
                className="rounded-lg border border-bad/40 px-3 py-1.5 text-xs text-bad disabled:opacity-50">Revogar tudo</button>
            )}
          </div>
        )}
      </div>

      {confirmar && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
          <span className="text-text">
            {confirmar === 'desligar' && 'Desligar: o OS recusa o que o Zap mandar até religar. A senha continua guardada.'}
            {confirmar === 'trocar' && 'Trocar: a senha atual para de valer agora. O Zap só volta a entrar com a nova.'}
            {confirmar === 'revogar' && 'Revogar tudo: a senha do Zap e a conexão direta são queimadas, o Zap para e o OS para de ler o Granola na hora. Para voltar, gere outra senha ou conecte de novo.'}
            {confirmar === 'desconectar' && 'Desconectar: a autorização direta é queimada e o OS para de ler as reuniões. O Zap continua com a senha dele.'}
          </span>
          <button type="button" disabled={ocupado} className="font-medium text-bad disabled:opacity-50"
            onClick={() => void fazer(async () => {
              if (confirmar === 'desligar') await apiPost('/integrations/granola/desligamento', { motivo: 'Desligado no painel do Granola' }, token);
              if (confirmar === 'revogar') await apiPost('/integrations/granola/revogacao', { motivo: 'Revogada no painel do Granola' }, token);
              if (confirmar === 'trocar') setSenha(await apiPost<SenhaDoGranola>('/trabalho/fichas/granola/senha', {}, token));
              if (confirmar === 'desconectar') await apiPost('/trabalho/granola/direto/revogacao', { motivo: 'Desconectada no painel do Granola' }, token);
            })}>
            confirmar
          </button>
          <button type="button" onClick={() => setConfirmar(null)} className="text-muted">cancelar</button>
        </div>
      )}
      {erro && <p className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{erro}</p>}
      {retorno && RETORNO_DO_GRANOLA[retorno] && (
        <p role="status" data-testid="granola-retorno"
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${RETORNO_DO_GRANOLA[retorno].bom ? 'border-good/30 bg-good/10 text-good' : 'border-warn/40 bg-warn/5 text-text'}`}>
          {RETORNO_DO_GRANOLA[retorno].texto}
        </p>
      )}

      <div data-testid="granola-direto" className="mt-4 rounded-lg border border-border bg-surface-2 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-muted">Conexão direta (MCP do Granola)</span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${direto?.conectado ? 'bg-good/15 text-good' : 'bg-surface text-muted'}`}>
                {direto?.conectado ? 'Conectado' : 'Não conectado'}
              </span>
            </div>
            <p className="mt-1 text-muted">
              {direto?.conectado
                ? `Autorizado${direto.desde ? ` em ${quando(direto.desde)}` : ''}. Trabalho › Atas lista as reuniões e gera a ata da transcrição, que não fica guardada.`
                : 'Quem tem conta no Granola autoriza no navegador; o token fica no cofre desta empresa. Depois, Trabalho › Atas lê as reuniões direto.'}
            </p>
          </div>
          {gerenciar && (
            direto?.conectado ? (
              <button type="button" disabled={ocupado} onClick={() => setConfirmar('desconectar')}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted disabled:opacity-50">Desconectar</button>
            ) : (
              <button type="button" data-testid="granola-conectar" disabled={ocupado || c.desligado} onClick={() => void fazer(conectarDireto)}
                title={c.desligado ? 'Religue o Granola antes de conectar.' : undefined}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50">Conectar ao Granola</button>
            )
          )}
        </div>
        {direto && !direto.conectado && gerenciar && (
          <p className="mt-2 text-muted">
            Endereço de retorno que o OS registra no Granola: <code className="font-mono text-[11px] text-text">{direto.retorno}</code>
          </p>
        )}
      </div>

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
