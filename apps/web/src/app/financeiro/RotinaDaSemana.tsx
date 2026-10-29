'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

/*
 * ROTINA DA SEMANA (29/10/2026). A tela de ação do Financeiro: o que precisa de
 * alguém esta semana. Parcela de acordo sem cobrança no Asaas, o que venceu e não
 * entrou, a NF que falta emitir e a conta fixa que veio com valor diferente do
 * contrato. Cada bloco vazio é um "nada a fazer aqui".
 */

type AGerar = { id: string; acordoId: string; descricao: string; valor: number; vencimento: string; diasParaVencer: number };
type Atrasado = { id: string; descricao: string; quem: string | null; valor: number; vencimento: string; diasDeAtraso: number; origem: 'asaas' | 'acordo' | 'manual' };
type NfPendente = { id: string; acordoId: string; descricao: string; valor: number; vencimento: string; pagaEm: string | null; cobrancaGerada: boolean };
type ContaQueMudou = { id: string; descricao: string; tipo: 'entrada' | 'saida'; valorDoContrato: number; ultimoValor: number; ultimoEm: string };
type SemPlano = { id: string; data: string; tipo: 'entrada' | 'saida'; descricao: string; quem: string | null; valor: number };
type Rotina = { aGerar: AGerar[]; atrasados: Atrasado[]; nfPendente: NfPendente[]; contasQueMudaram: ContaQueMudou[]; semPlano?: SemPlano[] };

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const ORIGEM: Record<Atrasado['origem'], string> = {
  asaas: 'cobrança vencida no Asaas: cobrar o cliente',
  acordo: 'parcela vencida sem cobrança: gerar e cobrar',
  manual: 'lançado à mão: confirmar se entrou',
};

function Bloco({ titulo, vazio, total, children }: { titulo: string; vazio: string; total?: number; children: React.ReactNode[] }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">{titulo}</h2>
        {total !== undefined && children.length > 0 && <span className="text-sm font-semibold tabular-nums">{brl(total)}</span>}
      </div>
      {children.length === 0 ? <p className="text-sm text-muted">{vazio}</p> : <ul className="divide-y divide-border text-sm">{children}</ul>}
    </section>
  );
}

export function RotinaDaSemana({ token, onError, irParaAcordos }: { token: string | null; onError: (e: unknown) => void; irParaAcordos: () => void }) {
  const [r, setR] = useState<Rotina | null>(null);
  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<Rotina>('/finance/analise/rotina', token).then(setR).catch(onError);
  }, [token, onError]);
  useEffect(() => { carregar(); }, [carregar]);
  if (!r) return <p className="text-sm text-muted">Carregando…</p>;

  const soma = (xs: { valor: number }[]) => xs.reduce((s, x) => s + x.valor, 0);
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted">
        O que precisa de alguém esta semana. As parcelas e as NFs se acertam em Análise → Acordos → parcelas.{' '}
        <button className="text-brand hover:underline" onClick={irParaAcordos}>Abrir os acordos</button>
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="Cobranças a gerar no Asaas" vazio="Toda parcela de acordo já tem a sua cobrança." total={soma(r.aGerar)}>
          {r.aGerar.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">{p.descricao}</span>
              <span className={`shrink-0 text-[12px] ${p.diasParaVencer < 0 ? 'text-bad' : p.diasParaVencer <= 10 ? 'text-warn' : 'text-muted'}`}>
                {p.diasParaVencer < 0 ? `venceu ${dataBR(p.vencimento)}` : `vence ${dataBR(p.vencimento)}`}
              </span>
              <span className="w-28 shrink-0 text-right tabular-nums">{brl(p.valor)}</span>
            </li>
          ))}
        </Bloco>
        <Bloco titulo="Atrasado, cobrar" vazio="Nada vencido a receber." total={soma(r.atrasados)}>
          {r.atrasados.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.descricao}{a.quem && <span className="ml-2 text-muted">{a.quem}</span>}</span>
                <span className="block text-[11px] text-muted">{ORIGEM[a.origem]}</span>
              </span>
              <span className="shrink-0 text-[12px] text-bad">{a.diasDeAtraso}d de atraso</span>
              <span className="w-28 shrink-0 text-right tabular-nums">{brl(a.valor)}</span>
            </li>
          ))}
        </Bloco>
        <Bloco titulo="NF pendente" vazio="Nenhuma NF por emitir nas parcelas que importam agora." total={soma(r.nfPendente)}>
          {r.nfPendente.map((n) => (
            <li key={n.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">{n.descricao}</span>
              <span className="shrink-0 text-[12px] text-muted">
                {n.pagaEm ? `paga em ${dataBR(n.pagaEm)}` : n.cobrancaGerada ? 'cobrança gerada' : `vence ${dataBR(n.vencimento)}`}
              </span>
              <span className="w-28 shrink-0 text-right tabular-nums">{brl(n.valor)}</span>
            </li>
          ))}
        </Bloco>
        <Bloco titulo="Contas fixas que mudaram de valor" vazio="Toda conta fixa veio pelo valor do contrato.">
          {r.contasQueMudaram.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">{c.descricao}</span>
              <span className="shrink-0 text-[12px] text-muted">contrato {brl(c.valorDoContrato)} · veio {dataBR(c.ultimoEm)}</span>
              <span className={`w-28 shrink-0 text-right tabular-nums ${c.ultimoValor > c.valorDoContrato ? 'text-bad' : 'text-good'}`}>{brl(c.ultimoValor)}</span>
            </li>
          ))}
        </Bloco>
      </div>
      <Bloco titulo="Classificar (sem plano de contas, últimos 90 dias)" vazio="Tudo o que aconteceu está classificado." total={soma(r.semPlano ?? [])}>
        {(r.semPlano ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2">
            <span className={`w-12 shrink-0 text-[11px] uppercase ${t.tipo === 'entrada' ? 'text-good' : 'text-bad'}`}>{t.tipo === 'entrada' ? 'entrou' : 'saiu'}</span>
            <span className="min-w-0 flex-1 truncate">{t.descricao}{t.quem && <span className="ml-2 text-muted">{t.quem}</span>}</span>
            <span className="shrink-0 text-[12px] text-muted">{dataBR(t.data)}</span>
            <span className="w-28 shrink-0 text-right tabular-nums">{brl(t.valor)}</span>
          </li>
        ))}
      </Bloco>
      <p className="text-[11px] text-muted">Para classificar, abra Lançamentos e escolha a conta do plano em cada um. Sem plano, a saída conta na estimativa de variáveis do fluxo.</p>
    </div>
  );
}
