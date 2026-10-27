import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACOES_DO_MENU_DA_TAREFA, type TarefasDoComercial } from '@mktos/shared';

/*
 * O MENU DA TAREFA NAS TAREFAS DO COMERCIAL (rodada de produção 3, I4): o bloco do
 * Funil vivo e o bloco "Tarefas" do painel do lead usam a mesma lista; o botão
 * direito e o "⋯" abrem o mesmo menu do Trabalho, e a ação recarrega a lista.
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn(), del = vi.fn();
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: (...a: unknown[]) => del(...a),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu', roles: ['admin_master'] }, can: () => true }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/comercial/funil', useSearchParams: () => new URLSearchParams() }));
import { ListaDeTarefasDoComercial } from '@/app/comercial/_funil/TarefasDoComercial';

const T = '33333333-3333-4333-8333-333333333333';
const V1 = '2026-10-22T10:00:00.000Z';
const dados: TarefasDoComercial = {
  hoje: '2026-10-22', pessoas: [],
  tarefas: [{ id: T, titulo: 'Ligar para o lead', pessoa: null, responsavelTexto: null, prazo: null, situacao: 'sem_prazo', status: { nome: 'A fazer', tipo: 'aberta' }, lead: null, criadaEm: V1, updatedAt: V1 }],
} as unknown as TarefasDoComercial;

beforeEach(() => {
  get.mockReset(); post.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota === `/trabalho/tarefas/${T}`) return Promise.resolve({ id: T, title: 'Ligar para o lead', listId: 'lc', updatedAt: V1, archived: false, excluidaEm: null, agenteId: null, parentId: null });
    if (rota === '/trabalho/estrutura') return Promise.resolve({ folders: [], listasSoltas: [] });
    if (rota.startsWith('/tenants/onboarding/trilhos?')) return Promise.resolve([]);
    return Promise.resolve(null);
  });
  post.mockResolvedValue({ id: T, excluidaEm: V1, expiraEm: V1 });
});
afterEach(cleanup);

describe('I4: o menu nas tarefas do comercial', () => {
  it('o "⋯" e o botão direito abrem o menu; excluir chama a API e recarrega a lista', async () => {
    const aoMudar = vi.fn().mockResolvedValue(undefined);
    render(<ListaDeTarefasDoComercial dados={dados} testId="lista" aoMudar={aoMudar} vazio="nada" />);
    fireEvent.click(screen.getByTestId(`menu-da-tarefa-botao-${T}`));
    let menu = await screen.findByTestId('menu-da-tarefa');
    // Leva 5, L2: as 8 ações mais "Histórico"; a conta é a do shared, para a lista crescer num lugar só.
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(ACOES_DO_MENU_DA_TAREFA.length);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('menu-da-tarefa')).toBeNull());

    fireEvent.contextMenu(screen.getByTestId(`tarefa-${T}`), { clientX: 30, clientY: 30 });
    menu = await screen.findByTestId('menu-da-tarefa');
    await waitFor(() => expect(within(menu).getByTestId('menu-da-tarefa-excluir')).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(within(menu).getByTestId('menu-da-tarefa-excluir'));
    fireEvent.click(await screen.findByTestId('menu-da-tarefa-excluir-confirmar'));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/trabalho/tarefas/${T}/excluir`, { expectedUpdatedAt: V1 }, 'tok'));
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());
  });
});
