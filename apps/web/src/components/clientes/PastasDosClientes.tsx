'use client';

import { useEffect, useState } from 'react';
import type { ClienteComPasta } from '@mktos/shared';

import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PastaDoCliente } from './PastaDoCliente';

/*
 * AS PASTAS DOS CLIENTES NO DRIVE (rodada dos agentes, 21/10/2026, lane A4, TR-04).
 *
 * A tela do cliente: cada cliente ativo com o estado da pasta dele, "Abrir
 * pasta do cliente" quando existe, "Criar pasta do cliente" quando não, o
 * pedido na fila de aprovação e os arquivos que esperam a pasta nascer. Lê
 * `GET /clientes/pastas` (quem vê tarefas ou leads). Recolhida por padrão.
 */
export function PastasDosClientes() {
  const { token, ready, can } = useAuth();
  const [aberta, setAberta] = useState(false);
  const [clientes, setClientes] = useState<ClienteComPasta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const pode = can('tarefas.ver') || can('leads.ver');

  useEffect(() => {
    if (!aberta || !ready || !token || !pode) return;
    let vivo = true;
    setErro(null);
    apiGet<ClienteComPasta[]>('/clientes/pastas', token)
      .then((r) => vivo && setClientes(r))
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [aberta, ready, token, pode]);

  if (!ready || !pode) return null;
  const sem = clientes?.filter((c) => !c.pastaDriveUrl).length ?? 0;
  return (
    <section aria-label="Pastas dos clientes no Drive" className="rounded-root border border-border p-3 text-sm">
      <button type="button" onClick={() => setAberta((a) => !a)} aria-expanded={aberta} className="font-medium text-text hover:underline">
        Pastas dos clientes no Drive{clientes ? ` · ${clientes.length - sem} com pasta · ${sem} sem` : ''}
      </button>
      {aberta && (
        <div className="mt-3 space-y-2">
          {erro && <p role="alert" className="text-xs text-muted">Não conseguimos ler as pastas: {erro}</p>}
          {!erro && clientes === null && <p className="text-xs text-muted">Carregando…</p>}
          {clientes?.length === 0 && <p className="text-xs text-muted">Nenhum cliente ativo.</p>}
          <ul className="divide-y divide-border">
            {clientes?.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{c.nome}</span>
                <span className="flex flex-wrap items-center gap-3">
                  {c.arquivosNaFila > 0 && (
                    <span className="text-xs text-muted">{c.arquivosNaFila} arquivo(s) esperando a pasta</span>
                  )}
                  <PastaDoCliente partnerId={c.id} url={c.pastaDriveUrl} erro={c.pastaDriveErro} aguardando={c.aguardandoAprovacao} compacto />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
