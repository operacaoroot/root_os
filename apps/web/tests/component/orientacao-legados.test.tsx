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

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// eslint-disable-next-line import/first
import ConteudoPage from '@/app/conteudo/page';
// eslint-disable-next-line import/first
import TarefasPage from '@/app/tarefas/page';

const hrefs = (el: HTMLElement) => Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));

const lista = {
  id: 'lista-1', name: 'Operação', externalId: null, spaceId: null, order: 0, total: 1,
  statuses: [
    { id: 'aberta', name: 'Aberta', type: 'open', color: '#87909e', order: 0, total: 1, limite: null },
    { id: 'feita', name: 'Feita', type: 'closed', color: '#4194f6', order: 1, total: 0, limite: null },
  ], fields: [],
};
const estrutura = { espacos: [], folders: [], listasSoltas: [lista], camposGlobais: [], tags: [], responsaveis: [], agentes: [] };
const tarefa = {
  id: '11111111-1111-4111-8111-111111111111', listId: lista.id, title: 'Tarefa',
  statusId: 'aberta', statusName: 'Aberta', statusType: 'open', statusColor: '#87909e', priority: 'normal',
  assignee: null, dueDate: null, startDate: null, overdue: false, archived: false,
  agenteId: null, agenteNome: null, agenteSlug: null, agenteEm: null, statusDesde: null, minutos: 0,
  parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: 0, tags: [], values: [],
};

describe('texto de orientação das telas legadas', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPatch.mockResolvedValue(tarefa);
    PODE_EDITAR = false;
    apiGet.mockImplementation(async (rota: string) => {
      if (rota === '/trabalho/estrutura') return estrutura;
      if (rota.startsWith('/trabalho/tarefas?')) return { total: 1, items: [tarefa] };
      if (rota.startsWith('/content')) return {
        total: 1, statuses: ['ideia'], eixos: [], formatos: [],
        items: [{ id: 'c1', title: 'Tema', status: 'ideia', statusType: 'open' }],
      };
      throw new Error(`Rota sem fixture: ${rota}`);
    });
  });

  it('/conteudo diz que é espelho do ClickUp, sem dizer leitura, e aponta Quadro interno, Pauta e Banco de ideias', async () => {
    render(<ConteudoPage />);
    const nota = await screen.findByTestId('conteudo-orientacao');
    expect(hrefs(nota)).toEqual(['/trabalho', '/pauta', '/marketing/ideias']);
    expect(screen.getByText(/espelho da lista Gestão de/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('para consulta');
  });

  it('/tarefas abre a tabela nativa e permite navegar para o quadro da mesma lista', async () => {
    render(<TarefasPage />);
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
    const conteudo = render(<ConteudoPage />);
    await waitFor(() => expect(conteudo.container.querySelector('select[title]')).not.toBeNull());
    expect(conteudo.container.textContent).not.toContain('para consulta');
    expect(conteudo.container.textContent?.toLowerCase()).not.toContain('somente leitura');
    conteudo.unmount();
    render(<TarefasPage />);
    await screen.findByRole('columnheader', { name: 'Status' });
    fireEvent.click(screen.getByRole('button', { name: 'Quadro' }));
    const etapa = await screen.findByTitle('Mover etapa');
    expect(etapa).toHaveValue('aberta');
    fireEvent.change(etapa, { target: { value: 'feita' } });
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(`/trabalho/tarefas/${tarefa.id}`, { statusId: 'feita' }, 'tok'));
    expect(document.body.textContent).not.toContain('para consulta');
    expect(document.body.textContent?.toLowerCase()).not.toContain('somente leitura');
  });
});
