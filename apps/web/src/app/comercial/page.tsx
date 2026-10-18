'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PainelComercial, PainelComercialGrupo, PainelComercialMes } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const curto = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : n.toLocaleString('pt-BR');
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeDoMes = (aaaaMm: string) => MES[Number(aaaaMm.slice(5, 7)) - 1];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export default function ComercialPage() {
  const { token, ready } = useAuth();
  const [p, setP] = useState<PainelComercial | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<PainelComercial>('/comercial/painel', token).then(setP).catch((e) => setError(e.message));
  }, [ready, token]);

  const quadro = p?.lista ? `/trabalho?lista=${p.lista.id}` : '/trabalho';

  return (
    <div className="com-tema mx-auto max-w-[1180px] space-y-6 text-text">
      <div>
        <div className="com-rotulo">Comercial da ROOT</div>
        <h1 className="mt-1 text-[2rem] font-bold leading-tight tracking-tight">
          {p?.lista ? (
            <>
              <span className="com-num text-brand">{brl(p.totais.emNegociacao)}</span> em negociação
            </>
          ) : (
            'Comercial'
          )}
        </h1>
        {p?.lista && (
          <p className="mt-1 text-muted">
            {p.totais.abertos} {p.totais.abertos === 1 ? 'negócio aberto' : 'negócios abertos'} no CRM.{' '}
            <Link href={quadro} className="text-text underline">Abrir o quadro</Link>
          </p>
        )}
      </div>

      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</div>}
      {!p && !error && <p className="text-muted">Carregando…</p>}

      {p && !p.lista && (
        <div className="rounded-md border border-border bg-surface px-5 py-4">
          <p>
            Ainda não existe a lista <b>Gestão de Leads</b> no Trabalho. O painel lê dela: etapas, canal de aquisição,
            vendedor e valor em negociação.
          </p>
        </div>
      )}

      {p?.lista && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Bloco rotulo={`Fechado em ${p.ano}`} valor={brl(p.totais.valorGanhoNoAno)} nota={`${p.totais.ganhosNoAno} contrato(s)`} destaque />
            <Bloco rotulo="Em negociação" valor={brl(p.totais.emNegociacao)} nota={`${p.totais.abertos} aberto(s)`} />
            <Bloco
              rotulo="Conversão no ano"
              valor={p.totais.conversao == null ? '—' : `${p.totais.conversao}%`}
              nota={`${p.totais.ganhosNoAno} ganho(s), ${p.totais.perdidosNoAno} perdido(s)`}
            />
            <Bloco rotulo="Ticket médio" valor={p.totais.ticketMedio == null ? '—' : brl(p.totais.ticketMedio)} nota="dos contratos do ano" />
          </div>

          <Painel titulo="Funil" nota="quantos negócios e quanto valem, por etapa">
            <Funil etapas={p.etapas} />
          </Painel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Painel titulo={`Contratos fechados por mês · ${p.ano}`} nota="valor dos negócios que foram para fechado">
              <Barras meses={p.fechadosPorMes} medida="valor" />
            </Painel>
            <Painel titulo="Oportunidades geradas por mês" nota="leads que entraram no CRM, últimos 12 meses">
              <Barras meses={p.entradasPorMes} medida="qtd" />
            </Painel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Painel titulo="Por canal de aquisição" nota="de onde vem o lead e de onde vem o contrato">
              <Grupos grupos={p.canais} primeira="Canal" />
            </Painel>
            <Painel titulo="Por vendedor" nota="quem carrega o quê">
              <Grupos grupos={p.vendedores} primeira="Vendedor" />
            </Painel>
          </div>

          <Painel titulo="Em negociação agora" nota="do maior valor para o menor">
            {p.abertos.length === 0 ? (
              <p className="text-muted">Nenhum negócio aberto.</p>
            ) : (
              <div className="divide-y divide-border">
                {p.abertos.map((l) => (
                  <Link
                    key={l.id}
                    href={`${quadro}&tarefa=${l.id}`}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1 font-medium">{l.titulo}</span>
                    <span className="text-sm text-muted">
                      {l.etapa}
                      {l.diasNaEtapa != null && ` · há ${l.diasNaEtapa} ${l.diasNaEtapa === 1 ? 'dia' : 'dias'}`}
                      {l.vendedor && ` · ${l.vendedor}`}
                    </span>
                    <span className="com-num w-28 text-right">{l.valor == null ? '—' : brl(l.valor)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Painel>

          <p className="text-sm text-muted">
            Lido da lista {p.lista.nome}. Etapa &quot;fechado&quot; conta como contrato; perdido e geladeira contam como perda.
            O mês do fechamento é quando o cartão foi para a etapa fechada.
          </p>
        </>
      )}
    </div>
  );
}

function Bloco({ rotulo, valor, nota, destaque }: { rotulo: string; valor: string; nota?: string; destaque?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface px-5 py-4">
      <div className="com-rotulo">{rotulo}</div>
      <div className={`com-num mt-2 text-[1.75rem] font-bold leading-none ${destaque ? 'text-brand' : 'text-text'}`}>{valor}</div>
      {nota && <div className="mt-2 text-sm text-muted">{nota}</div>}
    </div>
  );
}

function Painel({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface px-5 py-4">
      <h2 className="text-[1.05rem] font-semibold">{titulo}</h2>
      {nota && <p className="text-sm text-muted">{nota}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Funil({ etapas }: { etapas: PainelComercial['etapas'] }) {
  const max = Math.max(1, ...etapas.map((e) => e.qtd));
  return (
    <div className="space-y-2">
      {etapas.map((e) => (
        <div key={e.nome} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 sm:grid-cols-[11rem_1fr_7rem]">
          <span className={`truncate text-sm ${e.resultado === 'aberta' ? 'text-text' : 'text-muted'}`}>{e.nome}</span>
          <div className="flex items-center gap-2">
            <div
              className={`h-6 rounded-sm ${
                e.resultado === 'ganho' ? 'bg-brand' : e.resultado === 'perdido' ? 'bg-surface-2' : 'bg-brand/45'
              }`}
              style={{ width: `${e.qtd ? Math.max(3, (e.qtd / max) * 100) : 0}%` }}
            />
            <span className="com-num text-sm">{e.qtd}</span>
          </div>
          <span className="com-num text-right text-sm text-muted">{e.valor ? brl(e.valor) : '—'}</span>
        </div>
      ))}
    </div>
  );
}

function Barras({ meses, medida }: { meses: PainelComercialMes[]; medida: 'valor' | 'qtd' }) {
  const max = Math.max(1, ...meses.map((m) => m[medida]));
  const vazio = meses.every((m) => m[medida] === 0);
  return (
    <div>
      <div className="flex h-44 items-end gap-1.5">
        {meses.map((m) => {
          const v = m[medida];
          return (
            <div key={m.mes} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${nomeDoMes(m.mes)}: ${medida === 'valor' ? brl(v) : v}`}>
              {v > 0 && <span className="com-num text-[0.7rem] text-muted">{medida === 'valor' ? curto(v) : v}</span>}
              <div className="w-full rounded-t-sm bg-brand" style={{ height: v ? `${Math.max(3, (v / max) * 100)}%` : '1px', opacity: v ? 1 : 0.25 }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {meses.map((m) => (
          <span key={m.mes} className="com-rotulo min-w-0 flex-1 text-center !tracking-normal">{nomeDoMes(m.mes)}</span>
        ))}
      </div>
      {vazio && <p className="mt-2 text-sm text-muted">Nada no período.</p>}
    </div>
  );
}

function Grupos({ grupos, primeira }: { grupos: PainelComercialGrupo[]; primeira: string }) {
  if (grupos.length === 0) return <p className="text-muted">Sem leads.</p>;
  const max = Math.max(1, ...grupos.map((g) => g.leads));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="com-rotulo pb-2 font-normal">{primeira}</th>
            <th className="com-rotulo pb-2 text-right font-normal">Leads</th>
            <th className="com-rotulo pb-2 text-right font-normal">Fechados</th>
            <th className="com-rotulo pb-2 text-right font-normal">Conv.</th>
            <th className="com-rotulo pb-2 text-right font-normal">Em negociação</th>
            <th className="com-rotulo pb-2 text-right font-normal">Fechado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {grupos.map((g) => (
            <tr key={g.nome}>
              <td className="py-2 pr-3">
                <div className={g.nome === 'Sem informação' ? 'text-muted' : ''}>{g.nome}</div>
                <div className="mt-1 h-1 rounded-full bg-brand/45" style={{ width: `${(g.leads / max) * 100}%` }} />
              </td>
              <td className="com-num py-2 text-right">{g.leads}</td>
              <td className="com-num py-2 text-right">{g.ganhos}</td>
              <td className="com-num py-2 text-right text-muted">{pct(g.ganhos, g.leads)}</td>
              <td className="com-num py-2 text-right">{g.emNegociacao ? brl(g.emNegociacao) : '—'}</td>
              <td className="com-num py-2 text-right">{g.valorGanho ? brl(g.valorGanho) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
