import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * RODADA DA INTERFACE (U2 e U3, 20/10/2026).
 *
 *  1. U2 · os filtros do Trabalho moram num botão só, "Filtros (n)", ao lado das vistas
 *     salvas. O painel tem responsável e prazo (e o resto), escreve as chaves de sempre
 *     no endereço, conta os ativos, e "Limpar tudo" não mexe em lista, visão nem pasta;
 *  2. U2 · a Implantação tem o mesmo par, com as vistas dela (`tela=implantacao`) e os
 *     filtros responsável, cliente, etapa, atrasadas e busca;
 *  3. U3 · "Todas" tem os segmentos por pasta de topo (`?segmento=`, `segmentoId` na API),
 *     e a rota `/trabalho/todas` abre o Trabalho já em "Todas".
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn();
const push = vi.fn();
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: vi.fn(), apiBlob: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: EU, name: 'Rodrigo QA' }, can: (p: string) => ['tarefas.ver', 'tarefas.editar'].includes(p) }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }) }));
import TrabalhoPage from '@/app/trabalho/page';
import TodasAsTarefasPage from '@/app/trabalho/todas/page';
import { TrabalhoView } from '@/components/trabalho/TrabalhoView';

const EU = '0e0e0e0e-0000-4000-8000-000000000001';
const ANA = '0e0e0e0e-0000-4000-8000-000000000002';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const V1 = '2026-10-18T10:00:00.000Z';
const ADM = 'a0a0a0a0-0000-4000-8000-00000000000a';
const GESTAO = 'b0b0b0b0-0000-4000-8000-00000000000b';
const CLIENTES = 'c0c0c0c0-0000-4000-8000-00000000000c';

const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#87909e', order, total: 0, limite: null });
const lista = (id: string, name: string) => ({ id, name, externalId: null, spaceId: null, order: 0, total: 1, fields: [], statuses: [st(`${id}-aberta`, 'A fazer', 'open', 0), st(`${id}-feita`, 'Feito', 'closed', 1)] });
const rotina = lista('l-rotina', 'Rotina');
const marketing = lista('l-mkt', 'Tarefas');
const execucao = lista('l-exec', 'Execução');
const onboarding = { ...lista('l-onb', 'Onboarding de cliente'), statuses: [st('onb-kick', 'Kickoff marcado', 'open', 0), st('onb-imersao', 'Imersão', 'custom', 1)] };
const financeiro = lista('l-fin', 'Financeiro');
const estrutura = {
  espacos: [],
  folders: [
    { id: ADM, name: 'Administrativa', order: 0, spaceId: null, parentId: null, externalId: null, lists: [rotina] },
    { id: GESTAO, name: 'Gestão', order: 1, spaceId: null, parentId: null, externalId: null, lists: [] },
    { id: 'f-mkt', name: 'Marketing', order: 0, spaceId: null, parentId: GESTAO, externalId: null, lists: [marketing] },
    { id: CLIENTES, name: 'Clientes', order: 2, spaceId: null, parentId: null, externalId: null, lists: [execucao, onboarding] },
  ],
  listasSoltas: [financeiro], camposGlobais: [], tags: [{ id: 'tag-urgente', name: 'urgente', color: '#f00' }], responsaveis: [], agentes: [],
  pessoas: [{ id: EU, name: 'Rodrigo QA', email: 'eu@qa.local', isActive: true }, { id: ANA, name: 'Ana QA', email: 'ana@qa.local', isActive: true }],
};
function tarefa(id: string, title: string, l: ReturnType<typeof lista>, extra: Record<string, unknown> = {}) {
  const status = l.statuses[0];
  return {
    id, title, listId: l.id, listName: l.name, statusId: status.id, statusName: status.name, statusType: status.type, statusColor: '#87909e',
    priority: 'normal', assignee: null, assigneeUserId: null, assigneeUserName: null, assigneeUserEmail: null, assigneeUserIsActive: null,
    dueDate: null as string | null, startDate: null, overdue: false, archived: false, agenteId: null, agenteNome: null, agenteSlug: null, agenteEm: null,
    statusDesde: null, minutos: 0, parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: 0, tags: [], values: [],
    clienteId: null, clienteNome: null, outrosResponsaveisIds: [] as string[], recorrencia: null, updatedAt: V1, ...extra,
  };
}
const PASTA_DA_LISTA: Record<string, string | null> = { 'l-rotina': ADM, 'l-mkt': GESTAO, 'l-exec': CLIENTES, 'l-onb': CLIENTES, 'l-fin': null };
let tarefas: ReturnType<typeof tarefa>[] = [];

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/trabalho');
  get.mockReset(); post.mockReset(); patch.mockReset(); push.mockReset();
  tarefas = [
    tarefa(T1, 'Pagar o aluguel', rotina, { assigneeUserId: EU }),
    tarefa(T2, 'Gravar o episódio', marketing, { assigneeUserId: ANA }),
    tarefa(T3, 'Conciliar o extrato', financeiro),
  ];
  get.mockImplementation((rota: string) => {
    if (rota === '/trabalho/estrutura') return Promise.resolve(estrutura);
    if (rota.startsWith('/trabalho/clientes')) return Promise.resolve([{ id: 'c-1', nome: 'Construtora Alicerce' }]);
    if (rota.startsWith('/trabalho/vistas')) return Promise.resolve([]);
    if (rota.startsWith('/tenants/onboarding/trilhos')) return Promise.resolve([]);
    if (rota.startsWith('/tenants/plataforma')) return Promise.reject(new Error('não'));
    if (rota.startsWith('/comercial')) return Promise.resolve([]);
    if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve({ itens: [] });
    if (rota.startsWith('/trabalho/tarefas?')) {
      const q = new URL(`http://x${rota}`).searchParams;
      let items = q.get('todas') === '1' ? tarefas : tarefas.filter((t) => t.listId === q.get('listId'));
      const seg = q.get('segmentoId');
      // O dublê faz o que a API faz: a pasta de topo leva a subpasta (Marketing dentro de Gestão).
      if (seg) items = items.filter((t) => (seg === 'sem-pasta' ? PASTA_DA_LISTA[t.listId] === null : PASTA_DA_LISTA[t.listId] === seg));
      if (q.get('assigneeUserId')) items = items.filter((t) => t.assigneeUserId === q.get('assigneeUserId'));
      return Promise.resolve({ total: items.length, items, source: { tool: 'qa', generatedAt: V1 } });
    }
    return Promise.resolve(null);
  });
  post.mockImplementation((_r: string, corpo: Record<string, unknown>) => Promise.resolve({ id: 'v-1', atualizadaEm: V1, padrao: true, ...corpo }));
  patch.mockResolvedValue({});
});
afterEach(cleanup);

