import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/*
 * A IMPLANTAÇÃO NUMA TELA SÓ E O POP-UP ÚNICO DA TAREFA (rodada do trabalho
 * T1 e T2, 19/10/2026).
 *
 *  1. /trabalho/implantacao abre direto o kanban da lista "Onboarding de
 *     cliente" da pasta "Clientes", sem árvore e sem "+ adicionar";
 *  2. as colunas ficam numa linha só, com largura fixa por densidade, e o
 *     quadro rola para o lado; os chips de etapa levam até a coluna;
 *  3. o clique no cartão abre o pop-up com `?tarefa=` no endereço (empilhado):
 *     voltar do navegador fecha, e o quadro não recarrega do zero;
 *  4. o cartão com trilho ligado abre o pop-up na aba Trilho, com a bancada.
 */

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
import ImplantacaoPage from '@/app/trabalho/implantacao/page';

const STATUSES = [
  { id: 's-1', name: 'Fechado no comercial', type: 'custom', color: '#4194f6', order: 0, total: 1, limite: null },
  { id: 's-2', name: 'Kickoff marcado', type: 'custom', color: '#ff7800', order: 1, total: 1, limite: null },
  { id: 's-3', name: 'Concluído', type: 'closed', color: '#6b7280', order: 2, total: 0, limite: null },
];
const ONB = { id: 'l-onb', name: 'Onboarding de cliente', order: 0, externalId: null, total: 2, statuses: STATUSES, fields: [] };
const OUTRA = { id: 'l-exec', name: 'Execução', order: 1, externalId: null, total: 0, statuses: STATUSES, fields: [] };
const CLIENTES = { id: 'f-cli', name: 'Clientes', parentId: null, order: 0, lists: [OUTRA, ONB] };

function tarefa(over: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001', listId: 'l-onb', title: 'Construtora Alicerce',
    statusId: 's-1', statusName: 'Fechado no comercial', statusType: 'custom', statusColor: '#4194f6',
    priority: 'normal', assignee: 'Rodrigo', agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null,
    statusDesde: null, minutos: 0, dueDate: null, startDate: null, overdue: false, parentId: null, subtasks: 0, comments: 0,
    externalId: null, externalUrl: null, archived: false, order: 0, tags: [], values: [], ...over,
  };
}
const A = tarefa();
const B = tarefa({ id: '00000000-0000-4000-8000-000000000002', title: 'Studio Lume', statusId: 's-2', statusName: 'Kickoff marcado' });
const ITENS = [A, B];
const TRILHO = { id: 'tr-1', cliente: 'Studio Lume', faseRotulo: 'Contrato e onboarding', cardId: B.id, faltando: [] };

function servir() {
  apiGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/estrutura')) {
      return Promise.resolve({ folders: [CLIENTES], listasSoltas: [], camposGlobais: [], tags: [], responsaveis: ['Rodrigo'], agentes: [] });
    }
    if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve({ itens: [] });
    if (rota.startsWith('/trabalho/tarefas?')) {
      return Promise.resolve({ items: ITENS, total: ITENS.length, source: { tool: 'trabalho-interno', generatedAt: '2026-10-19T12:00:00.000Z' } });
    }
    if (rota.startsWith(`/tenants/onboarding/trilhos?cardId=${B.id}`)) return Promise.resolve([TRILHO]);
    if (rota.startsWith('/tenants/onboarding/trilhos?')) return Promise.resolve([]);
    if (rota === '/tenants/onboarding/trilhos') return Promise.resolve([TRILHO]);
    if (rota.startsWith('/tenants/onboarding/trilhos/tr-1')) return Promise.reject(new Error('bancada fora do teste'));
    const id = rota.slice('/trabalho/tarefas/'.length);
    const achada = ITENS.find((t) => t.id === id) ?? A;
    return Promise.resolve({
      ...achada, description: null, listName: ONB.name, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-17T10:00:00.000Z',
      comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [],
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/trabalho/implantacao');
  servir();
});

describe('T1: a implantação numa tela só', () => {
  it('abre a lista Onboarding de cliente, sem árvore e sem "+ adicionar", com a porta explicada', async () => {
    render(<ImplantacaoPage />);
    expect(await screen.findByRole('heading', { name: 'Implantação de clientes' })).toBeTruthy();
    await screen.findByText('Construtora Alicerce');
    expect(apiGet.mock.calls.some(([r]) => String(r).includes('listId=l-onb'))).toBe(true);
    expect(screen.queryByPlaceholderText('Nova tarefa…')).toBeNull();
    expect(screen.queryByText('Execução')).toBeNull();
    expect(screen.getByTestId('implantacao-porta').textContent).toMatch(/Registrar cliente já fechado/);
  });

  it('colunas numa linha só, largura fixa por densidade, e chips que levam à coluna', async () => {
    // Layout 26/10: a etapa concluída (s-3) só vira coluna com as concluídas à vista.
    window.history.replaceState(null, '', '/trabalho/implantacao?concluidas=mostrar');
    render(<ImplantacaoPage />);
    await screen.findByText('Construtora Alicerce');
    const quadro = screen.getByTestId('trabalho-quadro');
    expect(quadro.className).toMatch(/flex-nowrap/);
    expect(quadro.className).toMatch(/overflow-x-auto/);
    expect(quadro.className).not.toMatch(/grid/);
    expect(quadro.style.getPropertyValue('--largura-da-coluna')).toBe('210px');
    fireEvent.click(screen.getByTestId('trabalho-densidade-medio'));
    expect(screen.getByTestId('trabalho-quadro').style.getPropertyValue('--largura-da-coluna')).toBe('250px');
    const chips = within(screen.getByTestId('trabalho-chips-de-etapa')).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Fechado no comercial1', 'Kickoff marcado1', 'Concluído0']);
    const rolar = vi.fn();
    (document.querySelector('[data-coluna="s-3"]') as HTMLElement).scrollIntoView = rolar;
    fireEvent.click(chips[2]);
    expect(rolar).toHaveBeenCalled();
  });
});

describe('T2: o pop-up único da tarefa', () => {
  it('o clique no cartão abre o pop-up com ?tarefa= empilhado, e voltar fecha', async () => {
    render(<ImplantacaoPage />);
    const titulo = await screen.findByText('Construtora Alicerce');
    const antes = window.history.length;
    fireEvent.click(titulo);
    expect(await screen.findByTestId('tarefa-popup')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBe(A.id);
    expect(window.history.length).toBe(antes + 1);
    const leiturasDaLista = apiGet.mock.calls.filter(([r]) => String(r).startsWith('/trabalho/tarefas?')).length;
    act(() => {
      window.history.replaceState(null, '', '/trabalho/implantacao');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(screen.queryByTestId('tarefa-popup')).toBeNull());
    expect(screen.getByText('Construtora Alicerce')).toBeTruthy();
    expect(apiGet.mock.calls.filter(([r]) => String(r).startsWith('/trabalho/tarefas?')).length).toBe(leiturasDaLista);
  });

  it('o atalho do trilho abre o pop-up na aba Trilho, com a bancada embutida', async () => {
    render(<ImplantacaoPage />);
    await screen.findByText('Studio Lume');
    fireEvent.click(screen.getByTestId('trabalho-densidade-medio'));
    fireEvent.click(await screen.findByTestId('trabalho-trilho-tr-1'));
    expect(await screen.findByTestId('tarefa-trilho')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('tarefaAba')).toBe('trilho');
    expect(screen.getByTestId('tarefa-aba-trilho').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('tarefa-aba-tarefa'));
    await waitFor(() => expect(screen.queryByTestId('tarefa-trilho')).toBeNull());
  });
});
