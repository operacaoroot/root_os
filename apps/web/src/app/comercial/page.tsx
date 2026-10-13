'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DecisaoNaFila, FilaDeDecisoes } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROTULO_DA_FONTE, ROTULO_DO_TIPO_DE_DECISAO, decisaoSemPrazo, horaSP, instantesLegiveis, prazoDaDecisao, quandoSP, rotuloDoPadrao } from '@/lib/cockpit';

import { Aviso, BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Chip, Erro, FOCO, Numero, Rotulo, useCarregar } from './_ui';

/*
 * TELA 03 · A FILA DE DECISÕES (lane C). A tela principal do comercial é a
 * das exceções: só o que saiu da regra, com a decisão pronta em um toque, o
 * padrão escrito e o prazo. Se o prazo vencer, o relógio aplica o padrão.
 * O funil existe para olhar; aqui é onde se decide.
 */
export default function FilaDeDecisoesPage() {
  const { dados, erro, carregando, recarregar } = useCarregar<FilaDeDecisoes>('/comercial/fila', 30_000);
  const [tudo, setTudo] = useState(false);
  const limite = tudo ? 200 : 12;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-[13.5px] text-muted">
          Só o que precisa de alguém. Cada decisão tem o padrão escrito e o prazo; se ninguém responder, vale o padrão.
        </p>
        <nav className="flex flex-wrap gap-2 text-[12.5px]">
          <Link href="/comercial/funil" className={`${BOTAO}`}>funil vivo</Link>
          <Link href="/comercial/contratos" className={`${BOTAO}`}>contratos</Link>
          <Link href="/comercial/torre" className={`${BOTAO}`}>torre</Link>
          <Link href="/comercial/relatorio" className={`${BOTAO}`}>relatório</Link>
        </nav>
      </header>

      <Erro erro={erro} />
      {carregando && !dados && <Carregando />}

      {dados && (
        <>
          <section aria-label="resumo" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Numero valor={String(dados.resumo.decisoes)} legenda={dados.resumo.decisoes === 1 ? 'decisão sua' : 'decisões suas'} tom="brand" />
            <Numero valor={String(dados.resumo.acoesAutomaticasHoje)} legenda="ações automáticas hoje" />
            <Numero valor={String(dados.resumo.leadsVivos)} legenda="leads vivos" />
            <Numero valor={String(dados.resumo.automacoesComErro)} legenda="automações com erro" tom={dados.resumo.automacoesComErro ? 'ruim' : undefined} />
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-label="decisões" className="space-y-3">
              <Rotulo>decisões abertas</Rotulo>
              {dados.decisoes.length === 0 && <Aviso>Nada saiu da regra. Não há decisão esperando por você.</Aviso>}
              {dados.decisoes.map((d) => (
                <Decisao key={d.id} d={d} aoResponder={recarregar} />
              ))}
            </section>

            <section aria-label="rodou sozinho hoje" className={`${CARTAO} h-fit`}>
              <Rotulo>rodou sozinho hoje</Rotulo>
              {dados.rodouSozinhoHoje.length === 0 && <p className="mt-2 text-[12.5px] text-muted">Nada rodou sozinho hoje.</p>}
              <ul className="mt-2 divide-y divide-border">
                {dados.rodouSozinhoHoje.slice(0, limite).map((r, i) => (
                  <li key={`${r.em}-${i}`} className="grid grid-cols-[42px_56px_minmax(0,1fr)] gap-2 py-1.5 text-[12.5px]">
                    <span className="font-os-mono text-muted">{horaSP(r.em)}</span>
                    <span className="font-os-mono text-[11px] text-info">{ROTULO_DA_FONTE[r.fonte] ?? r.fonte}</span>
                    <Link href={`/comercial/lead/${r.leadId}`} className={`min-w-0 truncate hover:text-brand ${FOCO}`} title={r.resumo}>
                      {instantesLegiveis(r.resumo)}
                    </Link>
                  </li>
                ))}
              </ul>
              {dados.rodouSozinhoHoje.length > 12 && (
                <button type="button" className={`mt-2 text-[12px] text-muted underline underline-offset-2 hover:text-brand ${FOCO}`} onClick={() => setTudo((v) => !v)}>
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

function Decisao({ d, aoResponder }: { d: DecisaoNaFila; aoResponder: () => Promise<void> }) {
  const { token } = useAuth();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const prazo = prazoDaDecisao(d.expiraEm);

  async function responder(escolha: string, rotulo: string) {
    setEnviando(escolha);
    setErro(null);
    try {
      await apiPost(`/comercial/decisoes/${d.id}/responder`, { escolha }, token);
      setFeito(`Respondido: ${rotulo}. A resposta entrou no fio do lead.`);
      await aoResponder();
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(null);
    }
  }

  return (
    <article className={`${CARTAO} space-y-3`} aria-labelledby={`dec-${d.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tom="brand">{ROTULO_DO_TIPO_DE_DECISAO[d.tipo] ?? d.tipo}</Chip>
        <Chip tom={prazo.vencido ? 'ruim' : 'alerta'}>{prazo.texto}</Chip>
        <Link href={`/comercial/lead/${d.leadId}`} className={`ml-auto text-[12px] text-muted underline-offset-2 hover:underline ${FOCO}`}>
          {d.leadNome} · ver o fio
        </Link>
      </div>
      <div>
        <h3 id={`dec-${d.id}`} className="text-[15px] font-semibold">{d.titulo}</h3>
        <p className="mt-1 text-[13px] text-muted">{d.contexto}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {d.opcoes.map((o) => {
          const ehPadrao = o.chave === d.padrao;
          return (
            <button
              key={o.chave}
              type="button"
              disabled={!!enviando || d.estado !== 'aberta'}
              onClick={() => void responder(o.chave, o.rotulo)}
              className={ehPadrao ? BOTAO_PRIMARIO : BOTAO}
              title={o.efeito}
            >
              {enviando === o.chave ? 'enviando…' : o.rotulo}
              {ehPadrao && <span className="ml-1.5 font-os-mono text-[9.5px] uppercase opacity-80">padrão</span>}
            </button>
          );
        })}
      </div>
      <ul className="space-y-0.5 text-[12px] text-muted">
        {d.opcoes.filter((o) => o.efeito).map((o) => (
          <li key={o.chave}>
            <span className="text-text">{o.rotulo}:</span> {o.efeito}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">
        {decisaoSemPrazo(d.expiraEm) ? (
          <>
            Sem prazo configurado: a decisão só sai com uma resposta. O padrão escrito é <span className="text-text">{rotuloDoPadrao(d)}</span>.
          </>
        ) : (
          <>
            Se ninguém responder até {quandoSP(d.expiraEm)}, vale o padrão: <span className="text-text">{rotuloDoPadrao(d)}</span>.
          </>
        )}
      </p>
      {feito && <Aviso tom="bom">{feito}</Aviso>}
      <Erro erro={erro} />
    </article>
  );
}
