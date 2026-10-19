'use client';

/*
 * O BLOCO "LEITURA E REAÇÃO" DO RELATÓRIO (rodada da implantação I5, prancheta 5).
 *
 * "Quantas vezes a pessoa acessou o link e quais as ideias dela." Tudo é
 * contagem do que está gravado (a visita da sala, a leitura por seção, as
 * reações da proposta): nenhum número aqui é escrito por modelo.
 *
 *  · os tiles: propostas vivas · acessos a propostas · visitas às salas ·
 *    ideias recebidas, no período escolhido em cima;
 *  · a tabela "Leitura por lead", com a situação acionável em chip (leu N×
 *    sem responder em magenta, respondeu em lima, não abriu apagado). O N é
 *    PROVISÓRIO ([a decidir] pela mesa) e a tela diz isso;
 *  · as ideias dos clientes, com "responder" (abre o painel do lead no fio,
 *    onde a reação aparece) e "virar tarefa" (cria a tarefa no Trabalho com a
 *    procedência e o trecho; dois cliques, uma tarefa).
 */
import { useState } from 'react';
import type { IdeiaDoCliente, LinhaDeLeitura, RelatorioDeLeitura } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { quandoCurtoSP } from '@/lib/cockpit';

import { BOTAO, CARTAO, Carregando, Chip, Erro, ErroDaAcao, FOCO, Numero, Rotulo, useCarregar } from '../_ui';
import { LinkDoLead } from '../_painel/provedor';

const TOM: Record<LinhaDeLeitura['situacao']['tipo'], 'ruim' | 'brand' | 'neutro' | 'info'> = {
  leu_sem_responder: 'ruim',
  respondeu: 'brand',
  nao_abriu: 'neutro',
  lendo: 'info',
};

const segundosLegiveis = (s: number) => (s < 60 ? `${s} s` : `${Math.round(s / 60)} min`);

