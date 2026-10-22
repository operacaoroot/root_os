import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACOES_DO_MENU_DA_TAREFA, ROTULO_DA_ACAO_DA_TAREFA, SEM_PERMISSAO_DE_EDITAR, SO_GENTE_NO_MENU, TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA, razaoParaNaoFazer } from '@mktos/shared';

/*
 * O MENU DA TAREFA E O MODO CENTRALIZADO (rodada de produção 3, I4, 22/10/2026).
 *
 *  · botão direito no cartão, Shift+F10 e o "⋯" abrem o MESMO menu, por portal,
 *    com as 8 ações; o que a pessoa não pode fazer aparece desabilitado com a razão;
 *  · cada ação chama a rota certa com a versão lida (renomear, mover, mesclar,
 *    duplicar, arquivar, excluir) ou copia (ID e link);
 *  · o menu cabe na janela em 390, 768 e 1440 px;
 *  · "Abrir no centro" leva o pop-up para o meio em duas colunas (comentários à
 *    direita), "Voltar para o lado" devolve; a preferência fica no navegador, o
 *    endereço não muda, Esc fecha; com trilho, "Ver trilho do onboarding".
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn(), del = vi.fn();
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: (...a: unknown[]) => del(...a), apiBlob: vi.fn(),
}));
let permissoes = ['tarefas.ver', 'tarefas.editar'];
let papeis: string[] = ['analista'];
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu', roles: papeis }, can: (p: string) => permissoes.includes(p) }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }) }));
import TrabalhoPage from '@/app/trabalho/page';
import { posicaoDentroDaJanela } from '@/components/trabalho/MenuDaTarefa';
import { CHAVE_DO_MODO_DA_TAREFA } from '@/components/trabalho/TrabalhoView';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const LISTA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUTRA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const V1 = '2026-10-22T10:00:00.000Z';
const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#87909e', order, total: 0, limite: null });
const lista = (id: string, name: string) => ({ id, name, externalId: null, spaceId: null, order: 0, total: 1, fields: [], natureza: 'tarefas' as const, statuses: [st(`${id.slice(0, 8)}-a`, 'A fazer', 'open', 0), st(`${id.slice(0, 8)}-f`, 'Feito', 'closed', 1)] });
const estrutura = { espacos: [], folders: [], listasSoltas: [lista(LISTA, 'Operação'), lista(OUTRA, 'Marketing')], camposGlobais: [], tags: [], responsaveis: [], agentes: [], pessoas: [] };
function tarefa(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id, title, listId: LISTA, listName: 'Operação', statusId: `${LISTA.slice(0, 8)}-a`, statusName: 'A fazer', statusType: 'open', statusColor: '#000', priority: 'normal',
    assignee: null, assigneeUserId: null, assigneeUserName: null, assigneeUserEmail: null, assigneeUserIsActive: null,
    description: null, dueDate: null, startDate: null, overdue: false, archived: false, excluidaEm: null,
    agenteId: null, agenteNome: null, agenteSlug: null, agenteEm: null, statusDesde: null, minutos: 0,
    parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: 0, tags: [], values: [], clienteId: null, clienteNome: null,
    comentarios: [{ id: 'c1', authorId: 'eu', authorName: 'Eu', text: 'Comentário da tarefa', createdAt: V1 }],
    atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [], createdAt: V1, updatedAt: V1, ...extra,
  };
}
let a = tarefa(A, 'Pagar boleto');
let trilhos: unknown[] = [];

beforeEach(() => {
  permissoes = ['tarefas.ver', 'tarefas.editar'];
  papeis = ['analista'];
  a = tarefa(A, 'Pagar boleto');
  trilhos = [];
  window.localStorage.clear();
  window.history.replaceState({}, '', `/trabalho?lista=${LISTA}`);
  get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota === '/trabalho/estrutura') return Promise.resolve(estrutura);
    if (rota.startsWith('/trabalho/tarefas?q=')) return Promise.resolve({ items: [a, tarefa(B, 'Pagar fornecedor')], total: 2 });
    if (rota.startsWith('/trabalho/tarefas?')) return Promise.resolve({ items: [a], total: 1 });
    if (rota === `/trabalho/tarefas/${A}`) return Promise.resolve({ ...a });
    if (rota.startsWith('/tenants/onboarding/trilhos?')) return Promise.resolve(trilhos);
    if (rota.includes('/atividade')) return Promise.resolve({ items: [], limit: 50, hasMore: false, nextCursor: null, anchor: null });
    return Promise.resolve(null);
  });
  post.mockResolvedValue({ id: 'nova', listId: LISTA, title: 'cópia de Pagar boleto', comentarios: 0, anexos: 0, subtarefas: 0 });
  patch.mockResolvedValue({});
  del.mockResolvedValue({});
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(cleanup);

const cartao = async () => (await screen.findByRole('button', { name: 'Pagar boleto' })).closest('[data-work-task-id]') as HTMLElement;
async function abrirPeloBotaoDireito() {
  fireEvent.contextMenu(await cartao(), { clientX: 120, clientY: 140 });
  const menu = await screen.findByTestId('menu-da-tarefa');
  // O estado da tarefa chega e as ações que precisam da versão destravam.
  await waitFor(() => expect(within(menu).getByTestId('menu-da-tarefa-renomear')).not.toHaveAttribute('aria-disabled'));
  return menu;
}

describe('I4: o menu da tarefa', () => {
  it('as razões de não fazer, sem tela', () => {
    const base = { podeEditar: true, ehGente: true, arquivada: false, excluida: false, cardDaImplantacao: false, comAgente: false };
    expect(razaoParaNaoFazer('copiar-id', { ...base, podeEditar: false })).toBeNull();
    expect(razaoParaNaoFazer('renomear', { ...base, podeEditar: false })).toBe(SEM_PERMISSAO_DE_EDITAR);
    expect(razaoParaNaoFazer('excluir', { ...base, ehGente: false })).toBe(SO_GENTE_NO_MENU);
    expect(razaoParaNaoFazer('mesclar', { ...base, cardDaImplantacao: true })).toBe(TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA);
    expect(razaoParaNaoFazer('arquivar', { ...base, arquivada: true })).toBe('A tarefa já está arquivada.');
  });

  it('botão direito no cartão abre o menu por portal com as 8 ações', async () => {
    render(<TrabalhoPage />);
    const menu = await abrirPeloBotaoDireito();
    expect(menu.parentElement).toBe(document.body);
    expect(within(menu).getAllByRole('menuitem').map((m) => m.firstChild?.textContent)).toEqual(ACOES_DO_MENU_DA_TAREFA.map((x) => ROTULO_DA_ACAO_DA_TAREFA[x]));
    // O foco entra no primeiro item; Esc fecha.
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getByTestId('menu-da-tarefa-renomear')));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('menu-da-tarefa')).toBeNull());
  });

  it('Shift+F10 e o "⋯" abrem o mesmo menu (teclado e toque)', async () => {
    render(<TrabalhoPage />);
    const titulo = await screen.findByRole('button', { name: 'Pagar boleto' });
    fireEvent.keyDown(titulo, { key: 'F10', shiftKey: true });
    expect(await screen.findByTestId('menu-da-tarefa')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByTestId('menu-da-tarefa')).toBeNull());
    fireEvent.click(screen.getByTestId(`menu-da-tarefa-botao-${A}`));
    expect(await screen.findByTestId('menu-da-tarefa')).toBeInTheDocument();
  });

  it('sem permissão de editar ou com conta de máquina: desabilitado com a razão; copiar segue', async () => {
    permissoes = ['tarefas.ver'];
    render(<TrabalhoPage />);
    let menu = await (async () => { fireEvent.contextMenu(await cartao(), { clientX: 10, clientY: 10 }); return screen.findByTestId('menu-da-tarefa'); })();
    expect(within(menu).getByTestId('menu-da-tarefa-excluir')).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByTestId('menu-da-tarefa-excluir-razao')).toHaveTextContent(SEM_PERMISSAO_DE_EDITAR);
    expect(within(menu).getByTestId('menu-da-tarefa-copiar-id')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(within(menu).getByTestId('menu-da-tarefa-excluir'));
    expect(post).not.toHaveBeenCalled();
    cleanup();
    permissoes = ['tarefas.ver', 'tarefas.editar']; papeis = ['ia_acao'];
    render(<TrabalhoPage />);
    menu = await (async () => { fireEvent.contextMenu(await cartao(), { clientX: 10, clientY: 10 }); return screen.findByTestId('menu-da-tarefa'); })();
    expect(within(menu).getByTestId('menu-da-tarefa-duplicar-razao')).toHaveTextContent(SO_GENTE_NO_MENU);
  });

  it('o card da implantação: mesclar e duplicar desabilitados com a razão', async () => {
    trilhos = [{ id: 't1', cardId: A }];
    render(<TrabalhoPage />);
    const menu = await abrirPeloBotaoDireito();
    await waitFor(() => expect(within(menu).getByTestId('menu-da-tarefa-mesclar-razao')).toHaveTextContent(TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA));
    expect(within(menu).getByTestId('menu-da-tarefa-duplicar')).toHaveAttribute('aria-disabled', 'true');
  });

  it('copiar ID e compartilhar copiam; duplicar, arquivar e excluir chamam a API com a versão', async () => {
    render(<TrabalhoPage />);
    let menu = await abrirPeloBotaoDireito();
    fireEvent.click(within(menu).getByTestId('menu-da-tarefa-copiar-id'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(A));
    await waitFor(() => expect(screen.queryByTestId('menu-da-tarefa')).toBeNull());

    menu = await abrirPeloBotaoDireito();
    fireEvent.click(within(menu).getByTestId('menu-da-tarefa-compartilhar'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(`${window.location.origin}/trabalho?lista=${LISTA}&tarefa=${A}`));
    await waitFor(() => expect(screen.queryByTestId('menu-da-tarefa')).toBeNull());

    menu = await abrirPeloBotaoDireito();
    fireEvent.click(within(menu).getByTestId('menu-da-tarefa-duplicar'));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/trabalho/tarefas/${A}/duplicar`, {}, 'tok'));
    await waitFor(() => expect(screen.queryByTestId('menu-da-tarefa')).toBeNull());

    menu = await abrirPeloBotaoDireito();
    fireEvent.click(within(menu).getByTestId('menu-da-tarefa-arquivar'));
    await waitFor(() => expect(del).toHaveBeenCalledWith(`/trabalho/tarefas/${A}`, 'tok', { expectedUpdatedAt: V1 }));
    await waitFor(() => expect(screen.queryByTestId('menu-da-tarefa')).toBeNull());

    menu = await abrirPeloBotaoDireito();
    fireEvent.click(within(menu).getByTestId('menu-da-tarefa-excluir'));
    expect(await screen.findByTestId('menu-da-tarefa-confirmar-excluir')).toHaveTextContent('Lixeira');
    fireEvent.click(screen.getByTestId('menu-da-tarefa-excluir-confirmar'));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/trabalho/tarefas/${A}/excluir`, { expectedUpdatedAt: V1 }, 'tok'));
  });

  it('renomear inline, mover (lista e etapa) e mesclar (busca, confirma)', async () => {
    render(<TrabalhoPage />);
    let menu = await abrirPeloBotaoDireito();
    fireEvent.click(within(menu).getByTestId('menu-da-tarefa-renomear'));
    const campo = await screen.findByLabelText('Novo nome');
    fireEvent.change(campo, { target: { value: 'Pagar boleto de outubro' } });
    fireEvent.submit(screen.getByTestId('menu-da-tarefa-renomear-form'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${A}`, { title: 'Pagar boleto de outubro', expectedUpdatedAt: V1 }, 'tok'));
    await waitFor(() => expect(screen.queryByTestId('menu-da-tarefa')).toBeNull());

    menu = await abrirPeloBotaoDireito();
    fireEvent.click(within(menu).getByTestId('menu-da-tarefa-mover'));
    fireEvent.change(await screen.findByLabelText('Buscar lista'), { target: { value: 'mark' } });
    fireEvent.click(await screen.findByTestId(`menu-da-tarefa-mover-lista-${OUTRA}`));
    fireEvent.click(await screen.findByTestId(`menu-da-tarefa-mover-etapa-${OUTRA.slice(0, 8)}-f`));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/trabalho/tarefas/${A}/mover`, { listId: OUTRA, statusId: `${OUTRA.slice(0, 8)}-f`, expectedUpdatedAt: V1 }, 'tok'));
    await waitFor(() => expect(screen.queryByTestId('menu-da-tarefa')).toBeNull());

    menu = await abrirPeloBotaoDireito();
    fireEvent.click(within(menu).getByTestId('menu-da-tarefa-mesclar'));
    fireEvent.change(await screen.findByLabelText('Buscar a tarefa que recebe'), { target: { value: 'Pagar' } });
    // A própria tarefa não aparece como destino.
    fireEvent.click(await screen.findByTestId(`menu-da-tarefa-mesclar-com-${B}`));
    expect(screen.queryByTestId(`menu-da-tarefa-mesclar-com-${A}`)).toBeNull();
    fireEvent.click(await screen.findByTestId('menu-da-tarefa-mesclar-confirmar'));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/trabalho/tarefas/${A}/mesclar`, { destinoId: B, expectedUpdatedAt: V1 }, 'tok'));
  });

  it.each([[390, 844], [768, 1024], [1440, 900]])('o menu cabe na janela de %i px', (largura, altura) => {
    const tamanho = { largura: 300, altura: 380 };
    for (const ponto of [{ x: 0, y: 0 }, { x: largura - 5, y: altura - 5 }, { x: largura / 2, y: altura - 40 }, { x: largura - 100, y: 20 }]) {
      const p = posicaoDentroDaJanela(ponto, tamanho, { largura, altura });
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.left + Math.min(tamanho.largura, largura - 16)).toBeLessThanOrEqual(largura);
      expect(p.top + tamanho.altura).toBeLessThanOrEqual(altura - 8 + 0.0001);
    }
  });
});

describe('I4: o modo centralizado', () => {
  const abrir = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Pagar boleto' }));
    return screen.findByTestId('tarefa-popup');
  };

  it('abre no centro em duas colunas, volta para o lado, guarda a preferência e não muda o endereço', async () => {
    render(<TrabalhoPage />);
    let popup = await abrir();
    expect(popup).toHaveAttribute('data-modo', 'lado');
    const endereco = window.location.search;
    fireEvent.click(screen.getByTestId('tarefa-modo-centro'));
    popup = screen.getByTestId('tarefa-popup');
    expect(popup).toHaveAttribute('data-modo', 'centro');
    expect(popup.className).toContain('md:-translate-x-1/2');
    // No celular: tela cheia, as duas colunas empilhadas (flex-col sem o md:flex-row).
    expect(popup.className).toContain('inset-0');
    expect(screen.getByTestId('tarefa-duas-colunas').className).toContain('flex-col');
    expect(within(screen.getByTestId('tarefa-coluna-direita')).getByText('Comentário da tarefa')).toBeInTheDocument();
    expect(within(screen.getByTestId('tarefa-coluna-esquerda')).queryByText('Comentário da tarefa')).toBeNull();
    expect(within(screen.getByTestId('tarefa-coluna-esquerda')).getByLabelText(/Descrição|Lista/i, { selector: 'select' })).toBeTruthy();
    expect(window.localStorage.getItem(CHAVE_DO_MODO_DA_TAREFA)).toBe('centro');
    expect(window.location.search).toBe(endereco);

    fireEvent.click(screen.getByTestId('tarefa-modo-lado'));
    expect(screen.getByTestId('tarefa-popup')).toHaveAttribute('data-modo', 'lado');
    expect(screen.queryByTestId('tarefa-coluna-direita')).toBeNull();
    expect(window.localStorage.getItem(CHAVE_DO_MODO_DA_TAREFA)).toBe('lado');
  });

  it('a preferência vale na próxima abertura; Esc fecha; com trilho, "Ver trilho do onboarding"', async () => {
    window.localStorage.setItem(CHAVE_DO_MODO_DA_TAREFA, 'centro');
    trilhos = [{ id: 'trilho-1', cliente: 'X', faseRotulo: 'Contrato', cardId: A, faltando: [] }];
    render(<TrabalhoPage />);
    const popup = await abrir();
    expect(popup).toHaveAttribute('data-modo', 'centro');
    expect(await screen.findByTestId('tarefa-ver-trilho')).toHaveAttribute('href', '/onboarding/trilho-1');
    fireEvent.keyDown(popup, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('tarefa-popup')).toBeNull());
  });
});
