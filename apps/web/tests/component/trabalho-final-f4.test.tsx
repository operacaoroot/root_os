import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * VERSÃO FINAL, F4 (19/10/2026): o que veio das tarefas do Lucas para o nosso Trabalho.
 *
 *  1. "Todas" (`?pasta=todas`): todas as listas numa visão só, pela consulta `todas=1`;
 *     no quadro, as colunas são o tipo da etapa e soltar vai à primeira etapa do tipo;
 *  2. seleção em lote na Lista: cada PATCH com a versão lida; conflito não desfaz as outras;
 *  3. calendário: arrastar para outro dia grava o prazo (meio-dia de São Paulo) com versão;
 *  4. ordem manual: arrastar a linha grava a sequência inteira com as versões;
 *  5. pop-up: outros responsáveis, repetir e o aviso da próxima ocorrência;
 *  6. régua de prazo como agrupamento, concluídas ocultas e "meus" com os demais responsáveis.
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn();
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: vi.fn(), apiBlob: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: EU, name: 'Rodrigo QA' }, can: (p: string) => ['tarefas.ver', 'tarefas.editar'].includes(p) }) }));
import TrabalhoPage from '@/app/trabalho/page';
import { hojeEmBrasilia } from '@/lib/horas';

const EU = '0e0e0e0e-0000-4000-8000-000000000001';
const ANA = '0e0e0e0e-0000-4000-8000-000000000002';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const V1 = '2026-10-18T10:00:00.000Z', V2 = '2026-10-18T11:00:00.000Z', V3 = '2026-10-18T12:00:00.000Z';
const MES = hojeEmBrasilia().slice(0, 7);

const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#87909e', order, total: 0, limite: null });
const listaA = { id: 'l-a', name: 'Execução', externalId: null, spaceId: null, order: 0, total: 2, fields: [], statuses: [st('a-aberta', 'A fazer', 'open', 0), st('a-andamento', 'Fazendo', 'custom', 1), st('a-feita', 'Feito', 'closed', 2)] };
const listaB = { id: 'l-b', name: 'Gestão', externalId: null, spaceId: null, order: 1, total: 1, fields: [], statuses: [st('b-aberta', 'Aberta', 'open', 0), st('b-feita', 'Encerrada', 'closed', 1)] };
const estrutura = {
  espacos: [], folders: [{ id: 'f-1', name: 'Clientes', order: 0, spaceId: null, parentId: null, externalId: null, lists: [listaA, listaB] }],
  listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [],
  pessoas: [{ id: EU, name: 'Rodrigo QA', email: 'eu@qa.local', isActive: true }, { id: ANA, name: 'Ana QA', email: 'ana@qa.local', isActive: true }],
};
function tarefa(id: string, title: string, lista: typeof listaA | typeof listaB, statusId: string, extra: Record<string, unknown> = {}) {
  const status = lista.statuses.find((s) => s.id === statusId)!;
  return {
    id, title, listId: lista.id, listName: lista.name, statusId, statusName: status.name, statusType: status.type, statusColor: '#87909e',
    priority: 'normal', assignee: null, assigneeUserId: null, assigneeUserName: null, assigneeUserEmail: null, assigneeUserIsActive: null,
    dueDate: null as string | null, startDate: null, overdue: false, archived: false, agenteId: null, agenteNome: null, agenteSlug: null, agenteEm: null,
    statusDesde: null, minutos: 0, parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: 0, tags: [], values: [],
    clienteId: 'c-1', clienteNome: 'Construtora Alicerce', outrosResponsaveisIds: [] as string[], recorrencia: null, updatedAt: V1, ...extra,
  };
}
let tarefas: ReturnType<typeof tarefa>[] = [];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('root-os:trabalho:densidade', 'medio');
  window.history.replaceState({}, '', '/trabalho');
  get.mockReset(); post.mockReset(); patch.mockReset();
  tarefas = [
    tarefa(T1, 'Enviar proposta', listaA, 'a-aberta', { assigneeUserId: EU, assigneeUserName: 'Rodrigo QA', assigneeUserEmail: 'eu@qa.local', assigneeUserIsActive: true, dueDate: `${MES}-10T15:00:00.000Z`, updatedAt: V1 }),
    tarefa(T2, 'Marcar kickoff', listaB, 'b-aberta', { assigneeUserId: ANA, assigneeUserName: 'Ana QA', assigneeUserEmail: 'ana@qa.local', assigneeUserIsActive: true, outrosResponsaveisIds: [EU], updatedAt: V2 }),
    tarefa(T3, 'Pagar o contador', listaA, 'a-feita', { updatedAt: V3 }),
  ];
  get.mockImplementation((rota: string) => {
    if (rota === '/trabalho/estrutura') return Promise.resolve(estrutura);
    if (rota.startsWith('/trabalho/clientes')) return Promise.resolve([]);
    if (rota.startsWith('/trabalho/vistas')) return Promise.resolve([]);
    if (rota.startsWith('/tenants/onboarding/trilhos')) return Promise.resolve([]);
    if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve({ itens: [] });
    if (rota.startsWith('/trabalho/tarefas?')) {
      const q = new URL(`http://x${rota}`).searchParams;
      const items = q.get('todas') === '1' ? tarefas : tarefas.filter((t) => t.listId === q.get('listId'));
      return Promise.resolve({ total: items.length, items, source: { tool: 'qa', generatedAt: V1 } });
    }
    if (rota.includes('/atividade?')) return Promise.resolve({ escopo: { orgId: 'o', taskId: T1, userId: EU }, consultadoEm: V1, items: [], limit: 50, hasMore: false, nextCursor: null, anchor: null });
    const id = rota.match(/^\/trabalho\/tarefas\/([0-9a-f-]{36})$/)?.[1];
    const achada = tarefas.find((t) => t.id === id);
    if (achada) return Promise.resolve({ ...achada, description: null, createdAt: V1, comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [] });
    return Promise.resolve(null);
  });
  post.mockResolvedValue({ ok: true });
  patch.mockResolvedValue({});
});
afterEach(cleanup);

