import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * TRABALHO VIRA PASTAS; QUADRO E LISTA VIRAM UM (rodada do painel P2, 18/10/2026).
 *
 *  1. o seletor de pasta mora no topo (Todas · <pastas de topo> · Sem pasta), filtra
 *     a árvore e guarda o estado em `?pasta=`;
 *  2. Quadro · Lista é a mesma fonte; `?visao=lista` e o `?visao=tabela` antigo
 *     abrem a lista, e o clique escreve `?visao=lista`;
 *  3. sem pasta nenhuma, quem edita vê "Criar a estrutura sugerida";
 *  4. a lista muda de pasta pelo seletor do cabeçalho (`PATCH /trabalho/listas/:id`);
 *  5. o cartão ligado a um trilho (`cardId`) linka o trilho; os outros, não.
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn();
let permissions = ['tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: vi.fn(), apiBlob: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u' }, can: (p: string) => permissions.includes(p) }) }));
import TrabalhoPage from '@/app/trabalho/page';

const status = (id: string, name: string) => ({ id, name, type: 'open', color: '#87909e', order: 0, total: 1, limite: null });
const lista = (id: string, name: string) => ({ id, name, externalId: null, spaceId: null, order: 0, total: 1, statuses: [status(`st-${id}`, 'Aberta')], fields: [] });
const ADM = '0a0a0a0a-0000-4000-8000-000000000001';
const CLI = '0a0a0a0a-0000-4000-8000-000000000002';
const SUB = '0a0a0a0a-0000-4000-8000-000000000003';
const estruturaCheia = {
  espacos: [],
  folders: [
    { id: ADM, name: 'Administrativa', order: 0, spaceId: null, parentId: null, externalId: null, lists: [lista('l-adm', 'Contas a pagar')] },
    { id: CLI, name: 'Clientes', order: 1, spaceId: null, parentId: null, externalId: null, lists: [lista('l-esteira', 'Esteira de clientes')] },
    { id: SUB, name: 'Arquivo', order: 0, spaceId: null, parentId: CLI, externalId: null, lists: [lista('l-sub', 'Encerrados')] },
  ],
  listasSoltas: [lista('l-solta', 'Avulsa')],
  camposGlobais: [], tags: [], responsaveis: [], agentes: [],
};
const vazia = { ...estruturaCheia, folders: [], listasSoltas: [] };
const TAREFA = '11111111-1111-4111-8111-111111111111';
const OUTRA = '22222222-2222-4222-8222-222222222222';
const tarefa = (id: string, listId: string, title: string) => ({
  id, listId, title, statusId: `st-${listId}`, statusName: 'Aberta', statusType: 'open', statusColor: '#87909e', priority: 'normal',
  assignee: null, dueDate: null, startDate: null, overdue: false, archived: false, agenteId: null, agenteNome: null, agenteSlug: null,
  agenteEm: null, statusDesde: null, minutos: 0, parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: 0, tags: [], values: [],
});

let estrutura: typeof estruturaCheia = estruturaCheia;
beforeEach(() => {
  window.localStorage.removeItem('root-os:trabalho:densidade');
  window.history.replaceState({}, '', '/trabalho');
  permissions = ['tarefas.ver', 'tarefas.editar'];
  estrutura = estruturaCheia;
  get.mockReset(); post.mockReset(); patch.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota === '/trabalho/estrutura') return Promise.resolve(estrutura);
    if (rota === '/tenants/onboarding/trilhos') return Promise.resolve([
      { id: 'trilho-1', cliente: 'Alicerce', faseRotulo: '1 · Diagnóstico', cardId: TAREFA },
      { id: 'trilho-2', cliente: 'Sem cartão', faseRotulo: '0 · Qualificar', cardId: null },
    ]);
    if (rota.startsWith('/trabalho/tarefas?')) {
      const listId = new URL(`http://x${rota}`).searchParams.get('listId')!;
      return Promise.resolve({ total: 2, items: [tarefa(TAREFA, listId, 'Alicerce'), tarefa(OUTRA, listId, 'Sem trilho')] });
    }
    return Promise.resolve(null);
  });
  post.mockResolvedValue({ criadas: { pastas: ['Administrativa', 'Gestão', 'Clientes'], listas: ['a', 'b', 'c'] }, jaExistiam: { pastas: [], listas: [] } });
  patch.mockResolvedValue({});
});
afterEach(cleanup);

const arvore = () => document.querySelector('aside')!;
const query = () => new URLSearchParams(window.location.search);

