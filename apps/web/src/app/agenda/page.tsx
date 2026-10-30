'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ForaDoPadraoDaAgenda, type RegrasDaAgenda, type SocioDaAgenda, type TrabTarefaResumo } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useModulos } from '@/components/modulos';
import { prazosDeTrabalho, trabalhoHref } from '@/lib/work-projection';
import { abrirAquiNoClique, useTarefaNaUrl } from '@/lib/tarefa-na-url';
import { TarefaFlutuante } from '@/components/trabalho/TrabalhoView';
import { Card } from '../referencias/ui';
import { AbaConflitos } from './abas/AbaConflitos';
import { AbaRegras } from './abas/AbaRegras';
import { AbaRelatorios } from './abas/AbaRelatorios';
import { Calendario } from './Calendario';
import { DetalheDoCompromisso, podeEditarEvento } from './DetalheDoCompromisso';
import { ListaForaDoPadrao, SeloForaDoPadrao } from './ForaDoPadrao';
import { GradeDeHoras, type DestinoDoArrasto } from './GradeDeHoras';
import { ListaDoDia } from './ListaDoDia';
import { MesDaAgenda, casasDoMesDe } from './MesDaAgenda';
import { PainelDeMarcar, lerRascunhoGuardado } from './PainelDeMarcar';
import { lerPeriodo, lerQuantosConflitos, lerRegras, type PeriodoLido } from './dados';
import { ABAS, ROTULO_DA_ABA, lerEstadoV2, urlDoEstadoV2, type AbaDaAgenda, type EstadoDaAgendaV2 } from './estado';
import { intervaloDoRascunho, rascunhoDoEvento, rascunhoVazio, tituloDoRascunho, type Rascunho } from './painel';
import { hojeNoFuso, intervaloDosDias, noFuso, rotulosDoDia, somarDias, horaNoFuso } from './semana';
import {
  ALTURA_PADRAO,
  OPCOES_DE_DIAS,
  QUEM,
  ancoraVizinha,
  aparenciaDo,
  choquesDe,
  corDaEtiqueta,
  diaDoEventoV2,
  diasDaJanela,
  diasDoDiaInteiro,
  ehDoSocio,
  faixasDoTopo,
  horaDeMinutos,
  lerAlturaGuardada,
  minutosDoEvento,
  rotuloDaJanela,
  seloDaSincronia,
  type AlturaDaHora,
  type EventoV2,
} from './v2';

/*
 * ============================================================================
 * A AGENDA DA ROOT — v2 (rodada da Agenda v2, 29/10/2026, lane G3)
 * ============================================================================
 *
 * O Google Calendar da `operacao.root@` continua sendo A agenda. Desde a v2 o
 * OS lê um ESPELHO dela (`GET /agenda/espelho`, só de leitura, atualizado pela
 * sincronia), para a régua, os Conflitos e o link público lerem a semana sem
 * bater no Google a cada clique. Espelho atrasado ou fora do ar: a tela avisa e
 * lê direto do Google (`dados.ts`). Toda escrita vai ao Google pela porta
 * (`POST /agenda/escritas`), e o espelho reflete.
 *
 * AS ABAS (desenho `Main`): Semana e dia · Lista · Mês · Conflitos · Relatórios
 * · Regras. Semana e dia é a grade (1, 3 ou 5 dias, filtro Quem, Calendário,
 * altura das horas) com o PAINEL DE MARCAR fixo à direita (folha de baixo
 * abaixo de 860 px). A Lista é o padrão no celular (desenho `Celular`).
 * Conflitos, Relatórios e Regras são das lanes G5 e G2; a página só as monta.
 *
 * O QUE CONTINUA DE ANTES: o padrão da casa lido em colunas (a gramática do
 * shared), o fora do padrão em âmbar com a palavra, o vigia AG-01 (selo e
 * lista), os prazos do Trabalho do dia aberto, e todo dia e hora no relógio de
 * America/Sao_Paulo (`semana.ts`). Estado no endereço (`estado.ts`).
 *
 * IDENTIDADE: Space Grotesk no texto (`font-central-sans`), JetBrains Mono em
 * rótulo e número, cor só onde informa e sempre com a palavra junto. Os tokens
 * `--os-*` trocam com o tema (escuro, papel, claro).
 */

const CHAVE_DA_ALTURA = 'agenda.v2.alturaDaHora';
const PASSO_DA_ALTURA = 8;

