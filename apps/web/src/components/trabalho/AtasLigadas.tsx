'use client';

import { useEffect, useId, useState } from 'react';
import { hrefDaAta, type TrabAtaCandidato, type TrabAtaLigacao, type TrabAtaLigadaItem, type TrabAtaResumo } from '@mktos/shared';
import { apiGet, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Layout 26/10: A ATA LIGADA A UM LEAD OU A UM CLIENTE.
 *
 * Na tela Atas, a ata aberta diz a que está ligada ("Ligada a: lead X ·
 * cliente Y" ou "Sem ligação") e se liga ou desliga à mão: "Ligar a lead"
 * (busca pelo nome ou pela empresa) e "Ligar a cliente" (os cadastros de
 * cliente, o principal). É só a ligação: não sobe a ata para o comercial nem
 * roda leitura, diagnóstico ou etapa.
 *
 * O painel do lead e a ficha do cliente leem as atas ligadas daqui
 * (`useAtasLigadas`) e cada uma abre na tela Atas.
 */

const ALVO = 'max-md:min-h-[44px]';
const BTN = `rounded-lg border border-border bg-surface px-2.5 py-1 text-[12px] hover:border-brand-dim disabled:opacity-50 ${ALVO}`;
const INP = `w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim ${ALVO}`;

/** O painel do lead na aba Fio. */
export const hrefDoLead = (id: string) => `/comercial/funil?lead=${encodeURIComponent(id)}&aba=fio`;
/** A ficha do cliente (a página acha o cartão do cliente). */
export const hrefDoCliente = (id: string) => `/comercial/ficha/cliente/${encodeURIComponent(id)}`;

const dataBR = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : null);

/** A frase curta da lista: "ligada a Fulano · Cliente X". `null` sem ligação. */
export function resumoDaLigacao(l: TrabAtaLigacao | null | undefined): string | null {
  if (!l) return null;
  const partes = [l.lead ? `lead ${l.lead.nome}` : null, l.cliente ? `cliente ${l.cliente.nome}` : null].filter(Boolean);
  return partes.length ? `ligada a ${partes.join(' · ')}` : null;
}

/** "Ligada a" da ata aberta, com ligar e desligar. */
export function LigacaoDaAta({ ata, podeEditar, onMudou }: {
  ata: TrabAtaResumo;
  podeEditar: boolean;
  onMudou: (l: TrabAtaLigacao | null) => void;
}) {
  const { token, can } = useAuth();
  const podeLead = can('leads.ver');
  const [modo, setModo] = useState<'lead' | 'cliente' | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const l = ata.ligadaA ?? null;

  // Trocou de ata: a busca aberta da anterior fecha.
  useEffect(() => { setModo(null); setErro(null); }, [ata.id]);

  const salvar = (mudanca: { leadId?: string | null; clienteId?: string | null }) => {
    if (!token) return;
    setSalvando(true);
    setErro(null);
    apiPut<TrabAtaLigacao | null>(
      `/trabalho/atas/${encodeURIComponent(ata.id)}/ligacao`,
      { ...mudanca, titulo: ata.titulo, data: ata.data },
      token,
    )
      .then((r) => { setModo(null); onMudou(r ?? null); })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setSalvando(false));
  };

  return (
    <div data-testid="ata-ligacao" className="space-y-1.5 text-[12px]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 break-words">
        <span className="text-muted">Ligada a:</span>
        {!l && <span data-testid="ata-sem-ligacao" className="text-muted">sem ligação</span>}
        {l?.lead && (
          <span className="inline-flex flex-wrap items-center gap-1">
            <a data-testid="ata-ligada-lead" href={hrefDoLead(l.lead.id)} className="text-brand underline underline-offset-2">lead {l.lead.nome}</a>
            {podeEditar && podeLead && (
              <button type="button" data-testid="ata-desligar-lead" className="text-muted underline underline-offset-2 hover:text-text disabled:opacity-50" disabled={salvando} onClick={() => salvar({ leadId: null })}>desligar</button>
            )}
          </span>
        )}
        {l?.cliente && (
          <span className="inline-flex flex-wrap items-center gap-1">
            <a data-testid="ata-ligada-cliente" href={hrefDoCliente(l.cliente.id)} className="text-brand underline underline-offset-2">cliente {l.cliente.nome}</a>
            {podeEditar && (
              <button type="button" data-testid="ata-desligar-cliente" className="text-muted underline underline-offset-2 hover:text-text disabled:opacity-50" disabled={salvando} onClick={() => salvar({ clienteId: null })}>desligar</button>
            )}
          </span>
        )}
      </p>
      {podeEditar && (
        <div className="flex flex-wrap gap-2">
          {podeLead && (
            <button type="button" data-testid="ata-ligar-lead" className={BTN} aria-expanded={modo === 'lead'} disabled={salvando} onClick={() => setModo((m) => (m === 'lead' ? null : 'lead'))}>
              {l?.lead ? 'Trocar o lead' : 'Ligar a lead'}
            </button>
          )}
          <button type="button" data-testid="ata-ligar-cliente" className={BTN} aria-expanded={modo === 'cliente'} disabled={salvando} onClick={() => setModo((m) => (m === 'cliente' ? null : 'cliente'))}>
            {l?.cliente ? 'Trocar o cliente' : 'Ligar a cliente'}
          </button>
        </div>
      )}
      {modo && token && (
        <BuscaDoAlvo
          tipo={modo}
          token={token}
          ocupado={salvando}
          onEscolher={(c) => salvar(c.tipo === 'lead' ? { leadId: c.id } : { clienteId: c.id })}
          onFechar={() => setModo(null)}
        />
      )}
      {erro && <p role="alert" className="text-bad break-words">{erro}</p>}
    </div>
  );
}

