import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrabArquivadas, TrabLixeira } from '@mktos/shared';

/*
 * A LIXEIRA (rodada de produção 3, I2, 22/10/2026).
 *
 *  · aba Tarefas: excluídas e arquivadas com quando, por quem e de onde; busca por
 *    nome e filtro; Restaurar em lote (e o aviso da lista arquivada); "ver no
 *    Registro de ações" filtrado pela entidade; Apagar de vez só para quem tem
 *    `admin.usuarios`, com a frase escrita, e só das excluídas;
 *  · aba Listas e pastas: o Desarquivar da rodada 2, em lote;
 *  · sem a permissão de apagar, a tela diz que não é para a pessoa.
 */

const get = vi.fn(), post = vi.fn();
vi.mock('@/lib/api', () => ({ apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a) }));
let permissoes = ['tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: (p: string) => permissoes.includes(p) }) }));
import LixeiraPage from '@/app/lixeira/page';

const EXC = '11111111-1111-4111-8111-111111111111';
const ARQ = '22222222-2222-4222-8222-222222222222';
const LIXEIRA: TrabLixeira = {
  tarefas: [
    {
      id: EXC, title: 'Pagar boleto', estado: 'excluida', em: '2026-10-22T13:00:00.000Z', por: { id: 'eu', nome: 'Rodrigo' },
      lista: { id: 'l1', name: 'Operação', arquivada: false }, pasta: null, status: { id: 's1', name: 'A fazer' },
      expiraEm: '2026-11-21T13:00:00.000Z', cardDaImplantacao: false,
    },
    {
      id: ARQ, title: 'Cliente X', estado: 'arquivada', em: '2026-10-21T22:56:00.000Z', por: null,
      lista: { id: 'l2', name: 'Onboarding de cliente', arquivada: false }, pasta: { id: 'p1', name: 'Clientes' }, status: { id: 's2', name: 'Kit montado' },
      expiraEm: null, cardDaImplantacao: true,
    },
  ],
  total: 2, limite: 500, diasNaLixeira: 30, expurgo: { rotinaId: 'r1', ligado: false },
};
const ARQUIVADAS: TrabArquivadas = {
  pastas: [{ id: 'p-crm', name: 'CRM', arquivadaEm: '2026-10-21T13:00:00.000Z', por: { id: 'u1', nome: 'Rodrigo' }, mae: null, maeArquivada: false, listas: 2, tarefas: 5, listasQueVoltam: 1 }],
  listas: [{ id: 'l-teste', name: 'Teste teste', arquivadaEm: '2026-10-19T12:00:00.000Z', por: null, pasta: null, maeArquivada: false, tarefas: 3 }],
};

beforeEach(() => {
  permissoes = ['tarefas.ver', 'tarefas.editar'];
  get.mockReset(); post.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/lixeira')) {
      const q = new URLSearchParams(rota.split('?')[1] ?? '');
      const tarefas = LIXEIRA.tarefas.filter((t) => (!q.get('estado') || t.estado === q.get('estado')) && (!q.get('q') || t.title.toLowerCase().includes(q.get('q')!.toLowerCase())));
      return Promise.resolve({ ...LIXEIRA, tarefas, total: tarefas.length });
    }
    if (rota === '/trabalho/arquivadas') return Promise.resolve(ARQUIVADAS);
    return Promise.resolve(null);
  });
  post.mockImplementation((rota: string, corpo: { ids?: string[] }) => {
    if (rota === '/trabalho/lixeira/restaurar') return Promise.resolve({ restauradas: corpo.ids!.length, ids: corpo.ids, jaVivas: 0, avisos: ['A lista Operação continua arquivada: a tarefa voltou, mas só aparece quando a lista for desarquivada.'] });
    if (rota === '/trabalho/lixeira/apagar-de-vez') return Promise.resolve({ apagadas: 1, ids: corpo.ids, presas: [] });
    return Promise.resolve({ id: 'x', tipo: 'lista', destino: 'mesmo-lugar', pastasJunto: 0, listasJunto: 0, aviso: null });
  });
});
afterEach(cleanup);