const query = () => new URLSearchParams(window.location.search);
const consultas = () => get.mock.calls.map(([r]) => String(r)).filter((r) => r.startsWith('/trabalho/tarefas?')).map((r) => new URL(`http://x${r}`).searchParams);

describe('U2: os filtros do Trabalho num botão só', () => {
  it('o cabeçalho tem o par Vistas e Filtros, e os filtros soltos de antes não estão mais nele', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-rotina');
    render(<TrabalhoPage />);
    await screen.findByText('Pagar o aluguel');
    expect(screen.getByTestId('trabalho-vistas')).toBeInTheDocument();
    expect(screen.getByTestId('trabalho-filtros-botao')).toHaveTextContent('Filtros');
    expect(screen.queryByTestId('trabalho-filtros-contagem')).toBeNull();
    for (const rotulo of ['Buscar tarefas', 'Filtrar por responsável', 'Filtrar por cliente', 'Filtrar por status', 'Filtrar por agente']) {
      expect(screen.queryByLabelText(rotulo)).toBeNull();
    }
    expect(screen.queryByTestId('trabalho-concluidas')).toBeNull();
    expect(screen.queryByTestId('trabalho-escopo-meus')).toBeNull();
    // As formas de ver continuam no cabeçalho.
    expect(screen.getByTestId('trabalho-visao-quadro')).toBeInTheDocument();
    expect(screen.getByTestId('trabalho-densidade-compacto')).toBeInTheDocument();
  });

  it('o painel tem responsável e prazo, escreve no endereço, conta os ativos e vai à consulta', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-rotina&visao=lista');
    render(<TrabalhoPage />);
    await screen.findByText('Pagar o aluguel');
    fireEvent.click(screen.getByTestId('trabalho-filtros-botao'));
    const painel = screen.getByRole('dialog', { name: 'Filtros' });
    expect(within(painel).getByLabelText('Responsável')).toBeInTheDocument();
    expect(within(painel).getByLabelText('Prazo')).toBeInTheDocument();
    for (const rotulo of ['Recorte', 'Status', 'Cliente', 'Etiqueta', 'Agente', 'Ocultar concluídas', 'Incluir arquivadas', 'Busca']) {
      expect(within(painel).getByLabelText(rotulo)).toBeInTheDocument();
    }

    fireEvent.change(screen.getByTestId('trabalho-filtros-assigneeUserId'), { target: { value: EU } });
    expect(query().get('assigneeUserId')).toBe(EU);
    await waitFor(() => expect(consultas().some((p) => p.get('assigneeUserId') === EU && p.get('listId') === 'l-rotina')).toBe(true));
    fireEvent.change(screen.getByTestId('trabalho-filtros-prazo'), { target: { value: 'hoje' } });
    expect(query().get('prazo')).toBe('hoje');
    expect(screen.getByTestId('trabalho-recorte-prazo')).toHaveTextContent('Prazo: Hoje');
    fireEvent.change(screen.getByTestId('trabalho-filtros-tagId'), { target: { value: 'tag-urgente' } });
    await waitFor(() => expect(consultas().some((p) => p.get('tagId') === 'tag-urgente')).toBe(true));
    expect(screen.getByTestId('trabalho-filtros-contagem')).toHaveTextContent('(3)');

    // Limpar um filtro só tira aquela chave.
    fireEvent.click(screen.getByTestId('trabalho-filtros-limpar-prazo'));
    expect(query().has('prazo')).toBe(false);
    expect(screen.getByTestId('trabalho-filtros-contagem')).toHaveTextContent('(2)');

    // "Limpar tudo" tira os filtros e mantém lista e visão.
    fireEvent.click(screen.getByTestId('trabalho-filtros-limpar-tudo'));
    expect(query().has('assigneeUserId')).toBe(false);
    expect(query().has('tagId')).toBe(false);
    expect(query().get('lista')).toBe('l-rotina');
    expect(query().get('visao')).toBe('lista');
    expect(screen.queryByTestId('trabalho-filtros-contagem')).toBeNull();
  });

  it('o filtro que chega pelo link aparece no painel e na contagem', async () => {
    window.history.replaceState({}, '', `/trabalho?lista=l-rotina&assigneeUserId=${EU}&prazo=proximos_7&arquivadas=1`);
    render(<TrabalhoPage />);
    await waitFor(() => expect(screen.getByTestId('trabalho-filtros-contagem')).toHaveTextContent('(3)'));
    fireEvent.click(screen.getByTestId('trabalho-filtros-botao'));
    expect(screen.getByTestId('trabalho-filtros-assigneeUserId')).toHaveValue(EU);
    expect(screen.getByTestId('trabalho-filtros-prazo')).toHaveValue('proximos_7');
    expect(screen.getByTestId('trabalho-filtros-arquivadas')).toBeChecked();
    // Esc fecha e devolve o foco ao botão; nada se perde.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('trabalho-filtros-painel')).toBeNull();
    expect(query().get('prazo')).toBe('proximos_7');
  });

  it('a vista salva guarda os filtros novos do painel', async () => {
    window.history.replaceState({}, '', `/trabalho?lista=l-rotina&assigneeUserId=${EU}&prazo=hoje`);
    vi.spyOn(window, 'prompt').mockReturnValue('Minhas de hoje');
    render(<TrabalhoPage />);
    // O recorte "Hoje" esconde a tarefa sem prazo: espera a lista abrir.
    await screen.findByRole('heading', { name: 'Rotina' });
    fireEvent.click(screen.getByTestId('trabalho-vista-salvar'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [rota, corpo] = post.mock.calls[0] as [string, { tela: string; config: { filtros: Record<string, unknown> } }];
    expect(rota).toBe('/trabalho/vistas');
    expect(corpo.tela).toBe('quadro');
    expect(corpo.config.filtros).toMatchObject({ pessoa: EU, prazo: 'hoje' });
    expect(corpo.config.filtros).not.toHaveProperty('etiqueta');
  });
});

