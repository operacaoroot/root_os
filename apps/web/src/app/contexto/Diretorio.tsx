'use client';

import { useState } from 'react';
import { FAMILIAS, type ItemDoEixo, type Mapa } from './grafo';

export function Diretorio({ mapa, onAbrir }: { mapa: Mapa; onAbrir: (item: ItemDoEixo) => void }) {
  const [busca, setBusca] = useState('');
  const [familia, setFamilia] = useState('');
  const [limite, setLimite] = useState(30);
  const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const termo = normalizar(busca.trim());
  const itens = FAMILIAS.filter((f) => !familia || f.key === familia).flatMap((f) => mapa.catalogo[f.key])
    .filter((i) => !termo || normalizar(`${i.rotulo} ${i.sub}`).includes(termo));

  return <section aria-label="Diretório do contexto" className="rounded-root border border-border bg-surface p-4">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1"><h2 className="font-semibold">Explore o que está conectado</h2>
        <p className="mt-1 text-sm text-muted">Leia os nomes completos e abra o registro. A lista inclui os itens que não cabem no desenho.</p></div>
      <label className="text-xs text-muted">Tipo de registro
        <select value={familia} onChange={(e) => { setFamilia(e.target.value); setLimite(30); }} className="mt-1 block rounded-root border border-border bg-bg p-2 text-sm text-text">
          <option value="">Todos os tipos</option>{FAMILIAS.map((f) => <option key={f.key} value={f.key}>{f.rotulo}</option>)}
        </select></label>
      <label className="text-xs text-muted">Buscar no diretório
        <input value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(30); }} className="mt-1 block w-full rounded-root border border-border bg-bg p-2 text-sm text-text" placeholder="Nome da fonte, pessoa ou rotina" /></label>
    </div>
    <p className="my-3 text-xs text-muted" role="status">{itens.length} registro(s) disponível(is) nesta visualização</p>
    <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {itens.slice(0, limite).map((item) => <li key={item.id}><button onClick={() => onAbrir(item)} className="h-full w-full rounded-root border border-border p-3 text-left hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
        <span className="block break-words text-sm text-text">{item.rotulo}</span><span className="mt-1 block break-words text-xs text-muted">{item.sub}</span>
      </button></li>)}
    </ul>
    {itens.length === 0 && <p className="text-sm text-muted">Nenhum registro corresponde ao filtro. A lista respeita suas permissões e as fontes que responderam.</p>}
    {itens.length > limite && <button onClick={() => setLimite((v) => v + 30)} className="mt-3 rounded-root border border-border px-3 py-2 text-sm text-brand">Mostrar mais registros</button>}
  </section>;
}
