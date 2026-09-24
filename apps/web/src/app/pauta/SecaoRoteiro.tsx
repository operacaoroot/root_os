'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PAUTA_CHAVE_DA_PALAVRA_DE_CORTE,
  PAUTA_PALAVRA_DE_CORTE_PADRAO,
  comPalavraDeCorte,
  type PautaEpisodioStatus,
  type PautaRoteiroDoEpisodio,
} from '@mktos/shared';
import { apiGet, apiPost, apiPut, apiTexto } from '@/lib/api';
import { Botao, inputCls } from '../referencias/ui';
import { RoteiroMarkdown } from './roteiro-markdown';

/*
 * O ROTEIRO DO EPISÓDIO (MC8), dentro do detalhe da aba Episódios: gerar pela
 * IA a partir dos itens mantidos, editar à mão, exportar o .md e abrir no modo
 * de gravação. Quem decide se pode gerar é a API (`podeGerar` + `motivo`).
 */

interface Props {
  token: string | null;
  episodioId: string;
  /** Muda quando o episódio anda de etapa: o painel é relido. */
  status: PautaEpisodioStatus;
  editavel: boolean;
  /** Gerar gasta IA: exige `automacoes.executar`, como gerar a rodada. */
  podeGastarIa: boolean;
  bump: number;
  onErro: (m: string | null) => void;
  onMudou: () => void;
}

const ORIGEM: Record<PautaRoteiroDoEpisodio['palavraDeCorte']['origem'], string> = {
  episodio: 'só deste episódio',
  empresa: 'da empresa (memória)',
  padrao: 'padrão',
};

/** O texto sem o lembrete da palavra: trocar a palavra não é mexer no roteiro. */
const semLembrete = (roteiro: string) => comPalavraDeCorte(roteiro, '');

