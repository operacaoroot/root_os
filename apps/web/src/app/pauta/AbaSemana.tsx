'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  PAUTA_DIA_DA_SEMANA_ROTULO,
  PAUTA_FORMATO_DA_SEMANA_ROTULO,
  PAUTA_TETO_DO_A_PARTIR_DE_DIAS,
  PautaMarcarPostadaSchema,
  diaNoFuso,
  etapaDaPecaNaSemana,
  faltaNaRotinaDePublicacao,
  horaNoFuso,
  instanteNoFuso,
  somarDias,
  type PautaAgendaDaSemana,
  type PautaDistribuicao,
  type PautaFormatoDaSemana,
  PAUTA_CHAVE_DA_GRADE, PautaGradeHumanoPainelSchema, PautaGradeSalvarHumanoSchema,
  type PautaPecaNaAgenda,
} from '@mktos/shared';
import { apiBlob, apiGet, apiPost, apiPut } from '@/lib/api';
import { baixarArquivo, compartilhaArquivos, compartilharArquivos } from '@/lib/baixar';
import { Botao, Chip, inputCls } from '../referencias/ui';
import { PublicacaoNoInstagram } from './PublicacaoNoInstagram';
import { InterruptorDaAutomacao, useEdicaoHumana, ConferenciaEdicaoHumana } from './InterruptorDaAutomacao';
import { LinhaDoTempoDaPeca } from './LinhaDoTempoDaPeca';
import { AprovarASemana } from './AprovarASemana';
import { CandidatosDoCorte } from './CandidatosDoCorte';

/*
 * A SEMANA (MC16): o calendário das peças aprovadas da semana de posts. Cada
 * slot da grade da empresa mostra a peça com o que precisa para postar À MÃO —
 * copiar a legenda, baixar a mídia (o PNG e, desde a MD4, o mp4 do corte, que
 * estão no storage; o caminho no Mac quando o mp4 ainda não subiu) — e o
 * "Marcar como postada", que só registra no OS. Desde a MD6 o slot também
 * pede a publicação no Instagram pelo OS ("Publicar agora", retido até outra
 * pessoa confirmar) e mostra onde ela está; a do TikTok está em espera (MD12).
 * Desde a MD8, "Aprovar a semana" junta os posts de um episódio num lote só,
 * assinado por outra pessoa, e cada slot mostra a linha do tempo da peça.
 * Tudo no relógio de São Paulo.
 */

interface Props {
  token: string | null;
  editavel: boolean;
  /** Marcar como postada é responder pelo que foi ao ar: `pauta.publicar`. */
  podePostar: boolean;
  onErro: (m: string | null) => void;
  bump: number;
}

const TOM_DO_FORMATO: Record<PautaFormatoDaSemana, 'brand' | 'good' | 'warn'> = {
  carrossel: 'brand',
  story: 'good',
  corte: 'warn',
};

const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const quando = (iso: string) => {
  const d = new Date(iso);
  return `${diaCurto(diaNoFuso(d))} ${horaNoFuso(d)}`;
};

async function copiar(texto: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Este navegador não deixou copiar. Selecione o texto e copie à mão.');
  }
  await navigator.clipboard.writeText(texto);
}