export function LeituraEReacao({ dias }: { dias: number }) {
  const { dados: r, erro, carregando, recarregar } = useCarregar<RelatorioDeLeitura>(`/comercial/relatorio/leitura?dias=${dias}`);

  return (
    <section aria-label="leitura e reação" className="space-y-4" data-testid="bloco-leitura">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-4">
        <h2 className="text-[15px] font-semibold">Leitura e reação</h2>
        {r && (
          <p className="text-[11.5px] text-dim" data-testid="leitura-n">
            &quot;leu sem responder&quot; a partir de {r.n.valor} acessos{r.n.provisorio ? ' · número provisório, [a decidir] pela mesa' : ''}
          </p>
        )}
      </header>
      <Erro erro={erro} aoTentar={() => void recarregar()} />
      {carregando && !r && !erro && <Carregando linhas={2} altura="h-20" />}
      {r && (
        <>
          <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]" data-testid="leitura-tiles">
            <Numero valor={String(r.tiles.propostasVivas)} legenda="propostas vivas" tom="brand" />
            <Numero valor={String(r.tiles.acessosAPropostas)} legenda={`acessos a propostas em ${r.periodoDias} dias`} />
            <Numero valor={String(r.tiles.visitasAsSalas)} legenda={`visitas às salas em ${r.periodoDias} dias`} />
            <Numero valor={String(r.tiles.ideiasRecebidas)} legenda="ideias recebidas" />
          </div>

          <section className={CARTAO} aria-label="leitura por lead">
            <Rotulo>leitura por lead</Rotulo>
            {r.leitura.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">Nenhuma proposta publicada no período.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[12.5px]" data-testid="leitura-tabela">
                  <thead className="font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                    <tr>
                      <th className="py-1.5 pr-2 font-normal">lead</th>
                      <th className="py-1.5 pr-2 font-normal">enviada</th>
                      <th className="py-1.5 pr-2 text-right font-normal">acessos</th>
                      <th className="py-1.5 pr-2 font-normal">último acesso</th>
                      <th className="py-1.5 pr-2 font-normal">seção mais lida</th>
                      <th className="py-1.5 pr-2 text-right font-normal">ideias</th>
                      <th className="py-1.5 font-normal">situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.leitura.map((l) => (
                      <tr key={l.leadId} className={`border-t border-border ${l.situacao.tipo === 'nao_abriu' ? 'text-muted' : ''}`} data-testid={`leitura-linha-${l.leadId}`}>
                        <td className="py-1.5 pr-2">
                          <LinkDoLead leadId={l.leadId} aba="fio" className={`hover:text-brand ${FOCO}`} title={l.nome}>{l.nome}</LinkDoLead>
                          <span className="ml-1 font-os-mono text-[10px] text-dim">v{l.versao}</span>
                        </td>
                        <td className="py-1.5 pr-2 font-os-mono text-[11px]">{quandoCurtoSP(l.enviadaEm)}</td>
                        <td className="py-1.5 pr-2 text-right font-os-mono tabular-nums">{l.acessos}</td>
                        <td className="py-1.5 pr-2 font-os-mono text-[11px]">{l.ultimoAcessoEm ? quandoCurtoSP(l.ultimoAcessoEm) : 'nunca'}</td>
                        <td className="py-1.5 pr-2">{l.secaoMaisLida ? `${l.secaoMaisLida.rotulo.toLowerCase()} · ${segundosLegiveis(l.secaoMaisLida.segundos)}` : 'sem leitura medida'}</td>
                        <td className="py-1.5 pr-2 text-right font-os-mono tabular-nums">{l.ideias}</td>
                        <td className="py-1.5"><Chip tom={TOM[l.situacao.tipo]}>{l.frase}</Chip></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-label="ideias deixadas pelos clientes" className="space-y-2">
            <Rotulo>ideias deixadas pelos clientes</Rotulo>
            {r.ideias.length === 0 ? (
              <p className={`${CARTAO} text-[13px] text-muted`}>Nenhuma ideia ou dúvida deixada na proposta no período.</p>
            ) : (
              <ul className="grid gap-2 md:grid-cols-2" data-testid="leitura-ideias">
                {r.ideias.map((i) => <CartaoDaIdeia key={i.id} i={i} aoMudar={recarregar} />)}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function CartaoDaIdeia({ i, aoMudar }: { i: IdeiaDoCliente; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [criada, setCriada] = useState<{ tarefaId: string; listId: string } | null>(null);
  const tarefa = criada ?? (i.tarefaId ? { tarefaId: i.tarefaId, listId: '' } : null);

  async function virarTarefa() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await apiPost<{ tarefaId: string; listId: string }>(`/comercial/reacoes/${encodeURIComponent(i.id)}/tarefa`, {}, token);
      setCriada(r);
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className={`${CARTAO} space-y-2`} data-testid={`ideia-${i.id}`}>
      <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        <span className="font-semibold text-text">{i.nome}</span>
        <span aria-hidden>·</span>
        <span className="font-os-mono text-[10.5px] uppercase tracking-[0.1em]">{i.rotuloDaSecao}</span>
        <span aria-hidden>·</span>
        <span className="font-os-mono text-[10.5px]">{quandoCurtoSP(i.em)}</span>
        <Chip tom={i.tipo === 'ideia' ? 'brand' : 'info'}>{i.tipo === 'ideia' ? 'ideia' : 'dúvida'}</Chip>
      </p>
      {/* Texto do cliente: renderizado como texto, nunca como HTML. */}
      <p className="whitespace-pre-line break-words text-[13.5px]">“{i.texto}”</p>
      <div className="flex flex-wrap items-center gap-2">
        <LinkDoLead leadId={i.leadId} aba="fio" className={`${BOTAO}`} data-testid={`ideia-responder-${i.id}`}>responder</LinkDoLead>
        {tarefa ? (
          <a href={`/trabalho?${tarefa.listId ? `lista=${tarefa.listId}&` : ''}tarefa=${tarefa.tarefaId}`} className={`${BOTAO} border-brand/50 text-brand`} data-testid={`ideia-tarefa-${i.id}`}>
            ver a tarefa
          </a>
        ) : (
          <button type="button" className={BOTAO} disabled={ocupado} onClick={() => void virarTarefa()} data-testid={`ideia-virar-tarefa-${i.id}`}>
            {ocupado ? 'criando…' : 'virar tarefa'}
          </button>
        )}
        {i.respondidaEm && <span className="text-[11.5px] text-dim">respondida {quandoCurtoSP(i.respondidaEm)}</span>}
      </div>
      <ErroDaAcao erro={erro} />
    </li>
  );
}
