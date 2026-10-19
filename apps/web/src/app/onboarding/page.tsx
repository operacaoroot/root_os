'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip, Kpi, inputCls } from '../referencias/ui';
import RodadaDaSemana from '../operacao/page';
import {
  ORDEM_DAS_FASES,
  ROTULO_DA_FASE,
  dataBR,
  type Fase,
  type Pendencia,
  type TrilhoResumo,
} from './tipos';

/*
 * A BANCADA — a lista dos clientes na esteira de entrega (docs/ONBOARDING.md).
 *
 * Uma coluna por fase, o que falta para sair de cada uma, e as pendências do
 * relógio no topo. Criar um trilho é o primeiro passo da fase 0: o cliente
 * existe, a reunião está marcada, e o link da triagem pode sair.
 */

function Implantacao() {
  const { token, ready, can } = useAuth();
  const editavel = can('tarefas.editar');
  const [trilhos, setTrilhos] = useState<TrilhoResumo[] | null>(null);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState({ cliente: '', contatoNome: '', contatoEmail: '', reuniaoEm: '', conduzidoPor: '' });
  const [criando, setCriando] = useState(false);
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

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setErro(null);
    setCriando(true);
    try {
      await apiPost('/tenants/onboarding/trilhos', {
        cliente: novo.cliente,
        contatoNome: novo.contatoNome || null,
        contatoEmail: novo.contatoEmail || null,
        reuniaoEm: novo.reuniaoEm ? new Date(`${novo.reuniaoEm}T12:00:00`).toISOString() : null,
        conduzidoPor: novo.conduzidoPor || null,
      }, token);
      setNovo({ cliente: '', contatoNome: '', contatoEmail: '', reuniaoEm: '', conduzidoPor: '' });
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setCriando(false);
    }
  }

  if (!ready) return null;
  if (!trilhos) return <p className="text-sm text-muted">{erro ?? 'carregando…'}</p>;

  const abertos = trilhos.filter((t) => t.fase !== 'encerrado');
  const esperandoOk = abertos.reduce((n, t) => n + t.itens.pendentesDeAprovacao, 0);
  const semPasso = abertos.filter((t) => !t.proximoPasso).length;
  const nomeDo = (id: string) => trilhos.find((t) => t.id === id)?.cliente ?? id;

  return (
    <div className="space-y-6">
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

      {editavel && (
        <Card titulo="Novo cliente na esteira (fase 0)">
          <form onSubmit={criar} className="grid gap-3 md:grid-cols-5">
            <input className={inputCls} placeholder="Cliente *" required minLength={2} value={novo.cliente} onChange={(e) => setNovo({ ...novo, cliente: e.target.value })} />
            <input className={inputCls} placeholder="Contato (nome)" value={novo.contatoNome} onChange={(e) => setNovo({ ...novo, contatoNome: e.target.value })} />
            <input className={inputCls} placeholder="E-mail do contato" type="email" value={novo.contatoEmail} onChange={(e) => setNovo({ ...novo, contatoEmail: e.target.value })} />
            <input className={inputCls} type="date" title="Reunião marcada" value={novo.reuniaoEm} onChange={(e) => setNovo({ ...novo, reuniaoEm: e.target.value })} />
            <div className="flex gap-2">
              <input className={inputCls} placeholder="Quem conduz" value={novo.conduzidoPor} onChange={(e) => setNovo({ ...novo, conduzidoPor: e.target.value })} />
              <Botao type="submit" tone="brand" disabled={criando}>{criando ? '…' : 'Criar'}</Botao>
            </div>
          </form>
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

/*
 * DIA A DIA › OPERAÇÃO (19/10/2026): o que era a área Trabalho, cortado ao que
 * se usa. A implantação de clientes (fases com portão) é a aba de todos; a
 * rodada semanal da Operação da Root só aparece para a ROOT (a rota /operacao
 * segue viva, e é a mesma tela).
 */
export default function OperacaoPage() {
  const { token, ready } = useAuth();
  const [ehRoot, setEhRoot] = useState(false);
  const [ver, setVer] = useState<'implantacao' | 'rodada'>('implantacao');
  useEffect(() => {
    if (!ready || !token) return;
    apiGet('/tenants/plataforma/quem-sou', token).then(() => setEhRoot(true)).catch(() => setEhRoot(false));
  }, [ready, token]);
  return (
    <div className="com-tema space-y-5 text-text">
      {ehRoot && (
        <div className="flex gap-1 border-b border-border">
          {([['implantacao', 'Implantação de clientes'], ['rodada', 'Rodada da semana']] as const).map(([v, nome]) => (
            <button
              key={v}
              onClick={() => setVer(v)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[0.95rem] ${ver === v ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {nome}
            </button>
          ))}
        </div>
      )}
      {ver === 'rodada' && ehRoot ? <RodadaDaSemana /> : <Implantacao />}
    </div>
  );
}
