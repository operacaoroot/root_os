'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MonitorSmartphone,
  Package,
  PackageCheck,
  QrCode,
  Settings,
  Store,
  Ticket,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { SELO_SRAGRANEL } from '@/lib/marca';
import {
  ITENS_DO_PAINEL_DO_TOTEM,
  itemAtivoDoTotem,
  itemDaRotaDoTotem,
} from '@/components/totem/navegacao';

/*
 * A CASCA DA INSTÂNCIA DO SR. AGRANEL (lib/marca.ts): toma o lugar da Sidebar e
 * da Topbar da ROOT. Segue o CabecalhoPainel do design system dele: faixa
 * verde-mata com filete laranja de 4px, selo redondo e título em Fraunces. A
 * lateral e o topo têm a mesma altura, e a faixa atravessa a tela inteira.
 *
 * Os ícones vêm importados um a um, e não pelo `import * as Icons` da Sidebar,
 * para que esta casca não arraste o lucide inteiro para o bundle.
 */

const ICONES: Record<string, LucideIcon> = {
  LayoutDashboard,
  Store,
  Package,
  MonitorSmartphone,
  Boxes,
  Truck,
  PackageCheck,
  QrCode,
  Megaphone,
  Users,
  Ticket,
  UserCog,
  Settings,
};

const MINHA_CONTA = '/totem-gestao/minha-conta';

const PAPEIS: Record<string, string> = {
  totem_rede: 'rede',
  totem_cd: 'centro de distribuição',
  totem_gerente: 'gerente de loja',
  totem_operador: 'operador',
  admin_master: 'administração',
  admin: 'administração',
};

function papeisLegiveis(roles: string[] | undefined): string {
  return (roles ?? []).map((r) => PAPEIS[r] ?? r.replace(/_/g, ' ')).join(' · ');
}

function useItensVisiveis() {
  const { can } = useAuth();
  return ITENS_DO_PAINEL_DO_TOTEM.filter((i) => i.permissoes.some((p) => can(p)));
}

export function LateralSrAgranel() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const itens = useItensVisiveis();

  return (
    <aside className="sticky top-0 hidden h-screen w-[240px] flex-none flex-col border-r border-border bg-bg2 min-[820px]:flex">
      <div className="sg-cabecalho flex h-[84px] flex-none items-center gap-3 px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={SELO_SRAGRANEL} alt="" width={48} height={48} className="sg-selo h-12 w-12" />
        <span className="sg-titulo text-[20px] leading-[24px]">Senhor aGranel</span>
      </div>

      <nav aria-label="Telas do painel" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {itens.map((i) => {
          const Icone = ICONES[i.icone] ?? LayoutDashboard;
          const ativo = itemAtivoDoTotem(pathname, i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={ativo ? 'page' : undefined}
              className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors ${
                ativo ? 'bg-brand text-ink' : 'text-text hover:bg-surface-2'
              }`}
            >
              <Icone size={18} strokeWidth={1.75} aria-hidden />
              {i.rotulo}
            </Link>
          );
        })}
      </nav>

      <div className="flex-none border-t border-border px-4 py-4">
        <div className="truncate text-[14px] font-semibold text-text">{user?.name}</div>
        <div className="truncate text-[12px] text-muted">{papeisLegiveis(user?.roles)}</div>
        <Link
          href={MINHA_CONTA}
          aria-current={pathname === MINHA_CONTA ? 'page' : undefined}
          className="mt-3 flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-[14px] font-medium text-text hover:bg-surface-2"
        >
          <KeyRound size={16} aria-hidden />
          Trocar senha
        </Link>
        <button type="button" onClick={logout} className="sg-btn sg-btn-secundario mt-2 w-full">
          <LogOut size={16} aria-hidden />
          Sair
        </button>
      </div>
    </aside>
  );
}

export function TopoSrAgranel() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const itens = useItensVisiveis();
  const titulo = pathname === MINHA_CONTA ? 'Minha conta' : (itemDaRotaDoTotem(pathname)?.rotulo ?? 'Painel');

  return (
    <>
      <header className="sg-cabecalho flex h-[84px] flex-none items-center gap-4 px-4 min-[820px]:px-6">
        {/* No celular a lateral some, e o selo vem para cá. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={SELO_SRAGRANEL}
          alt=""
          width={48}
          height={48}
          className="sg-selo h-12 w-12 min-[820px]:hidden"
        />
        <div className="min-w-0 flex-1">
          <div className="sg-rotulo">Gestão das lojas</div>
          <h1 className="sg-titulo truncate text-[24px] leading-[30px] min-[820px]:text-[28px] min-[820px]:leading-[34px]">
            {titulo}
          </h1>
        </div>
        <div className="hidden min-w-0 text-right min-[560px]:block min-[820px]:hidden">
          <div className="truncate text-[14px] font-semibold text-[#f5f3ec]">{user?.name}</div>
          <div className="sg-meta truncate">{papeisLegiveis(user?.roles)}</div>
        </div>
        <Link
          href={MINHA_CONTA}
          aria-label="Trocar senha"
          title="Trocar senha"
          className="grid h-11 w-11 flex-none place-items-center rounded-lg border border-[#c9cbb5]/40 text-[#f5f3ec] transition-colors hover:bg-[#31422a] min-[820px]:hidden"
        >
          <KeyRound size={18} aria-hidden />
        </Link>
        <button
          type="button"
          onClick={logout}
          aria-label="Sair"
          title="Sair"
          className="grid h-11 w-11 flex-none place-items-center rounded-lg border border-[#c9cbb5]/40 text-[#f5f3ec] transition-colors hover:bg-[#31422a] min-[820px]:hidden"
        >
          <LogOut size={18} aria-hidden />
        </button>
      </header>

      {/* No celular a navegação vira uma faixa rolável logo abaixo do cabeçalho. */}
      <nav
        aria-label="Telas do painel"
        className="flex flex-none gap-2 overflow-x-auto border-b border-border bg-bg2 px-4 py-2 min-[820px]:hidden"
      >
        {itens.map((i) => {
          const ativo = itemAtivoDoTotem(pathname, i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={ativo ? 'page' : undefined}
              className={`flex min-h-[40px] flex-none items-center whitespace-nowrap rounded-lg px-3 text-[14px] font-medium ${
                ativo ? 'bg-brand text-ink' : 'text-text hover:bg-surface-2'
              }`}
            >
              {i.rotulo}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
