'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { EH_SRAGRANEL } from '@/lib/marca';
import { ITENS_DO_PAINEL_DO_TOTEM, itemAtivoDoTotem } from '@/components/totem/navegacao';

/*
 * O PAINEL DO TOTEM — a casca e a navegação interna (frente A).
 *
 * A navegação lista as telas das três frentes do painel (A, C e D), cada uma
 * com a permissão que a abre (components/totem/navegacao.ts). Quem não tem
 * nenhuma das permissões de um item não o vê; a API continua sendo quem recusa
 * de verdade.
 *
 * Na instância com a marca do Sr. aGranel as mesmas telas já estão na lateral,
 * e as abas sairiam repetidas logo abaixo dela.
 */

export default function LayoutDoPainelDoTotem({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can } = useAuth();

  if (EH_SRAGRANEL) return <div className="space-y-6">{children}</div>;

  const visiveis = ITENS_DO_PAINEL_DO_TOTEM.filter((i) => i.permissoes.some((p) => can(p)));

  return (
    <div className="space-y-6">
      <nav aria-label="Telas do Totem" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-2">
        {visiveis.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={itemAtivoDoTotem(pathname, i.href) ? 'page' : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
              itemAtivoDoTotem(pathname, i.href) ? 'bg-surface-2 font-medium' : 'text-muted hover:bg-surface-2'
            }`}
          >
            {i.rotulo}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
