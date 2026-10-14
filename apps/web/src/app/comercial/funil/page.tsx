'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { CartaoDoFunil, FichaDoLead, FunilVivo } from '@mktos/shared';
import { COMERCIAL_ROTULO_DA_ETAPA } from '@mktos/shared';

import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROTULO_DO_MOTIVO, ROTULO_DO_PRODUTO, agruparFunil, descricaoJaDizQuando, diaSP, motivoDoBloqueio, quandoRoda } from '@/lib/cockpit';

import { Aviso, BarraDaSaude, BOTAO, Carregando, Chip, Erro, FOCO, useCarregar } from '../_ui';
import { LinkDoLead, useMudouNoPainel } from '../_painel/provedor';
import { moverFocoNoFunil } from '../_painel/teclado';

/*
 * TELA 04 · O FUNIL VIVO (lane C; painel na lane UX). Para olhar, não para
 * operar: o cartão anda sozinho quando o fato chega. Arrastar é BLOQUEADO, e a
 * tela diz por quê, com a lista do portão que falta para a próxima etapa (lida
 * da ficha). Clicar no cartão abre o painel do lead por cima do funil, na aba
 * Fio; pelo teclado, as setas andam entre os cartões e Enter abre.
 */


const FILTROS: { chave: string; rotulo: string }[] = [
  { chave: 'todos', rotulo: 'todos' },
  { chave: 'parados', rotulo: 'parados' },
  { chave: 'decisao', rotulo: 'decisão sua' },
  { chave: 'P1', rotulo: 'P1' },
  { chave: 'P2', rotulo: 'P2' },
  { chave: 'P3', rotulo: 'P3' },
  { chave: 'operacao', rotulo: 'Operação' },
  { chave: 'imersao', rotulo: 'Imersão' },
];

