import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { chaveDoDia } from '@/app/agenda/tipos';
import { intervaloDaGrade, prazosDeTrabalho } from '@/lib/work-projection';

const apiGet = vi.fn();
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  apiGet: (...args: unknown[]) => apiGet(...args),
}));

let permissoes = ['tarefas.ver', 'pauta.ver'];
let modulos = ['trabalho', 'pauta'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, can: (p: string) => permissoes.includes(p) }),
}));
vi.mock('@/components/modulos', () => ({ useModulos: () => ({ modulos }) }));
vi.mock('@/app/pauta/AbaRodadas', () => ({ AbaRodadas: () => null }));

import AgendaPage from '@/app/agenda/page';
import PautaPage from '@/app/pauta/page';

const ID = '11111111-1111-4111-8111-111111111111';
const tarefa = () => ({
  id: ID, title: 'ROOT-001', dueDate: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12).toISOString(),
  statusName: 'Preparação', statusType: 'custom',
});

beforeEach(() => {
  apiGet.mockReset();
  permissoes = ['tarefas.ver', 'pauta.ver'];
  modulos = ['trabalho', 'pauta'];
  window.history.replaceState({}, '', '/');
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/google/calendar/periodo')) return Promise.resolve([]);
    if (path.startsWith('/trabalho/tarefas')) return Promise.resolve({ items: [tarefa()], total: 1 });
    return Promise.resolve({ items: [] });
  });
});
afterEach(() => cleanup());

describe('projeções do mesmo card Work', () => {
  it('usa limites locais inclusive/exclusivo na virada de dia e de mês', () => {
    const range = intervaloDaGrade([new Date(2026, 7, 30), new Date(2026, 9, 10)]);
    const inicio = new Date(range.dueFrom);
    const fim = new Date(range.dueTo);
    expect([inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), inicio.getHours()])
      .toEqual([2026, 7, 30, 0]);
    expect([fim.getFullYear(), fim.getMonth(), fim.getDate(), fim.getHours()])
      .toEqual([2026, 9, 11, 0]);
    expect(chaveDoDia(new Date(2026, 9, 1, 0, 0, 0, -1))).toBe('2026-09-30');
    expect(chaveDoDia(new Date(2026, 9, 1, 0, 0, 0))).toBe('2026-10-01');
  });

  it('Agenda busca também a página depois do item 500', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.includes('page=1')) return Promise.resolve({ items: Array.from({ length: 500 }, tarefa), total: 501 });
      return Promise.resolve({ items: [tarefa()], total: 501 });
    });
    const items = await prazosDeTrabalho('tok', {
      dueFrom: '2026-09-30T03:00:00.000Z', dueTo: '2026-10-01T03:00:00.000Z',
    });
    expect(items).toHaveLength(501);
    expect(apiGet.mock.calls.map(([path]) => new URL(`https://root.local${path}`).searchParams.get('page'))).toEqual(['1', '2']);
  });

  it('Agenda e Pauta abrem o mesmo UUID, sem criar card ou peça', async () => {
    const agenda = render(<AgendaPage />);
    const linkAgenda = await screen.findByRole('link', { name: 'ROOT-001' });
    expect(linkAgenda.getAttribute('href')).toBe(`/trabalho?tarefa=${ID}`);
    expect(screen.getByText(/não são reuniões nem publicações agendadas/)).toBeInTheDocument();
    agenda.unmount();

    render(<PautaPage />);
    const linkPauta = await screen.findByRole('link', { name: 'ROOT-001' });
    expect(linkPauta.getAttribute('href')).toBe(linkAgenda.getAttribute('href'));
    expect(apiGet.mock.calls.some(([path]) => String(path).startsWith('/trabalho/tarefas?listExternalIds='))).toBe(true);
  });

  it('não consulta nem mostra Work sem permissão ou módulo confirmado', async () => {
    permissoes = ['pauta.ver'];
    const agenda = render(<AgendaPage />);
    expect(screen.queryByText('Prazos de trabalho')).toBeNull();
    agenda.unmount();
    render(<PautaPage />);
    expect(screen.queryByLabelText('Produção autoral no Trabalho')).toBeNull();
    await waitFor(() => expect(apiGet.mock.calls.some(([path]) => String(path).startsWith('/trabalho/tarefas'))).toBe(false));
    cleanup();

    permissoes = ['tarefas.ver', 'pauta.ver'];
    modulos = ['pauta'];
    const agendaSemModulo = render(<AgendaPage />);
    expect(screen.queryByText('Prazos de trabalho')).toBeNull();
    agendaSemModulo.unmount();
    render(<PautaPage />);
    expect(screen.queryByLabelText('Produção autoral no Trabalho')).toBeNull();
    expect(apiGet.mock.calls.some(([path]) => String(path).startsWith('/trabalho/tarefas'))).toBe(false);
  });

  it('falha do Google não apaga prazo Work; Pauta sinaliza quando mostra só a primeira página', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.startsWith('/google/calendar/periodo')) return Promise.reject(new Error('Google indisponível'));
      if (path.startsWith('/trabalho/tarefas')) return Promise.resolve({ items: [tarefa()], total: path.includes('listExternalIds=') ? 70 : 1 });
      return Promise.resolve({ items: [] });
    });
    const agenda = render(<AgendaPage />);
    expect(await screen.findByRole('link', { name: 'ROOT-001' })).toHaveAttribute('href', `/trabalho?tarefa=${ID}`);
    expect(await screen.findByText(/Google indisponível/)).toBeInTheDocument();
    agenda.unmount();

    render(<PautaPage />);
    expect(await screen.findByText(/Exibindo 1 de 70 cards/)).toBeInTheDocument();
  });

  it('falha de Work não apaga reunião Google nem as abas de episódios', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.startsWith('/google/calendar/periodo')) return Promise.resolve([{
        id: 'reuniao-1', title: 'Conversa com cliente', reuniao: null,
        start: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 10).toISOString(),
        end: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 11).toISOString(),
        diaInteiro: false, location: null, description: null, link: null, meet: null,
        status: null, organizador: null, attendees: [],
      }]);
      if (path.startsWith('/trabalho/tarefas')) return Promise.reject(new Error('Work indisponível'));
      return Promise.resolve({ items: [] });
    });
    const agenda = render(<AgendaPage />);
    await waitFor(() => expect(screen.getAllByText('Conversa com cliente').length).toBeGreaterThan(0));
    expect(await screen.findByText(/Não foi possível carregar os prazos: Work indisponível/)).toBeInTheDocument();
    agenda.unmount();

    render(<PautaPage />);
    expect(await screen.findByText(/Não foi possível carregar os cards: Work indisponível/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Episódios' })).toBeInTheDocument();
  });
});