/** Abaixo de 860 px: o painel vira folha de baixo e a Lista é o padrão. */
function useEstreito(): boolean {
  const [estreito, setEstreito] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 859px)');
    const ler = () => setEstreito(mq.matches);
    ler();
    mq.addEventListener?.('change', ler);
    return () => mq.removeEventListener?.('change', ler);
  }, []);
  return estreito;
}

type Lado =
  | { tipo: 'marcar'; inicial: Rascunho }
  | { tipo: 'editar'; evento: EventoV2; inicial: Rascunho }
  | { tipo: 'detalhe'; evento: EventoV2 };

export default function AgendaPage() {
  const { token, ready, can } = useAuth();
  const { modulos } = useModulos();
  const podeVerTrabalho = ready && !!token && can('tarefas.ver') && modulos?.includes('trabalho') === true;
  const podeMarcar = can('agenda.editar');
  const popup = useTarefaNaUrl();
  const estreito = useEstreito();

  const [estado, setEstado] = useState<EstadoDaAgendaV2 & { lido: boolean }>(() => ({ aba: 'semana', dia: hojeNoFuso(), dias: 5, quem: 'Todos', lido: false }));
  const { aba, dia, dias: quantosDias, quem } = estado;
  const [agora, setAgora] = useState(() => new Date());
  const hoje = hojeNoFuso(agora);

  const [periodo, setPeriodo] = useState<PeriodoLido | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [regras, setRegras] = useState<RegrasDaAgenda | null>(null);
  const [conflitos, setConflitos] = useState<number | null>(null);
  const [vigia, setVigia] = useState<ForaDoPadraoDaAgenda | null>(null);
  const [erroVigia, setErroVigia] = useState<string | null>(null);
  const [trilhos, setTrilhos] = useState<string[]>([]);
  const [prazos, setPrazos] = useState<TrabTarefaResumo[] | null>(null);
  const [erroPrazos, setErroPrazos] = useState<string | null>(null);
  const [recargaDosPrazos, setRecargaDosPrazos] = useState(0);
  const [recarga, setRecarga] = useState(0);
  const [lado, setLado] = useState<Lado | null>(null);
  const [rascunhoAtual, setRascunhoAtual] = useState<Rascunho | null>(null);
  const [extras, setExtras] = useState<{ dia: string; eventos: EventoV2[] } | null>(null);
  const [altura, setAltura] = useState<AlturaDaHora>('auto');

  // O relógio da tela (linha do agora, selo da sincronia, "em N min").
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try { setAltura(lerAlturaGuardada(window.localStorage?.getItem(CHAVE_DA_ALTURA) ?? null)); } catch { /* sem armazenamento */ }
  }, []);
  const mudarAltura = useCallback((v: AlturaDaHora) => {
    setAltura(v);
    try { window.localStorage?.setItem(CHAVE_DA_ALTURA, String(v)); } catch { /* sem armazenamento */ }
  }, []);
  const passoDaAltura = useCallback((sentido: 1 | -1) => {
    setAltura((atual) => {
      const base = atual === 'auto' ? ALTURA_PADRAO : atual;
      const v = lerAlturaGuardada(String(base + sentido * PASSO_DA_ALTURA));
      try { window.localStorage?.setItem(CHAVE_DA_ALTURA, String(v)); } catch { /* sem armazenamento */ }
      return v;
    });
  }, []);

  // O estado mora no endereço; até lê-lo (depois de montar), nada é buscado.
  useEffect(() => {
    const ler = () => setEstado({ ...lerEstadoV2(window.location.search, hojeNoFuso(), window.matchMedia?.('(max-width: 859px)').matches ?? false), lido: true });
    ler();
    window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, []);

  const mudar = useCallback((parcial: Partial<EstadoDaAgendaV2>) => {
    setEstado((atual) => {
      const proximo = { ...atual, ...parcial, lido: true };
      window.history.replaceState(null, '', urlDoEstadoV2(`${window.location.pathname}${window.location.search}${window.location.hash}`, proximo));
      return proximo;
    });
  }, []);

  // Os dias da aba aberta.
  const diasDaGrade = useMemo(() => diasDaJanela(dia, quantosDias), [dia, quantosDias]);
  const diasLidos = useMemo(() => {
    if (aba === 'mes') return casasDoMesDe(dia);
    if (aba === 'lista') return [dia, somarDias(dia, 1)];
    return diasDaGrade;
  }, [aba, dia, diasDaGrade]);
  const intervalo = useMemo(() => intervaloDosDias(diasLidos), [diasLidos]);
  const nomesDeFeriado = useMemo(() => (regras?.feriados ?? []).map((f) => f.nome), [regras]);

  const recarregar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    if (!ready || !token || !estado.lido) return;
    let vivo = true;
    setErro(null);
    lerPeriodo(token, intervalo.de, intervalo.ate, nomesDeFeriado)
      .then((p) => { if (vivo) setPeriodo(p); })
      .catch((e) => { if (vivo) { setPeriodo({ eventos: [], sincronia: null, fonte: 'direto' }); setErro((e as Error).message); } });
    return () => { vivo = false; };
  }, [ready, token, estado.lido, intervalo, nomesDeFeriado, recarga]);

  useEffect(() => {
    if (!ready || !token) return;
    void lerRegras(token).then(setRegras);
  }, [ready, token]);

  useEffect(() => {
    if (!ready || !token) return;
    void lerQuantosConflitos(token).then(setConflitos);
  }, [ready, token, recarga]);

  const carregarVigia = useCallback(() => {
    if (!token) return;
    apiGet<ForaDoPadraoDaAgenda>('/agenda/fora-do-padrao', token)
      .then((d) => { setVigia(d); setErroVigia(null); })
      .catch((e) => { setVigia(null); setErroVigia(e.message); });
  }, [token]);
  useEffect(() => { if (ready && token) carregarVigia(); }, [ready, token, carregarVigia]);

  useEffect(() => {
    if (!ready || !token || !can('tarefas.ver')) return;
    apiGet<Array<{ cliente?: string }>>('/tenants/onboarding/trilhos', token)
      .then((ts) => setTrilhos(Array.isArray(ts) ? ts.map((t) => t.cliente ?? '').filter(Boolean) : []))
      .catch(() => {});
  }, [ready, token, can]);

  useEffect(() => {
    if (!podeVerTrabalho || !token) { setPrazos(null); setErroPrazos(null); return; }
    if (!estado.lido) return;
    let ativo = true;
    setPrazos(null);
    setErroPrazos(null);
    prazosDeTrabalho(token, { dueFrom: intervalo.de.toISOString(), dueTo: intervalo.ate.toISOString() })
      .then((items) => { if (ativo) setPrazos(items); })
      .catch((e) => { if (ativo) setErroPrazos(e.message); });
    return () => { ativo = false; };
  }, [podeVerTrabalho, token, intervalo, estado.lido, recargaDosPrazos]);

  // O dia do rascunho fora do que está carregado: a régua precisa dos eventos dele.
  const diaDoRascunho = lado && lado.tipo !== 'detalhe' ? rascunhoAtual?.dia ?? null : null;
  useEffect(() => {
    if (!token || !diaDoRascunho || diasLidos.includes(diaDoRascunho) || !/^\d{4}-\d{2}-\d{2}$/.test(diaDoRascunho)) return;
    if (extras?.dia === diaDoRascunho) return;
    let vivo = true;
    const { de, ate } = intervaloDosDias([diaDoRascunho]);
    lerPeriodo(token, de, ate, nomesDeFeriado)
      .then((p) => { if (vivo) setExtras({ dia: diaDoRascunho, eventos: p.eventos }); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [token, diaDoRascunho, diasLidos, extras?.dia, nomesDeFeriado]);

  const eventos = useMemo(() => periodo?.eventos ?? [], [periodo]);
  const eventosDaRegua = useMemo(() => {
    if (!extras || diasLidos.includes(extras.dia)) return eventos;
    const ids = new Set(eventos.map((e) => e.id));
    return [...eventos, ...extras.eventos.filter((e) => !ids.has(e.id))];
  }, [eventos, extras, diasLidos]);
  const emails = useMemo(() => {
    const m: Partial<Record<SocioDaAgenda, string | null>> = {};
    for (const p of regras?.pessoas ?? []) m[p.nome] = p.email;
    return m;
  }, [regras]);
  const filtrados = useMemo(() => eventos.filter((e) => ehDoSocio(e, quem, emails)), [eventos, quem, emails]);
  const choques = useMemo(() => choquesDe(eventos), [eventos]);
  const faixas = useMemo(() => faixasDoTopo(eventos, regras?.feriados ?? [], diasLidos), [eventos, regras, diasLidos]);
  const faixasDaGrade = useMemo(() => faixas.filter((f) => diasDaGrade.includes(f.dia) && (quem === 'Todos' || f.tipo === 'feriado' || f.pessoa === quem)), [faixas, diasDaGrade, quem]);
  const trajetoDe = useCallback((e: EventoV2) => {
    if (e.leitura.modalidade !== 'presencial' || e.leitura.tipo !== 'cliente') return 0;
    const p = regras?.pessoas.find((x) => e.leitura.responsaveis.includes(x.nome));
    return p?.trajetoMin ?? 0;
  }, [regras]);

  const clientesConhecidos = useMemo(() => {
    const s = new Set<string>(trilhos);
    for (const e of eventos) if (e.leitura.cliente) s.add(e.leitura.cliente);
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [eventos, trilhos]);

  const prazosPorDia = useMemo(() => {
    const m = new Map<string, TrabTarefaResumo[]>();
    for (const t of prazos ?? []) {
      if (!t.dueDate) continue;
      const d = noFuso(new Date(t.dueDate)).dia;
      m.set(d, [...(m.get(d) ?? []), t]);
    }
    return m;
  }, [prazos]);
  const contagemDePrazos = useMemo(() => new Map([...prazosPorDia].map(([k, v]) => [k, v.length])), [prazosPorDia]);

  /* ------------------------------------------------- abrir o painel */
  const abrirMarcar = useCallback((diaHora?: { dia: string; minuto: number }) => {
    const guardado = lerRascunhoGuardado();
    const base = guardado ?? rascunhoVazio(dia, '09:00');
    setLado({ tipo: 'marcar', inicial: diaHora ? { ...base, dia: diaHora.dia, hora: horaDeMinutos(diaHora.minuto) } : base });
  }, [dia]);
  const abrirDetalhe = useCallback((e: EventoV2) => setLado({ tipo: 'detalhe', evento: e }), []);
  const abrirEditar = useCallback((e: EventoV2, destino?: DestinoDoArrasto) => {
    const r = rascunhoDoEvento(e);
    setLado({
      tipo: 'editar',
      evento: e,
      inicial: destino ? { ...r, dia: destino.dia, hora: horaDeMinutos(destino.inicio), duracaoMin: destino.fim - destino.inicio } : r,
    });
  }, []);
  const fecharLado = useCallback(() => { setLado(null); setRascunhoAtual(null); }, []);

  const abrirParaRemarcar = useCallback(async (eventoId: string) => {
    let e = eventos.find((x) => x.id === eventoId) ?? null;
    if (!e && token) {
      const de = new Date(Date.now() - 86_400_000);
      const ate = new Date(Date.now() + 61 * 86_400_000);
      try { e = (await lerPeriodo(token, de, ate, nomesDeFeriado)).eventos.find((x) => x.id === eventoId) ?? null; } catch { e = null; }
    }
    if (!e) return;
    const d = diaDoEventoV2(e) ?? dia;
    mudar({ aba: 'semana', dia: d });
    abrirEditar(e);
  }, [eventos, token, nomesDeFeriado, dia, mudar, abrirEditar]);

  const depoisDeEscrever = useCallback(() => {
    recarregar();
    carregarVigia();
  }, [recarregar, carregarVigia]);

  const novoNaGrade = useMemo(() => {
    if (!lado || lado.tipo === 'detalhe' || !rascunhoAtual) return null;
    const i = intervaloDoRascunho(rascunhoAtual);
    if (!i) return null;
    const m = minutosDoEvento(i);
    if (!m) return null;
    const t = tituloDoRascunho(rascunhoAtual);
    return { dia: m.dia, inicio: m.inicio, fim: m.fim, titulo: t.titulo ?? (lado.tipo === 'editar' ? lado.evento.titulo ?? '' : 'novo compromisso') };
  }, [lado, rascunhoAtual]);

  // Enquanto marca ou edita, o evento editado sai da grade (fica só o tracejado).
  const eventosDaGrade = useMemo(() => (lado?.tipo === 'editar' ? filtrados.filter((e) => e.id !== lado.evento.id) : filtrados), [filtrados, lado]);

  const selo = seloDaSincronia(periodo?.sincronia ?? null, periodo ? periodo.fonte : null, agora);
  const podeVerRegras = can('dashboard.ver');
  const abas = ABAS.filter((a) => a !== 'regras' || podeVerRegras);
  const modoDoLado: 'lado' | 'folha' = estreito || aba !== 'semana' ? 'folha' : 'lado';
  const doDiaAberto = useMemo(
    () => filtrados
      .filter((e) => e.status !== 'cancelado' && (e.diaInteiro ? diasDoDiaInteiro(e).includes(dia) : diaDoEventoV2(e) === dia))
      .sort((a, b) => Number(b.diaInteiro) - Number(a.diaInteiro) || a.inicio.localeCompare(b.inicio)),
    [filtrados, dia],
  );
  const amanha = useMemo(() => {
    if (aba !== 'lista') return null;
    const d = somarDias(dia, 1);
    return filtrados.filter((e) => e.status !== 'cancelado' && !e.diaInteiro && diaDoEventoV2(e) === d).length;
  }, [aba, filtrados, dia]);

  const ladoAberto = lado && (
    lado.tipo === 'detalhe' ? (
      <DetalheDoCompromisso
        key={`d-${lado.evento.id}`}
        evento={lado.evento}
        modo={modoDoLado}
        token={token}
        podeEditar={podeMarcar}
        choque={choques.has(lado.evento.id)}
        aoEditar={() => abrirEditar(lado.evento)}
        aoFechar={fecharLado}
        aoEscrever={depoisDeEscrever}
      />
    ) : (
      <PainelDeMarcar
        modo={modoDoLado}
        edicao={lado.tipo === 'editar' ? lado.evento : null}
        inicial={lado.inicial}
        eventos={eventosDaRegua}
        regras={regras}
        hoje={hoje}
        clientesConhecidos={clientesConhecidos}
        token={token}
        podeMarcar={podeMarcar}
        aoMudarRascunho={setRascunhoAtual}
        aoFechar={fecharLado}
        aoEscrever={depoisDeEscrever}
      />
    )
  );

  const barraDeNavegacao = (comDias: boolean) => (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" title="Anterior" aria-label="Anterior" onClick={() => mudar({ dia: aba === 'mes' ? mesVizinho(dia, -1) : aba === 'lista' ? somarDias(dia, -1) : ancoraVizinha(dia, quantosDias, -1) })} className={botaoBarra}>
        <ChevronLeft size={15} />
      </button>
      <Calendario rotulo={aba === 'mes' ? rotuloDoMes(dia) : aba === 'lista' ? rotuloDaJanela([dia]) : rotuloDaJanela(diasDaGrade)} diaAberto={dia} hoje={hoje} aoEscolher={(d) => mudar({ dia: d })} />
      <button type="button" title="Próxima" aria-label="Próxima" onClick={() => mudar({ dia: aba === 'mes' ? mesVizinho(dia, 1) : aba === 'lista' ? somarDias(dia, 1) : ancoraVizinha(dia, quantosDias, 1) })} className={botaoBarra}>
        <ChevronRight size={15} />
      </button>
      <button type="button" onClick={() => mudar({ dia: hoje })} className={botaoBarra}>Hoje</button>
      {comDias && (
        <>
          <span className="ml-2 font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">dias</span>
          {OPCOES_DE_DIAS.map((n) => (
            <button key={n} type="button" aria-pressed={quantosDias === n} onClick={() => mudar({ dias: n })} className={`${botaoBarra} font-os-mono ${quantosDias === n ? ligadoBarra : ''}`}>{n}</button>
          ))}
        </>
      )}
      <span className="ml-2 font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">quem</span>
      <div role="group" aria-label="Quem" className="flex flex-wrap gap-1">
        {QUEM.map((q) => (
          <button key={q} type="button" aria-pressed={quem === q} onClick={() => mudar({ quem: q })} className={`${botaoBarra} ${quem === q ? ligadoBarra : ''}`}>{q}</button>
        ))}
      </div>
      <span className="flex-1" />
      {comDias && (
        <div className="flex items-center gap-1" role="group" aria-label="Altura das horas">
          <span className="font-os-mono text-[11px] text-muted">altura</span>
          <button type="button" aria-label="Diminuir altura" onClick={() => passoDaAltura(-1)} className={`${botaoBarra} font-os-mono`}>−</button>
          <button type="button" aria-pressed={altura === 'auto'} onClick={() => mudarAltura('auto')} className={`${botaoBarra} font-os-mono ${altura === 'auto' ? ligadoBarra : ''}`}>auto</button>
          <button type="button" aria-label="Aumentar altura" onClick={() => passoDaAltura(1)} className={`${botaoBarra} font-os-mono`}>+</button>
        </div>
      )}
      {podeMarcar && (aba === 'semana' || aba === 'mes') && (
        <button type="button" onClick={() => abrirMarcar()} className="rounded-[3px] border border-brand bg-brand px-3 py-1.5 text-[13px] font-semibold text-ink">+ Marcar</button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 font-central-sans" data-agenda-v2="">
      {/* abas e selos */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border">
        <div role="tablist" aria-label="Agenda" className="flex flex-wrap gap-1">
          {abas.map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={aba === a}
              onClick={() => mudar({ aba: a as AbaDaAgenda })}
              className={`-mb-px border-b-2 px-3.5 py-2 font-os-mono text-xs ${aba === a ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {ROTULO_DA_ABA[a]}
              {a === 'conflitos' && typeof conflitos === 'number' && conflitos > 0 && <span className="ml-1 text-mag">{conflitos}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 pb-2">
          <SeloForaDoPadrao dados={vigia} />
          {selo && (
            <span className={`font-os-mono text-[11px] ${selo.tom === 'ok' ? 'text-info' : 'text-warn'}`} data-selo-da-sincronia="">
              ● {selo.texto}
            </span>
          )}
        </div>
      </div>

      {erro && (
        <div role="alert" className="rounded-[3px] border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">
          {erro}. Se a conta do Google não está conectada, ela se conecta em <a className="underline" href="/conexoes">Conexões</a>.
        </div>
      )}

      {aba === 'semana' && (
        <>
          {barraDeNavegacao(true)}
          {faixasDaGrade.length > 0 && (
            <div className="flex flex-wrap gap-2" data-faixas-do-topo="">
              {faixasDaGrade.map((f) => (
                <span key={`${f.tipo}-${f.dia}-${f.texto}`} className={`rounded-[3px] border px-2.5 py-1 font-os-mono text-[11px] ${f.tipo === 'fora' ? 'border-warn/50 text-warn' : 'border-border text-muted'}`}>
                  {f.tipo === 'fora' ? 'FORA' : 'FERIADO'} · {f.texto} · {rotulosDoDia(f.dia).semana} {rotulosDoDia(f.dia).data}
                  {f.tipo === 'feriado' ? (f.fecha ? ' · agenda fechada' : ' · facultativo, só avisa') : ''}
                </span>
              ))}
            </div>
          )}
          <div className={`flex min-h-[28rem] ${modoDoLado === 'lado' && lado ? 'h-[calc(100vh-15rem)]' : 'h-[calc(100vh-15rem)] max-h-[60rem]'} overflow-hidden rounded-[3px]`}>
            <section className="flex min-w-0 flex-1 flex-col gap-2 pr-0">
              <GradeDeHoras
                dias={diasDaGrade}
                eventos={eventosDaGrade}
                choques={choques}
                faixas={faixasDaGrade}
                hoje={hoje}
                agora={agora}
                altura={altura}
                aoRodar={passoDaAltura}
                novo={novoNaGrade}
                podeMover={(e) => podeMarcar && podeEditarEvento(e) && !e.diaInteiro}
                trajetoDe={trajetoDe}
                aoClicarEvento={abrirDetalhe}
                aoClicarVazio={podeMarcar ? (d, m) => abrirMarcar({ dia: d, minuto: m }) : undefined}
                aoSoltar={(e, destino) => abrirEditar(e, destino)}
                aoEscolherDia={(d) => mudar({ dia: d })}
                diaAberto={dia}
                prazosPorDia={podeVerTrabalho ? contagemDePrazos : undefined}
              />
            </section>
            {modoDoLado === 'lado' && ladoAberto}
          </div>
          <Legenda />
          <ListaForaDoPadrao dados={vigia} erro={erroVigia} token={token} podeEditar={podeMarcar} aoMudar={carregarVigia} />
          <Card titulo={`o dia · ${rotulosDoDia(dia).extenso}`}>
            {periodo === null ? (
              <p className="text-sm text-muted">Carregando a agenda…</p>
            ) : doDiaAberto.length === 0 ? (
              <p className="text-sm text-muted">Nada marcado neste dia.</p>
            ) : (
              <ul className="divide-y divide-border" data-dia-aberto={dia}>
                {doDiaAberto.map((e) => {
                  const ap = aparenciaDo(e);
                  const etiqueta = choques.has(e.id) ? 'choque' : ap.etiqueta;
                  return (
                    <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                      <span className="font-os-mono text-xs text-muted">{e.diaInteiro ? 'dia inteiro' : `${horaNoFuso(e.inicio)}–${horaNoFuso(e.fim)}`}</span>
                      <button type="button" onClick={() => abrirDetalhe(e)} className="min-w-0 text-left text-sm font-medium hover:text-brand">{ap.titulo}</button>
                      {etiqueta && <span className={`font-os-mono text-[9.5px] font-bold uppercase tracking-[0.08em] ${corDaEtiqueta(choques.has(e.id) ? 'choque' : ap.tom, ap.semMeet)}`}>{etiqueta}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}

      {aba === 'lista' && (
        <>
          {barraDeNavegacao(false)}
          <ListaDoDia
            dia={dia}
            hoje={hoje}
            agora={agora}
            eventos={filtrados}
            choques={choques}
            trajetoDe={trajetoDe}
            amanha={amanha}
            conflitos={conflitos}
            podeMarcar={podeMarcar}
            aoClicar={abrirDetalhe}
            aoMarcar={() => abrirMarcar()}
            aoConflitos={() => mudar({ aba: 'conflitos' })}
          />
        </>
      )}

      {aba === 'mes' && (
        <>
          {barraDeNavegacao(false)}
          <MesDaAgenda dia={dia} hoje={hoje} eventos={filtrados} choques={choques} faixas={faixas} prazosPorDia={podeVerTrabalho ? contagemDePrazos : undefined} aoEscolher={(d) => mudar({ dia: d })} />
          <Legenda />
        </>
      )}

      {aba === 'conflitos' && <AbaConflitos aoRemarcar={(id) => void abrirParaRemarcar(id)} aoMudar={depoisDeEscrever} />}
      {aba === 'relatorios' && <AbaRelatorios />}
      {aba === 'regras' && podeVerRegras && <AbaRegras />}

      {modoDoLado === 'folha' && ladoAberto}

      {podeVerTrabalho && (aba === 'semana' || aba === 'lista' || aba === 'mes') && (
        <Card titulo="Prazos de trabalho">
          <p className="mb-2 text-xs text-muted">Prazos dos cards no Trabalho do dia aberto; não são reuniões nem publicações agendadas.</p>
          {erroPrazos && <p role="alert" className="text-sm text-bad">Não foi possível carregar os prazos: {erroPrazos}</p>}
          {!prazos && !erroPrazos && <p className="text-sm text-muted">Carregando prazos…</p>}
          {prazos && (prazosPorDia.get(dia) ?? []).length === 0 && <p className="text-sm text-muted">Nenhum prazo de trabalho neste dia.</p>}
          {prazos && (
            <ul className="divide-y divide-border">
              {(prazosPorDia.get(dia) ?? []).map((t) => (
                <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                  <a href={trabalhoHref(t.id)} onClick={abrirAquiNoClique(popup.abrir, t.id)} className="min-w-0 font-medium text-brand underline">{t.title}</a>
                  <span className="text-xs text-muted">{t.statusName} · {t.dueDate ? new Date(t.dueDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {podeVerTrabalho && <TarefaFlutuante tarefa={popup} onMudou={() => setRecargaDosPrazos((n) => n + 1)} />}
    </div>
  );
}

const botaoBarra = 'rounded-[3px] border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text hover:border-brand-dim';
const ligadoBarra = 'border-brand bg-brand/[0.12]';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const rotuloDoMes = (dia: string) => `${MESES[Number(dia.slice(5, 7)) - 1]} de ${dia.slice(0, 4)}`;

/** O primeiro dia do mês vizinho. */
function mesVizinho(dia: string, sentido: 1 | -1): string {
  const [a, m] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + sentido, 1)).toISOString().slice(0, 10);
}

/** A legenda do desenho: cada cor com a palavra. */
function Legenda() {
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-muted" data-legenda="">
      <span><span className="font-os-mono text-brand">▪</span> cliente</span>
      <span><span className="font-os-mono text-muted">▪</span> interna e rito</span>
      <span><span className="font-os-mono text-muted">┆</span> Fechado (agenda pessoal)</span>
      <span><span className="font-os-mono text-warn">▪</span> fora do padrão, sem Meet, Fora</span>
      <span><span className="font-os-mono text-mag">▪</span> choque</span>
      <span>arrastar move · puxar a borda estica · clique no vazio marca ali</span>
    </div>
  );
}
