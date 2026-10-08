import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const get = vi.fn(), patch = vi.fn(), remove = vi.fn();
let token = 'qa-sessao-a', pessoa = 'qa-pessoa-a';
let permissions = ['tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/api', () => ({ apiGet: (...a: unknown[]) => get(...a), apiPatch: (...a: unknown[]) => patch(...a),
  apiDelete: (...a: unknown[]) => remove(...a), apiPost: vi.fn(), apiBlob: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token, ready: true, user: { id: pessoa }, can: (p: string) => permissions.includes(p) }) }));
import TrabalhoPage from '@/app/trabalho/page';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const VERSION = '2026-10-08T04:00:00.000Z', NEXT = '2026-10-08T04:01:00.000Z';
const list = { id: 'qa-lista', name: 'Lista QA', total: 2, statuses: [{ id: 'qa-status', name: 'A fazer', type: 'open', color: '#000000', order: 0, total: 2, limite: null }], fields: [], order: 0, externalId: null };
const structure = { folders: [], listasSoltas: [list], camposGlobais: [], tags: [], responsaveis: [], agentes: [], pessoas: [{ id: 'qa-pessoa-a', name: 'Pessoa QA', email: 'fixture@example.invalid', isActive: true }] };
function task(id: string, title: string) {
  return { id, title, listId: list.id, listName: list.name, statusId: 'qa-status', statusName: 'A fazer', statusType: 'open', statusColor: '#000000', priority: 'normal', assignee: null,
    assigneeUserId: 'qa-pessoa-a', assigneeUserName: 'Pessoa QA', assigneeUserEmail: 'fixture@example.invalid', assigneeUserIsActive: true,
    description: 'Material privado QA ' + title, dueDate: null, startDate: null, overdue: false, archived: false,
    agenteId: null, agenteNome: null, agenteSlug: null, agenteEm: null, statusDesde: null, minutos: 0,
    parentId: null, subtasks: 0, comments: 1, externalId: null, externalUrl: null, order: 0, tags: [], values: [],
    comentarios: [{ id: 'qa-comentario-' + id, authorId: pessoa, authorName: 'Pessoa QA', text: 'Comentário preservado QA ' + title, createdAt: VERSION }],
    atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [], createdAt: VERSION, updatedAt: VERSION as string | undefined };
}
let a = task(A, 'Tarefa A QA'), b = task(B, 'Tarefa B QA');
function servir(path: string) {
  if (path === '/trabalho/estrutura') return Promise.resolve(structure);
  if (path.startsWith('/trabalho/tarefas?')) { const items = [a, b].filter((t) => !t.archived); return Promise.resolve({ items, total: items.length }); }
  if (path === '/trabalho/tarefas/' + A) return Promise.resolve({ ...a });
  if (path === '/trabalho/tarefas/' + B) return Promise.resolve({ ...b });
  if (path.includes('/atividade?')) return Promise.resolve({ escopo: { orgId: 'qa-empresa-a', taskId: path.split('/')[3], userId: pessoa }, consultadoEm: VERSION, items: [], limit: 50, hasMore: false, nextCursor: null, anchor: null });
  return Promise.resolve(null);
}
function pendente<T>() {
  let resolve!: (x: T) => void, reject!: (x: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject };
}
async function abrirA() { fireEvent.click(await screen.findByRole('button', { name: 'Tarefa A QA' })); await screen.findByLabelText('Título da tarefa'); }
const archive = () => screen.getByRole('button', { name: 'Arquivar tarefa' });
beforeEach(() => {
  token = 'qa-sessao-a'; pessoa = 'qa-pessoa-a'; permissions = ['tarefas.ver', 'tarefas.editar'];
  a = task(A, 'Tarefa A QA'); b = task(B, 'Tarefa B QA');
  window.history.replaceState({}, '', '/trabalho'); get.mockReset(); patch.mockReset(); remove.mockReset();
  get.mockImplementation(servir);
  patch.mockImplementation((path: string, input: object) => { Object.assign(path.endsWith(A) ? a : b, input, { updatedAt: NEXT }); return Promise.resolve({}); });
});
afterEach(cleanup);

