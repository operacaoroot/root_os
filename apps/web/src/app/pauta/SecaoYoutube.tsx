'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ENVIO_AO_YOUTUBE_ESTADO_ROTULO,
  LOTE_ESTADO_ROTULO,
  YOUTUBE_AUDITORIA_ROTULO,
  diaNoFuso,
  horaNoFuso,
  instanteNoFuso,
  type PautaThumbDoPacote,
  type PautaYoutubeDoEpisodio,
} from '@mktos/shared';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { Botao, Chip } from '../referencias/ui';

/*
 * O VÍDEO NO YOUTUBE (MD10), no detalhe do episódio, logo abaixo do pacote.
 *
 * Aqui se escolhe a thumb que sobe e o horário do vídeo — o que, com o título e
 * a descrição do pacote e o vídeo final que o Mac declarou, entra no lote da
 * semana que a titular assina. Os bytes vão do Mac direto ao YouTube
 * (`root-midia youtube ep-NN`), sempre privados; o horário (`publishAt`) é
 * mandado pela rotina de publicação com a semana assinada e a auditoria do
 * projeto aprovada.
 */

interface Props {
  token: string | null;
  episodioId: string;
  apelido: string;
  thumbs: PautaThumbDoPacote[];
  editavel: boolean;
  /** `pauta.publicar`: conectar o canal. */
  podeConectar: boolean;
  onErro: (m: string | null) => void;
  /** Para onde o navegador vai com a URL do Google. Parâmetro só para a suíte, que não navega. */
  navegar?: (url: string) => void;
}

const TEXTO_DO_RETORNO: Record<string, string> = {
  ok: 'Canal do YouTube conectado.',
  ok_testing:
    'Canal conectado, mas a tela de consentimento do Google está em Testing: a autorização vence em 7 dias. Ponha o app em produção (ou Internal) e conecte de novo.',
  escopo_incompleto: 'O Google não concedeu as duas permissões (enviar e gerenciar vídeos). Conecte de novo e aceite as duas.',
  sem_refresh: 'O Google não devolveu a autorização de longo prazo. Remova o acesso do app na conta Google e conecte de novo.',
  cancelado: 'A autorização foi cancelada na tela do Google. Nada mudou.',
  expirado: 'O pedido de conexão expirou. Tente de novo.',
  sem_credencial: 'Falta a credencial do projeto do YouTube no servidor (YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET).',
  erro: 'Não deu para concluir a conexão com o YouTube.',
};

const TOM_DO_ENVIO: Record<string, 'good' | 'warn' | 'bad' | 'brand' | 'muted'> = {
  declarado: 'muted',
  sessao_aberta: 'brand',
  conferido: 'good',
  agendado: 'good',
  erro: 'bad',
};

