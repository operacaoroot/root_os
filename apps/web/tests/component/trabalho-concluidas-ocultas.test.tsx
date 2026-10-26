import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * LAYOUT 26/10/2026: como no ClickUp, a tarefa concluída some do Trabalho por padrão,
 * junto com a coluna de etapa concluída. O botão "Mostrar concluídas" do cabeçalho
 * traz as duas de volta e grava `?concluidas=mostrar` no endereço.
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn();
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: vi.fn(), apiBlob: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: EU, name: 'Rodrigo QA' }, can: (p: string) => ['tarefas.ver', 'tarefas.editar'].includes(p) }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }) }));
import TrabalhoPage from '@/app/trabalho/page';

const EU = '0e0e0e0e-0000-4000-8000-000000000001';
const ABERTA = '11111111-1111-4111-8111-111111111111';
const FEITA = '22222222-2222-4222-8222-222222222222';
const V1 = '2026-10-26T10:00:00.000Z';

const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#87909e', order, total: 0, limite: null });
const rotina = { id: 'l-rotina', name: 'Rotina', externalId: null, spaceId: null, order: 0, total: 2, fields: [], statuses: [st('l-rotina-aberta', 'A fazer', 'open', 0), st('l-rotina-feita', 'Feito', 'closed', 1)] };
const estrutura = {
  espacos: [],
  folders: [{ id: 'f-adm', name: 'Administrativo', order: 0, spaceId: null, parentId: null, externalId: null, lists: [rotina] }],
  listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [],
  pessoas: [{ id: EU, name: 'Rodrigo QA', email: 'eu@qa.local', isActive: true }],
};
function tarefa(id: string, title: string, status: ReturnType<typeof st>) {
  return {
    id, title, listId: rotina.id, listName: rotina.name, statusId: status.id, statusName: status.name, statusType: status.type, statusColor: '#87909e',
    priority: 'normal', assignee: null, assigneeUserId: null, assigneeUserName: null, assigneeUserEmail: null, assigneeUserIsActive: null,
    dueDate: null, startDate: null, overdue: false, archived: false, agenteId: null, agenteNome: null, agenteSlug: null, agenteEm: null,
    statusDesde: null, minutos: 0, parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: 0, tags: [], values: [],
    clienteId: null, clienteNome: null, outrosResponsaveisIds: [] as string[], recorrencia: null, updatedAt: V1,
  };
}
const tarefas = [tarefa(ABERTA, 'Pagar o aluguel', rotina.statuses[0]), tarefa(FEITA, 'Fechar o mês', rotina.statuses[1])];

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/trabalho');
  get.mockReset(); post.mockReset(); patch.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota === '/trabalho/estrutura') return Promise.resolve(estrutura);
    if (rota.startsWith('/trabalho/clientes')) return Promise.resolve([]);
    if (rota.startsWith('/trabalho/vistas')) return Promise.resolve([]);
    if (rota.startsWith('/tenants/onboarding/trilhos')) return Promise.resolve([]);
    if (rota.startsWith('/tenants/plataforma')) return Promise.reject(new Error('não'));
    if (rota.startsWith('/comercial')) return Promise.resolve([]);
    if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve({ itens: [] });
    if (rota.startsWith('/trabalho/tarefas?')) {
      const q = new URL(`http://x${rota}`).searchParams;
      const items = q.get('todas') === '1' ? tarefas : tarefas.filter((t) => t.listId === q.get('listId'));
      return Promise.resolve({ total: items.length, items, source: { tool: 'qa', generatedAt: V1 } });
    }
    return Promise.resolve(null);
  });
  patch.mockResolvedValue({});
});
afterEach(cleanup);

const query = () => new URLSearchParams(window.location.search);
const colunas = () => [...document.querySelectorAll('[data-coluna]')].map((c) => c.getAttribute('data-coluna'));
const cartoes = () => [...document.querySelectorAll('[data-work-task-id]')].map((e) => e.getAttribute('data-work-task-id'));

describe('Layout 26/10: concluídas ocultas por padrão', () => {
  it('a concluída e a coluna concluída ficam de fora; "Mostrar concluídas" traz as duas e grava ?concluidas=mostrar', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-rotina');
    render(<TrabalhoPage />);
    await screen.findByText('Pagar o aluguel');
    expect(cartoes()).toEqual([ABERTA]);
    expect(screen.queryByText('Fechar o mês')).toBeNull();
    expect(colunas()).toEqual(['l-rotina-aberta']);
    expect(query().has('concluidas')).toBe(false);

    const botao = screen.getByTestId('trabalho-concluidas');
    expect(botao).toHaveTextContent('Mostrar concluídas');
    expect(botao).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(botao);

    expect(query().get('concluidas')).toBe('mostrar');
    await waitFor(() => expect(colunas()).toEqual(['l-rotina-aberta', 'l-rotina-feita']));
    expect(cartoes()).toEqual([ABERTA, FEITA]);
    expect(screen.getByText('Fechar o mês')).toBeInTheDocument();
    expect(botao).toHaveTextContent('Ocultar concluídas');
    expect(botao).toHaveAttribute('aria-pressed', 'true');
  });
});
