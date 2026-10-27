'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { TrabAtaCandidato } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Layout 26/10 (decisão do Lucas): O SELETOR DE LEAD da lista "Tarefas do comercial".
 *
 * A tarefa nova nessa lista pede o LEAD (opcional, mas sugerido) em vez do cliente; o
 * pop-up da tarefa usa o mesmo seletor para trocar ou tirar o lead. A busca é a das atas
 * (`GET /trabalho/atas/alvos?tipo=lead&q=`, nome ou empresa, pede `leads.ver`). Quem pode
 * editar leads vê também "+ criar lead “texto”", que cria pelo mesmo caminho do botão
 * "+ lead" do Comercial (`POST /leads/entrada`, origem manual) e já escolhe o lead criado.
 *
 * Layout 27/10 (Lucas: "Lucas Rezende" não aparecia): com `comClientes`, a busca traz também
 * quem JÁ É CLIENTE (`tipo=cliente` da mesma busca das atas), marcado "cliente". Escolher um
 * cliente devolve `tipo: "cliente"`: a tarefa nasce com esse cliente, sem lead.
 *
 * Combobox do teclado, como o seletor de cliente: setas andam, Enter escolhe, Esc fecha.
 */

export interface LeadEscolhido { id: string; nome: string; /** Ausente = lead. */ tipo?: "lead" | "cliente" }

type Opcao = { tipo: 'lead'; lead: TrabAtaCandidato } | { tipo: 'criar'; nome: string } | { tipo: 'tirar' };

export function SeletorDeLead({ valor, onEscolher, token, rotulo = 'Lead', permiteTirar = false, desabilitado = false, comClientes = false, testid = 'seletor-de-lead' }: {
  valor: LeadEscolhido | null;
  /** `null` = tirar o lead (só com `permiteTirar`, que quem chama liga quando há lead para tirar). */
  onEscolher: (l: LeadEscolhido | null) => void;
  token: string | null;
  rotulo?: string;
  permiteTirar?: boolean;
  desabilitado?: boolean;
  /** Também os clientes (a tarefa nova do comercial pode ser de quem já é cliente). */
  comClientes?: boolean;
  testid?: string;
}) {
  const { can } = useAuth();
  const podeCriar = can('leads.editar');
  const podeVer = can('leads.ver');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const [leads, setLeads] = useState<TrabAtaCandidato[]>([]);
  const [ativo, setAtivo] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const idLista = useId();
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto || !token || !podeVer) return;
    let vivo = true;
    const t = setTimeout(() => {
      const q = busca.trim() ? `&q=${encodeURIComponent(busca.trim())}` : '';
      const buscar = (tipo: 'lead' | 'cliente') => apiGet<TrabAtaCandidato[]>(`/trabalho/atas/alvos?tipo=${tipo}${q}`, token).then((r) => (Array.isArray(r) ? r : []));
      Promise.all([buscar('lead'), comClientes ? buscar('cliente').catch(() => []) : Promise.resolve([])])
        .then(([l, c]) => { if (vivo) { setLeads([...l, ...c.map((x) => ({ ...x, tipo: 'cliente' as const }))]); setAtivo(0); setErro(null); } })
        .catch((e: Error) => { if (vivo) setErro(e.message); });
    }, 150);
    return () => { vivo = false; clearTimeout(t); };
  }, [aberto, busca, token, podeVer, comClientes]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const texto = busca.trim();
  const opcoes: Opcao[] = [
    ...leads.map((lead) => ({ tipo: 'lead' as const, lead })),
    ...(podeCriar && texto ? [{ tipo: 'criar' as const, nome: texto }] : []),
    ...(permiteTirar ? [{ tipo: 'tirar' as const }] : []),
  ];

  const fechar = () => { setAberto(false); setBusca(''); };
  const criar = async (nome: string) => {
    setCriando(true); setErro(null);
    try {
      const ref = `trabalho:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
      const l = await apiPost<{ id: string }>('/leads/entrada', { origem: { tipo: 'manual', ref }, nome }, token);
      onEscolher({ id: l.id, nome });
      fechar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCriando(false);
    }
  };
  const escolher = (o: Opcao) => {
    if (o.tipo === 'lead' && o.lead.tipo === 'cliente') { onEscolher({ id: o.lead.id, nome: o.lead.nome, tipo: 'cliente' }); fechar(); return; }
    if (o.tipo === 'lead') { onEscolher({ id: o.lead.id, nome: o.lead.detalhe ? `${o.lead.detalhe} · ${o.lead.nome}` : o.lead.nome }); fechar(); return; }
    if (o.tipo === 'tirar') { onEscolher(null); fechar(); return; }
    void criar(o.nome);
  };

  if (!podeVer) return <p className="text-[11px] text-muted" data-testid={testid}>Sem a permissão de ver leads: a tarefa fica sem lead.</p>;
  return (
    <div ref={caixa} className="relative" data-testid={testid}>
      <input
        role="combobox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-label={rotulo}
        disabled={desabilitado || criando}
        value={aberto ? busca : valor?.nome ?? ''}
        placeholder={comClientes ? "Lead ou cliente, opcional" : "Lead (nome ou empresa), opcional"}
        onFocus={() => setAberto(true)}
        onClick={() => setAberto(true)}
        onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { if (aberto) { e.stopPropagation(); setAberto(false); } return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo((i) => Math.min(i + 1, Math.max(opcoes.length - 1, 0))); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
          if (e.key === 'Enter' && aberto && opcoes[ativo]) { e.preventDefault(); e.stopPropagation(); escolher(opcoes[ativo]); }
        }}
        className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-[13px] outline-none focus:border-brand-dim disabled:opacity-60"
      />
      {aberto && (
        <ul id={idLista} role="listbox" aria-label={`${rotulo}: opções`} className="absolute left-0 right-0 z-[60] mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {erro && <li className="px-2 py-1.5 text-[12px] text-bad">{erro}</li>}
          {!erro && opcoes.length === 0 && <li className="px-2 py-1.5 text-[12px] text-muted">{texto ? comClientes ? 'Nenhum lead nem cliente com esse nome.' : 'Nenhum lead com esse nome.' : 'Escreva o nome ou a empresa do lead.'}</li>}
          {opcoes.map((o, i) => (
            <li
              key={o.tipo === 'lead' ? `${o.lead.tipo}:${o.lead.id}` : o.tipo}
              role="option"
              aria-selected={i === ativo}
              data-testid={o.tipo === 'lead' ? `opcao-${o.lead.tipo === 'cliente' ? 'cliente' : 'lead'}-${o.lead.id}` : `opcao-lead-${o.tipo}`}
              onMouseDown={(e) => { e.preventDefault(); escolher(o); }}
              onMouseEnter={() => setAtivo(i)}
              className={`cursor-pointer px-2 py-1.5 text-[13px] ${i === ativo ? 'bg-brand/15 text-text' : 'text-text'}`}
            >
              {o.tipo === 'lead' && o.lead.tipo === 'cliente' && <>{o.lead.nome}<span className="ml-1 rounded bg-brand/15 px-1 text-[10.5px] text-brand">cliente</span></>}
              {o.tipo === 'lead' && o.lead.tipo !== 'cliente' && <>{o.lead.detalhe ?? o.lead.nome}{o.lead.detalhe && <span className="ml-1 text-[11px] text-muted">· {o.lead.nome}</span>}</>}
              {o.tipo === 'criar' && <span className="text-brand">+ criar lead “{o.nome}”</span>}
              {o.tipo === 'tirar' && <span className="text-muted">Sem lead (tirar o lead da tarefa)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
