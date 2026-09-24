'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  PAUTA_DIA_DA_SEMANA_ROTULO,
  PAUTA_FORMATO_DA_SEMANA_ROTULO,
  PAUTA_TETO_DO_A_PARTIR_DE_DIAS,
  PautaMarcarPostadaSchema,
  diaNoFuso,
  horaNoFuso,
  instanteNoFuso,
  somarDias,
  type PautaAgendaDaSemana,
  type PautaDistribuicao,
  type PautaFormatoDaSemana,
  type PautaGradePainel,
  type PautaPecaNaAgenda,
} from '@mktos/shared';
import { apiBlob, apiGet, apiPost, apiPut } from '@/lib/api';
import { Botao, Chip, inputCls } from '../referencias/ui';

/*
 * A SEMANA (MC16): o calendário das peças aprovadas da semana de posts. Cada
 * slot da grade da empresa mostra a peça com o que precisa para postar À MÃO —
 * copiar a legenda, baixar a mídia (o PNG que está no storage) ou o caminho do
 * mp4 que ficou no Mac — e o "Marcar como postada", que só registra no OS. A
 * publicação automática no Instagram/TikTok é a MC17 (D-MC8). Tudo no relógio
 * de São Paulo.
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

function baixarBlob(nome: string, blob: Blob) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Este navegador não deixou baixar o arquivo.');
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

function PecaNoSlot({
  peca,
  token,
  editavel,
  podePostar,
  ocupado,
  onAcao,
  onErro,
}: {
  peca: PautaPecaNaAgenda;
  token: string | null;
  editavel: boolean;
  podePostar: boolean;
  ocupado: boolean;
  onAcao: (fn: () => Promise<unknown>) => Promise<boolean>;
  onErro: (m: string | null) => void;
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

  const baixar = async (n: number) => {
    onErro(null);
    try {
      const blob = await apiBlob(`/pauta/pecas/${peca.id}/imagens/${n}`, token);
      const sufixo = peca.formato === 'carrossel' ? `carrossel-${String(n).padStart(2, '0')}` : 'story';
      baixarBlob(`${peca.apelido}-m${peca.itemN}-${sufixo}.png`, blob);
    } catch (e) {
      onErro(`A mídia não baixou: ${(e as Error).message}`);
    }
  };

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

      <div className="flex flex-wrap items-center gap-2">
        <Botao onClick={() => copiarComo('legenda', peca.legenda)}>{copiado === 'legenda' ? 'Copiado' : rotuloDaLegenda}</Botao>
        {peca.midia.onde === 'storage' &&
          (peca.midia.esperadas === 1 ? (
            <Botao onClick={() => baixar(peca.midia.onde === 'storage' ? peca.midia.imagens[0] : 1)}>Baixar mídia</Botao>
          ) : (
            <span className="flex flex-wrap items-center gap-1" aria-label="Baixar mídia">
              <span className="text-xs text-muted">Baixar mídia:</span>
              {peca.midia.imagens.map((n) => (
                <Botao key={n} tone="ghost" onClick={() => baixar(n)}>
                  {n}
                </Botao>
              ))}
            </span>
          ))}
      </div>
      {peca.midia.onde === 'mac' && (
        <div className="space-y-1 text-xs">
          <p className="break-all">
            <span className="text-muted">arquivo no Mac: </span>
            <span className="font-mono">{peca.midia.arquivo}</span>
          </p>
          <Botao tone="ghost" onClick={() => copiarComo('caminho', peca.midia.onde === 'mac' ? peca.midia.arquivo : '')}>
            {copiado === 'caminho' ? 'Copiado' : 'Copiar caminho'}
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

function Grade({ token, editavel, onErro, onSalvou }: { token: string | null; editavel: boolean; onErro: (m: string | null) => void; onSalvou: () => void }) {
  const [painel, setPainel] = useState<PautaGradePainel | null>(null);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [aberta, setAberta] = useState(false);

  const alternar = async () => {
    const abrir = !aberta;
    setAberta(abrir);
    if (!abrir || painel || !token) return;
    try {
      const p = await apiGet<PautaGradePainel>('/pauta/agenda/grade', token);
      setPainel(p);
      setTexto(p.texto);
    } catch (e) {
      onErro(`A grade não carregou: ${(e as Error).message}`);
    }
  };

  const salvar = async () => {
    onErro(null);
    setSalvando(true);
    try {
      const p = await apiPut<PautaGradePainel>('/pauta/agenda/grade', { texto, ...(painel?.versao ? { versao: painel.versao } : {}) }, token);
      setPainel(p);
      setTexto(p.texto);
      onSalvou();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="rounded-lg border border-border p-3" aria-label="Grade da semana">
      <Botao tone="ghost" onClick={alternar}>
        {aberta ? 'Fechar a grade' : 'Grade da semana'}
      </Botao>
      {aberta && (
      <div className="mt-2 space-y-2 text-xs">
        <p className="text-muted">
          Um formato por linha, no horário de São Paulo — por exemplo <span className="font-mono">carrossel: seg, qua, sex 12:00</span>,{' '}
          <span className="font-mono">story: dias úteis 9h</span>. Feriado nacional não tem slot; os da empresa entram em{' '}
          <span className="font-mono">feriados: 20/01/2027</span>. A grade é uma nota da memória, com histórico.
        </p>
        {painel && <p className="text-muted">{painel.origem === 'padrao' ? 'Valendo a grade padrão.' : `Nota da empresa, versão ${painel.versao}.`}</p>}
        {painel?.avisos.map((a) => (
          <p key={a} className="text-warn">
            {a}
          </p>
        ))}
        <textarea
          className={`${inputCls} font-mono`}
          rows={6}
          aria-label="Texto da grade"
          value={texto}
          readOnly={!editavel}
          onChange={(e) => setTexto(e.target.value)}
        />
        {editavel && (
          <Botao tone="brand" onClick={salvar} disabled={salvando || !painel}>
            {salvando ? 'Salvando…' : 'Salvar grade'}
          </Botao>
        )}
      </div>
      )}
    </section>
  );
}

export function AbaSemana({ token, editavel, podePostar, onErro, bump }: Props) {
  const [de, setDe] = useState<string | null>(null);
  const [agenda, setAgenda] = useState<PautaAgendaDaSemana | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aPartirDe, setAPartirDe] = useState('');
  const [resultado, setResultado] = useState<{ apelido: string; r: PautaDistribuicao } | null>(null);

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
  const vazia = agenda.dias.every((d) => d.linhas.every((l) => !l.peca));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        As peças aprovadas da semana de posts, nos slots da grade. Cada slot entrega a legenda e a mídia para postar à mão — a
        publicação automática no Instagram e no TikTok espera a aprovação da Meta (D-MC8).
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
          <section key={d.dia} className="rounded-lg border border-border p-3" aria-label={`${PAUTA_DIA_DA_SEMANA_ROTULO[d.diaDaSemana]} ${diaCurto(d.dia)}`}>
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
                  {l.peca ? (
                    <PecaNoSlot
                      peca={l.peca}
                      token={token}
                      editavel={editavel}
                      podePostar={podePostar}
                      ocupado={ocupado !== null}
                      onAcao={(fn) => acao(l.peca!.id, fn)}
                      onErro={onErro}
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