describe('Trabalho: o seletor de pasta no topo', () => {
  it('mostra Todas, as pastas de topo e Sem pasta; a subpasta não vira chip', async () => {
    render(<TrabalhoPage />);
    await screen.findByTestId('trabalho-pasta-todas');
    const chips = within(screen.getByRole('group', { name: 'Pastas' })).getAllByRole('button').map((b) => b.textContent?.trim());
    expect(chips).toEqual(['Todas', 'Administrativa', 'Clientes', 'Sem pasta', 'Nova pasta']);
    expect(screen.queryByTestId(`trabalho-pasta-${SUB}`)).toBeNull();
    expect(screen.getByTestId('trabalho-pasta-todas')).toHaveAttribute('aria-pressed', 'true');
    // Todas: a árvore mostra tudo
    for (const n of ['Contas a pagar', 'Esteira de clientes', 'Encerrados', 'Avulsa']) expect(within(arvore()).getByText(n)).toBeInTheDocument();
  });

  it('escolher Clientes filtra a árvore (com a subpasta), grava ?pasta= e abre a primeira lista dela', async () => {
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByTestId(`trabalho-pasta-${CLI}`));
    expect(screen.getByTestId(`trabalho-pasta-${CLI}`)).toHaveAttribute('aria-pressed', 'true');
    expect(query().get('pasta')).toBe(CLI);
    expect(within(arvore()).queryByText('Contas a pagar')).toBeNull();
    expect(within(arvore()).queryByText('Avulsa')).toBeNull();
    expect(within(arvore()).getByText('Esteira de clientes')).toBeInTheDocument();
    expect(within(arvore()).getByText('Encerrados')).toBeInTheDocument();
    await waitFor(() => expect(query().get('lista')).toBe('l-esteira'));
    expect(await screen.findByRole('heading', { name: 'Esteira de clientes' })).toBeInTheDocument();
  });

  it('Sem pasta mostra só as listas soltas; ?pasta= no link já abre filtrado', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=sem-pasta');
    render(<TrabalhoPage />);
    await screen.findByTestId('trabalho-pasta-sem-pasta');
    await waitFor(() => expect(within(arvore()).getByText('Avulsa')).toBeInTheDocument());
    expect(within(arvore()).queryByText('Contas a pagar')).toBeNull();
    expect(screen.getByTestId('trabalho-pasta-sem-pasta')).toHaveAttribute('aria-pressed', 'true');
    // a lista aberta é a primeira da pasta escolhida (a carga inicial não escreve ?lista=)
    expect(await screen.findByRole('heading', { name: 'Avulsa' })).toBeInTheDocument();
  });

  it('Nova pasta cria uma pasta de topo pelo POST /trabalho/pastas', async () => {
    post.mockResolvedValueOnce({ id: 'nova' });
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByTestId('trabalho-nova-pasta'));
    fireEvent.change(screen.getByTestId('trabalho-nova-pasta-nome'), { target: { value: '  Operacional ' } });
    fireEvent.click(screen.getByTestId('trabalho-nova-pasta-criar'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/pastas', { name: 'Operacional' }, 'tok'));
  });

  it('sem tarefas.editar não há Nova pasta, nem mover lista, nem estrutura sugerida', async () => {
    permissions = ['tarefas.ver'];
    estrutura = vazia;
    render(<TrabalhoPage />);
    await screen.findByTestId('trabalho-pasta-todas');
    expect(screen.queryByTestId('trabalho-nova-pasta')).toBeNull();
    expect(screen.queryByTestId('trabalho-estrutura-sugerida')).toBeNull();
    expect(screen.queryByTestId('trabalho-mover-lista')).toBeNull();
  });
});

describe('Trabalho: a estrutura sugerida', () => {
  it('empresa sem pasta vê o botão; o clique chama a rota e recarrega a estrutura', async () => {
    estrutura = vazia;
    render(<TrabalhoPage />);
    const botao = await screen.findByTestId('trabalho-estrutura-sugerida');
    estrutura = estruturaCheia;
    fireEvent.click(botao);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/estrutura/sugerida', {}, 'tok'));
    expect(await screen.findByText(/Criadas 3 pasta\(s\) e 3 lista\(s\)/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('trabalho-estrutura-sugerida')).toBeNull());
    expect(get.mock.calls.filter(([r]) => r === '/trabalho/estrutura').length).toBeGreaterThanOrEqual(2);
  });

  it('empresa com pasta não vê o botão', async () => {
    render(<TrabalhoPage />);
    await screen.findByTestId('trabalho-pasta-todas');
    expect(screen.queryByTestId('trabalho-estrutura-sugerida')).toBeNull();
  });
});

