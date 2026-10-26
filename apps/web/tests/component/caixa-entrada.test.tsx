import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CaixaAtividade,
  CaixaAtividadeResposta,
  CaixaResposta,
  TrabTarefaResumo,
} from '@mktos/shared';

/*
 * ==========================================================================
 * A CAIXA DE ENTRADA — as abas, o Limpar e Minhas tarefas (P1)
 * ==========================================================================
 *
 *  1. AS ABAS são um tablist de verdade, e a aba vai na query (`?aba=`);
 *  2. ATIVIDADE mostra quem fez, o que mudou (de → para) e o trecho do
 *     comentário; Limpar tira o item da caixa e grava SÓ a marca (`POST
 *     /caixa/limpar` com o id do item); Limpar tudo manda o instante da leitura;
 *  3. MINHAS TAREFAS (layout 26/10): a Lista do Trabalho com as tarefas da pessoa;
 *     lista, pasta e vencimento filtram o que chegou, o responsável muda a consulta,
 *     o motivo e os comentários ficam embaixo do nome e o clique abre o pop-up
 *     da tarefa, sem sair da tela;
 *  4. ERRO tem "tentar de novo".
 */

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['dashboard.ver', 'tarefas.ver'] },
    can: () => true,
  }),
}));

// eslint-disable-next-line import/first
import CaixaPage from '@/app/caixa/page';

const AGORA = new Date();
const haMin = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();

const CAIXA: CaixaResposta = {
  agora: AGORA.toISOString(),
  eu: { id: 'u-eu', nome: 'Pedro', alcada: 'responsavel', decide: true, decideNestaSessao: true, ativo: true },
  aprovacoes: { estado: 'ok', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 },
  tarefas: { estado: 'ok', itens: [], truncado: false, teto: 50, identidades: ['Pedro'], diasSemMovimento: 7, horasPresa: 24 },
  conversa: { estado: 'ok', itens: [], truncado: false, dias: 7, teto: 20 },
  total: 0,
  totalParcial: false,
  source: { tool: 'caixa-pessoal', generatedAt: AGORA.toISOString() },
};

function evento(over: Partial<CaixaAtividade>): CaixaAtividade {
  return {
    id: 'auditoria:a1',
    origem: 'auditoria',
    tipo: 'status',
    tarefaId: 't-1',
    tarefaTitulo: 'Fechar o relatório do cliente',
    lista: 'Operação',
    quem: 'Lucas Fernandes',
    quemTipo: 'user',
    porMim: false,
    quando: haMin(5),
    mudancas: [{ campo: 'status', de: 'A fazer', para: 'Em andamento' }],
    trecho: null,
    trechoCortado: false,
    limpo: false,
    ...over,
  };
}

function atividade(itens: CaixaAtividade[], over: Partial<CaixaAtividadeResposta> = {}): CaixaAtividadeResposta {
  return {
    estado: 'ok',
    itens,
    proximo: null,
    identidades: ['Pedro'],
    limpoAte: null,
    incluirLimpos: false,
    incluirMeus: false,
    tarefasTruncadas: false,
    agora: AGORA.toISOString(),
    ...over,
  };
}

/*
 * Layout 26/10: Minhas tarefas lê as tarefas da pessoa como o Trabalho
 * (`/trabalho/tarefas?assigneeUserId=`) e mostra a Lista do Trabalho.
 */
const TAREFA: TrabTarefaResumo = {
  id: 't-9',
  title: 'Revisar contrato da Ana',
  listId: 'l-1',
  listName: 'Operacional',
  statusId: 's-andamento',
  statusName: 'Em andamento',
  statusColor: '#9bdb1f',
  statusType: 'custom',
  priority: 'normal',
  assignee: 'Pedro',
  assigneeUserId: 'u-eu',
  assigneeUserName: 'Pedro',
  assigneeUserEmail: 'p@x.com',
  assigneeUserIsActive: true,
  outrosResponsaveisIds: [],
  agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null, statusDesde: null, minutos: 0,
  dueDate: new Date(AGORA.getTime() - 86_400_000).toISOString(),
  startDate: null,
  overdue: true,
  parentId: null, subtasks: 0,
  comments: 2,
  externalId: null, externalUrl: null, archived: false, order: 0, tags: [], values: [],
  clienteId: 'c-ana',
  clienteNome: 'Ana Consultoria',
  recorrencia: null,
  updatedAt: haMin(60),
};

