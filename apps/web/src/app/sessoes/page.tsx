'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiGet, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SessaoHistoricaConsultaSchema, SessaoHistoricaListaSchema, type SessaoHistoricaLista } from '@mktos/shared';
import { KpiCard } from '@/components/KpiCard';

const CANAIS = ['web', 'telegram', 'whatsapp', 'rotina', 'terminal', 'mcp'];

const CORES: Record<string, string> = {
  respondida: 'text-good',
  executada: 'text-good',
  retida: 'text-warn',
  recusada: 'text-bad',
  falhou: 'text-bad',
  rodando: 'text-muted',
};

export default function SessoesPage() {
  const { token, ready, user } = useAuth();
  const [data, setData] = useState<{ token: string; versao: number; actorId: string; consulta: string; valor: SessaoHistoricaLista } | null>(null);
  const [erro, setErro] = useState<{ token: string; versao: number; actorId: string; consulta: string; mensagem: string } | null>(null);
  const [canal, setCanal] = useState('');
  const [agente, setAgente] = useState('');
  const consulta = SessaoHistoricaConsultaSchema.safeParse({ ...(canal ? { canal } : {}), ...(agente ? { agente } : {}) });
  const chave = consulta.success ? JSON.stringify(consulta.data) : 'consulta_invalida';
  const identidade = useRef<{ token: string | null; actorId: string | null; orgId: string | null }>({ token: null, actorId: null, orgId: null });
  const atual = useRef({ token, user, actorId: user?.id ?? null, ready, chave, versao: 0 });
  if (atual.current.user !== user || atual.current.token !== token || atual.current.actorId !== (user?.id ?? null)
    || atual.current.ready !== ready || atual.current.chave !== chave)
    atual.current = { token, user, actorId: user?.id ?? null, ready, chave, versao: atual.current.versao + 1 };
  const versao = atual.current.versao;
  if (!ready || identidade.current.token !== token || identidade.current.actorId !== (user?.id ?? null))
    identidade.current = { token, actorId: user?.id ?? null, orgId: null };
  const geracao = useRef(0);

  useEffect(() => {
    const n = ++geracao.current;
    setData(null); setErro(null);
    const actorId = user?.id;
    if (!ready || !token || !actorId) return;
    const pedido = SessaoHistoricaConsultaSchema.safeParse({ ...(canal ? { canal } : {}), ...(agente ? { agente } : {}) });
    const vigente = () => geracao.current === n && atual.current.versao === versao && atual.current.ready && atual.current.token === token
      && atual.current.user === user && atual.current.actorId === actorId && atual.current.chave === chave;
    if (!pedido.success) {
      setErro({ token, versao, actorId, consulta: chave, mensagem: 'Confira os filtros de sessões.' });
      return;
    }
    const q = new URLSearchParams();
    if (pedido.data.canal !== null) q.set('canal', pedido.data.canal);
    if (pedido.data.agente !== null) q.set('agente', pedido.data.agente);
    void apiGet<unknown>(`/sessions?${q}`, token).then((raw) => {
      if (!vigente()) return;
      const resposta = SessaoHistoricaListaSchema.safeParse(raw);
      if (!resposta.success || resposta.data.escopo.actorId !== actorId
        || JSON.stringify(resposta.data.consulta) !== JSON.stringify(pedido.data)) throw new Error('resposta_invalida');
      const org = identidade.current.orgId;
      if (org !== null && org !== resposta.data.escopo.orgId) throw new Error('escopo_invalido');
      if (!vigente()) return;
      identidade.current.orgId = resposta.data.escopo.orgId;
      setData({ token, versao, actorId, consulta: chave, valor: resposta.data });
    }).catch((e: unknown) => {
      if (!vigente()) return;
      setData(null);
      setErro({ token, versao, actorId, consulta: chave, mensagem: e instanceof ErroDaApi && [401, 403].includes(e.status)
        ? 'Acesso às sessões indisponível. Entre novamente ou confira sua permissão.' : 'Não foi possível conferir as sessões.' });
    });
    return () => { if (geracao.current === n) geracao.current++; };
  }, [ready, token, user, canal, agente, chave, versao]);

  const d = ready && token && user && data && data.token === token && data.versao === versao && data.actorId === user.id && data.consulta === chave
    && data.valor.escopo.orgId === identidade.current.orgId ? data.valor : null;
  const erroAtual = ready && token && user && erro && erro.token === token && erro.versao === versao && erro.actorId === user.id && erro.consulta === chave ? erro.mensagem : null;

  if (!ready || !token || !user) return <p className="text-sm text-muted">Entre para consultar as sessões.</p>;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Consulte os metadados das sessões. Fontes e conteúdo privado permanecem omitidos neste histórico.
      </p>

      {erroAtual && (
        <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erroAtual}</div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <KpiCard label="Sessões no filtro" value={d?.kpis.sessoes ?? '—'} icon="Bot" />
        <KpiCard
          label="Custo somado"
          value={
            !d
              ? '—'
              : d.kpis.custoUsd > 0
                ? `US$ ${d.kpis.custoUsd.toFixed(4)}`
                : 'não medido'
          }
          hint={d?.kpis.custoParcial ? 'parcial: há sessão com custo não medido' : undefined}
          icon="Coins"
        />
        <KpiCard
          label="Sem procedência"
          value={d?.kpis.semProcedencia ?? '—'}
          hint="resposta com número e sem fonte"
          tone={d && d.kpis.semProcedencia > 0 ? 'warn' : 'default'}
          icon="ShieldAlert"
        />
      </div>

      <div className="flex flex-wrap items-center gap-[6px]">
        <button
          type="button"
          onClick={() => setCanal('')}
          className={`rounded-root border px-[9px] py-[5px] font-os-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${canal === '' ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-text'}`}
        >
          todo canal
        </button>
        {CANAIS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCanal(c)}
            className={`rounded-root border px-[9px] py-[5px] font-os-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${canal === c ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-text'}`}
          >
            {c}
          </button>
        ))}
        {agente && (
          <button
            type="button"
            onClick={() => setAgente('')}
            className="rounded-root border border-brand bg-brand/10 px-[9px] py-[5px] font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-brand"
          >
            {agente} ✕
          </button>
        )}
      </div>

      <div className="rounded-root border border-border bg-surface">
        {!d && !erroAtual && <p className="p-4 text-sm text-muted">Carregando as sessões…</p>}
        {d?.items.length === 0 && (
          <p className="p-4 text-sm text-muted">
            {d.total === 0 ? 'Nenhuma sessão neste filtro.' : 'A contagem registrou sessões, mas esta leitura não retornou itens. Selecione o filtro novamente para conferir.'}
          </p>
        )}
        {d?.items.map((s) => (
          <Link
            key={s.id}
            href={`/sessoes/${encodeURIComponent(s.id)}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border p-3 last:border-0 hover:bg-surface-2"
          >
            <span className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-dim">
              {new Date(s.criadaEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">
              {s.canal}
            </span>
            <span className="text-[11px] text-muted">
              {s.solicitante} → {s.agente?.nome ?? 'Referência do agente não conferida'}
            </span>
            <span className="min-w-0 flex-1 basis-full truncate text-[12.5px] text-text sm:basis-auto">
              {s.pedido ?? 'Conteúdo histórico não conferido'}
            </span>
            <span className="font-os-mono text-[9.5px] text-dim">
              {s.passos} passo{s.passos === 1 ? '' : 's'} · {(s.duracaoMs / 1000).toFixed(1)}s ·{' '}
              {s.custoEstimado && s.custoUsd > 0 ? `US$ ${s.custoUsd.toFixed(4)}` : 'não medido'}
            </span>
            {s.nivelMax && (
              <span className="rounded-root bg-surface-3 px-[5px] py-px font-os-mono text-[9px] font-bold text-muted">
                {s.nivelMax}
              </span>
            )}
            <span className={`font-os-mono text-[9.5px] uppercase tracking-[0.1em] ${CORES[s.status] ?? 'text-muted'}`}>
              {s.status}
            </span>
            {s.vinculos.estado === 'parciais' && <span className="text-[10px] text-warn">referências parciais</span>}
            {s.semProcedencia && (
              <span className="font-os-mono text-[9px] uppercase tracking-[0.1em] text-warn">
                sem fonte
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
