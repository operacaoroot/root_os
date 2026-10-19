'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SessaoHistoricaTracoSchema, type SessaoHistoricaTraco } from '@mktos/shared';
import { apiGet, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function Bloco({ n, titulo, children }: { n: string; titulo: string; children: React.ReactNode }) {
  return <section className="border-t border-border pt-4 first:border-0 first:pt-0">
    <h2 className="mb-2 font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted"><span className="text-dim">{n}</span> {titulo}</h2>
    {children}
  </section>;
}

export default function SessaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { token, ready, user } = useAuth();
  const [data, setData] = useState<{ token: string; versao: number; actorId: string; id: string; valor: SessaoHistoricaTraco } | null>(null);
  const [erro, setErro] = useState<{ token: string; versao: number; actorId: string; id: string; mensagem: string } | null>(null);
  const identidade = useRef<{ token: string | null; actorId: string | null; orgId: string | null }>({ token: null, actorId: null, orgId: null });
  const atual = useRef({ token, user, actorId: user?.id ?? null, ready, id, versao: 0 });
  if (atual.current.user !== user || atual.current.token !== token || atual.current.actorId !== (user?.id ?? null)
    || atual.current.ready !== ready || atual.current.id !== id)
    atual.current = { token, user, actorId: user?.id ?? null, ready, id, versao: atual.current.versao + 1 };
  const versao = atual.current.versao;
  if (!ready || identidade.current.token !== token || identidade.current.actorId !== (user?.id ?? null))
    identidade.current = { token, actorId: user?.id ?? null, orgId: null };
  const geracao = useRef(0);

  useEffect(() => {
    const n = ++geracao.current;
    setData(null); setErro(null);
    const actorId = user?.id;
    if (!ready || !token || !actorId) return;
    const vigente = () => geracao.current === n && atual.current.versao === versao && atual.current.ready && atual.current.token === token
      && atual.current.user === user && atual.current.actorId === actorId && atual.current.id === id;
    void apiGet<unknown>(`/sessions/${encodeURIComponent(id)}`, token).then((raw) => {
      if (!vigente()) return;
      const resposta = SessaoHistoricaTracoSchema.safeParse(raw);
      if (!resposta.success || resposta.data.escopo.actorId !== actorId || resposta.data.id !== id) throw new Error('resposta_invalida');
      const org = identidade.current.orgId;
      if (org !== null && org !== resposta.data.escopo.orgId) throw new Error('escopo_invalido');
      if (!vigente()) return;
      identidade.current.orgId = resposta.data.escopo.orgId;
      setData({ token, versao, actorId, id, valor: resposta.data });
    }).catch((e: unknown) => {
      if (!vigente()) return;
      setData(null);
      const mensagem = e instanceof ErroDaApi && [401, 403].includes(e.status)
        ? 'Acesso ao histórico indisponível. Entre novamente ou confira sua permissão.'
        : e instanceof ErroDaApi && e.status === 404 ? 'Execução indisponível.' : 'Não foi possível conferir o histórico.';
      setErro({ token, versao, actorId, id, mensagem });
    });
    return () => { if (geracao.current === n) geracao.current++; };
  }, [ready, token, user, id, versao]);

  const t = ready && token && user && data && data.token === token && data.versao === versao && data.actorId === user.id && data.id === id
    && data.valor.escopo.orgId === identidade.current.orgId ? data.valor : null;
  const erroAtual = ready && token && user && erro && erro.token === token && erro.versao === versao && erro.actorId === user.id && erro.id === id ? erro.mensagem : null;
  if (!ready || !token || !user) return <p className="text-sm text-muted">Entre para consultar o histórico.</p>;
  if (erroAtual) return <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erroAtual}</div>;
  if (!t) return <p className="text-sm text-muted">Carregando o histórico…</p>;
  const rastro = new URLSearchParams({ correlationId: t.id });

  return <div className="mx-auto max-w-3xl space-y-5">
    <div className="flex flex-wrap items-center gap-3">
      <Link href="/sessoes" aria-label="Voltar às sessões" className="text-muted hover:text-text"><ArrowLeft size={16} /></Link>
      <span className="font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        {t.canal} · {t.solicitante} → {t.agente?.nome ?? 'Referência do agente não conferida'}
      </span><span className="flex-1" />
      <span className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-dim">
        {(t.duracaoMs / 1000).toFixed(1)}s · {t.custoEstimado && t.custoUsd > 0 ? `US$ ${t.custoUsd.toFixed(4)}` : 'custo não medido'}
      </span>
    </div>
    <div className="rounded-root border border-border bg-surface p-3 text-[12px] leading-relaxed text-muted">
      {t.conteudo.estado === 'generico_local'
        ? 'Registro genérico de procedimento local. Fonte, argumentos e resultado privado não são exibidos neste histórico.'
        : t.conteudo.motivo === 'registro_inconsistente'
          ? 'O registro local não pôde ser conferido. Seu conteúdo permanece omitido.'
          : 'Conteúdo histórico não conferido. Fonte, argumentos e resultado permanecem omitidos.'}
      {t.vinculos.estado === 'parciais' && <p className="mt-2 text-warn">Há referências que não puderam ser conferidas; seus dados foram omitidos.</p>}
    </div>
    <div className="space-y-4 rounded-root border border-border bg-surface p-4">
      <Bloco n="01" titulo="o pedido"><p className="text-[13px] leading-[1.65] text-text">{t.blocos.pedido ?? 'Conteúdo histórico não conferido.'}</p></Bloco>
      <Bloco n="02" titulo="o contexto"><p className="text-[12px] text-muted">Fontes e texto de contexto são omitidos por esta leitura.</p></Bloco>
      <Bloco n="03" titulo="referências de ferramentas">
        <p className="mb-2 text-[12px] text-muted">Argumentos e resultados são omitidos. A ausência de referências conferidas não prova ausência de chamadas.</p>
        {t.blocos.ferramentas.length > 0 && <div className="overflow-x-auto"><table className="w-full font-os-mono text-[10.5px]"><tbody>
          {t.blocos.ferramentas.map((f, i) => <tr key={i} className="border-b border-border last:border-0">
            <td className="py-[6px] pr-3 text-text">{f.capacidade ?? 'Referência não conferida'}</td>
            <td className="py-[6px] pr-3 text-muted">{f.decisao ?? '—'}</td>
            <td className="py-[6px] text-right text-dim">{f.nivel ?? '—'} · {f.duracaoMs}ms</td>
          </tr>)}
        </tbody></table></div>}
      </Bloco>
      <Bloco n="04" titulo="decisões registradas">
        <p className="mb-2 text-[12px] text-muted">Motivos e gatilhos privados são omitidos.</p>
        {t.blocos.regua.decisoes.length > 0 ? <ul className="space-y-2">{t.blocos.regua.decisoes.map((d, i) =>
          <li key={i} className="text-[11.5px] leading-[1.55]">
            <span className="font-os-mono text-[10px] font-bold text-text">{d.nivel ?? '—'}</span>{' '}
            <span className="text-muted">{d.capacidade ?? 'Referência não conferida'} · {d.decisao ?? '—'}</span>
            {d.approvalId && <Link href="/atendimento" className="ml-1 text-brand hover:underline">na fila</Link>}
          </li>)}</ul> : <p className="text-[12px] text-muted">Não há referências de decisão conferidas para exibir.</p>}
      </Bloco>
      <Bloco n="05" titulo="o resultado"><p className="text-[13px] leading-[1.65] text-text">{t.blocos.resposta.texto ?? 'O resultado não é exibido por esta leitura.'}</p>
        {t.blocos.resposta.semProcedencia && <p className="mt-2 font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-warn">registro sinalizado como sem procedência</p>}
      </Bloco>
      <Bloco n="06" titulo="o registro"><p className="font-os-mono text-[10.5px] leading-[1.7] text-muted">
        {t.blocos.registro.passos} passo(s) registrados · {t.blocos.registro.toolCalls.length} referência(s) de ferramenta conferida(s)<br />
        <span className="text-dim">correlação </span>{t.id}
      </p><Link href={`/rastro?${rastro}`} className="mt-2 inline-block font-os-mono text-[10px] uppercase tracking-[0.1em] text-brand hover:underline">abrir no rastro</Link></Bloco>
    </div>
  </div>;
}
