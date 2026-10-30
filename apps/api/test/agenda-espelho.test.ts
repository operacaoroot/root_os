import { ActorType, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PROPRIEDADES_DO_OS } from '@mktos/shared';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { comContexto } from '../src/common/contexto-execucao';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ErroDoGoogle } from '../src/google/dubles-do-google';
import {
  CAMPOS_DA_LISTA,
  efeitosDaLeituraDaAgenda,
  lerLivreOcupado,
  listarPaginaDaAgenda,
  type ChamadorDaAgenda,
} from '../src/google/agenda-espelho.google';
import type { RegistroDeConectores } from '../src/integrations/conectores.registry';
import type { RecusaDeConector } from '../src/integrations/conectores';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { TIPO_AGENDA_COPIA, TIPO_AGENDA_SINCRONIZAR } from '../src/routines/rotina.tipos';
import { CopiaDaAgendaService } from '../src/agenda/espelho/copia-da-agenda.service';
import { ExecutorDoEspelhoDaAgenda } from '../src/agenda/espelho/espelho.executor';
import {
  EspelhoService,
  RESUMO_FORA_DA_CASA,
  SLUG_DA_COPIA,
  SLUG_DO_ESPELHO,
} from '../src/agenda/espelho/espelho.service';
import {
  eventoDaLeituraDireta,
  eventoDaLinha,
  idDoIntervalo,
  linhaDoEvento,
} from '../src/agenda/espelho/espelho-do-google';
import { AgendaDaImplantacaoService } from '../src/implantacao/agenda-da-implantacao.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O ESPELHO DA AGENDA (agenda v2, 29/10/2026, lane G1).
 *
 * A parte pura (o evento do Google desmontado, os dois efeitos de leitura com um
 * chamador de mentira) roda sem banco. A parte com banco usa a PORTA de verdade,
 * com a política do banco (1.13.0: as duas leituras são R0), e o Google é um
 * calendário em memória atrás de um `ChamadorDaAgenda` (syncToken, páginas, 410,
 * cancelados, freeBusy). Nada sai para o Google; nenhum dado é real.
 *
 * O que se prova: sincronia inicial, incremental, 410 refaz a janela, cancelado
 * vira `cancelado` sem apagar, evento movido, o Fechado das agendas pessoais sem
 * título (trocado a cada passagem), a leitura com espelho em dia e atrasado,
 * `refletir`, as rotinas semeadas só na casa e o isolamento entre empresas.
 */

/** A mesma regra de caminho de `GoogleService.chamarAgenda`. */
const CAMINHO_DO_CALENDAR = /^\/calendar\/v3\/[A-Za-z0-9_@%.\-/?=&:,+]*$/;

// ---------------------------------------------------------------------------
// O calendário em memória (o mesmo comportamento que o dublê de homolog/mocks/google)
// ---------------------------------------------------------------------------

interface EventoFalso {
  id: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; responseStatus?: string; organizer?: boolean; displayName?: string }>;
  organizer?: { email: string; self?: boolean };
  hangoutLink?: string;
  conferenceData?: unknown;
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
  htmlLink?: string;
  updated?: string;
  _seq: number;
}

class CalendarioFalso implements ChamadorDaAgenda {
  eventos = new Map<string, EventoFalso>();
  seq = 1;
  vencidos = new Set<string>();
  porPagina = 2;
  pedidos: string[] = [];
  livreOcupado: Record<string, Array<{ start: string; end: string }> | 'naoCompartilhada'> = {};

  por(e: Omit<EventoFalso, '_seq' | 'status' | 'organizer'> & Partial<Pick<EventoFalso, 'status' | 'organizer'>>): void {
    const seq = ++this.seq;
    this.eventos.set(e.id, {
      status: 'confirmed',
      organizer: { email: 'operacao.root@exemplo.invalid', self: true },
      htmlLink: `https://calendar.exemplo.invalid/${e.id}`,
      ...e,
      updated: new Date(Date.UTC(2026, 9, 29, 12, 0, seq)).toISOString(),
      _seq: seq,
    });
  }

  mexer(id: string, m: Partial<EventoFalso>): void {
    const atual = this.eventos.get(id)!;
    const seq = ++this.seq;
    this.eventos.set(id, { ...atual, ...m, _seq: seq, updated: new Date(Date.UTC(2026, 9, 29, 12, 0, seq)).toISOString() });
  }

