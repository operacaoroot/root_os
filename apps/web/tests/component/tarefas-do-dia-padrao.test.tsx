import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { descreverRecorrencia, type PainelDeTarefas, type TarefaDoDia } from '@mktos/shared';

/*
 * LAYOUT 26/10: AS TAREFAS DE UMA ÁREA NO PADRÃO DO TRABALHO (TarefasDoDia).
 *
 *  1. o clique na tarefa abre o pop-up único da tarefa (`TarefaFlutuante`, o do
 *     Trabalho), com `?tarefa=` no endereço, no lugar da janela própria;
 *  2. concluídas escondidas até "Mostrar concluídas" (`?concluidas=mostrar`);
 *  3. o quadro tem o seletor de densidade (a preferência de todo quadro) e as
 *     colunas crescem com a página (sem altura fixa);
 *  4. o responsável na Lista: só a equipe, com a foto, numa caixa em portal.
 */

const apiGet = vi.fn();
const apiPatch = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiBlob: vi.fn(() => Promise.reject(new Error('sem foto'))),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u-a', name: 'Ana Lima' }, can: () => true }),
}));

// eslint-disable-next-line import/first
import { TarefasDoDia } from '@/components/tarefas/TarefasDoDia';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ana = { id: 'u-a', nome: 'Ana Lima' };
const bruno = { id: 'u-b', nome: 'Bruno Melo' };
const clara = { id: 'u-c', nome: 'Clara Dias' };

const tarefa = (id: string, titulo: string, over: Partial<TarefaDoDia> = {}): TarefaDoDia => ({
  id, titulo, area: { id: 'a1', nome: 'Marketing', cor: '#000' }, cliente: null, pessoa: ana, pessoas: [ana],
  responsavelTexto: null, prazo: null, situacao: 'sem_prazo', status: { nome: 'A fazer', cor: '#888', tipo: 'aberta' },
  lista: { id: 'l1', nome: 'Rotinas' }, externalUrl: null, descricao: 'Detalhe da tarefa', recorrencia: null, ordem: 0, updatedAt: '2026-10-19T12:00:00Z',
  ...over,
});

let PAINEL: PainelDeTarefas;

