import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const apiBlob = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
    apiBlob: (...a: unknown[]) => apiBlob(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Rodrigo', email: 'r@x.com', roles: [], permissions: ['tarefas.ver', 'tarefas.editar'] },
    can: (p: string) => ['tarefas.ver', 'tarefas.editar'].includes(p),
  }),
}));

// eslint-disable-next-line import/first
import TrabalhoPage from '@/app/trabalho/page';

/*
 * TODA TAREFA LIGADA A UM CLIENTE NA TELA (rodada do trabalho T4, 19/10/2026):
 * criar exige o cliente (o botão fica travado sem ele e o corpo leva o id), o
 * cartão médio mostra o cliente ou o selo "sem cliente", o pop-up troca o
 * cliente e o filtro "sem cliente" vai na consulta.
 */

const STATUSES = [
  { id: 's-1', name: 'A fazer', type: 'open', color: '#4194f6', order: 0, total: 1, limite: null },
  { id: 's-2', name: 'Feito', type: 'closed', color: '#6b7280', order: 1, total: 0, limite: null },
];
const EXEC = { id: 'l-exec', name: 'Execução', order: 0, externalId: null, total: 2, statuses: STATUSES, fields: [] };
const PASTA = { id: 'f-cli', name: 'Clientes', parentId: null, order: 0, lists: [EXEC] };
const CLIENTE = '0a0a0a0a-0000-4000-8000-0000000000c1';

function tarefa(over: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001', listId: 'l-exec', title: 'Enviar proposta revisada',
    statusId: 's-1', statusName: 'A fazer', statusType: 'open', statusColor: '#4194f6',
    priority: 'normal', assignee: 'Rodrigo', agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null,
    statusDesde: null, minutos: 0, dueDate: null, startDate: null, overdue: false, parentId: null, subtasks: 0, comments: 0,
    externalId: null, externalUrl: null, archived: false, order: 0, tags: [], values: [],
    clienteId: CLIENTE, clienteNome: 'Construtora Alicerce', ...over,
  };
}
const COM = tarefa();
const SEM = tarefa({ id: '00000000-0000-4000-8000-000000000002', title: 'Tarefa do ClickUp', clienteId: null, clienteNome: null });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem('root-os:trabalho:densidade', 'medio');
  window.history.replaceState(null, '', '/trabalho');
  apiGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/estrutura')) return Promise.resolve({ folders: [PASTA], listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [] });
    if (rota.startsWith('/trabalho/clientes')) return Promise.resolve([{ id: 'interno', nome: 'Root (interno)', cnpj: null, interno: true }, { id: CLIENTE, nome: 'Construtora Alicerce', cnpj: null, interno: false }]);
    if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve({ itens: [] });
    if (rota.startsWith('/trabalho/tarefas?')) return Promise.resolve({ items: [COM, SEM], total: 2, source: { tool: 'trabalho-interno', generatedAt: '2026-10-19T12:00:00.000Z' } });
    if (rota.startsWith('/tenants/onboarding/trilhos')) return Promise.resolve([]);
    const id = rota.slice('/trabalho/tarefas/'.length);
    const achada = [COM, SEM].find((t) => t.id === id) ?? COM;
    return Promise.resolve({ ...achada, description: null, listName: EXEC.name, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-17T10:00:00.000Z', comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [] });
  });
  apiPost.mockResolvedValue({});
  apiPatch.mockResolvedValue({});
});

describe('T4: o cliente da tarefa na tela', () => {
  it('o cartão mostra o cliente, ou o selo "sem cliente"', async () => {
    render(<TrabalhoPage />);
    expect(await screen.findByTestId(`trabalho-cliente-${COM.id}`)).toHaveTextContent('Construtora Alicerce');
    expect(screen.getByTestId(`trabalho-cliente-${SEM.id}`)).toHaveTextContent('sem cliente');
  });

  it('criar exige o cliente e manda o id escolhido', async () => {
    render(<TrabalhoPage />);
    await screen.findByText('Enviar proposta revisada');
    const nova = screen.getByTestId('trabalho-nova-s-1');
    fireEvent.change(within(nova).getByLabelText('Nome da nova tarefa'), { target: { value: 'Marcar kickoff' } });
    const criar = within(nova).getByRole('button', { name: 'Criar tarefa' });
    expect(criar).toBeDisabled();
    expect(within(nova).getByText(/Verbo no imperativo/)).toBeTruthy();
    fireEvent.focus(within(screen.getByTestId('trabalho-nova-cliente-s-1')).getByRole('combobox'));
    fireEvent.mouseDown(await screen.findByTestId(`opcao-cliente-${CLIENTE}`));
    fireEvent.click(criar);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas', { listId: 'l-exec', statusId: 's-1', title: 'Marcar kickoff', clienteId: CLIENTE }, 'tok'));
  });

  it('o pop-up troca o cliente pelo PATCH, e a tarefa antiga diz que está sem cliente', async () => {
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByText('Tarefa do ClickUp'));
    expect(await screen.findByText(/Sem cliente. Toda tarefa nova tem/)).toBeTruthy();
    fireEvent.focus(within(screen.getByTestId('tarefa-cliente')).getByRole('combobox'));
    fireEvent.mouseDown(await screen.findByTestId('opcao-cliente-interno'));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(`/trabalho/tarefas/${SEM.id}`, { clienteId: 'interno' }, 'tok'));
  });

  it('o filtro "sem cliente" vai na consulta', async () => {
    render(<TrabalhoPage />);
    await screen.findByText('Enviar proposta revisada');
    fireEvent.change(screen.getByTestId('trabalho-filtro-cliente'), { target: { value: 'sem' } });
    await waitFor(() => expect(apiGet.mock.calls.some(([r]) => String(r).includes('cliente=sem'))).toBe(true));
  });
});
