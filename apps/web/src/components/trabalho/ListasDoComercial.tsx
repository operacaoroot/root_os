'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listaDaImplantacao, type TrabEstrutura } from '@mktos/shared';

import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * AS LISTAS DA PASTA CLIENTES, DE ONDE ELAS SE ABREM (produção 22B, revisão M2).
 *
 * Desde o I3 a pasta Clientes é do Comercial e sai da árvore do Trabalho. A lista da
 * implantação é esta tela; as outras (Esteira de clientes, Execução) continuam abrindo
 * pelo quadro de sempre (`/trabalho?lista=<id>`), e a porta para elas é esta linha.
 * Sem pasta do Comercial (ou só com a lista da implantação), a linha não aparece.
 *
 * Leva 5, L3 (27/10/2026): a pasta Clientes voltou à árvore do Trabalho, recolhida, e
 * a Implantação saiu do menu; esta linha segue valendo para quem chega a
 * `/trabalho/implantacao` pelo link.
 */
export function ListasDoComercial() {
  const { token } = useAuth();
  const [listas, setListas] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    apiGet<TrabEstrutura>('/trabalho/estrutura', token)
      .then((e) => {
        if (!vivo) return;
        const pastas = e.pastasDoComercial ?? [];
        const implantacao = listaDaImplantacao(pastas)?.listaId ?? null;
        setListas(pastas.flatMap((p) => p.lists.filter((l) => l.id !== implantacao).map((l) => ({ id: l.id, name: l.name }))));
      })
      .catch(() => { if (vivo) setListas([]); });
    return () => { vivo = false; };
  }, [token]);

  const outras = listas;
  if (!outras.length) return null;
  return (
    <nav aria-label="Listas da pasta Clientes" data-testid="listas-do-comercial" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span>Listas da pasta Clientes:</span>
      {outras.map((l, i) => (
        <span key={l.id} className="inline-flex items-center gap-2">
          {i > 0 ? <span aria-hidden="true">·</span> : null}
          <Link href={`/trabalho?lista=${encodeURIComponent(l.id)}`} className="underline underline-offset-2">{l.name}</Link>
        </span>
      ))}
    </nav>
  );
}