export default function FunilVivoPage() {
  const { token } = useAuth();
  const [filtro, setFiltro] = useState('todos');
  const { dados, erro, carregando, recarregar } = useCarregar<FunilVivo>(`/comercial/funil?filtro=${encodeURIComponent(filtro)}`, 30_000);
  useMudouNoPainel(recarregar);
  const [bloqueio, setBloqueio] = useState<{ leadId: string; texto: string } | null>(null);
  // C-11: só a última leitura do portão escreve; a de um cartão anterior que chegar depois é descartada.
  const ultimoPedido = useRef(0);

  async function explicarBloqueio(c: CartaoDoFunil) {
    const pedido = ++ultimoPedido.current;
    const vale = () => pedido === ultimoPedido.current;
    setBloqueio({ leadId: c.leadId, texto: motivoDoBloqueio(c.empresa ?? c.nome, null, null) });
    try {
      const f = await apiGet<FichaDoLead>(`/comercial/lead/${c.leadId}`, token);
      if (!vale()) return;
      const proxima = f.portao.proxima ? COMERCIAL_ROTULO_DA_ETAPA[f.portao.proxima] : null;
      setBloqueio({ leadId: c.leadId, texto: motivoDoBloqueio(c.empresa ?? c.nome, proxima, f.portao.faltando) });
    } catch {
      if (!vale()) return;
      setBloqueio({ leadId: c.leadId, texto: `${motivoDoBloqueio(c.empresa ?? c.nome, null, null)} O portão não pôde ser lido agora.` });
    }
  }

  const grupos = dados ? agruparFunil(dados) : [];

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="filtro">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              type="button"
              aria-pressed={filtro === f.chave}
              onClick={() => setFiltro(f.chave)}
              className={`rounded border px-2.5 py-1 text-[12px] max-md:min-h-[44px] ${filtro === f.chave ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand'} ${FOCO}`}
            >
              {f.rotulo}
            </button>
          ))}
          <Link href="/comercial" className={`ml-auto ${BOTAO}`}>fila de decisões</Link>
        </div>
        <p className="text-[12.5px] text-muted">
          O funil se move sozinho com os fatos. Abra um cartão para ver o lead sem sair daqui (setas do teclado andam entre os cartões, Enter abre). A barra embaixo do nome é a saúde. Arrastar fica bloqueado: quem move é o evento.
        </p>
      </header>

      <Erro erro={erro} aoTentar={() => void recarregar()} />
      {/* C-20: acima do teto de leitura a API corta os mais antigos na etapa e diz quantos ficaram de fora. */}
      {dados?.aviso && <Aviso>{dados.aviso}</Aviso>}
      {carregando && !dados && !erro && <Carregando linhas={2} altura="h-32" />}
      {bloqueio && (
        <div className="flex items-start gap-2" aria-live="polite">
          <Aviso>{bloqueio.texto}</Aviso>
          <button type="button" className={BOTAO} onClick={() => { ultimoPedido.current++; setBloqueio(null); }}>ok</button>
        </div>
      )}

      {dados && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7" onKeyDown={moverFocoNoFunil}>
          {grupos.map((g) => (
            <section
              key={g.chave}
              aria-label={g.rotulo}
              data-coluna-do-funil
              className="min-w-0 rounded border border-border bg-bg2 p-2"
              onDragOver={(e) => e.preventDefault()}
            >
              <h2 className="flex items-baseline justify-between px-1 pb-2 font-os-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                <span>{g.rotulo}</span>
                <span className="tabular-nums">{g.cartoes.length}</span>
              </h2>
              <ul className="space-y-2">
                {g.cartoes.map((c) => (
                  <li key={c.leadId}>
                    <Cartao c={c} aoTentarMover={() => void explicarBloqueio(c)} />
                  </li>
                ))}
                {g.cartoes.length === 0 && <li className="px-1 py-2 text-[12px] text-dim">ninguém aqui</li>}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Cartao({ c, aoTentarMover }: { c: CartaoDoFunil; aoTentarMover: () => void }) {
  const quando = descricaoJaDizQuando(c.proximaAcao?.descricao) ? '' : quandoRoda(c.proximaAcao?.quando);
  const saida = c.motivoSaida ? `${COMERCIAL_ROTULO_DA_ETAPA[c.etapa].replace('Saída · ', '').toLowerCase()} · ${ROTULO_DO_MOTIVO[c.motivoSaida]}` : null;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.preventDefault();
        aoTentarMover();
      }}
      onClick={(e) => {
        // O cartão inteiro abre o painel; o botão "mover" e o próprio link cuidam de si.
        if ((e.target as HTMLElement).closest('a, button')) return;
        e.currentTarget.querySelector<HTMLAnchorElement>('[data-cartao-do-funil]')?.click();
      }}
      className={`cursor-pointer rounded border bg-surface p-2.5 transition hover:border-brand/70 ${c.precisaDeDecisao ? 'border-brand/60' : c.parado ? 'border-warn/60' : 'border-border'}`}
    >
      <div className="flex items-start gap-2">
        <LinkDoLead leadId={c.leadId} aba="fio" data-cartao-do-funil className={`min-w-0 flex-1 rounded-sm ${FOCO}`}>
          <p className="truncate text-[13.5px] font-semibold">{c.empresa ?? c.nome}</p>
          {c.empresa && c.empresa !== c.nome && <p className="truncate text-[11.5px] text-muted">{c.nome}</p>}
        </LinkDoLead>
        <button
          type="button"
          onClick={aoTentarMover}
          aria-label={`mover ${c.nome}: por que está bloqueado`}
          title="mover está bloqueado: a etapa anda pelo fato"
          className={`shrink-0 rounded border border-border px-1.5 font-os-mono text-[10px] text-dim hover:border-brand max-md:min-h-[44px] max-md:min-w-[44px] ${FOCO}`}
        >
          mover
        </button>
      </div>
      <BarraDaSaude saude={c.saude} />
      <p className="mt-1.5 text-[12px] text-muted">
        {saida ?? c.proximaAcao?.descricao ?? 'próxima ação ausente'}
        {quando && !saida && <span className="text-dim"> · {quando}</span>}
        {c.voltaEm && <span className="text-dim"> · volta {diaSP(c.voltaEm)}</span>}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="font-os-mono text-[10px] text-dim">{COMERCIAL_ROTULO_DA_ETAPA[c.etapa].split(' · ')[0]}</span>
        {c.perfil && <Chip>{c.perfil}</Chip>}
        {c.produto && <Chip>{ROTULO_DO_PRODUTO[c.produto]}</Chip>}
        {c.precisaDeDecisao && <Chip tom="brand">decisão sua</Chip>}
        {c.parado && <Chip tom="alerta">parado {c.diasNaEtapa} d</Chip>}
      </div>
    </div>
  );
}
