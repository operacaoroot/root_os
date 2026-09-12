'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Traco {
  id: string;
  agente: { slug: string; nome: string; iniciais: string };
  canal: string;
  solicitante: string;
  status: string;
  custoUsd: number;
  custoEstimado: boolean;
  duracaoMs: number;
  criadaEm: string;
  blocos: {
    pedido: string;
    contexto: { fontes: { tipo: string; titulo: string; ref?: string; score?: number }[]; texto: string | null };
    ferramentas: { capacidade: string | null; args: string | null; resultado: string | null; nivel: string | null; decisao: string | null; duracaoMs: number }[];
    regua: {
      nivelMax: string | null;
      motivo: string | null;
      decisoes: { capacidade: string | null; nivel: string | null; decisao: string | null; motivo: string | null; gatilhos: string[]; approvalId: string | null }[];
    };
    resposta: { texto: string; semProcedencia: boolean; fontes: unknown };
    registro: { correlationId: string; toolCalls: (string | null)[]; passos: number };
  };
}

/*
 * O traço em 6 blocos. É esta tela que separa o produto de um chat: não é o
 * que a IA respondeu, é o que ela consultou, o que ela chamou, o que a régua
 * decidiu e o que ficou registrado.
 */
function Bloco({ n, titulo, children }: { n: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-0 first:pt-0">
      <h2 className="mb-2 font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">
        <span className="text-dim">{n}</span> {titulo}
      </h2>
      {children}
    </section>
  );
}

export default function SessaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { token, ready } = useAuth();
  const [t, setT] = useState<Traco | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<Traco>(`/sessions/${id}`, token).then(setT).catch((e) => setErro(e.message));
  }, [ready, token, id]);

  if (erro) {
    return <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</div>;
  }
  if (!t) return <p className="text-sm text-muted">Carregando o traço…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/sessoes" className="text-muted hover:text-text">
          <ArrowLeft size={16} />
        </Link>
        <span className="font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {t.canal} · {t.solicitante} → {t.agente.nome}
        </span>
        <span className="flex-1" />
        <span className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-dim">
          {(t.duracaoMs / 1000).toFixed(1)}s ·{' '}
          {t.custoEstimado && t.custoUsd > 0 ? `US$ ${t.custoUsd.toFixed(4)}` : 'custo não medido'}
        </span>
      </div>

      <div className="space-y-4 rounded-root border border-border bg-surface p-4">
        <Bloco n="01" titulo="o pedido">
          <p className="text-[13px] leading-[1.65] text-text">{t.blocos.pedido}</p>
        </Bloco>

        <Bloco n="02" titulo="o contexto que entrou junto">
          {t.blocos.contexto.fontes.length === 0 ? (
            <p className="text-[12px] text-muted">
              Nada entrou junto — a resposta veio só das ferramentas.
            </p>
          ) : (
            <ul className="space-y-1">
              {t.blocos.contexto.fontes.map((f, i) => (
                <li key={i} className="font-os-mono text-[10.5px] text-muted">
                  <span className="text-dim">{f.tipo}</span> · {f.titulo}
                  {f.score != null && <span className="text-dim"> ({f.score})</span>}
                </li>
              ))}
            </ul>
          )}
        </Bloco>

        <Bloco n="03" titulo="as ferramentas chamadas">
          {t.blocos.ferramentas.length === 0 ? (
            <p className="text-[12px] text-muted">Nenhuma — a central respondeu sem consultar nada.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-os-mono text-[10.5px]">
                <tbody>
                  {t.blocos.ferramentas.map((f, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-[6px] pr-3 text-text">{f.capacidade}</td>
                      <td className="py-[6px] pr-3 text-muted">{f.args}</td>
                      <td className="py-[6px] pr-3 text-muted">{f.resultado}</td>
                      <td className="py-[6px] text-right text-dim">{f.nivel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Bloco>

        <Bloco n="04" titulo="a régua decidiu">
          {t.blocos.regua.decisoes.length === 0 ? (
            <p className="text-[12px] text-muted">
              Nada a decidir: não houve chamada de ferramenta nesta sessão.
            </p>
          ) : (
            <ul className="space-y-2">
              {t.blocos.regua.decisoes.map((d, i) => (
                <li key={i} className="text-[11.5px] leading-[1.55]">
                  <span className="font-os-mono text-[10px] font-bold text-text">{d.nivel}</span>{' '}
                  <span className="text-muted">{d.capacidade}</span>
                  <span className="text-dim"> — {d.motivo}</span>
                  {d.gatilhos.length > 0 && (
                    <span className="text-warn"> · sinais: {d.gatilhos.join(', ')}</span>
                  )}
                  {d.approvalId && (
                    <Link href="/atendimento" className="ml-1 text-brand hover:underline">
                      na fila
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Bloco>

        <Bloco n="05" titulo="o que saiu">
          <p className="whitespace-pre-wrap text-[13px] leading-[1.65] text-text">
            {t.blocos.resposta.texto || <span className="text-muted">— sem resposta —</span>}
          </p>
          {t.blocos.resposta.semProcedencia && (
            <p className="mt-2 font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-warn">
              resposta com número e sem fonte declarada
            </p>
          )}
        </Bloco>

        <Bloco n="06" titulo="o que ficou registrado">
          <p className="font-os-mono text-[10.5px] leading-[1.7] text-muted">
            {t.blocos.registro.passos} passo(s) no traço ·{' '}
            {t.blocos.registro.toolCalls.length} passagem(ns) pela porta
            <br />
            <span className="text-dim">correlação </span>
            {t.blocos.registro.correlationId}
          </p>
          <Link
            href={`/rastro?correlationId=${t.blocos.registro.correlationId}`}
            className="mt-2 inline-block font-os-mono text-[10px] uppercase tracking-[0.1em] text-brand hover:underline"
          >
            abrir no rastro
          </Link>
        </Bloco>
      </div>
    </div>
  );
}
