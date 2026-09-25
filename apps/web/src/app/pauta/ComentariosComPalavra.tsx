'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  PAUTA_DM_TETO_BYTES,
  PAUTA_FORMATO_DA_SEMANA_ROTULO,
  PautaTextoDaDmSchema,
  bytesUtf8,
  diaNoFuso,
  horaNoFuso,
  perfilDoInstagram,
  type PautaComentarioNaFila,
  type PautaFilaDeComentarios,
  type PautaTextoDaDm,
} from '@mktos/shared';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { Botao, Chip, inputCls } from '../referencias/ui';

/*
 * MD9: "QUEM COMENTOU E O QUE RESPONDER", na aba Semana.
 *
 * O carrossel e o corte fecham com "comentário com a PALAVRA → o link da
 * matéria e o episódio completo chegam no direct". Até a DM automática (MD11,
 * depois do App Review), a resposta é à mão: a rotina `pauta.coletar-comentarios`
 * lê os comentários dos posts dos últimos 7 dias e põe aqui quem comentou a
 * palavra, com o texto pronto (o /r/ rastreado da matéria e a página do
 * episódio). Copiar, abrir o perfil, mandar pelo Instagram e marcar como
 * respondido. O @ some depois de 7 dias; o texto do comentário nunca é guardado.
 */

interface Props {
  token: string | null;
  /** `pauta.publicar`: marcar como respondido é responder pelo que a marca disse. */
  podeResponder: boolean;
  /** `pauta.editar`: preparar e editar o texto da DM. */
  editavel: boolean;
  onErro: (m: string | null) => void;
  bump: number;
}

const quando = (iso: string) => {
  const d = new Date(iso);
  const dia = diaNoFuso(d);
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)} ${horaNoFuso(d)}`;
};

async function copiar(texto: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Este navegador não deixou copiar. Selecione o texto e copie à mão.');
  }
  await navigator.clipboard.writeText(texto);
}

function ehFila(x: unknown): x is PautaFilaDeComentarios {
  return !!x && typeof x === 'object' && Array.isArray((x as PautaFilaDeComentarios).linhas) && Array.isArray((x as PautaFilaDeComentarios).textos);
}

function LinhaDaFila({
  linha,
  podeResponder,
  ocupado,
  onCopiar,
  onResponder,
}: {
  linha: PautaComentarioNaFila;
  podeResponder: boolean;
  ocupado: boolean;
  onCopiar: (texto: string) => void;
  onResponder: () => void;
}) {
  const perfil = perfilDoInstagram(linha.usuario);
  const venceu = new Date(linha.expiraEm) <= new Date();
  return (
    <li className="space-y-1.5 border-t border-border pt-2 first:border-t-0 first:pt-0" aria-label={`Comentário de ${linha.usuario ? `@${linha.usuario}` : 'pessoa apagada'}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 break-all font-medium">{linha.usuario ? `@${linha.usuario}` : '@ apagado depois de 7 dias'}</span>
        <Chip tone="brand">{linha.palavra}</Chip>
        {linha.respondidoEm ? <Chip tone="good">respondido</Chip> : venceu ? <Chip tone="warn">passou dos 7 dias</Chip> : <Chip tone="warn">esperando a DM</Chip>}
      </div>
      <p className="break-words text-xs text-muted">
        {linha.apelido} · {PAUTA_FORMATO_DA_SEMANA_ROTULO[linha.formato] ?? linha.formato} · matéria {linha.itemN} · {linha.tituloDaPeca}
      </p>
      <p className="text-xs text-muted">
        comentou em {quando(linha.comentadoEm)}
        {!linha.respondidoEm && !venceu && ` · responder até ${quando(linha.expiraEm)}`}
        {linha.respondidoEm && ` · respondido${linha.respondidoPor ? ` por ${linha.respondidoPor}` : ''} em ${quando(linha.respondidoEm)}`}
      </p>
      {linha.motivo && <p className="break-words text-xs text-warn">{linha.motivo}</p>}
      <div className="flex flex-wrap gap-2">
        <Botao onClick={() => linha.texto && onCopiar(linha.texto)} disabled={!linha.texto}>
          Copiar texto
        </Botao>
        {perfil && (
          <a
            href={perfil}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-border px-3 text-sm"
          >
            Abrir perfil <ExternalLink size={14} aria-hidden />
          </a>
        )}
        {podeResponder && !linha.respondidoEm && (
          <Botao tone="brand" onClick={onResponder} disabled={ocupado}>
            Marquei como respondido
          </Botao>
        )}
      </div>
    </li>
  );
}

