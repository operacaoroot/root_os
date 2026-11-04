'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Etapa 9 (F-26, decisão do Lucas em 04/11/2026): a Atividade mostra também o que aconteceu nas
 * áreas (Comercial, WhatsApp e implantação), em cima do histórico técnico dos agentes e do sistema.
 * Do WhatsApp vem só quantas mensagens cada conversa teve, nunca o texto.
 */
interface ItemDaArea {
  em: string;
  area: 'comercial' | 'whatsapp' | 'implantacao';
  texto: string;
  link: string | null;
}

const ROTULO: Record<ItemDaArea['area'], string> = { comercial: 'Comercial', whatsapp: 'WhatsApp', implantacao: 'Implantação' };
const quando = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

export function DasAreas() {
  const { token, ready } = useAuth();
  const [itens, setItens] = useState<ItemDaArea[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [area, setArea] = useState<'' | ItemDaArea['area']>('');
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<ItemDaArea[]>('/linha-do-tempo/areas?dias=7', token).then(setItens).catch((e) => setErro((e as Error).message));
  }, [ready, token]);

  const visiveis = (itens ?? []).filter((i) => !area || i.area === area);
  const mostrados = aberto ? visiveis : visiveis.slice(0, 15);

  return (
    <section className="rounded-md border border-border bg-surface p-4" aria-label="O que aconteceu nas áreas">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-medium">Nas áreas · últimos 7 dias</h2>
          <p className="text-sm text-muted">Comercial, WhatsApp (só quantas mensagens, sem o texto) e implantação. Abaixo, o histórico técnico.</p>
        </div>
        <div className="flex gap-1.5 text-sm">
          {(['', 'comercial', 'whatsapp', 'implantacao'] as const).map((a) => (
            <button key={a || 'todas'} onClick={() => setArea(a)} className={`rounded border px-2 py-0.5 ${area === a ? 'border-brand text-brand' : 'border-border text-muted'}`}>
              {a ? ROTULO[a] : 'Todas'}
            </button>
          ))}
        </div>
      </div>
      {erro ? (
        <p className="mt-3 text-sm text-bad">{erro}</p>
      ) : !itens ? (
        <p className="mt-3 text-sm text-muted">Carregando…</p>
      ) : visiveis.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nada nos últimos 7 dias.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border">
            {mostrados.map((i, n) => (
              <li key={`${i.em}-${n}`} className="flex items-baseline gap-3 py-1.5 text-sm">
                <span className="w-24 shrink-0 font-os-mono text-xs text-muted">{quando(i.em)}</span>
                <span className="w-24 shrink-0 text-xs text-muted">{ROTULO[i.area]}</span>
                {i.link ? (
                  <Link href={i.link} className="min-w-0 flex-1 truncate hover:text-brand">{i.texto}</Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{i.texto}</span>
                )}
              </li>
            ))}
          </ul>
          {visiveis.length > mostrados.length && (
            <button onClick={() => setAberto(true)} className="mt-2 text-sm text-muted underline hover:text-brand">
              ver todos ({visiveis.length})
            </button>
          )}
        </>
      )}
    </section>
  );
}