function baixar(nome: string, conteudo: string) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Este navegador não deixou baixar o arquivo. Copie o texto do editor.');
  }
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SecaoRoteiro({ token, episodioId, status, editavel, podeGastarIa, bump, onErro, onMudou }: Props) {
  const [painel, setPainel] = useState<PautaRoteiroDoEpisodio | null>(null);
  const [texto, setTexto] = useState('');
  const [palavra, setPalavra] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const atualRef = useRef(episodioId);
  // Edição não salva sobrevive a uma releitura do painel (o episódio andou de
  // etapa, a palavra mudou): só a troca de episódio ou uma escrita do texto a
  // substitui.
  const sujoRef = useRef(false);
  // A versão de onde a edição partiu: é ela que vai no salvar, para a trava
  // (409) pegar outra aba que tenha mudado o roteiro nesse meio tempo.
  const baseRef = useRef<{ versao: string; roteiro: string } | null>(null);
  useEffect(() => {
    atualRef.current = episodioId;
    sujoRef.current = false;
    baseRef.current = null;
    setAviso(null);
    setConfirmando(false);
  }, [episodioId]);

  const aplicar = useCallback((p: PautaRoteiroDoEpisodio, preservar = false) => {
    if (p.episodioId !== atualRef.current) return;
    setPainel(p);
    setPalavra(p.palavraDeCorte.doEpisodio ?? '');
    if (p.espelho?.erro) setAviso(`O roteiro está salvo, mas o espelho no vault falhou: ${p.espelho.erro}`);
    else if (p.espelho?.caminho) setAviso(`Espelhado no vault em ${p.espelho.caminho}.`);
    if (!(preservar && sujoRef.current)) {
      setTexto(p.roteiro);
      sujoRef.current = false;
      baseRef.current = null;
      return;
    }
    const base = baseRef.current;
    if (!base || semLembrete(base.roteiro) === semLembrete(p.roteiro)) {
      // Mudou o status, o título ou a palavra, não o texto: a edição vale contra a versão nova.
      baseRef.current = { versao: p.atualizadoEm, roteiro: p.roteiro };
    } else {
      setAviso(
        'O roteiro mudou em outra aba enquanto você editava: salvar vai recusar. Copie o que escreveu e descarte a edição para ver o novo.',
      );
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    setPainel((p) => (p && p.episodioId === episodioId ? p : null));
    apiGet<PautaRoteiroDoEpisodio>(`/pauta/episodios/${episodioId}/roteiro`, token)
      .then((p) => {
        if (vivo) aplicar(p, true);
      })
      .catch((e: Error) => {
        if (vivo) onErro(e.message);
      });
    return () => {
      vivo = false;
    };
  }, [token, episodioId, status, bump, onErro, aplicar]);

  const acao = async (
    nome: string,
    fn: () => Promise<PautaRoteiroDoEpisodio>,
    opts: { mudaEpisodio?: boolean; preservarEdicao?: boolean } = {},
  ) => {
    onErro(null);
    setAviso(null);
    setOcupado(nome);
    try {
      aplicar(await fn(), opts.preservarEdicao);
      if (opts.mudaEpisodio) onMudou();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const gerar = (id: string, substituir: boolean) => {
    setConfirmando(false);
    // Gerar leva o episódio para a gravação: a aba relê o status e a lista.
    return acao('gerar', () => apiPost<PautaRoteiroDoEpisodio>(`/pauta/episodios/${id}/roteiro/gerar`, { substituir }, token), {
      mudaEpisodio: true,
    });
  };

  const salvar = (p: PautaRoteiroDoEpisodio) =>
    acao('salvar', () =>
      apiPut<PautaRoteiroDoEpisodio>(
        `/pauta/episodios/${p.episodioId}/roteiro`,
        { roteiro: texto, versao: baseRef.current?.versao ?? p.atualizadoEm },
        token,
      ),
    );

  // A palavra não é o texto: a edição em curso fica no editor.
  const salvarPalavra = (id: string, valor: string | null) =>
    acao(
      'palavra',
      () => apiPut<PautaRoteiroDoEpisodio>(`/pauta/episodios/${id}/palavra-de-corte`, { palavraDeCorte: valor }, token),
      { preservarEdicao: true },
    );

  const exportar = async (p: PautaRoteiroDoEpisodio) => {
    onErro(null);
    setOcupado('exportar');
    try {
      baixar(`${p.apelido}-roteiro.md`, await apiTexto(`/pauta/episodios/${p.episodioId}/roteiro.md`, token));
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  if (!painel) return <p className="text-sm text-muted">Carregando o roteiro…</p>;

  const escrevendo = ocupado !== null;
  const temRoteiro = painel.roteiro.trim() !== '';
  const mudou = texto !== painel.roteiro;
  const palavraMudou = palavra.trim() !== (painel.palavraDeCorte.doEpisodio ?? '') && palavra.trim().length >= 2;
  const semIa = !podeGastarIa ? 'Gerar gasta IA: precisa da permissão automacoes.executar.' : undefined;

  return (
    <div className="space-y-3" aria-label="Roteiro do episódio">
      <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Roteiro</h3>

      <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-sm">
          Palavra de corte: <strong>“{painel.palavraDeCorte.efetiva}”</strong>{' '}
          <span className="text-xs text-muted">({ORIGEM[painel.palavraDeCorte.origem]})</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputCls} min-w-0 flex-1`}
            value={palavra}
            maxLength={40}
            placeholder={painel.palavraDeCorte.daEmpresa ?? PAUTA_PALAVRA_DE_CORTE_PADRAO}
            onChange={(e) => setPalavra(e.target.value)}
            disabled={!editavel || escrevendo}
            aria-label="Palavra de corte deste episódio"
          />
          <Botao onClick={() => salvarPalavra(painel.episodioId, palavra.trim())} disabled={!editavel || escrevendo || !palavraMudou}>
            {ocupado === 'palavra' ? 'Salvando…' : 'Usar neste episódio'}
          </Botao>
          {painel.palavraDeCorte.doEpisodio && (
            <Botao tone="ghost" onClick={() => salvarPalavra(painel.episodioId, null)} disabled={!editavel || escrevendo}>
              Voltar à da empresa
            </Botao>
          )}
        </div>
        <p className="text-[11px] text-muted">
          Vale já: o topo do roteiro, o .md e o espelho passam a trazer a palavra nova. A da empresa é a nota da memória
          com a chave <code>{PAUTA_CHAVE_DA_PALAVRA_DE_CORTE}</code> (a primeira linha é a palavra), criada pela API da
          memória (<code>POST /memoria</code>); a tela Contexto só cria nota enquanto a memória está vazia.
        </p>
      </div>

      {painel.motivo && <p className="text-sm text-muted">{painel.motivo}</p>}

      <div className="flex flex-wrap gap-2">
        {painel.podeGerar && !confirmando && (
          <Botao
            tone="brand"
            onClick={() => (temRoteiro ? setConfirmando(true) : gerar(painel.episodioId, false))}
            disabled={!editavel || !podeGastarIa || escrevendo || mudou}
            title={semIa ?? (mudou ? 'Salve ou descarte a edição antes de gerar.' : undefined)}
          >
            {ocupado === 'gerar' ? 'Gerando…' : temRoteiro ? 'Gerar de novo' : 'Gerar roteiro'}
          </Botao>
        )}
        {confirmando && (
          <div role="alertdialog" aria-label="Substituir o roteiro" className="flex flex-wrap items-center gap-2 text-sm">
            <span>Substituir o roteiro atual? O texto editado à mão se perde.</span>
            <Botao tone="bad" onClick={() => gerar(painel.episodioId, true)} disabled={escrevendo}>
              Substituir
            </Botao>
            <Botao tone="ghost" onClick={() => setConfirmando(false)}>
              Cancelar
            </Botao>
          </div>
        )}
        {temRoteiro && (
          <>
            <Botao onClick={() => setGravando(true)} disabled={mudou} title={mudou ? 'Salve antes de abrir para gravar.' : undefined}>
              Abrir para gravar
            </Botao>
            <Botao onClick={() => exportar(painel)} disabled={escrevendo || mudou} title={mudou ? 'Salve antes de exportar.' : undefined}>
              {ocupado === 'exportar' ? 'Exportando…' : 'Exportar .md'}
            </Botao>
          </>
        )}
      </div>

      {aviso && <p className="text-xs text-muted">{aviso}</p>}

      <textarea
        className={`${inputCls} min-h-[16rem] font-mono text-[13px] leading-relaxed`}
        value={texto}
        onChange={(e) => {
          if (!sujoRef.current) baseRef.current = { versao: painel.atualizadoEm, roteiro: painel.roteiro };
          sujoRef.current = true;
          setTexto(e.target.value);
        }}
        disabled={!editavel || escrevendo}
        placeholder={painel.podeGerar ? 'Gere o roteiro pela IA ou escreva aqui, em markdown.' : ''}
        aria-label="Texto do roteiro"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Botao onClick={() => salvar(painel)} disabled={!editavel || escrevendo || !mudou}>
          {ocupado === 'salvar' ? 'Salvando…' : 'Salvar roteiro'}
        </Botao>
        {mudou && (
          <Botao
            tone="ghost"
            onClick={() => {
              sujoRef.current = false;
              baseRef.current = null;
              setAviso(null);
              setTexto(painel.roteiro);
            }}
            disabled={escrevendo}
          >
            Descartar edição
          </Botao>
        )}
      </div>

      {gravando && (
        <ModoGravacao
          apelido={painel.apelido}
          titulo={painel.titulo}
          palavra={painel.palavraDeCorte.efetiva}
          roteiro={painel.roteiro}
          onFechar={() => setGravando(false)}
        />
      )}
    </div>
  );
}

const TAMANHOS = [18, 22, 26, 32, 40];

/**
 * Tela limpa para gravar: cobre o painel inteiro, fonte grande (ajustável),
 * links clicáveis. No segundo monitor, "Tela cheia"; no celular, rola.
 */
export function ModoGravacao({
  apelido,
  titulo,
  palavra,
  roteiro,
  onFechar,
}: {
  apelido: string;
  titulo: string;
  palavra: string;
  roteiro: string;
  onFechar: () => void;
}) {
  const [tam, setTam] = useState(1);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    raiz.current?.focus();
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  const telaCheia = () => {
    const el = raiz.current;
    if (el && typeof el.requestFullscreen === 'function') el.requestFullscreen().catch(() => undefined);
  };

  return (
    <div
      ref={raiz}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Gravar ${apelido}`}
      className="fixed inset-0 z-[60] overflow-y-auto bg-bg text-text outline-none"
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur">
        <span className="font-mono text-sm font-semibold">{apelido}</span>
        <span className="rounded-full border border-warn/50 bg-warn/10 px-2.5 py-0.5 text-sm">
          Corta: <strong>“{palavra}”</strong>
        </span>
        <span className="flex-1" />
        <Botao tone="ghost" onClick={() => setTam((t) => Math.max(0, t - 1))} disabled={tam === 0} title="Diminuir a fonte">
          A−
        </Botao>
        <Botao tone="ghost" onClick={() => setTam((t) => Math.min(TAMANHOS.length - 1, t + 1))} disabled={tam === TAMANHOS.length - 1} title="Aumentar a fonte">
          A+
        </Botao>
        <Botao onClick={telaCheia}>Tela cheia</Botao>
        <Botao onClick={onFechar}>Fechar</Botao>
      </div>
      <article className="mx-auto max-w-3xl px-4 py-6 sm:px-8" style={{ fontSize: `${TAMANHOS[tam]}px` }} aria-label={titulo}>
        <RoteiroMarkdown texto={roteiro} grande />
      </article>
    </div>
  );
}