describe('M02: arquivamento da gaveta usa a versão conferida, API simulada', () => {
  it('arquiva por PATCH exato, mantém o card e fecha somente após confirmação', async () => {
    render(<TrabalhoPage />); await abrirA(); fireEvent.click(archive());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patch).toHaveBeenCalledExactlyOnceWith('/trabalho/tarefas/' + A, { archived: true, expectedUpdatedAt: VERSION }, token);
    expect(remove).not.toHaveBeenCalled(); expect(a.archived).toBe(true);
    expect(a.id).toBe(A); expect(a.description).toBe('Material privado QA Tarefa A QA'); expect(a.comentarios).toHaveLength(1);
    expect(new URLSearchParams(window.location.search).has('tarefa')).toBe(false);
  });
  it('uma chamada pendente bloqueia clique repetido e só depois fecha o painel', async () => {
    const late = pendente<unknown>(); patch.mockReturnValueOnce(late.promise);
    render(<TrabalhoPage />); await abrirA(); const button = archive(); fireEvent.click(button); fireEvent.click(button);
    expect(patch).toHaveBeenCalledOnce(); expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(button).toBeDisabled();
    a = { ...a, archived: true, updatedAt: NEXT }; await act(async () => late.resolve({}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it.each([undefined, '', 'data-inválida', '2026-10-08'])('versão ausente ou malformada%s não envia escrita', async (version) => {
    a.updatedAt = version; render(<TrabalhoPage />); await abrirA(); fireEvent.click(archive());
    await screen.findByText('Recarregue a tarefa antes de editar: a versão não está disponível.');
    expect(patch).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(a.archived).toBe(false);
  });
  it('timestamp com offset válido é enviado sem trocar a versão lida', async () => {
    a.updatedAt = '2026-10-08T01:00:00-03:00'; render(<TrabalhoPage />); await abrirA(); fireEvent.click(archive());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patch.mock.calls[0][1].expectedUpdatedAt).toBe('2026-10-08T01:00:00-03:00');
  });
  it('409 conserva intenção/material e exige consulta atual antes de descartar', async () => {
    patch.mockRejectedValueOnce(Object.assign(new Error('Conflito QA.'), { status: 409 }));
    render(<TrabalhoPage />); await abrirA(); fireEvent.click(archive());
    const alert = await screen.findByRole('alert'); expect(within(alert).getByText('Arquivar tarefa')).toBeInTheDocument();
    expect(archive()).toBeDisabled(); const discard = screen.getByRole('button', { name: 'Descartar alteração' }); expect(discard).toBeDisabled();
    fireEvent.click(discard); expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Comentário preservado QA Tarefa A QA')).toBeInTheDocument();
    expect(a.archived).toBe(false); expect(patch).toHaveBeenCalledOnce();
    a = { ...a, title: 'Título vigente QA', updatedAt: NEXT };
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar tarefa' }));
    await waitFor(() => expect(screen.getByLabelText('Título da tarefa')).toHaveValue('Título vigente QA'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descartar alteração' })).toBeEnabled()); expect(patch).toHaveBeenCalledOnce();
    expect(within(screen.getByRole('alert')).getByText('Arquivar tarefa')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar alteração' })); expect(screen.queryByRole('alert')).toBeNull(); expect(a.archived).toBe(false);
    fireEvent.click(archive()); await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls[1][1]).toEqual({ archived: true, expectedUpdatedAt: NEXT }); expect(remove).not.toHaveBeenCalled();
  });
  it('PATCH confirmado e GET falho mantém aviso de gravação e não envia outra escrita', async () => {
    let reads = 0;
    get.mockImplementation((path: string) => path === '/trabalho/tarefas/' + A && ++reads === 2 ? Promise.reject(new TypeError('Leitura QA interrompida.')) : servir(path));
    render(<TrabalhoPage />); await abrirA(); fireEvent.click(archive());
    await screen.findByText('A alteração foi gravada, mas não conseguimos ler a versão atual. Recarregue a tarefa antes de editar novamente.');
    expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(archive()).toBeDisabled();
    expect(a.archived).toBe(true); fireEvent.click(archive()); expect(patch).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled();
  });
  it('falha de transporte não confirma efeito e exige leitura antes da próxima decisão', async () => {
    patch.mockRejectedValueOnce(new TypeError('Resposta QA perdida.'));
    render(<TrabalhoPage />); await abrirA(); fireEvent.click(archive());
    await screen.findByText('Não foi possível confirmar a alteração. Recarregue a tarefa antes de tentar novamente.');
    expect(screen.getByText('Alteração a conferir')).toBeInTheDocument(); expect(archive()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descartar alteração' })).toBeDisabled();
    expect(patch).toHaveBeenCalledOnce(); expect(a.archived).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar tarefa' }));
    await screen.findByText('A versão atual foi carregada. Confira o resultado antes de decidir sobre a alteração abaixo.');
    expect(patch).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'Descartar alteração' })).toBeEnabled();
  });
  it.each([401, 403, 404])('recusa%s de escrita retira o material do painel', async (status) => {
    patch.mockRejectedValueOnce(Object.assign(new Error('Acesso recusado QA.'), { status }));
    render(<TrabalhoPage />); await abrirA(); fireEvent.click(archive()); await screen.findByText('Acesso recusado QA.');
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText('Comentário preservado QA Tarefa A QA')).toBeNull(); expect(a.archived).toBe(false);
  });
  it.each(['resposta', '409', '403'])('confirmação/erro tardio%s não fecha nem altera o outro card', async (kind) => {
    const late = pendente<unknown>(); patch.mockReturnValueOnce(late.promise);
    render(<TrabalhoPage />); await abrirA(); fireEvent.click(archive());
    fireEvent.click(screen.getByRole('button', { name: 'Fechar tarefa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tarefa B QA' })); await screen.findByLabelText('Título da tarefa');
    const before = get.mock.calls.length;
    await act(async () => kind === 'resposta' ? late.resolve({}) : late.reject(Object.assign(new Error('Erro antigo QA.'), { status: Number(kind) })));
    expect(screen.getByLabelText('Título da tarefa')).toHaveValue('Tarefa B QA');
    expect(screen.getByText('Comentário preservado QA Tarefa B QA')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBe(B);
    expect(screen.queryByText('Erro antigo QA.')).toBeNull(); expect(get.mock.calls.length).toBe(before);
  });
  it('resposta de arquivamento da pessoa anterior não fecha a tarefa da sessão nova', async () => {
    const late = pendente<unknown>(); patch.mockReturnValueOnce(late.promise);
    const view = render(<TrabalhoPage />); await abrirA(); fireEvent.click(archive());
    pessoa = 'qa-pessoa-b'; token = 'qa-sessao-b';
    window.history.replaceState({}, '', '/trabalho?lista=qa-lista&tarefa=' + B); view.rerender(<TrabalhoPage />);
    await waitFor(() => expect(screen.getByLabelText('Título da tarefa')).toHaveValue('Tarefa B QA'));
    await act(async () => late.resolve({}));
    expect(screen.getByLabelText('Título da tarefa')).toHaveValue('Tarefa B QA'); expect(new URLSearchParams(window.location.search).get('tarefa')).toBe(B);
  });
  it('pessoa com leitura não recebe ação de arquivamento', async () => {
    permissions = ['tarefas.ver']; render(<TrabalhoPage />); await abrirA();
    expect(screen.queryByRole('button', { name: 'Arquivar tarefa' })).toBeNull(); expect(patch).not.toHaveBeenCalled();
  });
});
