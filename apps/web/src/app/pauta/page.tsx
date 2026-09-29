'use client';

import { useCallback, useEffect, useState } from 'react';
import { CODIGO_CONECTOR_DESLIGADO } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AbaCuradoria } from './AbaCuradoria';
import { AbaEpisodios } from './AbaEpisodios';
import { AbaSemana } from './AbaSemana';
import { AbaRotinas } from './AbaRotinas';
import { AbaRodadas } from './AbaRodadas';
import { AbaVoz } from './AbaVoz';
import { ContaDePublicacao } from './ContaDePublicacao';
import { ComentariosComPalavra } from './ComentariosComPalavra';
import { ProducaoAutoral } from './ProducaoAutoral';
import { useModulos } from '@/components/modulos';

// Painel da pauta (ondas 2 e 3): o gatilho e o que ele produz.
// O acervo de referência fica em /referencias — são coisas diferentes de
// propósito (repertório dura anos, pauta dura 72h). Ver docs/PAUTA.md §2.
// A Curadoria (MC6) é onde o operador marca o que segue antes do roteiro; a
// rodada curada vira episódio (MC7), que anda do roteiro ao concluído. A Voz
// (MC10) é o perfil do autor com que o roteiro e as peças são escritos. A
// Semana (MC16) é o calendário das peças aprovadas, prontas para postar à mão.
const ABAS = ['Rodadas', 'Curadoria', 'Episódios', 'Semana', 'Voz', 'Rotinas'] as const;
type Aba = (typeof ABAS)[number];

/** O que a caixa de erro precisa saber: a frase, e se há caminho de conserto. */
interface Erro {
  texto: string;
  conectorDesligado: boolean;
}

export default function PautaPage() {
  const { token, ready, can } = useAuth();
  const { modulos } = useModulos();
  const podeVerTrabalho = ready && !!token && can('tarefas.ver') && modulos?.includes('trabalho') === true;
  const editavel = can('pauta.editar');
  const podePublicar = can('pauta.publicar');
  const [aba, setAba] = useState<Aba>('Rodadas');
  const [erro, setErro] = useState<Erro | null>(null);
  const [bump, setBump] = useState(0);
  const [curadoriaAberta, setCuradoriaAberta] = useState<string | null>(null);
  const [episodioAberto, setEpisodioAberto] = useState<string | null>(null);
  const recarregar = useCallback(() => setBump((b) => b + 1), []);
  const [retornoDaConexao, setRetornoDaConexao] = useState<string | null>(null);
  const [retornoDoYoutube, setRetornoDoYoutube] = useState<string | null>(null);

  /*
   * A volta do OAuth da conta de publicação (MD5) chega em
   * `/pauta?aba=semana&conexao=<motivo>`. Lido do endereço uma vez e apagado
   * dele, para recarregar a página não repetir o aviso.
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // MD10: a volta do OAuth do YouTube chega em `/pauta?aba=episodios&youtube=<motivo>`.
    const doYoutube = q.get('youtube');
    if (doYoutube) {
      setAba('Episódios');
      setRetornoDoYoutube(doYoutube.slice(0, 40));
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    const motivo = q.get('conexao');
    if (q.get('aba') !== 'semana' && !motivo) return;
    setAba('Semana');
    if (motivo) setRetornoDaConexao(motivo.slice(0, 40));
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const abrirEpisodio = useCallback((id: string) => {
    setEpisodioAberto(id);
    setAba('Episódios');
  }, []);

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
      <section className="rounded-root border border-border bg-surface p-4" aria-label="Escolha o fluxo de conteúdo">
        <h2 className="font-semibold">Continue de onde o conteúdo está</h2>
        <p className="mt-2 text-sm text-muted">Roteiros, gravações e peças da operação editorial ficam no quadro de trabalho. Abaixo, acompanhe as referências coletadas, a curadoria e os episódios derivados.</p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-brand">
          {podeVerTrabalho && <a href="/trabalho?lista=901328341450" className="underline">Abrir produção editorial</a>}
          <a href="/referencias#radar" className="underline">Configurar fontes da coleta</a>
          <a href="/referencias#captura" className="underline">Enviar uma referência</a>
        </div>
      </section>
      {podeVerTrabalho && <ProducaoAutoral token={token} />}
      <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted" aria-label="O caminho da semana">
        <li>Quinta à noite a rotina coleta as fontes do Radar. Ela não escolhe nada.</li>
        <li>Curadoria: marcar à mão o que segue; a IA só sugere.</li>
        <li>Episódio: roteiro, gravação, /root-midia no Mac, pacote do YouTube e semana de posts.</li>
        <li>Semana: cada slot com a legenda e a mídia para postar à mão.</li>
      </ol>

      <div className="flex flex-wrap gap-x-4 border-b border-border">
        {ABAS.map((a) => (
          <button
            key={a}
            onClick={() => {
              setCuradoriaAberta(null);
              setEpisodioAberto(null);
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

      {/* Presa no topo da tela: a ação que falha costuma estar no meio da página
          (Gerar a semana, Confirmar da curadoria, Marcar como postada), e no
          celular a caixa acima das abas ficava fora da vista — o botão voltava
          ao normal sem motivo nenhum visível. */}
      {erro && (
        <div role="alert" className="sticky top-0 z-20 rounded-lg bg-bg">
          <div className="flex items-start gap-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            <div className="min-w-0 flex-1 space-y-1">
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
            <button
              type="button"
              onClick={() => setErro(null)}
              className="min-h-[44px] flex-none px-2 text-xs font-medium underline"
              aria-label="Fechar o aviso de erro"
            >
              Fechar
            </button>
          </div>
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
          onAbrirEpisodio={abrirEpisodio}
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
          onAbrirEpisodio={abrirEpisodio}
        />
      )}
      {ready && aba === 'Episódios' && (
        <AbaEpisodios
          token={token}
          editavel={editavel}
          onErro={aoErrar}
          bump={bump}
          onMudou={recarregar}
          inicial={episodioAberto}
          podeGastarIa={can('automacoes.executar')}
          podeMexerNaBio={can('bio.editar')}
          podePublicarPagina={can('pauta.publicar') && can('bio.editar')}
          podeConectarYoutube={podePublicar}
          avisoDoYoutube={retornoDoYoutube}
        />
      )}
      {ready && aba === 'Semana' && (
        <>
          <ContaDePublicacao
            token={token}
            podeConectar={podePublicar && can('bio.editar')}
            aviso={retornoDaConexao}
            onErro={aoErrar}
          />
          <ComentariosComPalavra token={token} podeResponder={podePublicar} editavel={editavel} onErro={aoErrar} bump={bump} />
          <AbaSemana token={token} editavel={editavel} podePostar={podePublicar} onErro={aoErrar} bump={bump} />
        </>
      )}
      {ready && aba === 'Voz' && (
        <AbaVoz token={token} editavel={editavel} podeGastarIa={can('automacoes.executar')} bump={bump} onErro={aoErrar} />
      )}
      {ready && aba === 'Rotinas' && (
        <AbaRotinas token={token} editavel={editavel} onErro={aoErrar} bump={bump} onMudou={recarregar} />
      )}
    </div>
  );
}
