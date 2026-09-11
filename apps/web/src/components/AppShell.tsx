'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { moduloDaRotaDoWeb } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ChatFlutuante } from './ChatFlutuante';
import { ModulosProvider, useModulos } from './modulos';

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

  // O data-os-app já vale aqui: é ele que traz a fonte de corpo, a seleção e
  // o anel de foco do ROOT OS (globals.css). Sem isso o "Carregando…" pisca
  // com a tipografia do sistema antes da casca montar.
  if (!ready || !user) {
    return (
      <div data-os-app className="grid min-h-screen place-items-center font-os-mono text-[11px] uppercase tracking-[0.16em] text-muted">
        carregando…
      </div>
    );
  }

  // O provedor de módulos mora AQUI dentro, e não em volta do AppShell: ele
  // depende do token, e nas superfícies públicas (onde não há sessão) não há
  // nada a perguntar. Ver `modulos.tsx`.
  return (
    <ModulosProvider>
      <div data-os-app className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 p-6">
            <PortaDoModulo>{children}</PortaDoModulo>
          </main>
        </div>
        {/* Conversar acontece aqui; o REGISTRO do que foi conversado é /sessoes.
            Nunca nas superfícies públicas — o AppShell devolve os filhos crus lá. */}
        <ChatFlutuante />
      </div>
    </ModulosProvider>
  );
}

/*
 * A TELA DE MÓDULO NÃO CONTRATADO — RF-T-06.
 *
 * O item sai do menu, mas a URL continua digitável e o link antigo continua
 * colado em algum lugar. Sem esta porta, a pessoa chegaria numa tela que monta
 * e enche de erro de rede, porque a API responde 404 em cada chamada. A tela
 * explica em vez de quebrar.
 *
 * NÃO REDIRECIONA de propósito: mandar para `/painel` esconderia o motivo e,
 * numa sessão cujo `/painel` também estivesse fora, entraria em laço.
 *
 * É CORTESIA, NÃO SEGURANÇA. Quem recusa de verdade é a API — este componente
 * roda no browser e não guarda nada. Por isso o lado inseguro do "não sei"
 * (`ligado()` devolve `true` enquanto a resposta não chega) não cria buraco:
 * a tela monta e a API nega cada chamada.
 */
function PortaDoModulo({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ligado } = useModulos();
  const modulo = moduloDaRotaDoWeb(pathname);

  if (ligado(modulo)) return <>{children}</>;

  return (
    <div className="mx-auto max-w-[520px] border border-border bg-bg2 p-6 font-os-mono">
      <h1 className="text-[13px] font-bold tracking-[-0.01em] text-text">
        Módulo não contratado
      </h1>
      <p className="mt-2 text-[11.5px] leading-[1.6] text-muted">
        O módulo <span className="text-text">{modulo}</span> não está habilitado para esta
        empresa, então esta tela não faz parte do seu painel. Nada foi perdido: quem administra
        a conta pode habilitá-lo.
      </p>
      <a
        href="/painel"
        className="mt-4 inline-block border border-border px-3 py-[6px] text-[10px] uppercase tracking-[0.12em] text-muted hover:border-border-strong hover:text-text"
      >
        voltar ao console
      </a>
    </div>
  );
}
