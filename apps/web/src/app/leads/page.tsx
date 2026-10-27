'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ListaDeLeads, LinhaDaListaDeLeads, QuadroDaLista, ReuniaoSemCliente } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { partesDoLead } from '@/lib/nome-do-lead';
import { abrirFicha } from '@/lib/ficha';
import { NovaOportunidadeExercicio } from './NovaOportunidadeExercicio';
import { NovoLead } from '@/app/comercial/_funil/NovoLead';
import { BotaoDoMenuDoLead, alvoDoMenuDoLead, useMenuDoLeadProprio } from '@/app/comercial/_funil/MenuDoLead';

/*
 * LISTA DE LEADS (versão final, decisão 2 do Rodrigo, 19/10/2026): a tabela
 * `Lead` do cockpit, com a etapa, o canal e o dono da ficha
 * (`GET /comercial/lista-de-leads`). Busca, filtros por etapa, canal e dono, e o
 * recorte copiado ou exportado em CSV: é a base para a lista de transmissão e
 * de e-mail. Daqui NADA é enviado; o envio continua pelos caminhos que passam
 * pela porta. Cada linha abre o painel do lead (`/comercial/lead/<id>`).
 *
 * Leva 5 (L2, 27/10/2026): botão direito na linha e o "⋯" ao lado do contato
 * abrem o menu do lead (abrir, mover de etapa, copiar link da sala, vincular
 * WhatsApp, editar valor negociado, histórico). Mover relê a lista.
 */

const TODOS = '';
const SEM = '__sem';
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

interface Filtro { q: string; etapa: string; canal: string; dono: string }

function passa(l: LinhaDaListaDeLeads, f: Filtro) {
  if (f.etapa && l.etapaChave !== f.etapa) return false;
  if (f.canal && (f.canal === SEM ? l.canal !== null : l.canal !== f.canal)) return false;
  if (f.dono && (f.dono === SEM ? l.dono !== null : l.dono !== f.dono)) return false;
  if (f.q) {
    const q = semAcento(f.q.trim());
    const onde = [l.contato, l.empresa, l.telefone, l.email].filter(Boolean).map((x) => semAcento(x!));
    if (!onde.some((x) => x.includes(q))) return false;
  }
  return true;
}

