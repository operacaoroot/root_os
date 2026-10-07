import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * ==========================================================================
 * A ESTEIRA DE CLIENTES NO QUADRO — limite, idade, horas e arraste
 * ==========================================================================
 *
 * A regra de negócio (carimbo de etapa, soma, quem apaga) tem suíte na api —
 * `test/esteira-de-clientes.test.ts`. Aqui se cobra o que só a TELA pode errar:
 *
 *  1. O LIMITE APARECE no cabeçalho da coluna, e acima dele fica marcado.
 *  2. A IDADE só aparece quando a data existe, e não em etapa fechada.
 *  3. AS HORAS aparecem no cartão e na gaveta; "1,5" vira 90 minutos na API.
 *  4. SÓ O AUTOR vê o botão de apagar um lançamento.
 *  5. ARRASTAR o cartão para outra coluna move a etapa pelo PATCH de sempre.
 *  6. O MODELO cria a lista pela rota de modelo.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const apiBlob = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
    apiBlob: (...a: unknown[]) => apiBlob(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Rodrigo', email: 'r@x.com', roles: [], permissions: ['tarefas.ver', 'tarefas.editar'] },
    can: (p: string) => ['tarefas.ver', 'tarefas.editar'].includes(p),
  }),
}));

// eslint-disable-next-line import/first
import TrabalhoPage from '@/app/trabalho/page';

/* --------------------------------------------------------------- fixtures -- */

const PASTA = { id: 'f-1', name: 'Comercial', order: 0, lists: [] as unknown[] };

const ESTEIRA = {
  id: 'l-esteira',
  name: 'Esteira de clientes',
  order: 0,
  externalId: null,
  total: 4,
  statuses: [
    { id: 's-diag', name: 'Diagnóstico', type: 'custom', color: '#4194f6', order: 0, total: 1, limite: null },
    { id: 's-impl', name: 'Implantação', type: 'custom', color: '#ff7800', order: 1, total: 3, limite: 2 },
    { id: 's-onb', name: 'Onboarding', type: 'custom', color: '#f9d900', order: 2, total: 0, limite: 3 },
    { id: 's-fim', name: 'Encerrado', type: 'closed', color: '#6b7280', order: 3, total: 1, limite: null },
  ],
  fields: [],
};

function tarefa(over: Record<string, unknown> = {}) {
  return {
    id: 't-1', listId: 'l-esteira', title: 'ProMedical', updatedAt: '2026-09-17T10:00:00.000Z',
    statusId: 's-impl', statusName: 'Implantação', statusType: 'custom', statusColor: '#ff7800',
    priority: 'normal', assignee: 'Rodrigo',
    agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null,
    statusDesde: null, minutos: 0,
    dueDate: null, startDate: null, overdue: false,
    parentId: null, subtasks: 0, comments: 0,
    externalId: null, externalUrl: null, archived: false, order: 0,
    tags: [], values: [],
    ...over,
  };
}

const ITENS = [
  tarefa({ id: 't-pro', title: 'ProMedical', statusDesde: new Date(Date.now() - 12 * 86_400_000).toISOString(), minutos: 90 }),
  tarefa({ id: 't-bsb', title: 'Cliente BSB' }),
  tarefa({ id: 't-cart', title: 'Cartório', minutos: 600 }),
  tarefa({ id: 't-sol', title: 'Soberana', statusId: 's-diag', statusName: 'Diagnóstico' }),
  tarefa({
    id: 't-fim', title: 'Cliente encerrado', statusId: 's-fim', statusName: 'Encerrado', statusType: 'closed',
    statusDesde: new Date(Date.now() - 40 * 86_400_000).toISOString(),
  }),
];

function servir(itens = ITENS, detalhe: Record<string, unknown> = {}, listas = [ESTEIRA]) {
  apiGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/estrutura')) {
      return Promise.resolve({
        folders: [PASTA], listasSoltas: listas, camposGlobais: [], tags: [], responsaveis: ['Rodrigo'], agentes: [],
      });
    }
    if (rota.startsWith('/trabalho/tarefas?')) {
      return Promise.resolve({ items: itens, total: itens.length, source: { tool: 'trabalho-interno', generatedAt: '2026-09-17T12:00:00.000Z' } });
    }
    const id = rota.replace('/trabalho/tarefas/', '');
    const achada = itens.find((t) => t.id === id) ?? itens[0];
    return Promise.resolve({
      ...achada,
      description: null, listName: ESTEIRA.name,
      createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z',
      comentarios: [], atividade: [], filhos: [],
      apontamentos: [], minutosPorEtapa: [],
      ...detalhe,
    });
  });
}