describe('U2: a Implantação com o mesmo par', () => {
  it('as vistas são da implantação e os filtros são responsável, cliente, etapa, atrasadas e busca', async () => {
    render(<TrabalhoView modo="implantacao" />);
    await waitFor(() => expect(get.mock.calls.some(([r]) => String(r) === '/trabalho/vistas?tela=implantacao')).toBe(true));
    expect(screen.getByTestId('implantacao-vistas')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('implantacao-filtros-botao'));
    const painel = screen.getByRole('dialog', { name: 'Filtros' });
    const rotulos = [...painel.querySelectorAll('label')].map((l) => l.textContent?.trim());
    expect(rotulos).toEqual(['Responsável', 'Cliente', 'Etapa', 'Só as atrasadas', 'Busca']);
    expect(within(painel).getByRole('option', { name: 'Imersão' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('implantacao-filtros-escopo'));
    expect(query().get('escopo')).toBe('atrasados');
    expect(screen.getByTestId('implantacao-filtros-contagem')).toHaveTextContent('(1)');
  });
});

describe('U3: Todas as tarefas, por segmento', () => {
  it('a linha de segmentos tem as pastas de topo, Sem pasta e Todas; escolher grava ?segmento= e vai à consulta', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&visao=lista');
    render(<TrabalhoPage />);
    const segmentos = await screen.findByTestId('trabalho-segmentos');
    expect([...segmentos.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Todas', 'Administrativa', 'Gestão', 'Clientes', 'Sem pasta']);
    // A subpasta não vira segmento: entra no da pasta de topo.
    expect(within(segmentos).queryByText('Marketing')).toBeNull();
    await waitFor(() => expect(document.querySelectorAll('[data-work-task-id]')).toHaveLength(3));
    expect(screen.getByTestId('trabalho-segmento-todas')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId(`trabalho-segmento-${GESTAO}`));
    expect(query().get('segmento')).toBe(GESTAO);
    expect(query().get('pasta')).toBe('todas');
    await waitFor(() => expect(consultas().some((p) => p.get('todas') === '1' && p.get('segmentoId') === GESTAO && !p.has('listId'))).toBe(true));
    await waitFor(() => expect([...document.querySelectorAll('[data-work-task-id]')].map((e) => e.getAttribute('data-work-task-id'))).toEqual([T2]));

    fireEvent.click(screen.getByTestId('trabalho-segmento-sem-pasta'));
    expect(query().get('segmento')).toBe('sem-pasta');
    await waitFor(() => expect([...document.querySelectorAll('[data-work-task-id]')].map((e) => e.getAttribute('data-work-task-id'))).toEqual([T3]));

    fireEvent.click(screen.getByTestId('trabalho-segmento-todas'));
    expect(query().has('segmento')).toBe(false);
    await waitFor(() => expect(document.querySelectorAll('[data-work-task-id]')).toHaveLength(3));
  });

  it('o segmento do link vai à consulta, combina com os filtros e sai junto ao abrir uma lista', async () => {
    window.history.replaceState({}, '', `/trabalho?pasta=todas&segmento=${ADM}&assigneeUserId=${EU}&visao=lista`);
    render(<TrabalhoPage />);
    await waitFor(() => expect(consultas().some((p) => p.get('segmentoId') === ADM && p.get('assigneeUserId') === EU && p.get('todas') === '1')).toBe(true));
    expect(await screen.findByTestId(`trabalho-segmento-${ADM}`)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Execução/ }));
    expect(query().has('segmento')).toBe(false);
    expect(query().get('lista')).toBe('l-exec');
  });

  it('fora de "Todas" não há segmentos e o segmento não vai à consulta', async () => {
    window.history.replaceState({}, '', `/trabalho?lista=l-rotina&segmento=${ADM}`);
    render(<TrabalhoPage />);
    await screen.findByText('Pagar o aluguel');
    expect(screen.queryByTestId('trabalho-segmentos')).toBeNull();
    expect(consultas().every((p) => !p.has('segmentoId'))).toBe(true);
  });

  it('a rota /trabalho/todas abre "Todas" sem ?pasta=, com os segmentos no lugar das pastas', async () => {
    window.history.replaceState({}, '', '/trabalho/todas');
    render(<TodasAsTarefasPage />);
    expect(await screen.findByRole('heading', { name: 'Todas as tarefas' })).toBeInTheDocument();
    await waitFor(() => expect(consultas().some((p) => p.get('todas') === '1' && !p.has('listId'))).toBe(true));
    expect(await screen.findByTestId('trabalho-segmentos')).toBeInTheDocument();
    expect(screen.queryByTestId('trabalho-pasta-todas')).toBeNull();
    expect(query().has('pasta')).toBe(false);
    fireEvent.click(screen.getByTestId(`trabalho-segmento-${CLIENTES}`));
    expect(query().get('segmento')).toBe(CLIENTES);
    // Abrir uma lista pela árvore vai para o Trabalho com ela.
    fireEvent.click(screen.getByRole('button', { name: /Rotina/ }));
    expect(push).toHaveBeenCalledWith('/trabalho?lista=l-rotina');
  });
});
