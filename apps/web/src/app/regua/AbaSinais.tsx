'use client';

import { ArrowUpRight, Lock } from 'lucide-react';
import type { PainelDaRegua } from './tipos';
import { Cartao, Etiqueta } from './ui';

/*
 * OS SINAIS DE ESCALONAMENTO E QUANDO ACENDEM.
 *
 * A regra e as descrições vêm do documento de política desta empresa; `origem`
 * e `quando` vêm do motor, que é quem sabe se o sinal é calculado a partir de
 * um limite, medido no histórico, ou DECLARADO pelo runtime.
 *
 * O de procedência externa é o único de mão única (RF-G-07): conteúdo que veio
 * de mensagem, documento ou página entra como dado, jamais como instrução, e a
 * marca só ELEVA nível — no contexto de execução existe marcar, não existe
 * desmarcar. A tela precisa dizer isso, porque é a diferença entre um sinal que
 * o operador negocia e um que ele não tem como apagar.
 */
export function AbaSinais({ painel }: { painel: PainelDaRegua }) {
  const { escalonamento, limites, retencao, gatilhos } = painel;

  return (
    <div className="space-y-5">
      <Cartao titulo="Como um sinal muda o nível">
        <p className="text-sm text-muted">{escalonamento.regra}</p>
      </Cartao>

      {/*
       * Janela ilegível não é detalhe de configuração: ela acende
       * `fora_da_janela` em TODA ação da empresa, e cada uma sobe um degrau.
       * Quem vê a tela precisa entender por que tudo de repente pede aprovação.
       */}
      {!painel.janelaLegivel && (
        <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          A janela horária desta empresa não é um par de horários legíveis (
          {limites.janelaHoraria[0]} – {limites.janelaHoraria[1]}). Enquanto estiver assim, o sinal{' '}
          <span className="font-mono">fora_da_janela</span> fica aceso em toda ação e cada uma sobe
          um degrau. Corrija a sobrescrita com dois horários no formato HH:MM.
        </div>
      )}

      <div className="space-y-3">
        {escalonamento.sinais.map((s) => (
          <section key={s.id} className="rounded-xl border border-border bg-surface p-5">
            <header className="flex flex-wrap items-center gap-2">
              {s.maoUnica ? (
                <Lock size={14} className="text-warn" aria-hidden />
              ) : (
                <ArrowUpRight size={14} className="text-brand" aria-hidden />
              )}
              <h3 className="font-mono text-sm font-medium">{s.id}</h3>
              <Etiqueta>{s.origem}</Etiqueta>
              {s.maoUnica && (
                <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">
                  de mão única
                </span>
              )}
            </header>
            <p className="mt-2 text-sm">{s.descricao}</p>
            <p className="mt-1 text-xs text-muted">Acende quando {s.quando}.</p>
          </section>
        ))}
      </div>

      <Cartao
        titulo="Gatilhos do efeito"
        aviso="A tabela que traduz o que a ação TOCA no degrau mínimo dela."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Campo</th>
                <th className="py-2 font-medium">Valor → nível</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries(gatilhos).map(([campo, regra]) => (
                <tr key={campo}>
                  <td className="py-2 pr-4 font-mono text-[13px]">{campo}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries((regra ?? {}) as Record<string, unknown>).map(([v, alvo]) => (
                        <Etiqueta key={v}>
                          {v} → {alvo === null ? 'não acende' : String(alvo)}
                        </Etiqueta>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Cartao>

      <div className="grid gap-5 md:grid-cols-2">
        <Cartao titulo="Limites desta empresa">
          <dl className="space-y-1 text-sm">
            <Linha rotulo="Chamadas por execução" valor={limites.porExecucao} />
            <Linha rotulo="Por hora" valor={limites.porHora} />
            <Linha rotulo="Por dia" valor={limites.porDia} />
            <Linha
              rotulo="Janela horária"
              valor={`${limites.janelaHoraria[0]} – ${limites.janelaHoraria[1]} (${painel.fuso})`}
            />
            <Linha
              rotulo="Teto de custo por execução"
              valor={`${limites.tetoCustoCentavosPorExecucao} centavos`}
            />
          </dl>
        </Cartao>

        <Cartao titulo="Retenção do rastro">
          <dl className="space-y-1 text-sm">
            {Object.entries(retencao).map(([k, v]) => (
              <Linha key={k} rotulo={k} valor={String(v)} />
            ))}
          </dl>
        </Cartao>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | number }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-border/50 py-1 last:border-0">
      <dt className="text-muted">{rotulo}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  );
}
