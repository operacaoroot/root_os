'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { AbaRotinas } from './AbaRotinas';
import { AbaRodadas } from './AbaRodadas';

// Painel da pauta (ondas 2 e 3): o gatilho e o que ele produz.
// O acervo de referência fica em /referencias — são coisas diferentes de
// propósito (repertório dura anos, pauta dura 72h). Ver docs/PAUTA.md §2.
const ABAS = ['Rodadas', 'Rotinas'] as const;
type Aba = (typeof ABAS)[number];

export default function PautaPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const podePublicar = can('pauta.publicar');
  const [aba, setAba] = useState<Aba>('Rodadas');
  const [erro, setErro] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  const recarregar = useCallback(() => setBump((b) => b + 1), []);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted">
          A rotina coleta os feeds, cura a janela numa chamada só e deriva uma peça por canal —
          usando as fichas campeãs de{' '}
          <a href="/referencias" className="text-brand hover:underline">
            Referências
          </a>{' '}
          como molde.
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
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{erro}</div>
      )}

      {!ready && <p className="text-sm text-muted">Carregando…</p>}

      {ready && aba === 'Rodadas' && (
        <AbaRodadas
          token={token}
          editavel={editavel}
          podePublicar={podePublicar}
          onErro={setErro}
          bump={bump}
          onMudou={recarregar}
        />
      )}
      {ready && aba === 'Rotinas' && (
        <AbaRotinas token={token} editavel={editavel} onErro={setErro} bump={bump} onMudou={recarregar} />
      )}
    </div>
  );
}
