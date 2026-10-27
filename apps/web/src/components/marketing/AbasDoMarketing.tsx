'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { abasDoMarketing } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { useModulos } from '../modulos';

/*
 * As abas da seção do Marketing (Ideias, Produção, Performance), no topo da tela,
 * como no ROOT Estúdio. Fora dessas seções não desenha nada.
 */
export function AbasDoMarketing() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { modulos } = useModulos();
  const abas = abasDoMarketing(pathname, user?.permissions ?? [], modulos ?? undefined);
  if (abas.length < 2) return null;
  return (
    <nav aria-label="Abas da seção" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {abas.map((a) => (
        <Link
          key={a.key}
          href={a.href}
          aria-current={a.ativa ? 'page' : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
            a.ativa ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'
          }`}
        >
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
