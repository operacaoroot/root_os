'use client';

import type { PremissaDoVigia, TorreDasAutomacoes } from '@mktos/shared';
import { COMERCIAL_ROTULO_DA_AUTOMACAO } from '@mktos/shared';

import { custoDaTorre, diaSemanaSP, horaSP, percentual, quandoCurtoSP } from '@/lib/cockpit';

import { CARTAO, Carregando, Chip, Erro, FOCO, Numero, Rotulo, useCarregar } from '../_ui';
import { LinkDoLead, useMudouNoPainel } from '../_painel/provedor';
import { ResumoDoVigiaNaTorre } from './ResumoDoVigia';

/*
 * TELA 12 · A TORRE DAS AUTOMAÇÕES (lane C). Cada automação com o nível de
 * autonomia (e o degrau que a torre sugere), a última vez que rodou, quanto
 * rodou sem erro em 30 dias e a premissa conferida pelo vigia, com a lista do
 * que quebrou. Só lê. Erro da API aparece na caixa de erro, sem número.
 */
// As colunas da tabela acompanham a largura (piso e fração), em vez de 170/110/90/110 px fixos.
const COLUNAS_DA_TORRE = 'md:grid-cols-[minmax(8rem,1.3fr)_minmax(6.5rem,0.8fr)_minmax(5.5rem,0.7fr)_minmax(6.5rem,0.8fr)_minmax(0,2fr)]';

