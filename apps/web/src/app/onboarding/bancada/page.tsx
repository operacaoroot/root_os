'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, Chip, Kpi } from '../../referencias/ui';
import {
  ORDEM_DAS_FASES,
  ROTULO_DA_FASE,
  dataBR,
  type Fase,
  type Pendencia,
  type TrilhoResumo,
} from '../tipos';

/*
 * A BANCADA ANTIGA — a lista dos trilhos por fase (docs/ONBOARDING.md).
 *
 * Desde a rodada do trabalho (T1, 19/10/2026) ela deixou de ser porta: o item
 * "Implantação de clientes" abre o kanban da lista "Onboarding de cliente"
 * (`/trabalho/implantacao`), `/onboarding` redireciona para lá e o trilho de
 * cada cliente é a aba "Trilho" do pop-up do cartão. Esta tela segue viva, só
 * de leitura do resumo, e não cria mais cliente: o cliente nasce do contrato
 * assinado no comercial (ou de "Registrar cliente já fechado", no Funil vivo).
 */

export default function OnboardingPage() {
  const { token, ready } = useAuth();
  const [trilhos, setTrilhos] = useState<TrilhoResumo[] | null>(null);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarEncerrados, setMostrarEncerrados] = useState(false);

  const carregar = useCallback(() => {
    if (!token) return;
    Promise.all([
      apiGet<TrilhoResumo[]>('/tenants/onboarding/trilhos', token),
      apiGet<Pendencia[]>('/tenants/onboarding/trilhos/pendencias', token),
    ])
      .then(([t, p]) => {
        setTrilhos(t);
        setPendencias(p);
      })
      .catch((e: Error) => setErro(e.message));
  }, [token]);

  useEffect(() => {
    if (ready) carregar();
  }, [ready, carregar]);

  if (!ready) return null;
  if (!trilhos) return <p className="text-sm text-muted">{erro ?? 'carregando…'}</p>;

  const abertos = trilhos.filter((t) => t.fase !== 'encerrado');
  const esperandoOk = abertos.reduce((n, t) => n + t.itens.pendentesDeAprovacao, 0);
  const semPasso = abertos.filter((t) => !t.proximoPasso).length;
  const nomeDo = (id: string) => trilhos.find((t) => t.id === id)?.cliente ?? id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Implantação de clientes</h1>
          <p className="text-sm text-muted">A esteira de entrega em cinco fases, com portão entre elas. O trilho não deixa avançar sem o portão cumprido.</p>
        </div>
        <Link href="/trabalho/implantacao" className="text-sm text-muted underline underline-offset-2 hover:text-text">abrir o kanban da implantação</Link>
      </div>

      {erro && <p className="text-sm text-bad">{erro}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Trilhos abertos" valor={abertos.length} />
        <Kpi label="Pendências do relógio" valor={pendencias.length} />
        <Kpi label="Propostas esperando o seu OK" valor={esperandoOk} />
        <Kpi label="Sem próximo passo" valor={semPasso} />
      </div>

      {pendencias.length > 0 && (
        <Card titulo="O relógio — o que está vencido hoje">
          <ul className="space-y-1.5">
            {pendencias.map((p, i) => (
              <li key={`${p.trilhoId}-${p.tipo}-${i}`} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                <Chip tone={p.tipo.startsWith('convite') ? 'warn' : p.tipo.startsWith('alerta') ? 'bad' : 'muted'}>{p.tipo}</Chip>
                <Link href={`/onboarding/${p.trilhoId}`} className="underline underline-offset-2">{nomeDo(p.trilhoId)}</Link>
                <span className="text-muted">{p.texto}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {ORDEM_DAS_FASES.filter((f) => f !== 'encerrado' || mostrarEncerrados).map((fase) => {
          const daFase = trilhos.filter((t) => t.fase === fase);
          return (
            <Card key={fase} titulo={`${ROTULO_DA_FASE[fase]} · ${daFase.length}`}>
              {daFase.length === 0 ? (
                <p className="text-[12px] text-muted">ninguém nesta fase.</p>
              ) : (
                <ul className="space-y-2">
                  {daFase.map((t) => <LinhaDoTrilho key={t.id} t={t} />)}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      <button type="button" onClick={() => setMostrarEncerrados((v) => !v)} className="text-[11px] text-muted underline underline-offset-2">
        {mostrarEncerrados ? 'esconder encerrados' : `mostrar encerrados (${trilhos.filter((t) => t.fase === 'encerrado').length})`}
      </button>
    </div>
  );
}

function LinhaDoTrilho({ t }: { t: TrilhoResumo }) {
  const fase: Fase = t.fase;
  return (
    <li className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/onboarding/${t.id}`} className="font-medium underline-offset-2 hover:underline">{t.cliente}</Link>
        <div className="flex flex-wrap justify-end gap-1">
          {t.perfil && <Chip tone="muted">{t.perfil}</Chip>}
          {t.nivelRotulo && <Chip tone="brand">{t.nivelRotulo}</Chip>}
          {t.pendencias > 0 && <Chip tone="warn">{t.pendencias} pend.</Chip>}
          {t.itens.pendentesDeAprovacao > 0 && <Chip tone="warn">{t.itens.pendentesDeAprovacao} p/ aprovar</Chip>}
        </div>
      </div>
      <div className="mt-1 text-[11.5px] text-muted">
        {t.contatoNome ?? 'sem contato'} · conduz {t.conduzidoPor ?? '?'}
        {fase === 'qualificar' && t.reuniaoEm ? ` · reunião ${dataBR(t.reuniaoEm)}` : ''}
        {fase === 'contrato' && t.kickoffEm ? ` · kickoff ${dataBR(t.kickoffEm)}` : ''}
        {fase === 'imersao' && t.imersaoEm ? ` · imersão ${dataBR(t.imersaoEm)}` : ''}
      </div>
      <div className="mt-1 text-[12px]">
        {t.proximoPasso ? (
          <span>→ {t.proximoPasso} <span className="text-muted">({t.proximoPassoDono ?? 'sem dono'} · {dataBR(t.proximoPassoEm)})</span></span>
        ) : (
          <span className="text-bad">sem próximo passo com dono e data</span>
        )}
      </div>
      {fase !== 'encerrado' && (
        <div className="mt-1 text-[11px] text-muted">
          {t.podeAvancar ? <span className="text-good">portão cumprido — pode avançar</span> : `falta: ${t.faltando.slice(0, 2).join('; ')}${t.faltando.length > 2 ? ` (+${t.faltando.length - 2})` : ''}`}
        </div>
      )}
    </li>
  );
}
