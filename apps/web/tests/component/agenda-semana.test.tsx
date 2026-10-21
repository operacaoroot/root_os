import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { diasDaSemana, eventosPorDia, inicioDoDiaNoFuso, intervaloDosDias, lerEstadoDaAgenda, noFuso } from '@/app/agenda/semana';
import type { EventoDaAgenda } from '@/app/agenda/tipos';

/*
 * P2 da rodada de produção 1 (21/10/2026): a Agenda ganha a visão da SEMANA
 * (e do dia), com o estado no endereço, setas e "Hoje". No computador a semana
 * é uma grade de horas das 07h às 22h com os eventos de dia inteiro no topo;
 * no celular (< 640 px), uma lista por dia. Horário de America/Sao_Paulo.
 */

const apiGet = vi.fn();
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  apiGet: (...args: unknown[]) => apiGet(...args),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, can: (p: string) => p === 'tarefas.ver' }),
}));
vi.mock('@/components/modulos', () => ({ useModulos: () => ({ modulos: ['trabalho'] }) }));

import AgendaPage from '@/app/agenda/page';

const evento = (id: string, start: string, end: string | null, diaInteiro = false, title = `Reunião Online - Cliente ${id} - Pedro`): EventoDaAgenda => ({
  id, title, reuniao: { tipo: 'cliente', modalidade: 'online', cliente: `Cliente ${id}`, responsavel: 'Pedro' } as EventoDaAgenda['reuniao'],
  start, end, diaInteiro, location: null, description: null, link: null, meet: null, status: null, organizador: null, attendees: [],
});

const EVENTOS: EventoDaAgenda[] = [
  // 12:00 UTC = 09:00 em São Paulo.
  evento('A', '2026-10-21T12:00:00.000Z', '2026-10-21T13:00:00.000Z'),
  // 01:30 UTC do dia 22 = 22:30 do dia 21 em São Paulo: o dia é o 21, não o 22.
  evento('B', '2026-10-22T01:30:00.000Z', '2026-10-22T02:00:00.000Z'),
  evento('C', '2026-10-23', '2026-10-24', true),
];

function chamadasDoPeriodo(): string[] {
  return apiGet.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('/google/calendar/periodo'));
}

function comMatchMedia(celular: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: celular && q.includes('max-width'), media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T15:00:00.000Z'));
  apiGet.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/google/calendar/periodo')) return Promise.resolve(EVENTOS);
    if (path.startsWith('/trabalho/tarefas')) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve([]);
  });
  comMatchMedia(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
  delete (window as unknown as Record<string, unknown>).matchMedia;
});

describe('P2 · a conta da semana no fuso de São Paulo', () => {
  it('a semana vai de domingo a sábado e o intervalo é meia-noite de São Paulo', () => {
    const dias = diasDaSemana('2026-10-21');
    expect(dias[0]).toBe('2026-10-18');
    expect(dias[6]).toBe('2026-10-24');
    const { de, ate } = intervaloDosDias(dias);
    expect(de.toISOString()).toBe('2026-10-18T03:00:00.000Z');
    expect(ate.toISOString()).toBe('2026-10-25T03:00:00.000Z');
    expect(inicioDoDiaNoFuso('2026-01-01').toISOString()).toBe('2026-01-01T03:00:00.000Z');
  });

  it('o instante vira dia e minuto de São Paulo, nunca UTC cru', () => {
    expect(noFuso(new Date('2026-10-22T01:30:00.000Z'))).toEqual({ dia: '2026-10-21', minutos: 22 * 60 + 30 });
    const [, , , quarta, , sexta] = eventosPorDia(EVENTOS, diasDaSemana('2026-10-21'));
    expect(quarta.comHora.map((x) => x.evento.id)).toEqual(['A', 'B']);
    expect(sexta.diaInteiro.map((e) => e.id)).toEqual(['C']);
  });

  it('o endereço manda: visão e dia válidos, o resto cai no mês de hoje', () => {
    expect(lerEstadoDaAgenda('?visao=semana&dia=2026-10-21', '2026-10-20')).toEqual({ visao: 'semana', dia: '2026-10-21' });
    expect(lerEstadoDaAgenda('?visao=ano&dia=2026-02-31', '2026-10-20')).toEqual({ visao: 'mes', dia: '2026-10-20' });
  });
});

