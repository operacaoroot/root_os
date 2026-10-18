'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { LeadList, QuadroDaLista, TrabEstrutura } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EVENTO_FICHA_MUDOU, abrirFicha } from '@/lib/ficha';
import { VisoesDaLista } from '@/components/ficha/VisoesDaLista';
import { StatusChip } from '@/components/StatusChip';
import { NovaOportunidadeExercicio } from './NovaOportunidadeExercicio';

/*
 * LEADS (18/10/2026): todos os cards do CRM (um por lead/cliente, da primeira
 * conversa ao pós-venda) em Lista, com Quadro e Calendário a um clique. É a
 * mesma lista do Painel geral, do Funil e de Clientes; só a visão muda.
 *
 * A tabela antiga (`Lead`) continua existindo: é onde caem os contatos do site
 * e dos formulários (e o exercício de QA). Ela aparece recolhida embaixo, e
 * cada entrada pode ser trazida para o CRM, onde a negociação acontece.
 */
const CRM = 'crm-root-lista';
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export default function LeadsPage() {
  return (
    <div className="com-tema space-y-6 text-text">
      <VisoesDaLista chave={CRM} item="lead" rotuloAbertos="Cards" rotuloDoValor="No funil" novo="+ Novo lead" visaoInicial="lista" />
      <EntradasDoSite />
    </div>
  );
}

function EntradasDoSite() {
  const { token, ready } = useAuth();
  const [entradas, setEntradas] = useState<LeadList | null>(null);
  const [crm, setCrm] = useState<QuadroDaLista | null>(null);
  const [trazendo, setTrazendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<LeadList>('/leads', token).then(setEntradas).catch((e) => setErro(e.message));
    apiGet<QuadroDaLista>(`/trabalho/fichas/quadro?lista=${CRM}`, token).then(setCrm).catch(() => setCrm(null));
  }, [token]);

  useEffect(() => {
    if (!ready || !token) return;
    carregar();
    window.addEventListener(EVENTO_FICHA_MUDOU, carregar);
    return () => window.removeEventListener(EVENTO_FICHA_MUDOU, carregar);
  }, [ready, token, carregar]);

  /** A entrada já está no CRM quando algum card tem o mesmo nome no título ou no contato. */
  const noCrm = (nome: string) => {
    const n = semAcento(nome);
    return crm?.cartoes.find((c) => semAcento(c.titulo).includes(n) || (c.contato && semAcento(c.contato) === n));
  };

  const trazer = async (l: LeadList['items'][number]) => {
    if (!token || !crm?.lista) return;
    setTrazendo(l.id);
    setErro(null);
    try {
      const e = await apiGet<TrabEstrutura>('/trabalho/estrutura', token);
      const lista = [...e.folders.flatMap((f) => f.lists), ...e.listasSoltas].find((x) => x.id === crm.lista!.id);
      const campo = (nome: string) => lista?.fields.find((f) => semAcento(f.name).startsWith(nome));
      const campos: Record<string, { optionId?: string; value?: string }> = {};
      const contato = campo('contato');
      const email = campo('e-mail');
      const canal = campo('canal');
      const cadastro = campo('data de cadastro');
      if (contato) campos[contato.id] = { value: l.name };
      if (email && l.email) campos[email.id] = { value: l.email };
      const op = l.source && canal?.options.find((o) => semAcento(o.name) === semAcento(l.source!));
      if (canal && op) campos[canal.id] = { optionId: op.id };
      if (cadastro) campos[cadastro.id] = { value: l.enteredAt.slice(0, 10) };
      const t = await apiPost<{ id: string }>('/trabalho/tarefas', { listId: crm.lista.id, title: l.name, campos }, token);
      carregar();
      abrirFicha(t.id);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setTrazendo(null);
    }
  };

  const itens = entradas?.items ?? [];
  const fora = itens.filter((l) => !noCrm(l.name)).length;

  return (
    <details className="rounded-md border border-border bg-surface px-5 py-3">
      <summary className="cursor-pointer text-sm text-muted">
        Entradas pelo site e formulários ({itens.length}){fora > 0 ? ` · ${fora} ainda fora do CRM` : ''}
      </summary>
      <p className="mt-2 text-sm text-muted">
        Contatos que chegaram sozinhos (página de vendas, formulário, Instagram). A negociação acontece no CRM: traga a
        entrada para lá.
      </p>
      {erro && <div className="mt-2 rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      {itens.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nenhuma entrada.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left">
                <th className="com-rotulo pb-2 font-normal">Nome</th>
                <th className="com-rotulo pb-2 font-normal">Situação</th>
                <th className="com-rotulo pb-2 font-normal">Origem</th>
                <th className="com-rotulo pb-2 font-normal">Entrada</th>
                <th className="com-rotulo pb-2 font-normal">CRM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {itens.map((l) => {
                const cartao = noCrm(l.name);
                return (
                  <tr key={l.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/leads/${l.id}`} className="font-medium hover:text-brand">{l.name}</Link>
                      <div className="text-xs text-muted">{l.email}</div>
                    </td>
                    <td className="py-2 pr-3"><StatusChip status={l.status} /></td>
                    <td className="py-2 pr-3 text-muted">{l.source ?? '—'}</td>
                    <td className="py-2 pr-3 text-muted">{new Date(l.enteredAt).toLocaleDateString('pt-BR')}</td>
                    <td className="py-2">
                      {cartao ? (
                        <button onClick={() => abrirFicha(cartao.id)} className="text-sm text-muted hover:text-brand">no CRM · ficha →</button>
                      ) : (
                        <button
                          onClick={() => void trazer(l)}
                          disabled={!!trazendo || !crm?.lista}
                          className="rounded-md border border-brand px-2.5 py-1 text-xs text-brand hover:bg-brand/10 disabled:opacity-40"
                        >
                          {trazendo === l.id ? 'trazendo…' : '+ trazer para o CRM'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4">
        <NovaOportunidadeExercicio />
      </div>
    </details>
  );
}