const quando = (iso: string) => {
  const d = new Date(iso);
  const dia = diaNoFuso(d);
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)} ${horaNoFuso(d)}`;
};

/** O valor do `<input type="datetime-local">` no relógio de São Paulo. */
const paraOCampo = (iso: string | null) => (iso ? `${diaNoFuso(new Date(iso))}T${horaNoFuso(new Date(iso))}` : '');

/** O que o retorno do OAuth do YouTube (`/pauta?youtube=<motivo>`) diz a quem conectou. */
export function AvisoDoYoutube({ motivo }: { motivo: string }) {
  const bom = motivo === 'ok';
  return (
    <p
      role="status"
      className={`break-words rounded-lg border px-3 py-2 text-sm ${bom ? 'border-good/40 bg-good/10 text-good' : 'border-warn/40 bg-warn/10 text-warn'}`}
    >
      {TEXTO_DO_RETORNO[motivo] ?? TEXTO_DO_RETORNO.erro}
    </p>
  );
}

function ehYoutube(x: unknown): x is PautaYoutubeDoEpisodio {
  return !!x && typeof x === 'object' && Array.isArray((x as PautaYoutubeDoEpisodio).faltas);
}

export function SecaoYoutube({ token, episodioId, apelido, thumbs, editavel, podeConectar, onErro, navegar = (u) => window.location.assign(u) }: Props) {
  const [yt, setYt] = useState<PautaYoutubeDoEpisodio | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [campo, setCampo] = useState('');

  const aplicar = useCallback((r: unknown) => {
    if (!ehYoutube(r)) {
      setFalhou(true);
      return;
    }
    setFalhou(false);
    setYt(r);
    setCampo(paraOCampo(r.publicarEm));
  }, []);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      aplicar(await apiGet<unknown>(`/pauta/episodios/${episodioId}/youtube`, token));
    } catch {
      setFalhou(true);
    }
  }, [token, episodioId, aplicar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const escrever = async (qual: string, fn: () => Promise<unknown>) => {
    onErro(null);
    setOcupado(qual);
    try {
      aplicar(await fn());
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const escolherThumb = (n: number | null) => escrever('thumb', () => apiPut(`/pauta/episodios/${episodioId}/pacote/thumb`, { n }, token));

  const salvarHorario = (limpar = false) => {
    const [dia, hora] = campo.split('T');
    if (!limpar && (!dia || !hora)) {
      onErro('Escolha o dia e a hora do vídeo.');
      return;
    }
    const publicarEm = limpar ? null : instanteNoFuso(dia, hora).toISOString();
    void escrever('horario', () => apiPut(`/pauta/episodios/${episodioId}/pacote/horario`, { publicarEm }, token));
  };

  const conectar = async () => {
    onErro(null);
    setOcupado('conectar');
    try {
      const r = await apiPost<{ tipo: string; url?: string; instrucao?: string; detalhe?: string; motivo?: string }>('/pauta/youtube/conectar', {}, token);
      if (r.tipo === 'redirecionar' && r.url) {
        navegar(r.url);
        return;
      }
      onErro(r.instrucao ?? r.detalhe ?? r.motivo ?? 'O YouTube não abriu a autorização.');
    } catch (e) {
      onErro((e as Error).message);
    }
    setOcupado(null);
  };

  const envio = yt?.envio ?? null;
  const agendado = envio?.estado === 'agendado';
  const podeMexer = editavel && !agendado && ocupado === null;
  const auditoriaTom = yt?.auditoria === 'aprovada' ? 'good' : 'warn';

  return (
    <section className="space-y-3 rounded-lg border border-border p-3" aria-label="YouTube">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">YouTube</h3>
        {yt && <Chip tone={yt.conectado ? 'good' : 'muted'}>{yt.conectado ? 'canal conectado' : 'canal não conectado'}</Chip>}
        {yt && <Chip tone={auditoriaTom}>{YOUTUBE_AUDITORIA_ROTULO[yt.auditoria]}</Chip>}
        {envio && <Chip tone={TOM_DO_ENVIO[envio.estado] ?? 'muted'}>{ENVIO_AO_YOUTUBE_ESTADO_ROTULO[envio.estado]}</Chip>}
      </div>

      {falhou && <p className="text-xs text-muted">O estado do YouTube não carregou.</p>}

      <p className="text-xs text-muted">
        O vídeo sobe do Mac, direto ao YouTube e sempre privado (<code className="break-all">root-midia youtube {apelido}</code>). O
        OS só abre o envio com a semana assinada, e o horário é marcado pela rotina de publicação.
      </p>

      {yt && (
        <>
          <fieldset className="space-y-1" disabled={!podeMexer}>
            <legend className="text-sm font-medium">Thumb que sobe</legend>
            {thumbs.length === 0 && <p className="text-xs text-muted">O pacote ainda não tem thumbs.</p>}
            <div className="flex flex-wrap gap-2">
              {thumbs.map((t) => (
                <label key={t.n} className="flex min-w-0 items-center gap-1.5 rounded border border-border px-2 py-1 text-sm">
                  <input type="radio" name={`thumb-${episodioId}`} checked={yt.thumbEscolhida === t.n} onChange={() => void escolherThumb(t.n)} />
                  <span className="break-words">
                    {t.n}. {t.texto}
                  </span>
                  {!t.imagem && <span className="text-xs text-warn">(sem imagem)</span>}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor={`horario-${episodioId}`}>
              Horário do vídeo (São Paulo)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={`horario-${episodioId}`}
                type="datetime-local"
                className="min-w-0 rounded border border-border bg-surface px-2 py-1 text-sm"
                value={campo}
                onChange={(e) => setCampo(e.target.value)}
                disabled={!podeMexer}
              />
              <Botao onClick={() => salvarHorario()} disabled={!podeMexer || !campo}>
                {ocupado === 'horario' ? 'Salvando…' : 'Salvar horário'}
              </Botao>
              {yt.publicarEm && (
                <Botao tone="ghost" onClick={() => salvarHorario(true)} disabled={!podeMexer}>
                  Tirar
                </Botao>
              )}
            </div>
            {yt.publicarEm && <p className="text-xs text-muted">Vai ao ar {quando(yt.publicarEm)}.</p>}
          </div>

          <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Título</dt>
            <dd className="break-words">{yt.tituloEscolhido ?? <span className="text-warn">nenhum marcado no pacote</span>}</dd>
            <dt className="text-muted">Vídeo final</dt>
            <dd className="break-words">
              {envio ? (
                <>
                  {Math.round(envio.bytes / 1024 / 1024)} MB · sha256 <code>{envio.sha256.slice(0, 12)}</code>
                </>
              ) : (
                <span className="text-warn">não declarado pelo Mac</span>
              )}
            </dd>
            {envio?.videoId && (
              <>
                <dt className="text-muted">No YouTube</dt>
                <dd className="break-all">
                  {yt.url ? (
                    <a className="text-brand underline" href={yt.url} target="_blank" rel="noreferrer">
                      {yt.url}
                    </a>
                  ) : (
                    <>
                      <code>{envio.videoId}</code> <span className="text-muted">(privado)</span>
                    </>
                  )}
                </dd>
              </>
            )}
            {envio?.sessaoExpiraEm && (
              <>
                <dt className="text-muted">Sessão de envio</dt>
                <dd>
                  aberta, vale até {quando(envio.sessaoExpiraEm)} ({envio.sessoes} aberta(s))
                </dd>
              </>
            )}
          </dl>

          {envio?.erro && <p className="break-words text-xs text-bad">{envio.erro}</p>}

          {yt.itens.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted" aria-label="Itens do YouTube no lote">
              {yt.itens.map((i) => (
                <li key={i.itemId} className="break-words">
                  {i.capabilityId === 'youtube.video.enviar' ? 'Envio privado' : 'Agendamento'}: lote {LOTE_ESTADO_ROTULO[i.estadoDoLote] ?? i.estadoDoLote}, até {quando(i.janelaAte)}
                </li>
              ))}
            </ul>
          )}

          {yt.faltas.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Para o YouTube entrar na semana:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-warn">
                {yt.faltas.map((f) => (
                  <li key={f} className="break-words">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {podeConectar && !yt.conectado && (
            <Botao tone="brand" onClick={conectar} disabled={ocupado !== null}>
              {ocupado === 'conectar' ? 'Abrindo o Google…' : 'Conectar o canal'}
            </Botao>
          )}
        </>
      )}
    </section>
  );
}
