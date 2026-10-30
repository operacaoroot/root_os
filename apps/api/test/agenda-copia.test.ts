import { describe, expect, it, vi } from 'vitest';
import type { EventoDaAgenda } from '@mktos/shared';

import { CopiaDaAgendaService } from '../src/agenda/espelho/copia-da-agenda.service';
import { chavesParaApagar, diaEmSaoPaulo, icsDaCopia, jsonDaCopia } from '../src/agenda/espelho/copia-da-agenda';
import type { EspelhoService } from '../src/agenda/espelho/espelho.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { StorageService } from '../src/storage/storage.service';

/*
 * A CÓPIA DIÁRIA DA AGENDA (agenda v2, 29/10/2026, lane G7).
 *
 * Sem banco: o espelho e o armazém são dublês. Prova-se o JSON e o ICS, as
 * chaves `agenda/copia/AAAA-MM-DD.json|.ics`, os 30 dias guardados (só o
 * prefixo do OS é tocado), o "pulada" sem armazém e fora da casa.
 */

const AGORA = new Date('2026-10-30T06:00:00.000Z'); // 03:00 de São Paulo

const evento = (over: Partial<EventoDaAgenda>): EventoDaAgenda => ({
  id: 'ev1',
  agenda: 'primary',
  origem: 'google',
  titulo: 'Reunião Online - Fictícia Peças, filial; Centro - Pedro',
  inicio: '2026-11-03T13:00:00.000Z',
  fim: '2026-11-03T14:00:00.000Z',
  diaInteiro: false,
  local: null,
  meet: 'https://meet.exemplo.invalid/abc',
  convidados: [],
  organizador: 'operacao.root@exemplo.invalid',
  organizadorEhAgenda: true,
  status: 'confirmado',
  atualizadoNoGoogle: null,
  serieId: null,
  criadoPeloOs: false,
  link: null,
  leitura: { tipo: 'cliente', modalidade: 'online', cliente: 'Fictícia Peças', responsaveis: ['Pedro'], motivo: null, feriado: null },
  ...over,
});

const EVENTOS: EventoDaAgenda[] = [
  evento({}),
  evento({ id: 'fer', titulo: 'Finados', inicio: '2026-11-02T03:00:00.000Z', fim: '2026-11-03T03:00:00.000Z', diaInteiro: true, meet: null }),
  evento({ id: 'lo-1', origem: 'livre_ocupado', agenda: 'pessoal@exemplo.invalid', titulo: null, meet: null, leitura: { tipo: 'fechado', modalidade: null, cliente: null, responsaveis: ['Rodrigo'], motivo: null, feriado: null } }),
  evento({ id: 'canc', status: 'cancelado', titulo: 'Reunião Interna - Todos' }),
];

