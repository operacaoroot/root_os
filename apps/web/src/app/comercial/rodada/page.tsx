'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { COR_DO_TOM, Numero, Quadro, brl } from '@/components/painel';
import { NotasDaSemana } from './NotasDaSemana';
import type { RodadaDaSemana } from './tipos';

/*
 * A RODADA DA SEMANA no Comercial (rodada da interface, 20/10/2026, U1, item 10 da ata).
 *
 * Layout 26/10: até aqui esta tela era a `/operacao` (a nota `painel-root.md` escrita
 * à mão e importada às segundas). Decisão do Lucas: os números saem do próprio OS.
 * Agora ela lê `GET /comercial/rodada-da-semana`, contado no banco para a semana de
 * segunda a domingo (São Paulo): leads que entraram, quem mudou de etapa, negócios
 * fechados, propostas enviadas, saídas com motivo, as tarefas do comercial atrasadas
 * e o total em negociação (o mesmo número do Painel geral). O texto da nota, quando
 * existe, fica num bloco à parte, fechado e marcado como escrito à mão
 * (`NotasDaSemana`). No menu o item segue só para a plataforma (`ITENS_DA_ROOT`, em
 * `navegacao-modulos.ts`). `/operacao` segue viva.
 */

const DIA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit' });
/** ISO → "qua., 28/10" no fuso de São Paulo. */
const dia = (iso: string) => DIA.format(new Date(iso));
/** `2026-10-26` → `26/10`. */
const diaCivil = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const linkDoLead = (id: string) => `/comercial/lead/${id}`;
const qtd = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export default function RodadaDaSemanaPage() {
  const { token, ready } = useAuth();
  const [semana, setSemana] = useState<string | null>(null);
  const [r, setR] = useState<RodadaDaSemana | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      const caminho = semana ? `/comercial/rodada-da-semana?semana=${encodeURIComponent(semana)}` : '/comercial/rodada-da-semana';
      const resposta = await apiGet<RodadaDaSemana>(caminho, token);
      if (!resposta?.semana) throw new Error('A rodada da semana voltou num formato que esta tela não conhece.');
      setR(resposta);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [token, semana]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  return (
    <div className="com-tema mx-auto max-w-[1180px] space-y-6 text-text">
      <header className="flex flex-wrap items-end justify-between gap-3">
        {/* Layout 26/10: o título da tela já está na barra do topo; aqui, só a semana e de onde vêm os números. */}
        <div>
          <p className="text-[1.05rem] font-semibold">
            {r ? `${r.semana.atual ? 'Esta semana' : 'Semana'}: ${diaCivil(r.semana.de)} a ${diaCivil(r.semana.ate)}` : 'Rodada da semana'}
          </p>
          <p className="mt-0.5 text-sm text-muted">Contado pelo sistema, a partir do funil e das tarefas do comercial.</p>
        </div>
        {r && (
          <nav aria-label="Trocar de semana" className="flex items-center gap-2 text-sm">
            <button onClick={() => setSemana(r.semana.anterior)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
              ← semana anterior
            </button>
            {r.semana.proxima && (
              <button onClick={() => setSemana(r.semana.proxima)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
                próxima →
              </button>
            )}
            {!r.semana.atual && (
              <button onClick={() => setSemana(null)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
                esta semana
              </button>
            )}
          </nav>
        )}
      </header>

      {erro && <div className="rounded-md border border-bad/40 bg-bad/10 p-4 text-sm text-bad">{erro}</div>}
      {!r && !erro && (carregando || !ready) && <p className="text-sm text-muted">carregando…</p>}

      {r && <Rodada r={r} />}

      <NotasDaSemana />
    </div>
  );
}

function Rodada({ r }: { r: RodadaDaSemana }) {
  const fechadosSemValor = r.fechados.filter((f) => f.valor == null).length;
  return (
    <>
      <section aria-label="Números da semana" className="grid grid-cols-2 gap-4 rounded-md border border-border bg-surface px-5 py-4 md:grid-cols-4">
        <Numero rotulo="Leads que entraram" valor={String(r.entraram.length)} nota="na semana" tamanho="medio" />
        <Numero rotulo="Mudanças de etapa" valor={String(r.movimentos.length)} nota="no funil, fora as saídas" tamanho="medio" />
        <Numero
          rotulo="Fechado na semana"
          valor={brl(r.valorFechado)}
          nota={`${qtd(r.fechados.length, 'negócio', 'negócios')}${fechadosSemValor ? ` · ${fechadosSemValor} sem valor` : ''}`}
          cor={COR_DO_TOM.forte}
          tamanho="medio"
        />
        <Numero rotulo="Propostas enviadas" valor={String(r.propostas.length)} nota="na semana" tamanho="medio" />
        <Numero rotulo="Saídas" valor={String(r.saidas.length)} nota="perdido, geladeira e outras" tamanho="medio" />
        <Numero
          rotulo="Em negociação agora"
          valor={brl(r.negociacao.total)}
          nota={
            r.negociacao.semCaixa
              ? `${brl(r.negociacao.pagante ?? 0)} pagantes · ${brl(r.negociacao.semCaixa)} sem caixa`
              : qtd(r.negociacao.abertos, 'negócio aberto', 'negócios abertos')
          }
          cor={COR_DO_TOM.medio}
          tamanho="medio"
        />
        <Numero rotulo="Tarefas atrasadas" valor={String(r.tarefasAtrasadas.length)} nota="do comercial, hoje" tamanho="medio" />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Quadro titulo="Leads que entraram" nota="etapa de hoje e de onde veio">
          <Lista vazio="Nenhum lead entrou nesta semana.">
            {r.entraram.map((l) => (
              <Linha key={l.leadId} href={linkDoLead(l.leadId)} nome={l.nome} lado={dia(l.em)}>
                {[l.etapa, l.canal].filter(Boolean).join(' · ')}
              </Linha>
            ))}
          </Lista>
        </Quadro>

        <Quadro titulo="Mudanças de etapa" nota="quem foi para onde">
          <Lista vazio="Ninguém mudou de etapa nesta semana.">
            {r.movimentos.map((m) => (
              <Linha key={`${m.leadId}-${m.em}`} href={linkDoLead(m.leadId)} nome={m.nome} lado={dia(m.em)}>
                {m.de} → {m.para}
                {m.aMao ? ` · movido à mão${m.por ? ` por ${m.por}` : ''}` : ''}
              </Linha>
            ))}
          </Lista>
        </Quadro>

        <Quadro titulo={`Negócios fechados · ${brl(r.valorFechado)}`} nota="valor da proposta na ficha">
          <Lista vazio="Nenhum negócio fechado nesta semana.">
            {r.fechados.map((f) => (
              <Linha key={f.leadId} href={linkDoLead(f.leadId)} nome={f.nome} lado={f.valor == null ? 'sem valor' : brl(f.valor)}>
                {[f.produto, dia(f.em)].filter(Boolean).join(' · ')}
              </Linha>
            ))}
          </Lista>
        </Quadro>

        <Quadro titulo="Propostas enviadas" nota="cada versão publicada conta uma vez">
          <Lista vazio="Nenhuma proposta enviada nesta semana.">
            {r.propostas.map((p) => (
              <Linha key={`${p.leadId}-${p.em}`} href={linkDoLead(p.leadId)} nome={p.nome} lado={p.valor == null ? 'sem valor' : brl(p.valor)}>
                {[p.versao != null ? `versão ${p.versao}` : null, dia(p.em)].filter(Boolean).join(' · ')}
              </Linha>
            ))}
          </Lista>
        </Quadro>

        <Quadro titulo="Saídas" nota="perdido, geladeira e as outras, com o motivo">
          <Lista vazio="Nenhuma saída nesta semana.">
            {r.saidas.map((s) => (
              <Linha key={`${s.leadId}-${s.em}`} href={linkDoLead(s.leadId)} nome={s.nome} lado={dia(s.em)}>
                {s.saida} · {s.motivo}
                {s.detalhe ? ` · ${s.detalhe}` : ''}
                {s.voltaEm ? ` · volta em ${diaCivil(s.voltaEm)}` : ''}
              </Linha>
            ))}
          </Lista>
        </Quadro>

        <Quadro
          titulo="Tarefas do comercial atrasadas"
          nota="prazo vencido e ainda abertas, hoje"
          acao={<Link href="/comercial/funil" className="text-sm text-muted underline hover:text-brand">Funil de vendas</Link>}
        >
          <Lista vazio="Nenhuma tarefa do comercial atrasada.">
            {r.tarefasAtrasadas.map((t) => (
              <Linha key={t.id} href={t.lead ? linkDoLead(t.lead.id) : null} nome={t.titulo} lado={t.prazo ? `venceu ${diaCivil(t.prazo)}` : ''}>
                {[t.pessoa ?? 'sem responsável', t.lead?.nome].filter(Boolean).join(' · ')}
              </Linha>
            ))}
          </Lista>
        </Quadro>
      </div>
    </>
  );
}

function Lista({ vazio, children }: { vazio: string; children: React.ReactNode[] }) {
  if (children.length === 0) return <p className="text-sm text-muted">{vazio}</p>;
  return <ul className="divide-y divide-border">{children}</ul>;
}

function Linha({ href, nome, lado, children }: { href: string | null; nome: string; lado: string; children: React.ReactNode }) {
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        {href ? (
          <Link href={href} className="min-w-0 truncate font-semibold hover:text-brand" title={nome}>
            {nome}
          </Link>
        ) : (
          <span className="min-w-0 truncate font-semibold" title={nome}>
            {nome}
          </span>
        )}
        <span className="com-num shrink-0 text-sm text-muted">{lado}</span>
      </div>
      <p className="mt-0.5 text-sm text-muted">{children}</p>
    </li>
  );
}
