'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Ban, Scale } from 'lucide-react';
import { apiGet, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  alertaDoTeto,
  alertasDeOrcamento,
  atribuicaoPorAgente,
  diaCurto,
  fraseDoExcedente,
  NAO_MEDIDO,
  rotuloUsd,
  ROTA_DO_RELATORIO,
  TOM_DO_TETO,
  totalDaJanela,
  tudoSemPreco,
  usd,
  type AlertaDoOrcamento,
  type RelatorioDeCustoIa,
} from './calculo';

/*
 * PAINEL DE CUSTO DE IA — por empresa, por agente e por dia (RF-B-03).
 *
 * A tela não faz conta nenhuma por conta própria: tudo o que ela mostra sai de
 * `calculo.ts`, que é onde o teste mora. Uma conta escrita no JSX é uma conta
 * sem teste, e num painel de custo isso já tem nome.
 *
 * AS QUATRO COISAS QUE ESTA TELA DIZ, e que `tests/component/custo-ia.test.tsx`
 * cobra uma a uma — comentário não obriga ninguém, teste obriga:
 *   1. O que é medido e o que é estimado, em colunas separadas, com os DOIS
 *      métodos de estimativa nomeados.
 *   2. Quantas chamadas não puderam ser medidas — como contagem, nunca como
 *      R$ 0,00, e isso vale também no cartão grande.
 *   3. Quando o livro-caixa não foi escrito, a RECUSA do total no lugar do zero.
 *   4. O que este painel NÃO alcança (`naoCoberto`), no rodapé, sempre.
 *
 * Fora do menu de propósito: `packages/shared/src/nav.ts` é a fonte única do
 * menu e não é arquivo desta fatia. A tela é sub-rota do Console e se alcança
 * pela pílula — a barra de cima continua lendo "Console" porque o rótulo casa
 * por prefixo de href.
 */

const JANELAS = [7, 30, 90] as const;

/**
 * O tom de cada estado de orçamento (fatia A3).
 *
 * `sem-orcamento` é NEUTRO, não aviso: a esmagadora maioria dos agentes está
 * nesse estado hoje e pintar a tela inteira de amarelo transformaria o alerta
 * em papel de parede. Quem precisa de destaque é quem está perto de parar.
 */
const TOM_DO_ORCAMENTO: Record<AlertaDoOrcamento['estado'], 'default' | 'good' | 'warn' | 'bad'> = {
  'sem-orcamento': 'default',
  zerado: 'bad',
  ok: 'good',
  atencao: 'warn',
  estourado: 'bad',
};

const TOM_DA_BORDA: Record<'default' | 'good' | 'warn' | 'bad', string> = {
  default: 'border-border',
  good: 'border-good/30',
  warn: 'border-warn/40',
  bad: 'border-bad/40',
};
const TOM_DO_TEXTO: Record<'default' | 'good' | 'warn' | 'bad', string> = {
  default: 'text-muted',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
};

/** O rodapé da coluna "estimado": os dois métodos, com nome. */
const NOTA_DO_ESTIMADO =
  'dois métodos: tamanho da resposta na chamada simples; a reserva (teto de saída) quando o ' +
  'modelo servido saiu da tabela de preço — este último superestima cerca de 7x';

