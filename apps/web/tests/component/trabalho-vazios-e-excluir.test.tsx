import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * RODADA DE PRODUÇÃO 1 (21/10/2026), P3 e P4 na tela do Trabalho.
 *
 *  P4 · "Ocultar status vazios": o botão do cabeçalho alterna e conta; o mesmo
 *       booleano no painel de Filtros (`?vazios=ocultar`) entra na vista salva;
 *       vale em Todas, numa lista e na Implantação; combina com "Ocultar
 *       concluídas"; durante um arraste as vazias voltam como destino.
 *  P3 · o menu da lista e da pasta na árvore: "Excluir lista" só vazia (ou toda
 *       arquivada), com o nome escrito; senão "Arquivar todas" antes; "Excluir
 *       pasta" só sem lista; a lista da implantação não tem menu.
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn(), del = vi.fn();
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: (...a: unknown[]) => del(...a), apiBlob: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: EU, name: 'Rodrigo QA' }, can: (p: string) => ['tarefas.ver', 'tarefas.editar'].includes(p) }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }) }));
import TrabalhoPage from '@/app/trabalho/page';
import { TrabalhoView, textoDosVaziosOcultos } from '@/components/trabalho/TrabalhoView';

const EU = '0e0e0e0e-0000-4000-8000-000000000001';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const T4 = '44444444-4444-4444-8444-444444444444';
const V1 = '2026-10-18T10:00:00.000Z';
const ADM = 'a0a0a0a0-0000-4000-8000-00000000000a';
const GESTAO = 'b0b0b0b0-0000-4000-8000-00000000000b';
const CLIENTES = 'c0c0c0c0-0000-4000-8000-00000000000c';
const VAZIA = 'd0d0d0d0-0000-4000-8000-00000000000d';

const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#87909e', order, total: 0, limite: null });
const lista = (id: string, name: string, total = 1) => ({ id, name, externalId: null, spaceId: null, order: 0, total, fields: [], statuses: [st(`${id}-aberta`, 'A fazer', 'open', 0), st(`${id}-andamento`, 'Fazendo', 'custom', 1), st(`${id}-feita`, 'Feito', 'closed', 2)] });
const rotina = lista('l-rotina', 'Rotina');
const marketing = lista('l-mkt', 'Tarefas');
const execucao = lista('l-exec', 'Execução', 0);
const onboarding = { ...lista('l-onb', 'Onboarding de cliente'), statuses: [st('onb-kick', 'Kickoff marcado', 'open', 0), st('onb-imersao', 'Imersão', 'custom', 1), st('onb-op', 'Operação assistida', 'custom', 2)] };
const marketingSolta = lista('l-mkt-solta', 'Marketing', 0);
const estrutura = {
  espacos: [],
  folders: [
    { id: ADM, name: 'Administrativo', order: 0, spaceId: null, parentId: null, externalId: null, lists: [rotina] },
    { id: GESTAO, name: 'Gestão', order: 1, spaceId: null, parentId: null, externalId: null, lists: [] },
    { id: 'f-mkt', name: 'Marketing interno', order: 0, spaceId: null, parentId: GESTAO, externalId: null, lists: [marketing] },
    { id: CLIENTES, name: 'Clientes', order: 2, spaceId: null, parentId: null, externalId: null, lists: [execucao, onboarding] },
    { id: VAZIA, name: 'Administrativa', order: 3, spaceId: null, parentId: null, externalId: null, lists: [] },
  ],
  listasSoltas: [marketingSolta], camposGlobais: [], tags: [], responsaveis: [], agentes: [],
  pessoas: [{ id: EU, name: 'Rodrigo QA', email: 'eu@qa.local', isActive: true }],
};
type Lista = { id: string; name: string; statuses: { id: string; name: string; type: string }[] };
function tarefa(id: string, title: string, l: Lista, status = l.statuses[0]) {
  return {
    id, title, listId: l.id, listName: l.name, statusId: status.id, statusName: status.name, statusType: status.type, statusColor: '#87909e',
    priority: 'normal', assignee: null, assigneeUserId: null, assigneeUserName: null, assigneeUserEmail: null, assigneeUserIsActive: null,
    dueDate: null, startDate: null, overdue: false, archived: false, agenteId: null, agenteNome: null, agenteSlug: null, agenteEm: null,
    statusDesde: null, minutos: 0, parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: 0, tags: [], values: [],
    clienteId: null, clienteNome: null, outrosResponsaveisIds: [] as string[], recorrencia: null, updatedAt: V1,
  };
}
let tarefas: ReturnType<typeof tarefa>[] = [];
let vistas: unknown[] = [];

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/trabalho');
  get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset();
  vistas = [];
  tarefas = [
    tarefa(T1, 'Pagar o aluguel', rotina),
    tarefa(T2, 'Gravar o episódio', marketing),
    tarefa(T3, 'Fazer o kickoff', onboarding),
  ];
  get.mockImplementation((rota: string) => {
    if (rota === '/trabalho/estrutura') return Promise.resolve(estrutura);
    if (rota.startsWith('/trabalho/clientes')) return Promise.resolve([]);
    if (rota.startsWith('/trabalho/vistas')) return Promise.resolve(vistas);
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
  post.mockImplementation((_r: string, corpo: Record<string, unknown>) => Promise.resolve({ id: 'v-1', atualizadaEm: V1, padrao: true, ...corpo }));
  patch.mockResolvedValue({});
  del.mockResolvedValue({ id: 'x', modo: 'apagada', tarefasArquivadas: 0 });
});
afterEach(cleanup);

