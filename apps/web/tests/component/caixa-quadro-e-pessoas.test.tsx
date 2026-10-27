import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TrabTarefaResumo } from '@mktos/shared';

/*
 * Layout 26/10 (Lucas), Dia a dia › Minhas tarefas: "Aqui falta a visualização de quadro e
 * eu quero poder ver as tarefas de outras pessoas, já que eu sou responsável por que isso flua."
 *  1. o filtro Responsável tem cada pessoa da equipe e manda o id dela na consulta;
 *  2. "Por responsável" no Agrupar;
 *  3. a forma Quadro: colunas das etapas das listas das tarefas (pelo nome, na ordem do
 *     tipo); arrastar muda a etapa dentro da lista da tarefa, ou diz que ela não tem a etapa.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Lucas', email: 'l@x.com', roles: [], permissions: ['dashboard.ver', 'tarefas.ver', 'tarefas.editar'] },
    can: (p: string) => p !== 'leads.ver',
  }),
}));

// eslint-disable-next-line import/first
import { AbaMinhasTarefas } from '@/app/caixa/AbaMinhasTarefas';

const AGORA = new Date();
const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#999', order, total: 0, limite: null });
const L1 = { id: 'l-1', name: 'Execução', externalId: null, spaceId: null, order: 0, total: 1, fields: [], statuses: [st('s1-a', 'A fazer', 'open', 0), st('s1-f', 'Feito', 'closed', 1)] };
const L2 = { id: 'l-2', name: 'Conteúdo', externalId: null, spaceId: null, order: 1, total: 1, fields: [], statuses: [st('s2-a', 'A fazer', 'open', 0), st('s2-r', 'Em revisão', 'custom', 1), st('s2-c', 'Concluída', 'closed', 2)] };
const ESTRUTURA = {
  espacos: [], folders: [{ id: 'p-1', name: 'Operação', order: 0, spaceId: null, parentId: null, externalId: null, lists: [L1, L2] }],
  listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [],
  pessoas: [
    { id: 'u-eu', name: 'Lucas', email: 'l@x.com', isActive: true },
    { id: 'u-pedro', name: 'Pedro', email: 'p@x.com', isActive: true },
    { id: 'u-velho', name: 'Conta antiga', email: 'v@x.com', isActive: false },
  ],
};

function tarefa(id: string, title: string, over: Partial<TrabTarefaResumo> = {}): TrabTarefaResumo {
  return {
    id, title, listId: 'l-1', listName: 'Execução', statusId: 's1-a', statusName: 'A fazer', statusType: 'open', statusColor: '#999',
    priority: 'normal', assignee: null, assigneeUserId: 'u-eu', assigneeUserName: 'Lucas', assigneeUserEmail: 'l@x.com', assigneeUserIsActive: true,
    agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null, statusDesde: null, minutos: 0,
    dueDate: null, startDate: null, overdue: false, parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null,
    archived: false, order: 0, tags: [], values: [], clienteId: null, clienteNome: null, outrosResponsaveisIds: [], recorrencia: null,
    updatedAt: '2026-10-26T10:00:00.000Z', ...over,
  } as TrabTarefaResumo;
}

let ITENS: TrabTarefaResumo[] = [];

beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset(); apiPatch.mockReset();
  apiPatch.mockResolvedValue({});
  window.localStorage.clear();
  window.history.replaceState(null, '', '/caixa?aba=tarefas');
  ITENS = [
    tarefa('t-1', 'Fechar o mês'),
    tarefa('t-2', 'Revisar o roteiro', { listId: 'l-2', listName: 'Conteúdo', statusId: 's2-a' }),
  ];
  apiGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/vistas')) return Promise.resolve([]);
    if (rota === '/trabalho/estrutura') return Promise.resolve(ESTRUTURA);
    if (rota.startsWith('/organograma/equipe')) return Promise.reject(new Error('sem equipe'));
    if (rota.startsWith('/trabalho/tarefas?')) return Promise.resolve({ total: ITENS.length, items: ITENS });
    return Promise.reject(new Error(`rota inesperada ${rota}`));
  });
});

describe('Layout 26/10: Minhas tarefas vê as tarefas de outra pessoa', () => {
  it('o filtro Responsável tem cada pessoa ativa da equipe e manda o id dela; vazio diz o nome', async () => {
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-1');
    const filtro = screen.getByTestId('caixa-filtro-responsavel');
    await waitFor(() => expect([...filtro.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Eu', 'Qualquer pessoa', 'Pedro']));
    ITENS = [];
    fireEvent.change(filtro, { target: { value: 'u-pedro' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/trabalho/tarefas?assigneeUserId=u-pedro&page=1&limit=500', 'tok'));
    expect(await screen.findByText('Nenhuma tarefa aberta com Pedro como responsável.')).toBeInTheDocument();
  });

  it('"Por responsável" está no Agrupar', async () => {
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-1');
    fireEvent.change(screen.getByTestId('caixa-agrupar'), { target: { value: 'responsavel' } });
    expect(document.querySelector('[data-grupo="Lucas"]')).not.toBeNull();
  });
});

describe('Layout 26/10: o Quadro em Minhas tarefas', () => {
  const arrasto = (id: string) => ({ dataTransfer: { getData: () => id, setData: () => undefined, effectAllowed: 'move', dropEffect: 'move' } });
  const soltarEm = (cartao: string, coluna: string) => {
    fireEvent.dragStart(screen.getByTestId(`caixa-quadro-cartao-${cartao}`), arrasto(cartao));
    const alvo = screen.getByTestId(`caixa-quadro-coluna-${coluna}`);
    fireEvent.dragOver(alvo, arrasto(cartao));
    fireEvent.drop(alvo, arrasto(cartao));
  };

  it('as colunas são as etapas das listas das tarefas, pelo nome, na ordem do tipo', async () => {
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-1');
    fireEvent.click(screen.getByTestId('caixa-forma-quadro'));
    const quadro = await screen.findByTestId('caixa-quadro');
    expect(within(quadro).getAllByRole('region').map((c) => c.getAttribute('aria-label'))).toEqual(['A fazer: 2', 'Em revisão: 0', 'Feito: 0', 'Concluída: 0']);
    expect(window.localStorage.getItem('caixa.tarefas.forma.v1')).toBe('quadro');
  });

  it('arrastar muda a etapa dentro da lista da tarefa; a lista sem a etapa recusa com a frase', async () => {
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-1');
    fireEvent.click(screen.getByTestId('caixa-forma-quadro'));
    await screen.findByTestId('caixa-quadro');
    soltarEm('t-1', 'nome:em revisao');
    expect(screen.getByTestId('caixa-quadro-aviso')).toHaveTextContent('a lista Execução não tem essa etapa');
    expect(apiPatch).not.toHaveBeenCalled();
    soltarEm('t-2', 'nome:em revisao');
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/trabalho/tarefas/t-2', { statusId: 's2-r', expectedUpdatedAt: '2026-10-26T10:00:00.000Z' }, 'tok'));
  });
});
