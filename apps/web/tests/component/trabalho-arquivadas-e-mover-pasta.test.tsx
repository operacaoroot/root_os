import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TRAB_LISTA_VOLTA_SEM_PASTA, TRAB_LISTA_VOLTOU_SEM_PASTA, TRAB_PASTA_VOLTA_AO_TOPO, TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA,
  TRAB_PASTA_EM_CICLO, TRAB_PASTA_FUNDA_DEMAIS, type TrabArquivadas,
} from '@mktos/shared';

/*
 * M3 (rodada de produção 2, 22/10/2026): no fim da árvore do Trabalho,
 *
 *  · a seção recolhida "Arquivadas (N)" com nome, data, quem arquivou e quantas
 *    tarefas; "Desarquivar" chama a API e diz para onde voltou (Sem pasta quando a
 *    pasta da lista continua arquivada); sem nada arquivado, a seção não aparece;
 *    sem a permissão de editar, não há botão;
 *  · arrastar uma pasta SOBRE outra a põe dentro dela; a faixa ENTRE pastas de outro
 *    nível muda a mãe e põe naquela posição; ciclo, nível, a pasta Clientes e nome
 *    repetido são recusados na tela com a frase da API, sem chamar a API;
 *  · "⋯" › Mover para… faz o mesmo pelo teclado.
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn(), del = vi.fn();
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: (...a: unknown[]) => del(...a), apiBlob: vi.fn(),
}));
let permissoes = ['tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: (p: string) => permissoes.includes(p) }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }) }));
import TrabalhoPage from '@/app/trabalho/page';

const GESTAO = 'a0a0a0a0-0000-4000-8000-00000000000a';
const MKT = 'b0b0b0b0-0000-4000-8000-00000000000b';
const CLIENTES = 'c0c0c0c0-0000-4000-8000-00000000000c';
const ADM = 'd0d0d0d0-0000-4000-8000-00000000000d';
const MKT_SOLTA = 'e0e0e0e0-0000-4000-8000-00000000000e';
const PROJ = 'f0f0f0f0-0000-4000-8000-00000000000f';
const ANO = 'f1f1f1f1-0000-4000-8000-0000000000f1';
const MES = 'f2f2f2f2-0000-4000-8000-0000000000f2';
const V1 = '2026-10-21T10:00:00.000Z';

const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#87909e', order, total: 0, limite: null });
const lista = (id: string, name: string, total = 0) => ({
  id, name, externalId: null, spaceId: null, order: 0, total, fields: [], natureza: 'tarefas' as const,
  statuses: [st(`${id}-a`, 'A fazer', 'open', 0), st(`${id}-f`, 'Feito', 'closed', 1)],
});
const pasta = (id: string, name: string, parentId: string | null, lists: ReturnType<typeof lista>[] = [], order = 0) =>
  ({ id, name, order, spaceId: null, parentId, externalId: null, lists });
const estrutura = {
  espacos: [],
  folders: [
    pasta(GESTAO, 'Gestão', null, [lista('l-fin', 'Financeiro', 2)], 0),
    pasta(MKT, 'Marketing', GESTAO, [lista('l-dem', 'Demandas')]),
    pasta(CLIENTES, 'Clientes', null, [lista('l-onb', 'Onboarding de cliente')], 1),
    pasta(ADM, 'Administrativa', null, [], 2),
    pasta(MKT_SOLTA, 'MARKETING', null, [], 3),
    pasta(PROJ, 'Projetos', null, [], 4),
    pasta(ANO, 'Ano', PROJ),
    pasta(MES, 'Mês', ANO),
  ],
  listasSoltas: [lista('l-avulsa', 'Avulsa')], camposGlobais: [], tags: [], responsaveis: [], agentes: [], pessoas: [],
};

const ARQUIVADAS: TrabArquivadas = {
  pastas: [{
    id: 'p-crm', name: 'CRM', arquivadaEm: '2026-10-21T13:00:00.000Z', por: { id: 'u1', nome: 'Rodrigo' },
    mae: null, maeArquivada: false, listas: 3, tarefas: 12, listasQueVoltam: 2,
  }],
  listas: [
    { id: 'l-leads', name: 'Gestão de Leads', arquivadaEm: '2026-10-21T13:00:00.000Z', por: { id: 'u1', nome: 'Rodrigo' }, pasta: { id: 'p-crm', name: 'CRM' }, maeArquivada: true, tarefas: 7 },
    { id: 'l-teste', name: 'Teste teste', arquivadaEm: '2026-10-19T12:00:00.000Z', por: null, pasta: { id: GESTAO, name: 'Gestão' }, maeArquivada: false, tarefas: 3 },
  ],
};
let arquivadas: TrabArquivadas = ARQUIVADAS;

beforeEach(() => {
  permissoes = ['tarefas.ver', 'tarefas.editar'];
  arquivadas = ARQUIVADAS;
  window.history.replaceState({}, '', '/trabalho?lista=l-avulsa');
  get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset();
  get.mockImplementation((rota: string) => {
    // Um objeto novo a cada leitura, como a API devolve: a seção relê quando a árvore volta.
    if (rota === '/trabalho/estrutura') return Promise.resolve({ ...estrutura });
    if (rota === '/trabalho/arquivadas') return Promise.resolve(arquivadas);
    if (rota.startsWith('/trabalho/tarefas?')) return Promise.resolve({ total: 0, items: [], source: { tool: 'qa', generatedAt: V1 } });
    if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve({ itens: [] });
    if (rota.startsWith('/tenants/plataforma')) return Promise.reject(new Error('não'));
    return Promise.resolve([]);
  });
  post.mockResolvedValue({ ok: true });
  patch.mockResolvedValue({});
});
afterEach(cleanup);

const abrir = async () => {
  render(<TrabalhoPage />);
  await screen.findByTestId(`trabalho-arvore-pasta-${GESTAO}`);
};
const aviso = () => screen.getByTestId('trabalho-arvore-aviso');
const recargas = (rota: string) => get.mock.calls.filter(([r]) => r === rota).length;

describe('M3: a seção Arquivadas', () => {
  it('vem recolhida com a contagem; aberta, mostra data, quem arquivou, tarefas e para onde volta', async () => {
    await abrir();
    const alternar = await screen.findByTestId('trabalho-arquivadas-alternar');
    expect(alternar).toHaveTextContent('Arquivadas (3)');
    expect(alternar).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(alternar);
    expect(alternar).toHaveAttribute('aria-expanded', 'true');
    const crm = screen.getByTestId('trabalho-arquivada-pasta-p-crm');
    expect(crm).toHaveTextContent('CRM');
    expect(crm).toHaveTextContent('arquivada em 21/10/2026 · por Rodrigo');
    expect(crm).toHaveTextContent('3 listas · 12 tarefas');
    expect(crm).toHaveTextContent('Volta com 2 listas arquivadas junto.');
    const leads = screen.getByTestId('trabalho-arquivada-lista-l-leads');
    expect(within(leads).getByTestId('trabalho-arquivada-lista-l-leads-dica')).toHaveTextContent(TRAB_LISTA_VOLTA_SEM_PASTA);
    expect(screen.getByTestId('trabalho-arquivada-lista-l-teste')).toHaveTextContent('sem registro de quem arquivou');
    expect(screen.getByTestId('trabalho-arquivada-lista-l-teste')).toHaveTextContent('3 tarefas · estava em Gestão');
  });

  it('Desarquivar chama a API, diz para onde voltou e relê a árvore e a seção', async () => {
    post.mockResolvedValueOnce({ id: 'l-teste', tipo: 'lista', destino: 'mesmo-lugar', pastasJunto: 0, listasJunto: 0, aviso: null });
    await abrir();
    fireEvent.click(await screen.findByTestId('trabalho-arquivadas-alternar'));
    const antes = [recargas('/trabalho/estrutura'), recargas('/trabalho/arquivadas')];
    await act(async () => { fireEvent.click(screen.getByTestId('trabalho-desarquivar-lista-l-teste')); });
    expect(post).toHaveBeenCalledWith('/trabalho/listas/l-teste/desarquivar', {}, 'tok');
    await waitFor(() => expect(aviso()).toHaveTextContent('A lista Teste teste voltou para Gestão.'));
    await waitFor(() => expect(recargas('/trabalho/estrutura')).toBeGreaterThan(antes[0]));
    await waitFor(() => expect(recargas('/trabalho/arquivadas')).toBeGreaterThan(antes[1]));
  });

  it('a lista cuja pasta continua arquivada volta para Sem pasta e a tela diz isso; a pasta volta com as de junto', async () => {
    post.mockResolvedValueOnce({ id: 'l-leads', tipo: 'lista', destino: 'sem-pasta', pastasJunto: 0, listasJunto: 0, aviso: TRAB_LISTA_VOLTOU_SEM_PASTA });
    await abrir();
    fireEvent.click(await screen.findByTestId('trabalho-arquivadas-alternar'));
    await act(async () => { fireEvent.click(screen.getByTestId('trabalho-desarquivar-lista-l-leads')); });
    await waitFor(() => expect(aviso()).toHaveTextContent(`A lista Gestão de Leads foi desarquivada. ${TRAB_LISTA_VOLTOU_SEM_PASTA}`));

    post.mockResolvedValueOnce({ id: 'p-crm', tipo: 'pasta', destino: 'mesmo-lugar', pastasJunto: 0, listasJunto: 2, aviso: null });
    await act(async () => { fireEvent.click(screen.getByTestId('trabalho-desarquivar-pasta-p-crm')); });
    expect(post).toHaveBeenCalledWith('/trabalho/pastas/p-crm/desarquivar', {}, 'tok');
    await waitFor(() => expect(aviso()).toHaveTextContent('A pasta CRM voltou para o primeiro nível. Voltou com 2 listas.'));
  });

  it('a recusa da API (nome repetido) aparece na seção', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('Já existe uma lista com esse nome neste lugar.'), { status: 409 }));
    await abrir();
    fireEvent.click(await screen.findByTestId('trabalho-arquivadas-alternar'));
    await act(async () => { fireEvent.click(screen.getByTestId('trabalho-desarquivar-lista-l-teste')); });
    expect(await screen.findByTestId('trabalho-arquivadas-erro')).toHaveTextContent('Já existe uma lista com esse nome neste lugar.');
  });

  it('a pasta com a mãe arquivada avisa que volta ao primeiro nível; sem nada arquivado, a seção some; só leitura não desarquiva', async () => {
    arquivadas = { pastas: [{ ...ARQUIVADAS.pastas[0], maeArquivada: true, mae: { id: 'x', name: 'Antiga' }, listasQueVoltam: 0 }], listas: [] };
    permissoes = ['tarefas.ver'];
    await abrir();
    fireEvent.click(await screen.findByTestId('trabalho-arquivadas-alternar'));
    expect(screen.getByTestId('trabalho-arquivada-pasta-p-crm-dica')).toHaveTextContent(TRAB_PASTA_VOLTA_AO_TOPO);
    expect(screen.queryByTestId('trabalho-desarquivar-pasta-p-crm')).toBeNull();
    cleanup();

    arquivadas = { pastas: [], listas: [] };
    permissoes = ['tarefas.ver', 'tarefas.editar'];
    await abrir();
    await waitFor(() => expect(recargas('/trabalho/arquivadas')).toBeGreaterThan(0));
    expect(screen.queryByTestId('trabalho-arquivadas')).toBeNull();
  });
});

describe('M3: arrastar pasta para dentro de pasta', () => {
  function dataTransfer() {
    const dados: Record<string, string> = {};
    return { setData: (k: string, v: string) => { dados[k] = v; }, getData: (k: string) => dados[k] ?? '', effectAllowed: 'all', dropEffect: 'move' };
  }
  const arrastar = async (de: string, para: HTMLElement) => {
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId(`trabalho-arvore-pasta-${de}`), { dataTransfer: dt });
    fireEvent.dragOver(para, { dataTransfer: dt });
    await act(async () => { fireEvent.drop(para, { dataTransfer: dt }); });
  };
  const sobre = (id: string) => screen.getByTestId(`trabalho-arvore-pasta-${id}`).parentElement as HTMLElement;

  it('soltar SOBRE a pasta põe a arrastada dentro dela', async () => {
    await abrir();
    const antes = recargas('/trabalho/estrutura');
    await arrastar(ADM, sobre(GESTAO));
    expect(post).toHaveBeenCalledWith(`/trabalho/pastas/${ADM}/mover`, { parentId: GESTAO }, 'tok');
    await waitFor(() => expect(aviso()).toHaveTextContent('A pasta Administrativa foi para Gestão.'));
    await waitFor(() => expect(recargas('/trabalho/estrutura')).toBeGreaterThan(antes));
  });

  it('a faixa entre pastas de outro nível muda a mãe e põe naquela posição', async () => {
    await abrir();
    await arrastar(ANO, screen.getByTestId(`trabalho-arvore-entre-${ADM}`));
    expect(post).toHaveBeenCalledWith(`/trabalho/pastas/${ANO}/mover`, { parentId: null }, 'tok');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/arvore/ordem', {
      tipo: 'pasta', paiId: null, ids: [GESTAO, CLIENTES, ANO, ADM, MKT_SOLTA, PROJ],
    }, 'tok'));
    await waitFor(() => expect(aviso()).toHaveTextContent('A pasta Ano foi para o primeiro nível.'));
  });

  it('ciclo, nível, a pasta Clientes e nome repetido são recusados na tela, sem chamar a API', async () => {
    await abrir();
    await arrastar(GESTAO, sobre(MKT));
    expect(aviso()).toHaveTextContent(TRAB_PASTA_EM_CICLO);
    // Gestão tem Marketing dentro (altura 2); dentro de Mês (nível 3) seriam 5 níveis.
    await arrastar(GESTAO, sobre(MES));
    expect(aviso()).toHaveTextContent(TRAB_PASTA_FUNDA_DEMAIS);
    await arrastar(CLIENTES, sobre(ADM));
    expect(aviso()).toHaveTextContent(TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA);
    // "MARKETING" de topo indo para Gestão, que já tem "Marketing".
    await arrastar(MKT_SOLTA, sobre(GESTAO));
    expect(aviso()).toHaveTextContent('No destino já existe uma pasta chamada "MARKETING". Renomeie uma delas antes de mover.');
    expect(post).not.toHaveBeenCalled();
  });

  it('"⋯" › Mover para… escolhe o destino pelo teclado; a pasta Clientes tem o item desabilitado com o porquê', async () => {
    await abrir();
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${ADM}`));
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${ADM}-mover`));
    const select = await screen.findByTestId('trabalho-mover-pasta-destino');
    const opcoes = within(select).getAllByRole('option').map((o) => o.textContent);
    // Já no primeiro nível: "Primeiro nível" não aparece; ela mesma também não.
    expect(opcoes).toContain('Gestão / Marketing');
    expect(opcoes).not.toContain('Primeiro nível');
    expect(opcoes).not.toContain('Administrativa');
    fireEvent.change(select, { target: { value: GESTAO } });
    await act(async () => { fireEvent.click(screen.getByTestId('trabalho-mover-pasta-confirmar')); });
    expect(post).toHaveBeenCalledWith(`/trabalho/pastas/${ADM}/mover`, { parentId: GESTAO }, 'tok');
    await waitFor(() => expect(screen.queryByTestId('trabalho-mover-pasta-destino')).toBeNull());

    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${CLIENTES}`));
    const item = screen.getByTestId(`trabalho-pasta-acoes-${CLIENTES}-mover`);
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent(TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA);
  });

  it('Mover para… de uma subpasta oferece o primeiro nível, e a recusa da API fica no diálogo', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('A pasta mudou enquanto você confirmava. Atualize a tela e tente de novo.'), { status: 409 }));
    await abrir();
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${ANO}`));
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${ANO}-mover`));
    const select = await screen.findByTestId('trabalho-mover-pasta-destino');
    const opcoes = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(opcoes).toContain('Primeiro nível');
    // A mãe atual (Projetos) e a de dentro dela (Mês) não são destino; Gestão / Marketing (nível 2 + altura 2) cabe.
    expect(opcoes).not.toContain('Projetos');
    expect(opcoes).not.toContain('Projetos / Ano / Mês');
    expect(opcoes).toContain('Gestão / Marketing');
    fireEvent.change(select, { target: { value: '__primeiro-nivel__' } });
    await act(async () => { fireEvent.click(screen.getByTestId('trabalho-mover-pasta-confirmar')); });
    expect(post).toHaveBeenCalledWith(`/trabalho/pastas/${ANO}/mover`, { parentId: null }, 'tok');
    expect(await screen.findByRole('alert')).toHaveTextContent('A pasta mudou enquanto você confirmava.');
  });
});
