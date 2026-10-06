import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tarefasDeTrabalho } from '@/lib/work-projection';

const get = vi.fn(), patch = vi.fn();
let permissions = ['tarefas.ver', 'tarefas.editar'];
let token = 'qa-org-a';
vi.mock('@/lib/api', () => ({ apiGet: (...a: unknown[]) => get(...a), apiPatch: (...a: unknown[]) => patch(...a), apiPost: vi.fn(), apiDelete: vi.fn(), apiBlob: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token, ready: true, user: { id: 'qa-user' }, can: (p: string) => permissions.includes(p) }) }));
import TasksPage from '@/app/tarefas/page';
import TrabalhoPage from '@/app/trabalho/page';

const ID = '11111111-1111-4111-8111-111111111111';
const status = { id: 'qa-status', name: 'QA Revisão', type: 'custom', color: '#4194f6', order: 0, total: 501, limite: null };
const list = { id: 'qa-list', externalId: 'qa-external', name: 'QA Lista', total: 501, statuses: [status], fields: [], order: 0 };
const structure = { folders: [], listasSoltas: [list], camposGlobais: [], tags: [], responsaveis: ['QA Pessoa'], agentes: [] };
const task = (i: number) => ({
  id: i === 0 ? ID : `qa-${i}`, listId: list.id, title: `QA Card ${i}`, statusId: status.id,
  statusName: status.name, statusType: status.type, statusColor: status.color, priority: 'normal', assignee: 'QA Pessoa',
  dueDate: null, startDate: null, overdue: i === 500, archived: false, agenteId: null,
  agenteNome: null, agenteSlug: null, agenteEm: null, statusDesde: null, minutos: 0,
  parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: i, tags: [], values: [],
});
let items = Array.from({ length: 501 }, (_, i) => task(i));
function serve(path: string) {
  if (path === '/trabalho/estrutura') return Promise.resolve(structure);
  if (path.startsWith('/trabalho/tarefas?')) {
    const page = Number(new URL(`http://qa${path}`).searchParams.get('page'));
    return Promise.resolve({ items: items.slice((page - 1) * 500, page * 500), total: items.length });
  }
  if (path === `/trabalho/tarefas/${ID}`) return Promise.resolve({ ...items[0], listName: list.name, description: 'QA descrição', comentarios: [], atividade: [], filhos: [], createdAt: '2026-10-05T12:00:00Z', updatedAt: '2026-10-05T12:00:00Z' });
  return Promise.resolve(null);
}
beforeEach(() => {
  window.history.replaceState({}, '', '/'); permissions = ['tarefas.ver', 'tarefas.editar']; token = 'qa-org-a';
  items = Array.from({ length: 501 }, (_, i) => task(i)); get.mockReset(); patch.mockReset();
  get.mockImplementation(serve);
  patch.mockImplementation((path: string, data: object) => { expect(path).toBe(`/trabalho/tarefas/${ID}`); Object.assign(items[0], data); return Promise.resolve(items[0]); });
});
afterEach(cleanup);
const renderedIds = () => [...document.querySelectorAll('[data-work-task-id]')].map((e) => e.getAttribute('data-work-task-id'));

