'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { AbaCaptura } from './AbaCaptura';
import { AbaFila } from './AbaFila';
import { AbaAcervo } from './AbaAcervo';
import { AbaRadar } from './AbaRadar';

// Página de coleta de referência (docs/PAUTA.md §6). Quatro abas, uma
// responsabilidade cada: capturar cru → virar ficha → consultar → automatizar.
const ABAS = ['Captura', 'Fila', 'Acervo', 'Radar'] as const;
type Aba = (typeof ABAS)[number];

export default function ReferenciasPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [aba, setAba] = useState<Aba>('Captura');
  const [erro, setErro] = useState<string | null>(null);
  const [bump, setBump] = useState(0);

  const recarregar = useCallback(() => setBump((b) => b + 1), []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Referências</h1>
        <p className="text-sm text-muted">
          O repertório que ensina <em>como</em> escrever — cada peça capturada vira ficha no
          formato do Cérebro de Conteúdo (família × objetivo). É daqui que a geração de
          conteúdo puxa as estruturas campeãs.
        </p>
      </div>

      <div className="flex gap-4 border-b border-border">
        {ABAS.map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm ${
              aba === a ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {erro && (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {erro}
        </div>
      )}

      {!ready && <p className="text-sm text-muted">Carregando…</p>}

      {ready && aba === 'Captura' && (
        <AbaCaptura token={token} editavel={editavel} onErro={setErro} onMudou={recarregar} />
      )}
      {ready && aba === 'Fila' && (
        <AbaFila token={token} editavel={editavel} onErro={setErro} bump={bump} onMudou={recarregar} />
      )}
      {ready && aba === 'Acervo' && (
        <AbaAcervo token={token} editavel={editavel} onErro={setErro} bump={bump} onMudou={recarregar} />
      )}
      {ready && aba === 'Radar' && (
        <AbaRadar token={token} editavel={editavel} onErro={setErro} bump={bump} onMudou={recarregar} />
      )}
    </div>
  );
}
