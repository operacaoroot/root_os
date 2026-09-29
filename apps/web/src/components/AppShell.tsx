'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { moduloDaRotaDoWeb } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ChatFlutuante } from './ChatFlutuante';
import { ModulosProvider, useModulos } from './modulos';
import { CaixaProvider } from './caixa';

// Superfícies que NÃO passam pelo shell autenticado: o login e tudo que é
// público por natureza (página da bio, a Central da comunidade e os textos
// legais que a Meta e o TikTok exigem estar acessíveis para o App Review).
//
// `'/'` ENTROU NA ONDA 11 (fatia 6.5): a raiz do domínio deixou de servir o
// protótipo estático e passou a ser a entrada pública de verdade
// (`src/app/page.tsx`), com o mapa ao vivo da ROOT. Sem esta entrada o shell
// manda todo visitante anônimo para `/login` — a isca do produto pediria login
// antes de mostrar qualquer coisa.
//
// A regra abaixo casa `'/'` SÓ com a raiz: `pathname === '/'` é verdade apenas
// para ela, e `startsWith('//')` não acontece em caminho normalizado. Nenhuma
// outra tela vira pública por causa desta linha.
const PUBLICAS = ['/', '/mapa-publico', '/entrar', '/login', '/b', '/central', '/termos', '/privacidade', '/e'];

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
  // O provedor da CAIXA (fatia A7) mora DENTRO do de módulos e pelo mesmo
  // motivo: ele depende do token, e nas superfícies públicas não há sessão nem
  // caixa pessoal para medir. Ele alimenta o selo da barra lateral e a própria
  // tela `/caixa` — as duas lendo o mesmo número, medido uma vez por navegação.
  return (
    <ModulosProvider>
      <CaixaProvider>
        <div data-os-app className="flex min-h-screen">
          <a
            href="#root-os-main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:bg-brand focus:px-4 focus:py-3 focus:text-ink"
          >
            Pular para o conteúdo
          </a>
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main id="root-os-main" tabIndex={-1} className="flex-1 min-w-0 p-4 min-[820px]:p-6">
              <PortaDaAssinatura>
                <PortaDoModulo>{children}</PortaDoModulo>
              </PortaDaAssinatura>
            </main>
          </div>
          {/* Conversar acontece aqui; o REGISTRO do que foi conversado é /sessoes.
              Nunca nas superfícies públicas — o AppShell devolve os filhos crus lá. */}
          <ChatFlutuante />
        </div>
      </CaixaProvider>
    </ModulosProvider>
  );
}

/*
 * A PORTA DA ASSINATURA — RF-O-03 (fatia 6.2).
 *
 * ----------------------------------------------------------------------------
 * O QUE ELA CONSERTA
 * ----------------------------------------------------------------------------
 * A API já recusava toda rota do produto para empresa suspensa, com o código
 * `assinatura_suspensa` no corpo. Faltava o outro lado: quem entrava suspenso
 * caía em `/painel`, via uma caixa vermelha em cada bloco da tela e não tinha
 * como saber POR QUE — a tela que explica o bloqueio existia, e só era alcançada
 * digitando o endereço. Nenhum item de menu levava até ela e nada redirecionava.
 *
 * O precedente de como resolver está a duas telas daqui: `PortaDoModulo`, logo
 * abaixo, faz o mesmo para módulo não contratado. A diferença é que ali NÃO se
 * redireciona (mandar para `/painel` esconderia o motivo e poderia entrar em
 * laço), e aqui se redireciona — porque existe uma tela que é exatamente sobre
 * isto, ela responde para quem está suspenso, e ficar parado é que esconderia o
 * motivo.
 *
 * ----------------------------------------------------------------------------
 * É CORTESIA, NÃO SEGURANÇA — a mesma doutrina do resto da casca
 * ----------------------------------------------------------------------------
 * Quem recusa de verdade é a API. Este componente roda no browser e não guarda
 * nada, então o lado inseguro do "não sei" (enquanto a resposta não chega, e se
 * ela falhar, a tela monta) não abre buraco nenhum: a API continua respondendo
 * 403 em cada chamada. O que se ganha é a pessoa chegar onde dá para resolver.
 *
 * A CHAMADA É UMA SÓ e é a `/assinatura`, que é rota liberada na suspensão (ver
 * `LIBERADOS_NA_SUSPENSAO`, na API) — usar qualquer outra para descobrir o
 * estado seria descobrir por 403, que é adivinhar por efeito colateral.
 */
function PortaDaAssinatura({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // `null` = ainda não sei. Ver a doutrina acima: "não sei" deixa passar.
  const [bloqueado, setBloqueado] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    apiGet<{ bloqueado?: boolean }>('/assinatura', token)
      .then((r) => {
        if (vivo) setBloqueado(r?.bloqueado === true);
      })
      .catch(() => {
        // API velha, rede caída, sessão expirando: fica no "não sei".
        if (vivo) setBloqueado(null);
      });
    return () => {
      vivo = false;
    };
  }, [token, pathname]);

  const naPropriaTela = pathname === '/assinatura' || pathname.startsWith('/assinatura/');

  useEffect(() => {
    if (bloqueado === true && !naPropriaTela) router.replace('/assinatura');
  }, [bloqueado, naPropriaTela, router]);

  if (bloqueado !== true || naPropriaTela) return <>{children}</>;

  /*
   * O `replace` acima já está a caminho; este bloco é o que a pessoa vê no meio
   * do caminho — e o link existe para o caso de o roteador não completar
   * (navegação cancelada, JS lento). Uma tela que só dissesse "redirecionando" e
   * não levasse a lugar nenhum seria o mesmo beco de antes, com outra cara.
   */
  return (
    <div className="mx-auto max-w-[520px] border border-border bg-bg2 p-6 font-os-mono">
      <h1 className="text-[13px] font-bold tracking-[-0.01em] text-text">Acesso suspenso</h1>
      <p className="mt-2 text-[11.5px] leading-[1.6] text-muted">
        A assinatura desta empresa está bloqueada, então esta tela não responde agora.{' '}
        <span className="text-text">Nada foi apagado</span> — assim que o pagamento for
        confirmado, tudo volta inteiro.
      </p>
      <a
        href="/assinatura"
        className="mt-4 inline-block border border-border px-3 py-[6px] text-[10px] uppercase tracking-[0.12em] text-muted hover:border-border-strong hover:text-text"
      >
        ver a assinatura
      </a>
    </div>
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
        voltar à visão geral
      </a>
    </div>
  );
}
