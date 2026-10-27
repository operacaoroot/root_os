import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const PERMS = ['tarefas.ver', 'tarefas.editar', 'leads.ver', 'leads.editar'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Rodrigo', email: 'r@x.com', roles: [], permissions: PERMS },
    can: (p: string) => PERMS.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import TrabalhoPage from '@/app/trabalho/page';
// eslint-disable-next-line import/first
import { esquecerNovaTarefaDaVisita } from '@/components/trabalho/NovaTarefaRapida';
// eslint-disable-next-line import/first
import { prazoDoDia } from '@/components/trabalho/CalendarioDeTarefas';
// eslint-disable-next-line import/first
import { hojeEmBrasilia } from '@/lib/horas';

/*
 * Layout 26/10 (Lucas):
 *  · a lista "Tarefas do comercial" aparece na pasta Comercial da árvore, sem renomear,
 *    excluir nem ícone pela árvore (o menu diz por quê);
 *  · a tarefa nova nela pede o LEAD (busca e "+ criar lead") e o cliente é fixo, o da casa;
 *  · o pop-up mostra o lead, com o link ao Funil, e troca ou tira o lead pelo PATCH;
 *  · a nova tarefa rápida (nome, responsável = eu, prazo, cliente) na Lista, no pé de cada
 *    grupo "Por prazo" (com o dia do grupo), no "+" do dia do Calendário e com seletor de
 *    lista quando a tela junta várias listas.
 */

const CLIENTE = '0a0a0a0a-0000-4000-8000-0000000000c1';
const LEAD = '0b0b0b0b-0000-4000-8000-0000000000a1';
const LEAD_NOVO = '0b0b0b0b-0000-4000-8000-0000000000a2';
const T_COM = '00000000-0000-4000-8000-0000000000c1';
const T_OPS = '00000000-0000-4000-8000-0000000000d1';
const ST_COM = [
  { id: 's-c1', name: 'A fazer', type: 'open', color: '#87909e', order: 0, total: 1, limite: null },
  { id: 's-c2', name: 'Feito', type: 'closed', color: '#30a46c', order: 1, total: 0, limite: null },
];
const ST_OPS = [
  { id: 's-o1', name: 'A fazer', type: 'open', color: '#87909e', order: 0, total: 1, limite: null },
  { id: 's-o2', name: 'Feito', type: 'closed', color: '#30a46c', order: 1, total: 0, limite: null },
];
const LCOM = { id: 'l-com', name: 'Tarefas do comercial', order: 0, externalId: 'comercial:tarefas', spaceId: null, total: 1, statuses: ST_COM, fields: [] };
const LOPS = { id: 'l-ops', name: 'Rotina', order: 0, externalId: null, spaceId: null, total: 1, statuses: ST_OPS, fields: [] };
const ESTRUTURA = {
  espacos: [],
  folders: [
    { id: 'f-com', name: 'Comercial', parentId: null, spaceId: null, externalId: null, order: 0, lists: [LCOM] },
    { id: 'f-ops', name: 'Operação', parentId: null, spaceId: null, externalId: null, order: 1, lists: [LOPS] },
  ],
  listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [],
  pessoas: [
    { id: 'u-eu', name: 'Rodrigo', email: 'r@x.com', isActive: true },
    { id: 'u-pedro', name: 'Pedro', email: 'p@x.com', isActive: true },
  ],
};

function tarefa(over: Record<string, unknown> = {}) {
  return {
    id: T_COM, listId: 'l-com', listName: 'Tarefas do comercial', title: 'Ligar para a padaria',
    statusId: 's-c1', statusName: 'A fazer', statusType: 'open', statusColor: '#87909e',
    priority: 'normal', assignee: null, assigneeUserId: null, agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null,
    statusDesde: null, minutos: 0, dueDate: null, startDate: null, overdue: false, parentId: null, subtasks: 0, comments: 0,
    externalId: null, externalUrl: null, archived: false, order: 0, tags: [], values: [],
    clienteId: 'p-casa', clienteNome: 'Root (interno)', updatedAt: '2026-10-26T10:00:00.000Z', ...over,
  };
}
const DA_COMERCIAL = tarefa();
const DA_ROTINA = tarefa({ id: T_OPS, listId: 'l-ops', listName: 'Rotina', title: 'Pagar o contador', statusId: 's-o1', clienteId: CLIENTE, clienteNome: 'Construtora Alicerce' });
let detalheLead: { id: string; nome: string; empresa: string | null } | null = { id: LEAD, nome: 'Ana', empresa: 'Padaria Lua' };

beforeEach(() => {
  vi.clearAllMocks();
  esquecerNovaTarefaDaVisita();
  window.localStorage.clear();
  window.localStorage.setItem('root-os:trabalho:densidade', 'medio');
  window.history.replaceState(null, '', '/trabalho');
  detalheLead = { id: LEAD, nome: 'Ana', empresa: 'Padaria Lua' };
  apiGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/estrutura')) return Promise.resolve(ESTRUTURA);
    if (rota.startsWith('/organograma/equipe')) return Promise.reject(new Error('sem equipe'));
    if (rota.startsWith('/trabalho/clientes')) return Promise.resolve([{ id: 'p-casa', nome: 'Root (interno)', cnpj: null, interno: true }, { id: CLIENTE, nome: 'Construtora Alicerce', cnpj: null, interno: false }]);
    if (rota.startsWith('/trabalho/atas/alvos?tipo=cliente')) return Promise.resolve([]);
    if (rota.startsWith('/trabalho/atas/alvos')) return Promise.resolve([{ tipo: 'lead', id: LEAD, nome: 'Ana', detalhe: 'Padaria Lua' }]);
    if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve({ itens: [] });
    if (rota.startsWith('/trabalho/tarefas?')) {
      const q = new URLSearchParams(rota.split('?')[1]);
      const items = q.get('listId') === 'l-com' ? [DA_COMERCIAL] : q.get('listId') === 'l-ops' ? [DA_ROTINA] : [DA_COMERCIAL, DA_ROTINA];
      return Promise.resolve({ items, total: items.length, source: { tool: 'trabalho-interno', generatedAt: '2026-10-26T12:00:00.000Z' } });
    }
    if (rota.startsWith('/tenants/onboarding/trilhos')) return Promise.resolve([]);
    const id = rota.slice('/trabalho/tarefas/'.length);
    const achada = [DA_COMERCIAL, DA_ROTINA].find((t) => t.id === id) ?? DA_COMERCIAL;
    return Promise.resolve({
      ...achada, description: null, createdAt: '2026-10-01T10:00:00.000Z', comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [],
      lead: achada.id === T_COM ? detalheLead : null,
    });
  });
  apiPost.mockImplementation((rota: string) => Promise.resolve(rota === '/leads/entrada' ? { id: LEAD_NOVO } : {}));
  apiPatch.mockResolvedValue({});
});

