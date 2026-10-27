'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  FALTA_DA_PARTE_DO_CLIENTE, PARTES_DO_CLIENTE, ROTULO_DA_PARTE_DO_CLIENTE, ROTULO_DA_SITUACAO_DO_CONTRATO, ROTULO_DO_TIPO_DE_NEGOCIO,
  type ClienteAtivo, type ComercialTipoDeNegocio, type ListaDeClientesAtivos, type ParteDoCliente,
} from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import { Aviso, BOTAO, CARTAO, Carregando, Erro, FOCO, INPUT, ROTULO, useCarregar } from '../_ui';
import { LinkDoLead, useMudouNoPainel } from '../_painel/provedor';

/*
 * CLIENTES ATIVOS NUMA LISTA SÓ (P-84, 27/10/2026). "Clientes ativos em comercial, clientes
 * ativos em wpp... tá tudo desconectado" (Lucas). Cada linha é um cliente com as seis partes
 * (funil, cadastro, acordo, contrato, WhatsApp, implantação); a que falta aparece como
 * "falta", com a frase do que é e, quando dá, o atalho que resolve. A lista só lê; a única
 * escrita é "Criar cadastro" do lead fechado sem cadastro (a régua do "Iniciar onboarding").
 */

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const FALTA = 'inline-flex items-center rounded border border-warn/50 px-1.5 py-0.5 text-[11px] text-warn';
const LINK = `text-[12.5px] text-text underline-offset-2 hover:text-brand hover:underline ${FOCO}`;

