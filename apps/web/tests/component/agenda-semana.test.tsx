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

describe('P2 · a tela da Agenda (desde a agenda v2, 29/10/2026: abas, 1/3/5 dias úteis, painel à direita)', () => {
  it('semana no computador: grade de dias úteis, dia inteiro no topo, intervalo da semana útil', async () => {
    window.history.replaceState({}, '', '/agenda?visao=semana&dia=2026-10-21');
    render(<AgendaPage />);
    const grade = await waitFor(() => {
      const g = document.querySelector('[data-visao-da-agenda="grade"]');
      expect(g).toBeTruthy();
      return g as HTMLElement;
    });
    await waitFor(() => expect(grade.querySelector('[data-evento="A"]')).toBeTruthy());
    // Sem espelho (o mock não devolve a forma dele), a tela lê direto do Google, segunda a sexta.
    expect(chamadasDoPeriodo().at(-1)).toBe(
      `/google/calendar/periodo?de=${encodeURIComponent('2026-10-19T03:00:00.000Z')}&ate=${encodeURIComponent('2026-10-24T03:00:00.000Z')}`,
    );
    expect(screen.getByText(/sem espelho: lendo direto do Google/)).toBeTruthy();
    // 09:00 em São Paulo: uma hora abaixo das 08h, 48 px por hora (altura automática sem medida).
    const a = grade.querySelector('[data-evento="A"]') as HTMLElement;
    expect(a.style.top).toBe('48px');
    expect(a.textContent).toContain('09:00');
    // O das 22:30 de São Paulo fica na coluna do dia 21.
    expect(grade.querySelector('[data-coluna-do-dia="2026-10-21"] [data-evento="B"]')).toBeTruthy();
    // Dia inteiro na faixa do topo; a grade rola na vertical, não de lado.
    expect(within(grade.querySelector('[data-faixa-dia-inteiro]') as HTMLElement).getByText('Reunião Online - Cliente C - Pedro')).toBeTruthy();
    const rolagem = grade.querySelector('[data-rolagem-da-grade]') as HTMLElement;
    expect(rolagem.className).toContain('overflow-y-auto');
    expect(rolagem.className).toContain('overflow-x-hidden');
    expect(screen.getByText(/19\/10 a 23\/10/)).toBeTruthy();
  });

  it('abas, setas, Hoje e 1/3/5 dias mudam o endereço e o intervalo buscado', async () => {
    window.history.replaceState({}, '', '/agenda?visao=semana&dia=2026-10-21');
    render(<AgendaPage />);
    await waitFor(() => expect(document.querySelector('[data-visao-da-agenda="grade"]')).toBeTruthy());

    fireEvent.click(screen.getByTitle('Próxima'));
    await waitFor(() => expect(screen.getByText(/26\/10 a 30\/10/)).toBeTruthy());
    expect(window.location.search).toBe('?aba=semana&dia=2026-10-28&dias=5');
    await waitFor(() => expect(chamadasDoPeriodo().at(-1)).toContain(encodeURIComponent('2026-10-26T03:00:00.000Z')));

    fireEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(window.location.search).toBe('?aba=semana&dia=2026-10-21&dias=5');

    fireEvent.click(screen.getByRole('tab', { name: 'Mês' }));
    expect(window.location.search).toBe('?aba=mes&dia=2026-10-21&dias=5');
    await waitFor(() => expect(document.querySelector('[data-visao-da-agenda="mes"]')).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Mês' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Semana e dia' }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(window.location.search).toBe('?aba=semana&dia=2026-10-21&dias=1');
    await waitFor(() => expect(document.querySelectorAll('[data-coluna-do-dia]').length).toBe(1));
    await waitFor(() =>
      expect(chamadasDoPeriodo().at(-1)).toBe(
        `/google/calendar/periodo?de=${encodeURIComponent('2026-10-21T03:00:00.000Z')}&ate=${encodeURIComponent('2026-10-22T03:00:00.000Z')}`,
      ),
    );
    fireEvent.click(screen.getByTitle('Anterior'));
    expect(window.location.search).toBe('?aba=semana&dia=2026-10-20&dias=1');
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    await waitFor(() => expect(document.querySelectorAll('[data-coluna-do-dia]').length).toBe(3));
  });

  it('clicar num evento da semana abre o detalhe dele ao lado', async () => {
    window.history.replaceState({}, '', '/agenda?visao=semana&dia=2026-10-19');
    render(<AgendaPage />);
    await waitFor(() => expect(document.querySelector('[data-evento="A"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-evento="A"]') as HTMLElement);
    const detalhe = await waitFor(() => {
      const d = document.querySelector('[data-detalhe-do-compromisso="A"]');
      expect(d).toBeTruthy();
      return d as HTMLElement;
    });
    expect(within(detalhe).getByText(/09:00–10:00/)).toBeTruthy();
  });

  it('no celular o padrão é a Lista do dia, sem grade e sem rolagem lateral', async () => {
    comMatchMedia(true);
    window.history.replaceState({}, '', '/agenda?dia=2026-10-21');
    render(<AgendaPage />);
    const lista = await waitFor(() => {
      const l = document.querySelector('[data-visao-da-agenda="lista"]');
      expect(l).toBeTruthy();
      return l as HTMLElement;
    });
    expect(document.querySelector('[data-visao-da-agenda="grade"]')).toBeNull();
    await waitFor(() => expect(within(lista).getByText('Reunião Online - Cliente A - Pedro')).toBeTruthy());
    expect(within(lista).getByText('09:00')).toBeTruthy();
    expect(within(lista).getByText('22:30')).toBeTruthy();
    expect(lista.className).not.toContain('overflow-x-auto');
  });
});
