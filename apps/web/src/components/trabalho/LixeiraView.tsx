'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  TRAB_FRASE_DE_APAGAR_DE_VEZ, fraseDeApagarDeVezConfere,
  type TrabArquivadas, type TrabDesarquivada, type TrabLixeira, type TrabTarefaNaLixeira,
  type TrabTarefasApagadasDeVez, type TrabTarefasRestauradas,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * A LIXEIRA (rodada de produção 3, I2, 22/10/2026). Abre pela engrenagem do topo.
 *
 * Duas abas: Tarefas (arquivadas e excluídas) e Listas e pastas (arquivadas, o
 * Desarquivar da rodada 2). Cada item diz quando saiu, por quem e de onde; a busca
 * é por nome; Restaurar vale em lote; "ver no Registro de ações" abre o rastro
 * filtrado pela entidade. Apagar de vez só aparece para quem tem `admin.usuarios`
 * e pede a frase escrita. As regras são da API: esta tela só pergunta.
 */

type Aba = 'tarefas' | 'listas';
type Estado = '' | 'excluida' | 'arquivada';

/** dd/mm/aaaa hh:mm em São Paulo. */
function quando(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function LinkDoRastro({ id }: { id: string }) {
  return (
    <Link href={`/rastro?entidade=${encodeURIComponent(id)}`} className="text-[11px] text-muted underline hover:text-brand" data-testid={`lixeira-rastro-${id}`}>
      ver no Registro de ações
    </Link>
  );
}

export function LixeiraView() {
  const { token, ready, can } = useAuth();
  const [aba, setAba] = useState<Aba>('tarefas');
  const pode = can('tarefas.editar');
  const admin = can('admin.usuarios');

  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (!token || !pode) return <p className="text-muted">A Lixeira é de quem pode apagar no Trabalho: você não tem essa permissão.</p>;

  return (
    <div className="com-tema mx-auto max-w-[1100px] space-y-4 text-text" data-testid="lixeira">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">Lixeira</h1>
        <p className="text-sm text-muted">O que saiu do Trabalho e pode voltar. Nada aqui foi apagado.</p>
      </div>
      <div role="tablist" aria-label="O que está na Lixeira" className="flex gap-1 border-b border-border">
        {([['tarefas', 'Tarefas'], ['listas', 'Listas e pastas']] as const).map(([k, rotulo]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={aba === k}
            data-testid={`lixeira-aba-${k}`}
            onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm max-md:min-h-[44px] ${aba === k ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {aba === 'tarefas' ? <AbaTarefas token={token} admin={admin} /> : <AbaListas token={token} />}
    </div>
  );
}

function AbaTarefas({ token, admin }: { token: string; admin: boolean }) {
  const [dados, setDados] = useState<TrabLixeira | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<Estado>('');
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [apagar, setApagar] = useState<{ frase: string } | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(busca.trim()), 250);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    let vivo = true;
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (estado) p.set('estado', estado);
    setErro(null);
    apiGet<TrabLixeira>(`/trabalho/lixeira${p.toString() ? `?${p}` : ''}`, token)
      .then((d) => { if (vivo) { setDados(d); setMarcadas(new Set()); } })
      .catch((e) => { if (vivo) setErro((e as Error).message); });
    return () => { vivo = false; };
  }, [token, q, estado, versao]);

  const tarefas: TrabTarefaNaLixeira[] = Array.isArray(dados?.tarefas) ? dados!.tarefas : [];
  const escolhidas = tarefas.filter((t) => marcadas.has(t.id));
  const excluidasEscolhidas = escolhidas.filter((t) => t.estado === 'excluida' && !t.cardDaImplantacao);
  const alternar = (id: string) => setMarcadas((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todasMarcadas = tarefas.length > 0 && tarefas.every((t) => marcadas.has(t.id));

  const restaurar = (ids: string[]) => {
    if (!ids.length) return;
    setOcupado(true); setErro(null); setAviso(null);
    apiPost<TrabTarefasRestauradas>('/trabalho/lixeira/restaurar', { ids }, token)
      .then((r) => {
        setAviso([`${plural(r.restauradas, 'tarefa restaurada', 'tarefas restauradas')}: voltaram para a lista e a etapa de onde saíram.`, ...(r.avisos ?? [])].join(' '));
        setVersao((v) => v + 1);
      })
      .catch((e) => setErro((e as Error).message))
      .finally(() => setOcupado(false));
  };

  const apagarDeVez = () => {
    if (!apagar) return;
    setOcupado(true); setErro(null); setAviso(null);
    apiPost<TrabTarefasApagadasDeVez>('/trabalho/lixeira/apagar-de-vez', { ids: excluidasEscolhidas.map((t) => t.id), frase: apagar.frase }, token)
      .then((r) => {
        setAviso(`${plural(r.apagadas, 'tarefa apagada', 'tarefas apagadas')} de vez.${r.presas?.length ? ` ${plural(r.presas.length, 'ficou', 'ficaram')} na Lixeira: ${r.presas.map((p) => p.motivo).filter((m, i, a) => a.indexOf(m) === i).join(' ')}` : ''}`);
        setApagar(null);
        setVersao((v) => v + 1);
      })
      .catch((e) => setErro((e as Error).message))
      .finally(() => setOcupado(false));
  };

  return (
    <section aria-label="Tarefas na Lixeira" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-[14rem] flex-1">
          <span className="sr-only">Buscar pelo nome</span>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pelo nome…"
            data-testid="lixeira-busca"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-brand-dim max-md:min-h-[44px]"
          />
        </label>
        <div className="flex gap-1" role="group" aria-label="Filtrar">
          {([['', 'Todas'], ['excluida', 'Excluídas'], ['arquivada', 'Arquivadas']] as const).map(([k, rotulo]) => (
            <button
              key={k || 'todas'}
              type="button"
              aria-pressed={estado === k}
              data-testid={`lixeira-filtro-${k || 'todas'}`}
              onClick={() => setEstado(k)}
              className={`rounded-lg border border-border px-3 py-1.5 text-sm max-md:min-h-[44px] ${estado === k ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={todasMarcadas} onChange={() => setMarcadas(todasMarcadas ? new Set() : new Set(tarefas.map((t) => t.id)))} aria-label="Marcar todas" />
          {escolhidas.length ? `${escolhidas.length} marcada${escolhidas.length === 1 ? '' : 's'}` : 'Marcar todas'}
        </label>
        <button
          type="button"
          data-testid="lixeira-restaurar"
          disabled={ocupado || escolhidas.length === 0}
          onClick={() => restaurar(escolhidas.map((t) => t.id))}
          className="rounded-lg bg-brand/15 px-3 py-1.5 text-brand hover:bg-brand/25 disabled:opacity-50 max-md:min-h-[44px]"
        >
          Restaurar{escolhidas.length ? ` (${escolhidas.length})` : ''}
        </button>
        {admin && (
          <button
            type="button"
            data-testid="lixeira-apagar-de-vez"
            disabled={ocupado || excluidasEscolhidas.length === 0}
            title={excluidasEscolhidas.length === 0 ? 'Marque tarefas excluídas (o card da implantação não sai de vez).' : undefined}
            onClick={() => setApagar({ frase: '' })}
            className="rounded-lg border border-bad/40 px-3 py-1.5 text-bad hover:bg-bad/10 disabled:opacity-50 max-md:min-h-[44px]"
          >
            Apagar de vez{excluidasEscolhidas.length ? ` (${excluidasEscolhidas.length})` : ''}
          </button>
        )}
        {dados && (
          <span className="text-[12px] text-muted" data-testid="lixeira-expurgo">
            Excluídas ficam {dados.diasNaLixeira} dias.{' '}
            {dados.expurgo.ligado ? 'O expurgo automático está ligado' : 'O expurgo automático está desligado'} em{' '}
            <Link href="/rotinas" className="underline hover:text-brand">Rotinas automáticas</Link>.
          </span>
        )}
      </div>

      {apagar && (
        <div role="dialog" aria-label="Apagar de vez" className="space-y-2 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm" data-testid="lixeira-confirmar-apagar">
          <p>{plural(excluidasEscolhidas.length, 'tarefa sai', 'tarefas saem')} do banco para sempre, com comentários, campos e horas. Não há como desfazer.</p>
          <label className="block">
            Para confirmar, escreva <strong>{TRAB_FRASE_DE_APAGAR_DE_VEZ}</strong>:
            <input
              autoFocus
              value={apagar.frase}
              onChange={(e) => setApagar({ frase: e.target.value })}
              data-testid="lixeira-frase"
              className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim"
            />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={ocupado || !fraseDeApagarDeVezConfere(apagar.frase)} onClick={apagarDeVez} data-testid="lixeira-apagar-confirmar" className="rounded-lg bg-bad/20 px-3 py-1.5 text-bad disabled:opacity-50">Apagar de vez</button>
            <button type="button" onClick={() => setApagar(null)} className="rounded-lg border border-border px-3 py-1.5 text-muted hover:text-text">Cancelar</button>
          </div>
        </div>
      )}

      {aviso && <p role="status" data-testid="lixeira-aviso" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm break-words">{aviso}</p>}
      {erro && <p role="alert" data-testid="lixeira-erro" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm break-words">{erro}</p>}

      {!dados && !erro ? <p className="text-muted">Carregando…</p> : tarefas.length === 0 ? (
        <p className="text-muted" data-testid="lixeira-vazia">{q ? 'Nenhuma tarefa com esse nome na Lixeira.' : 'Nenhuma tarefa na Lixeira.'}</p>
      ) : (
        <ul className="space-y-1.5" data-testid="lixeira-tarefas">
          {tarefas.map((t) => (
            <li key={t.id} data-testid={`lixeira-tarefa-${t.id}`} className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <input type="checkbox" className="mt-1" checked={marcadas.has(t.id)} onChange={() => alternar(t.id)} aria-label={`Marcar ${t.title}`} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm">
                  {t.title}{' '}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${t.estado === 'excluida' ? 'bg-bad/15 text-bad' : 'bg-surface-2 text-muted'}`}>
                    {t.estado === 'excluida' ? 'excluída' : 'arquivada'}
                  </span>
                  {t.cardDaImplantacao && <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">card da implantação</span>}
                </p>
                <p className="break-words text-[12px] text-muted">
                  {t.estado === 'excluida' ? 'excluída' : 'arquivada'} em {quando(t.em)} · {t.por ? `por ${t.por.nome}` : 'sem registro de quem tirou'}
                </p>
                <p className="break-words text-[12px] text-muted">
                  de {t.pasta ? `${t.pasta.name} / ` : ''}{t.lista.name} · etapa {t.status.name}
                  {t.lista.arquivada ? ' · a lista está arquivada' : ''}
                  {t.expiraEm ? ` · sai pelo expurgo em ${quando(t.expiraEm)}, se ligado` : ''}
                </p>
                <LinkDoRastro id={t.id} />
              </div>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => restaurar([t.id])}
                data-testid={`lixeira-restaurar-${t.id}`}
                aria-label={`Restaurar ${t.title}`}
                className="shrink-0 rounded border border-border px-2 py-1 text-[12px] text-muted hover:border-brand-dim hover:text-text disabled:opacity-50 max-md:min-h-[44px]"
              >
                Restaurar
              </button>
            </li>
          ))}
        </ul>
      )}
      {dados && dados.total > tarefas.length && (
        <p className="text-[12px] text-muted">Mostrando {tarefas.length} de {dados.total}. Busque pelo nome para achar as outras.</p>
      )}
    </section>
  );
}

type ItemArquivado = { tipo: 'pasta' | 'lista'; id: string; name: string; arquivadaEm: string; por: { nome: string } | null; deOnde: string; detalhe: string };

function AbaListas({ token }: { token: string }) {
  const [dados, setDados] = useState<TrabArquivadas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    apiGet<TrabArquivadas>('/trabalho/arquivadas', token)
      .then((d) => { if (vivo) { setDados(d); setMarcadas(new Set()); } })
      .catch((e) => { if (vivo) setErro((e as Error).message); });
    return () => { vivo = false; };
  }, [token, versao]);

  const itens: ItemArquivado[] = useMemo(() => [
    ...(Array.isArray(dados?.pastas) ? dados!.pastas : []).map((p) => ({
      tipo: 'pasta' as const, id: p.id, name: p.name, arquivadaEm: p.arquivadaEm, por: p.por,
      deOnde: p.mae ? `estava em ${p.mae.name}` : 'estava no primeiro nível',
      detalhe: `${plural(p.listas, 'lista', 'listas')} · ${plural(p.tarefas, 'tarefa', 'tarefas')}`,
    })),
    ...(Array.isArray(dados?.listas) ? dados!.listas : []).map((l) => ({
      tipo: 'lista' as const, id: l.id, name: l.name, arquivadaEm: l.arquivadaEm, por: l.por,
      deOnde: l.pasta ? `estava em ${l.pasta.name}${l.maeArquivada ? ' (arquivada: volta para Sem pasta)' : ''}` : 'estava sem pasta',
      detalhe: plural(l.tarefas, 'tarefa', 'tarefas'),
    })),
  ], [dados]);
  const chave = (i: ItemArquivado) => `${i.tipo}:${i.id}`;
  const visiveis = itens.filter((i) => !busca.trim() || i.name.toLowerCase().includes(busca.trim().toLowerCase()));
  const escolhidos = visiveis.filter((i) => marcadas.has(chave(i)));

  const restaurar = useCallback(async (lote: ItemArquivado[]) => {
    if (!lote.length) return;
    setOcupado(true); setErro(null); setAviso(null);
    const frases: string[] = [];
    // Pastas primeiro: a lista que mora numa pasta restaurada volta para o lugar dela.
    for (const i of [...lote].sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'pasta' ? -1 : 1))) {
      try {
        const r = await apiPost<TrabDesarquivada>(`/trabalho/${i.tipo === 'pasta' ? 'pastas' : 'listas'}/${encodeURIComponent(i.id)}/desarquivar`, {}, token);
        frases.push(`${i.tipo === 'pasta' ? 'A pasta' : 'A lista'} ${i.name} voltou.${r?.aviso ? ` ${r.aviso}` : ''}`);
      } catch (e) {
        frases.push(`${i.name}: ${(e as Error).message}`);
      }
    }
    setAviso(frases.join(' '));
    setOcupado(false);
    setVersao((v) => v + 1);
  }, [token]);

  return (
    <section aria-label="Listas e pastas arquivadas" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-[14rem] flex-1">
          <span className="sr-only">Buscar pelo nome</span>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome…" data-testid="lixeira-listas-busca"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-brand-dim max-md:min-h-[44px]" />
        </label>
        <button
          type="button"
          data-testid="lixeira-listas-restaurar"
          disabled={ocupado || escolhidos.length === 0}
          onClick={() => void restaurar(escolhidos)}
          className="rounded-lg bg-brand/15 px-3 py-1.5 text-sm text-brand hover:bg-brand/25 disabled:opacity-50 max-md:min-h-[44px]"
        >
          Restaurar{escolhidos.length ? ` (${escolhidos.length})` : ''}
        </button>
      </div>
      {aviso && <p role="status" data-testid="lixeira-listas-aviso" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm break-words">{aviso}</p>}
      {erro && <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm break-words">{erro}</p>}
      {!dados && !erro ? <p className="text-muted">Carregando…</p> : visiveis.length === 0 ? (
        <p className="text-muted" data-testid="lixeira-listas-vazia">Nenhuma lista ou pasta arquivada{busca.trim() ? ' com esse nome' : ''}.</p>
      ) : (
        <ul className="space-y-1.5" data-testid="lixeira-listas">
          {visiveis.map((i) => (
            <li key={chave(i)} data-testid={`lixeira-${i.tipo}-${i.id}`} className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <input type="checkbox" className="mt-1" checked={marcadas.has(chave(i))} aria-label={`Marcar ${i.name}`}
                onChange={() => setMarcadas((m) => { const n = new Set(m); const k = chave(i); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm">{i.name} <span className="text-[10px] uppercase tracking-wide text-muted">{i.tipo}</span></p>
                <p className="break-words text-[12px] text-muted">arquivada em {quando(i.arquivadaEm)} · {i.por ? `por ${i.por.nome}` : 'sem registro de quem arquivou'}</p>
                <p className="break-words text-[12px] text-muted">{i.deOnde} · {i.detalhe}</p>
                <LinkDoRastro id={i.id} />
              </div>
              <button type="button" disabled={ocupado} onClick={() => void restaurar([i])} data-testid={`lixeira-restaurar-${i.tipo}-${i.id}`} aria-label={`Restaurar ${i.name}`}
                className="shrink-0 rounded border border-border px-2 py-1 text-[12px] text-muted hover:border-brand-dim hover:text-text disabled:opacity-50 max-md:min-h-[44px]">
                Restaurar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
