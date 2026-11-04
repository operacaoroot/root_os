'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CABECALHO_DA_SECAO, NAV, abasDoMarketing, secaoComAbas } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { useModulos } from '../modulos';

/** A rota é do Marketing (seção `conteudo`): a área ganha a paleta do ROOT Estúdio. */
export function ehAreaDoMarketing(pathname: string): boolean {
  const caminho = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const item = NAV.filter((n) => caminho === n.href || caminho.startsWith(`${n.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  return item?.secao === 'conteudo';
}

/*
 * As abas da seção do Marketing (Ideias de conteúdo, Produção, Performance), no topo da
 * tela, com a marcação das abas do ROOT Estúdio ("Para aprovar | Base").
 * Fora dessas seções não desenha nada.
 */
export function AbasDoMarketing() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { modulos } = useModulos();
  const abas = abasDoMarketing(pathname, user?.permissions ?? [], modulos ?? undefined);
  const secao = secaoComAbas(pathname);
  const cab = secao ? CABECALHO_DA_SECAO[secao] : null;
  if (abas.length < 2) return null;
  // Etapa 9b (Lucas, 04/11/2026): as abas no desenho das outras áreas (o Painel geral do Comercial),
  // sem o título grande do Estúdio. O nome da seção já está no topo da tela; a frase vai ao lado das abas.
  return (
    <div className="com-tema mx-auto mb-5 max-w-[1180px] text-text">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <nav aria-label="Abas da seção" className="flex gap-1 overflow-x-auto">
          {abas.map((a) => (
            <Link
              key={a.key}
              href={a.href}
              aria-current={a.ativa ? 'page' : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[0.95rem] ${a.ativa ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {a.label}
            </Link>
          ))}
        </nav>
        {cab && <p className="mb-2 hidden text-sm text-muted md:block">{cab.lead}</p>}
      </div>
    </div>
  );
}