/** Uma célula de CSV: aspas quando precisa, e nunca uma fórmula de planilha. */
function celula(v: string | null): string {
  let s = v ?? '';
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const CABECALHO = ['Contato', 'Empresa', 'Telefone', 'E-mail', 'Etapa', 'Canal', 'Dono', 'Última atividade'];
// Layout 26/10 (P-33): na tela entra o Valor da ficha (o mesmo do Painel); o copiar e o CSV ficam como eram.
const CABECALHO_DA_TELA = ['Contato', 'Empresa', 'Telefone', 'E-mail', 'Etapa', 'Valor', 'Canal', 'Dono', 'Última atividade'];
const reais = (v: number | null | undefined) => (v == null ? null : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const linhaDoRecorte = (l: LinhaDaListaDeLeads) => [l.contato, l.empresa, l.telefone, l.email, l.etapa, l.canal, l.dono, dia(l.ultimaAtividade)];

export default function ListaDeLeadsPage() {
  const { token, ready } = useAuth();
  const [dados, setDados] = useState<ListaDeLeads | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>({ q: '', etapa: TODOS, canal: TODOS, dono: TODOS });
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!ready || !token) return;
    apiGet<ListaDeLeads>('/comercial/lista-de-leads', token).then(setDados).catch((e) => setErro(e.message));
  }, [ready, token]);
  useEffect(() => carregar(), [carregar]);
  // L2: o menu do lead na linha; mover pelo menu relê a lista.
  const { menu, elemento: menuDoLead } = useMenuDoLeadProprio({ onMudou: carregar });

  const leads = useMemo(() => dados?.leads ?? [], [dados]);
  const recorte = useMemo(() => leads.filter((l) => passa(l, filtro)), [leads, filtro]);
  const etapas = useMemo(() => [...new Map(leads.map((l) => [l.etapaChave, l.etapa])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt')), [leads]);
  const canais = useMemo(() => [...new Set(leads.map((l) => l.canal).filter((x): x is string => !!x))].sort(), [leads]);
  const donos = useMemo(() => [...new Set(leads.map((l) => l.dono).filter((x): x is string => !!x))].sort(), [leads]);
  const set = (k: keyof Filtro, v: string) => setFiltro((f) => ({ ...f, [k]: v }));
  const avisar = (t: string) => {
    setAviso(t);
    setTimeout(() => setAviso(null), 2400);
  };

  const comTelefone = recorte.filter((l) => l.telefone).length;
  const comEmail = recorte.filter((l) => l.email).length;

  /** Copia o recorte separado por tabulação: cola direto numa planilha. */
  const copiar = () => {
    const texto = [CABECALHO, ...recorte.map(linhaDoRecorte)].map((r) => r.map((x) => (x ?? '').replace(/\t|\n/g, ' ')).join('\t')).join('\n');
    void navigator.clipboard.writeText(texto).then(() => avisar(`${recorte.length} contato(s) copiado(s).`)).catch(() => avisar('Não foi possível copiar.'));
  };
  /** Baixa o recorte em CSV com ponto e vírgula (o Excel em português abre direto). */
  const exportar = () => {
    const csv = '﻿' + [CABECALHO, ...recorte.map(linhaDoRecorte)].map((r) => r.map(celula).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `lista-de-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sel = 'rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand';
  const botao = 'rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:border-brand hover:text-text disabled:opacity-40';

  return (
    <div className="com-tema mx-auto max-w-[1240px] space-y-5 text-text">
      <div className="flex justify-end"><NovoLead origem="lista-de-leads" /></div>
      <ReunioesSemCliente />

      <section className="rounded-md border border-border bg-surface px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filtro.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder="Buscar por nome, empresa, telefone ou e-mail"
            aria-label="Buscar"
            className={`${sel} min-w-[16rem] flex-1`}
          />
          <select value={filtro.etapa} onChange={(e) => set('etapa', e.target.value)} className={sel} aria-label="Etapa">
            <option value={TODOS}>Todas as etapas</option>
            {etapas.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
          </select>
          <select value={filtro.canal} onChange={(e) => set('canal', e.target.value)} className={sel} aria-label="Canal">
            <option value={TODOS}>Todos os canais</option>
            {canais.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={SEM}>Sem canal</option>
          </select>
          <select value={filtro.dono} onChange={(e) => set('dono', e.target.value)} className={sel} aria-label="Dono">
            <option value={TODOS}>Todos os donos</option>
            {donos.map((d) => <option key={d} value={d}>{d}</option>)}
            <option value={SEM}>Sem dono</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">
            {recorte.length} de {leads.length} · {comTelefone} com telefone · {comEmail} com e-mail
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {aviso && <span className="text-sm text-muted" role="status">{aviso}</span>}
            <button onClick={copiar} disabled={!recorte.length} className={botao}>Copiar contatos</button>
            <button onClick={exportar} disabled={!recorte.length} className={botao}>Exportar CSV</button>
          </span>
        </div>
        <p className="mt-2 text-xs text-muted">O recorte serve de base para a lista de transmissão e de e-mail. Nada é enviado daqui.</p>
      </section>

      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      {!dados && !erro && <p className="text-muted">Carregando…</p>}
      {dados && dados.foraDoTeto > 0 && <p className="text-sm text-muted">{dados.foraDoTeto} leads sem atividade recente ficaram fora da lista.</p>}

      {dados && (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="text-left">
                {CABECALHO_DA_TELA.map((h) => (
                  <th key={h} className="com-rotulo px-3 pb-2 pt-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recorte.length === 0 && (
                <tr><td colSpan={CABECALHO_DA_TELA.length} className="px-3 py-4 text-muted">{leads.length ? 'Nenhum lead com esse filtro.' : 'Ainda não há leads.'}</td></tr>
              )}
              {recorte.map((l) => (
                <tr key={l.id} data-testid={`lista-de-leads-linha-${l.id}`} className="hover:bg-surface-2" {...alvoDoMenuDoLead(menu, { id: l.id, nome: l.contato, empresa: l.empresa, etapa: l.etapaChave })}>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1">
                      <Link href={`/comercial/lead/${l.id}`} className="font-medium hover:text-brand">{partesDoLead(l.contato, l.empresa).pessoa ?? l.contato}</Link>
                      <BotaoDoMenuDoLead lead={{ id: l.id, nome: l.contato, empresa: l.empresa, etapa: l.etapaChave }} menu={menu} />
                    </span>
                  </td>
                  <td className="px-3 py-2">{partesDoLead(l.contato, l.empresa).pessoa ? partesDoLead(l.contato, l.empresa).titulo : l.empresa ?? <span className="text-muted">—</span>}</td>
                  <td className="com-num whitespace-nowrap px-3 py-2">{l.telefone ?? <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2">{l.email ?? <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{l.etapa}</td>
                  <td className="com-num whitespace-nowrap px-3 py-2 text-right">{reais(l.valor) ?? <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2 text-muted">{l.canal ?? '—'}</td>
                  <td className="px-3 py-2 text-muted">{l.dono ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{dia(l.ultimaAtividade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {menuDoLead}

      <details className="rounded-md border border-border bg-surface px-5 py-3">
        <summary className="cursor-pointer text-sm text-muted">Exercício de QA</summary>
        <div className="mt-3">
          <NovaOportunidadeExercicio />
        </div>
      </details>
    </div>
  );
}

/**
 * As reuniões que o Granola mandou e o OS não reconheceu o cliente (nem por
 * e-mail, nem por domínio, nem por nome). Aparece só quando há alguma: escolher
 * o card e vincular leva a reunião para a ficha dele. Sem mudança (Granola).
 */
const CRM = 'crm-root-lista';
function ReunioesSemCliente() {
  const { token, ready, can } = useAuth();
  const [rs, setRs] = useState<ReuniaoSemCliente[]>([]);
  const [crm, setCrm] = useState<QuadroDaLista | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<ReuniaoSemCliente[]>('/trabalho/fichas/granola/sem-cliente', token).then(setRs).catch(() => setRs([]));
    apiGet<QuadroDaLista>(`/trabalho/fichas/quadro?lista=${CRM}`, token).then(setCrm).catch(() => setCrm(null));
  }, [token]);

  useEffect(() => {
    if (ready && token) carregar();
  }, [ready, token, carregar]);

  if (!rs.length) return null;
  const cards = [...(crm?.cartoes ?? [])].sort((a, b) => a.titulo.localeCompare(b.titulo));

  const vincular = async (r: ReuniaoSemCliente) => {
    const taskId = escolha[r.id];
    if (!token || !taskId) return;
    try {
      await apiPost(`/trabalho/fichas/reunioes/${r.id}/vincular`, { taskId }, token);
      carregar();
      abrirFicha(taskId);
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <section className="rounded-md border border-brand/50 bg-surface px-5 py-4">
      <h2 className="text-[1.05rem] font-semibold">Reuniões do Granola sem cliente ({rs.length})</h2>
      <p className="text-sm text-muted">O OS não reconheceu o cliente pelo e-mail nem pelo nome. Escolha o card e vincule.</p>
      {erro && <div className="mt-2 rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      <ul className="mt-3 divide-y divide-border">
        {rs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{r.titulo}</div>
              <div className="text-xs text-muted">
                {new Date(r.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                {r.participantes && ` · ${r.participantes}`}
              </div>
            </div>
            {can('tarefas.editar') && (
              <>
                <select
                  value={escolha[r.id] ?? ''}
                  onChange={(e) => setEscolha({ ...escolha, [r.id]: e.target.value })}
                  className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand"
                  aria-label="Card do cliente"
                >
                  <option value="">escolha o cliente…</option>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
                </select>
                <button
                  onClick={() => void vincular(r)}
                  disabled={!escolha[r.id]}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-40"
                >
                  vincular
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