describe('ROOT-12: lista e quadro Work', () => {
  it('projeta os mesmos 501 UUIDs e total em /tarefas e /trabalho, com duas páginas', async () => {
    const table = render(<TasksPage />);
    await screen.findByText('501 tarefas');
    const ids = renderedIds(); expect(ids).toEqual(items.map((t) => t.id)); expect(new Set(ids).size).toBe(501);
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    table.unmount(); window.history.replaceState({}, '', '/trabalho');
    render(<TrabalhoPage />); await screen.findByText('501 tarefas');
    expect(renderedIds()).toEqual(ids);
    expect(get.mock.calls.filter(([p]) => String(p).includes('page=2'))).toHaveLength(2);
    expect(get.mock.calls.every(([p, t]) => !String(p).startsWith('/tasks') && t === token)).toBe(true);
  });

  it.each(['empty', 'duplicate', 'total', 'error', 'short', 'invalid'])('recusa página %s sem sucesso parcial nem loop', async (failure) => {
    get.mockImplementation((path: string) => {
      if (path.includes('page=1')) return Promise.resolve({ items: items.slice(0, 500), total: 501 });
      if (failure === 'error') return Promise.reject(new Error('QA indisponível'));
      return Promise.resolve({ items: failure === 'empty' || failure === 'short' ? [] : [failure === 'duplicate' ? items[0] : items[500]], total: failure === 'total' ? 502 : failure === 'invalid' ? -1 : 501 });
    });
    await expect(tarefasDeTrabalho(token, new URLSearchParams())).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('permite consulta vazia legítima e não percorre além do total', async () => {
    get.mockResolvedValue({ items: [], total: 0 });
    expect(await tarefasDeTrabalho(token, new URLSearchParams())).toMatchObject({ items: [], total: 0 });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('preserva deep link/lista/filtros e descarta resposta tardia de busca', async () => {
    window.history.replaceState({}, '', '/tarefas?lista=qa-external&assignee=QA+Pessoa&statusId=qa-status&arquivadas=1&opcao=qa-opcao&overdue=1');
    let resolveOld!: (v: unknown) => void;
    get.mockImplementation((path: string) => path.includes('/tarefas?') && !path.includes('q=nova') ? new Promise((resolve) => { resolveOld = resolve; }) : path.includes('/tarefas?') ? Promise.resolve({ items: [{ ...task(500), title: 'QA nova' }], total: 1 }) : serve(path));
    render(<TasksPage />);
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Buscar tarefas'), { target: { value: 'nova' } });
    await screen.findByText('QA nova');
    await act(async () => resolveOld({ items: [{ ...task(500), title: 'QA antiga' }], total: 1 }));
    expect(screen.queryByText('QA antiga')).toBeNull(); expect(screen.getByText('1 tarefa')).toBeInTheDocument();
    const query = new URL(`http://qa${get.mock.calls.find(([p]) => String(p).includes('q=nova'))![0]}`).searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ listId: list.id, assignee: 'QA Pessoa', statusId: status.id, arquivadas: '1', opcao: 'qa-opcao', q: 'nova', page: '1', limit: '500' });
    fireEvent.click(screen.getByRole('button', { name: 'Quadro' }));
    expect(new URLSearchParams(window.location.search).get('overdue')).toBe('1');
    expect(new URLSearchParams(window.location.search).get('lista')).toBe('qa-external');
  });

  it('erro atrasado não apaga resultado novo; erro atual não mostra contagem parcial', async () => {
    let rejectOld!: (e: Error) => void;
    get.mockImplementation((path: string) => path.includes('/tarefas?') && !path.includes('q=') ? new Promise((_, reject) => { rejectOld = reject; }) : path.includes('q=falha') ? Promise.reject(new Error('QA falha atual')) : path.includes('/tarefas?') ? Promise.resolve({ items: [task(0)], total: 1 }) : serve(path));
    render(<TasksPage />); await waitFor(() => expect(rejectOld).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Buscar tarefas'), { target: { value: 'nova' } }); await screen.findByText('1 tarefa');
    await act(async () => rejectOld(new Error('QA falha velha'))); expect(screen.queryByText('QA falha velha')).toBeNull();
    fireEvent.change(screen.getByLabelText('Buscar tarefas'), { target: { value: 'falha' } });
    await screen.findByText('QA falha atual'); expect(renderedIds()).toEqual([]); expect(screen.queryByText('1 tarefa')).toBeNull();
  });

  it('abre, edita e reabre o mesmo UUID em ambas as rotas', async () => {
    items = [task(0)]; const table = render(<TasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'QA Card 0' }));
    const input = await screen.findByLabelText('Título da tarefa');
    fireEvent.change(input, { target: { value: 'QA editado' } }); fireEvent.blur(input);
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, { title: 'QA editado' }, token));
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBe(ID);
    table.unmount(); window.history.replaceState({}, '', `/trabalho?tarefa=${ID}`);
    render(<TrabalhoPage />); expect(await screen.findByLabelText('Título da tarefa')).toHaveValue('QA editado');
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBe(ID);
  });

  it('sem ver não consulta; sem editar desabilita edição; troca de token remove cards anteriores', async () => {
    permissions = []; const denied = render(<TasksPage />); expect(get).not.toHaveBeenCalled(); denied.unmount();
    permissions = ['tarefas.ver']; items = [task(0)]; const view = render(<TasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'QA Card 0' }));
    expect(await screen.findByLabelText('Título da tarefa')).toBeDisabled(); expect(patch).not.toHaveBeenCalled();
    token = 'qa-org-b'; get.mockImplementation(() => new Promise(() => {})); view.rerender(<TasksPage />);
    expect(renderedIds()).toEqual([]); expect(screen.queryByLabelText('Título da tarefa')).toBeNull();
    await waitFor(() => expect(get.mock.calls.some(([, t]) => t === 'qa-org-b')).toBe(true));
  });
});
