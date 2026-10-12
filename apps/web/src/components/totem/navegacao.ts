import type { Permission } from '@mktos/shared';

/*
 * As telas do painel do Totem, cada uma com a permissão que a abre (basta uma).
 * Mora fora do layout porque duas cascas leem a mesma lista: a navegação em
 * abas do layout de /totem-gestao, na instância ROOT, e a lateral da instância
 * com a marca do Sr. aGranel (lib/marca.ts). A API continua sendo quem recusa
 * de verdade.
 */

export interface ItemDoPainelDoTotem {
  href: string;
  rotulo: string;
  /** Nome do ícone no lucide-react. */
  icone: string;
  permissoes: Permission[];
}

export const ITENS_DO_PAINEL_DO_TOTEM: ItemDoPainelDoTotem[] = [
  { href: '/totem-gestao', rotulo: 'Resumo', icone: 'LayoutDashboard', permissoes: ['totem.ver'] },
  { href: '/totem-gestao/lojas', rotulo: 'Lojas', icone: 'Store', permissoes: ['totem.lojas', 'totem.rede'] },
  { href: '/totem-gestao/produtos', rotulo: 'Produtos', icone: 'Package', permissoes: ['totem.ver', 'totem.produtos'] },
  { href: '/totem-gestao/dispositivos', rotulo: 'Totens', icone: 'MonitorSmartphone', permissoes: ['totem.dispositivos'] },
  { href: '/totem-gestao/lotes', rotulo: 'Lotes', icone: 'Boxes', permissoes: ['totem.lotes'] },
  { href: '/totem-gestao/remessas', rotulo: 'Remessas', icone: 'Truck', permissoes: ['totem.lotes', 'totem.reposicao'] },
  { href: '/totem-gestao/reposicoes', rotulo: 'Reposições', icone: 'PackageCheck', permissoes: ['totem.reposicao', 'totem.lotes'] },
  { href: '/totem-gestao/etiquetas', rotulo: 'Etiquetas', icone: 'QrCode', permissoes: ['totem.etiquetas'] },
  { href: '/totem-gestao/campanhas', rotulo: 'Campanhas', icone: 'Megaphone', permissoes: ['totem.campanhas'] },
  { href: '/totem-gestao/clientes', rotulo: 'Clientes', icone: 'Users', permissoes: ['totem.clientes'] },
  { href: '/totem-gestao/cupons', rotulo: 'Cupons', icone: 'Ticket', permissoes: ['totem.cupons'] },
  { href: '/totem-gestao/usuarios', rotulo: 'Usuários', icone: 'UserCog', permissoes: ['totem.lojas'] },
  { href: '/totem-gestao/configuracao', rotulo: 'Configuração', icone: 'Settings', permissoes: ['totem.lojas'] },
];

export function itemAtivoDoTotem(pathname: string, href: string): boolean {
  if (href === '/totem-gestao') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** O item da tela aberta, pelo href mais longo que casa. */
export function itemDaRotaDoTotem(pathname: string): ItemDoPainelDoTotem | undefined {
  return ITENS_DO_PAINEL_DO_TOTEM.filter((i) => itemAtivoDoTotem(pathname, i.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}
