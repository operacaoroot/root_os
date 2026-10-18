import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tarefasDeTrabalho } from '@/lib/work-projection';

const get = vi.fn(), patch = vi.fn();
let permissions = ['tarefas.ver', 'tarefas.editar'];
let token = 'qa-org-a';
vi.mock('@/lib/api', () => ({ apiGet: (...a: unknown[]) => get(...a), apiPatch: (...a: unknown[]) => patch(...a), apiPost: vi.fn(), apiDelete: vi.fn(), apiBlob: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token, ready: true, user: { id: 'qa-user' }, can: (p: string) => permissions.includes(p) }) }));
import { TrabalhoView } from '@/components/trabalho/TrabalhoView';
// /tarefas redireciona para /trabalho?visao=lista desde 18/10/2026 (rodada do painel P2):
// a visão de lista é o mesmo TrabalhoView, que é o que esta suíte sempre mediu.
const TasksPage = () => <TrabalhoView visaoInicial="lista" />;
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


// Listas com IDs de status/opção distintos: o serviço filtra pelos IDs recebidos.
describe('ROOT-12: filtros ao trocar de lista', () => {
  const campo = (suffix: string) => ({ id: `campo-${suffix}`, name: 'Categoria', type: 'drop_down', order: 0, options: [{ id: `opcao-${suffix}`, name: suffix, order: 0, color: null }] });
  const origem = { ...list, total: 1, fields: [campo('origem')] };
  const destino = { ...list, id: 'qa-dest', externalId: 'qa-dest-external', name: 'QA Destino', total: 1, statuses: [{ ...status, id: 'status-dest', name: 'Destino' }], fields: [campo('dest')] };
  const DEST_ID = '22222222-2222-4222-8222-222222222222';
  let registro: Omit<ReturnType<typeof task>, 'values'> & { values: { fieldId: string; optionId: string; value: null }[] } = task(0);
  let atrasada: ((v: unknown) => void) | undefined;
  let reterOrigem = false;
  const globais = 'assignee=QA+Pessoa&q=QA&arquivadas=1&agente=livres&overdue=1&visao=tabela&extra=preservar';
  const consultasDestino = () => get.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('/trabalho/tarefas?') && new URL(`http://qa${p}`).searchParams.get('listId') === destino.id);

  beforeEach(() => {
    registro = { ...task(0), overdue: true, values: [{ fieldId: 'campo-origem', optionId: 'opcao-origem', value: null }] };
    atrasada = undefined; reterOrigem = false;
    get.mockImplementation((path: string) => {
      if (path === '/trabalho/estrutura') return Promise.resolve({ ...structure, listasSoltas: [origem, destino] });
      if (path === `/trabalho/tarefas/${ID}`) return Promise.resolve({ ...registro, listName: registro.listId === destino.id ? destino.name : origem.name, description: 'QA descrição', comentarios: [], atividade: [], filhos: [], createdAt: '2026-10-05T12:00:00Z', updatedAt: '2026-10-05T12:00:00Z' });
      if (path.startsWith('/trabalho/tarefas?')) {
        const p = new URL(`http://qa${path}`).searchParams;
        if (reterOrigem && p.get('listId') === origem.id) return new Promise((resolve) => { atrasada = resolve; });
        const row = p.get('listId') === destino.id ? { ...registro, id: registro.listId === destino.id ? ID : DEST_ID, listId: destino.id, statusId: 'status-dest', statusName: 'Destino', values: [{ fieldId: 'campo-dest', optionId: 'opcao-dest', value: null }] } : registro;
        const matches = (!p.get('statusId') || p.get('statusId') === row.statusId) && (!p.get('opcao') || row.values.some((v) => v.optionId === p.get('opcao')));
        return Promise.resolve({ items: matches ? [row] : [], total: matches ? 1 : 0 });
      }
      return Promise.resolve(null);
    });
    patch.mockImplementation((path: string, data: Record<string, string>) => {
      expect(path).toBe(`/trabalho/tarefas/${ID}`);
      registro = { ...registro, ...data, ...(data.listId ? { statusId: 'status-dest', statusName: 'Destino' } : {}) };
      return Promise.resolve(registro);
    });
  });

  async function conferirDestino(comPainel: boolean, idEsperado = ID) {
    await waitFor(() => expect(consultasDestino().length).toBeGreaterThan(0));
    const url = new URL(window.location.href);
    expect(url.searchParams.get('statusId')).toBeNull();
    expect(url.searchParams.get('opcao')).toBeNull();
    expect(url.searchParams.get('lista')).toBe(destino.id);
    expect(url.hash).toBe('#ancora');
    for (const [key, value] of new URLSearchParams(globais)) expect(url.searchParams.get(key)).toBe(value);
    for (const path of consultasDestino()) {
      const p = new URL(`http://qa${path}`).searchParams;
      expect(p.has('statusId')).toBe(false); expect(p.has('opcao')).toBe(false);
      expect(Object.fromEntries(p)).toMatchObject({ assignee: 'QA Pessoa', q: 'QA', arquivadas: '1', page: '1', limit: '500' });
    }
    await screen.findByText('1 tarefa');
    expect(renderedIds()).toEqual([idEsperado]);
    // O diálogo torna o resto da tela aria-hidden, mas os filtros continuam no DOM.
    expect(document.querySelector('[aria-label="Filtrar por status"]')).toHaveValue('');
    expect(document.querySelector('[aria-label="Filtrar por Categoria"]')).toHaveValue('');
    expect(url.searchParams.get('tarefa')).toBe(comPainel ? ID : null);
    if (comPainel) expect(await screen.findByLabelText('Título da tarefa')).toHaveValue('QA Card 0');
  }

  it.each(['statusId=qa-status', 'opcao=opcao-origem', 'statusId=qa-status&opcao=opcao-origem'])('limpa %s ao mover pelo painel e reabre o UUID editado', async (filtro) => {
    window.history.replaceState({}, '', `/tarefas?lista=qa-list&${filtro}&${globais}#ancora`);
    const view = render(<TasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'QA Card 0' }));
    await screen.findByLabelText('Título da tarefa');
    fireEvent.change(screen.getByText('Lista', { exact: true, selector: 'span' }).parentElement!.querySelector('select')!, { target: { value: destino.id } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, { listId: destino.id }, token));
    await conferirDestino(true);
    const titulo = screen.getByLabelText('Título da tarefa');
    fireEvent.change(titulo, { target: { value: 'QA editado no destino' } }); fireEvent.blur(titulo);
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, { title: 'QA editado no destino' }, token));
    view.unmount(); render(<TrabalhoPage />);
    expect(await screen.findByLabelText('Título da tarefa')).toHaveValue('QA editado no destino');
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBe(ID);
  });

  it('limpa status e opção ao resolver deep link cuja lista ficou antiga', async () => {
    registro = { ...registro, listId: destino.id, statusId: 'status-dest', statusName: 'Destino' };
    window.history.replaceState({}, '', `/tarefas?lista=qa-external&tarefa=${ID}&statusId=qa-status&opcao=opcao-origem&${globais}#ancora`);
    render(<TasksPage />); await conferirDestino(true);
  });

  it('limpa status e opção pela árvore e ignora a consulta antiga pendente', async () => {
    window.history.replaceState({}, '', `/tarefas?lista=qa-list&statusId=qa-status&opcao=opcao-origem&${globais}#ancora`);
    reterOrigem = true;
    render(<TasksPage />); await waitFor(() => expect(atrasada).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: /QA Destino/ }));
    await conferirDestino(false, DEST_ID);
    await act(async () => atrasada!({ items: [{ ...registro, title: 'QA resposta antiga' }], total: 1 }));
    expect(screen.queryByText('QA resposta antiga')).toBeNull(); expect(renderedIds()).toEqual([DEST_ID]);
  });

  it('mover com consulta filtrada pendente não publica a resposta da origem', async () => {
    window.history.replaceState({}, '', `/tarefas?lista=qa-list&tarefa=${ID}&statusId=qa-status&opcao=opcao-origem&${globais}#ancora`);
    reterOrigem = true;
    render(<TasksPage />); await screen.findByLabelText('Título da tarefa');
    await waitFor(() => expect(atrasada).toBeTypeOf('function'));
    fireEvent.change(screen.getByText('Lista', { exact: true, selector: 'span' }).parentElement!.querySelector('select')!, { target: { value: destino.id } });
    await conferirDestino(true);
    await act(async () => atrasada!({ items: [{ ...registro, title: 'QA resposta antiga' }], total: 1 }));
    expect(screen.queryByText('QA resposta antiga')).toBeNull(); expect(renderedIds()).toEqual([ID]);
    expect(consultasDestino().every((p) => !p.includes('qa-status') && !p.includes('opcao-origem'))).toBe(true);
  });

  it('selecionar a mesma lista preserva os filtros específicos', async () => {
    window.history.replaceState({}, '', '/tarefas?lista=qa-list&statusId=qa-status&opcao=opcao-origem');
    render(<TasksPage />); await screen.findByText('1 tarefa');
    fireEvent.click(screen.getByRole('button', { name: /QA Lista/ }));
    expect(new URLSearchParams(window.location.search).get('statusId')).toBe('qa-status');
    expect(new URLSearchParams(window.location.search).get('opcao')).toBe('opcao-origem');
    expect(screen.getByLabelText('Filtrar por status')).toHaveValue('qa-status');
  });

  it('deep link na mesma lista por externalId preserva os filtros válidos', async () => {
    window.history.replaceState({}, '', `/tarefas?lista=qa-external&tarefa=${ID}&statusId=qa-status&opcao=opcao-origem`);
    render(<TasksPage />); await screen.findByLabelText('Título da tarefa');
    expect(new URLSearchParams(window.location.search).get('statusId')).toBe('qa-status');
    expect(new URLSearchParams(window.location.search).get('opcao')).toBe('opcao-origem');
    await screen.findByText('1 tarefa');
  });
});
