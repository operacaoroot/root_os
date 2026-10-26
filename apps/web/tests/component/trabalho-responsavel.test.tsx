import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponsavelDaTarefa, SeletorResponsavel } from '@/components/trabalho/ResponsavelDaTarefa';

const get = vi.fn(), patch = vi.fn();
let permissions = ['tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/api', () => ({ apiGet: (...args: unknown[]) => get(...args), apiPatch: (...args: unknown[]) => patch(...args), apiPost: vi.fn(), apiDelete: vi.fn(), apiBlob: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'qa-token', ready: true, user: { id: 'qa-eu' }, can: (p: string) => permissions.includes(p) }) }));
import TrabalhoPage from '@/app/trabalho/page';

const pessoas = [
  { id: 'qa-eu', name: 'Pessoa QA', email: 'eu@qa.local', isActive: true },
  { id: 'qa-homonimo', name: 'Pessoa QA', email: 'homonimo@qa.local', isActive: true },
  { id: 'qa-inativo', name: 'Antiga QA', email: 'inativa@qa.local', isActive: false },
];
const semVinculo = { assigneeUserId: null, assigneeUserName: null, assigneeUserEmail: null, assigneeUserIsActive: null };
const vinculo = { assigneeUserId: pessoas[0].id, assigneeUserName: pessoas[0].name, assigneeUserEmail: pessoas[0].email, assigneeUserIsActive: true };
const ID = '11111111-1111-4111-8111-111111111111';
const versao = '2026-10-07T19:00:00.000Z';
const lista = { id: 'qa-lista', name: 'Lista QA', total: 1, statuses: [{ id: 'status-a', name: 'A fazer', type: 'open', color: '#000000', total: 1, order: 0, limite: null }, { id: 'status-b', name: 'Em andamento', type: 'custom', color: '#eeeeee', total: 0, order: 1, limite: null }], fields: [], order: 0, externalId: null };
const estrutura = { folders: [], listasSoltas: [lista], camposGlobais: [], tags: [], responsaveis: ['Texto antigo QA'], agentes: [], pessoas };
const original = { id: ID, title: 'Entrega QA', listId: lista.id, listName: lista.name, statusId: 'status-a', statusName: 'A fazer', statusType: 'open', statusColor: '#000000', priority: 'normal', assignee: 'Texto antigo QA', ...vinculo, description: 'Material preservado QA', dueDate: null, startDate: null, overdue: false, archived: false, agenteId: null, agenteNome: null, agenteSlug: null, agenteEm: null, statusDesde: null, minutos: 0, parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: 0, tags: [], values: [], comentarios: [], atividade: [], filhos: [], createdAt: versao, updatedAt: versao };
let tarefa = { ...original };
function servir(path: string) {
  if (path === '/trabalho/estrutura') return Promise.resolve(estrutura);
  if (path.startsWith('/trabalho/tarefas?')) return Promise.resolve({ items: [tarefa], total: 1 });
  if (path === `/trabalho/tarefas/${ID}`) return Promise.resolve({ ...tarefa });
  return Promise.resolve(null);
}
beforeEach(() => { window.localStorage.clear(); window.localStorage.setItem('root-os:trabalho:densidade', 'cheio'); window.history.replaceState({}, '', '/trabalho'); permissions = ['tarefas.ver', 'tarefas.editar']; tarefa = { ...original }; get.mockReset(); patch.mockReset(); get.mockImplementation(servir); patch.mockResolvedValue({}); });
afterEach(cleanup);