export default function CustoDeIaPage() {
  const { token, ready, can } = useAuth();
  const [dias, setDias] = useState<number>(30);
  const [r, setR] = useState<RelatorioDeCustoIa | null>(null);
  const [erro, setErro] = useState<{ status: number; texto: string } | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    let vivo = true;
    setR(null);
    setErro(null);
    apiGet<RelatorioDeCustoIa>(`${ROTA_DO_RELATORIO}?dias=${dias}`, token)
      .then((x) => vivo && setR(x))
      .catch((e: unknown) => {
        if (!vivo) return;
        setErro({
          status: e instanceof ErroDaApi ? e.status : 0,
          texto: e instanceof Error ? e.message : 'falha ao ler o custo de IA',
        });
      });
    return () => {
      vivo = false;
    };
  }, [ready, token, dias]);

  const calculado = useMemo(
    () =>
      r
        ? {
            alerta: alertaDoTeto(r),
            total: totalDaJanela(r),
            atribuicao: atribuicaoPorAgente(r),
            orcamentos: alertasDeOrcamento(r),
          }
        : null,
    [r],
  );

  if (!can('dashboard.ver')) {
    return (
      <p className="text-sm text-muted">
        Seu perfil não tem a permissão <code>dashboard.ver</code>.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/painel"
          className="inline-flex items-center gap-[6px] font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:text-text"
        >
          <ArrowLeft size={12} /> Console
        </Link>
        <div className="flex items-center gap-[6px] font-os-mono text-[10px]">
          {JANELAS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDias(d)}
              className={`border px-[9px] py-[4px] uppercase tracking-[0.12em] transition-colors ${
                dias === d
                  ? 'border-brand/40 bg-brand/10 text-brand'
                  : 'border-border text-muted hover:border-border-strong hover:text-text'
              }`}
            >
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="rounded-root border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
          {erro.status === 404 ? (
            <>
              O relatório de custo não respondeu nesta instância (
              <code>GET /api{ROTA_DO_RELATORIO}</code>). Enquanto ele não existir, esta tela
              não mostra número nenhum — e é isso mesmo: um zero aqui seria pior que o vazio.
            </>
          ) : (
            <>Erro ao carregar: {erro.texto}</>
          )}
        </div>
      )}

      {!r && !erro && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-root border border-border bg-surface" />
          ))}
        </div>
      )}

      {r && calculado && (
        <>
          {/* ---------------------------------------------------------------
              O TETO DE HOJE — o mesmo número que a porta compara
              --------------------------------------------------------------- */}
          <section
            className={`rounded-root border bg-surface p-4 font-os-mono ${
              TOM_DA_BORDA[TOM_DO_TETO[calculado.alerta.estado]]
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
                  Comprometido hoje · {r.hoje?.dia ?? r.ate} · {r.fusoHorario}
                </div>
                <div
                  className={`mt-[6px] text-[26px] font-bold leading-none tracking-[-0.04em] tabular-nums ${
                    TOM_DO_TEXTO[TOM_DO_TETO[calculado.alerta.estado]]
                  }`}
                >
                  {r.hoje ? usd(r.hoje.comprometidoUsd) : NAO_MEDIDO}
                </div>
              </div>
              <div
                className={`text-[11px] ${TOM_DO_TEXTO[TOM_DO_TETO[calculado.alerta.estado]]}`}
              >
                {calculado.alerta.disparou && (
                  <AlertTriangle size={13} className="mr-[5px] inline-block align-[-2px]" />
                )}
                {calculado.alerta.frase}
              </div>
            </div>

            {r.hoje && (
              <div className="mt-[10px] grid grid-cols-2 gap-x-5 gap-y-[6px] text-[10.5px] md:grid-cols-4">
                {/* Dia inteiro em modelo sem preço: travessão, não US$ 0,00. */}
                <Parcela
                  rotulo="medido pelo provedor"
                  valor={rotuloUsd(r.hoje.gastoUsd, !tudoSemPreco(r.hoje))}
                  nota={tudoSemPreco(r.hoje) ? 'nenhuma chamada de hoje tem preço na tabela' : undefined}
                />
                <Parcela
                  rotulo="estimado"
                  valor={usd(r.hoje.gastoEstimadoUsd)}
                  nota={NOTA_DO_ESTIMADO}
                />
                <Parcela rotulo="reservado (em voo)" valor={usd(r.hoje.reservadoUsd)} />
                <Parcela
                  rotulo="não medidas"
                  valor={
                    r.hoje.chamadasSemPreco > 0
                      ? `${r.hoje.chamadasSemPreco} de ${r.hoje.chamadas}`
                      : '0'
                  }
                  nota="modelo fora da tabela de preço"
                />
              </div>
            )}

            {!r.teto.configurado && (
              <p className="mt-[10px] text-[10.5px] text-warn">
                Esta empresa não tem teto definido. Sem teto não há corte, não há alerta e{' '}
                <strong className="font-normal text-bad">
                  o livro-caixa do dia não chega a ser escrito
                </strong>{' '}
                — é diferente de teto zero, que recusaria toda chamada.
              </p>
            )}
            {r.teto.configurado && !r.teto.ativo && (
              <p className="mt-[10px] text-[10.5px] text-warn">
                Teto em observação: o consumo é somado e nada é recusado.
              </p>
            )}
            {r.teto.motivo && (
              <p className="mt-[6px] text-[10px] text-dim">
                Teto definido {r.teto.definidoEm ? `em ${r.teto.definidoEm.slice(0, 10)}` : ''} ·{' '}
                {r.teto.motivo}
              </p>
            )}
          </section>

          {/* ---------------------------------------------------------------
              A CONFERÊNCIA — ver `totalDaJanela`
              --------------------------------------------------------------- */}
          {!calculado.total.confere && (
            <div className="rounded-root border border-bad/40 bg-bad/10 p-4 font-os-mono text-[11px] text-bad">
              <Scale size={13} className="mr-[5px] inline-block align-[-2px] " />O que chegou
              nesta tela não bate com o que o banco somou, no MESMO instantâneo. Isso não é
              concorrência — é defeito de leitura ou de transporte:
              <ul className="mt-[6px] list-disc space-y-[3px] pl-5">
                {calculado.total.divergencias.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <p className="mt-[6px]">Enquanto isso valer, nenhum total desta tela pode ser usado.</p>
            </div>
          )}

          {/* ---------------------------------------------------------------
              A JANELA — ou a RECUSA do total, quando não há livro-caixa
              --------------------------------------------------------------- */}
          <section>
            <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">
              {diaCurto(r.de)} a {diaCurto(r.ate)} · {r.dias} dias
            </h2>

            {!calculado.total.disponivel ? (
              /*
               * A RECUSA. Vale mais que qualquer cartão: sem o livro-caixa,
               * somar `porDia` dá zero — o mesmo número de quem não gastou nada.
               * Mostrar esse zero com selo de "conferido com o banco" é o
               * desfecho que este painel existe para impedir.
               */
              <div className="rounded-root border border-bad/40 bg-bad/10 p-4 font-os-mono text-[11px] text-bad">
                <Ban size={14} className="mr-[6px] inline-block align-[-3px]" />
                <span className="text-[12px] font-bold uppercase tracking-[0.12em]">
                  Sem total a mostrar
                </span>
                <p className="mt-[8px] leading-[1.55] text-bad/90">
                  {calculado.total.motivoIndisponivel}
                </p>
                <p className="mt-[8px] text-[10.5px] text-muted">
                  O que ainda vale nesta tela: a tabela por agente, que vem dos passos de sessão
                  e não depende do livro-caixa — {usd(r.livroCaixa.gastoDosPassosUsd)} em{' '}
                  {r.livroCaixa.passosComCusto} passo(s) de modelo com custo medido.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Cartao
                  rotulo="Custo medido"
                  /*
                   * A REGRA DO NÃO MEDIDO VALE NO AGREGADO. Janela inteiramente
                   * de modelo sem preço não imprime "US$ 0,00": imprime
                   * travessão, porque o zero ali é ausência de PREÇO, não
                   * ausência de gasto.
                   */
                  valor={rotuloUsd(calculado.total.medidoUsd, !calculado.total.tudoSemPreco)}
                  nota={
                    calculado.total.tudoSemPreco
                      ? `nenhuma das ${calculado.total.chamadas} chamadas tinha preço na tabela`
                      : `conferido com o banco · ${calculado.total.diasComGasto} dia(s) com gasto`
                  }
                />
                <Cartao
                  rotulo="Gasto estimado"
                  valor={usd(calculado.total.estimadoUsd)}
                  nota={NOTA_DO_ESTIMADO}
                />
                <Cartao
                  rotulo="Chamadas"
                  valor={String(calculado.total.chamadas)}
                  nota={
                    calculado.total.chamadasSemPreco > 0
                      ? `${calculado.total.chamadasSemPreco} sem preço — não medidas`
                      : 'todas com preço na tabela'
                  }
                />
                <Cartao
                  rotulo="Cortes pelo teto"
                  valor={String(calculado.total.cortes)}
                  nota="chamadas recusadas antes de acontecer"
                />
              </div>
            )}
          </section>

          {/* ---------------------------------------------------------------
              POR DIA
              --------------------------------------------------------------- */}
          <section>
            <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">
              Por dia
            </h2>
            <div className="overflow-x-auto rounded-root border border-border bg-surface">
              <table className="w-full min-w-[620px] font-os-mono text-[11px]">
                <thead>
                  <tr className="border-b border-border text-[9.5px] uppercase tracking-[0.12em] text-muted">
                    <Th className="text-left">Dia</Th>
                    <Th>Medido</Th>
                    <Th>Estimado</Th>
                    <Th>Chamadas</Th>
                    <Th>Não medidas</Th>
                    <Th>Cortes</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.porDia.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-muted">
                        {calculado.total.disponivel
                          ? 'Nenhuma chamada de modelo registrada nesta janela.'
                          : 'O livro-caixa não tem linha nesta janela — e houve gasto. Veja a recusa acima.'}
                      </td>
                    </tr>
                  )}
                  {r.porDia.map((d) => (
                    <tr key={d.dia} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-[7px] text-text">{diaCurto(d.dia)}</td>
                      <Td>{rotuloUsd(d.medidoUsd, !tudoSemPreco(d))}</Td>
                      <Td>{usd(d.estimadoUsd)}</Td>
                      <Td>{d.chamadas}</Td>
                      <Td className={d.chamadasSemPreco > 0 ? 'text-warn' : 'text-dim'}>
                        {d.chamadasSemPreco > 0 ? d.chamadasSemPreco : '—'}
                      </Td>
                      <Td className={d.cortes > 0 ? 'text-bad' : 'text-dim'}>
                        {d.cortes > 0 ? d.cortes : '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---------------------------------------------------------------
              POR AGENTE
              --------------------------------------------------------------- */}
          <section>
            <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">
              Por agente
            </h2>
            <div className="overflow-x-auto rounded-root border border-border bg-surface">
              <table className="w-full min-w-[680px] font-os-mono text-[11px]">
                <thead>
                  <tr className="border-b border-border text-[9.5px] uppercase tracking-[0.12em] text-muted">
                    <Th className="text-left">Agente</Th>
                    <Th>Medido</Th>
                    <Th>Estimado</Th>
                    <Th>Passos</Th>
                    <Th>Não medidos</Th>
                    <Th>Sessões</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.porAgente.map((a) => (
                    <tr key={a.slug} className="border-b border-border/60">
                      <td className="px-3 py-[7px]">
                        <span className="text-text">{a.nome}</span>{' '}
                        <span className="text-dim">{a.slug}</span>
                      </td>
                      <Td>{rotuloUsd(a.medidoUsd, a.passosNaoMedidos < a.passos)}</Td>
                      {/*
                        O estimado do livro-caixa é por EMPRESA e DIA, sem dono:
                        não há como atribuí-lo a um agente. Travessão, e não
                        zero — zero aqui diria que este agente não gastou
                        estimativa nenhuma, o que ninguém sabe.
                      */}
                      <Td className="text-dim">{NAO_MEDIDO}</Td>
                      <Td>{a.passos}</Td>
                      <Td className={a.passosNaoMedidos > 0 ? 'text-warn' : 'text-dim'}>
                        {a.passosNaoMedidos > 0 ? a.passosNaoMedidos : '—'}
                      </Td>
                      <Td>{a.sessoes}</Td>
                    </tr>
                  ))}
                  {/*
                    A LINHA QUE MUDOU DE NOME NA CORREÇÃO DA 6.4.
                    Ela se chamava "sem agente — chamada simples: relatório,
                    curadoria, pauta, ficha", e o rótulo era factualmente falso:
                    `complete()` grava ZERO no medido e tudo no estimado, então
                    o dinheiro dessas quatro coisas nunca poderia cair aqui. O
                    que cai aqui é resíduo do medido que não casou com passo — e
                    o estimado da empresa inteiro, que não tem dono por
                    construção.
                  */}
                  <tr className="border-b border-border/60 bg-surface-2">
                    <td className="px-3 py-[7px] text-muted">
                      Não atribuído a agente{' '}
                      <span className="text-dim">
                        estimado da empresa (sem dono) + resíduo do medido que não casou com passo
                      </span>
                    </td>
                    <Td className="text-muted">{usd(calculado.atribuicao.naoAtribuidoUsd)}</Td>
                    <Td className="text-muted">{usd(calculado.atribuicao.estimadoUsd)}</Td>
                    <Td className="text-dim">—</Td>
                    <Td className="text-dim">—</Td>
                    <Td className="text-dim">—</Td>
                  </tr>
                  <tr>
                    <td className="px-3 py-[7px] text-text">
                      Gasto no período{' '}
                      <span className="text-dim">medido + estimado — não é &quot;custo medido&quot;</span>
                    </td>
                    <Td className="font-bold text-text">{usd(calculado.atribuicao.medidoUsd)}</Td>
                    <Td className="font-bold text-text">{usd(calculado.atribuicao.estimadoUsd)}</Td>
                    <Td className="text-dim" />
                    <Td className="text-dim" />
                    <Td className="text-dim">{usd(calculado.atribuicao.gastoUsd)}</Td>
                  </tr>
                </tbody>
              </table>
            </div>
            {fraseDoExcedente(calculado.atribuicao) && (
              <p
                className={`mt-2 text-[10.5px] ${
                  calculado.atribuicao.causa === 'virada-do-dia' ? 'text-warn' : 'text-bad'
                }`}
              >
                {fraseDoExcedente(calculado.atribuicao)}
              </p>
            )}
          </section>

          {/* ---------------------------------------------------------------
              ORÇAMENTO MENSAL POR AGENTE — fatia A3
              ---------------------------------------------------------------
              O PERÍODO É OUTRO, E A TELA DIZ ISSO NO TÍTULO. Tudo acima fala da
              janela escolhida (7, 30 ou 90 dias); esta seção fala do MÊS
              CORRENTE, no fuso de cada agente, porque é esse o recorte do
              orçamento e é ele que corta. Sem o rótulo do período, alguém
              somaria os dois e o total não existiria.

              A tabela lista TODOS os agentes, com ou sem orçamento: agente que
              gasta e não tem limite é justamente o que se precisa ver para
              decidir um valor. Quem define é a tela de Agentes — aqui só se lê.
              --------------------------------------------------------------- */}
          <section>
            <h2 className="mb-1 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">
              Orçamento por agente · mês corrente
            </h2>
            <p className="mb-3 text-[10.5px] text-dim">
              Período diferente do resto desta tela: é o mês, não a janela de {r.dias} dias. O
              orçamento é definido em <Link href="/agentes" className="text-brand hover:underline">Agentes</Link>,
              no cartão de cada um, e o alerta acende em {r.teto.percentualAlerta}% — o mesmo
              limiar do teto da empresa.
            </p>
            {calculado.orcamentos.length === 0 ? (
              <p className="rounded-root border border-border bg-surface p-4 text-[11px] text-dim">
                Nenhum agente nesta empresa.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-root border border-border bg-surface">
                <table className="w-full min-w-[680px] font-os-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-border text-[9.5px] uppercase tracking-[0.12em] text-muted">
                      <Th className="text-left">Agente</Th>
                      <Th>Gasto no mês</Th>
                      <Th>Orçamento</Th>
                      <Th>%</Th>
                      <Th>Restante</Th>
                      <Th>Corta?</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculado.orcamentos.map((o) => (
                      <tr key={o.agentSlug} className="border-b border-border/60">
                        <td className="px-3 py-[7px]">
                          <span className="text-text">{o.nome}</span>{' '}
                          <span className="text-dim">{o.agentSlug}</span>
                          {o.passosNaoMedidos > 0 && (
                            <span className="text-warn">
                              {' '}
                              · {o.passosNaoMedidos} passo(s) sem preço: o orçamento não os vê
                            </span>
                          )}
                        </td>
                        <Td className={TOM_DO_TEXTO[TOM_DO_ORCAMENTO[o.estado]]}>
                          {usd(o.gastoUsd)}
                        </Td>
                        <Td>{o.orcamentoUsd === null ? NAO_MEDIDO : usd(o.orcamentoUsd)}</Td>
                        <Td className={TOM_DO_TEXTO[TOM_DO_ORCAMENTO[o.estado]]}>
                          {o.percentual === null ? NAO_MEDIDO : `${o.percentual}%`}
                        </Td>
                        <Td>{o.restanteUsd === null ? NAO_MEDIDO : usd(o.restanteUsd)}</Td>
                        {/*
                          "Corta?" é a pergunta que importa, e ela não é a mesma
                          que "tem orçamento?": orçamento em observação soma,
                          aparece na tela e não recusa nada. Um selo só para as
                          duas coisas treinaria a pessoa a achar que está
                          protegida quando não está.
                        */}
                        <Td className={o.impoe ? 'text-text' : 'text-warn'}>
                          {o.orcamentoUsd === null ? '—' : o.impoe ? 'sim' : 'só observa'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ul className="mt-2 space-y-1">
              {calculado.orcamentos
                .filter((o) => o.disparou)
                .map((o) => (
                  <li
                    key={o.agentSlug}
                    className={`text-[10.5px] ${o.impoe ? 'text-bad' : 'text-warn'}`}
                  >
                    <span className="font-medium">{o.nome}</span>: {o.frase}
                  </li>
                ))}
            </ul>
          </section>

          {/* ---------------------------------------------------------------
              O QUE ESTE PAINEL NÃO VÊ — obrigatório, sempre
              --------------------------------------------------------------- */}
          <section className="rounded-root border border-border bg-surface p-4">
            <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">
              O que este painel não mede
            </h2>
            <ul className="mt-[10px] space-y-[10px]">
              {r.naoCoberto.map((n) => (
                <li key={n.oQue} className="text-[11px] leading-[1.5]">
                  <span className="font-os-mono text-text">{n.oQue}</span> ·{' '}
                  <span className="text-warn">{n.ordemDeGrandeza}</span>
                  <div className="text-muted">{n.onde}</div>
                  <div className="text-dim">Procedência: {n.procedencia}</div>
                </li>
              ))}
            </ul>
          </section>

          <p className="text-[10px] text-muted">
            Fonte: livro-caixa do teto (<code>GastoDeIaNoDia</code>) para empresa e dia; passos
            de sessão (<code>SessionStep</code>) para agente · as duas lidas no mesmo
            instantâneo · gerado {new Date(r.geradoEm).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </div>
  );
}

function Parcela({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-[0.12em] text-muted">{rotulo}</div>
      <div className="text-[13px] tabular-nums text-text">{valor}</div>
      {nota && <div className="text-[9.5px] text-dim">{nota}</div>}
    </div>
  );
}

function Cartao({ rotulo, valor, nota }: { rotulo: string; valor: string; nota: string }) {
  return (
    <div className="rounded-root border border-border bg-surface px-[14px] py-[13px] font-os-mono">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{rotulo}</div>
      <div className="mt-[7px] text-[20px] font-bold leading-none tracking-[-0.04em] tabular-nums text-text">
        {valor}
      </div>
      <div className="mt-[6px] text-[10px] text-muted">{nota}</div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-[7px] font-medium text-right ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-[7px] text-right tabular-nums ${className}`}>{children}</td>;
}
