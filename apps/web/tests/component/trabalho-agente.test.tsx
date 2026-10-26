import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * ==========================================================================
 * O QUADRO DIZ QUAL AGENTE ESTÁ COM A TAREFA — fatia A4
 * ==========================================================================
 *
 * A parte de baixo (o checkout atômico, o 409, a soltura) tem suíte na api —
 * `test/checkout-de-tarefa.test.ts`. Aqui se cobra o que só a TELA pode errar:
 *
 *  1. O DONO APARECE. Tarefa travada mostra o nome do agente no cartão e na
 *     tabela; tarefa livre mostra que está livre, e as duas coisas são visíveis
 *     sem abrir a gaveta.
 *  2. OS DOIS EIXOS NÃO SE CONFUNDEM. "Responsável (pessoa)" e "Agente
 *     executor" são campos diferentes, com rótulos diferentes — a tela não
 *     publica o agente como se fosse o responsável humano.
 *  3. ENTREGAR NÃO É EDITAR CAMPO. A tela chama `POST /assumir`, não um `PATCH`
 *     com `agenteId` — um PATCH seria a escrita sem corrida que a fatia proíbe.
 *  4. AGENTE QUE NÃO TRABALHA VEM DESABILITADO E DIZ POR QUÊ, antes do clique.
 *  5. O 409 APARECE COMO VEIO, com o nome de quem ficou com a tarefa. Trocar a
 *     frase por "não foi possível" apagaria a única informação útil dela.
 *  6. PONTEIRO QUE NÃO RESOLVE VIRA "outro agente", não nome inventado nem
 *     espaço vazio.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
  };
});

let PERMISSOES: string[] = ['tarefas.ver', 'tarefas.editar'];

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import TrabalhoPage from '@/app/trabalho/page';

/* --------------------------------------------------------------- fixtures -- */

const LISTA = {
  id: 'l-1',
  name: 'Fechamento',
  order: 0,
  externalId: null,
  total: 2,
  statuses: [
    { id: 's-1', name: 'A fazer', type: 'open', color: '#87909e', order: 0, total: 2 },
    { id: 's-2', name: 'Em andamento', type: 'custom', color: '#f9d900', order: 1, total: 0 },
  ],
  fields: [],
};

function agente(over: Record<string, unknown> = {}) {
  return {
    id: 'ag-1',
    slug: 'analista',
    nome: 'Analista de dados',
    iniciais: 'AD',
    estado: 'ativo',
    podeAssumir: true,
    tarefas: 0,
    ...over,
  };
}

function estrutura(agentes = [agente()]) {
  return {
    folders: [],
    listasSoltas: [LISTA],
    camposGlobais: [],
    tags: [],
    responsaveis: ['Lucas'],
    agentes,
  };
}

function tarefa(over: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    listId: 'l-1',
    title: 'Conciliar cartão',
    statusId: 's-1',
    statusName: 'A fazer',
    statusType: 'open',
    statusColor: '#87909e',
    priority: 'normal',
    assignee: 'Lucas',
    assigneeUserId: 'u-lucas', assigneeUserName: 'Lucas', assigneeUserEmail: 'lucas@qa.local', assigneeUserIsActive: true,
    agenteId: null,
    agenteSlug: null,
    agenteNome: null,
    agenteEm: null,
    dueDate: null,
    startDate: null,
    overdue: false,
    parentId: null,
    subtasks: 0,
    comments: 0,
    externalId: null,
    externalUrl: null,
    archived: false,
    order: 0,
    tags: [],
    values: [],
    ...over,
  };
}

const TRAVADA = tarefa({
  id: 't-travada',
  title: 'Fechar o mês',
  agenteId: 'ag-1',
  agenteSlug: 'analista',
  agenteNome: 'Analista de dados',
  agenteEm: '2026-09-14T12:00:00.000Z',
});

/** Responde `/trabalho/estrutura` e `/trabalho/tarefas` com o que o caso pede. */
function servir(itens: Record<string, unknown>[], agentes = [agente()]) {
  apiGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/estrutura')) return Promise.resolve(estrutura(agentes));
    if (rota.startsWith('/trabalho/tarefas?')) {
      return Promise.resolve({
        items: itens,
        total: itens.length,
        source: { tool: 'trabalho-interno', generatedAt: '2026-09-14T12:00:00.000Z' },
      });
    }
    // detalhe da tarefa (gaveta)
    const id = rota.replace('/trabalho/tarefas/', '');
    const achada = itens.find((t) => t.id === id) ?? itens[0];
    return Promise.resolve({
      ...achada,
      description: null,
      listName: LISTA.name,
      createdAt: '2026-09-14T10:00:00.000Z',
      updatedAt: '2026-09-14T10:00:00.000Z',
      comentarios: [],
      atividade: [],
      filhos: [],
    });
  });
}