const coluna = (statusId: string) => document.querySelector(`[data-coluna="${statusId}"]`) as HTMLElement;
const cartao = (titulo: string) => screen.getByText(titulo).closest('div.rounded-lg') as HTMLElement;

beforeEach(() => {
  window.history.replaceState({}, '', '/trabalho');
  vi.clearAllMocks();
  apiPost.mockResolvedValue({ ok: true });
  apiPatch.mockResolvedValue({ ok: true });
  apiDelete.mockResolvedValue({ ok: true });
});

describe('trabalho importado: card único e material preservado', () => {
  it('avisa quando a lista do link está ausente, sem abrir outra lista por engano', async () => {
    servir();
    window.history.replaceState({}, '', '/trabalho?lista=901328341450');
    render(<TrabalhoPage />);
    expect(await screen.findByText(/A lista deste link ainda não está disponível/)).toBeTruthy();
    expect(apiGet.mock.calls.some(([rota]) => String(rota).startsWith('/trabalho/tarefas?'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /Esteira de clientes/ }));
    expect(await screen.findByText('ProMedical')).toBeTruthy();
    expect(screen.queryByText(/A lista deste link ainda não está disponível/)).toBeNull();
  });

  it('mantém o foco no painel e devolve ao card quando Escape fecha', async () => {
    servir([tarefa({ id: 't-1', title: 'ROOT-001' })]);
    render(<TrabalhoPage />);
    const abrir = await screen.findByRole('button', { name: 'ROOT-001' });
    await userEvent.click(abrir);
    const painel = await screen.findByRole('dialog', { name: 'Detalhes da tarefa' });
    await waitFor(() => expect(document.activeElement).toBe(within(painel).getByRole('button', { name: 'Fechar tarefa' })));
    const ultimo = within(painel).getByRole('button', { name: 'Enviar' });
    ultimo.focus();
    await userEvent.tab();
    expect(painel.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(abrir));
  });

  it('abre deeplink nativo e move o mesmo card para outra lista pelo PATCH', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const outra = { ...ESTEIRA, id: 'l-destino', name: 'Design & Gravação' };
    const card = tarefa({ id, title: 'ROOT-001', externalId: 'root-001' });
    servir([card], {}, [ESTEIRA, outra]);
    // A leitura após o PATCH deve refletir a lista persistida.
    apiPatch.mockImplementation((_rota: string, mudanca: Record<string, unknown>) => {
      Object.assign(card, mudanca);
      return Promise.resolve(card);
    });
    window.history.replaceState({}, '', `/trabalho?lista=l-esteira&tarefa=${id}`);
    render(<TrabalhoPage />);
    const painel = await screen.findByDisplayValue('ROOT-001');
    const gaveta = painel.closest('.fixed') as HTMLElement;
    await userEvent.selectOptions(within(gaveta).getByLabelText(/^Lista/), 'l-destino');
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(`/trabalho/tarefas/${id}`, { listId: 'l-destino', expectedUpdatedAt: '2026-09-17T10:00:00.000Z' }, 'tok'));
    expect(apiPost).not.toHaveBeenCalledWith('/trabalho/tarefas', expect.anything(), 'tok');
    await waitFor(() => expect(window.location.search).toBe(`?lista=l-destino&tarefa=${id}`));
  });

  it('mostra o pacote legível e baixa anexo preservado com Bearer pela API', async () => {
    servir([tarefa({ id: 't-1', title: 'ROOT-001' })], {
      description: 'Pacote v1 aprovado\n\nPróxima ação: gravar.\n\nAnexos preservados\n- [pacote.pdf](/api/trabalho/arquivos/root-001/a1)',
    });
    apiBlob.mockResolvedValue(new Blob(['arquivo']));
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:qa') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    render(<TrabalhoPage />);
    await userEvent.click(await screen.findByText('ROOT-001'));
    expect(await screen.findByText(/Pacote v1 aprovado/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Baixar pacote.pdf' }));
    await waitFor(() => expect(apiBlob).toHaveBeenCalledWith('/trabalho/arquivos/root-001/a1', 'tok'));
    clique.mockRestore();
  });

  it('mantém o anexo visível e seu link ao editar descrição inicialmente vazia', async () => {
    const sufixo = 'Anexos preservados\n- [pacote.pdf](/api/trabalho/arquivos/root-001/a1)';
    servir([tarefa({ id: 't-1', title: 'ROOT-001' })], { description: sufixo });
    render(<TrabalhoPage />);
    await userEvent.click(await screen.findByText('ROOT-001'));
    expect(screen.getByRole('button', { name: 'Baixar pacote.pdf' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Editar texto' }));
    const textarea = document.querySelector('textarea[rows="12"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
    fireEvent.change(textarea, { target: { value: 'Pacote vigente' } });
    fireEvent.blur(textarea);
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/trabalho/tarefas/t-1', {
      expectedUpdatedAt: '2026-09-17T10:00:00.000Z',
      description: `Pacote vigente\n\n${sufixo}`,
    }, 'tok'));
  });

  it('mostra dependência com link para o card nativo e preserva a relação ao editar texto', async () => {
    const destino = '11111111-1111-4111-8111-111111111111';
    const secao = `Dependências preservadas\n- depende de: [ROOT-002](/trabalho?lista=901328341442&tarefa=${destino})`;
    servir([tarefa({ id: 't-1', title: 'ROOT-001' })], { description: `Contexto\n\n${secao}` });
    render(<TrabalhoPage />);
    await userEvent.click(await screen.findByText('ROOT-001'));
    const link = screen.getByRole('link', { name: 'ROOT-002' });
    expect(link.getAttribute('href')).toBe(`/trabalho?lista=901328341442&tarefa=${destino}`);
    await userEvent.click(screen.getByRole('button', { name: 'Editar texto' }));
    const textarea = document.querySelector('textarea[rows="12"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Contexto');
    fireEvent.change(textarea, { target: { value: 'Contexto atualizado' } });
    fireEvent.blur(textarea);
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/trabalho/tarefas/t-1', {
      expectedUpdatedAt: '2026-09-17T10:00:00.000Z',
      description: `Contexto atualizado\n\n${secao}`,
    }, 'tok'));
  });
});

