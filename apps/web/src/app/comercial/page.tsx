'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { FilaDeDecisoes } from '@mktos/shared';

import { ROTULO_DA_FONTE, horaSP, instantesLegiveis } from '@/lib/cockpit';

import { Aviso, BOTAO, CARTAO, Carregando, Erro, FOCO, Numero, Rotulo, useCarregar } from './_ui';
import { CartaoDeDecisao } from './_decisao';
import { LinkDoLead, useMudouNoPainel, usePainel } from './_painel/provedor';

/*
 * TELA 03 · A FILA DE DECISÕES (lane C; painel na lane UX). A tela principal
 * do comercial é a das exceções: só o que saiu da regra, com a decisão pronta
 * em um toque, o padrão escrito e o prazo. Se o prazo vencer, o relógio
 * aplica o padrão. O nome do lead abre o painel por cima da fila, na aba
 * Decisões; decidir tira o cartão da fila com uma transição curta.
 */
export default function FilaDeDecisoesPage() {
  const { dados, erro, carregando, recarregar } = useCarregar<FilaDeDecisoes>('/comercial/fila', 30_000);
  const painel = usePainel();
  useMudouNoPainel(recarregar);
  const [tudo, setTudo] = useState(false);
  // Os cartões que acabaram de ser respondidos: saem com a transição antes da fila reler.
  const [saindo, setSaindo] = useState<Set<string>>(new Set());
  const limite = tudo ? 200 : 12;

  async function respondida(id: string, texto: string) {
    setSaindo((s) => new Set(s).add(id));
    painel.avisar(texto);
    await new Promise((r) => setTimeout(r, 220));
    await recarregar();
    setSaindo((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }

  const decisoes = dados?.decisoes ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-[13.5px] text-muted">
          Só o que precisa de alguém. Cada decisão tem o padrão escrito e o prazo; se ninguém responder, vale o padrão.
        </p>
        <nav aria-label="outras telas do comercial" className="flex flex-wrap gap-2 text-[12.5px]">
          <Link href="/comercial/funil" className={BOTAO}>funil vivo</Link>
          <Link href="/comercial/contratos" className={BOTAO}>contratos</Link>
          <Link href="/comercial/torre" className={BOTAO}>torre</Link>
          <Link href="/comercial/relatorio" className={BOTAO}>relatório</Link>
        </nav>
      </header>

      <Erro erro={erro} aoTentar={() => void recarregar()} />
      {carregando && !dados && !erro && (
        <Carregando linhas={3} altura="h-28" />
      )}

      {dados && (
        <>
          <section aria-label="resumo" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Numero valor={String(dados.resumo.decisoes)} legenda={dados.resumo.decisoes === 1 ? 'decisão na fila' : 'decisões na fila'} tom="brand" />
            <Numero valor={String(dados.resumo.acoesAutomaticasHoje)} legenda="ações automáticas hoje" />
            <Numero valor={String(dados.resumo.leadsVivos)} legenda="leads vivos" />
            <Numero valor={String(dados.resumo.automacoesComErro)} legenda="automações com erro" tom={dados.resumo.automacoesComErro ? 'ruim' : undefined} />
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-label="decisões" className="space-y-3">
              <Rotulo>decisões abertas</Rotulo>
              {decisoes.length === 0 && (
                <Aviso>
                  Nenhuma decisão esperando agora.{' '}
                  {dados.resumo.acoesAutomaticasHoje > 0
                    ? `${dados.resumo.acoesAutomaticasHoje} ${dados.resumo.acoesAutomaticasHoje === 1 ? 'ação rodou sozinha' : 'ações rodaram sozinhas'} hoje.`
                    : 'Nada saiu da regra.'}
                </Aviso>
              )}
              {decisoes.map((d) => (
                <div
                  key={d.id}
                  className={`transition-all duration-200 ease-out motion-reduce:transition-none ${saindo.has(d.id) ? 'pointer-events-none -translate-x-2 opacity-0' : 'opacity-100'}`}
                >
                  <CartaoDeDecisao d={d} aoResponder={(texto) => respondida(d.id, texto)} />
                </div>
              ))}
            </section>

            <section aria-label="rodou sozinho hoje" className={`${CARTAO} h-fit`}>
              <Rotulo>rodou sozinho hoje</Rotulo>
              {dados.rodouSozinhoHoje.length === 0 && <p className="mt-2 text-[12.5px] text-muted">Nada rodou sozinho hoje.</p>}
              <ul className="mt-2 divide-y divide-border">
                {dados.rodouSozinhoHoje.slice(0, limite).map((r, i) => (
                  <li key={`${r.em}-${i}`} className="grid grid-cols-[42px_56px_minmax(0,1fr)] gap-2 py-1.5 text-[12.5px]">
                    <span className="font-os-mono tabular-nums text-muted">{horaSP(r.em)}</span>
                    <span className="font-os-mono text-[11px] text-info">{ROTULO_DA_FONTE[r.fonte] ?? r.fonte}</span>
                    <LinkDoLead leadId={r.leadId} className={`min-w-0 truncate hover:text-brand ${FOCO}`} title={r.resumo}>
                      {instantesLegiveis(r.resumo)}
                    </LinkDoLead>
                  </li>
                ))}
              </ul>
              {dados.rodouSozinhoHoje.length > 12 && (
                <button type="button" className={`mt-2 text-[12px] text-muted underline underline-offset-2 hover:text-brand max-md:min-h-[44px] ${FOCO}`} onClick={() => setTudo((v) => !v)}>
                  {tudo ? 'mostrar menos' : `mostrar as ${dados.rodouSozinhoHoje.length}`}
                </button>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
