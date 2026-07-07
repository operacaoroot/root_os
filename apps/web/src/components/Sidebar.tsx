'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from '@mktos/shared';
import * as Icons from 'lucide-react';
import { useAuth } from '@/lib/auth';

type IconName = keyof typeof Icons;

export function Sidebar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const perms = new Set(user?.permissions ?? []);
  const items = NAV.filter((n) => perms.has(n.permission));

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand/20 text-brand">
          <Icons.Rocket size={18} />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">Marketing OS</div>
          <div className="text-[11px] text-muted">projeto root</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {items.map((n) => {
          const Icon = (Icons[n.icon as IconName] ?? Icons.Circle) as React.ElementType;
          const active =
            n.href === '/'
              ? pathname === '/'
              : pathname === n.href || pathname.startsWith(n.href + '/');
          return (
            <Link
              key={n.key}
              href={n.href}
              className={[
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                active
                  ? 'bg-brand/15 text-text'
                  : 'text-muted hover:bg-surface-2 hover:text-text',
              ].join(' ')}
            >
              <Icon size={17} className={active ? 'text-brand' : ''} />
              <span className="flex-1 truncate">{n.label}</span>
              {n.phase > 2 && (
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                  F{n.phase}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-3 text-[11px] text-muted">
        Fase 1 · stack isolado
      </div>
    </aside>
  );
}