function TextoDaMateria({
  t,
  editavel,
  ocupado,
  onCopiar,
  onSalvar,
}: {
  t: PautaTextoDaDm;
  editavel: boolean;
  ocupado: boolean;
  onCopiar: (texto: string) => void;
  onSalvar: (texto: string | null) => Promise<boolean>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState('');
  const bytes = bytesUtf8(rascunho.trim());
  const erro = editando ? (PautaTextoDaDmSchema.safeParse({ texto: rascunho }).error?.issues[0]?.message ?? null) : null;

  return (
    <li className="space-y-1.5 border-t border-border pt-2 first:border-t-0 first:pt-0" aria-label={`Texto da DM de ${t.apelido} matéria ${t.itemN}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs">{t.apelido}</span>
        <span className="text-xs text-muted">matéria {t.itemN}</span>
        <Chip tone="brand">{t.palavra}</Chip>
        {t.editado && <Chip>editado</Chip>}
      </div>
      <p className="break-words text-xs text-muted">{t.materia}</p>
      {t.motivo && <p className="break-words text-xs text-warn">{t.motivo}</p>}
      {t.texto && !editando && (
        <>
          <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 font-sans text-sm">{t.texto}</pre>
          <p className="text-[11px] text-muted">
            {t.bytes} de {PAUTA_DM_TETO_BYTES} bytes
          </p>
          {t.checagem && !t.checagem.aprovada && (
            <ul className="space-y-0.5 text-xs text-warn" aria-label="Checagem anti-slop">
              {t.checagem.apontamentos.map((a) => (
                <li key={`${a.regra}-${a.trecho}-${a.onde}`} className="break-words">
                  {a.trecho} ({a.onde})
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Botao onClick={() => onCopiar(t.texto!)}>Copiar texto</Botao>
            {editavel && (
              <Botao
                tone="ghost"
                onClick={() => {
                  setRascunho(t.texto ?? '');
                  setEditando(true);
                }}
              >
                Editar
              </Botao>
            )}
            {editavel && t.editado && (
              <Botao tone="ghost" onClick={() => void onSalvar(null)} disabled={ocupado}>
                Voltar ao padrão
              </Botao>
            )}
          </div>
        </>
      )}
      {editando && (
        <div className="space-y-1">
          <textarea className={inputCls} rows={6} aria-label="Texto da DM" value={rascunho} onChange={(e) => setRascunho(e.target.value)} />
          <p className={`text-[11px] ${bytes > PAUTA_DM_TETO_BYTES ? 'text-bad' : 'text-muted'}`}>
            {bytes} de {PAUTA_DM_TETO_BYTES} bytes (a Meta conta bytes: cada acento vale 2)
          </p>
          {erro && <p className="text-xs text-bad">{erro}</p>}
          <div className="flex flex-wrap gap-2">
            <Botao
              tone="brand"
              disabled={ocupado || !!erro}
              onClick={async () => {
                if (await onSalvar(rascunho)) setEditando(false);
              }}
            >
              Salvar texto
            </Botao>
            <Botao tone="ghost" onClick={() => setEditando(false)} disabled={ocupado}>
              Cancelar
            </Botao>
          </div>
        </div>
      )}
    </li>
  );
}

export function ComentariosComPalavra({ token, podeResponder, editavel, onErro, bump }: Props) {
  const [fila, setFila] = useState<PautaFilaDeComentarios | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiGet<unknown>('/pauta/comentarios', token);
      setFila(ehFila(r) ? r : null);
      setFalhou(!ehFila(r));
    } catch {
      setFalhou(true);
    }
  }, [token]);

  useEffect(() => {
    void carregar();
  }, [carregar, bump]);

  const fazer = async (fn: () => Promise<unknown>) => {
    onErro(null);
    setOcupado(true);
    try {
      await fn();
      await carregar();
      return true;
    } catch (e) {
      onErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const aoCopiar = async (texto: string) => {
    onErro(null);
    try {
      await copiar(texto);
      setCopiado('Texto copiado. Cole no direct pelo Instagram.');
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  // "Preparar" cria o link que falta e refaz o que mudou de destino: as duas frases da API citam o botão.
  const episodiosSemLink = [...new Set((fila?.textos ?? []).filter((t) => t.motivo?.includes('Preparar')).map((t) => t.episodioId))];

  return (
    <section className="space-y-3 rounded-lg border border-border p-3" aria-label="Quem comentou e o que responder">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Quem comentou e o que responder</h3>
        {fila && fila.pendentes > 0 && <Chip tone="warn">{fila.pendentes} esperando a DM</Chip>}
      </div>
      <p className="text-xs text-muted">
        Quem comentou a palavra-chave num post dos últimos 7 dias. A DM sai à mão: copie o texto, abra o perfil, mande pelo
        Instagram e marque como respondido. O @ some depois de 7 dias, e o texto do comentário não é guardado.
      </p>

      {falhou && <p className="text-xs text-muted">A fila de comentários não carregou.</p>}
      {copiado && (
        <p role="status" className="text-xs text-good">
          {copiado}
        </p>
      )}

      {fila && !fila.conta.podeLerComentarios && (
        <p className="text-xs text-warn">
          {fila.conta.handle
            ? 'A conta de publicação não concedeu a leitura de comentários: reconecte na Conta de publicação, acima.'
            : 'Sem conta de publicação do Instagram: conecte na Conta de publicação, acima.'}
        </p>
      )}
      {fila && (
        <p className="break-words text-xs text-muted">
          {fila.ultimaColeta
            ? `Última leitura: ${quando(fila.ultimaColeta.em)} (${fila.ultimaColeta.status})${fila.ultimaColeta.resumo ? ` — ${fila.ultimaColeta.resumo}` : ''}`
            : 'A rotina de comentários ainda não rodou: crie em Rotinas › "Nova rotina de comentários".'}
        </p>
      )}

      {fila && fila.linhas.length > 0 ? (
        <ul className="space-y-2">
          {fila.linhas.map((l) => (
            <LinhaDaFila
              key={l.id}
              linha={l}
              podeResponder={podeResponder}
              ocupado={ocupado}
              onCopiar={(t) => void aoCopiar(t)}
              onResponder={() => void fazer(() => apiPost(`/pauta/comentarios/${l.id}/respondido`, {}, token))}
            />
          ))}
        </ul>
      ) : (
        fila && <p className="text-xs text-muted">Ninguém comentou a palavra nos últimos 7 dias.</p>
      )}

      {fila && fila.textos.length > 0 && (
        <details className="rounded-lg border border-border p-2">
          <summary className="cursor-pointer text-sm font-medium">Texto da DM por matéria ({fila.textos.length})</summary>
          {editavel &&
            episodiosSemLink.map((id) => (
              <div key={id} className="mt-2">
                <Botao tone="brand" onClick={() => void fazer(() => apiPost(`/pauta/episodios/${id}/dm/preparar`, {}, token))} disabled={ocupado}>
                  Preparar os textos da DM ({fila.textos.find((t) => t.episodioId === id)?.apelido})
                </Botao>
              </div>
            ))}
          <ul className="mt-2 space-y-2">
            {fila.textos.map((t) => (
              <TextoDaMateria
                key={`${t.episodioId}-${t.itemId}`}
                t={t}
                editavel={editavel}
                ocupado={ocupado}
                onCopiar={(x) => void aoCopiar(x)}
                onSalvar={(texto) => fazer(() => apiPut(`/pauta/episodios/${t.episodioId}/dm/${encodeURIComponent(t.itemId)}`, { texto }, token))}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
