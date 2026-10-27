'use client';

import { useState } from 'react';
import type { MaquinaEtapa, MaquinaPost } from '@mktos/shared';
import { MaquinaPagina } from './MaquinaPagina';
import { Kanban, ListaDePosts, SeletorDeVisao, useVisao } from './pecas';

const busca = (p: MaquinaPost, q: string) =>
  !q || `${p.numero} ${p.titulo} ${p.headline} ${p.formato}`.toLowerCase().includes(q.toLowerCase());

/*
 * Uma etapa da esteira em Lista ou Kanban: Banco de ideias, Design & Gravação e
 * Agendar. O kanban mostra a esteira inteira, para arrastar o post adiante.
 */
export function TelaDaEtapa(props: {
  chave: string;
  titulo: string;
  nota: string;
  etapa: MaquinaEtapa;
  vazio: string;
  /** Agendar mostra também os já agendados, por data. */
  comAgendados?: boolean;
  /** O banco mostra o arquivo no fim. */
  comArquivo?: boolean;
}) {
  const [visao, setVisao] = useVisao(props.chave);
  const [q, setQ] = useState('');
  const [verArquivo, setVerArquivo] = useState(false);
  return (
    <MaquinaPagina
      titulo={props.titulo}
      nota={props.nota}
      acoes={
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar"
            className="w-40 rounded border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
          />
          <SeletorDeVisao
            visao={visao}
            onTrocar={setVisao}
            opcoes={[
              { v: 'lista', rotulo: 'Lista' },
              { v: 'kanban', rotulo: 'Kanban' },
            ]}
          />
        </>
      }
    >
      {({ m, painel, abrir, levar }) => {
        const ordenados = [...painel.posts].sort((a, b) => a.ordem - b.ordem).filter((p) => busca(p, q));
        if (visao === 'kanban') {
          return <Kanban m={m} posts={ordenados} onAbrir={abrir} levar={levar} />;
        }
        const daEtapa = ordenados.filter((p) => p.etapa === props.etapa);
        const agendados = ordenados
          .filter((p) => p.etapa === 'agendado')
          .sort((a, b) => (a.data ?? '').localeCompare(b.data ?? ''));
        const arquivo = ordenados.filter((p) => p.etapa === 'arquivado');
        return (
          <div className="space-y-6">
            <section>
              {props.comAgendados && <h2 className="com-rotulo mb-2">Sem data ({daEtapa.length})</h2>}
              <ListaDePosts m={m} posts={daEtapa} onAbrir={abrir} levar={levar} vazio={props.vazio} semEtapa />
            </section>
            {props.comAgendados && (
              <section>
                <h2 className="com-rotulo mb-2">Agendados ({agendados.length})</h2>
                <ListaDePosts m={m} posts={agendados} onAbrir={abrir} levar={levar} vazio="Nenhum post agendado." semEtapa />
              </section>
            )}
            {props.comArquivo && arquivo.length > 0 && (
              <section>
                <button className="com-rotulo hover:text-text" onClick={() => setVerArquivo((v) => !v)}>
                  {verArquivo ? '▾' : '▸'} Arquivo ({arquivo.length})
                </button>
                {verArquivo && (
                  <div className="mt-2 opacity-75">
                    <ListaDePosts m={m} posts={arquivo} onAbrir={abrir} levar={levar} vazio="" />
                  </div>
                )}
              </section>
            )}
          </div>
        );
      }}
    </MaquinaPagina>
  );
}
