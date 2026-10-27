'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { AuditList, AuditLogRow } from '@mktos/shared';
import { apiGet, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * O HISTÓRICO DE UMA ENTIDADE (leva 5, L2, 27/10/2026).
 *
 * "Item Histórico em todo menu, abrindo as entradas do AuditLog daquela entidade (quem,
 * quando, antes e depois)." Até aqui o histórico só aparecia no Registro de ações
 * (`/rastro`), que lista a empresa inteira. Este componente lê a MESMA rota
 * (`GET /audit?entidade=<id>&tipo=<entityType>&limit=100`, só leitura, RLS da empresa)
 * e mostra, do mais novo ao mais velho: quando, quem, a ação e o que mudou entre o
 * `before` e o `after` (chave a chave, antes → depois), com o JSON inteiro como
 * fallback quando o antes e o depois não têm chaves em comum para comparar.
 *
 * CONTRATO (o Comercial importa exatamente isto, no menu do lead e nas tarefas dele):
 *   HistoricoDaEntidade({ entityId, entityType?, titulo?, aberto, onFechar })
 * Sem a permissão `auditoria.ver` a janela diz "sem permissão para ver o histórico" em
 * vez de mostrar erro: a permissão é a da rota, e a razão de não ver tem de ser legível.
 * Quem aparece em "quem" é o `actorName` que a API já resolve (nome da conta; conta
 * apagada vira o id curto); o sistema e os agentes aparecem pelo tipo do ator.
 */

export interface HistoricoDaEntidadeProps {
  entityId: string;
  /** `work_task`, `lead`...: o `entityType` do AuditLog. Sem ele, todas as linhas do id. */
  entityType?: string;
  /** O título da janela (o nome da tarefa, do lead). */
  titulo?: string;
  aberto: boolean;
  onFechar: () => void;
}

export const SEM_PERMISSAO_PARA_O_HISTORICO = 'Você não tem permissão para ver o histórico (auditoria.ver).';
export const HISTORICO_VAZIO = 'Nenhuma ação registrada para este item.';
export const LIMITE_DO_HISTORICO = 100;

type Json = unknown;

