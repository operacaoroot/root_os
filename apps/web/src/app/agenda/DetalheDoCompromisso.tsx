'use client';

import { useState } from 'react';
import type { PedidoDeEscrita } from '@mktos/shared';
import { apiPost } from '@/lib/api';

import { Historico } from './abas/Historico';
import { desfechoDa, novaChave, type ResultadoDaEscritaNaTela, pedidoDeCancelar, type DesfechoDaEscrita } from './painel';
import { horaNoFuso, rotulosDoDia } from './semana';
import { aparenciaDo, corDaEtiqueta, diaDoEventoV2, type EventoV2 } from './v2';

/*
 * O DETALHE DE UM COMPROMISSO (agenda v2, 29/10/2026, lane G3).
 *
 * Mora no mesmo lugar do painel (à direita, ou folha de baixo no celular):
 * o que é, quando, quem, Meet, convidados e o histórico do que o OS gravou
 * nele (`<Historico eventoId>`, lane G4). Editar abre o painel no modo de
 * editar (é também o caminho do teclado e do celular para mover e esticar).
 * Cancelar pede o motivo e pergunta se avisa os convidados; vai a
 * `POST /agenda/escritas` (`cancelar`), e o resultado diz se saiu no clique
 * (com desfazer) ou foi para a fila.
 */

const RESPOSTA: Record<string, string> = { aceito: 'aceitou', recusado: 'recusou', talvez: 'talvez', pendente: 'sem resposta' };

interface Props {
  evento: EventoV2;
  modo: 'lado' | 'folha';
  token: string | null;
  podeEditar: boolean;
  choque: boolean;
  aoEditar: () => void;
  aoFechar: () => void;
  aoEscrever: () => void;
}

/** Pode ser editado pela tela? Só o que a agenda da casa organizou, com hora, não cancelado. */
export function podeEditarEvento(e: EventoV2): boolean {
  return e.origem === 'google' && e.organizadorEhAgenda && e.status !== 'cancelado' && e.leitura.tipo !== 'feriado';
}