describe('I2: a Lixeira', () => {
  it('lista excluídas e arquivadas com quando, por quem, de onde e o link do Registro de ações', async () => {
    render(<LixeiraPage />);
    const exc = await screen.findByTestId(`lixeira-tarefa-${EXC}`);
    expect(exc).toHaveTextContent('Pagar boleto');
    expect(exc).toHaveTextContent('excluída em 22/10/2026');
    expect(exc).toHaveTextContent('por Rodrigo');
    expect(exc).toHaveTextContent('de Operação · etapa A fazer');
    expect(exc).toHaveTextContent('sai pelo expurgo em 21/11/2026');
    const arq = screen.getByTestId(`lixeira-tarefa-${ARQ}`);
    expect(arq).toHaveTextContent('arquivada em 21/10/2026');
    expect(arq).toHaveTextContent('sem registro de quem tirou');
    expect(arq).toHaveTextContent('de Clientes / Onboarding de cliente · etapa Kit montado');
    expect(arq).toHaveTextContent('card da implantação');
    expect(within(exc).getByTestId(`lixeira-rastro-${EXC}`)).toHaveAttribute('href', `/rastro?entidade=${EXC}`);
    expect(screen.getByTestId('lixeira-expurgo')).toHaveTextContent('O expurgo automático está desligado');
  });

  it('busca e filtro vão à API; Restaurar em lote manda os marcados e mostra o aviso', async () => {
    render(<LixeiraPage />);
    await screen.findByTestId(`lixeira-tarefa-${EXC}`);
    fireEvent.click(screen.getByTestId('lixeira-filtro-excluida'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/trabalho/lixeira?estado=excluida', 'tok'));
    fireEvent.click(screen.getByTestId('lixeira-filtro-todas'));
    fireEvent.change(screen.getByTestId('lixeira-busca'), { target: { value: 'cliente' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/trabalho/lixeira?q=cliente', 'tok'));
    await waitFor(() => expect(screen.queryByTestId(`lixeira-tarefa-${EXC}`)).toBeNull());
    fireEvent.change(screen.getByTestId('lixeira-busca'), { target: { value: '' } });
    await screen.findByTestId(`lixeira-tarefa-${EXC}`);
    fireEvent.click(screen.getByLabelText('Marcar Pagar boleto'));
    fireEvent.click(screen.getByLabelText('Marcar Cliente X'));
    fireEvent.click(screen.getByTestId('lixeira-restaurar'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/lixeira/restaurar', { ids: [EXC, ARQ] }, 'tok'));
    expect(await screen.findByTestId('lixeira-aviso')).toHaveTextContent('2 tarefas restauradas');
    expect(screen.getByTestId('lixeira-aviso')).toHaveTextContent('continua arquivada');
  });

  it('Apagar de vez: só com admin.usuarios, só as excluídas, com a frase', async () => {
    render(<LixeiraPage />);
    await screen.findByTestId(`lixeira-tarefa-${EXC}`);
    expect(screen.queryByTestId('lixeira-apagar-de-vez')).toBeNull();
    cleanup();
    permissoes = ['tarefas.ver', 'tarefas.editar', 'admin.usuarios'];
    render(<LixeiraPage />);
    await screen.findByTestId(`lixeira-tarefa-${EXC}`);
    const apagar = screen.getByTestId('lixeira-apagar-de-vez');
    fireEvent.click(screen.getByLabelText('Marcar Cliente X'));
    expect(apagar).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Marcar Pagar boleto'));
    expect(apagar).not.toBeDisabled();
    fireEvent.click(apagar);
    const confirmar = screen.getByTestId('lixeira-apagar-confirmar');
    expect(confirmar).toBeDisabled();
    fireEvent.change(screen.getByTestId('lixeira-frase'), { target: { value: 'Apagar de vez' } });
    fireEvent.click(confirmar);
    // Só a excluída vai (o card da implantação marcado não sai de vez).
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/lixeira/apagar-de-vez', { ids: [EXC], frase: 'Apagar de vez' }, 'tok'));
    expect(await screen.findByTestId('lixeira-aviso')).toHaveTextContent('1 tarefa apagada de vez');
  });

  it('Listas e pastas: o Desarquivar em lote, pastas primeiro, com a busca', async () => {
    render(<LixeiraPage />);
    fireEvent.click(await screen.findByTestId('lixeira-aba-listas'));
    const crm = await screen.findByTestId('lixeira-pasta-p-crm');
    expect(crm).toHaveTextContent('arquivada em 21/10/2026');
    expect(crm).toHaveTextContent('por Rodrigo');
    expect(crm).toHaveTextContent('2 listas · 5 tarefas');
    expect(screen.getByTestId('lixeira-lista-l-teste')).toHaveTextContent('estava sem pasta');
    fireEvent.click(screen.getByLabelText('Marcar Teste teste'));
    fireEvent.click(screen.getByLabelText('Marcar CRM'));
    fireEvent.click(screen.getByTestId('lixeira-listas-restaurar'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/trabalho/pastas/p-crm/desarquivar', '/trabalho/listas/l-teste/desarquivar']);
    fireEvent.change(screen.getByTestId('lixeira-listas-busca'), { target: { value: 'crm' } });
    expect(screen.queryByTestId('lixeira-lista-l-teste')).toBeNull();
  });

  it('sem a permissão de apagar, a tela diz que não é para a pessoa', async () => {
    permissoes = ['tarefas.ver'];
    render(<LixeiraPage />);
    expect(screen.getByText(/A Lixeira é de quem pode apagar no Trabalho/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
