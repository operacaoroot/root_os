'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useEhPlataforma } from '@/lib/plataforma';
import { useModulos } from './modulos';
import { areaDoDestino, destinoDaRota, modulosDeNavegacao, rotuloDoDestino } from './navegacao-modulos';

/** Links de páginas, apresentados como abas: funcionam também sem interceptar o teclado. */
export function NavegacaoDoModulo() {
  const { user } = useAuth();
  const { modulos } = useModulos();
  const pathname = usePathname();
  const ehPlataforma = useEhPlataforma();
  const destino = destinoDaRota(pathname, ehPlataforma);
  const chave = destino && areaDoDestino(destino)?.key;
  const area = modulosDeNavegacao(user?.permissions ?? [], modulos ?? undefined, ehPlataforma)
    .find((item) => item.key === chave);
  if (!area) return null;
  return <nav aria-label={`Abas de ${area.label}`} className="mb-5 flex flex-wrap gap-1 border-b border-border pb-2">
    {area.itens.map((item) => <Link key={item.key} href={item.href}
      aria-current={destino?.key === item.key ? 'page' : undefined}
      title={item.key === 'fluxos' ? 'Processos: em preparação' : undefined}
      className={`inline-flex min-h-11 items-center gap-2 rounded-root border px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${destino?.key === item.key ? 'border-brand-dim bg-brand/10 font-medium text-brand' : 'border-transparent text-muted hover:bg-surface-2 hover:text-text'}`}>
      {rotuloDoDestino(item)}
      {item.key === 'fluxos' && <span className="text-[10px]">em preparação</span>}
    </Link>)}
  </nav>;
}