export function DetalheDoCompromisso({ evento: e, modo, token, podeEditar, choque, aoEditar, aoFechar, aoEscrever }: Props) {
  const ap = aparenciaDo(e);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [avisar, setAvisar] = useState(e.convidados.length > 0);
  const [enviando, setEnviando] = useState(false);
  const [desfecho, setDesfecho] = useState<DesfechoDaEscrita | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const editavel = podeEditar && podeEditarEvento(e);
  const dia = diaDoEventoV2(e);
  const rot = dia ? rotulosDoDia(dia) : null;

  const escrever = async (pedido: PedidoDeEscrita) => {
    setEnviando(true);
    setErro(null);
    try {
      const d = desfechoDa(await apiPost<ResultadoDaEscritaNaTela>('/agenda/escritas', pedido, token));
      setDesfecho(d);
      if (d.tipo === 'saiu' || d.tipo === 'fila') { setCancelando(false); aoEscrever(); }
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = () => {
    try {
      void escrever(pedidoDeCancelar(e, motivo, avisar, novaChave()));
    } catch (err) {
      setErro((err as Error).message);
    }
  };

  const etiqueta = choque ? 'choque' : ap.etiqueta;
  const corpo = (
    <div className="flex flex-col gap-3" data-detalhe-do-compromisso={e.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-os-mono text-[10px] font-bold tracking-[0.4em] text-mag">// compromisso</div>
          <div className="text-lg font-bold leading-snug">{ap.titulo}</div>
          {etiqueta && <div className={`font-os-mono text-[10px] font-bold uppercase tracking-[0.08em] ${corDaEtiqueta(choque ? 'choque' : ap.tom, ap.semMeet)}`}>{etiqueta}</div>}
        </div>
        <button type="button" aria-label="Fechar detalhe" onClick={aoFechar} className="rounded-[3px] border border-border bg-surface-2 px-3 py-1.5 text-[13px]">×</button>
      </div>

      <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-[13px]">
        <dt className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">quando</dt>
        <dd className="font-os-mono text-xs">{rot ? `${rot.semana} ${rot.data} · ` : ''}{e.diaInteiro ? 'dia inteiro' : `${horaNoFuso(e.inicio)} a ${horaNoFuso(e.fim)}`}</dd>
        {e.leitura.responsaveis.length > 0 && (<><dt className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">quem</dt><dd>{e.leitura.responsaveis.join(', ')}</dd></>)}
        {e.leitura.cliente && (<><dt className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">cliente</dt><dd>{e.leitura.cliente}</dd></>)}
        {e.leitura.modalidade && (<><dt className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">como</dt><dd>{e.leitura.modalidade}</dd></>)}
        {e.leitura.motivo && (<><dt className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">motivo</dt><dd>{e.leitura.motivo}</dd></>)}
        {e.local && (<><dt className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">onde</dt><dd>{e.local}</dd></>)}
        {e.organizador && (<><dt className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">organizou</dt><dd className="truncate">{e.organizador}</dd></>)}
        {e.origem === 'livre_ocupado' && (<><dt className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">origem</dt><dd>agenda pessoal, só livre e ocupado</dd></>)}
        {e.criadoPeloOs && (<><dt className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">marcado</dt><dd>pelo OS</dd></>)}
      </dl>

      {e.meet && (
        <a href={e.meet} target="_blank" rel="noreferrer" className="self-start rounded-[3px] border border-brand bg-brand/[0.12] px-3 py-1.5 text-[13px] text-text">
          entrar no Meet
        </a>
      )}

      {e.convidados.length > 0 && (
        <div>
          <div className="font-os-mono text-[10px] uppercase tracking-[0.2em] text-muted">convidados</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {e.convidados.map((c) => (
              <li key={c.email} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{c.nome || c.email}</span>
                <span className="shrink-0 font-os-mono text-[10px] text-muted">{c.organizador ? 'organiza' : RESPOSTA[c.resposta] ?? c.resposta}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {desfecho && (
        <div role="status" className={`rounded-[3px] border px-2.5 py-2 text-[13px] ${desfecho.tipo === 'saiu' ? 'border-info/40 text-info' : desfecho.tipo === 'fila' ? 'border-warn/50 text-warn' : 'border-mag/50 text-mag'}`}>
          {desfecho.texto}
          {desfecho.tipo === 'fila' && <a href="/atendimento" className="ml-2 underline underline-offset-2">ir para a fila</a>}
          {desfecho.tipo === 'saiu' && desfecho.desfazer && (
            <button type="button" disabled={enviando} onClick={() => void escrever({ ...desfecho.desfazer!, chave: novaChave() } as PedidoDeEscrita)} className="ml-2 underline underline-offset-2">
              desfazer
            </button>
          )}
        </div>
      )}
      {erro && <div role="alert" className="rounded-[3px] border border-mag/50 px-2.5 py-2 text-[13px] text-mag">{erro}</div>}

      {editavel && !cancelando && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={aoEditar} className="rounded-[3px] border border-brand bg-brand px-3 py-1.5 text-[13px] font-semibold text-ink">Editar</button>
          <button type="button" onClick={() => setCancelando(true)} className="rounded-[3px] border border-border bg-surface-2 px-3 py-1.5 text-[13px] hover:border-mag">Cancelar compromisso</button>
        </div>
      )}
      {!editavel && podeEditar && e.origem === 'google' && !e.organizadorEhAgenda && (
        <p className="text-xs text-muted">Convite de outra agenda: mexa nele pelo Google de quem organizou.</p>
      )}
      {cancelando && (
        <div className="flex flex-col gap-2 rounded-[3px] border border-mag/50 p-2.5">
          <label className="font-os-mono text-[10px] uppercase tracking-[0.2em] text-muted" htmlFor="agenda-cancelar-motivo">Motivo do cancelamento</label>
          <textarea id="agenda-cancelar-motivo" className="min-h-[56px] w-full rounded-[3px] border border-border bg-bg px-2.5 py-2 text-[13px]" value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={avisar} onChange={(ev) => setAvisar(ev.target.checked)} />
            avisar os convidados
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={enviando || !motivo.trim()} onClick={cancelar} className="rounded-[3px] border border-mag px-3 py-1.5 text-[13px] text-mag disabled:opacity-50">
              {enviando ? 'Enviando…' : 'Cancelar o compromisso'}
            </button>
            <button type="button" onClick={() => setCancelando(false)} className="rounded-[3px] border border-border bg-surface-2 px-3 py-1.5 text-[13px]">Voltar</button>
          </div>
        </div>
      )}

      {e.link && (
        <a href={e.link} target="_blank" rel="noreferrer" className="text-xs text-muted underline underline-offset-2 hover:text-brand">abrir no Google</a>
      )}

      {e.origem === 'google' && <Historico eventoId={e.id} limite={10} aoMudar={aoEscrever} />}
    </div>
  );

  if (modo === 'folha') {
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-label="Compromisso">
        <button type="button" aria-label="Fechar" className="absolute inset-0 bg-bg/70" onClick={aoFechar} />
        <div className="relative max-h-[88vh] overflow-y-auto rounded-t-[6px] border-t border-border-strong bg-surface px-4 pb-6 pt-4">{corpo}</div>
      </div>
    );
  }
  return (
    <aside aria-label="Compromisso" className="flex w-[372px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface px-[18px] py-4">
      {corpo}
    </aside>
  );
}