  async chamarAgenda<T>(_org: string, caminho: string, init?: RequestInit): Promise<T> {
    expect(caminho).toMatch(CAMINHO_DO_CALENDAR);
    expect(caminho).not.toMatch(/\.\.|%2e/i);
    this.pedidos.push(caminho);
    const [rota, qs] = caminho.split('?');
    const q = new URLSearchParams(qs ?? '');
    if (rota === '/calendar/v3/freeBusy') {
      const corpo = JSON.parse(String(init?.body)) as { items: Array<{ id: string }> };
      const calendars: Record<string, unknown> = {};
      for (const { id } of corpo.items) {
        const v = this.livreOcupado[id];
        calendars[id] = v === 'naoCompartilhada' || !v ? { busy: [], errors: [{ domain: 'global', reason: 'notFound' }] } : { busy: v };
      }
      return { kind: 'calendar#freeBusy', calendars } as T;
    }
    expect(rota).toBe('/calendar/v3/calendars/primary/events');
    expect(q.get('fields')).toBe(CAMPOS_DA_LISTA);
    expect(q.get('singleEvents')).toBe('true');
    expect(q.get('showDeleted')).toBe('true');
    const token = q.get('syncToken');
    let lista = [...this.eventos.values()].sort((a, b) => a._seq - b._seq);
    if (token) {
      expect(q.get('timeMin')).toBeNull();
      if (this.vencidos.has(token)) throw new ErroDoGoogle(410, '{"error":{"code":410,"message":"Sync token is no longer valid"}}', rota);
      const desde = Number(token.replace('tok-', ''));
      lista = lista.filter((e) => e._seq > desde);
    } else {
      const de = Date.parse(q.get('timeMin')!);
      const ate = Date.parse(q.get('timeMax')!);
      lista = lista.filter((e) => {
        const ini = Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00-03:00`);
        const fim = Date.parse(e.end.dateTime ?? `${e.end.date}T00:00:00-03:00`);
        return ini < ate && fim > de;
      });
    }
    const offset = Number(q.get('pageToken') ?? 0);
    const pagina = lista.slice(offset, offset + this.porPagina).map(({ _seq, ...e }) => {
      void _seq;
      // O Google, no incremental, devolve do cancelado só o id e o status.
      return token && e.status === 'cancelled' ? { id: e.id, status: 'cancelled' } : e;
    });
    const mais = offset + this.porPagina < lista.length;
    return {
      items: pagina,
      ...(mais ? { nextPageToken: String(offset + this.porPagina) } : { nextSyncToken: `tok-${this.seq}` }),
    } as T;
  }
}

// ---------------------------------------------------------------------------
// A parte pura
// ---------------------------------------------------------------------------

describe('o evento do Google desmontado para o espelho (puro)', () => {
  const FERIADOS = ['Finados'];

  it('reunião de cliente: leitura da gramática, Meet do conferenceData, convidados com resposta, propriedades do OS', () => {
    const d = linhaDoEvento(
      {
        id: 'ev1',
        status: 'confirmed',
        summary: 'Reunião Online - Andrade Peças - Pedro',
        start: { dateTime: '2026-11-03T10:00:00-03:00' },
        end: { dateTime: '2026-11-03T11:00:00-03:00' },
        attendees: [
          { email: 'Pessoa@Cliente.Example', responseStatus: 'accepted', displayName: 'Pessoa' },
          { email: 'operacao.root@exemplo.invalid', organizer: true, responseStatus: 'needsAction' },
        ],
        organizer: { email: 'operacao.root@exemplo.invalid', self: true },
        conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: 'https://meet.exemplo.invalid/abc' }] },
        recurringEventId: 'serie1',
        extendedProperties: { private: { [PROPRIEDADES_DO_OS.criadoPeloOs]: '1', [PROPRIEDADES_DO_OS.chave]: 'abc123' } },
        updated: '2026-10-29T10:00:00.000Z',
        htmlLink: 'https://calendar.exemplo.invalid/ev1',
      },
      FERIADOS,
    );
    expect(d.tipo).toBe('linha');
    if (d.tipo !== 'linha') return;
    expect(d.linha).toMatchObject({
      googleId: 'ev1',
      status: 'confirmado',
      meet: 'https://meet.exemplo.invalid/abc',
      organizadorEhAgenda: true,
      serieId: 'serie1',
      criadoPeloOs: true,
      leituraTipo: 'cliente',
      leituraCliente: 'Andrade Peças',
      leituraResponsaveis: ['Pedro'],
      leituraModalidade: 'online',
      diaInteiro: false,
    });
    expect(d.linha.convidados).toEqual([
      { email: 'pessoa@cliente.example', nome: 'Pessoa', resposta: 'aceito' },
      { email: 'operacao.root@exemplo.invalid', nome: null, organizador: true, resposta: 'pendente' },
    ]);
    const e = eventoDaLinha({ ...d.linha, descricao: null });
    expect(e).toMatchObject({ id: 'ev1', origem: 'google', inicio: '2026-11-03T13:00:00.000Z', leitura: { tipo: 'cliente', cliente: 'Andrade Peças' } });
    expect('descricao' in e).toBe(false);
  });

  it('dia inteiro vira a meia-noite de São Paulo; feriado só pelo nome exato; Fora, Fechado e provisório', () => {
    const fer = linhaDoEvento({ id: 'f', summary: 'Finados', start: { date: '2026-11-02' }, end: { date: '2026-11-03' } }, FERIADOS);
    expect(fer.tipo === 'linha' && fer.linha).toMatchObject({
      diaInteiro: true,
      inicio: new Date('2026-11-02T03:00:00.000Z'),
      fim: new Date('2026-11-03T03:00:00.000Z'),
      leituraTipo: 'feriado',
      leituraMotivo: 'Finados',
    });
    const pos = linhaDoEvento({ id: 'p', summary: 'Reunião pós-Finados', start: { date: '2026-11-03' }, end: { date: '2026-11-04' } }, FERIADOS);
    expect(pos.tipo === 'linha' && pos.linha.leituraTipo).toBe('outro');
    const fora = linhaDoEvento(
      { id: 'o', status: 'tentative', summary: 'Pedro Fora - viagem', start: { dateTime: '2026-11-05T08:00:00-03:00' }, end: { dateTime: '2026-11-05T18:00:00-03:00' } },
      FERIADOS,
    );
    expect(fora.tipo === 'linha' && fora.linha).toMatchObject({ status: 'provisorio', leituraTipo: 'fora', leituraMotivo: 'viagem', leituraResponsaveis: ['Pedro'] });
    expect(fora.tipo === 'linha' && eventoDaLinha(fora.linha).leitura).toMatchObject({ tipo: 'fora', motivo: 'viagem', feriado: null });
  });

  it('cancelado do incremental (só id) e evento sem id', () => {
    expect(linhaDoEvento({ id: 'x', status: 'cancelled' }, [])).toEqual({ tipo: 'cancelado', googleId: 'x' });
    expect(linhaDoEvento({ status: 'confirmed' }, [])).toEqual({ tipo: 'invalido' });
    expect(linhaDoEvento({ id: 'y', start: {} }, [])).toEqual({ tipo: 'invalido' });
  });

  it('fim antes do começo não derruba o banco: duração zero', () => {
    const d = linhaDoEvento({ id: 'z', start: { dateTime: '2026-11-05T10:00:00Z' }, end: { dateTime: '2026-11-05T09:00:00Z' } }, []);
    expect(d.tipo === 'linha' && d.linha.fim.toISOString()).toBe('2026-11-05T10:00:00.000Z');
  });

  it('a chave do intervalo do livre/ocupado é estável e não depende da grafia', () => {
    const a = idDoIntervalo('Pessoal@Exemplo.Invalid', '2026-11-05T10:00:00-03:00', '2026-11-05T11:00:00-03:00');
    expect(a).toBe(idDoIntervalo('pessoal@exemplo.invalid', '2026-11-05T13:00:00.000Z', '2026-11-05T14:00:00.000Z'));
    expect(a).not.toBe(idDoIntervalo('pessoal@exemplo.invalid', '2026-11-05T13:00:00.000Z', '2026-11-05T14:30:00.000Z'));
  });

  it('a leitura direta (formato de calendarPeriodo) no formato do espelho', () => {
    const e = eventoDaLeituraDireta(
      { id: 'd1', title: 'Reunião Interna - Todos', start: '2026-11-04T08:00:00-03:00', end: '2026-11-04T09:00:00-03:00', status: 'confirmed', attendees: ['A@exemplo.invalid'], meet: null, organizadorEhAgenda: true },
      [],
    );
    expect(e).toMatchObject({ id: 'd1', origem: 'google', leitura: { tipo: 'interna', responsaveis: ['Rodrigo', 'Lucas', 'Pedro'] }, convidados: [{ email: 'a@exemplo.invalid', resposta: 'pendente' }] });
    expect(eventoDaLeituraDireta({ id: 'sem' }, [])).toBeNull();
  });
});

describe('os efeitos de leitura do Google (chamador de mentira)', () => {
  it('a janela completa: timeMin/timeMax, páginas, o caminho passa na regra do conector', async () => {
    const g = new CalendarioFalso();
    g.por({ id: 'a', summary: 'A', start: { dateTime: '2026-11-01T10:00:00Z' }, end: { dateTime: '2026-11-01T11:00:00Z' } });
    g.por({ id: 'b', summary: 'B', start: { dateTime: '2026-11-02T10:00:00Z' }, end: { dateTime: '2026-11-02T11:00:00Z' } });
    g.por({ id: 'c', summary: 'C', start: { dateTime: '2026-11-03T10:00:00Z' }, end: { dateTime: '2026-11-03T11:00:00Z' } });
    const p1 = await listarPaginaDaAgenda(g, 'org', { de: '2026-10-01T00:00:00Z', ate: '2027-04-01T00:00:00Z' });
    expect(p1.itens).toHaveLength(2);
    expect(p1.nextPageToken).toBe('2');
    const p2 = await listarPaginaDaAgenda(g, 'org', { de: '2026-10-01T00:00:00Z', ate: '2027-04-01T00:00:00Z', pagina: p1.nextPageToken! });
    expect(p2).toMatchObject({ nextPageToken: null, nextSyncToken: `tok-${g.seq}` });
    await expect(listarPaginaDaAgenda(g, 'org', {})).rejects.toThrow(/janela/);
  });

  it('o 410 volta como tokenVencido (a porta perderia o status); outro erro sobe', async () => {
    const g = new CalendarioFalso();
    g.vencidos.add('tok-velho');
    expect(await listarPaginaDaAgenda(g, 'org', { syncToken: 'tok-velho' })).toEqual({ itens: [], nextSyncToken: null, nextPageToken: null, tokenVencido: true });
    const quebrado: ChamadorDaAgenda = { chamarAgenda: async () => { throw new ErroDoGoogle(500, 'falha', '/calendar/v3/x'); } };
    await expect(listarPaginaDaAgenda(quebrado, 'org', { syncToken: 'tok-1' })).rejects.toThrow(/HTTP 500/);
  });

  it('o livre/ocupado: só começo e fim; agenda não compartilhada é erro DELA', async () => {
    const g = new CalendarioFalso();
    g.livreOcupado = {
      'um@exemplo.invalid': [{ start: '2026-11-05T13:00:00Z', end: '2026-11-05T14:00:00Z' }],
      'dois@exemplo.invalid': 'naoCompartilhada',
    };
    const r = await lerLivreOcupado(g, 'org', { agendas: ['um@exemplo.invalid', 'dois@exemplo.invalid'], de: '2026-11-01T00:00:00Z', ate: '2026-11-30T00:00:00Z' });
    expect(r.intervalos).toEqual([{ agenda: 'um@exemplo.invalid', inicio: '2026-11-05T13:00:00.000Z', fim: '2026-11-05T14:00:00.000Z' }]);
    expect(r.erros).toEqual([{ agenda: 'dois@exemplo.invalid', motivo: expect.stringMatching(/não compartilhada/) }]);
    expect(Object.keys(efeitosDaLeituraDaAgenda(g)).sort()).toEqual(['comunicacao.agenda.livre_ocupado', 'comunicacao.agenda.sincronizar']);
  });
});

// ---------------------------------------------------------------------------
// Com banco: a porta de verdade e o calendário em memória
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
const comBanco = !!URL;
if (comBanco) exigirBancoDescartavel(URL!, 'ESCREVE nele (espelho da agenda, rotinas e rastro)');

const MARCA = `es${Date.now().toString(36).slice(-6)}`;
const ORG = `org-espelho-${MARCA}`;
const VIZINHA = `org-espelho-viz-${MARCA}`;
const AGORA = new Date('2026-10-29T14:00:00-03:00');
const H = 3_600_000;
const DIA = 24 * H;
const em = (h: number) => new Date(AGORA.getTime() + h * H).toISOString();

describe.skipIf(!comBanco)('o espelho da agenda pela porta (banco de teste)', () => {
  let prisma: PrismaClient;
  let espelho: EspelhoService;
  let espelhoDaVizinha: EspelhoService;
  const g = new CalendarioFalso();
  const efeitos = new EfeitosRegistry();
  const interruptores = new InterruptoresRegistry();
  let gcalDesligado = false;
  let googleConectado = true;
  const leiturasDiretas: Array<Record<string, unknown>> = [];
  const naEmpresa = <T>(fn: () => Promise<T>, org = ORG): Promise<T> =>
    comContexto({ orgId: org, correlationId: `espelho-${MARCA}-${Math.random().toString(36).slice(2, 8)}`, origem: 'cron' }, fn);

  beforeAll(async () => {
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    for (const id of [ORG, VIZINHA]) await prisma.org.create({ data: { id, name: `Espelho ${id}`, slug: id } });
    const p = prisma as unknown as PrismaService;
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const eventos = new EventLogService(p);
    interruptores.registrar(async (e) =>
      gcalDesligado && e.conector === 'gcal'
        ? ({
            conector: 'gcal', rotuloDoConector: 'Google Agenda', capabilityId: e.capabilityId ?? null, desligadoEm: new Date(),
            desligadoPor: null, motivoDoDesligamento: 'teste', rotulo: 'conector_desligado', motivo: 'Google Agenda desligado (teste).',
          } satisfies RecusaDeConector)
        : null,
    );
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), new ApprovalsService(p, new AuditService(p)), eventos, undefined, interruptores, efeitos);
    const porta = new PortaDoOperador(gateway, efeitos);
    efeitos.registrar(
      {
        ...efeitosDaLeituraDaAgenda(g),
        // A leitura direta (o calendarPeriodo do conector), só para o caminho do espelho atrasado.
        'comunicacao.agenda.periodo': async (a) => {
          leiturasDiretas.push(a);
          return [{ id: 'direto1', title: 'Reunião Interna - Todos', start: em(30), end: em(31), status: 'confirmed', attendees: [], organizadorEhAgenda: true }];
        },
      },
      'calendário em memória (agenda-espelho.test)',
    );
    const conectores = {
      sondar: async () =>
        googleConectado
          ? { estado: 'conectado', mensagem: 'conta de teste', apuracao: 'tentativa', verificadoEm: new Date().toISOString(), latenciaMs: 1 }
          : { estado: 'nao_configurado', mensagem: 'sem conta', apuracao: 'declaracao', verificadoEm: new Date().toISOString(), latenciaMs: null },
    } as unknown as RegistroDeConectores;
    espelho = new EspelhoService(p, porta, interruptores, conectores);
    espelhoDaVizinha = new EspelhoService(p, porta, interruptores, conectores);
    // A empresa do teste FAZ O PAPEL da casa (o slug da plataforma é único no banco e outras suítes o usam).
    vi.spyOn(espelho as unknown as { ehDaCasa: (o: string) => Promise<boolean> }, 'ehDaCasa').mockImplementation(async (o) => o === ORG);

    await prisma.agendaRegraPessoa.createMany({
      data: [
        { orgId: ORG, nome: 'Rodrigo', emailPessoal: 'rodrigo.pessoal@exemplo.invalid', fechadoLigado: true, ordem: 0 },
        { orgId: ORG, nome: 'Lucas', emailPessoal: 'lucas.pessoal@exemplo.invalid', fechadoLigado: true, ordem: 1 },
        { orgId: ORG, nome: 'Pedro', emailPessoal: 'pedro.pessoal@exemplo.invalid', fechadoLigado: false, ordem: 2 },
      ],
    });

    g.por({ id: 'r1', summary: 'Reunião Online - Andrade Peças - Pedro', start: { dateTime: em(24) }, end: { dateTime: em(25) }, hangoutLink: 'https://meet.exemplo.invalid/r1' });
    g.por({ id: 'r2', summary: 'Reunião Interna - Todos', start: { dateTime: em(48) }, end: { dateTime: em(49) } });
    g.por({ id: 'r3', summary: 'Rodrigo Fora - curso', start: { dateTime: em(72) }, end: { dateTime: em(80) } });
    g.por({ id: 'longe', summary: 'Fora da janela', start: { dateTime: em(24 * 400) }, end: { dateTime: em(24 * 400 + 1) } });
    g.livreOcupado = {
      'rodrigo.pessoal@exemplo.invalid': [{ start: em(26), end: em(27) }],
      'lucas.pessoal@exemplo.invalid': 'naoCompartilhada',
    };
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    for (const org of [ORG, VIZINHA]) {
      await prisma.$transaction([
        prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
        prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', org),
        prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
      ]);
      await prisma.agendaEvento.deleteMany({ where: { orgId: org } });
      await prisma.agendaSincronia.deleteMany({ where: { orgId: org } });
      await prisma.agendaRegraPessoa.deleteMany({ where: { orgId: org } });
      await prisma.rotina.deleteMany({ where: { orgId: org } });
      await prisma.policyDecision.deleteMany({ where: { orgId: org } }).catch(() => undefined);
      await prisma.toolCall.deleteMany({ where: { orgId: org } }).catch(() => undefined);
      await prisma.org.deleteMany({ where: { id: org } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  const linha = (googleId: string, agenda = 'primary') =>
    prisma.agendaEvento.findUnique({ where: { orgId_agenda_googleId: { orgId: ORG, agenda, googleId } } });

  it('o executor se inscreve como agenda.sincronizar e agenda.copia', () => {
    const registro = new ExecutoresDeRotinaRegistry();
    new ExecutorDoEspelhoDaAgenda(espelho, new CopiaDaAgendaService(prisma as unknown as PrismaService, espelho), registro).onModuleInit();
    expect(registro.tem(TIPO_AGENDA_SINCRONIZAR)).toBe(true);
    expect(registro.tem(TIPO_AGENDA_COPIA)).toBe(true);
  });

  it('fora da casa: pulada sem ler nada, e a rotina não é semeada', async () => {
    const n = g.pedidos.length;
    expect(await naEmpresa(() => espelhoDaVizinha.passagem(VIZINHA, AGORA), VIZINHA)).toEqual({ status: 'pulada', resumo: RESUMO_FORA_DA_CASA });
    await naEmpresa(() => espelhoDaVizinha.garantirRotinas(VIZINHA, AGORA), VIZINHA);
    expect(await prisma.rotina.count({ where: { orgId: VIZINHA } })).toBe(0);
    expect(g.pedidos.length).toBe(n);
  });

  it('Google Agenda desligado ou Google não conectado: pulada, nada lido', async () => {
    const n = g.pedidos.length;
    gcalDesligado = true;
    expect((await naEmpresa(() => espelho.passagem(ORG, AGORA))).status).toBe('pulada');
    gcalDesligado = false;
    googleConectado = false;
    expect(await naEmpresa(() => espelho.passagem(ORG, AGORA))).toMatchObject({ status: 'pulada', resumo: expect.stringMatching(/não conectado/) });
    googleConectado = true;
    expect(g.pedidos.length).toBe(n);
  });

  it('antes da primeira passagem: espelho atrasado, a leitura vai direto ao Google pela porta, em nome de quem lê', async () => {
    const r = await naEmpresa(() => espelho.periodo(ORG, AGORA, new Date(AGORA.getTime() + 7 * DIA), { agora: AGORA, actorId: 'pessoa-teste' }));
    expect(r.fonte).toBe('google');
    expect(r.sincronia).toMatchObject({ ultimaPassagem: null, atrasada: true });
    expect(r.eventos.map((e) => e.id)).toEqual(['direto1']);
    expect(leiturasDiretas).toHaveLength(1);
    // Sem Google e sem espelho ainda: lista vazia com o motivo, sem lançar.
    googleConectado = false;
    const sem = await naEmpresa(() => espelho.periodo(ORG, AGORA, new Date(AGORA.getTime() + DIA), { agora: AGORA }));
    googleConectado = true;
    expect(sem).toMatchObject({ eventos: [], sincronia: { atrasada: true, erro: expect.stringMatching(/não conectado/) } });
  });

  it('a primeira passagem (janela completa, em páginas) grava o espelho e o Fechado sem título', async () => {
    const r = await naEmpresa(() => espelho.passagem(ORG, AGORA));
    expect(r.status).toBe('ok');
    expect(r.resumo).toMatch(/janela completa/);
    expect(r.resumo).not.toMatch(/Andrade/);
    const janela = g.pedidos.filter((c) => c.includes('timeMin'));
    expect(janela.length).toBeGreaterThanOrEqual(2);
    expect(await linha('r1')).toMatchObject({ titulo: 'Reunião Online - Andrade Peças - Pedro', leituraTipo: 'cliente', leituraCliente: 'Andrade Peças', meet: 'https://meet.exemplo.invalid/r1', status: 'confirmado' });
    expect(await linha('r3')).toMatchObject({ leituraTipo: 'fora', leituraMotivo: 'curso' });
    expect(await linha('longe')).toBeNull();
    const sinc = await prisma.agendaSincronia.findUniqueOrThrow({ where: { orgId_agenda: { orgId: ORG, agenda: 'primary' } } });
    expect(sinc).toMatchObject({ syncToken: `tok-${g.seq}`, erro: null });
    expect(sinc.ultimaCompleta?.toISOString()).toBe(AGORA.toISOString());

    const fechados = await prisma.agendaEvento.findMany({ where: { orgId: ORG, origem: 'livre_ocupado' } });
    expect(fechados).toHaveLength(1);
    expect(fechados[0]).toMatchObject({ agenda: 'rodrigo.pessoal@exemplo.invalid', titulo: null, descricao: null, local: null, leituraTipo: 'fechado', leituraResponsaveis: ['Rodrigo'] });
    // A agenda não compartilhada: erro dela, a da casa segue; Pedro (Fechado desligado) nem é pedido.
    const lucas = await prisma.agendaSincronia.findUniqueOrThrow({ where: { orgId_agenda: { orgId: ORG, agenda: 'lucas.pessoal@exemplo.invalid' } } });
    expect(lucas.erro).toMatch(/não compartilhada/);
    expect(g.pedidos.filter((c) => c === '/calendar/v3/freeBusy').length).toBeGreaterThan(0);
  });

  it('com o espelho em dia, a leitura sai dele (sem Google), com o Fechado e sem cancelados', async () => {
    const n = leiturasDiretas.length;
    const r = await naEmpresa(() => espelho.periodo(ORG, AGORA, new Date(AGORA.getTime() + 7 * DIA), { agora: new Date(AGORA.getTime() + 60_000) }));
    expect(r.fonte).toBe('espelho');
    expect(r.sincronia.atrasada).toBe(false);
    expect(r.eventos.map((e) => e.id)).toEqual(['r1', expect.stringMatching(/^lo-/), 'r2', 'r3']);
    expect(r.eventos[1]).toMatchObject({ origem: 'livre_ocupado', titulo: null, leitura: { tipo: 'fechado', responsaveis: ['Rodrigo'] } });
    expect(leiturasDiretas.length).toBe(n);
  });

  it('incremental: só o que mudou; evento movido; cancelado vira `cancelado` sem apagar a linha', async () => {
    const depois = new Date(AGORA.getTime() + 2 * 60_000);
    g.mexer('r2', { start: { dateTime: em(50) }, end: { dateTime: em(51) } });
    g.mexer('r1', { status: 'cancelled' });
    g.por({ id: 'r4', summary: 'Fechado Lucas', start: { dateTime: em(96) }, end: { dateTime: em(98) } });
    const antes = g.pedidos.length;
    const r = await naEmpresa(() => espelho.passagem(ORG, depois));
    expect(r.status).toBe('ok');
    expect(r.resumo).toMatch(/incremental/);
    const novos = g.pedidos.slice(antes).filter((c) => c.includes('/events'));
    expect(novos.every((c) => c.includes('syncToken=') && !c.includes('timeMin'))).toBe(true);
    expect((await linha('r2'))?.inicio.toISOString()).toBe(new Date(em(50)).toISOString());
    expect(await linha('r1')).toMatchObject({ status: 'cancelado', titulo: 'Reunião Online - Andrade Peças - Pedro' });
    expect(await linha('r4')).toMatchObject({ leituraTipo: 'fechado', leituraResponsaveis: ['Lucas'] });
    const vista = await naEmpresa(() => espelho.periodo(ORG, AGORA, new Date(AGORA.getTime() + 7 * DIA), { agora: depois }));
    expect(vista.eventos.map((e) => e.id)).not.toContain('r1');
    const comCancelados = await naEmpresa(() => espelho.periodo(ORG, AGORA, new Date(AGORA.getTime() + 7 * DIA), { agora: depois, incluirCancelados: true }));
    expect(comCancelados.eventos.find((e) => e.id === 'r1')?.status).toBe('cancelado');
  });

  it('passagem sem nada novo é `pulada`, mas carimba a última passagem', async () => {
    const quando = new Date(AGORA.getTime() + 4 * 60_000);
    expect(await naEmpresa(() => espelho.passagem(ORG, quando))).toMatchObject({ status: 'pulada' });
    expect((await naEmpresa(() => espelho.estado(ORG, quando))).ultimaPassagem).toBe(quando.toISOString());
  });

  it('M1: espelho atrasado e Google desconectado: devolve o espelho velho, marcado atrasado e com o motivo, nunca a lista vazia', async () => {
    const tarde = new Date(AGORA.getTime() + 30 * 60_000);
    const n = leiturasDiretas.length;
    googleConectado = false;
    let r;
    try {
      r = await naEmpresa(() => espelho.periodo(ORG, AGORA, new Date(AGORA.getTime() + 7 * DIA), { agora: tarde }));
    } finally {
      googleConectado = true;
    }
    expect(r.fonte).toBe('espelho');
    expect(r.sincronia).toMatchObject({ atrasada: true, erro: expect.stringMatching(/não conectado/) });
    expect(r.eventos.length).toBeGreaterThan(0);
    expect(r.eventos.map((e) => e.id)).toContain('r2');
    expect(leiturasDiretas.length).toBe(n);
  });

  it('o Fechado é trocado a cada passagem: intervalo novo entra, o que saiu do Google sai do espelho; Fechado desligado leva as linhas', async () => {
    g.livreOcupado['rodrigo.pessoal@exemplo.invalid'] = [{ start: em(28), end: em(29) }];
    const quando = new Date(AGORA.getTime() + 6 * 60_000);
    expect((await naEmpresa(() => espelho.passagem(ORG, quando))).status).toBe('ok');
    const lo = await prisma.agendaEvento.findMany({ where: { orgId: ORG, origem: 'livre_ocupado' } });
    expect(lo.map((l) => l.inicio.toISOString())).toEqual([new Date(em(28)).toISOString()]);
    expect(lo[0].googleId).toBe(idDoIntervalo('rodrigo.pessoal@exemplo.invalid', em(28), em(29)));

    await prisma.agendaRegraPessoa.updateMany({ where: { orgId: ORG, nome: 'Rodrigo' }, data: { fechadoLigado: false } });
    await naEmpresa(() => espelho.passagem(ORG, new Date(AGORA.getTime() + 8 * 60_000)));
    expect(await prisma.agendaEvento.count({ where: { orgId: ORG, origem: 'livre_ocupado' } })).toBe(0);
    await prisma.agendaRegraPessoa.updateMany({ where: { orgId: ORG, nome: 'Rodrigo' }, data: { fechadoLigado: true } });
  });

  it('410: o token venceu, a sincronia refaz a janela inteira; o que o Google não devolveu vira cancelado (nunca apagado)', async () => {
    const sinc = await prisma.agendaSincronia.findUniqueOrThrow({ where: { orgId_agenda: { orgId: ORG, agenda: 'primary' } } });
    g.vencidos.add(sinc.syncToken!);
    // r3 some do Google sem deixar cancelado (apagado de vez, fora do alcance do showDeleted).
    g.eventos.delete('r3');
    const antes = g.pedidos.length;
    const quando = new Date(AGORA.getTime() + 10 * 60_000);
    const r = await naEmpresa(() => espelho.passagem(ORG, quando));
    expect(r.resumo).toMatch(/janela completa/);
    const pedidos = g.pedidos.slice(antes).filter((c) => c.includes('/events'));
    expect(pedidos[0]).toContain('syncToken=');
    expect(pedidos.slice(1).every((c) => c.includes('timeMin'))).toBe(true);
    expect(await linha('r3')).toMatchObject({ status: 'cancelado', titulo: 'Rodrigo Fora - curso' });
    expect(await linha('r2')).toMatchObject({ status: 'confirmado' });
    const depois = await prisma.agendaSincronia.findUniqueOrThrow({ where: { orgId_agenda: { orgId: ORG, agenda: 'primary' } } });
    expect(depois.syncToken).toBe(`tok-${g.seq}`);
    expect(depois.ultimaCompleta?.toISOString()).toBe(quando.toISOString());
  });

  it('o Google fora do ar: a passagem falha, o erro fica na sincronia e nada é dado por cancelado', async () => {
    const original = g.chamarAgenda.bind(g);
    g.chamarAgenda = async () => { throw new ErroDoGoogle(503, 'indisponível', '/calendar/v3/calendars/primary/events'); };
    const ativos = await prisma.agendaEvento.count({ where: { orgId: ORG, status: { not: 'cancelado' } } });
    await expect(naEmpresa(() => espelho.passagem(ORG, new Date(AGORA.getTime() + 12 * 60_000)))).rejects.toThrow(/HTTP 503/);
    g.chamarAgenda = original;
    expect((await naEmpresa(() => espelho.estado(ORG, new Date(AGORA.getTime() + 12 * 60_000)))).erro).toMatch(/HTTP 503/);
    expect(await prisma.agendaEvento.count({ where: { orgId: ORG, status: { not: 'cancelado' } } })).toBe(ativos);
  });

  it('refletir: o evento que a escrita devolveu entra no espelho na hora (e o cancelado muda de estado)', async () => {
    const cru = {
      id: 'os1',
      status: 'confirmed',
      summary: 'Fechado Pedro',
      start: { dateTime: em(120) },
      end: { dateTime: em(121) },
      extendedProperties: { private: { [PROPRIEDADES_DO_OS.criadoPeloOs]: '1' } },
    };
    const e = await naEmpresa(() => espelho.refletir(ORG, cru));
    expect(e).toMatchObject({ id: 'os1', criadoPeloOs: true, leitura: { tipo: 'fechado', responsaveis: ['Pedro'] } });
    const c = await naEmpresa(() => espelho.refletir(ORG, { ...cru, status: 'cancelled' }));
    expect(c?.status).toBe('cancelado');
    expect(await naEmpresa(() => espelho.refletir(ORG, { id: 'nunca-visto', status: 'cancelled' }))).toBeNull();
    expect(await naEmpresa(() => espelho.refletir(ORG, { nada: true }))).toBeNull();
  });

  it('isolamento: a linha de uma empresa não aparece na leitura da outra', async () => {
    await naEmpresa(() => espelhoDaVizinha.refletir(VIZINHA, { id: 'viz1', summary: 'Reunião Interna - Pedro', start: { dateTime: em(30) }, end: { dateTime: em(31) } }), VIZINHA);
    await prisma.agendaSincronia.create({ data: { orgId: VIZINHA, agenda: 'primary', ultimaPassagem: AGORA } });
    const daVizinha = await naEmpresa(() => espelhoDaVizinha.doEspelho(VIZINHA, AGORA, new Date(AGORA.getTime() + 7 * DIA)), VIZINHA);
    expect(daVizinha.map((e) => e.id)).toEqual(['viz1']);
    const daCasa = await naEmpresa(() => espelho.doEspelho(ORG, AGORA, new Date(AGORA.getTime() + 7 * DIA)));
    expect(daCasa.map((e) => e.id)).not.toContain('viz1');
  });

  it('as rotinas: semeadas só na casa, LIGADAS com o Google conectado; uma vez só', async () => {
    await naEmpresa(() => espelho.garantirRotinas(ORG, AGORA));
    const rotinas = await prisma.rotina.findMany({ where: { orgId: ORG }, orderBy: { slug: 'asc' } });
    expect(rotinas.map((r) => [r.slug, r.tipo, r.cron, r.tz, r.ativo, r.estado])).toEqual([
      [SLUG_DA_COPIA, TIPO_AGENDA_COPIA, '0 3 * * *', 'America/Sao_Paulo', true, 'rodando'],
      [SLUG_DO_ESPELHO, TIPO_AGENDA_SINCRONIZAR, '*/2 * * * *', 'America/Sao_Paulo', true, 'rodando'],
    ]);
    // Pausada à mão, a semente não a religa.
    await prisma.rotina.updateMany({ where: { orgId: ORG, slug: SLUG_DO_ESPELHO }, data: { ativo: false } });
    await naEmpresa(() => espelho.garantirRotinas(ORG, AGORA));
    expect((await prisma.rotina.findFirstOrThrow({ where: { orgId: ORG, slug: SLUG_DO_ESPELHO } })).ativo).toBe(false);
  });

  it('sem Google conectado, as rotinas nascem DESLIGADAS', async () => {
    const outro = new EspelhoService(
      prisma as unknown as PrismaService,
      {} as PortaDoOperador,
      interruptores,
      { sondar: async () => ({ estado: 'nao_configurado' }) } as unknown as RegistroDeConectores,
    );
    vi.spyOn(outro as unknown as { ehDaCasa: (o: string) => Promise<boolean> }, 'ehDaCasa').mockImplementation(async (o) => o === VIZINHA);
    await naEmpresa(() => outro.garantirRotinas(VIZINHA, AGORA), VIZINHA);
    const rotinas = await prisma.rotina.findMany({ where: { orgId: VIZINHA } });
    expect(rotinas).toHaveLength(2);
    expect(rotinas.every((r) => !r.ativo && r.estado === 'planejado')).toBe(true);
  });

  it('o cartão da implantação lê do espelho em dia (sem a porta) e cai na porta com o espelho atrasado', async () => {
    const quando = new Date(AGORA.getTime() + 11 * 60_000);
    await prisma.agendaSincronia.update({ where: { orgId_agenda: { orgId: ORG, agenda: 'primary' } }, data: { ultimaPassagem: quando, erro: null } });
    const chamadas: unknown[] = [];
    const porta = { executar: async (e: unknown) => { chamadas.push(e); return []; } } as unknown as PortaDoOperador;
    const svc = new AgendaDaImplantacaoService(porta, espelho);
    svc.agora = () => quando;
    const r = await naEmpresa(() => svc.ler(ORG, 'pessoa-teste'));
    expect(r.ok).toBe(true);
    expect(chamadas).toHaveLength(0);
    if (r.ok) {
      expect(r.eventos.map((e) => e.id)).toContain('r2');
      expect(r.eventos.find((e) => e.id === 'r1')).toBeUndefined();
      expect(r.eventos.every((e) => !String(e.id).startsWith('lo-'))).toBe(true);
    }
    const atrasado = new AgendaDaImplantacaoService(porta, espelho);
    atrasado.agora = () => new Date(quando.getTime() + 11 * 60_000);
    await naEmpresa(() => atrasado.ler(ORG, 'pessoa-teste'));
    expect(chamadas).toHaveLength(1);
  });

  it('a leitura direta acontece com o actor de gente e o RASTRO da porta registra o sistema na sincronia', async () => {
    const chamadas = await prisma.toolCall.findMany({ where: { orgId: ORG, capabilityId: 'comunicacao.agenda.sincronizar' }, select: { actorType: true, actorId: true, status: true } });
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas.every((c) => c.actorType === ActorType.system && c.actorId === SLUG_DO_ESPELHO)).toBe(true);
    const diretas = await prisma.toolCall.findMany({ where: { orgId: ORG, capabilityId: 'comunicacao.agenda.periodo' }, select: { actorType: true, actorId: true } });
    expect(diretas[0]).toMatchObject({ actorType: ActorType.user, actorId: 'pessoa-teste' });
  });
});