const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#999', order, total: 0, limite: null });
const ESTRUTURA = {
  espacos: [], listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [],
  folders: [{ id: 'p-1', name: 'Clientes', order: 0, spaceId: null, parentId: null, externalId: null, lists: [
    { id: 'l-1', name: 'Operacional', externalId: null, spaceId: null, order: 0, total: 1, fields: [], statuses: [st('s-aberta', 'A fazer', 'open', 0), st('s-andamento', 'Em andamento', 'custom', 1), st('s-feita', 'Feito', 'closed', 2)] },
    { id: 'l-2', name: 'Interno', externalId: null, spaceId: null, order: 1, total: 1, fields: [], statuses: [st('s2-aberta', 'Aberta', 'open', 0)] },
  ] }],
  pessoas: [
    { id: 'u-eu', name: 'Pedro Magnago', email: 'p@x.com', isActive: true },
    { id: 'u-2', name: 'Lucas Fernandes', email: 'lucas@x.com', isActive: true },
  ],
};

let ATIVIDADE: CaixaAtividadeResposta;
let TAREFAS: TrabTarefaResumo[];

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/caixa');
  ATIVIDADE = atividade([
    evento({}),
    evento({
      id: 'comentario:c1',
      origem: 'comentario',
      tipo: 'comentario',
      quem: 'Ana Souza',
      mudancas: [],
      trecho: 'precisa do anexo assinado',
      quando: haMin(30),
    }),
  ]);
  TAREFAS = [TAREFA];
  apiGet.mockImplementation((caminho: string) => {
    if (caminho === '/caixa') return Promise.resolve(CAIXA);
    if (caminho.startsWith('/caixa/atividade')) return Promise.resolve(ATIVIDADE);
    if (caminho.startsWith('/trabalho/vistas')) return Promise.resolve([]);
    if (caminho === '/trabalho/estrutura') return Promise.resolve(ESTRUTURA);
    if (caminho.startsWith('/trabalho/tarefas?')) return Promise.resolve({ total: TAREFAS.length, items: TAREFAS });
    if (caminho.startsWith('/trabalho/tarefas/')) {
      return Promise.resolve({
        ...TAREFA, description: null, createdAt: haMin(600), atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [],
        comentarios: [
          { id: 'k2', authorId: 'u-2', authorName: 'Lucas', text: 'último recado', createdAt: haMin(10) },
          { id: 'k1', authorId: 'u-3', authorName: 'Ana', text: 'primeiro recado', createdAt: haMin(90) },
        ],
      });
    }
    return Promise.reject(new Error(`rota inesperada ${caminho}`));
  });
  apiPost.mockResolvedValue({ limpos: 1, limpoAte: null });
});

describe('P1: as abas', () => {
  it('abre na Atividade, é um tablist acessível e troca pela query', async () => {
    render(<CaixaPage />);
    const tabs = screen.getAllByRole('tab');
    // A terceira aba, Decisões (T6, 19/10/2026), aparece porque este perfil tem leads.ver.
    expect(tabs.map((t) => t.textContent)).toEqual(['Atividade', 'Minhas tarefas', 'Decisões']);
    expect(screen.getByTestId('caixa-aba-atividade').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    expect(screen.getByTestId('caixa-aba-tarefas').getAttribute('aria-selected')).toBe('true');
    expect(window.location.search).toBe('?aba=tarefas');
    await waitFor(() => expect(screen.getByTestId('caixa-tarefa-t-9')).toBeTruthy());
  });

  it('?aba=tarefas no endereço abre direto em Minhas tarefas', async () => {
    window.history.replaceState(null, '', '/caixa?aba=tarefas');
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByTestId('caixa-aba-tarefas').getAttribute('aria-selected')).toBe('true'));
  });

  it('a seta do teclado troca de aba', () => {
    render(<CaixaPage />);
    fireEvent.keyDown(screen.getByTestId('caixa-aba-atividade'), { key: 'ArrowRight' });
    expect(screen.getByTestId('caixa-aba-tarefas').getAttribute('aria-selected')).toBe('true');
  });
});

