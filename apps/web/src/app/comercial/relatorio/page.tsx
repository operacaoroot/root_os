'use client';

import { useState } from 'react';
import type { RelatorioDaSemana } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROTULO_DO_MOTIVO, diaSP, numeroOuAusente, quandoCurtoSP, rotuloDaLinhaDoFunil } from '@/lib/cockpit';

import { BOTAO, CARTAO, Carregando, Erro, FOCO, Numero, Rotulo, useCarregar } from '../_ui';
import { LinkDoLead, useMudouNoPainel } from '../_painel/provedor';

/*
 * TELA 13 · O RELATÓRIO DA QUINTA (lane C). Conversão, velocidade, perdas por
 * motivo, previsão e quanto rodou sozinho. Os números são do sistema; a
 * narrativa, quando houver, é do relator, sem número escrito pelo modelo.
 * Erro da API aparece na caixa de erro, sem número.
 */
const PERIODOS = [7, 30, 90];

export default function RelatorioPage() {
  const { token } = useAuth();
  const [dias, setDias] = useState(7);
  const { dados: r, erro, carregando, recarregar } = useCarregar<RelatorioDaSemana>(`/comercial/relatorio/semana?dias=${dias}`);
  useMudouNoPainel(recarregar);
  const [erroDaAcao, setErroDaAcao] = useState<unknown>(null);
  const [gerando, setGerando] = useState(false);

  async function gerar() {
    setGerando(true);
    setErroDaAcao(null);
    try {
      await apiPost('/comercial/relatorio/semana/gerar', { dias }, token);
      await recarregar();
    } catch (e) {
      setErroDaAcao(e);
    } finally {
      setGerando(false);
    }
  }

  const maxFunil = r ? Math.max(1, ...r.funil.map((f) => f.n)) : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <p className="max-w-xl text-[13.5px] text-muted">Conversão, velocidade, perdas e previsão do período. Pronto sozinho antes da reunião de quinta, 19h30; gere de novo quando quiser.</p>
        <div className="ml-auto flex gap-1.5" role="group" aria-label="período">
          {PERIODOS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={dias === d}
              onClick={() => setDias(d)}
              className={`rounded border px-2.5 py-1 text-[12px] max-md:min-h-[44px] ${dias === d ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand'} ${FOCO}`}
            >
              {d} dias
            </button>
          ))}
          <button type="button" className={BOTAO} disabled={gerando} onClick={() => void gerar()}>
            {gerando ? 'Gerando…' : 'Gerar agora'}
          </button>
        </div>
      </header>

      <Erro erro={erro} aoTentar={() => void recarregar()} />
      <Erro erro={erroDaAcao} />
      {carregando && !r && !erro && <Carregando linhas={3} altura="h-24" />}

      {r && (
        <>
          <section aria-label="resumo" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Numero valor={String(r.leads)} legenda={`leads em ${r.periodoDias} dias`} tom="brand" />
            <Numero valor={String(r.fechados)} legenda="fechados" />
            <Numero valor={numeroOuAusente(r.medianaDiasDoOiAoPix)} legenda="dias do 1º oi ao Pix (mediana)" />
            <Numero valor={`${r.acoes.automaticas} · ${r.acoes.humanas}`} legenda="ações automáticas · humanas" />
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section className={CARTAO} aria-label="funil no período">
              <Rotulo>funil em {r.periodoDias} dias</Rotulo>
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {r.funil.map((f) => (
                  <li key={f.etapa} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 text-muted">{rotuloDaLinhaDoFunil(f.etapa)}</span>
                      <span className="shrink-0 font-os-mono tabular-nums">{f.n}</span>
                    </div>
                    <span className="block h-2 rounded bg-surface-3">
                      <span className="block h-2 rounded bg-brand" style={{ width: `${(f.n / maxFunil) * 100}%` }} />
                    </span>
                  </li>
                ))}
                {r.funil.length === 0 && <li className="text-muted">Nenhum lead no período.</li>}
              </ul>
            </section>

            <section className={CARTAO} aria-label="perdas e previsão">
              <Rotulo>perdas por motivo</Rotulo>
              <ul className="mt-2 space-y-1 text-[13px]">
                {r.perdasPorMotivo.map((p) => (
                  <li key={p.motivo} className="flex justify-between gap-2">
                    <span>{ROTULO_DO_MOTIVO[p.motivo] ?? p.motivo}</span>
                    <span className="font-os-mono tabular-nums">{p.n}</span>
                  </li>
                ))}
                {r.perdasPorMotivo.length === 0 && <li className="text-muted">Nenhuma perda no período.</li>}
              </ul>
              <Rotulo className="mt-4">previsão do mês</Rotulo>
              <p className="mt-2 text-[13px]">
                {r.previsao
                  ? `${r.previsao.fechamentosProvaveis} ${r.previsao.fechamentosProvaveis === 1 ? 'fechamento provável' : 'fechamentos prováveis'} entre ${r.previsao.leadsEmProposta} ${r.previsao.leadsEmProposta === 1 ? 'lead' : 'leads'} em proposta`
                  : `ausente${r.previsaoPendente ? `: ${r.previsaoPendente}` : ''}`}
              </p>
              {r.propostasVencendo && r.propostasVencendo.length > 0 && (
                <>
                  <Rotulo className="mt-4">propostas vencendo</Rotulo>
                  <ul className="mt-2 space-y-1 text-[13px]">
                    {r.propostasVencendo.map((p) => (
                      <li key={p.leadId} className="flex justify-between gap-2">
                        <LinkDoLead leadId={p.leadId} aba="sessao" className={`min-w-0 truncate hover:text-brand ${FOCO}`}>{p.nome}</LinkDoLead>
                        <span className="shrink-0 font-os-mono text-muted">vence {diaSP(p.validade)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          <section className={CARTAO} aria-label="leitura">
            <Rotulo>leitura da semana</Rotulo>
            <p className="mt-2 whitespace-pre-line text-[13px]">{r.narrativa ?? 'ausente: o relator ainda não escreveu a leitura deste período.'}</p>
            {r.narrativaAvisos && r.narrativaAvisos.length > 0 && (
              <p className="mt-2 text-[11.5px] text-dim">
                Avisos da leitura (o que o sistema tirou ou não conseguiu): {r.narrativaAvisos.join(' · ')}
              </p>
            )}
            <p className="mt-2 text-[11.5px] text-dim">
              {r.origem === 'ao_vivo' ? `números ao vivo de ${quandoCurtoSP(r.geradoEm)}, sem leitura gerada para este recorte` : `gerado ${quandoCurtoSP(r.geradoEm)}`}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
