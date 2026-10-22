'use client';

import { useEffect, useId, useState } from 'react';
import {
  TRAB_LISTA_VOLTA_SEM_PASTA, TRAB_PASTA_VOLTA_AO_TOPO,
  type TrabArquivadas, type TrabDesarquivada, type TrabListaArquivada, type TrabPastaArquivada,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';

/*
 * AS ARQUIVADAS, NO FIM DA COLUNA DA ESQUERDA (rodada de produção 2, M3, 22/10/2026).
 *
 * Excluir uma lista com tarefas arquivadas, ou uma pasta que só guardava
 * arquivadas, ARQUIVA em vez de apagar (a regra da casa), e o importador do CRM
 * também arquiva. Esta seção, recolhida por padrão, mostra o que está guardado:
 * nome, quando, quem arquivou e quantas tarefas. "Desarquivar":
 *  · a lista volta para a pasta onde estava; se essa pasta continua arquivada, ela
 *    volta para Sem pasta, e a linha diz isso antes do clique;
 *  · a pasta volta com o que foi arquivado junto com ela; o que foi arquivado
 *    antes continua aqui.
 * As regras são da API (`GET /trabalho/arquivadas`, `POST …/desarquivar`, só de
 * gente com a permissão de apagar). Sem nada arquivado, a seção não aparece.
 */

/** dd/mm/aaaa em São Paulo. */
function dataCurta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

const tarefas = (n: number) => (n === 1 ? '1 tarefa' : `${n} tarefas`);
const listas = (n: number) => (n === 1 ? '1 lista' : `${n} listas`);

function quemEQuando(item: { arquivadaEm: string; por: { nome: string } | null }): string {
  return [`arquivada em ${dataCurta(item.arquivadaEm)}`, item.por ? `por ${item.por.nome}` : 'sem registro de quem arquivou'].join(' · ');
}

export function ArquivadasDaArvore({ token, editable, versao, onMudou, onAviso }: {
  token: string | null;
  /** Quem pode desarquivar (a permissão de apagar; a API confere de novo). */
  editable: boolean;
  /** Muda quando a árvore volta da API: a seção relê junto. */
  versao: unknown;
  onMudou: () => void;
  onAviso: (m: string) => void;
}) {
  const [dados, setDados] = useState<TrabArquivadas | null>(null);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const corpo = useId();

  useEffect(() => {
    let vivo = true;
    apiGet<TrabArquivadas>('/trabalho/arquivadas', token)
      .then((d) => { if (vivo) setDados(d); })
      // Sem a leitura (rota fora do ar, sem permissão), a seção só não aparece.
      .catch(() => { if (vivo) setDados(null); });
    return () => { vivo = false; };
  }, [token, versao]);

  const pastas: TrabPastaArquivada[] = Array.isArray(dados?.pastas) ? dados!.pastas : [];
  const soltas: TrabListaArquivada[] = Array.isArray(dados?.listas) ? dados!.listas : [];
  const total = pastas.length + soltas.length;
  if (total === 0) return null;

  const desarquivar = (tipo: 'pasta' | 'lista', id: string, nome: string, destino: string) => {
    setOcupado(`${tipo}:${id}`); setErro(null);
    apiPost<TrabDesarquivada>(`/trabalho/${tipo === 'pasta' ? 'pastas' : 'listas'}/${encodeURIComponent(id)}/desarquivar`, {}, token)
      .then((r) => {
        const junto = r?.listasJunto ? ` Voltou com ${listas(r.listasJunto)}.` : '';
        onAviso(r?.aviso
          ? `${tipo === 'pasta' ? 'A pasta' : 'A lista'} ${nome} foi desarquivada. ${r.aviso}${junto}`
          : `${tipo === 'pasta' ? 'A pasta' : 'A lista'} ${nome} voltou para ${destino}.${junto}`);
        onMudou();
      })
      .catch((e) => setErro((e as Error).message))
      .finally(() => setOcupado(null));
  };

  const botao = (tipo: 'pasta' | 'lista', id: string, nome: string, destino: string) => (editable ? (
    <button
      type="button"
      data-testid={`trabalho-desarquivar-${tipo}-${id}`}
      disabled={ocupado !== null}
      onClick={() => desarquivar(tipo, id, nome, destino)}
      aria-label={`Desarquivar ${tipo === 'pasta' ? 'a pasta' : 'a lista'} ${nome}`}
      className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:border-brand-dim hover:text-text disabled:opacity-50 max-md:min-h-[44px]"
    >
      {ocupado === `${tipo}:${id}` ? 'Desarquivando…' : 'Desarquivar'}
    </button>
  ) : null);

  return (
    <section aria-label="Arquivadas" data-testid="trabalho-arquivadas" className="border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={corpo}
        data-testid="trabalho-arquivadas-alternar"
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center gap-1 rounded px-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-text focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-dim max-md:min-h-[44px]"
      >
        <span aria-hidden className="font-os-mono text-[10px]">{aberto ? '▾' : '▸'}</span>
        Arquivadas ({total})
      </button>
      <div id={corpo} hidden={!aberto} className="mt-1 space-y-1">
        <p className="px-1 text-[11px] text-muted">Pastas e listas guardadas. Nada aqui foi apagado.</p>
        <ul className="space-y-1">
          {pastas.map((p) => {
            const destino = p.maeArquivada || !p.mae ? 'o primeiro nível' : p.mae.name;
            const dica = p.maeArquivada ? TRAB_PASTA_VOLTA_AO_TOPO : p.listasQueVoltam ? `Volta com ${listas(p.listasQueVoltam)} arquivada${p.listasQueVoltam === 1 ? '' : 's'} junto.` : null;
            return (
              <li key={`p-${p.id}`} data-testid={`trabalho-arquivada-pasta-${p.id}`} className="rounded-md bg-surface-2/60 px-2 py-1.5">
                <div className="flex min-w-0 items-start justify-between gap-1.5">
                  <div className="min-w-0">
                    <p className="break-words text-[12.5px] text-text">{p.name} <span className="text-[10px] uppercase tracking-wide text-muted">pasta</span></p>
                    <p className="break-words text-[11px] text-muted">{quemEQuando(p)}</p>
                    <p className="break-words text-[11px] text-muted">{listas(p.listas)} · {tarefas(p.tarefas)}{p.mae ? ` · estava em ${p.mae.name}` : ''}</p>
                    {dica && <p className="break-words text-[11px] text-muted" data-testid={`trabalho-arquivada-pasta-${p.id}-dica`}>{dica}</p>}
                  </div>
                  {botao('pasta', p.id, p.name, destino)}
                </div>
              </li>
            );
          })}
          {soltas.map((l) => {
            const destino = l.maeArquivada || !l.pasta ? 'Sem pasta' : l.pasta.name;
            return (
              <li key={`l-${l.id}`} data-testid={`trabalho-arquivada-lista-${l.id}`} className="rounded-md bg-surface-2/60 px-2 py-1.5">
                <div className="flex min-w-0 items-start justify-between gap-1.5">
                  <div className="min-w-0">
                    <p className="break-words text-[12.5px] text-text">{l.name}</p>
                    <p className="break-words text-[11px] text-muted">{quemEQuando(l)}</p>
                    <p className="break-words text-[11px] text-muted">{tarefas(l.tarefas)} · {l.pasta ? `estava em ${l.pasta.name}` : 'estava sem pasta'}</p>
                    {l.maeArquivada && <p className="break-words text-[11px] text-muted" data-testid={`trabalho-arquivada-lista-${l.id}-dica`}>{TRAB_LISTA_VOLTA_SEM_PASTA}</p>}
                  </div>
                  {botao('lista', l.id, l.name, destino)}
                </div>
              </li>
            );
          })}
        </ul>
        {erro && <p role="alert" data-testid="trabalho-arquivadas-erro" className="break-words px-1 text-[11px] text-bad">{erro}</p>}
      </div>
    </section>
  );
}