const ESTRUTURA = {
  espacos: [], folders: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [],
  listasSoltas: [{ id: 'l1', name: 'Rotinas', externalId: null, spaceId: null, order: 0, total: 2, fields: [], statuses: [{ id: 's1', name: 'A fazer', type: 'open', color: '#888', order: 0, total: 0, limite: null }] }],
  pessoas: [{ id: 'u-a', name: 'Ana Lima', email: 'ana@qa.local', isActive: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/marketing/tarefas');
  PAINEL = {
    hoje: '2026-10-19',
    areas: [{ id: 'a1', nome: 'Marketing', cor: '#000', ordem: 0 }],
    pessoas: [ana, bruno, clara],
    clientes: [],
    resumo: [],
    tarefas: [
      tarefa(T1, 'Gravar o vídeo da semana'),
      tarefa(T2, 'Fechar o relatório de setembro', { situacao: 'feita', status: { nome: 'Feito', cor: '#0f0', tipo: 'concluida' } }),
    ],
  };
  apiGet.mockImplementation(async (rota: string) => {
    if (rota === '/trabalho/todas') return PAINEL;
    // A equipe: Ana e Clara. Bruno é conta da empresa, mas não da equipe.
    if (rota === '/organograma/equipe') return { pessoas: [{ id: 'u-a' }, { id: 'u-c' }] };
    if (rota === '/trabalho/estrutura') return ESTRUTURA;
    const id = rota.match(/^\/trabalho\/tarefas\/([0-9a-f-]{36})$/)?.[1];
    if (id) {
      return {
        id, listId: 'l1', listName: 'Rotinas', title: 'Gravar o vídeo da semana', statusId: 's1', statusName: 'A fazer', statusType: 'open', statusColor: '#888',
        priority: 'normal', assignee: null, assigneeUserId: 'u-a', assigneeUserName: 'Ana Lima', assigneeUserEmail: 'ana@qa.local', assigneeUserIsActive: true,
        agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null, statusDesde: null, minutos: 0, dueDate: null, startDate: null, overdue: false,
        parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, archived: false, order: 0, tags: [], values: [],
        clienteId: null, clienteNome: null, outrosResponsaveisIds: [], recorrencia: null, updatedAt: '2026-10-19T12:00:00Z',
        description: null, createdAt: '2026-10-19T12:00:00Z', comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [],
      };
    }
    throw new Error(`rota inesperada ${rota}`);
  });
  apiPatch.mockImplementation(async (_rota: string, corpo: Record<string, unknown>) => ({ ...PAINEL.tarefas[0], ...corpo }));
});
afterEach(() => cleanup());

describe('TarefasDoDia no padrão do Trabalho', () => {
  it('o clique no cartão abre o pop-up único da tarefa, com ?tarefa= no endereço', async () => {
    render(<TarefasDoDia area="Marketing" />);
    fireEvent.click(await screen.findByText('Gravar o vídeo da semana'));
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBe(T1);
    expect(await screen.findByTestId('tarefa-popup')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(`/trabalho/tarefas/${T1}`, 'tok');
  });

  it('concluídas ficam escondidas até "Mostrar concluídas", que vai para o endereço', async () => {
    window.history.replaceState(null, '', '/marketing/tarefas?ver=lista');
    render(<TarefasDoDia area="Marketing" />);
    await screen.findByText('Gravar o vídeo da semana');
    expect(screen.queryByText('Fechar o relatório de setembro')).toBeNull();
    fireEvent.click(screen.getByTestId('dia-concluidas'));
    expect(await screen.findByText('Fechar o relatório de setembro')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('concluidas')).toBe('mostrar');
    expect(screen.getByTestId('dia-concluidas')).toHaveAttribute('aria-pressed', 'true');
  });

  it('o quadro tem a densidade de todo quadro e as colunas crescem com a página', async () => {
    render(<TarefasDoDia area="Marketing" />);
    await screen.findByText('Gravar o vídeo da semana');
    const quadro = screen.getByTestId('dia-quadro');
    // Sem altura fixa: no mínimo a janela, e a página rola até o fim.
    expect(quadro.style.height).toBe('');
    expect(screen.getByTestId('dia-densidade-compacto')).toHaveAttribute('aria-pressed', 'true');
    // Compacto: sem a área e sem a descrição no cartão.
    expect(screen.queryByText('Detalhe da tarefa')).toBeNull();
    fireEvent.click(screen.getByTestId('dia-densidade-cheio'));
    expect(window.localStorage.getItem('root-os:trabalho:densidade')).toBe('cheio');
    expect(screen.getByText('Detalhe da tarefa')).toBeInTheDocument();
    expect((quadro.querySelector('[data-coluna="u-a"]') as HTMLElement).style.width).toBe('290px');
  });

  it('sem prazo é diferente de repetir: lista, cartão e calendário dizem a regra da que repete', async () => {
    const semanal = { tipo: 'semanal' as const, dias: [1] };
    const regra = descreverRecorrencia(semanal);
    const T3 = '33333333-3333-4333-8333-333333333333';
    PAINEL.tarefas = [
      tarefa(T1, 'Gravar o vídeo da semana', { recorrencia: semanal }),
      tarefa(T3, 'Revisar a pauta', { recorrencia: semanal, prazo: '2026-10-22', situacao: 'proximos_7' }),
    ];
    window.history.replaceState(null, '', '/marketing/tarefas?ver=lista');
    const { unmount } = render(<TarefasDoDia area="Marketing" />);
    expect(await screen.findByTestId(`dia-lista-prazo-${T1}`)).toHaveTextContent(`↻ ${regra}`);
    const comData = screen.getByTestId(`dia-lista-prazo-${T3}`);
    expect(comData).toHaveTextContent('22/10 ↻');
    expect(within(comData).getByRole('img', { name: `Repete: ${regra}` })).toBeInTheDocument();
    unmount();

    // No cartão do quadro, o mesmo.
    window.history.replaceState(null, '', '/marketing/tarefas');
    const quadro = render(<TarefasDoDia area="Marketing" />);
    expect(await screen.findByTestId(`dia-prazo-${T1}`)).toHaveTextContent(`↻ ${regra}`);
    quadro.unmount();

    // No calendário, a que repete sem data não vai para "Sem prazo".
    window.history.replaceState(null, '', '/marketing/tarefas?ver=calendario');
    render(<TarefasDoDia area="Marketing" />);
    const faixa = await screen.findByTestId('dia-calendario-repetem');
    expect(faixa).toHaveTextContent('Gravar o vídeo da semana');
    expect(screen.queryByText(/^Sem prazo ·/)).toBeNull();
  });

  it('na Lista, o responsável abre uma caixa em portal só com a equipe, com foto; marcar grava', async () => {
    window.history.replaceState(null, '', '/marketing/tarefas?ver=lista');
    render(<TarefasDoDia area="Marketing" />);
    const celula = await screen.findByTestId(`dia-celula-responsaveis-${T1}`);
    expect(celula).toHaveAccessibleName('Responsáveis: Ana Lima');
    fireEvent.click(celula);
    const caixa = await screen.findByTestId(`dia-celula-responsaveis-${T1}-caixa`);
    // A caixa vai para o body (portal): a tabela que rola de lado não a corta.
    expect(caixa.parentElement).toBe(document.body);
    await waitFor(() => expect(within(caixa).queryByRole('button', { name: /Bruno Melo/ })).toBeNull());
    expect(within(caixa).getByRole('button', { name: /Ana Lima/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(caixa).getByRole('button', { name: /Clara Dias/ }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(`/trabalho/todas/${T1}`, { expectedUpdatedAt: '2026-10-19T12:00:00Z', pessoasIds: ['u-a', 'u-c'] }, 'tok'));
  });
});
