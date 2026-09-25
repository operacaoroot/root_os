'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Video, MapPin, Users, AlertTriangle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip } from '../referencias/ui';
import { MarcarReuniao } from './MarcarReuniao';
import {
  chaveDoDia,
  diaDoEvento,
  horaCurta,
  rotuloCurto,
  tomDoEvento,
  type EventoDaAgenda,
} from './tipos';

/*
 * ============================================================================
 * A AGENDA DA ROOT — o Google Calendar de operacao.root@gmail.com, aqui dentro
 * ============================================================================
 *
 * Esta tela NÃO tem banco. Não existe tabela de reunião no OS, e é de propósito:
 * a agenda de verdade é a do Google, aquela que toca o celular dos sócios e
 * manda o convite para o cliente. Uma cópia local seria uma segunda verdade para
 * divergir da primeira no primeiro evento que alguém mexer pelo telefone.
 *
 * O QUE A TELA ACRESCENTA ao calendar.google.com, e que é a razão de ela existir:
 *
 *  1. O PADRÃO DA CASA LIDO EM COLUNAS. `Reunião Online - Andrade Peças - Pedro`
 *     não é só um texto: a API o desmonta (ver `agenda.ts` no shared) e aqui ele
 *     vira cliente, responsável e modalidade — filtráveis, contáveis, coloridos.
 *  2. O QUE FOGE DO PADRÃO APARECE COMO TAL, em âmbar, com o título cru. É o
 *     único jeito de o combinado sobreviver: padrão que ninguém vê ser quebrado
 *     morre em duas semanas.
 *  3. MARCAR JÁ SAI NO PADRÃO, porque o formulário não tem campo de título.
 *
 * FUSO: tudo é desenhado no relógio de quem está olhando. Evento de dia inteiro
 * chega como data pura e é tratado como string (ver `diaDoEvento`) — convertê-lo
 * jogaria o compromisso para o dia anterior em Brasília.
 */

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const primeiroDoMes = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** A grade de 6×7 que cobre o mês inteiro, começando no domingo. */
function gradeDoMes(mes: Date): Date[] {
  const inicio = primeiroDoMes(mes);
  const comeco = new Date(inicio);
  comeco.setDate(1 - inicio.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(comeco);
    d.setDate(comeco.getDate() + i);
    return d;
  });
}

type Filtro = 'tudo' | 'cliente' | 'interna' | 'fora';

