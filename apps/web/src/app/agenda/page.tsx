'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Video, MapPin, Users, AlertTriangle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useModulos } from '@/components/modulos';
import { intervaloDaGrade, prazosDeTrabalho, trabalhoHref } from '@/lib/work-projection';
import type { ForaDoPadraoDaAgenda, TrabTarefaResumo } from '@mktos/shared';
import { Botao, Card, Chip } from '../referencias/ui';
import { MarcarReuniao } from './MarcarReuniao';
import { ListaForaDoPadrao, SeloForaDoPadrao } from './ForaDoPadrao';
import { GradeDaSemana, useEhCelular } from './GradeDaSemana';
import {
  diaVizinho,
  diasDaSemana,
  eventosPorDia,
  hojeNoFuso,
  intervaloDosDias,
  lerEstadoDaAgenda,
  noFuso,
  rotulosDoDia,
  urlDaAgenda,
  type VisaoDaAgenda,
} from './semana';
import {
  chaveDoDia,
  diaDoEvento,
  foraDoPadraoNaTela,
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
 * A camada de REUNIÕES não tem banco. Não existe tabela de reunião no OS:
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
 * A camada de PRAZOS consulta WorkTask, sem criar evento no Google. FUSO: desde
 * a rodada de produção 1 (21/10/2026, P2) tudo é desenhado no relógio de
 * America/Sao_Paulo (ver `semana.ts`), não no do navegador. Evento de dia
 * inteiro chega como data pura e é tratado como string (ver `diaDoEvento`):
 * convertê-lo jogaria o compromisso para o dia anterior em Brasília.
 *
 * TRÊS VISÕES (P2): Mês, Semana e Dia, com o estado no endereço
 * (`?visao=semana&dia=AAAA-MM-DD`), setas de anterior e próxima e "Hoje". A
 * semana é uma grade de horas das 07h às 22h no computador e uma lista por dia
 * no celular. A fonte é a mesma: `GET /google/calendar/periodo?de=&ate=` com o
 * intervalo da visão, e os prazos do Trabalho no mesmo intervalo.
 */

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const primeiroDoMes = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** O mês (Date local no dia 1) da chave `AAAA-MM-DD`. */
const mesDaChave = (dia: string) => {
  const [a, m] = dia.split('-').map(Number);
  return new Date(a, m - 1, 1);
};

const ROTULO_DA_VISAO: Record<VisaoDaAgenda, string> = { mes: 'Mês', semana: 'Semana', dia: 'Dia' };

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
  const { modulos } = useModulos();
  const podeVerTrabalho = ready && !!token && can('tarefas.ver') && modulos?.includes('trabalho') === true;
  const celular = useEhCelular();
  // O estado mora no endereço; até lê-lo (depois de montar), nada é buscado.
  const [estado, setEstado] = useState<{ visao: VisaoDaAgenda; dia: string; lido: boolean }>(() => ({ visao: 'mes', dia: hojeNoFuso(), lido: false }));
  const { visao, dia: diaAberto } = estado;
  const mes = useMemo(() => mesDaChave(diaAberto), [diaAberto]);
  const [eventos, setEventos] = useState<EventoDaAgenda[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('tudo');
  const [trilhos, setTrilhos] = useState<string[]>([]);
  const [prazos, setPrazos] = useState<TrabTarefaResumo[] | null>(null);
  const [erroPrazos, setErroPrazos] = useState<string | null>(null);
  // O vigia da agenda (AG-01): o selo "N fora do padrão" e a lista com as propostas.
  const [vigia, setVigia] = useState<ForaDoPadraoDaAgenda | null>(null);
  const [erroVigia, setErroVigia] = useState<string | null>(null);

  const carregarVigia = useCallback(() => {
    if (!token) return;
    apiGet<ForaDoPadraoDaAgenda>('/agenda/fora-do-padrao', token)
      .then((d) => { setVigia(d); setErroVigia(null); })
      .catch((e) => { setVigia(null); setErroVigia(e.message); });
  }, [token]);

  useEffect(() => { if (ready && token) carregarVigia(); }, [ready, token, carregarVigia]);

  useEffect(() => {
    const ler = () => setEstado({ ...lerEstadoDaAgenda(window.location.search, hojeNoFuso()), lido: true });
    ler();
    window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, []);

  const mudar = useCallback((proxima: VisaoDaAgenda, dia: string) => {
    setEstado({ visao: proxima, dia, lido: true });
    window.history.replaceState(null, '', urlDaAgenda(`${window.location.pathname}${window.location.search}${window.location.hash}`, proxima, dia));
  }, []);

  const grade = useMemo(() => gradeDoMes(mes), [mes]);
  const diasDaVisao = useMemo(
    () => (visao === 'semana' ? diasDaSemana(diaAberto) : visao === 'dia' ? [diaAberto] : grade.map(chaveDoDia)),
    [visao, diaAberto, grade],
  );
  // O intervalo [de, ate) da visão, em instantes do fuso da agenda.
  const intervalo = useMemo(() => intervaloDosDias(diasDaVisao), [diasDaVisao]);

  const carregar = useCallback(() => {
    if (!token || !estado.lido) return;
    const { de, ate } = intervalo;
    setErro(null);
    apiGet<EventoDaAgenda[]>(
      `/google/calendar/periodo?de=${encodeURIComponent(de.toISOString())}&ate=${encodeURIComponent(ate.toISOString())}`,
      token,
    )
      .then(setEventos)
      .catch((e) => { setEventos([]); setErro(e.message); });
  }, [token, intervalo, estado.lido]);

  useEffect(() => { if (ready && token) carregar(); }, [ready, token, carregar]);

  useEffect(() => {
    if (!podeVerTrabalho || !token) { setPrazos(null); setErroPrazos(null); return; }
    if (!estado.lido) return;
    let ativo = true;
    setPrazos(null);
    setErroPrazos(null);
    const range = visao === 'mes' ? intervaloDaGrade(grade) : { dueFrom: intervalo.de.toISOString(), dueTo: intervalo.ate.toISOString() };
    prazosDeTrabalho(token, range)
      .then((items) => { if (ativo) setPrazos(items); })
      .catch((e) => { if (ativo) setErroPrazos(e.message); });
    return () => { ativo = false; };
  }, [podeVerTrabalho, token, grade, visao, intervalo, estado.lido]);

  // Os nomes de cliente que o OS já conhece, para o datalist do formulário. Sem
  // permissão de tarefas o pedido nem sai — o campo continua sendo texto livre.
  useEffect(() => {
    if (!ready || !token || !can('tarefas.ver')) return;
    apiGet<Array<{ cliente?: string }>>('/tenants/onboarding/trilhos', token)
      .then((ts) => setTrilhos(ts.map((t) => t.cliente ?? '').filter(Boolean)))
      .catch(() => {});
  }, [ready, token, can]);

  const filtrados = useMemo(
    () =>
      (eventos ?? []).filter((e) => {
        if (filtro === 'cliente' && e.reuniao?.tipo !== 'cliente') return false;
        if (filtro === 'interna' && e.reuniao?.tipo !== 'interna') return false;
        if (filtro === 'fora' && !foraDoPadraoNaTela(e)) return false;
        return true;
      }),
    [eventos, filtro],
  );

  const porDia = useMemo(() => {
    const m = new Map<string, EventoDaAgenda[]>();
    for (const e of filtrados) {
      const dia = diaDoEvento(e);
      if (!dia) continue;
      const lista = m.get(dia) ?? [];
      lista.push(e);
      m.set(dia, lista);
    }
    return m;
  }, [filtrados]);

  const prazosPorDia = useMemo(() => {
    const dias = new Map<string, TrabTarefaResumo[]>();
    for (const tarefa of prazos ?? []) {
      if (!tarefa.dueDate) continue;
      const dia = noFuso(new Date(tarefa.dueDate)).dia;
      dias.set(dia, [...(dias.get(dia) ?? []), tarefa]);
    }
    return dias;
  }, [prazos]);

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

  const foraDoPadrao = (eventos ?? []).filter(foraDoPadraoNaTela).length;
  const doDia = useMemo(() => {
    if (visao === 'mes') return porDia.get(diaAberto) ?? [];
    const [d] = eventosPorDia(filtrados, [diaAberto]);
    return [...d.diaInteiro, ...d.comHora.map((c) => c.evento)];
  }, [visao, porDia, filtrados, diaAberto]);
  const hoje = hojeNoFuso();
  const contagemDePrazos = useMemo(() => new Map([...prazosPorDia].map(([k, v]) => [k, v.length])), [prazosPorDia]);
  const titulo =
    visao === 'mes'
      ? mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      : visao === 'semana'
        ? `${rotulosDoDia(diasDaVisao[0]).data} a ${rotulosDoDia(diasDaVisao[6]).data}`
        : rotulosDoDia(diaAberto).extenso;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            O calendário do <span className="font-medium text-text">operacao.root@gmail.com</span>, desenhado
            pelo padrão da casa. Marcar por aqui garante o padrão; marcar pelo Google, não.
          </p>
          <div className="mt-1"><SeloForaDoPadrao dados={vigia} /></div>
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

      <ListaForaDoPadrao
        dados={vigia}
        erro={erroVigia}
        token={token}
        podeEditar={can('agenda.editar')}
        aoMudar={carregarVigia}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Visão da agenda" className="inline-flex overflow-hidden rounded-lg border border-border">
            {(['mes', 'semana', 'dia'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={visao === v}
                onClick={() => mudar(v, diaAberto)}
                className={`px-2.5 py-1 text-xs ${visao === v ? 'bg-brand/10 text-text' : 'bg-surface-2 text-muted hover:text-text'}`}
              >
                {ROTULO_DA_VISAO[v]}
              </button>
            ))}
          </div>
          <Botao onClick={() => mudar(visao, diaVizinho(visao, diaAberto, -1))} title="Anterior"><ChevronLeft size={15} /></Botao>
          <span className="min-w-[8rem] text-center text-sm font-medium capitalize" data-titulo-da-agenda="">
            {titulo}
          </span>
          <Botao onClick={() => mudar(visao, diaVizinho(visao, diaAberto, 1))} title="Próxima"><ChevronRight size={15} /></Botao>
          <Botao onClick={() => mudar(visao, hojeNoFuso())}>Hoje</Botao>
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

      {visao !== 'mes' && (
        <GradeDaSemana
          dias={diasDaVisao}
          eventos={eventos === null ? [] : filtrados}
          prazosPorDia={contagemDePrazos}
          mostrarPrazos={podeVerTrabalho}
          hoje={hoje}
          diaAberto={diaAberto}
          aoEscolher={(d) => mudar(visao, d)}
          comoLista={celular && visao === 'semana'}
        />
      )}

      {/* a grade do mês */}
      {visao === 'mes' && (
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
            const quantidadeDePrazos = prazosPorDia.get(chave)?.length ?? 0;
            return (
              <button
                key={chave}
                onClick={() => mudar('mes', chave)}
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
                {podeVerTrabalho && quantidadeDePrazos > 0 && (
                  <div className="mt-1 truncate rounded bg-brand/10 px-1 py-0.5 text-[10px] text-brand">
                    {quantidadeDePrazos} prazo{quantidadeDePrazos === 1 ? '' : 's'} de trabalho
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

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
                      <span className="text-sm">{e.title}</span>
                    )}
                    {foraDoPadraoNaTela(e) && (
                      <Chip tone="warn">
                        <span className="inline-flex items-center gap-1"><AlertTriangle size={10} /> fora do padrão</span>
                      </Chip>
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

      {podeVerTrabalho && (
        <Card titulo="Prazos de trabalho">
          <p className="mb-2 text-xs text-muted">Prazos dos cards no Trabalho; não são reuniões nem publicações agendadas.</p>
          {erroPrazos && <p role="alert" className="text-sm text-bad">Não foi possível carregar os prazos: {erroPrazos}</p>}
          {!prazos && !erroPrazos && <p className="text-sm text-muted">Carregando prazos…</p>}
          {prazos && (prazosPorDia.get(diaAberto) ?? []).length === 0 && (
            <p className="text-sm text-muted">Nenhum prazo de trabalho neste dia.</p>
          )}
          {prazos && (
            <ul className="divide-y divide-border">
              {(prazosPorDia.get(diaAberto) ?? []).map((t) => (
                <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                  <a href={trabalhoHref(t.id)} className="min-w-0 font-medium text-brand underline">{t.title}</a>
                  <span className="text-xs text-muted">{t.statusName} · {t.dueDate ? new Date(t.dueDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <p className="text-[11px] text-muted">
        Padrão da casa: <span className="font-os-mono">Reunião Online|Presencial - Cliente - Responsável</span> para
        cliente, <span className="font-os-mono">Reunião Interna - Sócio|Todos</span> para dentro de casa; reunião
        online sempre com Meet. A reunião que o Google tiver fora disso aparece em âmbar, com o título cru, e o
        vigia da agenda propõe a correção (que espera a confirmação na fila de aprovações). Compromisso que não é
        reunião, como bloqueio e lembrete sem convidado, fica neutro.
      </p>
    </div>
  );
}
