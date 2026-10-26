import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Layout 26/10 (P-29, P-30, P-18):
 *   · P-29: na Lista, Responsável, Agente e Prazo editam na própria célula, pelas
 *     mesmas gravações do pop-up (PATCH com a versão lida; agente pelo checkout), sem
 *     abrir a tarefa. Quem só lê vê o texto de antes.
 *   · P-30: o topo da tarefa é uma grade de propriedades; o raro fica em "Mais detalhes".
 *   · P-18: o "Personalizar…" do Repetir grava a cada N semanas e o fim da série.
 */

const get = vi.fn(), patch = vi.fn(), post = vi.fn();
let permissions = ['tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/api', () => ({
  apiGet: (...args: unknown[]) => get(...args), apiPatch: (...args: unknown[]) => patch(...args),
  apiPost: (...args: unknown[]) => post(...args), apiDelete: vi.fn(), apiBlob: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'qa-token', ready: true, user: { id: 'qa-eu' }, can: (p: string) => permissions.includes(p) }) }));
import TrabalhoPage from '@/app/trabalho/page';

const pessoas = [
  { id: 'qa-eu', name: 'Pessoa QA', email: 'eu@qa.local', isActive: true },
  { id: 'qa-ana', name: 'Ana QA', email: 'ana@qa.local', isActive: true },
  // Conta ativa, mas fora da equipe (a conta de sistema, de teste…): não é oferecida.
  { id: 'qa-sistema', name: 'Conta Sistema QA', email: 'mcp@qa.local', isActive: true },
];
const ID = '11111111-1111-4111-8111-111111111111';
const versao = '2026-10-07T19:00:00.000Z';
const lista = { id: 'qa-lista', name: 'Lista QA', total: 1, statuses: [{ id: 'status-a', name: 'A fazer', type: 'open', color: '#000000', total: 1, order: 0, limite: null }, { id: 'status-f', name: 'Feito', type: 'closed', color: '#00aa00', total: 0, order: 1, limite: null }], fields: [], order: 0, externalId: null };
const agentes = [{ slug: 'analista', nome: 'Analista QA', estado: 'ativo', podeAssumir: true, tarefas: 0 }];
const estrutura = { folders: [], listasSoltas: [lista], camposGlobais: [], tags: [], responsaveis: [], agentes, pessoas };
const original = {
  id: ID, title: 'Entrega QA', listId: lista.id, listName: lista.name, statusId: 'status-a', statusName: 'A fazer', statusType: 'open', statusColor: '#000000',
  priority: 'normal', assignee: null, assigneeUserId: 'qa-eu', assigneeUserName: 'Pessoa QA', assigneeUserEmail: 'eu@qa.local', assigneeUserIsActive: true,
  outrosResponsaveisIds: [], description: 'Material QA', dueDate: '2026-10-30T15:00:00.000Z', startDate: null, overdue: false, archived: false,
  agenteId: null, agenteNome: null, agenteSlug: null, agenteEm: null, statusDesde: null, minutos: 90, parentId: null, subtasks: 0, comments: 0,
  externalId: null, externalUrl: null, order: 0, tags: [], values: [], comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [],
  clienteId: 'qa-cliente', clienteNome: 'Cliente QA', recorrencia: null as unknown, createdAt: versao, updatedAt: versao,
};
let tarefa = { ...original };
function servir(path: string) {
  if (path === '/trabalho/estrutura') return Promise.resolve(estrutura);
  if (path === '/organograma/equipe') return Promise.resolve({ pessoas: [{ id: 'qa-eu' }, { id: 'qa-ana' }] });
  if (path.startsWith('/trabalho/tarefas?')) return Promise.resolve({ items: [tarefa], total: 1 });
  if (path === `/trabalho/tarefas/${ID}`) return Promise.resolve({ ...tarefa });
  return Promise.resolve(null);
}
beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/trabalho?lista=qa-lista&visao=lista');
  permissions = ['tarefas.ver', 'tarefas.editar']; tarefa = { ...original };
  get.mockReset(); patch.mockReset(); post.mockReset();
  get.mockImplementation(servir); patch.mockResolvedValue({}); post.mockResolvedValue({});
});
afterEach(cleanup);