export default function AgendaPage() {
  const { token, ready, can } = useAuth();
  const [mes, setMes] = useState(() => primeiroDoMes(new Date()));
  const [eventos, setEventos] = useState<EventoDaAgenda[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [diaAberto, setDiaAberto] = useState<string>(() => chaveDoDia(new Date()));
  const [filtro, setFiltro] = useState<Filtro>('tudo');
  const [trilhos, setTrilhos] = useState<string[]>([]);

  const grade = useMemo(() => gradeDoMes(mes), [mes]);

  const carregar = useCallback(() => {
    if (!token) return;
    const de = grade[0];
    const ate = new Date(grade[41]);
    ate.setDate(ate.getDate() + 1);
    setErro(null);
    apiGet<EventoDaAgenda[]>(
      `/google/calendar/periodo?de=${encodeURIComponent(de.toISOString())}&ate=${encodeURIComponent(ate.toISOString())}`,
      token,
    )
      .then(setEventos)
      .catch((e) => { setEventos([]); setErro(e.message); });
  }, [token, grade]);

  useEffect(() => { if (ready && token) carregar(); }, [ready, token, carregar]);

  // Os nomes de cliente que o OS já conhece, para o datalist do formulário. Sem
  // permissão de tarefas o pedido nem sai — o campo continua sendo texto livre.
  useEffect(() => {
    if (!ready || !token || !can('tarefas.ver')) return;
    apiGet<Array<{ cliente?: string }>>('/tenants/onboarding/trilhos', token)
      .then((ts) => setTrilhos(ts.map((t) => t.cliente ?? '').filter(Boolean)))
      .catch(() => {});
  }, [ready, token, can]);

  const porDia = useMemo(() => {
    const m = new Map<string, EventoDaAgenda[]>();
    for (const e of eventos ?? []) {
      if (filtro === 'cliente' && e.reuniao?.tipo !== 'cliente') continue;
      if (filtro === 'interna' && e.reuniao?.tipo !== 'interna') continue;
      if (filtro === 'fora' && e.reuniao) continue;
      const dia = diaDoEvento(e);
      if (!dia) continue;
      const lista = m.get(dia) ?? [];
      lista.push(e);
      m.set(dia, lista);
    }
    return m;
  }, [eventos, filtro]);

  const clientesConhecidos = useMemo(() => {
    const s = new Set<string>(trilhos);
    for (const e of eventos ?? []) if (e.reuniao?.tipo === 'cliente') s.add(e.reuniao.cliente);
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [eventos, trilhos]);

  const responsaveisConhecidos = useMemo(() => {
    const s = new Set<string>();
    for (const e of eventos ?? []) if (e.reuniao?.responsavel) s.add(e.reuniao.responsavel);
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [eventos]);

  const foraDoPadrao = (eventos ?? []).filter((e) => !e.reuniao).length;
  const doDia = porDia.get(diaAberto) ?? [];
  const hoje = chaveDoDia(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            O calendário do <span className="font-medium text-text">operacao.root@gmail.com</span>, desenhado
            pelo padrão da casa. Marcar por aqui garante o padrão; marcar pelo Google, não.
          </p>
        </div>
        {can('agenda.editar') && (
          <MarcarReuniao clientes={clientesConhecidos} responsaveis={responsaveisConhecidos} aoMarcar={carregar} />
        )}
      </div>

      {erro && (
        <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">
          {erro} — se a conta do Google não está conectada, ela se conecta em <a className="underline" href="/conexoes">Conexões</a>.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Botao onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}><ChevronLeft size={15} /></Botao>
          <span className="min-w-[10rem] text-center text-sm font-medium capitalize">
            {mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </span>
          <Botao onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}><ChevronRight size={15} /></Botao>
          <Botao onClick={() => { const h = new Date(); setMes(primeiroDoMes(h)); setDiaAberto(chaveDoDia(h)); }}>hoje</Botao>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            ['tudo', 'Tudo'],
            ['cliente', 'Clientes'],
            ['interna', 'Internas'],
            ['fora', `Fora do padrão${foraDoPadrao ? ` (${foraDoPadrao})` : ''}`],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFiltro(k)}
              className={`rounded-lg border px-2.5 py-1 text-xs ${filtro === k ? 'border-brand-dim bg-brand/10 text-text' : 'border-border bg-surface-2 text-muted hover:text-text'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* a grade do mês */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-border">
          {DIAS.map((d) => (
            <div key={d} className="px-2 py-1.5 text-center font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grade.map((d) => {
            const chave = chaveDoDia(d);
            const doMes = d.getMonth() === mes.getMonth();
            const lista = porDia.get(chave) ?? [];
            return (
              <button
                key={chave}
                onClick={() => setDiaAberto(chave)}
                className={`min-h-[6.5rem] border-b border-r border-border p-1.5 text-left align-top transition-colors last:border-r-0 hover:bg-surface-2 ${doMes ? '' : 'opacity-40'} ${chave === diaAberto ? 'bg-surface-2' : ''}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className={`text-xs ${chave === hoje ? 'rounded bg-brand px-1.5 py-0.5 font-semibold text-bg' : 'text-muted'}`}>
                    {d.getDate()}
                  </span>
                  {lista.length > 2 && <span className="text-[10px] text-muted">+{lista.length - 2}</span>}
                </div>
                <div className="space-y-1">
                  {lista.slice(0, 2).map((e) => {
                    const tom = tomDoEvento(e);
                    const cor = tom === 'brand' ? 'bg-brand/15 text-brand'
                      : tom === 'good' ? 'bg-good/15 text-good'
                      : tom === 'warn' ? 'bg-warn/15 text-warn'
                      : 'bg-surface-2 text-muted';
                    return (
                      <div key={e.id} className={`truncate rounded px-1 py-0.5 text-[10px] ${cor}`} title={e.title}>
                        {!e.diaInteiro && <span className="mr-1 opacity-70">{horaCurta(e.start)}</span>}
                        {rotuloCurto(e)}
                      </div>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* o dia escolhido, por extenso */}
      <Card titulo={new Date(`${diaAberto}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}>
        {eventos === null ? (
          <p className="text-sm text-muted">Carregando a agenda…</p>
        ) : doDia.length === 0 ? (
          <p className="text-sm text-muted">Nada marcado neste dia.</p>
        ) : (
          <ul className="divide-y divide-border">
            {doDia.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-os-mono text-xs text-muted">
                      {e.diaInteiro ? 'dia inteiro' : `${horaCurta(e.start)}–${horaCurta(e.end)}`}
                    </span>
                    {e.reuniao ? (
                      <>
                        <span className="text-sm font-medium">
                          {e.reuniao.tipo === 'cliente' ? e.reuniao.cliente : 'Interna'}
                        </span>
                        {e.reuniao.tipo === 'cliente' && (
                          <Chip tone={e.reuniao.modalidade === 'online' ? 'brand' : 'good'}>
                            {e.reuniao.modalidade === 'online' ? 'online' : 'presencial'}
                          </Chip>
                        )}
                        {e.reuniao.responsavel && <Chip>{e.reuniao.responsavel}</Chip>}
                      </>
                    ) : (
                      <>
                        <span className="text-sm">{e.title}</span>
                        <Chip tone="warn">
                          <span className="inline-flex items-center gap-1"><AlertTriangle size={10} /> fora do padrão</span>
                        </Chip>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
                    {e.location && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {e.location}</span>}
                    {e.meet && (
                      <a href={e.meet} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand">
                        <Video size={11} /> Meet
                      </a>
                    )}
                    {e.attendees.length > 0 && (
                      <span className="inline-flex items-center gap-1" title={e.attendees.join(', ')}>
                        <Users size={11} /> {e.attendees.length} convidado{e.attendees.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                {e.link && (
                  <a href={e.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand">
                    abrir no Google <ExternalLink size={12} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-[11px] text-muted">
        Padrão da casa: <span className="font-os-mono">Reunião Online|Presencial - Cliente - Responsável</span> para
        cliente, <span className="font-os-mono">Reunião Interna - Sócio|Todos</span> para dentro de casa. O que o
        Google tiver em outro formato aparece em âmbar, com o título cru, para alguém corrigir.
      </p>
    </div>
  );
}
