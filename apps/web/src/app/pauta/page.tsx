'use client';

import { useCallback, useState } from 'react';
import { CODIGO_CONECTOR_DESLIGADO } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AbaCuradoria } from './AbaCuradoria';
import { AbaRotinas } from './AbaRotinas';
import { AbaRodadas } from './AbaRodadas';

// Painel da pauta (ondas 2 e 3): o gatilho e o que ele produz.
// O acervo de referência fica em /referencias — são coisas diferentes de
// propósito (repertório dura anos, pauta dura 72h). Ver docs/PAUTA.md §2.
// A Curadoria (MC6) é onde o operador marca o que segue antes do roteiro.
const ABAS = ['Rodadas', 'Curadoria', 'Rotinas'] as const;
type Aba = (typeof ABAS)[number];

/** O que a caixa de erro precisa saber: a frase, e se há caminho de conserto. */
interface Erro {
  texto: string;
  conectorDesligado: boolean;
}

export default function PautaPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const podePublicar = can('pauta.publicar');
  const [aba, setAba] = useState<Aba>('Rodadas');
  const [erro, setErro] = useState<Erro | null>(null);
  const [bump, setBump] = useState(0);
  const [curadoriaAberta, setCuradoriaAberta] = useState<string | null>(null);
  const recarregar = useCallback(() => setBump((b) => b + 1), []);

  /*
   * A CAIXA DE ERRO PRECISA SABER **QUAL** ERRO — RF-G-06.
   *
   * Publicar passa pela fila de aprovação, e desde o gancho da porta a
   * confirmação pode ser recusada porque alguém desligou o conector desta
   * empresa. A frase que a API manda já explica o que houve, mas ela terminava
   * numa caixa vermelha igual a todas as outras: quem lê "religar em Conexões"
   * tinha de sair procurando a tela no menu. Com o código da recusa em mãos, a
   * caixa leva o operador direto ao lugar onde o problema se resolve.
   *
   * A decisão é pelo CÓDIGO e não pela frase: casar por substring amarraria a
   * tela à redação do texto em português.
   */
  const aoErrar = useCallback((m: string | null, codigo?: string | null) => {
    setErro(m === null ? null : { texto: m, conectorDesligado: codigo === CODIGO_CONECTOR_DESLIGADO });
  }, []);

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
            onClick={() => {
              setCuradoriaAberta(null);
              setAba(a);
            }}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm ${
              aba === a ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {erro && (
        <div className="space-y-1 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          <div>{erro.texto}</div>
          {erro.conectorDesligado && (
            <div>
              Nada foi enviado e a peça continua na fila.{' '}
              <a href="/conexoes" className="font-medium underline">
                Abrir Conexões
              </a>{' '}
              para religar o conector — depois é só publicar de novo.
            </div>
          )}
        </div>
      )}

      {!ready && <p className="text-sm text-muted">Carregando…</p>}

      {ready && aba === 'Rodadas' && (
        <AbaRodadas
          token={token}
          editavel={editavel}
          podePublicar={podePublicar}
          onErro={aoErrar}
          bump={bump}
          onMudou={recarregar}
          onAbrirCuradoria={(id) => {
            setCuradoriaAberta(id);
            setAba('Curadoria');
          }}
        />
      )}
      {ready && aba === 'Curadoria' && (
        <AbaCuradoria
          token={token}
          editavel={editavel}
          onErro={aoErrar}
          bump={bump}
          onMudou={recarregar}
          inicial={curadoriaAberta}
        />
      )}
      {ready && aba === 'Rotinas' && (
        <AbaRotinas token={token} editavel={editavel} onErro={aoErrar} bump={bump} onMudou={recarregar} />
      )}
    </div>
  );
}