const linha = async () => (await screen.findByRole('button', { name: 'Entrega QA' })).closest('tr') as HTMLElement;

describe('P-29: as células da Lista editam ali mesmo', () => {
  it('responsável: a caixa mostra só a equipe, com avatar, e grava pelo PATCH com a versão, sem abrir a tarefa', async () => {
    render(<TrabalhoPage />);
    const tr = await linha();
    fireEvent.click(within(tr).getByRole('button', { name: 'Responsável de Entrega QA' }));
    const caixa = await screen.findByRole('dialog', { name: 'Responsável de Entrega QA' });
    await waitFor(() => expect(within(caixa).queryByText('Conta Sistema QA')).toBeNull());
    expect(within(caixa).getByRole('button', { name: /Pessoa QA/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(caixa).getAllByTestId('avatar-da-pessoa').length).toBeGreaterThan(0);
    fireEvent.click(within(caixa).getByRole('button', { name: /Ana QA/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, { assigneeUserId: 'qa-ana', expectedUpdatedAt: versao }, 'qa-token'));
    expect(screen.queryByTestId('tarefa-popup')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBeNull();
  });

  it('prazo: o clique vira campo de data; grava o dia novo ao sair, e nada se o dia não mudou', async () => {
    render(<TrabalhoPage />);
    const tr = await linha();
    fireEvent.click(within(tr).getByRole('button', { name: 'Prazo de Entrega QA' }));
    const campo = within(tr).getByLabelText('Prazo de Entrega QA') as HTMLInputElement;
    expect(campo.type).toBe('date');
    expect(campo.value).toBe('2026-10-30');
    fireEvent.blur(campo);
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(within(tr).getByRole('button', { name: 'Prazo de Entrega QA' }));
    const deNovo = within(tr).getByLabelText('Prazo de Entrega QA');
    fireEvent.change(deNovo, { target: { value: '2026-11-05' } });
    fireEvent.blur(deNovo);
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, { dueDate: '2026-11-05T15:00:00.000Z', expectedUpdatedAt: versao }, 'qa-token'));
    expect(screen.queryByTestId('tarefa-popup')).toBeNull();
  });

  it('agente: entrega pelo mesmo checkout (/assumir) do pop-up, sem PATCH', async () => {
    render(<TrabalhoPage />);
    const tr = await linha();
    fireEvent.click(within(tr).getByRole('button', { name: 'Agente de Entrega QA' }));
    const caixa = await screen.findByRole('dialog', { name: 'Agente de Entrega QA' });
    expect(within(caixa).getByText(/Livre — nenhum agente assumiu/)).toBeInTheDocument();
    fireEvent.change(within(caixa).getByRole('combobox', { name: /Entregar a um agente/i }), { target: { value: 'analista' } });
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}/assumir`, { agente: 'analista' }, 'qa-token'));
    expect(patch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tarefa-popup')).toBeNull();
  });

  it('quem só lê vê o texto de sempre, sem botões nas células', async () => {
    permissions = ['tarefas.ver'];
    render(<TrabalhoPage />);
    const tr = await linha();
    expect(within(tr).queryByRole('button', { name: 'Responsável de Entrega QA' })).toBeNull();
    expect(within(tr).queryByRole('button', { name: 'Prazo de Entrega QA' })).toBeNull();
    expect(within(tr).getByText('30/10/2026')).toBeInTheDocument();
  });
});

describe('P-30: a grade de propriedades no topo da tarefa', () => {
  it('Status, Datas, Responsáveis, Prioridade, Etiquetas e Tempo editam com o mesmo salvar; o raro fica em Mais detalhes', async () => {
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    const grade = await screen.findByTestId('tarefa-propriedades');
    for (const rotulo of ['Status', 'Datas', 'Responsáveis', 'Prioridade', 'Etiquetas', 'Tempo']) expect(grade.querySelector(`[data-propriedade="${rotulo}"]`)).not.toBeNull();
    expect(within(grade).getByTestId('tarefa-tempo')).toHaveTextContent('1h30');
    fireEvent.change(within(grade).getByLabelText('Prioridade'), { target: { value: 'alta' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, { priority: 'alta', expectedUpdatedAt: versao }, 'qa-token'));

    // Os seletores de responsável abrem pelo clique nos avatares.
    const abrir = within(grade).getByTestId('tarefa-responsaveis');
    expect(abrir).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(abrir);
    expect(within(grade).getByTestId('tarefa-responsaveis')).toHaveAttribute('aria-expanded', 'true');
    expect(within(grade).getByLabelText('Responsável (pessoa)')).toBeInTheDocument();

    const detalhes = screen.getByTestId('tarefa-mais-detalhes') as HTMLDetailsElement;
    expect(detalhes.open).toBe(false);
    for (const rotulo of ['Lista', 'Cliente', 'Responsável antigo (texto)', 'Agente executor', 'Repetir']) expect(within(detalhes).getByText(rotulo)).toBeInTheDocument();
    expect(within(detalhes).getByLabelText('Horas gastas')).toBeInTheDocument();
    // O "Tempo" da grade leva ao lançamento de horas.
    fireEvent.click(within(grade).getByTestId('tarefa-tempo'));
    await waitFor(() => expect((screen.getByTestId('tarefa-mais-detalhes') as HTMLDetailsElement).open).toBe(true));
  });
});

describe('P-18: Repetir › Personalizar…', () => {
  it('a cada 2 semanas, segunda e quarta, até 31/12: grava a regra nova só no Aplicar', async () => {
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    fireEvent.change(await screen.findByLabelText('Repetir a tarefa'), { target: { value: 'personalizar' } });
    const form = await screen.findByTestId('tarefa-repetir-personalizar');
    fireEvent.change(within(form).getByLabelText('Repetir a cada'), { target: { value: '2' } });
    expect(within(form).getByLabelText('Unidade da repetição')).toHaveValue('semanas');
    // O prazo (30/10/2026) é uma sexta: ela vem marcada; troca por segunda e quarta.
    fireEvent.click(within(form).getByRole('button', { name: 'sexta' }));
    fireEvent.click(within(form).getByRole('button', { name: 'quarta' }));
    fireEvent.click(within(form).getByRole('button', { name: 'segunda' }));
    fireEvent.change(within(form).getByLabelText('Termina em'), { target: { value: '2026-12-31' } });
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByTestId('tarefa-repetir-aplicar'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, {
      recorrencia: { tipo: 'semanal', dias: [1, 3], intervalo: 2, ate: '2026-12-31' }, expectedUpdatedAt: versao,
    }, 'qa-token'));
  });

  it('a cada 3 meses no dia 10, sem fim', async () => {
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    fireEvent.change(await screen.findByLabelText('Repetir a tarefa'), { target: { value: 'personalizar' } });
    const form = await screen.findByTestId('tarefa-repetir-personalizar');
    fireEvent.change(within(form).getByLabelText('Unidade da repetição'), { target: { value: 'meses' } });
    fireEvent.change(within(form).getByLabelText('Repetir a cada'), { target: { value: '3' } });
    fireEvent.change(within(form).getByLabelText('Dia do mês'), { target: { value: '10' } });
    fireEvent.click(within(form).getByTestId('tarefa-repetir-aplicar'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/trabalho/tarefas/${ID}`, { recorrencia: { tipo: 'mensal', dia: 10, intervalo: 3 }, expectedUpdatedAt: versao }, 'qa-token'));
  });

  it('a regra personalizada salva abre como Personalizar, com o nome certo', async () => {
    tarefa = { ...original, recorrencia: { tipo: 'mensal', dia: 10, intervalo: 3 } };
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    expect(await screen.findByLabelText('Repetir a tarefa')).toHaveValue('personalizar');
    expect(screen.getByTestId('tarefa-repetir')).toHaveTextContent('A cada 3 meses, dia 10.');
  });

  it('regra antiga (toda semana) continua no select de sempre, sem o formulário', async () => {
    tarefa = { ...original, recorrencia: { tipo: 'semanal', dias: [1] } };
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega QA' }));
    expect(await screen.findByLabelText('Repetir a tarefa')).toHaveValue('semanal');
    expect(screen.queryByTestId('tarefa-repetir-personalizar')).toBeNull();
  });
});
