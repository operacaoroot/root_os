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
 *  3. U3 · "Todas" tem os segmentos por pasta de topo (`?segmento=`, `segmentoId` na API);
 *  4. Ajuste do Todas (20/10/2026, noite): o quadro de "Todas" tem as colunas dos status
 *     REAIS de todas as listas do recorte (união pelo nome, com as vazias); soltar cai no
 *     status de mesmo nome da lista da tarefa ou, sem ele, no primeiro do mesmo tipo, com
 *     aviso. A rota `/trabalho/todas` virou redirecionamento (rotas-movidas.test).
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
import { TrabalhoView } from '@/components/trabalho/TrabalhoView';
import { colunasDeTodas, destinoNaLista, nomeNormalizado } from '@/components/trabalho/colunas-de-todas';

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
    // Layout 26/10: as concluídas somem por padrão (como no ClickUp); o botão que as traz de volta mora no cabeçalho.
    expect(screen.getByTestId('trabalho-concluidas')).toHaveTextContent('Mostrar concluídas');
    expect(screen.getByTestId('trabalho-concluidas')).toHaveAttribute('aria-pressed', 'false');
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
    for (const rotulo of ['Recorte', 'Status', 'Cliente', 'Etiqueta', 'Agente', 'Mostrar concluídas', 'Incluir arquivadas', 'Busca']) {
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
  it('as vistas são da implantação e os filtros são responsável, cliente, etapa, atrasadas, vazios e busca', async () => {
    render(<TrabalhoView modo="implantacao" />);
    await waitFor(() => expect(get.mock.calls.some(([r]) => String(r) === '/trabalho/vistas?tela=implantacao')).toBe(true));
    expect(screen.getByTestId('implantacao-vistas')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('implantacao-filtros-botao'));
    const painel = screen.getByRole('dialog', { name: 'Filtros' });
    const rotulos = [...painel.querySelectorAll('label')].map((l) => l.textContent?.trim());
    // "Ocultar status vazios" (P4, 21/10/2026) vale também na Implantação.
    expect(rotulos).toEqual(['Responsável', 'Cliente', 'Etapa', 'Só as atrasadas', 'Ocultar status vazios', 'Busca']);
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
});

describe('Ajuste do Todas: o quadro com os status reais de todas as listas', () => {
  const colunas = () => [...document.querySelectorAll('[data-coluna]')].map((c) => c.getAttribute('data-coluna'));
  const coluna = (id: string) => document.querySelector(`[data-coluna="${id}"]`) as HTMLElement;
  const cartao = (id: string) => document.querySelector(`[data-work-task-id="${id}"]`) as HTMLElement;
  function dataTransfer() {
    const dados: Record<string, string> = {};
    return { setData: (k: string, v: string) => { dados[k] = v; }, getData: (k: string) => dados[k] ?? '', effectAllowed: 'all', dropEffect: 'move' };
  }
  function arrastar(id: string, colunaId: string) {
    const dt = dataTransfer();
    fireEvent.dragStart(cartao(id), { dataTransfer: dt });
    fireEvent.dragOver(coluna(colunaId), { dataTransfer: dt });
    fireEvent.drop(coluna(colunaId), { dataTransfer: dt });
  }
  /** Uma variante da estrutura em que o Onboarding tem uma etapa fechada com outro nome. */
  function comEntregue() {
    const antes = get.getMockImplementation()!;
    const onb = { ...onboarding, statuses: [...onboarding.statuses, st('onb-ok', 'Entregue', 'closed', 2)] };
    const e = { ...estrutura, folders: estrutura.folders.map((f) => (f.id === CLIENTES ? { ...f, lists: [execucao, onb] } : f)) };
    get.mockImplementation((rota: string) => (rota === '/trabalho/estrutura' ? Promise.resolve(e) : antes(rota)));
  }

  it('o chip Todas marcado mostra uma coluna por status real, com as vazias e em quantas listas cada uma existe', async () => {
    // Layout 26/10: com as concluídas à vista, para a coluna "Feito" (tipo concluído) entrar no quadro.
    window.history.replaceState({}, '', '/trabalho?pasta=todas&concluidas=mostrar');
    render(<TrabalhoPage />);
    await waitFor(() => expect(document.querySelectorAll('[data-work-task-id]')).toHaveLength(3));
    expect(screen.getByTestId('trabalho-pasta-todas')).toHaveAttribute('aria-pressed', 'true');
    // Abertos, em andamento, concluídos; dentro do tipo, pela ordem da primeira lista.
    expect(colunas()).toEqual(['nome:a fazer', 'nome:kickoff marcado', 'nome:imersao', 'nome:feito']);
    expect(coluna('nome:kickoff marcado')).toHaveAttribute('aria-label', 'Kickoff marcado: 0 tarefas');
    expect(coluna('nome:imersao')).toHaveAttribute('aria-label', 'Imersão: 0 tarefas');
    expect(within(coluna('nome:a fazer')).getByTestId('trabalho-coluna-listas')).toHaveTextContent('· 4 listas');
    expect(within(coluna('nome:kickoff marcado')).getByTestId('trabalho-coluna-listas')).toHaveTextContent('· 1 lista');
    expect(within(coluna('nome:feito')).getByTestId('trabalho-coluna-listas')).toHaveTextContent('· 4 listas');
    // Nenhum cartão fica de fora nem aparece duas vezes: a soma das colunas é o total.
    const soma = colunas().reduce((n, id) => n + coluna(id!).querySelectorAll('[data-work-task-id]').length, 0);
    expect(soma).toBe(3);
    expect(new Set([...document.querySelectorAll('[data-work-task-id]')].map((e) => e.getAttribute('data-work-task-id'))).size).toBe(3);
  });

  it('o segmento recorta as colunas pelas listas da pasta', async () => {
    window.history.replaceState({}, '', `/trabalho?pasta=todas&segmento=${ADM}&concluidas=mostrar`);
    render(<TrabalhoPage />);
    await waitFor(() => expect(colunas()).toEqual(['nome:a fazer', 'nome:feito']));
    fireEvent.click(screen.getByTestId(`trabalho-segmento-${CLIENTES}`));
    await waitFor(() => expect(colunas()).toEqual(['nome:a fazer', 'nome:kickoff marcado', 'nome:imersao', 'nome:feito']));
    expect(within(coluna('nome:a fazer')).getByTestId('trabalho-coluna-listas')).toHaveTextContent('· 1 lista');
  });

  it('soltar numa coluna move para o status de mesmo nome da lista da tarefa', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas&concluidas=mostrar');
    render(<TrabalhoPage />);
    await waitFor(() => expect(cartao(T1)).toBeTruthy());
    arrastar(T1, 'nome:feito');
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${T1}`, { statusId: 'l-rotina-feita', expectedUpdatedAt: V1 }, 'tok'));
    expect(screen.queryByTestId('trabalho-todas-aviso')).toBeNull();
  });

  it('sem o mesmo nome, cai no primeiro status do mesmo tipo e avisa; sem o tipo, nada muda e diz por quê', async () => {
    comEntregue();
    tarefas.push(tarefa('44444444-4444-4444-8444-444444444444', 'Fazer o kickoff', onboarding as ReturnType<typeof lista>));
    window.history.replaceState({}, '', '/trabalho?pasta=todas&concluidas=mostrar');
    render(<TrabalhoPage />);
    await waitFor(() => expect(colunas()).toContain('nome:entregue'));
    arrastar('44444444-4444-4444-8444-444444444444', 'nome:feito');
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/trabalho/tarefas/44444444-4444-4444-8444-444444444444', { statusId: 'onb-ok', expectedUpdatedAt: V1 }, 'tok'));
    expect(await screen.findByTestId('trabalho-todas-aviso')).toHaveTextContent('Movida para Entregue (a lista Onboarding de cliente não tem a etapa Feito).');

    patch.mockClear();
    arrastar(T1, 'nome:imersao');
    expect(await screen.findByTestId('trabalho-todas-aviso')).toHaveTextContent('Nada mudou: a lista Rotina não tem a etapa Imersão nem outra do mesmo tipo.');
    expect(patch).not.toHaveBeenCalled();
  });

  it('por padrão (sem ?concluidas=) as colunas de tipo concluído ficam ocultas', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas');
    render(<TrabalhoPage />);
    await waitFor(() => expect(colunas()).toEqual(['nome:a fazer', 'nome:kickoff marcado', 'nome:imersao']));
    expect(query().has('concluidas')).toBe(false);
  });

  it('as concluídas ocultas (o padrão) não escondem a tarefa aberta cujo status tem o nome de uma etapa concluída de outra lista', async () => {
    const antes = get.getMockImplementation()!;
    const exec = { ...execucao, statuses: [st('exec-feito-aberto', 'Feito', 'open', 0)] };
    const e = { ...estrutura, folders: estrutura.folders.map((f) => (f.id === CLIENTES ? { ...f, lists: [exec, onboarding] } : f)) };
    get.mockImplementation((rota: string) => (rota === '/trabalho/estrutura' ? Promise.resolve(e) : antes(rota)));
    tarefas.push(tarefa('55555555-5555-4555-8555-555555555555', 'Revisar a entrega', exec as ReturnType<typeof lista>));
    window.history.replaceState({}, '', '/trabalho?pasta=todas');
    render(<TrabalhoPage />);
    await waitFor(() => expect(document.querySelectorAll('[data-work-task-id]')).toHaveLength(4));
    expect(colunas()).toContain('nome:feito');
    expect(within(coluna('nome:feito')).getByText('Revisar a entrega')).toBeInTheDocument();
  });

  it('a união é por nome normalizado e o destino nunca é status de outra lista', () => {
    expect(nomeNormalizado('  Em   Revisão ')).toBe('em revisao');
    const a = { ...lista('l-a', 'A'), statuses: [st('a1', 'Em Revisão', 'custom', 0), st('a2', 'Feito', 'closed', 1)] };
    const b = { ...lista('l-b', 'B'), statuses: [st('b1', 'em  revisao', 'custom', 0), st('b2', 'Pronto', 'closed', 1)] };
    const cols = colunasDeTodas([a, b] as never);
    expect(cols.map((c) => [c.id, c.name, c.listas])).toEqual([['nome:em revisao', 'Em Revisão', 2], ['nome:feito', 'Feito', 1], ['nome:pronto', 'Pronto', 1]]);
    // A tarefa cujo status não veio na estrutura ganha a coluna dela, sem contar lista.
    expect(colunasDeTodas([a] as never, [{ statusName: 'Órfã', statusType: 'open' }]).map((c) => c.id)).toEqual(['nome:orfa', 'nome:em revisao', 'nome:feito']);
    expect(destinoNaLista(b as never, { id: 'nome:feito', type: 'closed' })).toEqual({ statusId: 'b2', nome: 'Pronto', exato: false });
    expect(destinoNaLista(b as never, { id: 'nome:em revisao', type: 'custom' })).toEqual({ statusId: 'b1', nome: 'em  revisao', exato: true });
    expect(destinoNaLista(b as never, { id: 'nome:a fazer', type: 'open' })).toBeNull();
    expect(destinoNaLista(undefined, { id: 'nome:feito', type: 'closed' })).toBeNull();
  });
});