describe('responsável por conta, sem associação por texto', () => {
  it('distingue homônimos por email e seleciona somente seu ID', async () => {
    const mudar = vi.fn().mockResolvedValue(undefined);
    render(<SeletorResponsavel tarefa={semVinculo} pessoas={pessoas} disabled={false} onChange={mudar} />);
    expect(screen.getByRole('option', { name: 'Pessoa QA (eu@qa.local)' })).toHaveValue('qa-eu');
    expect(screen.getByRole('option', { name: 'Pessoa QA (homonimo@qa.local)' })).toHaveValue('qa-homonimo');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'qa-homonimo' } });
    await waitFor(() => expect(mudar).toHaveBeenCalledWith('qa-homonimo'));
    expect(screen.queryByRole('option', { name: /Antiga QA/ })).toBeNull();
  });
  it('mantém inativo atual visível sem oferecer outro inativo', () => {
    render(<SeletorResponsavel tarefa={{ ...semVinculo, assigneeUserId: 'qa-inativo' }} pessoas={[...pessoas, { id: 'qa-outro-inativo', name: 'Outro QA', email: 'outro@qa.local', isActive: false }]} disabled={false} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('qa-inativo');
    expect(screen.getByRole('option', { name: 'Antiga QA (inativo)' })).toBeDisabled();
    expect(screen.queryByRole('option', { name: /Outro QA/ })).toBeNull();
  });
  it('desvincula explicitamente por null, omissão não chama salvamento', async () => {
    const mudar = vi.fn().mockResolvedValue(undefined);
    render(<SeletorResponsavel tarefa={vinculo} pessoas={pessoas} disabled={false} onChange={mudar} />);
    expect(mudar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'qa-eu' } });
    expect(mudar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    await waitFor(() => expect(mudar).toHaveBeenCalledWith(null));
  });
  it('bloqueia seletor durante salvamento e para leitor', async () => {
    let resolver!: () => void;
    const mudar = vi.fn(() => new Promise<void>((resolve) => { resolver = resolve; }));
    const view = render(<SeletorResponsavel tarefa={semVinculo} pessoas={pessoas} disabled={false} onChange={mudar} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'qa-eu' } });
    expect(screen.getByRole('combobox')).toBeDisabled();
    await act(async () => resolver());
    view.rerender(<SeletorResponsavel tarefa={semVinculo} pessoas={pessoas} disabled onChange={mudar} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
  it('não promove o texto legado a vínculo e admite vínculo indisponível', () => {
    const view = render(<ResponsavelDaTarefa tarefa={semVinculo} />);
    expect(screen.getByText('Sem vínculo de pessoa')).toBeInTheDocument();
    view.rerender(<ResponsavelDaTarefa tarefa={{ ...semVinculo, assigneeUserId: 'qa-ausente' }} />);
    expect(screen.getByText('Vínculo de pessoa indisponível')).toBeInTheDocument();
  });
  it('salva vínculo com versão esperada, preservando texto antigo na interface', async () => {
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    fireEvent.change(await screen.findByLabelText('Responsável (pessoa)'), { target: { value: 'qa-homonimo' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, { assigneeUserId: 'qa-homonimo', expectedUpdatedAt: versao }, 'qa-token'));
    expect(patch.mock.calls[0][1]).not.toHaveProperty('assignee');
    expect(screen.getByText('Responsável antigo (texto)')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Texto antigo QA')).toBeInTheDocument();
  });
  it('consulta pessoa em todas as listas e ignora status da lista antiga', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=qa-lista&assigneeUserId=qa-eu&escopo=pessoal&statusId=status-antigo&visao=board');
    render(<TrabalhoPage />);
    await screen.findByText('1 tarefa');
    const queries = get.mock.calls.filter(([p]) => String(p).startsWith('/trabalho/tarefas?')).map(([p]) => new URL(`http://qa${p}`).searchParams);
    expect(queries.length).toBeGreaterThan(0);
    for (const p of queries) { expect(p.get('assigneeUserId')).toBe('qa-eu'); expect(p.has('listId')).toBe(false); expect(p.has('assignee')).toBe(false); expect(p.has('statusId')).toBe(false); }
    expect(screen.getByRole('columnheader', { name: 'Responsável' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entrega QA' }));
    expect(await screen.findByLabelText('Título da tarefa')).toHaveValue('Entrega QA');
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBe(ID);
  });
  /*
   * Rodada da interface (U2, 20/10/2026): o responsável e o "em todas as listas" (o antigo
   * botão "Minhas tarefas") moram no painel de "Filtros". A regra é a mesma: User.id.
   */
  const minhasTarefasPeloPainel = async () => {
    fireEvent.click(screen.getByTestId('trabalho-filtros-botao'));
    fireEvent.change(screen.getByTestId('trabalho-filtros-assigneeUserId'), { target: { value: 'qa-eu' } });
    fireEvent.click(await screen.findByTestId('trabalho-filtros-todasAsListas'));
  };
  it('o pessoal em todas as listas usa User.id e filtro sem vínculo não envia ID nem texto', async () => {
    render(<TrabalhoPage />); await screen.findByText('1 tarefa');
    await minhasTarefasPeloPainel();
    await waitFor(() => expect(get.mock.calls.some(([p]) => String(p).includes('assigneeUserId=qa-eu') && !String(p).includes('listId'))).toBe(true));
    expect(new URLSearchParams(window.location.search).get('escopo')).toBe('pessoal');
    expect(new URLSearchParams(window.location.search).get('visao')).toBe('lista');
    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'sem-vinculo' } });
    await waitFor(() => expect(get.mock.calls.some(([p]) => String(p).includes('semResponsavel=1'))).toBe(true));
    const query = new URL(`http://qa${get.mock.calls.filter(([p]) => String(p).includes('semResponsavel=1')).at(-1)![0]}`).searchParams;
    expect(query.has('assigneeUserId')).toBe(false); expect(query.has('assignee')).toBe(false);
  });
  it('leitor vê responsável e registro antigo, mas não edita', async () => {
    permissions = ['tarefas.ver']; render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    expect(await screen.findByLabelText('Responsável (pessoa)')).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
  });
  it('409 preserva campo personalizado com rótulo e valor legíveis', async () => {
    patch.mockRejectedValue(Object.assign(new Error('Conflito QA'), { status: 409 }));
    get.mockImplementation((path: string) => path === '/trabalho/estrutura' ? Promise.resolve({ ...estrutura, camposGlobais: [{ id: 'qa-campo', name: 'Contato QA', type: 'texto', order: 0, options: [] }] }) : servir(path));
    render(<TrabalhoPage />); fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    const input = await screen.findByLabelText('Contato QA'); fireEvent.change(input, { target: { value: 'Novo cliente QA' } }); fireEvent.blur(input);
    const alerta = await screen.findByRole('alert');
    expect(within(alerta).getByText('Contato QA: Novo cliente QA')).toBeInTheDocument();
    expect(alerta).not.toHaveTextContent('[object Object]');
    expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, { campos: { 'qa-campo': { value: 'Novo cliente QA' } }, expectedUpdatedAt: versao }, 'qa-token');
  });
  it('409 preserva rascunho, recarrega versão atual e não tenta salvar automaticamente', async () => {
    patch.mockRejectedValue(Object.assign(new Error('Conflito QA'), { status: 409 }));
    render(<TrabalhoPage />); fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    const input = await screen.findByLabelText('Título da tarefa');
    fireEvent.change(input, { target: { value: 'Meu rascunho QA' } }); fireEvent.blur(input);
    await screen.findByText('Esta tarefa mudou desde que você abriu. Sua alteração não foi gravada.');
    expect(screen.getByText('Meu rascunho QA')).toBeInTheDocument(); expect(patch).toHaveBeenCalledTimes(1);
    tarefa = { ...tarefa, title: 'Título de outro editor QA', updatedAt: '2026-10-07T19:01:00.000Z' };
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar tarefa' }));
    await waitFor(() => expect(screen.getByLabelText('Título da tarefa')).toHaveValue('Título de outro editor QA'));
    expect(screen.getByText('Meu rascunho QA')).toBeInTheDocument(); expect(patch).toHaveBeenCalledTimes(1);
  });
  it('troca filtro pessoal por texto legado sem combinar identidades na URL ou consulta', async () => {
    render(<TrabalhoPage />); await screen.findByText('1 tarefa');
    await minhasTarefasPeloPainel();
    await waitFor(() => expect(get.mock.calls.some(([p]) => String(p).includes('assigneeUserId=qa-eu'))).toBe(true));
    get.mockClear();
    fireEvent.change(screen.getByLabelText('Responsável (texto antigo)'), { target: { value: 'Texto antigo QA' } });
    await waitFor(() => expect(get.mock.calls.some(([p]) => String(p).includes('assignee=Texto'))).toBe(true));
    const url = new URLSearchParams(window.location.search);
    expect(url.get('assignee')).toBe('Texto antigo QA');
    expect(url.has('assigneeUserId')).toBe(false); expect(url.has('semResponsavel')).toBe(false); expect(url.has('escopo')).toBe(false);
    expect(screen.getByLabelText('Responsável')).toHaveValue('');
    // Sem pessoa escolhida, o "em todas as listas" sai do painel.
    expect(screen.queryByTestId('trabalho-filtros-todasAsListas')).toBeNull();
    for (const [path] of get.mock.calls.filter(([p]) => String(p).startsWith('/trabalho/tarefas?'))) {
      const query = new URL(`http://qa${path}`).searchParams;
      expect(query.get('assignee')).toBe('Texto antigo QA'); expect(query.has('assigneeUserId')).toBe(false); expect(query.has('semResponsavel')).toBe(false);
    }
  });
  it('abre card pessoal de outra lista com UUID e lista reais, preservando filtro pessoal', async () => {
    const outra = { ...lista, id: 'qa-outra-lista', name: 'Outra lista QA' };
    tarefa = { ...original, listId: outra.id, listName: outra.name };
    get.mockImplementation((path: string) => path === '/trabalho/estrutura' ? Promise.resolve({ ...estrutura, listasSoltas: [lista, outra] }) : servir(path));
    window.history.replaceState({}, '', '/trabalho?lista=qa-lista&assigneeUserId=qa-eu&escopo=pessoal');
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    expect(await screen.findByLabelText('Título da tarefa')).toHaveValue('Entrega QA');
    const query = new URLSearchParams(window.location.search);
    expect(query.get('lista')).toBe(outra.id); expect(query.get('tarefa')).toBe(ID);
    expect(query.get('assigneeUserId')).toBe('qa-eu'); expect(query.get('escopo')).toBe('pessoal');
    for (const [path] of get.mock.calls.filter(([p]) => String(p).startsWith('/trabalho/tarefas?'))) expect(new URL(`http://qa${path}`).searchParams.has('listId')).toBe(false);
  });
  it('409 da mudança rápida preserva etapa desejada e bloqueia escrita até recarga manual', async () => {
    patch.mockRejectedValue(Object.assign(new Error('Conflito QA'), { status: 409 }));
    render(<TrabalhoPage />); await screen.findByText('1 tarefa');
    fireEvent.change(screen.getByTitle('Mover etapa'), { target: { value: 'status-b' } });
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Entrega QA'); expect(within(alerta).getByText('Em andamento')).toBeInTheDocument();
    expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, { statusId: 'status-b', expectedUpdatedAt: versao }, 'qa-token');
    expect(screen.queryByTitle('Mover etapa')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Entrega QA' }));
    expect(await screen.findByLabelText('Título da tarefa')).toBeDisabled();
    expect(patch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar tarefa' }));
    tarefa = { ...tarefa, statusId: 'status-b', statusName: 'Em andamento', updatedAt: '2026-10-07T19:01:00.000Z' };
    fireEvent.click(within(alerta).getByRole('button', { name: 'Recarregar lista' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByTitle('Mover etapa')).toHaveValue('status-b'); expect(patch).toHaveBeenCalledTimes(1);
  });
  it('mudança rápida sem versão lida não envia PATCH desprotegido', async () => {
    get.mockImplementation((path: string) => path.startsWith('/trabalho/tarefas?') ? Promise.resolve({ items: [{ ...tarefa, updatedAt: undefined }], total: 1 }) : servir(path));
    render(<TrabalhoPage />); await screen.findByText('1 tarefa');
    fireEvent.change(screen.getByTitle('Mover etapa'), { target: { value: 'status-b' } });
    expect(await screen.findByText('Recarregue a lista antes de alterar esta tarefa: a versão não está disponível.')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });
  it('falha ao concluir descrição conserva editor e texto digitado', async () => {
    patch.mockRejectedValue(new Error('Falha de gravação QA'));
    render(<TrabalhoPage />); fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar texto' }));
    fireEvent.change(screen.getByLabelText('Descrição e material vigente'), { target: { value: 'Meu material novo QA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Concluir edição' }));
    await screen.findByText('Falha de gravação QA');
    expect(screen.getByLabelText('Descrição e material vigente')).toHaveValue('Meu material novo QA');
    expect(screen.getByRole('button', { name: 'Concluir edição' })).toBeInTheDocument();
  });
  it('409 ao anexar etiqueta mantém texto e impede outra tentativa antes da recarga', async () => {
    patch.mockRejectedValue(Object.assign(new Error('Conflito QA'), { status: 409 }));
    get.mockImplementation((path: string) => path === '/trabalho/estrutura' ? Promise.resolve({ ...estrutura, tags: [{ id: 'qa-tag', name: 'Etiqueta QA', color: '#000000' }] }) : servir(path));
    render(<TrabalhoPage />); fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    const input = await screen.findByPlaceholderText('+ etiqueta');
    fireEvent.change(input, { target: { value: 'Etiqueta QA' } }); fireEvent.keyDown(input, { key: 'Enter' });
    const alerta = await screen.findByRole('alert');
    expect(within(alerta).getByText('Etiqueta QA')).toBeInTheDocument();
    expect(input).toHaveValue('Etiqueta QA'); expect(input).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' }); expect(patch).toHaveBeenCalledTimes(1);
  });
});
