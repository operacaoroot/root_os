import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiGet = vi.fn();
const apiPatch = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a), apiPatch: (...a: unknown[]) => apiPatch(...a) };
});

let PODE_EDITAR = false;

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['tarefas.ver'] },
    can: (p: string) => p === 'tarefas.ver' || PODE_EDITAR,
  }),
}));

const redirect = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: (...a: unknown[]) => redirect(...a),
}));

// eslint-disable-next-line import/first
import TarefasPage from '@/app/tarefas/page';
// eslint-disable-next-line import/first
import TrabalhoPage from '@/app/trabalho/page';

const lista = {
  id: 'lista-1', name: 'Operação', externalId: null, spaceId: null, order: 0, total: 1,
  statuses: [
    { id: 'aberta', name: 'Aberta', type: 'open', color: '#87909e', order: 0, total: 1, limite: null },
    { id: 'feita', name: 'Feita', type: 'closed', color: '#4194f6', order: 1, total: 0, limite: null },
  ], fields: [],
};
const estrutura = { espacos: [], folders: [], listasSoltas: [lista], camposGlobais: [], tags: [], responsaveis: [], agentes: [] };
const tarefa = {
  updatedAt: '2026-10-07T19:00:00.000Z',
  id: '11111111-1111-4111-8111-111111111111', listId: lista.id, title: 'Tarefa',
  statusId: 'aberta', statusName: 'Aberta', statusType: 'open', statusColor: '#87909e', priority: 'normal',
  assignee: null, dueDate: null, startDate: null, overdue: false, archived: false,
  agenteId: null, agenteNome: null, agenteSlug: null, agenteEm: null, statusDesde: null, minutos: 0,
  parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: 0, tags: [], values: [],
};

// Layout 26/10: `/conteudo` (Temas do ClickUp) foi aposentado e redireciona para `/marketing`
// (`rotas-antigas.mjs`); a trava do redirect está em `tests/unit/nav.test.ts`.
describe('texto de orientação das telas legadas', () => {
  beforeEach(() => {
    window.localStorage.removeItem('root-os:trabalho:densidade');
    window.history.replaceState({}, '', '/');
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPatch.mockResolvedValue(tarefa);
    PODE_EDITAR = false;
    apiGet.mockImplementation(async (rota: string) => {
      if (rota === '/trabalho/estrutura') return estrutura;
      if (rota.startsWith('/trabalho/tarefas?')) return { total: 1, items: [tarefa] };
      throw new Error(`Rota sem fixture: ${rota}`);
    });
  });

  /*
   * Desde 18/10/2026 (rodada do painel P2) quadro e lista são uma tela só: /tarefas
   * redireciona para /trabalho na visão de lista, preservando a query do link.
   */
  it('/tarefas redireciona para /trabalho?visao=lista e preserva a query', async () => {
    redirect.mockReset();
    await TarefasPage({ searchParams: Promise.resolve({ lista: 'lista-1', tarefa: tarefa.id, q: ['a', 'b'] }) });
    expect(redirect).toHaveBeenCalledWith(`/trabalho?lista=lista-1&tarefa=${tarefa.id}&q=a&q=b&visao=lista`);
    redirect.mockReset();
    await TarefasPage({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith('/trabalho?visao=lista');
    // link antigo que já dizia a visão continua abrindo nela
    redirect.mockReset();
    await TarefasPage({ searchParams: Promise.resolve({ visao: 'board' }) });
    expect(redirect).toHaveBeenCalledWith('/trabalho?visao=board');
  });

  it('/trabalho?visao=lista abre a lista nativa e permite navegar para o quadro da mesma lista', async () => {
    window.history.replaceState({}, '', '/trabalho?visao=lista');
    render(<TrabalhoPage />);
    expect(await screen.findByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(document.querySelector('[data-work-task-id]')).toHaveAttribute('data-work-task-id', tarefa.id);
    expect(apiGet).toHaveBeenCalledWith('/trabalho/estrutura', 'tok');
    expect(apiGet.mock.calls.some(([rota]) => String(rota).startsWith('/tasks'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Quadro' }));
    expect(new URLSearchParams(window.location.search).get('visao')).toBe('board');
    expect(document.querySelector('[data-work-task-id]')).toHaveAttribute('data-work-task-id', tarefa.id);
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
    expect(screen.queryByTitle('Mover etapa')).toBeNull();
    expect(document.body.textContent).not.toContain('para consulta');
  });

  it('com permissão de editar, os seletores de etapa existem e o texto não promete só leitura', async () => {
    PODE_EDITAR = true;
    window.history.replaceState({}, '', '/trabalho?visao=lista&concluidas=mostrar'); // a etapa fechada (Feita) só entra no seletor com as concluídas à vista
    // Rodada da implantação I2: o seletor de etapa no cartão é da densidade cheia (no compacto, o cartão abre o painel).
    window.localStorage.setItem('root-os:trabalho:densidade', 'cheio');
    render(<TrabalhoPage />);
    await screen.findByRole('columnheader', { name: 'Status' });
    fireEvent.click(screen.getByRole('button', { name: 'Quadro' }));
    const etapa = await screen.findByTitle('Mover etapa');
    expect(etapa).toHaveValue('aberta');
    fireEvent.change(etapa, { target: { value: 'feita' } });
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(`/trabalho/tarefas/${tarefa.id}`, { statusId: 'feita', expectedUpdatedAt: tarefa.updatedAt }, 'tok'));
    expect(document.body.textContent).not.toContain('para consulta');
    expect(document.body.textContent?.toLowerCase()).not.toContain('somente leitura');
  });
});