describe('Trabalho: Quadro e Lista são uma tela só', () => {
  it.each([['lista'], ['tabela']])('?visao=%s abre a lista (o valor antigo continua valendo)', async (v) => {
    window.history.replaceState({}, '', `/trabalho?visao=${v}`);
    render(<TrabalhoPage />);
    expect(await screen.findByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByTestId('trabalho-visao-lista')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('trabalho-visao-lista')).toHaveTextContent('Lista');
  });

  it('a troca escreve ?visao=lista e ?visao=board, sobre as mesmas tarefas', async () => {
    render(<TrabalhoPage />);
    await screen.findByTestId('trabalho-visao-quadro');
    await waitFor(() => expect(document.querySelectorAll('[data-work-task-id]').length).toBe(2));
    const noQuadro = [...document.querySelectorAll('[data-work-task-id]')].map((e) => e.getAttribute('data-work-task-id'));
    fireEvent.click(screen.getByTestId('trabalho-visao-lista'));
    expect(query().get('visao')).toBe('lista');
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect([...document.querySelectorAll('[data-work-task-id]')].map((e) => e.getAttribute('data-work-task-id'))).toEqual(noQuadro);
    fireEvent.click(screen.getByTestId('trabalho-visao-quadro'));
    expect(query().get('visao')).toBe('board');
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
  });
});

describe('Trabalho: mover lista de pasta', () => {
  it('o seletor do cabeçalho mostra a pasta da lista e o PATCH leva o folderId (ou null)', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-adm');
    render(<TrabalhoPage />);
    const mover = await screen.findByTestId('trabalho-mover-lista');
    await waitFor(() => expect(mover).toHaveValue(ADM));
    fireEvent.change(mover, { target: { value: CLI } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/trabalho/listas/l-adm', { folderId: CLI }, 'tok'));
    fireEvent.change(mover, { target: { value: '' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/trabalho/listas/l-adm', { folderId: null }, 'tok'));
  });

  it('pelo teclado, cada seta NÃO grava: a pasta grava no Enter (ou ao sair do campo), e Esc desfaz', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-adm');
    render(<TrabalhoPage />);
    const mover = await screen.findByTestId('trabalho-mover-lista');
    await waitFor(() => expect(mover).toHaveValue(ADM));
    patch.mockClear();
    fireEvent.keyDown(mover, { key: 'ArrowDown' });
    fireEvent.change(mover, { target: { value: CLI } });
    fireEvent.keyDown(mover, { key: 'ArrowDown' });
    fireEvent.change(mover, { target: { value: '' } });
    expect(patch).not.toHaveBeenCalled();
    fireEvent.keyDown(mover, { key: 'Escape' });
    expect(mover).toHaveValue(ADM);
    fireEvent.blur(mover);
    expect(patch).not.toHaveBeenCalled();
    fireEvent.keyDown(mover, { key: 'ArrowDown' });
    fireEvent.change(mover, { target: { value: CLI } });
    fireEvent.keyDown(mover, { key: 'Enter' });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/trabalho/listas/l-adm', { folderId: CLI }, 'tok'));
    expect(patch).toHaveBeenCalledTimes(1);
  });
});

describe('Trabalho: a implantação aglutinada', () => {
  it('só o cartão com trilho ligado (cardId) linka o trilho, no quadro e na lista', async () => {
    // Rodada da implantação I2: o atalho do trilho no cartão aparece a partir da densidade média.
    window.localStorage.setItem('root-os:trabalho:densidade', 'medio');
    render(<TrabalhoPage />);
    const atalho = await screen.findByTestId('trabalho-trilho-trilho-1');
    // Rodada do trabalho T2: o atalho abre a aba Trilho do pop-up do cartão, sem sair do quadro.
    expect(atalho.tagName).toBe('BUTTON');
    expect(atalho).toHaveTextContent('1 · Diagnóstico');
    expect(atalho.closest('[data-work-task-id]')).toHaveAttribute('data-work-task-id', TAREFA);
    expect(document.querySelectorAll('[data-testid^="trabalho-trilho-"]')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('trabalho-visao-lista'));
    const naLinha = screen.getByTestId('trabalho-trilho-trilho-1');
    expect(naLinha.closest('tr')).toHaveAttribute('data-work-task-id', TAREFA);
  });

  it('a consulta de trilhos falhar não derruba o quadro', async () => {
    const base = get.getMockImplementation()!;
    get.mockImplementation((rota: string) => (rota === '/tenants/onboarding/trilhos' ? Promise.reject(new Error('fora')) : base(rota)));
    render(<TrabalhoPage />);
    await waitFor(() => expect(document.querySelectorAll('[data-work-task-id]').length).toBe(2));
    expect(screen.queryByTestId('trabalho-trilho-trilho-1')).toBeNull();
    expect(screen.queryByText('fora')).toBeNull();
  });
});
