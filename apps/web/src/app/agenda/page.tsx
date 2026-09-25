'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Video, MapPin, Users, AlertTriangle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { gravarStorage, lerStorage } from '@/central/lib/storage';
import { Botao, Card, Chip } from '../referencias/ui';
import { MarcarReuniao } from './MarcarReuniao';
import { Mes } from './Mes';
import { Semana } from './Semana';
import { diasDaGrade, mover, periodoDaBusca, primeiroDoMes, rotuloDoPeriodo, type Visao } from './grade';
import {
  chaveDoDia,
  diaDoEvento,
  horaCurta,
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
 * DUAS VISÕES, UMA BUSCA SÓ. Mês e semana pedem períodos diferentes à API
 * (`periodoDaBusca`) e compartilham tudo o mais: o mesmo filtro, o mesmo mapa de
 * eventos por dia e o mesmo painel do dia embaixo. A escolha fica guardada no
 * navegador — quem trabalha na semana não quer reabrir no mês todo dia.
 *
 * FUSO: tudo é desenhado no relógio de quem está olhando. Evento de dia inteiro
 * chega como data pura e é tratado como string (ver `diaDoEvento`) — convertê-lo
 * jogaria o compromisso para o dia anterior em Brasília.
 */

type Filtro = 'tudo' | 'cliente' | 'interna' | 'fora';

const CHAVE_DA_VISAO = 'agenda:visao';

export default function AgendaPage() {
  const { token, ready, can } = useAuth();
  const [visao, setVisao] = useState<Visao>('mes');
  const [ancora, setAncora] = useState(() => new Date());
  const [eventos, setEventos] = useState<EventoDaAgenda[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [diaAberto, setDiaAberto] = useState<string>(() => chaveDoDia(new Date()));
  const [filtro, setFiltro] = useState<Filtro>('tudo');
  const [trilhos, setTrilhos] = useState<string[]>([]);

  // A visão preferida só é lida depois da montagem: o servidor não tem
  // localStorage, e ler no primeiro render trocaria o HTML por baixo da
  // hidratação.
  useEffect(() => {
    const salva = lerStorage<Visao>(CHAVE_DA_VISAO, 'mes');
    if (salva === 'semana' || salva === 'mes') setVisao(salva);
  }, []);

  const trocarVisao = (v: Visao) => {
    setVisao(v);
    gravarStorage(CHAVE_DA_VISAO, v);
  };

  const dias = useMemo(() => diasDaGrade(visao, ancora), [visao, ancora]);

  const carregar = useCallback(() => {
    if (!token) return;
    const { de, ate } = periodoDaBusca(visao, ancora);
    setErro(null);
    apiGet<EventoDaAgenda[]>(
      `/google/calendar/periodo?de=${encodeURIComponent(de.toISOString())}&ate=${encodeURIComponent(ate.toISOString())}`,
      token,
    )
      .then(setEventos)
      .catch((e) => { setEventos([]); setErro(e.message); });
  }, [token, visao, ancora]);

  useEffect(() => { if (ready && token) carregar(); }, [ready, token, carregar]);

  // Os nomes de cliente que o OS já conhece, para o datalist do formulário. Sem
  // permissão de tarefas o pedido nem sai — o campo continua sendo texto livre.
  useEffect(() => {
    if (!ready || !token || !can('tarefas.ver')) return;
    apiGet<Array<{ cliente?: string }>>('/tenants/onboarding/trilhos', token)
      .then((ts) => setTrilhos(ts.map((t) => t.cliente ?? '').filter(Boolean)))
      .catch(() => {});
  }, [ready, token, can]);

  const visiveis = useMemo(
    () =>
      (eventos ?? []).filter((e) => {
        if (filtro === 'cliente') return e.reuniao?.tipo === 'cliente';
        if (filtro === 'interna') return e.reuniao?.tipo === 'interna';
        if (filtro === 'fora') return !e.reuniao;
        return true;
      }),
    [eventos, filtro],
  );

  const porDia = useMemo(() => {
    const m = new Map<string, EventoDaAgenda[]>();
    for (const e of visiveis) {
      const dia = diaDoEvento(e);
      if (!dia) continue;
      const lista = m.get(dia) ?? [];
      lista.push(e);
      m.set(dia, lista);
    }
    return m;
  }, [visiveis]);

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

  /** Trocar de dia na grade não muda a página; sair da página mostrada, sim. */
  const escolherDia = (dia: string) => setDiaAberto(dia);

  const irParaHoje = () => {
    const h = new Date();
    setAncora(visao === 'mes' ? primeiroDoMes(h) : h);
    setDiaAberto(chaveDoDia(h));
  };

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
          <Botao onClick={() => setAncora(mover(visao, ancora, -1))}><ChevronLeft size={15} /></Botao>
          <span className="min-w-[13rem] text-center text-sm font-medium capitalize">
            {rotuloDoPeriodo(visao, ancora)}
          </span>
          <Botao onClick={() => setAncora(mover(visao, ancora, 1))}><ChevronRight size={15} /></Botao>
          <Botao onClick={irParaHoje}>hoje</Botao>

          {/* mês × semana */}
          <div className="ml-1 flex overflow-hidden rounded-lg border border-border">
            {([['mes', 'Mês'], ['semana', 'Semana']] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => trocarVisao(v)}
                className={`px-3 py-1.5 text-sm ${visao === v ? 'bg-brand/10 text-text' : 'bg-surface-2 text-muted hover:text-text'}`}
              >
                {label}
              </button>
            ))}
          </div>
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

      {visao === 'mes' ? (
        <Mes
          dias={dias}
          mesVisivel={ancora.getMonth()}
          porDia={porDia}
          diaAberto={diaAberto}
          aoEscolherDia={escolherDia}
        />
      ) : (
        <Semana
          dias={dias}
          eventos={visiveis}
          porDia={porDia}
          diaAberto={diaAberto}
          aoEscolherDia={escolherDia}
        />
      )}

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