export default function ClientesAtivosPage() {
  const { dados, erro, carregando, recarregar } = useCarregar<ListaDeClientesAtivos>('/comercial/clientes-ativos', 60_000);
  useMudouNoPainel(recarregar);
  const { token, can } = useAuth();
  const podeCriar = can('leads.editar');
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState<'' | ComercialTipoDeNegocio>('');
  const [soLacuna, setSoLacuna] = useState(false);
  const [falta, setFalta] = useState<'' | ParteDoCliente>('');
  const [criando, setCriando] = useState<string | null>(null);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);
  const [lista, setLista] = useState<ListaDeClientesAtivos | null>(null);
  const atual = lista ?? dados;

  const todos = atual?.clientes ?? [];
  const faltaPorParte = useMemo(
    () => Object.fromEntries(PARTES_DO_CLIENTE.map((p) => [p, todos.filter((c) => c.faltam.includes(p)).length])) as Record<ParteDoCliente, number>,
    [todos],
  );
  const visiveis = todos.filter((c) => {
    if (busca.trim() && !semAcento(c.nome).includes(semAcento(busca.trim()))) return false;
    if (tipo && c.tipo !== tipo) return false;
    if (soLacuna && c.faltam.length === 0) return false;
    if (falta && !c.faltam.includes(falta)) return false;
    return true;
  });

  const criarCadastro = async (c: ClienteAtivo) => {
    if (!c.funil) return;
    setCriando(c.chave);
    setErroDaAcao(null);
    try {
      setLista(await apiPost<ListaDeClientesAtivos>(`/comercial/clientes-ativos/${encodeURIComponent(c.funil.leadId)}/cadastro`, {}, token));
    } catch (e) {
      setErroDaAcao((e as Error).message);
    } finally {
      setCriando(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <p className="text-[13.5px] text-muted">
        Cada cliente numa linha, com o que ele tem no funil, no cadastro, no acordo do Financeiro, no contrato, no WhatsApp e na implantação. O que falta aparece marcado.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="clientes-ativos-painel">
        <button type="button" onClick={() => { setTipo(''); setSoLacuna(false); setFalta(''); }} className={`${CARTAO} text-left transition hover:border-brand ${FOCO}`}>
          <span className="block font-os-mono text-[22px] tabular-nums" data-testid="clientes-ativos-total">{todos.length}</span>
          <span className={ROTULO}>Clientes ativos</span>
          <span className="mt-0.5 block text-[11px] text-dim">
            {(atual?.porTipo ?? []).map((t) => `${t.total} ${ROTULO_DO_TIPO_DE_NEGOCIO[t.tipo].toLowerCase()}`).join(' · ') || '—'}
          </span>
        </button>
        <button
          type="button" aria-pressed={soLacuna} onClick={() => setSoLacuna((s) => !s)} data-testid="clientes-ativos-com-lacuna"
          className={`${CARTAO} text-left transition hover:border-brand ${FOCO} ${soLacuna ? 'border-brand' : ''}`}
        >
          <span className="block font-os-mono text-[22px] tabular-nums">{atual?.comLacuna ?? 0}</span>
          <span className={ROTULO}>Com algo faltando</span>
          <span className="mt-0.5 block text-[11px] text-dim">clique para ver só eles</span>
        </button>
        <div className={`${CARTAO} col-span-2 flex flex-wrap content-start gap-1.5`}>
          <span className={`${ROTULO} w-full`}>Falta, por parte</span>
          {PARTES_DO_CLIENTE.map((p) => (
            <button
              key={p} type="button" aria-pressed={falta === p} title={FALTA_DA_PARTE_DO_CLIENTE[p]}
              onClick={() => setFalta((f) => (f === p ? '' : p))}
              className={`rounded border px-2 py-0.5 text-[12px] transition ${FOCO} ${falta === p ? 'border-brand text-text' : 'border-border text-muted hover:border-brand'}`}
            >
              {ROTULO_DA_PARTE_DO_CLIENTE[p]} <b className="font-os-mono tabular-nums text-text">{faltaPorParte[p] ?? 0}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className={ROTULO}>Buscar</span>
          <input className={INPUT} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do cliente" data-testid="clientes-ativos-busca" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Tipo</span>
          <select className={INPUT} value={tipo} onChange={(e) => setTipo(e.target.value as '' | ComercialTipoDeNegocio)}>
            <option value="">Todos</option>
            {(atual?.porTipo ?? []).map((t) => <option key={t.tipo} value={t.tipo}>{ROTULO_DO_TIPO_DE_NEGOCIO[t.tipo]}</option>)}
          </select>
        </label>
      </div>

      <Erro erro={erro} aoTentar={() => void recarregar()} />
      {erroDaAcao && <p role="alert" className="text-[12.5px] text-bad">{erroDaAcao}</p>}
      {carregando && !atual && !erro && <Carregando linhas={3} altura="h-12" />}
      {atual && todos.length === 0 && <Aviso>Nenhum cliente ativo ainda: ninguém com acordo, negócio fechado, contrato vivo ou grupo do WhatsApp ligado.</Aviso>}
      {atual && todos.length > 0 && visiveis.length === 0 && <Aviso>Nenhum cliente com esta busca e estes filtros.</Aviso>}

      {visiveis.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[960px] text-sm" data-testid="clientes-ativos-lista">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Cliente</th>
                {PARTES_DO_CLIENTE.map((p) => <th key={p} className="px-3 py-2">{ROTULO_DA_PARTE_DO_CLIENTE[p]}</th>)}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => (
                <tr key={c.chave} className="border-b border-border align-top last:border-b-0" data-testid={`cliente-ativo-${c.chave}`}>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-text">{c.nome}</div>
                    <div className="text-[11.5px] text-muted">
                      {ROTULO_DO_TIPO_DE_NEGOCIO[c.tipo]}{c.valor != null ? ` · ${brl(c.valor)}` : ''}
                    </div>
                  </td>
                  {PARTES_DO_CLIENTE.map((p) => (
                    <td key={p} className="px-3 py-2.5">
                      <Parte cliente={c} parte={p} podeCriar={podeCriar} criando={criando === c.chave} aoCriar={() => void criarCadastro(c)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Falta({ parte, children }: { parte: ParteDoCliente; children?: React.ReactNode }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className={FALTA} title={FALTA_DA_PARTE_DO_CLIENTE[parte]}>falta</span>
      {children}
    </span>
  );
}

function Parte({ cliente: c, parte, podeCriar, criando, aoCriar }: { cliente: ClienteAtivo; parte: ParteDoCliente; podeCriar: boolean; criando: boolean; aoCriar: () => void }) {
  const falta = c.faltam.includes(parte);
  switch (parte) {
    case 'funil':
      if (!c.funil) return <Falta parte={parte}><Link href="/comercial/funil" className={`${LINK} text-[11.5px] text-muted`}>abrir o Funil</Link></Falta>;
      return (
        <span className="flex flex-col items-start gap-1">
          {falta && <span className={FALTA} title={FALTA_DA_PARTE_DO_CLIENTE.funil}>não fechou</span>}
          <LinkDoLead leadId={c.funil.leadId} className={LINK}>{c.funil.rotulo}</LinkDoLead>
        </span>
      );
    case 'cadastro':
      if (c.cadastro) return <span className="text-[12.5px] text-text" title={c.cadastro.duplicados ? `${c.cadastro.duplicados} cadastro(s) duplicado(s) apontam para este` : undefined}>✓{c.cadastro.duplicados ? <span className="ml-1 text-[11px] text-muted">+{c.cadastro.duplicados} duplicado</span> : null}</span>;
      return (
        <Falta parte={parte}>
          {c.podeCriarCadastro && podeCriar && (
            <button type="button" className={`${BOTAO} px-2 py-0.5 text-[11.5px]`} disabled={criando} onClick={aoCriar} data-testid={`criar-cadastro-${c.chave}`}>
              {criando ? 'criando…' : 'Criar cadastro'}
            </button>
          )}
        </Falta>
      );
    case 'acordo':
      if (!c.acordos.length) return <Falta parte={parte}><span className="text-[11px] text-muted">Financeiro › Análise</span></Falta>;
      return <span className="text-[12.5px] text-text">{c.acordos.map((a) => a.produto).join(', ')}</span>;
    case 'contrato':
      if (!c.contrato) return <Falta parte={parte} />;
      return <LinkDoLead leadId={c.contrato.leadId} aba="dinheiro" className={LINK}>{ROTULO_DA_SITUACAO_DO_CONTRATO[c.contrato.situacao]}</LinkDoLead>;
    case 'whatsapp':
      if (!c.whatsapp.length) return <Falta parte={parte}><Link href="/whatsapp" className={`${LINK} text-[11.5px] text-muted`}>vincular</Link></Falta>;
      return (
        <span className="flex flex-col items-start gap-0.5">
          {c.whatsapp.map((w) => <Link key={w.conversaId} href={`/whatsapp?conversa=${encodeURIComponent(w.conversaId)}`} className={LINK}>{w.nome}</Link>)}
        </span>
      );
    case 'implantacao':
      if (!c.implantacao) return <Falta parte={parte} />;
      return <Link href="/trabalho/implantacao" className={LINK}>{c.implantacao.etapa}</Link>;
  }
}