const query = () => new URLSearchParams(window.location.search);
const consultas = () => get.mock.calls.map(([r]) => String(r)).filter((r) => r.startsWith('/trabalho/tarefas?'));
const arrasto = (id: string) => ({ dataTransfer: { getData: () => id, setData: () => undefined, effectAllowed: 'move' } });

describe('F4: "Todas as tarefas"', () => {
  it('o chip Todas grava ?pasta=todas, consulta todas=1 sem lista e mostra a lista de cada tarefa', async () => {
    window.history.replaceState({}, '', '/trabalho?visao=lista');
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByTestId('trabalho-pasta-todas'));
    expect(query().get('pasta')).toBe('todas');
    expect(screen.getByTestId('trabalho-pasta-todas')).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { name: 'Todas as tarefas' })).toBeInTheDocument();
    await waitFor(() => expect(consultas().some((r) => r.includes('todas=1') && !r.includes('listId'))).toBe(true));
    expect(await screen.findByRole('columnheader', { name: 'Lista' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-work-task-id]')).toHaveLength(3);
  });

  it('no quadro, as colunas são os status reais das listas e, sem o mesmo nome, soltar vai à primeira etapa do tipo, com aviso', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas');
    render(<TrabalhoPage />);
    // Ajuste do Todas (20/10/2026): uma coluna por status real, não mais uma por tipo.
    const aberta = await screen.findByRole('region', { name: 'Aberta: 1 tarefa' });
    expect(within(aberta).getByText('Marcar kickoff')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Fazendo: 0 tarefas' })).toBeInTheDocument();
    const feito = screen.getByRole('region', { name: 'Feito: 1 tarefa' });
    fireEvent.dragOver(feito, arrasto(T2));
    fireEvent.drop(feito, arrasto(T2));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${T2}`, { statusId: 'b-feita', expectedUpdatedAt: V2 }, 'tok'));
    expect(await screen.findByTestId('trabalho-todas-aviso')).toHaveTextContent('Movida para Encerrada (a lista Gestão não tem a etapa Feito).');
  });

  it('o quadro mede onde começa e ocupa até o fim da janela (a rolagem lateral fica visível com o menu recolhido ou não)', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas');
    render(<TrabalhoPage />);
    const caixa = await screen.findByTestId('trabalho-quadro-caixa');
    // No jsdom o topo é 0: a altura é a janela menos a folga de baixo.
    expect(caixa.style.height).toBe(`${window.innerHeight - 24}px`);
  });
});

describe('F4: seleção em lote na Lista', () => {
  it('Concluir manda um PATCH por tarefa, com a etapa fechada da lista dela e a versão lida; o conflito é contado à parte', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&visao=lista');
    patch.mockImplementation((rota: string) => rota.endsWith(T2) ? Promise.reject(Object.assign(new Error('Conflito QA'), { status: 409 })) : Promise.resolve({}));
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByTestId(`trabalho-selecionar-${T1}`));
    fireEvent.click(screen.getByTestId(`trabalho-selecionar-${T2}`));
    expect(screen.getByTestId('trabalho-lote')).toHaveTextContent('2 selecionadas');
    fireEvent.click(screen.getByTestId('trabalho-lote-concluir'));
    const aviso = await screen.findByTestId('trabalho-lote-aviso');
    await waitFor(() => expect(aviso).toHaveTextContent('Concluir: 1 tarefa alterada. 1 mudou desde a leitura e não foi gravada'));
    expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${T1}`, { statusId: 'a-feita', expectedUpdatedAt: V1 }, 'tok');
    expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${T2}`, { statusId: 'b-feita', expectedUpdatedAt: V2 }, 'tok');
  });

  it('numa lista, a etapa do lote é a da lista; o responsável vai pela conta', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-a&visao=lista');
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByTestId('trabalho-selecionar-todas'));
    fireEvent.change(screen.getByLabelText('Responsável das selecionadas'), { target: { value: ANA } });
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${T1}`, { assigneeUserId: ANA, expectedUpdatedAt: V1 }, 'tok');
    expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${T3}`, { assigneeUserId: ANA, expectedUpdatedAt: V3 }, 'tok');
  });
});

describe('F4: calendário e ordem manual', () => {
  it('arrastar para outro dia grava o prazo ao meio-dia de São Paulo, com a versão lida', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&visao=calendario');
    render(<TrabalhoPage />);
    const cartao = await screen.findByTestId(`trabalho-calendario-tarefa-${T1}`);
    expect(screen.getByTestId('trabalho-calendario-sem-prazo')).toHaveTextContent('Marcar kickoff');
    fireEvent.dragStart(cartao, arrasto(T1));
    const dia = document.querySelector(`[data-dia="${MES}-12"]`)!;
    fireEvent.dragOver(dia, arrasto(T1));
    fireEvent.drop(dia, arrasto(T1));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${T1}`, { dueDate: `${MES}-12T15:00:00.000Z`, expectedUpdatedAt: V1 }, 'tok'));
    expect(screen.getByTestId('trabalho-visao-calendario')).toHaveAttribute('aria-pressed', 'true');
  });

  it('arrastar a linha sobre outra grava a sequência inteira com as versões', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-a&visao=lista');
    render(<TrabalhoPage />);
    await waitFor(() => expect(document.querySelectorAll('tr[data-work-task-id]')).toHaveLength(2));
    const [linha1, linha3] = [...document.querySelectorAll('tr[data-work-task-id]')];
    fireEvent.dragStart(linha3, arrasto(T3));
    fireEvent.dragOver(linha1, arrasto(T3));
    fireEvent.drop(linha1, arrasto(T3));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/tarefas/ordem', { itens: [{ id: T3, expectedUpdatedAt: V3 }, { id: T1, expectedUpdatedAt: V1 }] }, 'tok'));
  });
});