export default function TorrePage() {
  const { dados: t, erro, carregando, recarregar } = useCarregar<TorreDasAutomacoes>('/comercial/torre', 60_000);
  useMudouNoPainel(recarregar);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <p className="text-[13.5px] text-muted">
        O vigia confere as premissas de cada automação todo dia às 08:00; o que quebrou aparece aqui, com os leads atingidos. A autonomia sobe de degrau com prova, e quem aprova a subida é gente.
      </p>
      <Erro erro={erro} aoTentar={() => void recarregar()} />
      {carregando && !t && !erro && <Carregando linhas={3} altura="h-24" />}
      {t && (
        <>
          {t.vigia.resumo?.linhas?.length ? <ResumoDoVigiaNaTorre resumo={t.vigia.resumo} /> : null}
          <PremissasQuebradas premissas={t.vigia.premissas} quebradas={t.vigia.premissasQuebradas} />
          <section aria-label="vigia" className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">
            <Numero valor={t.vigia.ultimaPassagemEm ? horaSP(t.vigia.ultimaPassagemEm) : 'ausente'} legenda={t.vigia.ultimaPassagemEm ? `última passagem do vigia · ${diaSemanaSP(t.vigia.ultimaPassagemEm)}` : 'o vigia ainda não passou'} />
            <Numero valor={String(t.vigia.premissasConferidas)} legenda="premissas conferidas" />
            <Numero valor={String(t.vigia.premissasQuebradas)} legenda="premissas quebradas" tom={t.vigia.premissasQuebradas ? 'ruim' : undefined} />
            <Numero valor={custoDaTorre(t).valor} legenda={custoDaTorre(t).legenda} />
          </section>

          <section className={CARTAO} aria-label="automações">
            <Rotulo>automações</Rotulo>
            <div className={`mt-2 hidden gap-3 border-b border-border pb-1.5 font-os-mono text-[10px] uppercase tracking-[0.12em] text-dim md:grid ${COLUNAS_DA_TORRE}`}>
              <span>automação</span><span>autonomia</span><span>última vez</span><span>rodou sem erro 30 d</span><span>premissa conferida hoje</span>
            </div>
            <ul className="divide-y divide-border">
              {t.automacoes.map((a) => (
                <li key={a.chave} className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1 py-2 text-[13px] ${COLUNAS_DA_TORRE}`}>
                  <span className="col-span-2 min-w-0 font-semibold md:col-span-1">{a.rotulo || COMERCIAL_ROTULO_DA_AUTOMACAO[a.chave]}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    <Chip tom={a.autonomia === 'A0' ? 'neutro' : 'brand'} title={a.autonomiaGravada === false ? 'sem nível gravado: vale o degrau da régua' : undefined}>{a.autonomia}</Chip>
                    {a.autonomiaGravada === false && <span className="text-[11px] text-dim">da régua</span>}
                    {a.proximoDegrau && (
                      <Chip tom="info" title="Um mês sem erro. Quem sobe o degrau é gente, na configuração do comercial.">sugere {a.proximoDegrau}</Chip>
                    )}
                  </span>
                  <span className="font-os-mono text-[12px] tabular-nums text-muted">{a.ultimaVezEm ? quandoCurtoSP(a.ultimaVezEm) : 'nunca'}</span>
                  <span className="font-os-mono text-[12px] tabular-nums" title={a.passagens30Dias != null ? `${a.passagens30Dias} passagens em 30 dias` : undefined}>
                    <span className="md:hidden text-muted">rodou sem erro </span>
                    {percentual(a.acerto30Dias)}
                  </span>
                  <span className="col-span-2 flex min-w-0 gap-2 md:col-span-1">
                    <span aria-hidden className={a.premissaOk == null ? 'text-dim' : a.premissaOk ? 'text-good' : 'text-bad'}>{a.premissaOk == null ? '○' : '●'}</span>
                    <span className={`min-w-0 ${a.premissaOk === false ? 'text-bad' : ''}`}>{a.premissa}</span>
                    <span className="sr-only">{a.premissaOk == null ? 'não conferida' : a.premissaOk ? 'ok' : 'quebrada'}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-dim">
              Rodou sem erro: a parte das passagens dos últimos 30 dias que terminou sem erro. Não mede se o conteúdo estava certo. Sem passagem, fica ausente.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/** C-15: o que o vigia achou quebrado na última passagem, com a premissa, o detalhe e os leads. */
function PremissasQuebradas({ premissas, quebradas }: { premissas?: PremissaDoVigia[]; quebradas: number }) {
  const lista = (premissas ?? []).filter((p) => p.ok === false);
  const naoConferidas = (premissas ?? []).filter((p) => p.ok == null).length;
  if (!lista.length && !naoConferidas && !quebradas) return null;
  return (
    <section className={CARTAO} aria-label="premissas quebradas">
      <Rotulo>premissas quebradas</Rotulo>
      {lista.length === 0 && quebradas > 0 && (
        <p className="mt-2 text-[13px] text-muted">O vigia contou {quebradas} quebrada{quebradas === 1 ? '' : 's'}, mas a lista não veio da API.</p>
      )}
      {lista.length === 0 && quebradas === 0 && <p className="mt-2 text-[13px] text-muted">Nenhuma premissa quebrada na última passagem.</p>}
      <ul className="mt-2 space-y-2">
        {lista.map((p) => (
          <li key={p.chave} className="text-[13px]">
            <p className="text-bad">
              {p.automacao ? `${COMERCIAL_ROTULO_DA_AUTOMACAO[p.automacao]} · ` : ''}
              {p.premissa}
            </p>
            {p.detalhe && <p className="text-[12.5px] text-muted">{p.detalhe}</p>}
            {p.leads.length > 0 && (
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px]">
                <span className="text-muted">{p.leads.length === 1 ? 'lead:' : `${p.leads.length} leads:`}</span>
                {p.leads.slice(0, 10).map((id) => (
                  <LinkDoLead key={id} leadId={id} title={`abrir o lead ${id}`} className={`font-os-mono underline-offset-2 hover:underline max-md:py-2 ${FOCO}`}>
                    {id.slice(0, 8)}
                  </LinkDoLead>
                ))}
                {p.leads.length > 10 && <span className="text-muted">e mais {p.leads.length - 10}</span>}
              </p>
            )}
          </li>
        ))}
      </ul>
      {naoConferidas > 0 && (
        <p className="mt-2 text-[12px] text-dim">
          {naoConferidas} {naoConferidas === 1 ? 'premissa não pôde ser conferida' : 'premissas não puderam ser conferidas'} hoje: número a decidir ou fonte que o vigia não alcança.
        </p>
      )}
    </section>
  );
}