function BuscaDoAlvo({ tipo, token, ocupado, onEscolher, onFechar }: {
  tipo: 'lead' | 'cliente';
  token: string;
  ocupado: boolean;
  onEscolher: (c: TrabAtaCandidato) => void;
  onFechar: () => void;
}) {
  const [q, setQ] = useState('');
  const [opcoes, setOpcoes] = useState<TrabAtaCandidato[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const idLista = useId();

  useEffect(() => {
    let vivo = true;
    const t = window.setTimeout(() => {
      apiGet<TrabAtaCandidato[]>(`/trabalho/atas/alvos?tipo=${tipo}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`, token)
        .then((r) => { if (vivo) { setOpcoes(Array.isArray(r) ? r : []); setErro(null); } })
        .catch((e: Error) => { if (vivo) setErro(e.message); });
    }, 200);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [tipo, q, token]);

  return (
    <div data-testid={`ata-busca-${tipo}`} className="space-y-1.5 rounded-lg border border-border bg-surface-2 p-2">
      <div className="flex gap-2">
        <input
          autoFocus
          aria-label={tipo === 'lead' ? 'Buscar lead pelo nome ou pela empresa' : 'Buscar cliente pelo nome ou CNPJ'}
          aria-controls={idLista}
          data-testid={`ata-busca-${tipo}-campo`}
          className={INP}
          value={q}
          placeholder={tipo === 'lead' ? 'Nome ou empresa do lead' : 'Nome ou CNPJ do cliente'}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar(); } }}
        />
        <button type="button" className={BTN} onClick={onFechar}>Fechar</button>
      </div>
      {erro && <p role="alert" className="text-bad break-words">{erro}</p>}
      {opcoes && opcoes.length === 0 && <p className="text-muted">Nada com essa busca.</p>}
      <ul id={idLista} className="max-h-56 space-y-0.5 overflow-y-auto">
        {opcoes?.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              data-testid={`ata-alvo-${c.id}`}
              disabled={ocupado}
              className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left hover:bg-brand/10 disabled:opacity-50 ${ALVO}`}
              onClick={() => onEscolher(c)}
            >
              <span className="min-w-0 truncate">{c.nome}</span>
              {c.detalhe && <span className="shrink-0 truncate text-[11px] text-muted">{c.detalhe}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * As atas ligadas a um lead ou a um cliente. `null` enquanto carrega; lista
 * vazia sem ligação ou sem permissão de ver as atas (o painel não quebra).
 */
export function useAtasLigadas(alvo: { leadId?: string | null; clienteId?: string | null }): TrabAtaLigadaItem[] | null {
  const { token, ready, can } = useAuth();
  const [itens, setItens] = useState<TrabAtaLigadaItem[] | null>(null);
  const podeVer = can('tarefas.ver');
  const chave = alvo.leadId ? `lead=${encodeURIComponent(alvo.leadId)}` : alvo.clienteId ? `cliente=${encodeURIComponent(alvo.clienteId)}` : null;
  useEffect(() => {
    if (!ready) return;
    if (!token || !chave || !podeVer) { setItens([]); return; }
    let vivo = true;
    setItens(null);
    apiGet<TrabAtaLigadaItem[]>(`/trabalho/atas/ligadas?${chave}`, token)
      .then((r) => { if (vivo) setItens(Array.isArray(r) ? r : []); })
      .catch(() => { if (vivo) setItens([]); });
    return () => { vivo = false; };
  }, [ready, token, chave, podeVer]);
  return itens;
}

/** Uma linha: a data (número) e o título, que abre a ata na tela Atas. */
export function LinhaDaAtaLigada({ a }: { a: TrabAtaLigadaItem }) {
  return (
    <li data-testid={`ata-ligada-${a.ataRef}`} className="flex flex-wrap items-baseline gap-x-2 break-words">
      <span className="shrink-0 font-os-mono text-[11.5px] tabular-nums text-muted">{dataBR(a.data) ?? 'sem data'}</span>
      <a href={hrefDaAta(a.ataRef)} className="min-w-0 underline decoration-brand/50 underline-offset-2 hover:text-brand">{a.titulo}</a>
      {a.tipo === 'transcricao' && <span className="text-[11px] text-muted">transcrição</span>}
    </li>
  );
}

/** A seção "Atas" da ficha do cliente. */
export function AtasDoCliente({ clienteId }: { clienteId: string }) {
  const itens = useAtasLigadas({ clienteId });
  return (
    <section className="rounded-md border border-border bg-surface px-5 py-4" aria-label="Atas do cliente" data-testid="ficha-atas">
      <h2 className="text-[1.05rem] font-semibold">Atas</h2>
      {itens === null && <p className="mt-2 text-sm text-muted">Carregando…</p>}
      {itens && itens.length === 0 && (
        <p className="mt-2 text-sm text-muted">
          Nenhuma ata ligada a este cliente. Ligue em <a href="/trabalho/atas" className="text-brand underline underline-offset-2">Atas</a>.
        </p>
      )}
      {itens && itens.length > 0 && <ul className="mt-2 space-y-1 text-sm">{itens.map((a) => <LinhaDaAtaLigada key={a.ataRef} a={a} />)}</ul>}
    </section>
  );
}