describe('F4: o pop-up', () => {
  it('outros responsáveis: adicionar manda a lista inteira com a versão', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-a&visao=lista');
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar proposta' }));
    const seletor = within(await screen.findByTestId('tarefa-outros-responsaveis')).getByLabelText('Adicionar responsável');
    // O principal não aparece entre as opções dos demais.
    expect(within(seletor).queryByRole('option', { name: /eu@qa.local/ })).toBeNull();
    fireEvent.change(seletor, { target: { value: ANA } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${T1}`, { outrosResponsaveisIds: [ANA], expectedUpdatedAt: V1 }, 'tok'));
  });

  it('repetir grava a regra; concluir a que se repete mostra a próxima ocorrência', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-a&visao=lista');
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar proposta' }));
    fireEvent.change(await screen.findByLabelText('Repetir a tarefa'), { target: { value: 'diaria' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${T1}`, { recorrencia: { tipo: 'diaria' }, expectedUpdatedAt: V1 }, 'tok'));
    patch.mockResolvedValueOnce({ proxima: { id: T2, dueDate: '2026-10-21T15:00:00.000Z' } });
    const status = (await screen.findAllByRole('combobox')).find((c) => within(c).queryByRole('option', { name: 'Feito' }))!;
    fireEvent.change(status, { target: { value: 'a-feita' } });
    expect(await screen.findByTestId('tarefa-proxima')).toHaveTextContent('Próxima ocorrência criada para 21/10/2026.');
  });
});