function ehObjeto(v: Json): v is Record<string, Json> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Um valor curto para a tela: texto como está, número e booleano como texto, objeto e lista como JSON compacto. */
export function valorLegivel(v: Json): string {
  if (v === undefined) return '(vazio)';
  if (v === null) return '(nulo)';
  if (typeof v === 'string') return v === '' ? '(texto vazio)' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

export interface MudancaDeChave { chave: string; antes: Json; depois: Json }

/**
 * As chaves que mudaram entre o antes e o depois, na ordem em que aparecem (as do antes
 * primeiro, depois as que só existem no depois). Chave igual nos dois lados não entra.
 * Devolve `null` quando um dos lados não é objeto: aí a tela mostra o JSON inteiro.
 */
export function mudancasEntre(before: Json, after: Json): MudancaDeChave[] | null {
  if (!ehObjeto(before) || !ehObjeto(after)) return null;
  const chaves = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const iguais = (a: Json, b: Json) => {
    if (a === b) return true;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  };
  return chaves.filter((k) => !iguais(before[k], after[k])).map((k) => ({ chave: k, antes: before[k], depois: after[k] }));
}

/** dd/mm/aaaa hh:mm em São Paulo. */
export function quandoLegivel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Quem fez: o nome resolvido; sem nome, o id curto; sistema e agente pelo tipo. */
export function quemLegivel(r: Pick<AuditLogRow, 'actorType' | 'actorName'>): string {
  if (r.actorType === 'system') return 'sistema';
  if (r.actorType === 'ai') return r.actorName && r.actorName !== 'ai' ? `agente ${r.actorName}` : 'agente';
  if (!r.actorName) return 'alguém (sem registro)';
  // Id de conta no lugar do nome (conta apagada): só os 8 primeiros caracteres.
  return /^[0-9a-f-]{32,36}$/i.test(r.actorName) ? r.actorName.slice(0, 8) : r.actorName;
}

function Linha({ r }: { r: AuditLogRow }) {
  const mudancas = useMemo(() => mudancasEntre(r.before, r.after), [r.before, r.after]);
  const temCorpo = r.before !== undefined || r.after !== undefined;
  return (
    <li className="space-y-1 border-b border-border py-2 last:border-b-0" data-testid={`historico-linha-${r.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
        <span className="font-os-mono text-muted">{quandoLegivel(r.createdAt)}</span>
        <span className="text-text">{quemLegivel(r)}</span>
        <span className="font-medium text-brand">{r.action}</span>
      </div>
      {mudancas && mudancas.length > 0 && (
        <ul className="space-y-0.5 pl-2 text-[12px]">
          {mudancas.map((m) => (
            <li key={m.chave} className="break-words" data-testid={`historico-mudanca-${r.id}-${m.chave}`}>
              <span className="font-os-mono text-muted">{m.chave}</span>
              <span className="text-muted">: </span>
              <span className="text-muted line-through decoration-muted/60">{valorLegivel(m.antes)}</span>
              <span className="text-muted"> → </span>
              <span className="text-text">{valorLegivel(m.depois)}</span>
            </li>
          ))}
        </ul>
      )}
      {mudancas && mudancas.length === 0 && temCorpo && (
        <p className="pl-2 text-[11px] text-muted">Sem diferença entre o antes e o depois registrados.</p>
      )}
      {!mudancas && temCorpo && (
        <div className="grid gap-1 pl-2 text-[11px] sm:grid-cols-2">
          {r.before !== undefined && (
            <div>
              <p className="text-muted">antes</p>
              <pre className="whitespace-pre-wrap break-words rounded bg-surface-2 p-1.5 font-os-mono text-[11px] text-muted">{valorLegivel(r.before)}</pre>
            </div>
          )}
          {r.after !== undefined && (
            <div>
              <p className="text-muted">depois</p>
              <pre className="whitespace-pre-wrap break-words rounded bg-surface-2 p-1.5 font-os-mono text-[11px] text-text">{valorLegivel(r.after)}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function HistoricoDaEntidade({ entityId, entityType, titulo, aberto, onFechar }: HistoricoDaEntidadeProps) {
  const { token, can } = useAuth();
  const podeVer = can('auditoria.ver');
  const [dados, setDados] = useState<AuditList | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semPermissao, setSemPermissao] = useState(false);

  useEffect(() => {
    if (!aberto || !token) return;
    if (!podeVer) { setSemPermissao(true); return; }
    let vivo = true;
    setDados(null); setErro(null); setSemPermissao(false);
    const q = new URLSearchParams({ entidade: entityId, limit: String(LIMITE_DO_HISTORICO) });
    if (entityType) q.set('tipo', entityType);
    apiGet<AuditList | null>(`/audit?${q.toString()}`, token)
      .then((d) => { if (vivo) setDados(d && Array.isArray(d.items) ? d : { items: [], total: 0, source: { tool: 'banco-interno', generatedAt: '' } } as AuditList); })
      .catch((e: unknown) => {
        if (!vivo) return;
        // A API recusa com 403 quando o papel não tem `auditoria.ver`: a mesma frase, nunca caixa de erro.
        if (e instanceof ErroDaApi && e.status === 403) setSemPermissao(true);
        else setErro((e as Error).message || 'Não foi possível ler o histórico agora.');
      });
    return () => { vivo = false; };
  }, [aberto, token, podeVer, entityId, entityType]);

  // Esc fecha.
  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onFechar(); } };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [aberto, onFechar]);

  if (!aberto || typeof document === 'undefined') return null;

  // Do mais novo ao mais velho, como a API devolve; reordenado aqui para não depender da ordem do servidor.
  const linhas = [...(dados?.items ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const cortado = !!dados && dados.total > linhas.length;

  return createPortal(
    <div className="com-tema fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Histórico${titulo ? ` de ${titulo}` : ''}`}
        data-testid="historico-da-entidade"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-t-lg border border-border bg-surface text-text shadow-2xl sm:rounded-lg"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold">Histórico</h2>
            {titulo && <p className="truncate text-[12px] text-muted" title={titulo}>{titulo}</p>}
            <p className="font-os-mono text-[10px] text-muted">{entityType ? `${entityType} · ` : ''}{entityId.slice(0, 8)}</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar o histórico" className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:bg-surface-2 hover:text-text">
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {semPermissao && <p role="status" data-testid="historico-sem-permissao" className="py-4 text-[13px] text-muted">{SEM_PERMISSAO_PARA_O_HISTORICO}</p>}
          {!semPermissao && erro && <p role="alert" className="py-4 text-[13px] text-bad">{erro}</p>}
          {!semPermissao && !erro && !dados && <p className="py-4 text-[13px] text-muted">Lendo o histórico…</p>}
          {!semPermissao && !erro && dados && linhas.length === 0 && <p data-testid="historico-vazio" className="py-4 text-[13px] text-muted">{HISTORICO_VAZIO}</p>}
          {!semPermissao && !erro && linhas.length > 0 && (
            <ul data-testid="historico-linhas">
              {linhas.map((r) => <Linha key={r.id} r={r} />)}
            </ul>
          )}
          {cortado && <p className="py-2 text-[11px] text-muted">Mostrando as {linhas.length} ações mais recentes de {dados!.total}. O Registro de ações tem o resto.</p>}
        </div>
        <footer className="border-t border-border px-4 py-2 text-[11px] text-muted">
          Só leitura. Toda ação do OS sobre este item fica aqui: quem, quando, antes e depois.
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export default HistoricoDaEntidade;
