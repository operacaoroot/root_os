'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatarWhatsappBr, lerWhatsappBr, rotuloDoTipoDeMensagem, type ConversaDaCaixa, type MensagemDaCaixa } from '@mktos/shared';

import { apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * AS CONVERSAS DE WHATSAPP LIGADAS A UM LEAD OU CLIENTE (produção 22C, W3).
 * Uma peça só para a aba WhatsApp do painel do lead e o bloco WhatsApp da
 * ficha do cliente: as conversas com a prévia e o link para a caixa, as
 * últimas mensagens da mais recente e o telefone editável (o número que faz a
 * conversa 1:1 ligar sozinha).
 */

const FUSO = 'America/Sao_Paulo';

/** Hora em São Paulo: só a hora se for hoje; senão dia/mês e hora. */
export function horaDaMensagem(iso: string, agora = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dia = (x: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' }).format(x);
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return dia(d) === dia(agora) ? hora : `${dia(d)} ${hora}`;
}

/** O link da conversa na caixa. */
export function hrefDaConversa(id: string): string {
  return `/whatsapp?conversa=${encodeURIComponent(id)}`;
}

function textoDaMensagem(m: { texto: string | null; tipo: string }): string {
  return m.texto?.trim() ? m.texto : `[${rotuloDoTipoDeMensagem(m.tipo)}]`;
}

export function ConversasLigadas({ conversas, ultimas, vazio }: { conversas: ConversaDaCaixa[]; ultimas: MensagemDaCaixa[]; vazio: React.ReactNode }) {
  if (!conversas.length) {
    return (
      <p data-testid="whats-ligadas-vazio" className="text-[13px] text-muted">
        {vazio}
      </p>
    );
  }
  const maisRecente = conversas[0];
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded border border-border" aria-label="conversas ligadas">
        {conversas.map((c) => (
          <li key={c.id} data-testid={`whats-ligada-${c.id}`} className="flex items-start gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="truncate font-medium text-text">{c.nome}</span>
                {c.grupo && <span className="rounded border border-border px-1.5 text-[10.5px] uppercase tracking-wide text-muted">grupo{c.participantes ? ` · ${c.participantes}` : ''}</span>}
                {c.naoLidas > 0 && <span className="rounded bg-brand/15 px-1.5 text-[10.5px] tabular-nums text-brand">{c.naoLidas} não lida{c.naoLidas > 1 ? 's' : ''}</span>}
              </div>
              {c.previa && (
                <p className="mt-0.5 truncate text-[12.5px] text-muted">
                  {c.previa.deMim ? 'Você: ' : c.grupo && c.previa.remetenteNome ? `${c.previa.remetenteNome}: ` : ''}
                  {textoDaMensagem(c.previa)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {c.ultimaMensagemEm && <span className="text-[11px] tabular-nums text-muted">{horaDaMensagem(c.ultimaMensagemEm)}</span>}
              <Link href={hrefDaConversa(c.id)} className="text-[12px] text-brand underline" data-testid={`whats-abrir-${c.id}`}>
                abrir na caixa
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {ultimas.length > 0 && (
        <div>
          <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">últimas mensagens · {maisRecente.nome}</p>
          <ol className="mt-1.5 space-y-1.5" data-testid="whats-ultimas">
            {ultimas.map((m) => (
              <li key={m.id} className={`flex ${m.deMim ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded px-2.5 py-1.5 text-[12.5px] ${m.deMim ? 'bg-brand/10 text-text' : 'border border-border bg-bg text-text'}`}>
                  {!m.deMim && maisRecente.grupo && m.remetenteNome && <p className="text-[11px] font-medium text-muted">{m.remetenteNome}</p>}
                  {m.deMim && m.enviadaPor && <p className="text-[11px] font-medium text-muted">{m.enviadaPor.nome}</p>}
                  <p className="whitespace-pre-wrap break-words">{textoDaMensagem(m)}</p>
                  <p className="mt-0.5 text-right text-[10.5px] tabular-nums text-muted">{horaDaMensagem(m.timestamp)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/**
 * O telefone do lead ou do cliente, editável por quem tem `leads.editar`. Grava
 * pela rota de `/whatsapp/vinculos` (normaliza como a Equipe, audita e casa de
 * novo a conversa 1:1 do número).
 */
export function TelefoneEditavel({
  caminho,
  telefone,
  podeEditar,
  aoSalvar,
  convite,
  testId = 'whats-telefone',
}: {
  caminho: string;
  telefone: string | null;
  podeEditar: boolean;
  aoSalvar: () => void | Promise<void>;
  convite?: React.ReactNode;
  testId?: string;
}) {
  const { token } = useAuth();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const lido = telefone ? lerWhatsappBr(telefone) : null;
  const mostrado = telefone ? (lido?.ok ? lido.formatado : formatarWhatsappBr(telefone)) : null;

  async function salvar() {
    const limpo = valor.trim();
    if (limpo) {
      const l = lerWhatsappBr(limpo);
      if (!l.ok) {
        setErro(l.motivo);
        return;
      }
    }
    setSalvando(true);
    setErro(null);
    try {
      await apiPut(caminho, { telefone: limpo || null }, token);
      setEditando(false);
      await aoSalvar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (editando) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid={testId}>
        <label className="sr-only" htmlFor={`${testId}-campo`}>telefone com DDD</label>
        <input
          id={`${testId}-campo`}
          data-testid={`${testId}-campo`}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="(32) 99999-0000"
          inputMode="tel"
          className="w-48 rounded border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-brand"
        />
        <button type="button" onClick={() => void salvar()} disabled={salvando} className="rounded border border-border px-3 py-1.5 text-[12.5px] hover:border-brand disabled:opacity-50">
          {salvando ? 'salvando…' : 'salvar'}
        </button>
        <button type="button" onClick={() => setEditando(false)} className="text-[12.5px] text-muted underline">
          cancelar
        </button>
        {erro && <p role="alert" className="w-full text-[12px] text-bad">{erro}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]" data-testid={testId}>
      <span className="text-muted">telefone:</span>
      <span className="tabular-nums text-text">{mostrado ?? 'não preenchido'}</span>
      <button
        type="button"
        onClick={() => {
          setValor(telefone ?? '');
          setEditando(true);
        }}
        disabled={!podeEditar}
        title={podeEditar ? undefined : 'Editar o telefone pede a permissão leads.editar.'}
        data-testid={`${testId}-editar`}
        className="rounded border border-border px-2.5 py-1 text-[12px] hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        {telefone ? 'editar' : 'preencher'}
      </button>
      {!telefone && convite && <p className="w-full text-[12.5px] text-muted">{convite}</p>}
    </div>
  );
}