const escolherCliente = async (onde: HTMLElement) => {
  fireEvent.focus(within(onde).getByRole('combobox'));
  fireEvent.mouseDown(await screen.findByTestId(`opcao-cliente-${CLIENTE}`));
};

describe('Layout 26/10: a lista "Tarefas do comercial" no Trabalho', () => {
  it('aparece dentro da pasta Comercial; renomear e excluir dizem por quê, e não há "Ícone e cor"', async () => {
    render(<TrabalhoPage />);
    const pasta = await screen.findByTestId('trabalho-arvore-no-f-com');
    expect(within(pasta).getByTestId('trabalho-arvore-lista-l-com')).toHaveTextContent('Tarefas do comercial');
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-com'));
    expect(screen.getByTestId('trabalho-lista-acoes-l-com-renomear')).toBeDisabled();
    expect(screen.getByTestId('trabalho-lista-acoes-l-com-excluir')).toBeDisabled();
    expect(screen.getByTestId('trabalho-lista-acoes-l-com-excluir')).toHaveTextContent('fica na pasta Comercial');
    expect(screen.queryByTestId('trabalho-lista-acoes-l-com-aparencia')).toBeNull();
    expect(screen.queryByTestId('trabalho-lista-acoes-l-com-arquivar')).toBeNull();
  });

  it('a nova tarefa no quadro pede o lead, mostra o cliente da casa e manda os dois', async () => {
    window.history.replaceState(null, '', '/trabalho?lista=l-com');
    render(<TrabalhoPage />);
    const nova = await screen.findByTestId('trabalho-nova-s-c1');
    fireEvent.change(within(nova).getByLabelText('Nome da nova tarefa'), { target: { value: 'Mandar a proposta' } });
    expect(within(nova).queryByTestId('trabalho-nova-cliente-s-c1')).toBeNull();
    await waitFor(() => expect(within(nova).getByTestId('trabalho-nova-s-c1-cliente-fixo')).toHaveTextContent('cliente: Root (interno)'));
    fireEvent.focus(within(within(nova).getByTestId('trabalho-nova-s-c1-lead')).getByRole('combobox'));
    fireEvent.mouseDown(await screen.findByTestId(`opcao-lead-${LEAD}`));
    expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/trabalho\/atas\/alvos\?tipo=lead/), 'tok');
    fireEvent.click(within(nova).getByRole('button', { name: 'Criar tarefa' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas', expect.objectContaining({
      listId: 'l-com', statusId: 's-c1', title: 'Mandar a proposta', clienteId: 'interno', leadId: LEAD,
    }), 'tok'));
  });

  it('"+ criar lead" cria pelo mesmo caminho do Comercial e liga a tarefa ao lead novo', async () => {
    window.history.replaceState(null, '', '/trabalho?lista=l-com');
    render(<TrabalhoPage />);
    const nova = await screen.findByTestId('trabalho-nova-s-c1');
    fireEvent.change(within(nova).getByLabelText('Nome da nova tarefa'), { target: { value: 'Visitar a loja' } });
    const busca = within(within(nova).getByTestId('trabalho-nova-s-c1-lead')).getByRole('combobox');
    fireEvent.focus(busca);
    fireEvent.change(busca, { target: { value: 'Mercado Sol' } });
    fireEvent.mouseDown(await screen.findByTestId('opcao-lead-criar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/leads/entrada', { origem: { tipo: 'manual', ref: expect.stringMatching(/^trabalho:/) }, nome: 'Mercado Sol' }, 'tok'));
    fireEvent.click(within(nova).getByRole('button', { name: 'Criar tarefa' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas', expect.objectContaining({ leadId: LEAD_NOVO, clienteId: 'interno' }), 'tok'));
  });

  it('o pop-up mostra o lead com o link ao Funil, troca e tira pelo PATCH com a versão lida', async () => {
    window.history.replaceState(null, '', '/trabalho?lista=l-com');
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByText('Ligar para a padaria'));
    const link = await screen.findByTestId('tarefa-lead-link');
    expect(link).toHaveTextContent('Padaria Lua · Ana');
    expect(link).toHaveAttribute('href', `/comercial/funil?lead=${LEAD}&aba=fio`);
    fireEvent.click(screen.getByTestId('tarefa-lead-trocar'));
    fireEvent.focus(within(screen.getByTestId('tarefa-lead-busca')).getByRole('combobox'));
    fireEvent.mouseDown(await screen.findByTestId('opcao-lead-tirar'));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(`/trabalho/tarefas/${T_COM}`, { leadId: null, expectedUpdatedAt: '2026-10-26T10:00:00.000Z' }, 'tok'));
  });

  it('a lista de outra tarefa não oferece a lista do comercial como destino no pop-up', async () => {
    window.history.replaceState(null, '', '/trabalho?lista=l-ops');
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByText('Pagar o contador'));
    await screen.findByTestId('tarefa-mais-detalhes');
    const opcoes = [...document.querySelectorAll('[data-testid="tarefa-mais-detalhes"] select option')].map((o) => o.textContent ?? '');
    expect(opcoes.some((t) => t.includes('Rotina'))).toBe(true);
    expect(opcoes.some((t) => t.includes('Tarefas do comercial'))).toBe(false);
  });
});

