'use client';

import type { ResumoDoVigia } from '@mktos/shared';

import { CARTAO, Rotulo } from '../_ui';

/**
 * CO-11 (rodada dos agentes, 21/10/2026): as três linhas do topo da última passagem. Os números são os do
 * vigia; a linha do modelo com número que não bateu já foi trocada pela do sistema na API, e o aviso diz qual.
 */
export function ResumoDoVigiaNaTorre({ resumo }: { resumo: ResumoDoVigia }) {
  const rotulo = resumo.origem === 'modelo' ? 'escrito pelo vigia' : resumo.origem === 'misto' ? 'escrito pelo vigia, com linha do sistema' : 'montado pelo sistema';
  return (
    <section className={CARTAO} aria-label="resumo do vigia">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Rotulo>resumo do vigia</Rotulo>
        <span className="text-[11px] text-dim">{rotulo} · os números são do sistema</span>
      </div>
      <ol className="mt-2 space-y-1 text-[13.5px]">
        {resumo.linhas.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
      {resumo.avisos.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11.5px] text-dim">
          {resumo.avisos.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