/** O valor do `datetime-local` (relógio de São Paulo) a partir do ISO, e o caminho de volta. */
const paraOCampo = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${diaNoFuso(d)}T${horaNoFuso(d)}`;
};
const doCampo = (v: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v);
  return m ? instanteNoFuso(m[1], m[2]).toISOString() : null;
};

/** MD1: a peça que só tem o slot PROPOSTO pelo encadeamento, sem agenda de verdade. */
export function ehProposta(p: PautaPecaNaAgenda): boolean {
  return !p.agendadaPara && !p.postada && !!p.slotProposto;
}

/**
 * O slot proposto aparece em cinza e sem ação: virar agenda pede aprovar a peça
 * (na semana de posts do episódio) e distribuir — o encadeamento não aprova nada.
 * A exceção é o corte fora do lote (MD13): dá para trocar o trecho candidato
 * antes de a semana ir à assinatura.
 */
function PecaProposta({
  peca,
  editavel,
  ocupado,
  onTrocarCandidato,
}: {
  peca: PautaPecaNaAgenda;
  editavel: boolean;
  ocupado: boolean;
  onTrocarCandidato: (n: number) => void;
}) {
  return (
    <div
      className="min-w-0 flex-1 space-y-1 rounded-lg border border-dashed border-border p-2 text-muted opacity-80"
      aria-label={`${PAUTA_FORMATO_DA_SEMANA_ROTULO[peca.formato]} proposto de ${peca.apelido}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>
          {peca.lote?.estadoDoItem === 'ativo' && peca.lote.estadoDoLote !== 'ativo'
            ? 'na semana, esperando a assinatura'
            : peca.status === 'aprovada'
              ? 'proposto, falta distribuir'
              : 'proposto, falta aprovar'}
        </Chip>
        <span className="text-xs">
          {peca.apelido} · matéria {peca.itemN}
        </span>
      </div>
      <p className="break-words text-sm">{peca.titulo}</p>
      <p className="break-words text-xs">{peca.materia}</p>
      {peca.formato === 'corte' && (
        <CandidatosDoCorte candidatos={peca.candidatos} podeTrocar={editavel && !peca.lote} ocupado={ocupado} onTrocar={onTrocarCandidato} />
      )}
      <LinhaDoTempoDaPeca etapa={etapaDaPecaNaSemana(peca)} />
    </div>
  );
}