/* ------------------------------------------------------------- 1. limite -- */

describe('esteira: o limite da etapa no cabeçalho da coluna', () => {
  it('acima do limite aparece "3/2" marcado; no limite, cheia; sem limite, só o número', async () => {
    servir();
    render(<TrabalhoPage />);
    await waitFor(() => cartao('ProMedical'));

    const impl = within(coluna('s-impl')).getByText('3/2');
    expect(impl.getAttribute('data-estado-limite')).toBe('passou');
    expect(impl.getAttribute('title')).toMatch(/Acima do limite/);

    expect(within(coluna('s-onb')).getByText('0/3').getAttribute('data-estado-limite')).toBe('folga');
    // Diagnóstico sem limite: número puro, sem barra.
    expect(within(coluna('s-diag')).getByText('1')).toBeTruthy();
    expect(within(coluna('s-diag')).queryByText(/\//)).toBeNull();
  });
});

/* ------------------------------------------------------ 2. idade e horas -- */

describe('esteira: idade e horas no cartão', () => {
  it('mostra a idade na etapa e as horas apontadas', async () => {
    servir();
    render(<TrabalhoPage />);
    const c = await waitFor(() => cartao('ProMedical'));
    expect(within(c).getByText('12d na etapa')).toBeTruthy();
    expect(within(c).getByText('1h30')).toBeTruthy();
    expect(within(cartao('Cartório')).getByText('10h')).toBeTruthy();
  });

  it('sem data não há idade, e etapa fechada não envelhece', async () => {
    servir();
    render(<TrabalhoPage />);
    await waitFor(() => cartao('Cliente BSB'));
    expect(within(cartao('Cliente BSB')).queryByText(/na etapa/)).toBeNull();
    expect(within(cartao('Cliente encerrado')).queryByText(/na etapa/)).toBeNull();
  });
});

/* ------------------------------------------------------ 3. horas na gaveta -- */

describe('esteira: apontar horas na gaveta', () => {
  it('"1,5" vira 90 minutos na API, e o botão diz quanto e em qual etapa', async () => {
    servir();
    render(<TrabalhoPage />);
    await userEvent.click(await screen.findByText('Cliente BSB'));

    const horas = await screen.findByRole('textbox', { name: 'Horas gastas' });
    await userEvent.type(horas, '1,5');
    await userEvent.type(screen.getByRole('textbox', { name: 'O que foi feito' }), 'Instalação do MCP');

    const secao = document.querySelector('[data-secao="horas"]') as HTMLElement;
    expect(within(secao).getByText('Entra na etapa Implantação.')).toBeTruthy();
    await userEvent.click(within(secao).getByRole('button', { name: 'Apontar 1h30' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const [rota, corpo] = apiPost.mock.calls[0];
    expect(rota).toBe('/trabalho/tarefas/t-bsb/apontamentos');
    expect(corpo).toMatchObject({ minutos: 90, nota: 'Instalação do MCP' });
    expect(corpo.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('hora inválida não habilita o botão e diz o porquê', async () => {
    servir();
    render(<TrabalhoPage />);
    await userEvent.click(await screen.findByText('Cliente BSB'));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Horas gastas' }), '30');

    const secao = document.querySelector('[data-secao="horas"]') as HTMLElement;
    expect(within(secao).getByText('Hora inválida: de 1 minuto a 24h.')).toBeTruthy();
    expect((within(secao).getByRole('button', { name: 'Apontar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('mostra total e soma por etapa, e só o AUTOR vê apagar', async () => {
    servir(ITENS, {
      minutos: 135,
      minutosPorEtapa: [{ etapa: 'Diagnóstico', minutos: 60 }, { etapa: 'Implantação', minutos: 75 }],
      apontamentos: [
        { id: 'a-meu', autorId: 'u-eu', autorNome: 'Rodrigo', minutos: 30, dia: '2026-09-16', etapa: 'Implantação', nota: null, createdAt: '2026-09-16T20:00:00Z' },
        { id: 'a-dele', autorId: 'u-pedro', autorNome: 'Pedro', minutos: 45, dia: '2026-09-15', etapa: 'Implantação', nota: 'VPS', createdAt: '2026-09-15T20:00:00Z' },
      ],
    });
    render(<TrabalhoPage />);
    await userEvent.click(await screen.findByText('ProMedical'));

    const secao = await waitFor(() => {
      const s = document.querySelector('[data-secao="horas"]');
      if (!s) throw new Error('gaveta ainda não abriu');
      return s as HTMLElement;
    });
    await waitFor(() => expect(within(secao).getByText('2h15')).toBeTruthy());
    expect(within(secao).getByText('1h')).toBeTruthy(); // Diagnóstico
    expect(within(secao).getByRole('button', { name: /Apagar 30min/ })).toBeTruthy();
    expect(within(secao).queryByRole('button', { name: /Apagar 45min/ })).toBeNull();

    await userEvent.click(within(secao).getByRole('button', { name: /Apagar 30min/ }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/trabalho/apontamentos/a-meu', 'tok'));
  });
});

/* -------------------------------------------------------------- 4. arraste -- */

describe('esteira: arrastar e soltar', () => {
  function dataTransfer() {
    const dados: Record<string, string> = {};
    return {
      setData: (k: string, v: string) => { dados[k] = v; },
      getData: (k: string) => dados[k] ?? '',
      effectAllowed: 'all',
      dropEffect: 'move',
    };
  }

  it('soltar o cartão noutra coluna move a etapa pelo PATCH de sempre', async () => {
    servir();
    render(<TrabalhoPage />);
    const c = await waitFor(() => cartao('Soberana'));
    const dt = dataTransfer();
    fireEvent.dragStart(c, { dataTransfer: dt });
    fireEvent.dragOver(coluna('s-impl'), { dataTransfer: dt });
    fireEvent.drop(coluna('s-impl'), { dataTransfer: dt });
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/trabalho/tarefas/t-sol', { statusId: 's-impl', expectedUpdatedAt: '2026-09-17T10:00:00.000Z' }, 'tok'));
  });

  it('soltar na própria coluna não chama a API', async () => {
    servir();
    render(<TrabalhoPage />);
    const c = await waitFor(() => cartao('Soberana'));
    const dt = dataTransfer();
    fireEvent.dragStart(c, { dataTransfer: dt });
    fireEvent.drop(coluna('s-diag'), { dataTransfer: dt });
    expect(apiPatch).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------------------- 5. modelo -- */

describe('esteira: criar a lista pelo modelo', () => {
  it('o botão do modelo chama a rota de modelo, na pasta escolhida', async () => {
    servir();
    render(<TrabalhoPage />);
    await waitFor(() => cartao('ProMedical'));

    await userEvent.click(screen.getByRole('button', { name: /nova lista/i }));
    // Pela descrição: "Esteira de clientes" também nomeia a lista na árvore.
    await userEvent.click(screen.getByRole('button', { name: /Da qualificação à operação/ }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/trabalho/listas/modelo', { modelo: 'esteira-de-clientes', folderId: 'f-1', name: undefined }, 'tok'),
    );
  });
});
