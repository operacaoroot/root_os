'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

// Superfícies que NÃO passam pelo shell autenticado: o login e tudo que é
// público por natureza (página da bio, a Central da comunidade e os textos
// legais que a Meta e o TikTok exigem estar acessíveis para o App Review).
const PUBLICAS = ['/login', '/b', '/central', '/termos', '/privacidade'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const publica = PUBLICAS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (ready && !user && !publica) router.replace('/login');
  }, [ready, user, publica, router]);

  if (publica) return <>{children}</>;

  if (!ready || !user) {
    return (
      <div className="grid min-h-screen place-items-center text-muted">
        Carregando…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
