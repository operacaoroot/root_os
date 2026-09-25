// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * ==========================================================================
 * A TELA DA AGENDA — mês e semana sobre o mesmo Google Calendar
 * ==========================================================================
 *
 * A grade em si é medida em `tests/unit/agenda-grade.test.ts`, onde ela é
 * função pura. O que esta suíte cobra é a FIAÇÃO, que é onde a tela mente sem
 * quebrar:
 *
 *  1. cada visão pede à API o período que ela desenha — semana pedindo mês
 *     traria 42 dias para sete colunas, e ninguém veria diferença na tela;
 *  2. a escolha de visão sobrevive à volta, porque quem trabalha na semana não
 *     quer reabrir no mês todo dia;
 *  3. o que foge do padrão da casa aparece marcado, com o título cru;
 *  4. o filtro vale nas duas visões e conta o que está fora.
 */

const apiGet = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a) };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u', name: 'Rodrigo', email: 'r@x.com', roles: [], permissions: [] },
    can: (p: string) => p !== 'tarefas.ver', // sem trilhos: o datalist é opcional
  }),
}));

// eslint-disable-next-line import/first
import AgendaPage from '@/app/agenda/page';

/* --------------------------------------------------------------- fixtures -- */

/** Hoje, às 14h — a suíte nunca usa data fixa: fixture com data envelhece. */
function hojeAs(hora: number, minuto = 0): Date {
  const d = new Date();
  d.setHours(hora, minuto, 0, 0);
  return d;
}

const REUNIAO_DE_CLIENTE = {
  id: 'ev-1',
  title: 'Reunião Online - Andrade Peças - Pedro',
  reuniao: { tipo: 'cliente', modalidade: 'online', cliente: 'Andrade Peças', responsavel: 'Pedro' },
  start: hojeAs(14).toISOString(),
  end: hojeAs(15).toISOString(),
  diaInteiro: false,
  location: null,
  description: null,
  link: 'https://calendar.google.com/evento',
  meet: 'https://meet.google.com/abc-defg-hij',
  status: 'confirmed',
  organizador: 'operacao.root@gmail.com',
  attendees: ['cliente@andrade.com'],
};

const FORA_DO_PADRAO = {
  ...REUNIAO_DE_CLIENTE,
  id: 'ev-2',
  title: 'Almoço com o contador',
  reuniao: null,
  start: hojeAs(12).toISOString(),
  end: hojeAs(13).toISOString(),
  meet: null,
  attendees: [],
};

/** O `de`/`ate` que a tela pediu na última chamada da agenda, em dias. */
function diasPedidos(): number {
  const chamada = [...apiGet.mock.calls].reverse().find((c) => String(c[0]).includes('/google/calendar/periodo'));
  const url = new URL(`http://x${String(chamada![0])}`);
  const de = new Date(url.searchParams.get('de')!);
  const ate = new Date(url.searchParams.get('ate')!);
  return Math.round((ate.getTime() - de.getTime()) / 86_400_000);
}

beforeEach(() => {
  apiGet.mockReset();
  window.localStorage.clear();
  apiGet.mockImplementation((rota: string) => {
    if (String(rota).includes('/google/calendar/periodo')) {
      return Promise.resolve([REUNIAO_DE_CLIENTE, FORA_DO_PADRAO]);
    }
    return Promise.resolve([]);
  });
});

describe('a agenda abre no mês', () => {
  it('pede as seis semanas da grade e mostra o cliente', async () => {
    render(<AgendaPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(diasPedidos()).toBe(42);
    await waitFor(() => expect(screen.getAllByText(/Andrade Peças/).length).toBeGreaterThan(0));
  });

  it('o que foge do padrão aparece marcado, com o título cru', async () => {
    render(<AgendaPage />);
    await waitFor(() => expect(screen.getAllByText('Almoço com o contador').length).toBeGreaterThan(0));
    expect(screen.getByText('fora do padrão')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fora do padrão \(1\)/ })).toBeTruthy();
  });
});

describe('trocar para a semana', () => {
  it('passa a pedir sete dias e desenha a régua de horas', async () => {
    const user = userEvent.setup();
    render(<AgendaPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Semana' }));

    await waitFor(() => expect(diasPedidos()).toBe(7));
    /*
     * A régua abre no expediente e rotula o INÍCIO de cada faixa, como em
     * qualquer calendário: de 8h às 19h, as marcas vão de 08h a 18h — a
     * última linha nomeia a faixa 18h–19h, não o fim da régua.
     */
    await waitFor(() => expect(screen.getByText('08h')).toBeTruthy());
    expect(screen.getByText('18h')).toBeTruthy();
    expect(screen.queryByText('07h')).toBeNull();
  });

  it('a escolha sobrevive a fechar e abrir a tela', async () => {
    const user = userEvent.setup();
    const primeira = render(<AgendaPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Semana' }));
    await waitFor(() => expect(diasPedidos()).toBe(7));
    primeira.unmount();

    apiGet.mockClear();
    render(<AgendaPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(diasPedidos()).toBe(7));
  });
});

describe('o painel do dia', () => {
  it('mostra horário, responsável e o Meet da reunião de hoje', async () => {
    render(<AgendaPage />);
    // Dois compromissos hoje, dois horários na tela: a linha certa é a que
    // fala do cliente, não a primeira que casa com o formato.
    await screen.findAllByText(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
    // O nome do cliente aparece duas vezes — na célula da grade e no painel.
    // A linha que interessa é a do painel, a única que é um <li>.
    const linha = screen
      .getAllByText('Andrade Peças')
      .map((el) => el.closest('li'))
      .find(Boolean)!;
    expect(within(linha).getByText('Andrade Peças')).toBeTruthy();
    expect(within(linha).getByText('Pedro')).toBeTruthy();
    expect(within(linha).getByText('online')).toBeTruthy();
    expect(within(linha).getByRole('link', { name: /Meet/ })).toBeTruthy();
  });
});
