'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  PAUTA_EPISODIO_STATUS,
  PAUTA_EPISODIO_STATUS_ROTULO,
  motivoParaNaoAvancar,
  PAUTA_ORIGEM_ROTULOS,
  PAUTA_ORIGENS,
  type PautaEpisodioDetalhe,
  type PautaEpisodioList,
  type PautaEpisodioStatus,
  type PautaOrigem,
} from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { Botao, Card, Chip, inputCls } from '../referencias/ui';
import { SecaoRoteiro } from './SecaoRoteiro';
import { SecaoMidia } from './SecaoMidia';
import { SecaoPacote } from './SecaoPacote';
import { AvisoDoYoutube, SecaoYoutube } from './SecaoYoutube';
import { SecaoPaginaDeLinks } from './SecaoPaginaDeLinks';
import { SecaoNewsletter } from './SecaoNewsletter';
import { SecaoSemana } from './SecaoSemana';
import { LinhaDoEncadeamento } from './LinhaDoEncadeamento';

/*
 * EPISÓDIOS (MC7). A rodada curada vira episódio (o botão mora na aba Rodadas
 * e no fim da Curadoria); aqui ele anda do roteiro ao concluído, um passo por
 * vez. A regra de quem pode ir para onde é da API — a tela só oferece os dois
 * vizinhos que o detalhe devolve. O roteiro (MC8) mora em `SecaoRoteiro`; a
 * mídia e a transcrição que o Mac devolve (MC9), em `SecaoMidia`; o pacote do
 * YouTube (MC11), em `SecaoPacote`; a página de links (MC12), em
 * `SecaoPaginaDeLinks`; a newsletter tirada da transcrição (MC13), em
 * `SecaoNewsletter`; a semana de posts por matéria (MC15), em `SecaoSemana`.
 */

interface Props {
  token: string | null;
  editavel: boolean;
  onErro: (m: string | null) => void;
  bump: number;
  onMudou: () => void;
  /** O episódio que outra aba mandou abrir (acabou de nascer). */
  inicial?: string | null;
  /** Gerar o roteiro (MC8) e o pacote (MC11) gasta IA: exige `automacoes.executar`. */
  podeGastarIa?: boolean;
  /** `bio.editar`: remontar a página de links que já está no ar (MC12). */
  podeMexerNaBio?: boolean;
  /** `pauta.publicar` + `bio.editar`: pôr a página de links no ar (MC12). */
  podePublicarPagina?: boolean;
  /** `pauta.publicar`: conectar o canal do YouTube (MD10). */
  podeConectarYoutube?: boolean;
  /** O `youtube=` com que o retorno do OAuth do YouTube voltou para a aba (MD10). */
  avisoDoYoutube?: string | null;
}

function ehOrigem(o: unknown): o is PautaOrigem {
  return typeof o === 'string' && (PAUTA_ORIGENS as readonly string[]).includes(o);
}

const TOM: Record<PautaEpisodioStatus, 'muted' | 'brand' | 'good' | 'warn'> = {
  roteiro: 'warn',
  gravacao: 'warn',
  edicao: 'warn',
  pacote: 'brand',
  derivacao: 'brand',
  agendado: 'brand',
  concluido: 'good',
};

