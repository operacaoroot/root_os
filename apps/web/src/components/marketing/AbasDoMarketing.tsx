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
  return (
    <div className="estudio">
      {cab && (
        <div className="pagehead" style={{ marginTop: 14 }}>
          <div>
            <h1>{cab.titulo}</h1>
            <p>{cab.lead}</p>
          </div>
        </div>
      )}
      <nav aria-label="Abas da seção" className="ideias-tabs estudio-abas" style={{ overflowX: 'auto' }}>
        {abas.map((a) => (
          <Link key={a.key} href={a.href} aria-current={a.ativa ? 'page' : undefined} className={a.ativa ? 'active' : ''} style={{ whiteSpace: 'nowrap' }}>
            {a.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
