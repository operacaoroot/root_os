'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function FerramentasPage() {
  const { token, ready, can } = useAuth();
  const podeVer = can('mcp.ver');
  const [slugs, setSlugs] = useState<string[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [estadoKey, setEstadoKey] = useState('');
  const chave = `${token ?? ''}\u0000${podeVer ? 'ver' : 'sem-ver'}`;
  const estadoAtual = estadoKey === chave;
  const slugsVisiveis = estadoAtual ? slugs : null;
  const erroVisivel = estadoAtual ? erro : null;
  useEffect(() => {
    let vivo = true;
    setEstadoKey(chave);
    setSlugs(null); setErro(null);
    if (!ready || !token || !podeVer) return () => { vivo = false; };
    apiGet<{ ferramentas: string[] }>('/tenants/modulos', token)
      .then((res) => { if (vivo) setSlugs(res.ferramentas); })
      .catch((error: Error) => { if (vivo) setErro(error.message); });
    return () => { vivo = false; };
  }, [ready, token, chave, podeVer]);

  if (!ready) return <p className="text-sm text-muted">Carregando sessão…</p>;
  if (!token || !podeVer) return <p className="text-sm text-muted">Entre com permissão para ver ferramentas.</p>;
  return (
    <main className="space-y-5">
      <header>
        <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">o que existe · ferramentas</p>
        <h1 className="mt-2 text-xl font-semibold">Ferramentas da empresa</h1>
      </header>
      {erroVisivel && <p className="text-sm text-bad">{erroVisivel}</p>}
      {slugsVisiveis?.length === 0 && <p className="text-sm text-muted">Nenhuma ferramenta ativada.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {slugsVisiveis?.map((slug) => (
          <Link key={slug} href={`/ferramentas/${slug}`} className="rounded-lg border border-border bg-surface p-4 hover:border-brand-dim">
            <p className="font-medium">{slug}</p>
            <p className="mt-1 text-xs text-muted">Abrir registros internos</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
