'use client';

import { useEffect, useState } from 'react';
import { FAMILIAS, rotuloDaArea, type ItemDoEixo, type Mapa } from './grafo';

export function Diretorio({ mapa, recorteAtivo, onAbrir }: {
  mapa: Mapa;
  recorteAtivo: boolean;
  onAbrir: (item: ItemDoEixo, origem?: Element) => void;
}) {
  const [limite, setLimite] = useState(30);
  useEffect(() => setLimite(30), [mapa]);
  const itens = FAMILIAS.flatMap((familia) => mapa.catalogo[familia.key]);
  const semAcesso = mapa.eixos.filter((eixo) => eixo.estado === 'sem_permissao').length;
  const falhas = mapa.eixos.filter((eixo) => eixo.estado === 'erro').length;
  const carregando = mapa.eixos.filter((eixo) => eixo.estado === 'carregando').length;

  return (
    <section aria-label="Diretório do contexto" className="rounded-root border border-border bg-surface p-4">
      <h2 className="font-semibold">Registros no diretório</h2>
      <p className="mt-1 text-sm text-muted">Abra o registro pelo nome. A lista inclui o que não coube no desenho.</p>
      <p className="my-3 text-xs text-muted" role="status">
        {itens.length} {itens.length === 1 ? 'registro carregado' : 'registros carregados'}{recorteAtivo ? ' neste recorte' : ''}
        {semAcesso > 0 ? ` · ${semAcesso} ${semAcesso === 1 ? 'fonte sem acesso' : 'fontes sem acesso'}` : ''}
        {falhas > 0 ? ` · ${falhas} ${falhas === 1 ? 'fonte falhou' : 'fontes falharam'}` : ''}
        {carregando > 0 ? ` · ${carregando} ${carregando === 1 ? 'fonte carregando' : 'fontes carregando'}` : ''}
      </p>
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {itens.slice(0, limite).map((item) => (
          <li key={item.id}>
            <button type="button" onClick={(evento) => onAbrir(item, evento.currentTarget)}
              className="min-h-11 h-full w-full cursor-pointer rounded-root border border-border p-3 text-left hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
              <span className="block break-words text-sm text-text">{item.rotulo}</span>
              <span className="mt-1 block break-words text-xs text-muted">{item.sub}</span>
              <span className="mt-1 block text-[11px] text-dim">
                {item.areas.length ? item.areas.map(rotuloDaArea).join(', ') : 'Sem área definida'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {itens.length === 0 && (
        <p className="text-sm text-muted">
          {semAcesso || falhas || carregando
            ? 'Nenhum registro carregado neste recorte. Algumas fontes ainda não puderam ser consultadas.'
            : 'Nenhum registro corresponde aos filtros.'}
        </p>
      )}
      {itens.length > limite && (
        <button type="button" onClick={() => setLimite((valor) => valor + 30)}
          className="mt-3 min-h-11 cursor-pointer rounded-root border border-border px-3 py-2 text-sm text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          Mostrar mais registros
        </button>
      )}
    </section>
  );
}
