'use client';

import { tempoDoCapitulo, type PautaCandidatoDoCorte } from '@mktos/shared';
import { Botao, Chip } from '../referencias/ui';

/*
 * MD13: os trechos candidatos ao corte de uma matéria, com a nota e o motivo
 * que o modelo deu. A nota só ordena a revisão: não mede alcance. Trocar manda
 * `{ candidato: n }` no PUT da peça; a API tira o mp4 da peça, volta ao
 * rascunho, e o vigia do Mac renderiza o trecho novo.
 */

const nota = (n: number | null) => (n === null ? 'sem nota' : `nota ${n.toLocaleString('pt-BR')}`);

export function CandidatosDoCorte({
  candidatos,
  podeTrocar,
  ocupado,
  onTrocar,
}: {
  candidatos: readonly PautaCandidatoDoCorte[] | undefined;
  podeTrocar: boolean;
  ocupado: boolean;
  onTrocar: (n: number) => void;
}) {
  if (!candidatos?.length) return null;
  const temOutro = candidatos.length > 1;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted">
        {temOutro ? `${candidatos.length} candidatos ao corte` : 'Nota do corte'}
      </summary>
      <ol className="mt-1 space-y-2" aria-label="Candidatos ao corte">
        {candidatos.map((c) => (
          <li key={c.n} className="min-w-0 space-y-1 rounded border border-border p-2" aria-label={`Candidato ${c.n}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono">
                {tempoDoCapitulo(c.inicio)}–{tempoDoCapitulo(c.fim)} ({Math.round(c.fim - c.inicio)} s)
              </span>
              <Chip tone={c.n === 1 ? 'brand' : 'muted'}>{nota(c.nota)}</Chip>
              {c.atual && <Chip tone="good">em uso</Chip>}
            </div>
            <p className="break-words font-medium">{c.titulo}</p>
            {c.motivo && <p className="break-words text-muted">{c.motivo}</p>}
            {podeTrocar && !c.atual && (
              <Botao onClick={() => onTrocar(c.n)} disabled={ocupado}>
                Usar este trecho
              </Botao>
            )}
          </li>
        ))}
      </ol>
      {podeTrocar && temOutro && (
        <p className="mt-1 text-[11px] text-muted">
          Trocar tira o mp4 atual da peça e a volta ao rascunho; o vigia do Mac renderiza o trecho novo. A nota só ordena a
          revisão, não mede alcance.
        </p>
      )}
    </details>
  );
}