export function AbaEpisodios({
  token,
  editavel,
  onErro,
  bump,
  onMudou,
  inicial = null,
  podeGastarIa = false,
  podeMexerNaBio = false,
  podePublicarPagina = false,
  podeConectarYoutube = false,
  avisoDoYoutube = null,
}: Props) {
  const [lista, setLista] = useState<PautaEpisodioList | null>(null);
  const [aberto, setAberto] = useState<string | null>(inicial);
  const [detalhe, setDetalhe] = useState<PautaEpisodioDetalhe | null>(null);
  const [titulo, setTitulo] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  // A resposta de uma escrita pode voltar depois que o operador já abriu outro
  // episódio: só se aplica se ainda for o aberto.
  const abertoRef = useRef(aberto);
  useEffect(() => {
    abertoRef.current = aberto;
  }, [aberto]);

  useEffect(() => {
    if (!token) return;
    apiGet<PautaEpisodioList>('/pauta/episodios', token)
      .then((d) => {
        setLista(d);
        setAberto((atual) => atual ?? d.items[0]?.id ?? null);
      })
      .catch((e: Error) => onErro(e.message));
  }, [token, bump, onErro]);

  useEffect(() => {
    if (!token || !aberto) {
      setDetalhe(null);
      return;
    }
    // Trocar de episódio descarta a resposta atrasada do anterior.
    let vivo = true;
    setDetalhe((d) => (d && d.id === aberto ? d : null));
    apiGet<PautaEpisodioDetalhe>(`/pauta/episodios/${aberto}`, token)
      .then((d) => {
        if (!vivo) return;
        setDetalhe(d);
        setTitulo(d.titulo);
      })
      .catch((e: Error) => {
        if (vivo) onErro(e.message);
      });
    return () => {
      vivo = false;
    };
  }, [token, aberto, bump, onErro]);

  const acao = async (nome: string, fn: () => Promise<PautaEpisodioDetalhe>) => {
    onErro(null);
    setOcupado(nome);
    try {
      const d = await fn();
      if (d.id === abertoRef.current) {
        setDetalhe(d);
        setTitulo(d.titulo);
      }
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  // O alvo é o episódio que a tela MOSTRA (é dele que os botões saíram), não o
  // `aberto`, que pode já ter trocado enquanto o detalhe novo não chegou.
  const mover = (id: string, para: PautaEpisodioStatus) =>
    acao(`status-${para}`, () => apiPost<PautaEpisodioDetalhe>(`/pauta/episodios/${id}/status`, { para }, token));

  // A seção do pacote escreve sozinha e devolve o episódio; vale se ainda for o aberto.
  const aplicarDetalhe = useCallback(
    (d: PautaEpisodioDetalhe) => {
      if (d.id === abertoRef.current) {
        setDetalhe(d);
        setTitulo(d.titulo);
      }
      onMudou();
    },
    [onMudou],
  );

  const salvarTitulo = (id: string) =>
    acao('titulo', () => apiPatch<PautaEpisodioDetalhe>(`/pauta/episodios/${id}`, { titulo }, token));

  const escrevendo = ocupado !== null;
  const atual = detalhe ? PAUTA_EPISODIO_STATUS.indexOf(detalhe.status) : -1;
  const tituloMudou = !!detalhe && titulo.trim() !== '' && titulo.trim() !== detalhe.titulo;
  const semInsumo =
    detalhe?.avancar ? motivoParaNaoAvancar(detalhe.status, detalhe.avancar, { segmentos: detalhe.transcricao.length }) : null;

  return (
    <div className="space-y-4">
      {/* A volta do OAuth chega sem episódio aberto: o aviso (o Testing que vence em 7 dias) fica no topo da aba. */}
      {avisoDoYoutube && <AvisoDoYoutube motivo={avisoDoYoutube} />}

      {lista && lista.items.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Nenhum episódio ainda. Confirme a curadoria de uma rodada e use “Criar episódio” — na aba Rodadas ou no
            fim da Curadoria. O episódio nasce no roteiro e anda um passo por vez até o concluído.
          </p>
        </Card>
      )}

      {lista && lista.items.length > 0 && (
        <ul className="space-y-2" aria-label="Episódios">
          {lista.items.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setAberto(e.id)}
                disabled={escrevendo}
                aria-current={aberto === e.id ? 'true' : undefined}
                className={`flex w-full flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-left ${
                  aberto === e.id ? 'border-brand bg-brand/5' : 'border-border bg-surface'
                }`}
              >
                <span className="font-mono text-sm font-semibold">{e.apelido}</span>
                <Chip tone={TOM[e.status]}>{PAUTA_EPISODIO_STATUS_ROTULO[e.status]}</Chip>
                <span className="min-w-0 flex-1 basis-full break-words text-sm sm:basis-auto">{e.titulo}</span>
                <span className="text-[11px] text-muted">{e.itens} item(ns)</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {detalhe && (
        <section className="space-y-4 rounded-xl border border-border bg-surface p-4" aria-label={`Episódio ${detalhe.apelido}`}>
          <div className="space-y-2">
            <p className="font-mono text-xs text-muted">
              {detalhe.apelido} · rodada “{detalhe.rodadaTitulo}” · {new Date(detalhe.janelaIni).toLocaleDateString('pt-BR')} a{' '}
              {new Date(detalhe.janelaFim).toLocaleDateString('pt-BR')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${inputCls} min-w-0 flex-1`}
                value={titulo}
                maxLength={160}
                onChange={(e) => setTitulo(e.target.value)}
                disabled={!editavel || escrevendo}
                aria-label="Título do episódio"
              />
              <Botao onClick={() => salvarTitulo(detalhe.id)} disabled={!editavel || !tituloMudou || escrevendo}>
                {ocupado === 'titulo' ? 'Salvando…' : 'Salvar título'}
              </Botao>
            </div>
          </div>

          <div>
            <h3 className="mb-2 font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              Linha do tempo
            </h3>
            <ol className="flex flex-wrap gap-1.5" aria-label="Linha do tempo do episódio">
              {PAUTA_EPISODIO_STATUS.map((s, i) => {
                const feito = i < atual;
                const agora = i === atual;
                return (
                  <li
                    key={s}
                    aria-current={agora ? 'step' : undefined}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                      agora
                        ? 'border-brand bg-brand text-bg font-semibold'
                        : feito
                          ? 'border-good/40 bg-good/10 text-good'
                          : 'border-border text-muted'
                    }`}
                  >
                    <span className="font-mono">{i + 1}</span>
                    <span>{PAUTA_EPISODIO_STATUS_ROTULO[s]}</span>
                    {feito && <span aria-label="feito">✓</span>}
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              {detalhe.voltar && (
                <Botao onClick={() => mover(detalhe.id, detalhe.voltar!)} disabled={!editavel || escrevendo}>
                  ← Voltar para {PAUTA_EPISODIO_STATUS_ROTULO[detalhe.voltar]}
                </Botao>
              )}
              {detalhe.avancar && (
                <Botao
                  tone="brand"
                  onClick={() => mover(detalhe.id, detalhe.avancar!)}
                  disabled={!editavel || escrevendo || semInsumo !== null}
                >
                  Avançar para {PAUTA_EPISODIO_STATUS_ROTULO[detalhe.avancar]} →
                </Botao>
              )}
              {semInsumo && <p className="w-full break-words text-xs text-muted">{semInsumo}</p>}
              {!detalhe.avancar && <span className="self-center text-sm text-good">Episódio concluído.</span>}
            </div>
            <div className="mt-3">
              <LinhaDoEncadeamento token={token} detalhe={detalhe} />
            </div>
          </div>

          <SecaoRoteiro
            token={token}
            episodioId={detalhe.id}
            status={detalhe.status}
            editavel={editavel}
            podeGastarIa={podeGastarIa}
            bump={bump}
            onErro={onErro}
            onMudou={onMudou}
          />

          <SecaoMidia
            apelido={detalhe.apelido}
            status={detalhe.status}
            midia={detalhe.midia}
            transcricao={detalhe.transcricao}
          />

          <SecaoPacote
            token={token}
            detalhe={detalhe}
            editavel={editavel}
            podeGastarIa={podeGastarIa}
            onErro={onErro}
            onDetalhe={aplicarDetalhe}
          />

          <SecaoYoutube
            key={detalhe.id}
            token={token}
            episodioId={detalhe.id}
            apelido={detalhe.apelido}
            thumbs={detalhe.thumbs}
            editavel={editavel}
            podeConectar={podeConectarYoutube}
            onErro={onErro}
          />

          <SecaoPaginaDeLinks
            token={token}
            detalhe={detalhe}
            editavel={editavel}
            podeMexerNoAr={podeMexerNaBio}
            podePublicar={podePublicarPagina}
            onErro={onErro}
            onDetalhe={aplicarDetalhe}
          />

          <SecaoNewsletter
            token={token}
            detalhe={detalhe}
            editavel={editavel}
            podeGastarIa={podeGastarIa}
            onErro={onErro}
          />

          <SecaoSemana
            token={token}
            detalhe={detalhe}
            editavel={editavel}
            podeGastarIa={podeGastarIa}
            onErro={onErro}
            onMudou={onMudou}
          />

          <div>
            <h3 className="mb-2 font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              Itens da rodada ({detalhe.itens.length})
            </h3>
            {detalhe.itens.length === 0 && <p className="text-sm text-muted">A rodada não guardou itens.</p>}
            <ul className="space-y-2">
              {detalhe.itens.map((i, n) => (
                <li key={i.id ?? `${n}-${i.url}`} className="text-sm">
                  {ehOrigem(i.origem) && (
                    <span
                      className="mr-1.5 inline-block rounded border border-border px-1 font-mono text-[11px] text-muted"
                      title={PAUTA_ORIGEM_ROTULOS[i.origem]}
                      aria-label={`Origem: ${PAUTA_ORIGEM_ROTULOS[i.origem]}`}
                    >
                      {i.origem}
                    </span>
                  )}
                  {i.url && !i.semLinkPublico ? (
                    <a
                      href={i.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-start gap-1 break-words text-brand hover:underline"
                    >
                      <span className="break-words">{i.titulo}</span>
                      <ExternalLink size={12} className="mt-1 shrink-0" />
                    </a>
                  ) : (
                    <span className="break-words">{i.titulo}</span>
                  )}
                  {i.semLinkPublico && <Chip>só contexto</Chip>}
                  {(i.resumo || i.porque) && (
                    <span className="block break-words text-xs text-muted">{i.resumo || i.porque}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