describe('P2 · a tela da Agenda', () => {
  it('semana no computador: grade de 07h a 22h, dia inteiro no topo, intervalo da semana', async () => {
    window.history.replaceState({}, '', '/agenda?visao=semana&dia=2026-10-21');
    render(<AgendaPage />);
    const grade = await waitFor(() => {
      const g = document.querySelector('[data-visao-da-agenda="grade"]');
      expect(g).toBeTruthy();
      return g as HTMLElement;
    });
    await waitFor(() => expect(grade.querySelector('[data-evento="A"]')).toBeTruthy());
    expect(chamadasDoPeriodo().at(-1)).toBe(
      `/google/calendar/periodo?de=${encodeURIComponent('2026-10-18T03:00:00.000Z')}&ate=${encodeURIComponent('2026-10-25T03:00:00.000Z')}`,
    );
    // 09:00 em São Paulo: duas horas abaixo das 07h, 48 px por hora.
    const a = grade.querySelector('[data-evento="A"]') as HTMLElement;
    expect(a.style.top).toBe('96px');
    expect(a.textContent).toContain('09:00');
    // O das 22:30 de São Paulo fica na coluna do dia 21.
    expect(grade.querySelector('[data-coluna-do-dia="2026-10-21"] [data-evento="B"]')).toBeTruthy();
    // Dia inteiro na faixa do topo; a grade rola na vertical, não de lado.
    expect(within(grade.querySelector('[data-faixa-dia-inteiro]') as HTMLElement).getByText('Cliente C')).toBeTruthy();
    const rolagem = grade.querySelector('[data-rolagem-da-grade]') as HTMLElement;
    expect(rolagem.className).toContain('overflow-y-auto');
    expect(rolagem.className).toContain('overflow-x-hidden');
    expect(screen.getByText('18/10 a 24/10')).toBeTruthy();
  });

  it('troca Mês · Semana · Dia, setas e Hoje mudam o endereço e o intervalo buscado', async () => {
    window.history.replaceState({}, '', '/agenda?visao=semana&dia=2026-10-21');
    render(<AgendaPage />);
    await waitFor(() => expect(document.querySelector('[data-visao-da-agenda="grade"]')).toBeTruthy());

    fireEvent.click(screen.getByTitle('Próxima'));
    await waitFor(() => expect(screen.getByText('25/10 a 31/10')).toBeTruthy());
    expect(window.location.search).toBe('?visao=semana&dia=2026-10-28');
    await waitFor(() => expect(chamadasDoPeriodo().at(-1)).toContain(encodeURIComponent('2026-10-25T03:00:00.000Z')));

    fireEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(window.location.search).toBe('?visao=semana&dia=2026-10-21');

    fireEvent.click(screen.getByRole('button', { name: 'Mês' }));
    expect(window.location.search).toBe('?visao=mes&dia=2026-10-21');
    await waitFor(() => expect(document.querySelector('[data-visao-da-agenda]')).toBeNull());
    expect(screen.getByText(/outubro de 2026/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mês' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Dia' }));
    expect(window.location.search).toBe('?visao=dia&dia=2026-10-21');
    await waitFor(() => expect(document.querySelectorAll('[data-coluna-do-dia]').length).toBe(1));
    await waitFor(() =>
      expect(chamadasDoPeriodo().at(-1)).toBe(
        `/google/calendar/periodo?de=${encodeURIComponent('2026-10-21T03:00:00.000Z')}&ate=${encodeURIComponent('2026-10-22T03:00:00.000Z')}`,
      ),
    );
    fireEvent.click(screen.getByTitle('Anterior'));
    expect(window.location.search).toBe('?visao=dia&dia=2026-10-20');
  });

  it('clicar num evento da semana abre o dia por extenso no cartão de baixo', async () => {
    window.history.replaceState({}, '', '/agenda?visao=semana&dia=2026-10-18');
    render(<AgendaPage />);
    await waitFor(() => expect(document.querySelector('[data-evento="A"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-evento="A"]') as HTMLElement);
    expect(window.location.search).toBe('?visao=semana&dia=2026-10-21');
    expect(await screen.findByText('09:00–10:00')).toBeTruthy();
  });

  it('no celular a semana vira lista por dia, sem grade e sem rolagem lateral', async () => {
    comMatchMedia(true);
    window.history.replaceState({}, '', '/agenda?visao=semana&dia=2026-10-21');
    render(<AgendaPage />);
    const lista = await waitFor(() => {
      const l = document.querySelector('[data-visao-da-agenda="lista"]');
      expect(l).toBeTruthy();
      return l as HTMLElement;
    });
    expect(document.querySelector('[data-visao-da-agenda="grade"]')).toBeNull();
    expect(lista.querySelectorAll(':scope > li').length).toBe(7);
    await waitFor(() => expect(within(lista).getByText('Cliente A')).toBeTruthy());
    expect(within(lista).getByText('09:00–10:00')).toBeTruthy();
    expect(within(lista).getByText('22:30–23:00')).toBeTruthy();
    expect(within(lista).getByText(/dia inteiro · Cliente C/)).toBeTruthy();
    expect(lista.className).not.toContain('overflow-x-auto');
  });
});
