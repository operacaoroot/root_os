import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CaixaMinhaTarefa, CaixaTarefasResposta, VistaSalvaDto } from '@mktos/shared';
import { VISTA_PADRAO_DE_MINHAS_TAREFAS } from '@mktos/shared';

/*
 * AS VISTAS SALVAS EM MINHAS TAREFAS (rodada do trabalho T3, 19/10/2026).
 *
 *  1. a vista padrão do servidor vale ao abrir (agrupamento por vencimento com
 *     os grupos do ClickUp);
 *  2. sem nenhuma vista e com a preferência antiga de colunas no navegador, ela
 *     vira a vista padrão (uma vez);
 *  3. o cabeçalho ordena e inverte; o filtro de cliente filtra o que chegou;
 *  4. "Salvar como vista" grava no servidor com o nome; marcar padrão manda o PATCH.
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

function tarefa(id: string, titulo: string, over: Partial<CaixaMinhaTarefa> = {}): CaixaMinhaTarefa {
  return {
    id, titulo, listaId: 'l-1', lista: 'Execução', pastaId: 'p-1', pasta: 'Clientes', status: 'A fazer', statusCor: '#999', statusTipo: 'open',
    prazo: null, responsavel: 'Pedro', comentarios: 0, atualizadaEm: AGORA.toISOString(), motivos: [],
    criadaEm: AGORA.toISOString(), prioridade: 'normal', clienteId: null, cliente: null, ...over,
  };
}

const ITENS = [
  tarefa('t-1', 'Enviar proposta revisada', { prazo: emDias(-2), clienteId: 'c-a', cliente: 'Construtora Alicerce' }),
  tarefa('t-2', 'Marcar kickoff', { prazo: emDias(30), clienteId: 'c-b', cliente: 'Studio Lume' }),
  tarefa('t-3', 'Pagar o contador'),
];

const RESPOSTA: CaixaTarefasResposta = {
  estado: 'ok', itens: ITENS, truncado: false, teto: 200, identidades: ['Pedro'],
  listas: [{ id: 'l-1', nome: 'Execução', pastaId: 'p-1', pasta: 'Clientes' }], status: ['A fazer'],
  filtros: { responsavel: 'eu', encerradas: false }, agora: AGORA.toISOString(),
};

let VISTAS: VistaSalvaDto[] = [];

beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset(); apiPatch.mockReset();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/caixa?aba=tarefas');
  VISTAS = [];
  apiGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/vistas')) return Promise.resolve(VISTAS);
    if (rota.startsWith('/caixa/tarefas')) return Promise.resolve(RESPOSTA);
    return Promise.reject(new Error(`rota inesperada ${rota}`));
  });
});

const nomes = () => screen.getAllByTestId(/^caixa-tarefa-t-/).map((l) => l.querySelector('a')!.textContent);

describe('T3: vistas salvas em Minhas tarefas', () => {
  it('a vista padrão do servidor vale ao abrir, com os grupos de vencimento', async () => {
    VISTAS = [{ id: 'v-1', tela: 'minhas-tarefas', nome: 'Por prazo', padrao: true, atualizadaEm: AGORA.toISOString(), config: { ...VISTA_PADRAO_DE_MINHAS_TAREFAS, agrupamento: 'vencimento' } }];
    render(<AbaMinhasTarefas token="tok" />);
    await screen.findByTestId('caixa-grupo-atrasadas');
    expect(screen.getByTestId('caixa-vista')).toHaveValue('v-1');
    expect(screen.getByTestId('caixa-grupo-atrasadas')).toHaveTextContent('Atrasadas');
    expect(screen.getByTestId('caixa-grupo-depois')).toHaveTextContent('Marcar kickoff');
    expect(screen.getByTestId('caixa-grupo-sem-data')).toHaveTextContent('Pagar o contador');
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