describe('P1: a aba Atividade', () => {
  it('mostra quem fez, o de → para e o trecho do comentário', async () => {
    render(<CaixaPage />);
    const item = await screen.findByTestId('caixa-item-auditoria:a1');
    expect(within(item).getByText('Lucas Fernandes')).toBeTruthy();
    expect(within(item).getByText('A fazer')).toBeTruthy();
    expect(within(item).getByText('Em andamento')).toBeTruthy();
    expect(within(item).getByText(/mudou o status/)).toBeTruthy();
    const comentario = screen.getByTestId('caixa-item-comentario:c1');
    expect(within(comentario).getByText(/precisa do anexo assinado/)).toBeTruthy();
    // Rodada do trabalho T2: o link abre a tarefa num pop-up aqui mesmo (?tarefa= na URL de Pendências).
    expect(within(item).getByRole('link').getAttribute('href')).toBe('?aba=atividade&tarefa=t-1');
  });

  it('Limpar tira o item da caixa e manda só o id dele', async () => {
    render(<CaixaPage />);
    fireEvent.click(await screen.findByTestId('caixa-limpar-auditoria:a1'));
    await waitFor(() => expect(screen.queryByTestId('caixa-item-auditoria:a1')).toBeNull());
    expect(apiPost).toHaveBeenCalledWith('/caixa/limpar', { ids: ['auditoria:a1'] }, 'tok');
    expect(screen.getByTestId('caixa-item-comentario:c1')).toBeTruthy();
    // O foco não cai no body: vai ao "Limpar" do item seguinte.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('caixa-limpar-comentario:c1')));
    // Limpo o último, o foco vai ao "Limpar tudo" (ou, desligado, ao topo da aba).
    fireEvent.click(screen.getByTestId('caixa-limpar-comentario:c1'));
    await waitFor(() => expect(screen.queryByTestId('caixa-item-comentario:c1')).toBeNull());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });

  it('Limpar tudo manda o instante da leitura e relê a caixa', async () => {
    render(<CaixaPage />);
    await screen.findByTestId('caixa-item-auditoria:a1');
    ATIVIDADE = atividade([]);
    fireEvent.click(screen.getByTestId('caixa-limpar-tudo'));
    await waitFor(() => expect(screen.getByText(/Nada novo nas suas tarefas/)).toBeTruthy());
    expect(apiPost).toHaveBeenCalledWith('/caixa/limpar', { tudo: true, ate: AGORA.toISOString() }, 'tok');
  });

  it('"ver também os já limpos" pede o histórico, e o limpo não tem botão', async () => {
    render(<CaixaPage />);
    await screen.findByTestId('caixa-item-auditoria:a1');
    ATIVIDADE = atividade([evento({ limpo: true })], { incluirLimpos: true });
    fireEvent.click(screen.getByTestId('caixa-incluir-limpos'));
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/caixa/atividade?incluirLimpos=1', 'tok'),
    );
    await waitFor(() => expect(screen.queryByTestId('caixa-item-comentario:c1')).toBeNull());
    expect(screen.queryByTestId('caixa-limpar-auditoria:a1')).toBeNull();
  });

  it('"mostrar o que eu fiz" vai na rota', async () => {
    render(<CaixaPage />);
    await screen.findByTestId('caixa-item-auditoria:a1');
    fireEvent.click(screen.getByTestId('caixa-incluir-meus'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/caixa/atividade?incluirMeus=1', 'tok'));
  });

  it('erro tem "tentar de novo", e tentar de novo relê', async () => {
    let falhar = true;
    apiGet.mockImplementation((caminho: string) => {
      if (caminho === '/caixa') return Promise.resolve(CAIXA);
      if (caminho.startsWith('/caixa/atividade')) {
        return falhar ? Promise.reject(new Error('API fora do ar')) : Promise.resolve(ATIVIDADE);
      }
      return Promise.resolve(TAREFAS);
    });
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/API fora do ar/)).toBeTruthy());
    falhar = false;
    fireEvent.click(screen.getAllByRole('button', { name: 'tentar de novo' })[0]);
    await screen.findByTestId('caixa-item-auditoria:a1');
  });

  it('módulo desligado é explicado, não escondido', async () => {
    ATIVIDADE = atividade([], { estado: 'modulo_desligado' });
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/não está contratado/)).toBeTruthy());
  });
});