function PecaNoSlot({
  peca,
  token,
  editavel,
  podePostar,
  ocupado,
  onAcao,
  onErro,
  automatica,
  faltaNaRotina = null,
}: {
  peca: PautaPecaNaAgenda;
  token: string | null;
  editavel: boolean;
  podePostar: boolean;
  ocupado: boolean;
  onAcao: (fn: () => Promise<unknown>) => Promise<boolean>;
  onErro: (m: string | null) => void;
  automatica?: boolean;
  faltaNaRotina?: string | null;
}) {
  const [modo, setModo] = useState<'nada' | 'reagendar' | 'postar'>('nada');
  const [quandoNovo, setQuandoNovo] = useState('');
  const [url, setUrl] = useState('');
  const [copiado, setCopiado] = useState<string | null>(null);
  const aprovada = peca.status === 'aprovada';
  const rotuloDaLegenda = peca.formato === 'story' ? 'Copiar texto' : 'Copiar legenda';
  const erroDaUrl = url.trim() ? PautaMarcarPostadaSchema.safeParse({ url: url.trim() }).error?.issues[0]?.message ?? null : null;

  const copiarComo = async (rotulo: string, texto: string) => {
    onErro(null);
    try {
      await copiar(texto);
      setCopiado(rotulo);
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const nomeDaImagem = (n: number) =>
    `${peca.apelido}-m${peca.itemN}-${peca.formato === 'carrossel' ? `carrossel-${String(n).padStart(2, '0')}` : 'story'}.png`;
  const imagens = peca.midia.onde === 'storage' ? peca.midia.imagens : [];
  // Os PNG já buscados, à espera do segundo toque quando a folha de compartilhar recusou o primeiro.
  const [prontos, setProntos] = useState<File[] | null>(null);
  const [salvando, setSalvando] = useState(false);

  // O mp4 já buscado, à espera do segundo toque — o download de dezenas de MB deixa o primeiro para trás.
  const [videoPronto, setVideoPronto] = useState<File | null>(null);
  const [buscandoVideo, setBuscandoVideo] = useState(false);

  /** Como as imagens: a folha de compartilhar leva o mp4 a Fotos ou ao Instagram; sem ela, o download. */
  const salvarVideo = async () => {
    onErro(null);
    setBuscandoVideo(true);
    try {
      const arquivo =
        videoPronto ??
        new File([await apiBlob(`/pauta/pecas/${peca.id}/video/arquivo`, token)], `${peca.apelido}-m${peca.itemN}-corte.mp4`, { type: 'video/mp4' });
      if (compartilhaArquivos([arquivo])) {
        const r = await compartilharArquivos([arquivo], peca.titulo);
        setVideoPronto(r === 'precisa-de-outro-toque' ? arquivo : null);
        return;
      }
      baixarArquivo(arquivo.name, arquivo);
      setVideoPronto(null);
    } catch (e) {
      onErro(`O mp4 não baixou: ${(e as Error).message}`);
    } finally {
      setBuscandoVideo(false);
    }
  };

  const baixar = async (n: number) => {
    onErro(null);
    try {
      const blob = await apiBlob(`/pauta/pecas/${peca.id}/imagens/${n}`, token);
      baixarArquivo(nomeDaImagem(n), blob);
    } catch (e) {
      onErro(`A mídia não baixou: ${(e as Error).message}`);
    }
  };

  /**
   * Todas as imagens da peça num toque: no celular, a folha de compartilhar
   * (Salvar imagens → Fotos, ou direto no Instagram); sem ela, um download por
   * imagem.
   */
  const salvarTodas = async () => {
    onErro(null);
    setSalvando(true);
    try {
      const arquivos =
        prontos ??
        (await Promise.all(
          imagens.map(async (n) => {
            const blob = await apiBlob(`/pauta/pecas/${peca.id}/imagens/${n}`, token);
            return new File([blob], nomeDaImagem(n), { type: 'image/png' });
          }),
        ));
      if (compartilhaArquivos(arquivos)) {
        const r = await compartilharArquivos(arquivos, peca.titulo);
        setProntos(r === 'precisa-de-outro-toque' ? arquivos : null);
        return;
      }
      for (const f of arquivos) baixarArquivo(f.name, f);
      setProntos(null);
    } catch (e) {
      onErro(`A mídia não baixou: ${(e as Error).message}`);
    } finally {
      setSalvando(false);
    }
  };
  const rotuloDoSalvar = prontos
    ? `Abrir o compartilhar (${prontos.length} ${prontos.length === 1 ? 'imagem pronta' : 'imagens prontas'})`
    : imagens.length === 1
      ? 'Salvar a imagem'
      : `Salvar as ${imagens.length} imagens`;

  const reagendar = async (agendadaPara: string | null) => {
    if (await onAcao(() => apiPut(`/pauta/pecas/${peca.id}/agenda`, { agendadaPara }, token))) setModo('nada');
  };

  const postar = async () => {
    if (erroDaUrl) return;
    const corpo = url.trim() ? { url: url.trim() } : {};
    if (await onAcao(() => apiPost(`/pauta/pecas/${peca.id}/postada`, corpo, token))) {
      setModo('nada');
      setUrl('');
    }
  };

  return (
    <div className="min-w-0 flex-1 space-y-2" aria-label={`${PAUTA_FORMATO_DA_SEMANA_ROTULO[peca.formato]} de ${peca.apelido}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {peca.postada ? <Chip tone="brand">Postada</Chip> : <Chip tone="good">Aprovada</Chip>}
        {peca.palavraChave && <Chip>{peca.palavraChave}</Chip>}
        <span className="text-xs text-muted">
          {peca.apelido} · matéria {peca.itemN}
        </span>
      </div>
      <p className="break-words text-sm font-medium">{peca.titulo}</p>
      <p className="break-words text-xs text-muted">{peca.materia}</p>
      <LinhaDoTempoDaPeca etapa={etapaDaPecaNaSemana(peca)} />

      <div className="flex flex-wrap items-center gap-2">
        <Botao onClick={() => copiarComo('legenda', peca.legenda)}>{copiado === 'legenda' ? 'Copiado' : rotuloDaLegenda}</Botao>
        {peca.midia.onde === 'storage' && (
          <Botao tone={prontos ? 'brand' : undefined} onClick={salvarTodas} disabled={salvando}>
            {salvando ? 'Buscando…' : rotuloDoSalvar}
          </Botao>
        )}
      </div>
      {peca.midia.onde === 'storage' && peca.midia.esperadas > 1 && (
        <span className="flex flex-wrap items-center gap-1" aria-label="Baixar mídia">
          <span className="text-xs text-muted">Uma de cada vez:</span>
          {peca.midia.imagens.map((n) => (
            <Botao key={n} tone="ghost" onClick={() => baixar(n)} title={`Baixar a imagem ${n}`}>
              {n}
            </Botao>
          ))}
        </span>
      )}
      {peca.midia.onde === 'mac' && (
        <div className="space-y-1 text-xs">
          <p className="break-words text-warn">
            O vídeo ficou no Mac: poste de lá ou mande por AirDrop para o celular antes do horário.
          </p>
          <p className="break-all">
            <span className="text-muted">arquivo no Mac: </span>
            <span className="font-mono">{peca.midia.arquivo}</span>
          </p>
          <Botao tone="ghost" onClick={() => copiarComo('caminho', peca.midia.onde === 'mac' ? peca.midia.arquivo : '')}>
            {copiado === 'caminho' ? 'Copiado' : 'Copiar caminho'}
          </Botao>
        </div>
      )}
      {peca.midia.onde === 'video' && (
        <div className="space-y-1 text-xs">
          <p className="break-words text-muted">
            O mp4 está no OS ({Math.max(1, Math.round(peca.midia.bytes / 1024 / 1024))} MB): salve no celular e poste.
          </p>
          <Botao tone={videoPronto ? 'brand' : 'ghost'} onClick={salvarVideo} disabled={buscandoVideo}>
            {buscandoVideo ? 'Buscando…' : videoPronto ? 'Abrir o compartilhar (mp4 pronto)' : 'Salvar o mp4'}
          </Botao>
        </div>
      )}
      {peca.midia.onde === 'nenhuma' && (
        <p className="break-words text-xs text-warn">
          Sem mídia ainda — no Mac: <span className="font-mono">{peca.midia.comando}</span>
        </p>
      )}
      {peca.midia.onde === 'parcial' && (
        <p className="break-words text-xs text-warn">
          {peca.midia.imagens.length} de {peca.midia.esperadas} PNG (falta: {peca.midia.faltam.join(', ')}) — não poste ainda. Para
          completar, no Mac: <span className="font-mono">{peca.midia.comando}</span>
        </p>
      )}

      {peca.postada && (
        <p className="break-words text-xs text-muted">
          Postada em {quando(peca.postada.em)}
          {peca.postada.manual ? ' (à mão)' : ''}
          {peca.postada.url && (
            <>
              {' · '}
              <a href={peca.postada.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                ver post <ExternalLink size={11} />
              </a>
            </>
          )}
        </p>
      )}

      <PublicacaoNoInstagram
        peca={peca}
        token={token}
        podePublicar={podePostar}
        ocupado={ocupado}
        onAcao={onAcao}
        automatica={automatica}
        faltaNaRotina={faltaNaRotina}
      />

      {aprovada && editavel && peca.motivoParaNaoAgendar && <p className="break-words text-xs text-muted">{peca.motivoParaNaoAgendar}</p>}

      {modo === 'nada' && (
        <div className="flex flex-wrap gap-2">
          {aprovada && editavel && !peca.motivoParaNaoAgendar && (
            <Botao
              onClick={() => {
                setQuandoNovo(paraOCampo(peca.agendadaPara));
                setModo('reagendar');
              }}
              disabled={ocupado}
            >
              Reagendar
            </Botao>
          )}
          {aprovada && podePostar && (
            <Botao tone="brand" onClick={() => setModo('postar')} disabled={ocupado}>
              Marcar como postada
            </Botao>
          )}
          {peca.postada?.manual && !peca.postada.url && podePostar && (
            <Botao tone="ghost" onClick={() => setModo('postar')} disabled={ocupado}>
              Acrescentar o link do post
            </Botao>
          )}
        </div>
      )}

      {modo === 'reagendar' && (
        <div className="space-y-2" aria-label="Reagendar">
          <label className="block text-xs">
            <span className="mb-1 block text-muted">Novo dia e hora (horário de São Paulo)</span>
            <input type="datetime-local" className={inputCls} value={quandoNovo} onChange={(e) => setQuandoNovo(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Botao tone="brand" onClick={() => reagendar(doCampo(quandoNovo))} disabled={ocupado || !doCampo(quandoNovo)}>
              Salvar
            </Botao>
            <Botao tone="bad" onClick={() => reagendar(null)} disabled={ocupado}>
              Tirar da agenda
            </Botao>
            <Botao tone="ghost" onClick={() => setModo('nada')}>
              Cancelar
            </Botao>
          </div>
        </div>
      )}

      {modo === 'postar' && (
        <div className="space-y-2" aria-label="Marcar como postada">
          <label className="block text-xs">
            <span className="mb-1 block text-muted">Link do post (opcional)</span>
            <input className={inputCls} inputMode="url" placeholder="https://www.instagram.com/p/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          {erroDaUrl && <p className="text-xs text-bad">{erroDaUrl}</p>}
          <p className="text-[11px] text-muted">Só registra no OS que a peça foi ao ar: nada é enviado daqui.</p>
          <div className="flex flex-wrap gap-2">
            <Botao tone="brand" onClick={postar} disabled={ocupado || !!erroDaUrl || (!aprovada && !url.trim())}>
              {aprovada ? 'Confirmar' : 'Salvar link'}
            </Botao>
            <Botao tone="ghost" onClick={() => setModo('nada')}>
              Cancelar
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}

function Grade({ token, editavel, onSalvou }: { token: string | null; editavel: boolean; onErro: (m: string | null) => void; onSalvou: () => void }) {
  const [aberta, setAberta] = useState(false);
  const [iniciada, setIniciada] = useState(false);
  return <section className="rounded-lg border border-border p-3" aria-label="Grade da semana">
    <Botao tone="ghost" onClick={() => { setIniciada(true); setAberta(v => !v); }}>{aberta ? 'Fechar a grade' : 'Grade da semana'}</Botao>
    {iniciada && <div hidden={!aberta} style={{ display: aberta ? undefined : 'none' }}><GradeAberta token={token} editavel={editavel} onSalvou={onSalvou} /></div>}
  </section>;
}
function GradeAberta({ token, editavel, onSalvou }: { token: string | null; editavel: boolean; onSalvou: () => void }) {
  const editor = useEdicaoHumana({ token, path: '/pauta/agenda/grade', schema: PautaGradeHumanoPainelSchema,
    destino: p => p.destinos.grade, texto: p => p.destinos.grade.estado === 'existente' ? p.destinos.grade.conteudo.corpo : p.painel.texto, conferir: p => p.destinos.grade.chave === PAUTA_CHAVE_DA_GRADE });
  const painel = editor.atual?.painel;
  const salvar = async (reativar = false) => {
    const r = await editor.enviar({ schema: PautaGradeSalvarHumanoSchema, campos: { texto: editor.texto }, acao: 'salvar_grade', reativar });
    if (r) onSalvou();
  };
  return <div className="mt-2 space-y-2 text-xs">
    <p className="text-muted">Um formato por linha no horário de São Paulo, por exemplo: carrossel: seg, qua, sex 12:00. A grade é uma nota da memória com histórico.</p>
    {painel && <p className="text-muted">{painel.origem === 'padrao' ? 'Operação usa a grade padrão; isso não informa ausência física.' : `Grade em uso: versão ${painel.versao}.`}</p>}
    {painel?.avisos.map(a => <p key={a} className="text-warn">{a}</p>)}
    <ConferenciaEdicaoHumana editor={editor} />
    {editor.visivel && <textarea className={`${inputCls} font-mono`} rows={6} aria-label="Texto da grade" value={editor.texto}
      disabled={!editavel || editor.ocupado} onChange={e => editor.alterar(e.target.value)} />}
    {editavel && <div className="flex flex-wrap gap-2"><Botao tone="brand" onClick={() => void salvar()} disabled={!editor.editavel}>
      {editor.ocupado ? 'Salvando…' : editor.destinoBase?.estado === 'existente' && editor.destinoBase.arquivada ? 'Salvar mantendo arquivada' : 'Salvar grade'}</Botao>
      {editor.destinoBase?.estado === 'existente' && editor.destinoBase.arquivada && <Botao tone="brand" onClick={() => void salvar(true)} disabled={!editor.editavel}>Salvar e reativar</Botao>}
    </div>}
  </div>;
}

export function AbaSemana({ token, editavel, podePostar, onErro, bump }: Props) {
  const [de, setDe] = useState<string | null>(null);
  const [agenda, setAgenda] = useState<PautaAgendaDaSemana | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aPartirDe, setAPartirDe] = useState('');
  const [resultado, setResultado] = useState<{ apelido: string; r: PautaDistribuicao } | null>(null);
  const [aprovando, setAprovando] = useState<string | null>(null);
  // Na primeira carga da semana corrente a tela desce até hoje: no celular, na
  // sexta, eram uns dez slots de segunda a quinta antes do que vai ao ar agora.
  const hojeRef = useRef<HTMLElement | null>(null);
  const jaFoiAteHoje = useRef(false);

  useEffect(() => {
    if (jaFoiAteHoje.current || de !== null || !agenda || !hojeRef.current) return;
    jaFoiAteHoje.current = true;
    hojeRef.current.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [agenda, de]);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      setAgenda(await apiGet<PautaAgendaDaSemana>(`/pauta/agenda${de ? `?de=${de}` : ''}`, token));
    } catch (e) {
      onErro(`A semana não carregou: ${(e as Error).message}`);
    }
  }, [token, de, onErro]);

  useEffect(() => {
    void carregar();
  }, [carregar, bump]);

  const acao = async (chave: string, fn: () => Promise<unknown>) => {
    onErro(null);
    setOcupado(chave);
    try {
      await fn();
      await carregar();
      return true;
    } catch (e) {
      onErro((e as Error).message);
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const distribuir = async (episodioId: string, apelido: string) => {
    onErro(null);
    setOcupado(`distribuir-${episodioId}`);
    try {
      const r = await apiPost<PautaDistribuicao>(`/pauta/episodios/${episodioId}/agenda/distribuir`, aPartirDe ? { aPartirDe } : {}, token);
      setResultado({ apelido, r });
      await carregar();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  if (!agenda) return <p className="text-sm text-muted">Carregando a semana…</p>;

  const pular = (n: number) => setDe(somarDias(agenda.de, n));
  const vazia = agenda.dias.every((d) => d.linhas.every((l) => !l.peca || ehProposta(l.peca)));
  // MD8: os episódios com post desta semana ainda por sair — é deles o "Aprovar a semana".
  const daSemana = new Map<string, { apelido: string; posts: number }>();
  for (const d of agenda.dias) {
    for (const l of d.linhas) {
      if (!l.peca || l.peca.status === 'publicada' || l.peca.postada) continue;
      const atual = daSemana.get(l.peca.episodioId) ?? { apelido: l.peca.apelido, posts: 0 };
      daSemana.set(l.peca.episodioId, { ...atual, posts: atual.posts + 1 });
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        As peças da semana de posts, nos slots da grade. Cada slot entrega a legenda e a mídia para postar à mão, ou sai pelo OS
        no horário depois de outra pessoa assinar a semana. A publicação no TikTok está em espera.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Botao tone="ghost" onClick={() => pular(-7)}>
          ‹ Anterior
        </Botao>
        <span className="text-sm font-medium" aria-label="Semana">
          {diaCurto(agenda.de)} – {diaCurto(agenda.ate)}
        </span>
        <Botao tone="ghost" onClick={() => pular(7)}>
          Próxima ›
        </Botao>
        {de && (
          <Botao tone="ghost" onClick={() => setDe(null)}>
            Esta semana
          </Botao>
        )}
      </div>

      {agenda.paraDistribuir.length > 0 && (
        <section className="space-y-2 rounded-lg border border-border bg-surface-2 p-3" aria-label="Para distribuir">
          <p className="text-sm font-medium">Aprovadas sem data</p>
          <label className="block text-xs">
            <span className="mb-1 block text-muted">A partir de (vazio = a partir de agora)</span>
            <input
              type="date"
              className={inputCls}
              min={agenda.hoje}
              max={somarDias(agenda.hoje, PAUTA_TETO_DO_A_PARTIR_DE_DIAS)}
              value={aPartirDe}
              onChange={(e) => setAPartirDe(e.target.value)}
            />
          </label>
          {agenda.paraDistribuir.map((e) => (
            <div key={e.episodioId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 break-words">
                <span className="font-mono text-xs">{e.apelido}</span> · {e.titulo} ·{' '}
                <span className="text-muted">{e.aprovadasSemData} peça(s)</span>
              </span>
              {e.motivo ? (
                <span className="text-xs text-muted">{e.motivo}</span>
              ) : (
                <Botao tone="brand" onClick={() => distribuir(e.episodioId, e.apelido)} disabled={!editavel || ocupado !== null}>
                  {ocupado === `distribuir-${e.episodioId}` ? 'Distribuindo…' : 'Distribuir'}
                </Botao>
              )}
            </div>
          ))}
        </section>
      )}

      {daSemana.size > 0 && (
        <section className="space-y-2 rounded-lg border border-border p-3" aria-label="Aprovar a semana">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">Aprovar a semana</p>
          </div>
          <InterruptorDaAutomacao
            qual="publicacao"
            ligada={agenda.publicacaoAutomatica}
            rotina={agenda.rotinaDePublicacao}
            token={token}
            podeMudar={podePostar}
            onMudou={() => void carregar()}
            onErro={onErro}
          />
          <InterruptorDaAutomacao
            qual="dm"
            ligada={agenda.dmAutomatica}
            podeLigar={agenda.dmPodeLigar ?? false}
            token={token}
            podeMudar={podePostar}
            onMudou={() => void carregar()}
            onErro={onErro}
          />
          {[...daSemana].map(([episodioId, e]) => (
            <div key={episodioId} className="space-y-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">{e.apelido}</span>
                <span className="text-xs text-muted">{e.posts} post(s) nesta semana</span>
                <Botao tone={aprovando === episodioId ? 'ghost' : 'brand'} onClick={() => setAprovando(aprovando === episodioId ? null : episodioId)}>
                  {aprovando === episodioId ? 'Fechar' : 'Aprovar a semana'}
                </Botao>
              </div>
              {aprovando === episodioId && (
                <AprovarASemana episodioId={episodioId} token={token} podePublicar={podePostar} onErro={onErro} onMudou={() => void carregar()} />
              )}
            </div>
          ))}
        </section>
      )}

      {resultado && (
        <div className="space-y-1 text-xs" aria-label="Resultado da distribuição">
          <p className="text-muted">
            {resultado.apelido}: {resultado.r.conta.alocadas} agendada(s) agora · {resultado.r.conta.jaAgendadas} já tinha(m) data
            {resultado.r.conta.semVaga > 0 ? ` · ${resultado.r.conta.semVaga} sem slot livre` : ''}
          </p>
          {resultado.r.avisos.map((a) => (
            <p key={a} className="break-words text-warn">
              {a}
            </p>
          ))}
        </div>
      )}

      {vazia && !agenda.paraDistribuir.length && (
        <p className="text-sm text-muted">Nada agendado nesta semana. Aprove as peças na semana de posts do episódio e distribua aqui.</p>
      )}

      <div className="space-y-3">
        {agenda.dias.map((d) => (
          <section
            key={d.dia}
            ref={d.dia === agenda.hoje ? hojeRef : undefined}
            className="scroll-mt-4 rounded-lg border border-border p-3"
            aria-label={`${PAUTA_DIA_DA_SEMANA_ROTULO[d.diaDaSemana]} ${diaCurto(d.dia)}`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">
                {PAUTA_DIA_DA_SEMANA_ROTULO[d.diaDaSemana]} {diaCurto(d.dia)}
              </h3>
              {d.dia === agenda.hoje && <Chip tone="brand">hoje</Chip>}
              {d.feriado && <span className="text-xs text-muted">{d.feriado} — sem slot</span>}
            </div>
            {!d.linhas.length && <p className="text-xs text-muted">—</p>}
            <ul className="space-y-2">
              {d.linhas.map((l) => (
                <li key={`${l.em}-${l.formato}-${l.peca?.id ?? 'vago'}`} className="flex flex-col gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0 sm:flex-row">
                  <div className="flex shrink-0 items-center gap-2 sm:w-32 sm:flex-col sm:items-start">
                    <span className="font-mono text-sm">{l.hora}</span>
                    <Chip tone={TOM_DO_FORMATO[l.formato]}>{PAUTA_FORMATO_DA_SEMANA_ROTULO[l.formato]}</Chip>
                    {!l.daGrade && <span className="text-[10px] text-muted">fora da grade</span>}
                  </div>
                  {l.peca && ehProposta(l.peca) ? (
                    <PecaProposta
                      peca={l.peca}
                      editavel={editavel}
                      ocupado={ocupado !== null}
                      onTrocarCandidato={(n) => void acao(l.peca!.id, () => apiPut(`/pauta/pecas/${l.peca!.id}/semana`, { candidato: n }, token))}
                    />
                  ) : l.peca ? (
                    <PecaNoSlot
                      peca={l.peca}
                      token={token}
                      editavel={editavel}
                      podePostar={podePostar}
                      ocupado={ocupado !== null}
                      onAcao={(fn) => acao(l.peca!.id, fn)}
                      onErro={onErro}
                      automatica={agenda.publicacaoAutomatica}
                      faltaNaRotina={faltaNaRotinaDePublicacao(agenda.rotinaDePublicacao)}
                    />
                  ) : (
                    <p className="text-xs text-muted">vago</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Grade token={token} editavel={editavel} onErro={onErro} onSalvou={() => void carregar()} />
    </div>
  );
}