describe('F4: os links da Visão geral do Dia a dia', () => {
  it.each([
    ['prazo=hoje', [T1]],
    ['prazo=proximos7', []],
    ['prazo=proximos_7', []],
    ['prazo=semprazo', [T2]],
    ['prazo=sem_prazo', [T2]],
    ['prazo=emdia', [T1]],
    ['overdue=1', []],
    ['concluidas=1', [T1, T2, T3]],
  ])('/trabalho?pasta=todas&visao=lista&%s mostra o recorte certo', async (filtro, ids) => {
    tarefas[0] = { ...tarefas[0], dueDate: new Date(`${hojeEmBrasilia()}T15:00:00.000Z`).toISOString() };
    window.history.replaceState({}, '', `/trabalho?pasta=todas&visao=lista&${filtro}`);
    render(<TrabalhoPage />);
    await waitFor(() => expect(consultas().some((r) => r.includes('todas=1'))).toBe(true));
    await screen.findByRole('heading', { name: 'Todas as tarefas' });
    await waitFor(() => expect([...document.querySelectorAll('tr[data-work-task-id]')].map((e) => e.getAttribute('data-work-task-id'))).toEqual(ids));
    if (filtro.startsWith('prazo')) expect(screen.getByTestId('trabalho-recorte-prazo')).toBeInTheDocument();
  });

  it('a pessoa e o sem responsável vão à consulta de "Todas"', async () => {
    window.history.replaceState({}, '', `/trabalho?pasta=todas&visao=lista&assigneeUserId=${EU}`);
    render(<TrabalhoPage />);
    await waitFor(() => expect(consultas().some((r) => r.includes('todas=1') && r.includes(`assigneeUserId=${EU}`))).toBe(true));
    cleanup();
    get.mockClear();
    window.history.replaceState({}, '', '/trabalho?pasta=todas&visao=lista&semResponsavel=1');
    render(<TrabalhoPage />);
    await waitFor(() => expect(consultas().some((r) => r.includes('todas=1') && r.includes('semResponsavel=1'))).toBe(true));
  });

  it('"Todas" com uma lista no link abre aquela lista', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&lista=l-b&visao=lista');
    render(<TrabalhoPage />);
    expect(await screen.findByRole('heading', { name: 'Gestão' })).toBeInTheDocument();
    await waitFor(() => expect(consultas().some((r) => r.includes('listId=l-b'))).toBe(true));
  });
});

describe('F4: agrupamento, concluídas e "meus"', () => {
  it('a régua de prazo agrupa a lista: Atrasadas · Concluídas', async () => {
    tarefas[0] = { ...tarefas[0], dueDate: '2020-01-01T15:00:00.000Z' };
    window.history.replaceState({}, '', '/trabalho?lista=l-a&visao=lista&agrupar=prazo');
    render(<TrabalhoPage />);
    expect(await screen.findByRole('columnheader', { name: 'Atrasadas · 1' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Concluídas · 1' })).toBeInTheDocument();
    expect(screen.getByTestId('trabalho-agrupar')).toHaveValue('prazo');
  });

  it('ocultar concluídas tira a concluída da lista e grava no endereço', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-a&visao=lista');
    render(<TrabalhoPage />);
    await waitFor(() => expect(document.querySelectorAll('tr[data-work-task-id]')).toHaveLength(2));
    // Rodada da interface (U2): "Ocultar concluídas" mora no painel de "Filtros" e conta como filtro ativo.
    fireEvent.click(screen.getByTestId('trabalho-filtros-botao'));
    fireEvent.click(screen.getByTestId('trabalho-filtros-concluidas'));
    expect(query().get('concluidas')).toBe('ocultar');
    expect(screen.getByTestId('trabalho-filtros-contagem')).toHaveTextContent('(1)');
    expect([...document.querySelectorAll('tr[data-work-task-id]')].map((e) => e.getAttribute('data-work-task-id'))).toEqual([T1]);
  });

  it('"meus" inclui a tarefa em que a pessoa é uma das demais responsáveis', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-b&visao=lista&escopo=meus');
    render(<TrabalhoPage />);
    await waitFor(() => expect([...document.querySelectorAll('tr[data-work-task-id]')].map((e) => e.getAttribute('data-work-task-id'))).toEqual([T2]));
    // I6 (produção 22B): os demais responsáveis entram na pilha de avatares, o nome no balão.
    const linha = document.querySelector(`tr[data-work-task-id="${T2}"]`) as HTMLElement;
    expect(within(linha).getByRole('img', { name: 'Responsável: Rodrigo QA' })).toBeTruthy();
  });
});