describe('P1: a aba Minhas tarefas', () => {
  it('mostra nome, lista, status, vencimento, responsável e comentários', async () => {
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    const linha = await screen.findByTestId('caixa-tarefa-t-9');
    expect(within(linha).getByText('Revisar contrato da Ana')).toBeTruthy();
    expect(within(linha).getByText('Operacional')).toBeTruthy();
    expect(within(linha).getByText('Em andamento')).toBeTruthy();
    // Layout 26/10: o motivo e os comentários numa linha curta embaixo do nome.
    expect(within(linha).getByTestId('caixa-motivos-t-9')).toHaveTextContent('prazo vencido · 2 comentários');
    // I6 (produção 22B): o responsável é o avatar, o nome no balão (a célula da Lista do Trabalho).
    const resp = within(linha).getByTestId('trabalho-responsaveis-t-9');
    expect(within(resp).getByRole('img', { name: /Responsável: Pedro/ })).toBeTruthy();
    expect(resp).not.toHaveTextContent('Pedro');
  });

  it('I6: com mais de um responsável, um avatar por conta (a principal primeiro)', async () => {
    TAREFAS = [{ ...TAREFA, assigneeUserName: 'Pedro Magnago', outrosResponsaveisIds: ['u-2'] }];
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    const resp = await screen.findByTestId('trabalho-responsaveis-t-9');
    expect(within(resp).getAllByRole('img').map((a) => a.getAttribute('aria-label'))).toEqual([
      expect.stringContaining('Responsável: Pedro Magnago'),
      expect.stringContaining('Responsável: Lucas Fernandes'),
    ]);
  });

  it('os filtros de vencimento e de lista filtram o que chegou; o responsável muda a consulta', async () => {
    TAREFAS = [TAREFA, { ...TAREFA, id: 't-8', title: 'Pagar fornecedor', listId: 'l-2', listName: 'Interno', statusId: 's2-aberta', statusName: 'Aberta', statusType: 'open', dueDate: null, overdue: false, comments: 0 }];
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    await screen.findByTestId('caixa-tarefa-t-8');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/trabalho\/tarefas\?assigneeUserId=u-eu&/), 'tok'));
    fireEvent.change(screen.getByTestId('caixa-filtro-vencimento'), { target: { value: 'vencidas' } });
    expect(screen.queryByTestId('caixa-tarefa-t-8')).toBeNull();
    expect(screen.getByTestId('caixa-tarefa-t-9')).toBeTruthy();
    fireEvent.change(screen.getByTestId('caixa-filtro-vencimento'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('caixa-filtro-lista'), { target: { value: 'lista:l-2' } });
    expect(screen.queryByTestId('caixa-tarefa-t-9')).toBeNull();
    expect(screen.getByTestId('caixa-tarefa-t-8')).toBeTruthy();
    fireEvent.change(screen.getByTestId('caixa-filtro-lista'), { target: { value: 'pasta:p-1' } });
    expect(screen.getByTestId('caixa-tarefa-t-9')).toBeTruthy();
    fireEvent.change(screen.getByTestId('caixa-filtro-responsavel'), { target: { value: 'qualquer' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/trabalho\/tarefas\?todas=1&/), 'tok'));
  });

  it('a tabela é a Lista do Trabalho, com a caixa de seleção e as colunas dela', async () => {
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    await screen.findByTestId('caixa-tarefa-t-9');
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent?.replace(/ [↑↓]$/, ''))).toEqual([
      '', 'Tarefa', 'Lista', 'Cliente', 'Status', 'Prioridade', 'Responsável', 'Agente', 'Prazo',
    ]);
    expect(screen.getByTestId('trabalho-selecionar-t-9')).toBeTruthy();
  });

  it('o clique na linha abre o pop-up da tarefa, sem sair da tela', async () => {
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    fireEvent.click(await screen.findByTestId('caixa-tarefa-t-9'));
    expect(await screen.findByTestId('tarefa-popup')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBe('t-9');
    expect(apiGet).toHaveBeenCalledWith('/trabalho/tarefas/t-9', 'tok');
    // A tabela continua ali: não saiu da tela.
    expect(screen.getByTestId('caixa-tarefa-t-9')).toBeTruthy();
  });

  it('sem tarefas, a frase diz isso', async () => {
    TAREFAS = [];
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    await waitFor(() => expect(screen.getByText(/Nenhuma tarefa aberta com você/)).toBeTruthy());
  });
});