describe('Layout 26/10: a nova tarefa rápida na Lista e no Calendário', () => {
  it('na Lista sem grupos: nome, responsável (eu, de saída), prazo e cliente; Enter cria e o formulário fica', async () => {
    window.history.replaceState(null, '', '/trabalho?lista=l-ops&visao=lista&agrupar=nenhum');
    render(<TrabalhoPage />);
    const nova = await screen.findByTestId('trabalho-lista-nova');
    await waitFor(() => expect(within(nova).getByTestId('trabalho-lista-nova-responsavel')).toHaveValue('u-eu'));
    expect(within(nova).queryByTestId('trabalho-lista-nova-lista')).toBeNull();
    await escolherCliente(within(nova).getByTestId('trabalho-lista-nova-cliente'));
    fireEvent.change(within(nova).getByTestId('trabalho-lista-nova-prazo'), { target: { value: '2026-11-03' } });
    const nome = within(nova).getByLabelText('Nome da nova tarefa');
    fireEvent.change(nome, { target: { value: 'Fechar o mês' } });
    fireEvent.keyDown(nome, { key: 'Enter' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas', {
      listId: 'l-ops', title: 'Fechar o mês', clienteId: CLIENTE, assigneeUserId: 'u-eu', dueDate: '2026-11-03T15:00:00.000Z',
    }, 'tok'));
    await waitFor(() => expect(nome).toHaveValue(''));
    expect(screen.getByTestId('trabalho-lista-nova')).toBeInTheDocument();
  });

  it('no "Por prazo" (o padrão), o "+ Adicionar tarefa" de Hoje cria com o prazo de hoje', async () => {
    window.history.replaceState(null, '', '/trabalho?lista=l-ops&visao=lista');
    render(<TrabalhoPage />);
    expect(await screen.findByTestId('trabalho-agrupar')).toHaveValue('datas');
    fireEvent.click(await screen.findByTestId('tabela-grupo-hoje-adicionar'));
    const form = await screen.findByTestId('trabalho-grupo-nova-form');
    const hoje = hojeEmBrasilia();
    expect(within(form).getByTestId('trabalho-grupo-nova-form-prazo')).toHaveValue(hoje);
    await escolherCliente(within(form).getByTestId('trabalho-grupo-nova-form-cliente'));
    const nome = within(form).getByLabelText('Nome da nova tarefa');
    fireEvent.change(nome, { target: { value: 'Conferir o caixa' } });
    fireEvent.keyDown(nome, { key: 'Enter' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas', expect.objectContaining({ title: 'Conferir o caixa', dueDate: prazoDoDia(hoje) }), 'tok'));
  });

  it('no Calendário, o "+" do dia abre a nova tarefa com o prazo naquele dia', async () => {
    window.history.replaceState(null, '', '/trabalho?lista=l-ops&visao=calendario');
    render(<TrabalhoPage />);
    const hoje = hojeEmBrasilia();
    fireEvent.click(await screen.findByTestId(`trabalho-calendario-mais-${hoje}`));
    const form = await screen.findByTestId('trabalho-calendario-nova-form');
    expect(within(form).getByTestId('trabalho-calendario-nova-form-prazo')).toHaveValue(hoje);
    await escolherCliente(within(form).getByTestId('trabalho-calendario-nova-form-cliente'));
    fireEvent.change(within(form).getByLabelText('Nome da nova tarefa'), { target: { value: 'Revisar o post' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Criar tarefa' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas', expect.objectContaining({ listId: 'l-ops', title: 'Revisar o post', dueDate: prazoDoDia(hoje) }), 'tok'));
  });

  it('em Todas, o formulário tem o seletor de lista; na lista do comercial vira lead e cliente da casa', async () => {
    window.history.replaceState(null, '', '/trabalho?pasta=todas&visao=lista&agrupar=nenhum');
    render(<TrabalhoPage />);
    const nova = await screen.findByTestId('trabalho-lista-nova');
    const lista = within(nova).getByTestId('trabalho-lista-nova-lista');
    expect([...lista.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Tarefas do comercial', 'Rotina']);
    fireEvent.change(lista, { target: { value: 'l-ops' } });
    expect(within(nova).getByTestId('trabalho-lista-nova-cliente')).toBeInTheDocument();
    fireEvent.change(lista, { target: { value: 'l-com' } });
    expect(within(nova).getByTestId('trabalho-lista-nova-lead')).toBeInTheDocument();
    const nome = within(nova).getByLabelText('Nome da nova tarefa');
    fireEvent.change(nome, { target: { value: 'Ligar para o Pedro' } });
    fireEvent.keyDown(nome, { key: 'Enter' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas', expect.objectContaining({ listId: 'l-com', clienteId: 'interno' }), 'tok'));
  });
});