describe('a cópia em arquivo (puro)', () => {
  it('o dia é o de São Paulo', () => {
    expect(diaEmSaoPaulo(new Date('2026-10-30T02:30:00.000Z'))).toBe('2026-10-29');
    expect(diaEmSaoPaulo(AGORA)).toBe('2026-10-30');
  });

  it('o JSON leva a janela, o total e os eventos como a tela os recebe', () => {
    const j = JSON.parse(jsonDaCopia(EVENTOS, AGORA, new Date('2026-09-30T06:00:00Z'), new Date('2027-04-28T06:00:00Z')));
    expect(j).toMatchObject({ versao: 1, geradaEm: AGORA.toISOString(), total: 4, janela: { de: '2026-09-30T06:00:00.000Z' } });
    expect(j.eventos.map((e: EventoDaAgenda) => e.id)).toEqual(['ev1', 'fer', 'lo-1', 'canc']);
  });

  it('o ICS: CRLF, escape, dia inteiro em DATE, Fechado sem título vira "Fechado <Nome>", cancelado com STATUS', () => {
    const ics = icsDaCopia(EVENTOS, AGORA);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('BEGIN:VEVENT')).toHaveLength(5);
    expect(ics).toContain('SUMMARY:Reunião Online - Fictícia Peças\\, filial\\; Centro - Pedro');
    expect(ics).toContain('DTSTART:20261103T130000Z');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261103');
    expect(ics).toContain('SUMMARY:Fechado Rodrigo');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('URL:https://meet.exemplo.invalid/abc');
    // Nenhuma linha passa de 75 octetos.
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it('o ICS dobra linha longa sem partir caractere', () => {
    const ics = icsDaCopia([evento({ titulo: `Reunião Online - ${'Ção'.repeat(40)} - Pedro` })], AGORA);
    const desdobrado = ics.replace(/\r\n /g, '');
    expect(desdobrado).toContain(`SUMMARY:Reunião Online - ${'Ção'.repeat(40)} - Pedro`);
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it('30 dias guardados: sai o que é mais velho, e só chave do próprio padrão', () => {
    const chaves = [
      'agenda/copia/2026-10-30.json',
      'agenda/copia/2026-10-01.ics',
      'agenda/copia/2026-09-30.json',
      'agenda/copia/2026-09-30.ics',
      'agenda/copia/2025-01-01.json',
      'agenda/copia/leia-me.txt',
      'agenda/copia/2025-01-01.json.bak',
    ];
    expect(chavesParaApagar(chaves, '2026-10-30')).toEqual(['agenda/copia/2026-09-30.json', 'agenda/copia/2026-09-30.ics', 'agenda/copia/2025-01-01.json']);
  });
});

describe('a rotina agenda.copia (dublês do espelho e do armazém)', () => {
  const montar = (opcoes: { configurado?: boolean; casa?: boolean } = {}) => {
    const gravados = new Map<string, { corpo: string; tipo: string }>();
    const removidos: string[] = [];
    gravados.set('agenda/copia/2026-09-01.json', { corpo: '{}', tipo: 'application/json' });
    gravados.set('agenda/copia/2026-10-15.ics', { corpo: '', tipo: 'text/calendar' });
    gravados.set('pauta/thumb/x.png', { corpo: '', tipo: 'image/png' });
    const storage = {
      configured: opcoes.configurado ?? true,
      put: async (k: string, b: Buffer, tipo: string) => void gravados.set(k, { corpo: b.toString('utf8'), tipo }),
      listar: async (prefixo: string) =>
        [...gravados.keys()].filter((k) => k.startsWith(prefixo)).map((chave) => ({ chave, bytes: 1, modificadoEm: new Date(0) })),
      remover: async (k: string) => {
        removidos.push(k);
        gravados.delete(k);
      },
    } as unknown as StorageService;
    const pedidos: Array<{ de: Date; ate: Date; opcoes: unknown }> = [];
    const espelho = {
      janela: (agora: Date) => ({ de: new Date(agora.getTime() - 30 * 86_400_000), ate: new Date(agora.getTime() + 180 * 86_400_000) }),
      doEspelho: async (_org: string, de: Date, ate: Date, o: unknown) => {
        pedidos.push({ de, ate, opcoes: o });
        return EVENTOS;
      },
    } as unknown as EspelhoService;
    const svc = new CopiaDaAgendaService({} as PrismaService, espelho, storage);
    vi.spyOn(svc as unknown as { ehDaCasa: (o: string) => Promise<boolean> }, 'ehDaCasa').mockResolvedValue(opcoes.casa ?? true);
    return { svc, gravados, removidos, pedidos };
  };

  it('grava JSON e ICS do dia, com os cancelados, e apaga só a cópia de mais de 30 dias', async () => {
    const { svc, gravados, removidos, pedidos } = montar();
    const r = await svc.copiar('org-copia', AGORA);
    expect(r.status).toBe('ok');
    expect(r.resumo).toMatch(/4 compromisso/);
    expect(r.resumo).not.toMatch(/Fictícia/);
    expect(gravados.get('agenda/copia/2026-10-30.json')?.tipo).toMatch(/application\/json/);
    expect(gravados.get('agenda/copia/2026-10-30.ics')?.corpo).toContain('BEGIN:VCALENDAR');
    expect(removidos).toEqual(['agenda/copia/2026-09-01.json']);
    expect(gravados.has('pauta/thumb/x.png')).toBe(true);
    expect(pedidos[0].opcoes).toEqual({ incluirCancelados: true });
    expect((pedidos[0].ate.getTime() - pedidos[0].de.getTime()) / 86_400_000).toBe(210);
  });

  it('sem armazém configurado: pulada com o motivo, nada gravado', async () => {
    const { svc, gravados } = montar({ configurado: false });
    const antes = gravados.size;
    expect(await svc.copiar('org-copia', AGORA)).toMatchObject({ status: 'pulada', resumo: expect.stringMatching(/armazém/) });
    expect(gravados.size).toBe(antes);
  });

  it('fora da casa: pulada', async () => {
    const { svc, gravados } = montar({ casa: false });
    const antes = gravados.size;
    expect((await svc.copiar('org-copia', AGORA)).status).toBe('pulada');
    expect(gravados.size).toBe(antes);
  });

  it('sem StorageService no módulo: pulada, não lança', async () => {
    const svc = new CopiaDaAgendaService({} as PrismaService, {} as EspelhoService);
    vi.spyOn(svc as unknown as { ehDaCasa: (o: string) => Promise<boolean> }, 'ehDaCasa').mockResolvedValue(true);
    expect((await svc.copiar('org-copia', AGORA)).status).toBe('pulada');
  });
});
