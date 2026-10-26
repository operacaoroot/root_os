import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TrabTarefaResumo, VistaSalvaDto } from '@mktos/shared';
import { VISTA_PADRAO_DE_MINHAS_TAREFAS, descreverRecorrencia } from '@mktos/shared';

/*
 * AS VISTAS SALVAS EM MINHAS TAREFAS (rodada do trabalho T3, 19/10/2026).
 *
 *  1. a vista padrão do servidor vale ao abrir (agrupamento por vencimento com
 *     os grupos do ClickUp);
 *  2. sem nenhuma vista e com a preferência antiga de colunas no navegador, ela
 *     vira a vista padrão (uma vez);
 *  3. o cabeçalho ordena e inverte; o filtro de cliente filtra o que chegou;
 *  4. "Salvar como vista" grava no servidor com o nome; marcar padrão manda o PATCH.
 *
 * Layout 26/10: a aba lê as tarefas da pessoa como o Trabalho (`/trabalho/tarefas?assigneeUserId=`)
 * e mostra a MESMA Lista do Trabalho: seleção, barra do lote, células que editam, ordem
 * manual e concluídas escondidas até "Mostrar concluídas".
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['dashboard.ver', 'tarefas.ver'] },
    can: (p: string) => p !== 'leads.ver',
  }),
}));

// eslint-disable-next-line import/first
import { AbaMinhasTarefas, CHAVE_DAS_COLUNAS } from '@/app/caixa/AbaMinhasTarefas';

const AGORA = new Date();
const emDias = (d: number) => new Date(AGORA.getTime() + d * 86_400_000).toISOString();

const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#999', order, total: 0, limite: null });
const LISTA = { id: 'l-1', name: 'Execução', externalId: null, spaceId: null, order: 0, total: 3, fields: [], statuses: [st('s-aberta', 'A fazer', 'open', 0), st('s-feita', 'Feito', 'closed', 1)] };
const ESTRUTURA = {
  espacos: [], folders: [{ id: 'p-1', name: 'Clientes', order: 0, spaceId: null, parentId: null, externalId: null, lists: [LISTA] }],
  listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [],
  pessoas: [{ id: 'u-eu', name: 'Pedro', email: 'p@x.com', isActive: true }, { id: 'u-ana', name: 'Ana', email: 'ana@x.com', isActive: true }],
};

function tarefa(id: string, title: string, over: Partial<TrabTarefaResumo> = {}): TrabTarefaResumo {
  return {
    id, title, listId: 'l-1', listName: 'Execução', statusId: 's-aberta', statusName: 'A fazer', statusType: 'open', statusColor: '#999',
    priority: 'normal', assignee: null, assigneeUserId: 'u-eu', assigneeUserName: 'Pedro', assigneeUserEmail: 'p@x.com', assigneeUserIsActive: true,
    agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null, statusDesde: null, minutos: 0,
    dueDate: null, startDate: null, overdue: false, parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null,
    archived: false, order: 0, tags: [], values: [], clienteId: null, clienteNome: null, outrosResponsaveisIds: [], recorrencia: null,
    updatedAt: AGORA.toISOString(), ...over,
  } as TrabTarefaResumo;
}

let ITENS: TrabTarefaResumo[] = [];

function itensPadrao() {
  return [
    tarefa('t-1', 'Enviar proposta revisada', { dueDate: emDias(-2), overdue: true, clienteId: 'c-a', clienteNome: 'Construtora Alicerce', order: 2, comments: 3 }),
    tarefa('t-2', 'Marcar kickoff', { dueDate: emDias(30), clienteId: 'c-b', clienteNome: 'Studio Lume', order: 1 }),
    tarefa('t-3', 'Pagar o contador', { order: 3 }),
    tarefa('t-4', 'Fechar o mês', { statusId: 's-feita', statusName: 'Feito', statusType: 'closed', order: 4 }),
  ];
}

let VISTAS: VistaSalvaDto[] = [];

beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset(); apiPatch.mockReset();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/caixa?aba=tarefas');
  VISTAS = [];
  ITENS = itensPadrao();
  apiGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/vistas')) return Promise.resolve(VISTAS);
    if (rota === '/trabalho/estrutura') return Promise.resolve(ESTRUTURA);
    if (rota.startsWith('/trabalho/tarefas?')) return Promise.resolve({ total: ITENS.length, items: ITENS });
    const detalhe = ITENS.find((t) => rota === `/trabalho/tarefas/${t.id}`);
    if (detalhe) return Promise.resolve({ ...detalhe, description: null, createdAt: AGORA.toISOString(), comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [] });
    return Promise.reject(new Error(`rota inesperada ${rota}`));
  });
});

const nomes = () => screen.getAllByTestId(/^caixa-tarefa-t-/).map((l) => l.querySelector('td button')!.textContent);
const grupo = (chave: string) => document.querySelector(`[data-grupo="${chave}"]`) as HTMLElement | null;

describe('T3: vistas salvas em Minhas tarefas', () => {
  it('a vista padrão do servidor vale ao abrir, com os grupos de vencimento', async () => {
    VISTAS = [{ id: 'v-1', tela: 'minhas-tarefas', nome: 'Por prazo', padrao: true, atualizadaEm: AGORA.toISOString(), config: { ...VISTA_PADRAO_DE_MINHAS_TAREFAS, agrupamento: 'vencimento' } }];
    render(<AbaMinhasTarefas token="tok" />);
    await waitFor(() => expect(grupo('atrasadas')).not.toBeNull());
    expect(screen.getByTestId('caixa-vista')).toHaveValue('v-1');
    expect(grupo('atrasadas')).toHaveTextContent('Atrasadas');
    expect(grupo('depois')).toHaveTextContent('Marcar kickoff');
    expect(grupo('sem-data')).toHaveTextContent('Pagar o contador');
  });

  it('sem vista e com a preferência antiga de colunas, ela vira a vista padrão uma vez', async () => {
    window.localStorage.setItem(CHAVE_DAS_COLUNAS, JSON.stringify(['status', 'vencimento']));
    apiPost.mockResolvedValue({ id: 'v-nova', tela: 'minhas-tarefas', nome: 'Minha vista', padrao: true, atualizadaEm: AGORA.toISOString(), config: {} });
    render(<AbaMinhasTarefas token="tok" />);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/vistas', expect.objectContaining({
      tela: 'minhas-tarefas', nome: 'Minha vista', padrao: true,
      config: expect.objectContaining({ colunas: ['status', 'vencimento'] }),
    }), 'tok'));
    expect(window.localStorage.getItem('caixa.tarefas.vistas.migrado.v1')).toBe('1');
  });

  it('o cabeçalho ordena e inverte; o filtro de cliente filtra o que chegou', async () => {
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-1');
    expect(nomes()).toEqual(['Enviar proposta revisada', 'Marcar kickoff', 'Pagar o contador']);
    fireEvent.click(screen.getByTestId('caixa-ordenar-cliente'));
    expect(nomes()).toEqual(['Enviar proposta revisada', 'Marcar kickoff', 'Pagar o contador']);
    fireEvent.click(screen.getByTestId('caixa-ordenar-cliente'));
    // Decrescente, e o sem cliente continua no fim.
    expect(nomes()).toEqual(['Marcar kickoff', 'Enviar proposta revisada', 'Pagar o contador']);
    fireEvent.change(screen.getByTestId('caixa-filtro-cliente'), { target: { value: 'sem' } });
    expect(nomes()).toEqual(['Pagar o contador']);
  });

  it('salvar como vista grava no servidor; marcar padrão manda o PATCH', async () => {
    VISTAS = [{ id: 'v-1', tela: 'minhas-tarefas', nome: 'Por prazo', padrao: true, atualizadaEm: AGORA.toISOString(), config: VISTA_PADRAO_DE_MINHAS_TAREFAS }];
    vi.spyOn(window, 'prompt').mockReturnValue('Por cliente');
    apiPost.mockResolvedValue({ id: 'v-2', tela: 'minhas-tarefas', nome: 'Por cliente', padrao: false, atualizadaEm: AGORA.toISOString(), config: { ...VISTA_PADRAO_DE_MINHAS_TAREFAS, agrupamento: 'cliente' } });
    apiPatch.mockResolvedValue({ id: 'v-2', tela: 'minhas-tarefas', nome: 'Por cliente', padrao: true, atualizadaEm: AGORA.toISOString(), config: { ...VISTA_PADRAO_DE_MINHAS_TAREFAS, agrupamento: 'cliente' } });
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-1');
    fireEvent.change(screen.getByTestId('caixa-agrupar'), { target: { value: 'cliente' } });
    fireEvent.click(screen.getByTestId('caixa-vista-salvar-como'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/vistas', expect.objectContaining({
      tela: 'minhas-tarefas', nome: 'Por cliente', config: expect.objectContaining({ agrupamento: 'cliente' }),
    }), 'tok'));
    fireEvent.click(await screen.findByTestId('caixa-vista-padrao'));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/trabalho/vistas/v-2', { padrao: true }, 'tok'));
    expect(within(screen.getByTestId('caixa-vista')).getByRole('option', { name: 'Por cliente (padrão)' })).toBeTruthy();
  });
});

describe('F4: o calendário é uma das formas de ver Minhas tarefas', () => {
  it('troca para o calendário, guarda a escolha e arrastar grava o prazo com a versão lida', async () => {
    apiPatch.mockResolvedValue({});
    const { hojeEmBrasilia } = await import('@/lib/horas');
    const mes = hojeEmBrasilia().slice(0, 7);
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findAllByText('Pagar o contador');
    fireEvent.click(screen.getByTestId('caixa-forma-calendario'));
    expect(screen.getByTestId('caixa-forma-calendario')).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('caixa.tarefas.forma.v1')).toBe('calendario');
    const semPrazo = await screen.findByTestId('caixa-calendario-sem-prazo');
    expect(semPrazo).toHaveTextContent('Pagar o contador');
    const dt = { getData: () => 't-3', setData: () => undefined, effectAllowed: 'move' };
    fireEvent.dragStart(screen.getByTestId('caixa-calendario-tarefa-t-3'), { dataTransfer: dt });
    const dia = document.querySelector(`[data-dia="${mes}-15"]`)!;
    fireEvent.dragOver(dia, { dataTransfer: dt });
    fireEvent.drop(dia, { dataTransfer: dt });
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/trabalho/tarefas/t-3', { dueDate: `${mes}-15T15:00:00.000Z`, expectedUpdatedAt: ITENS[2].updatedAt }, 'tok'));
  });
});

describe('Layout 26/10: Minhas tarefas é a Lista do Trabalho', () => {
  it('lê as tarefas da pessoa como o Trabalho; "Qualquer pessoa" lê Todas as tarefas', async () => {
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-1');
    const consultas = () => apiGet.mock.calls.map(([r]) => String(r)).filter((r) => r.startsWith('/trabalho/tarefas?'));
    expect(consultas()[0]).toContain('assigneeUserId=u-eu');
    expect(apiGet.mock.calls.some(([r]) => String(r).startsWith('/caixa/tarefas'))).toBe(false);
    fireEvent.change(screen.getByTestId('caixa-filtro-responsavel'), { target: { value: 'qualquer' } });
    await waitFor(() => expect(consultas().some((r) => r.includes('todas=1') && !r.includes('assigneeUserId'))).toBe(true));
  });

  it('concluídas ficam escondidas até "Mostrar concluídas"', async () => {
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-1');
    expect(screen.queryByTestId('caixa-tarefa-t-4')).toBeNull();
    expect(screen.getByTestId('caixa-tarefas-rodape')).toHaveTextContent('1 concluída escondida');
    fireEvent.click(screen.getByTestId('caixa-concluidas'));
    expect(screen.getByTestId('caixa-tarefa-t-4')).toBeInTheDocument();
    expect(screen.getByTestId('caixa-concluidas')).toHaveAttribute('aria-pressed', 'true');
  });

  it('seleciona linhas, a barra do lote aparece e concluir grava cada uma com a versão lida', async () => {
    apiPatch.mockResolvedValue({});
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-1');
    expect(screen.queryByTestId('trabalho-lote')).toBeNull();
    fireEvent.click(screen.getByTestId('trabalho-selecionar-t-1'));
    fireEvent.click(screen.getByTestId('trabalho-selecionar-t-3'));
    const lote = await screen.findByTestId('trabalho-lote');
    expect(lote).toHaveTextContent('2 selecionadas');
    fireEvent.click(within(lote).getByTestId('trabalho-lote-concluir'));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(2));
    expect(apiPatch).toHaveBeenCalledWith('/trabalho/tarefas/t-1', { statusId: 's-feita', expectedUpdatedAt: ITENS[0].updatedAt }, 'tok');
    expect(apiPatch).toHaveBeenCalledWith('/trabalho/tarefas/t-3', { statusId: 's-feita', expectedUpdatedAt: ITENS[2].updatedAt }, 'tok');
    expect(await screen.findByTestId('caixa-lote-aviso')).toHaveTextContent('Concluir: 2 tarefas alteradas.');
  });

  it('as células editam na linha: o prazo vai pelo PATCH com a versão lida', async () => {
    apiPatch.mockResolvedValue({});
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-3');
    expect(screen.getByTestId('trabalho-celula-responsavel-t-3')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('trabalho-celula-prazo-t-3'));
    const campo = screen.getByLabelText('Prazo de Pagar o contador');
    fireEvent.change(campo, { target: { value: '2026-11-20' } });
    fireEvent.blur(campo);
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/trabalho/tarefas/t-3', { dueDate: '2026-11-20T15:00:00.000Z', expectedUpdatedAt: ITENS[2].updatedAt }, 'tok'));
  });

  it('a ordem manual mostra a ordem gravada e arrastar grava a sequência', async () => {
    apiPost.mockResolvedValue({});
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-tarefa-t-1');
    fireEvent.change(screen.getByTestId('caixa-ordem-campo'), { target: { value: 'manual' } });
    expect(window.localStorage.getItem('caixa.tarefas.ordem-manual.v1')).toBe('1');
    // A ordem em que a consulta trouxe (a do Trabalho), não a do prazo.
    expect(nomes()).toEqual(['Enviar proposta revisada', 'Marcar kickoff', 'Pagar o contador']);
    const dt = { getData: () => 't-3', setData: () => undefined, effectAllowed: 'move' };
    fireEvent.dragStart(screen.getByTestId('caixa-tarefa-t-3'), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId('caixa-tarefa-t-1'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('caixa-tarefa-t-1'), { dataTransfer: dt });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas/ordem', {
      itens: [
        { id: 't-3', expectedUpdatedAt: ITENS[2].updatedAt },
        { id: 't-1', expectedUpdatedAt: ITENS[0].updatedAt },
        { id: 't-2', expectedUpdatedAt: ITENS[1].updatedAt },
      ],
    }, 'tok'));
  });

  it('sem prazo é diferente de repetir: a tarefa que repete diz a regra no prazo (ou a data e o ↻)', async () => {
    const semanal = { tipo: 'semanal' as const, dias: [1] };
    const regra = descreverRecorrencia(semanal);
    ITENS = [
      tarefa('t-r1', 'Postar o resumo da semana', { recorrencia: semanal }),
      tarefa('t-r2', 'Fechar a semana', { recorrencia: semanal, dueDate: emDias(3) }),
      tarefa('t-3', 'Pagar o contador'),
    ];
    render(<AbaMinhasTarefas token="tok" />);
    const semData = await screen.findByTestId('trabalho-prazo-repete-t-r1');
    expect(semData).toHaveTextContent(`↻ ${regra}`);
    expect(semData).toHaveAttribute('title', `Repete: ${regra}`);
    const comData = screen.getByTestId('trabalho-prazo-repete-t-r2');
    expect(comData).toHaveTextContent(/\d{2}\/\d{2}\/\d{4} ↻/);
    expect(within(comData).getByRole('img', { name: `Repete: ${regra}` })).toHaveAttribute('title', `Repete: ${regra}`);
    // Sem data e sem repetição: o vazio de sempre, sem ↻.
    expect(screen.getByTestId('trabalho-celula-prazo-t-3')).toHaveTextContent('—');
    expect(screen.getByTestId('trabalho-celula-prazo-t-3')).not.toHaveTextContent('↻');
  });

  it('a linha diz o motivo e os comentários embaixo do nome; o clique abre o pop-up da tarefa', async () => {
    render(<AbaMinhasTarefas token="tok" />);
    const linha = await screen.findByTestId('caixa-tarefa-t-1');
    expect(within(linha).getByTestId('caixa-motivos-t-1')).toHaveTextContent('prazo vencido · 3 comentários');
    fireEvent.click(linha);
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBe('t-1');
    expect(await screen.findByTestId('tarefa-popup')).toBeInTheDocument();
  });
});