const query = () => new URLSearchParams(window.location.search);
const colunas = () => [...document.querySelectorAll('[data-coluna]')].map((c) => c.getAttribute('data-coluna'));
const coluna = (id: string) => document.querySelector(`[data-coluna="${id}"]`) as HTMLElement;
const cartao = (id: string) => document.querySelector(`[data-work-task-id="${id}"]`) as HTMLElement;
function dataTransfer() {
  const dados: Record<string, string> = {};
  return { setData: (k: string, v: string) => { dados[k] = v; }, getData: (k: string) => dados[k] ?? '', effectAllowed: 'all', dropEffect: 'move' };
}
const TODAS_AS_COLUNAS = ['nome:a fazer', 'nome:kickoff marcado', 'nome:fazendo', 'nome:imersao', 'nome:operacao assistida', 'nome:feito'];

describe('P4: ocultar status vazios', () => {
  it('o texto da contagem', () => {
    expect(textoDosVaziosOcultos(0)).toBe('nenhum vazio');
    expect(textoDosVaziosOcultos(1)).toBe('1 vazio oculto');
    expect(textoDosVaziosOcultos(12)).toBe('12 vazios ocultos');
  });

  it('em Todas, o botão do cabeçalho alterna, conta os ocultos e escreve no endereço', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas');
    render(<TrabalhoPage />);
    await waitFor(() => expect(colunas()).toEqual(TODAS_AS_COLUNAS));
    const botao = screen.getByTestId('trabalho-vazios');
    expect(botao).toHaveTextContent('Ocultar status vazios');
    expect(botao).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('trabalho-vazios-contagem')).toBeNull();

    fireEvent.click(botao);
    expect(query().get('vazios')).toBe('ocultar');
    expect(botao).toHaveAttribute('aria-pressed', 'true');
    expect(colunas()).toEqual(['nome:a fazer', 'nome:kickoff marcado']);
    expect(screen.getByTestId('trabalho-vazios-contagem')).toHaveTextContent('4 vazios ocultos');
    // Os atalhos de etapa seguem as colunas que aparecem.
    expect(within(screen.getByTestId('trabalho-chips-de-etapa')).getAllByRole('button')).toHaveLength(2);

    fireEvent.click(botao);
    expect(query().has('vazios')).toBe(false);
    expect(colunas()).toEqual(TODAS_AS_COLUNAS);
  });

  it('o painel de Filtros tem o mesmo booleano, e o link com ?vazios=ocultar chega ligado', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&vazios=ocultar');
    render(<TrabalhoPage />);
    await waitFor(() => expect(colunas()).toEqual(['nome:a fazer', 'nome:kickoff marcado']));
    expect(screen.getByTestId('trabalho-vazios')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('trabalho-filtros-botao'));
    const caixa = screen.getByTestId('trabalho-filtros-vazios');
    expect(caixa).toBeChecked();
    fireEvent.click(caixa);
    expect(query().has('vazios')).toBe(false);
    expect(colunas()).toEqual(TODAS_AS_COLUNAS);
    expect(screen.getByTestId('trabalho-vazios')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('trabalho-filtros-vazios'));
    expect(query().get('vazios')).toBe('ocultar');
    // "Limpar tudo" tira junto.
    fireEvent.click(screen.getByTestId('trabalho-filtros-limpar-tudo'));
    expect(query().has('vazios')).toBe(false);
  });

  it('combina com "Ocultar concluídas": a concluída sai pela regra dela e não entra na conta dos vazios', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&concluidas=ocultar&vazios=ocultar');
    render(<TrabalhoPage />);
    await waitFor(() => expect(colunas()).toEqual(['nome:a fazer', 'nome:kickoff marcado']));
    expect(screen.getByTestId('trabalho-vazios-contagem')).toHaveTextContent('3 vazios ocultos');
  });

  it('a coluna concluída com tarefa aberta continua (a exceção do Todas) e não é vazia', async () => {
    tarefas.push(tarefa(T4, 'Revisar a entrega', rotina, rotina.statuses[2]));
    window.history.replaceState({}, '', '/trabalho?pasta=todas&vazios=ocultar');
    render(<TrabalhoPage />);
    await waitFor(() => expect(colunas()).toEqual(['nome:a fazer', 'nome:kickoff marcado', 'nome:feito']));
    expect(screen.getByTestId('trabalho-vazios-contagem')).toHaveTextContent('3 vazios ocultos');
  });

  it('durante o arraste as vazias voltam como destino, e soltar numa delas grava', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&vazios=ocultar');
    render(<TrabalhoPage />);
    await waitFor(() => expect(colunas()).toEqual(['nome:a fazer', 'nome:kickoff marcado']));
    const dt = dataTransfer();
    fireEvent.dragStart(cartao(T1), { dataTransfer: dt });
    await waitFor(() => expect(colunas()).toEqual(TODAS_AS_COLUNAS));
    expect(screen.getByTestId('trabalho-quadro-caixa')).toHaveAttribute('data-arrastando', '1');
    fireEvent.dragOver(coluna('nome:fazendo'), { dataTransfer: dt });
    fireEvent.drop(coluna('nome:fazendo'), { dataTransfer: dt });
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${T1}`, { statusId: 'l-rotina-andamento', expectedUpdatedAt: V1 }, 'tok'));
    // Acabou o arraste: as vazias somem de novo.
    await waitFor(() => expect(colunas()).toEqual(['nome:a fazer', 'nome:kickoff marcado']));
  });

  it('o arraste cancelado (dragend sem drop) também esconde de novo', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&vazios=ocultar');
    render(<TrabalhoPage />);
    await waitFor(() => expect(cartao(T1)).toBeTruthy());
    fireEvent.dragStart(cartao(T1), { dataTransfer: dataTransfer() });
    await waitFor(() => expect(colunas()).toHaveLength(6));
    fireEvent.dragEnd(cartao(T1));
    await waitFor(() => expect(colunas()).toHaveLength(2));
    expect(patch).not.toHaveBeenCalled();
  });

  it('a vista salva grava a chave, e a vista padrão com ela chega aplicada', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&vazios=ocultar');
    vi.spyOn(window, 'prompt').mockReturnValue('Sem vazios');
    render(<TrabalhoPage />);
    await waitFor(() => expect(colunas()).toHaveLength(2));
    fireEvent.click(screen.getByTestId('trabalho-vista-salvar'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, corpo] = post.mock.calls[0] as [string, { config: Record<string, unknown> }];
    expect(corpo.config.vazios).toBe('ocultar');
    cleanup();

    // Reaplicar: sem filtro no endereço, a vista padrão vale ao abrir.
    vistas = [{ id: 'v-1', nome: 'Sem vazios', padrao: true, tela: 'quadro', atualizadaEm: V1, config: { ...corpo.config } }];
    window.history.replaceState({}, '', '/trabalho?pasta=todas');
    render(<TrabalhoPage />);
    await waitFor(() => expect(query().get('vazios')).toBe('ocultar'));
    await waitFor(() => expect(colunas()).toEqual(['nome:a fazer', 'nome:kickoff marcado']));
    expect(screen.getByTestId('trabalho-vazios')).toHaveAttribute('aria-pressed', 'true');
  });

  it('vale no quadro de uma lista', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-rotina');
    render(<TrabalhoPage />);
    await waitFor(() => expect(colunas()).toEqual(['l-rotina-aberta', 'l-rotina-andamento', 'l-rotina-feita']));
    fireEvent.click(screen.getByTestId('trabalho-vazios'));
    expect(colunas()).toEqual(['l-rotina-aberta']);
    expect(screen.getByTestId('trabalho-vazios-contagem')).toHaveTextContent('2 vazios ocultos');
  });

  it('vale na Implantação', async () => {
    render(<TrabalhoView modo="implantacao" />);
    await waitFor(() => expect(colunas()).toEqual(['onb-kick', 'onb-imersao', 'onb-op']));
    fireEvent.click(screen.getByTestId('trabalho-vazios'));
    expect(colunas()).toEqual(['onb-kick']);
    expect(query().get('vazios')).toBe('ocultar');
    fireEvent.click(screen.getByTestId('implantacao-filtros-botao'));
    expect(screen.getByTestId('implantacao-filtros-vazios')).toBeChecked();
  });

  it('não aparece na Lista nem no Calendário', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&visao=lista');
    render(<TrabalhoPage />);
    await screen.findByText('Pagar o aluguel');
    expect(screen.queryByTestId('trabalho-vazios')).toBeNull();
  });
});

describe('P3: excluir lista e pasta pela árvore', () => {
  const menu = (id: string) => screen.getByTestId(id);

  it('lista com tarefa: "Arquivar" condicionado ao número visto; "Excluir lista" oferece o destino das tarefas (A3)', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-rotina');
    post.mockResolvedValueOnce({ id: 'l-rotina', arquivadas: 1 });
    render(<TrabalhoPage />);
    await screen.findByText('Pagar o aluguel');
    fireEvent.click(menu('trabalho-lista-acoes-l-rotina'));
    // Desde o A3 o item fica habilitado: o diálogo pergunta o que fazer com a tarefa.
    expect(screen.getByTestId('trabalho-lista-acoes-l-rotina-excluir')).toBeEnabled();
    expect(screen.getByTestId('trabalho-lista-acoes-l-rotina-excluir')).toHaveTextContent('Antes, a tarefa vai para outra lista ou é arquivada.');
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-rotina-arquivar'));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent('Nada é apagado');
    fireEvent.click(within(dialogo).getByTestId('trabalho-arquivar-tarefas-confirmar'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/listas/l-rotina/arquivar-tarefas', { esperadas: 1 }, 'tok'));
    expect(del).not.toHaveBeenCalled();
  });

  it('lista vazia: excluir pede o nome escrito, sem diferença de maiúscula, e fecha a lista aberta', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-mkt-solta');
    render(<TrabalhoPage />);
    await screen.findByRole('heading', { name: 'Marketing' });
    fireEvent.click(menu('trabalho-lista-acoes-l-mkt-solta'));
    expect(screen.queryByTestId('trabalho-lista-acoes-l-mkt-solta-arquivar')).toBeNull();
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-mkt-solta-excluir'));
    const dialogo = await screen.findByRole('dialog');
    const confirmar = within(dialogo).getByTestId('trabalho-excluir-lista-confirmar');
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(dialogo).getByTestId('trabalho-excluir-lista-nome'), { target: { value: 'Marketin' } });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(dialogo).getByTestId('trabalho-excluir-lista-nome'), { target: { value: '  marketing ' } });
    expect(confirmar).toBeEnabled();
    await act(async () => { fireEvent.click(confirmar); });
    expect(del).toHaveBeenCalledWith('/trabalho/listas/l-mkt-solta', 'tok', { confirmarNome: '  marketing ' });
    await waitFor(() => expect(query().get('lista')).not.toBe('l-mkt-solta'));
  });

  it('a recusa da API aparece no diálogo e nada fecha', async () => {
    del.mockRejectedValueOnce(Object.assign(new Error('A lista tem 2 tarefas sem arquivar. Arquive todas antes de excluir.'), { status: 400 }));
    window.history.replaceState({}, '', '/trabalho?lista=l-exec');
    render(<TrabalhoPage />);
    await screen.findByRole('heading', { name: 'Execução' });
    fireEvent.click(menu('trabalho-lista-acoes-l-exec'));
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-exec-excluir'));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.change(within(dialogo).getByTestId('trabalho-excluir-lista-nome'), { target: { value: 'Execução' } });
    fireEvent.click(within(dialogo).getByTestId('trabalho-excluir-lista-confirmar'));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Arquive todas antes de excluir.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a lista da implantação tem o menu com Renomear e Excluir desabilitados e o porquê (A3)', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-rotina');
    render(<TrabalhoPage />);
    await screen.findByText('Pagar o aluguel');
    fireEvent.click(menu('trabalho-lista-acoes-l-onb'));
    expect(screen.getByTestId('trabalho-lista-acoes-l-onb-renomear')).toBeDisabled();
    expect(screen.getByTestId('trabalho-lista-acoes-l-onb-excluir')).toBeDisabled();
    expect(screen.getByTestId('trabalho-lista-acoes-l-onb-excluir')).toHaveTextContent('porta da implantação de clientes');
    expect(screen.queryByTestId('trabalho-lista-acoes-l-onb-arquivar')).toBeNull();
    expect(screen.getByTestId('trabalho-lista-acoes-l-exec')).toBeInTheDocument();
  });

  it('pasta: a vazia sai com confirmação simples; com conteúdo o item pede o destino; Clientes é protegida (A3)', async () => {
    del.mockResolvedValueOnce({ id: VAZIA, modo: 'apagada' });
    window.history.replaceState({}, '', '/trabalho?lista=l-rotina');
    render(<TrabalhoPage />);
    await screen.findByText('Pagar o aluguel');
    // Gestão tem uma pasta dentro; Administrativo tem lista: o diálogo pedirá o destino.
    fireEvent.click(menu(`trabalho-pasta-acoes-${GESTAO}`));
    expect(screen.getByTestId(`trabalho-pasta-acoes-${GESTAO}-excluir`)).toHaveTextContent('Antes, 1 pasta vai para outra pasta ou Sem pasta.');
    fireEvent.click(menu(`trabalho-pasta-acoes-${ADM}`));
    expect(screen.getByTestId(`trabalho-pasta-acoes-${ADM}-excluir`)).toBeEnabled();
    fireEvent.click(menu(`trabalho-pasta-acoes-${CLIENTES}`));
    expect(screen.getByTestId(`trabalho-pasta-acoes-${CLIENTES}-excluir`)).toBeDisabled();
    fireEvent.click(menu(`trabalho-pasta-acoes-${VAZIA}`));
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${VAZIA}-excluir`));
    const dialogo = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(dialogo).getByTestId('trabalho-excluir-pasta-confirmar')); });
    expect(del).toHaveBeenCalledWith(`/trabalho/pastas/${VAZIA}`, 'tok');
  });
});
