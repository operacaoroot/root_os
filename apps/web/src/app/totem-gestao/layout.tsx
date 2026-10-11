'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Permission } from '@mktos/shared';
import { useAuth } from '@/lib/auth';

/*
 * O PAINEL DO TOTEM — a casca e a navegação interna (frente A).
 *
 * A navegação lista as telas das três frentes do painel (A, C e D), cada uma
 * com a permissão que a abre. Quem não tem nenhuma das permissões de um item
 * não o vê; a API continua sendo quem recusa de verdade.
 */

interface ItemDoPainel {
  href: string;
  rotulo: string;
  /** Basta uma. */
  permissoes: Permission[];
}

const ITENS: ItemDoPainel[] = [
  { href: '/totem-gestao', rotulo: 'Resumo', permissoes: ['totem.ver'] },
  { href: '/totem-gestao/lojas', rotulo: 'Lojas', permissoes: ['totem.lojas', 'totem.rede'] },
  { href: '/totem-gestao/produtos', rotulo: 'Produtos', permissoes: ['totem.produtos'] },
  { href: '/totem-gestao/dispositivos', rotulo: 'Totens', permissoes: ['totem.dispositivos'] },
  { href: '/totem-gestao/lotes', rotulo: 'Lotes', permissoes: ['totem.lotes'] },
  { href: '/totem-gestao/remessas', rotulo: 'Remessas', permissoes: ['totem.lotes', 'totem.reposicao'] },
  { href: '/totem-gestao/reposicoes', rotulo: 'Reposições', permissoes: ['totem.reposicao', 'totem.lotes'] },
  { href: '/totem-gestao/etiquetas', rotulo: 'Etiquetas', permissoes: ['totem.etiquetas'] },
  { href: '/totem-gestao/campanhas', rotulo: 'Campanhas', permissoes: ['totem.campanhas'] },
  { href: '/totem-gestao/clientes', rotulo: 'Clientes', permissoes: ['totem.clientes'] },
  { href: '/totem-gestao/cupons', rotulo: 'Cupons', permissoes: ['totem.cupons'] },
  { href: '/totem-gestao/usuarios', rotulo: 'Usuários', permissoes: ['totem.lojas'] },
  { href: '/totem-gestao/configuracao', rotulo: 'Configuração', permissoes: ['totem.lojas'] },
];

function ativo(pathname: string, href: string): boolean {
  if (href === '/totem-gestao') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function LayoutDoPainelDoTotem({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can } = useAuth();
  const visiveis = ITENS.filter((i) => i.permissoes.some((p) => can(p)));

  return (
    <div className="space-y-6">
      <nav aria-label="Telas do Totem" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-2">
        {visiveis.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={ativo(pathname, i.href) ? 'page' : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
              ativo(pathname, i.href) ? 'bg-surface-2 font-medium' : 'text-muted hover:bg-surface-2'
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