const cartao = (titulo: string) =>
  screen.getByText(titulo).closest('div.rounded-lg') as HTMLElement;

beforeEach(() => {
  // Rodada da implantação I2: entregar e soltar ficam no cartão a partir da densidade média (o selo do agente aparece em todas).
  window.localStorage.setItem('root-os:trabalho:densidade', 'medio');
  window.history.replaceState({}, '', '/trabalho');
  vi.clearAllMocks();
  PERMISSOES = ['tarefas.ver', 'tarefas.editar'];
  apiPost.mockResolvedValue({ ok: true });
  apiPatch.mockResolvedValue({ ok: true });
});

/* ------------------------------------------------------- 1. o dono aparece -- */

describe('A4: o quadro mostra qual agente está com a tarefa', () => {
  it('o cartão da tarefa travada nomeia o agente e diz desde quando', async () => {
    servir([TRAVADA]);
    render(<TrabalhoPage />);

    const c = await waitFor(() => cartao('Fechar o mês'));
    expect(within(c).getByText('Analista de dados')).toBeTruthy();
    /* "desde quando" responde "isto está parado?" sem abrir a gaveta. */
    expect(within(c).getByTitle(/Assumida por Analista de dados em/)).toBeTruthy();
  });

  it('a tarefa LIVRE não finge dono — ela oferece a entrega', async () => {
    servir([tarefa()]);
    render(<TrabalhoPage />);

    const c = await waitFor(() => cartao('Conciliar cartão'));
    /*
     * Pelo SELO, não pelo texto "Analista de dados": esse nome também aparece
     * como `<option>` do seletor de entrega, e procurá-lo solto acusaria dono
     * onde não há.
     */
    expect(within(c).queryByTitle(/^Assumida por/)).toBeNull();
    expect(within(c).getByRole('combobox', { name: /Entregar a um agente/i })).toBeTruthy();
  });

  it('a tabela tem coluna de Agente SEPARADA da de Responsável', async () => {
    servir([TRAVADA]);
    render(<TrabalhoPage />);
    await waitFor(() => cartao('Fechar o mês'));

    await userEvent.click(screen.getByRole('button', { name: 'Lista' }));
    /*
     * As duas colunas ao mesmo tempo é o caso: uma coluna só faria "quem
     * responde" e "quem executa" parecerem a mesma pergunta.
     */
    expect(screen.getByRole('columnheader', { name: 'Responsável' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Agente' })).toBeTruthy();
    const linha = screen.getByText('Fechar o mês').closest('tr') as HTMLElement;
    // I6 (produção 22B): o responsável é só o avatar; o nome e o e-mail vão no balão e no nome acessível.
    expect(within(linha).getByRole('img', { name: 'Responsável: Lucas' })).toHaveAttribute('title', 'Responsável: Lucas');
    expect(within(linha).getByText('Analista de dados')).toBeTruthy();
  });

  it('ponteiro que não resolve vira "outro agente" — nunca nome inventado', async () => {
    /*
     * A API manda `agenteId` com nome nulo quando o agente não é desta empresa
     * (ver `work/agentes-da-casa.ts`). A tela tem de dizer que está travada.
     */
    servir([
      tarefa({ id: 't-x', title: 'Travada por quem?', agenteId: 'ag-de-outra', agenteSlug: null, agenteNome: null }),
    ]);
    render(<TrabalhoPage />);

    const c = await waitFor(() => cartao('Travada por quem?'));
    expect(within(c).getByText('outro agente')).toBeTruthy();
  });
});

/* -------------------------------------------- 2. entregar passa pelo checkout */

describe('A4: entregar a tarefa passa pelo CHECKOUT, não por edição de campo', () => {
  it('escolher o agente chama POST /assumir — e nenhum PATCH com agenteId', async () => {
    servir([tarefa()]);
    render(<TrabalhoPage />);

    const c = await waitFor(() => cartao('Conciliar cartão'));
    await userEvent.selectOptions(
      within(c).getByRole('combobox', { name: /Entregar a um agente/i }),
      'analista',
    );

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas/t-1/assumir', { agente: 'analista' }, 'tok'),
    );
    /*
     * A TRAVA: um `PATCH { agenteId }` gravaria por cima do dono atual e
     * devolveria sucesso — dois agentes na mesma tarefa. Se alguém trocar o
     * caminho por edição de campo, este caso fica vermelho.
     */
    for (const chamada of apiPatch.mock.calls) {
      expect(JSON.stringify(chamada[1])).not.toContain('agenteId');
    }
  });

  it('soltar chama POST /soltar, e aparece só quando há agente', async () => {
    servir([TRAVADA]);
    render(<TrabalhoPage />);

    const c = await waitFor(() => cartao('Fechar o mês'));
    await userEvent.click(within(c).getByRole('button', { name: /Soltar/i }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas/t-travada/soltar', {}, 'tok'),
    );
  });

  it('o 409 aparece COMO VEIO, com o nome de quem ficou com a tarefa', async () => {
    servir([tarefa()]);
    apiPost.mockRejectedValue(
      new Error('Esta tarefa já está com o agente "Redator" desde 14/09/2026, 09:00:00.'),
    );
    render(<TrabalhoPage />);

    const c = await waitFor(() => cartao('Conciliar cartão'));
    await userEvent.selectOptions(
      within(c).getByRole('combobox', { name: /Entregar a um agente/i }),
      'analista',
    );

    expect(await screen.findByText(/já está com o agente "Redator"/)).toBeTruthy();
  });
});

/* ------------------------------------ 3. a tela diz a regra ANTES do clique -- */

describe('A4: a tela diz antes do clique quem pode receber trabalho', () => {
  it('agente pausado aparece DESABILITADO e com o estado escrito', async () => {
    servir([tarefa()], [
      agente(),
      agente({ id: 'ag-2', slug: 'redator', nome: 'Redator', estado: 'pausado', podeAssumir: false }),
    ]);
    render(<TrabalhoPage />);

    const c = await waitFor(() => cartao('Conciliar cartão'));
    const seletor = within(c).getByRole('combobox', { name: /Entregar a um agente/i });
    const pausado = within(seletor).getByRole('option', { name: /Redator/ }) as HTMLOptionElement;
    /*
     * Aparece (esconder faria a pessoa procurar um agente que existe), mas
     * desabilitado e dizendo por quê — em vez de deixá-la descobrir pelo 409.
     */
    expect(pausado.disabled).toBe(true);
    expect(pausado.textContent).toMatch(/pausado, não assume/);
  });

  it('empresa sem agente nenhum diz isso, em vez de um seletor vazio', async () => {
    servir([tarefa()], []);
    render(<TrabalhoPage />);

    const c = await waitFor(() => cartao('Conciliar cartão'));
    expect(within(c).getByText('Nenhum agente nesta empresa')).toBeTruthy();
  });

  it('sem permissão de editar, nem o seletor nem o botão de soltar existem', async () => {
    PERMISSOES = ['tarefas.ver'];
    servir([TRAVADA]);
    render(<TrabalhoPage />);

    const c = await waitFor(() => cartao('Fechar o mês'));
    /* O NOME continua visível: quem só lê o quadro precisa saber de quem é. */
    expect(within(c).getByText('Analista de dados')).toBeTruthy();
    expect(within(c).queryByRole('button', { name: /Soltar/i })).toBeNull();
    expect(within(c).queryByRole('combobox')).toBeNull();
  });
});

/* ----------------------------------------- 4. os dois eixos, na gaveta ------- */

describe('A4: a gaveta separa o responsável humano do agente executor', () => {
  it('os dois campos existem com rótulos diferentes, e o agente diz desde quando', async () => {
    servir([TRAVADA]);
    render(<TrabalhoPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Fechar o mês' }));
    expect(await screen.findByText('Responsável (pessoa)')).toBeTruthy();
    expect(screen.getByText('Agente executor')).toBeTruthy();
    expect(screen.getByText(/^desde /)).toBeTruthy();
  });

  it('tarefa livre diz "Livre" na gaveta, não um campo em branco', async () => {
    servir([tarefa()]);
    render(<TrabalhoPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Conciliar cartão' }));
    expect(await screen.findByText(/Livre — nenhum agente assumiu/)).toBeTruthy();
  });
});

/* ------------------------------------------ 5. o filtro por agente ---------- */

describe('A4: o filtro por agente é outro eixo', () => {
  it('filtrar por "sem agente" esconde as travadas, e por agente esconde as livres', async () => {
    servir([TRAVADA, tarefa()]);
    render(<TrabalhoPage />);
    await waitFor(() => cartao('Fechar o mês'));

    // Rodada da interface (U2): o filtro de agente mora no painel de "Filtros".
    await userEvent.click(screen.getByTestId('trabalho-filtros-botao'));
    await userEvent.selectOptions(screen.getByLabelText('Agente'), 'livres');
    expect(screen.queryByText('Fechar o mês')).toBeNull();
    expect(screen.getByText('Conciliar cartão')).toBeTruthy();

    await userEvent.selectOptions(screen.getByDisplayValue('Sem agente (livres)'), 'analista');
    expect(screen.getByText('Fechar o mês')).toBeTruthy();
    expect(screen.queryByText('Conciliar cartão')).toBeNull();
  });
});
