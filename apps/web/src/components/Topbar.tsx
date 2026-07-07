'use client';

import { Search, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export function Topbar() {
  const { user, logout } = useAuth();
  const initials = (user?.name ?? '?')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="flex items-center gap-4 border-b border-border bg-surface/60 px-6 py-3 backdrop-blur">
      {/* Busca global (stub — Fase 5) */}
      <div className="relative max-w-md flex-1">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          disabled
          placeholder="Buscar leads, campanhas, tarefas… (Fase 5)"
          className="w-full cursor-not-allowed rounded-lg border border-border bg-bg py-2 pl-9 pr-3 text-sm text-muted placeholder:text-muted/70"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="text-right leading-tight">
          <div className="text-sm">{user?.name}</div>
          <div className="text-[11px] text-muted">{user?.roles.join(', ')}</div>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-full bg-brand/20 text-sm font-semibold text-brand">
          {initials}
        </div>
        <button
          onClick={logout}
          title="Sair"
          className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:bg-surface-2 hover:text-text"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
