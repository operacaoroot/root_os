import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * A RODADA DA SEMANA NA IMPLANTAÇÃO (versão final, F4, 19/10/2026): como era a
 * "Operação" da produção, a Implantação ganha a aba "Rodada da semana" do Pedro, só
 * para a sessão da plataforma (a ROOT). Sem a sessão da plataforma, nenhuma aba aparece
 * e a tela é a implantação de sempre. `/operacao` continua viva (a aba é a mesma tela).
 */

const apiGet = vi.fn();
vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(), apiBlob: vi.fn() };
});
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u-eu', name: 'Rodrigo' }, can: (p: string) => ['tarefas.ver', 'tarefas.editar'].includes(p) }),
}));

// eslint-disable-next-line import/first
import ImplantacaoPage from '@/app/trabalho/implantacao/page';
// eslint-disable-next-line import/first
import { ErroDaApi } from '@/lib/api';

const ONB = { id: 'l-onb', name: 'Onboarding de cliente', order: 0, externalId: null, total: 0, fields: [], statuses: [{ id: 's-1', name: 'Fechado no comercial', type: 'custom', color: '#4194f6', order: 0, total: 0, limite: null }] };
const ESTRUTURA = { espacos: [], folders: [{ id: 'f-cli', name: 'Clientes', parentId: null, order: 0, lists: [ONB] }], listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [], pessoas: [] };

let plataforma = true;
beforeEach(() => {
  plataforma = true;
  window.history.replaceState({}, '', '/trabalho/implantacao');
  apiGet.mockReset();
  apiGet.mockImplementation((rota: string) => {
    if (rota === '/tenants/plataforma/quem-sou') return plataforma ? Promise.resolve({ plataforma: true }) : Promise.reject(new ErroDaApi('Acesso insuficiente.', 403));
    if (rota.startsWith('/tenants/plataforma/operacao/painel')) return Promise.resolve({ rodada: null, rodadas: [], importadaEm: null, conteudo: null });
    if (rota === '/trabalho/estrutura') return Promise.resolve(ESTRUTURA);
    if (rota.startsWith('/trabalho/tarefas?')) return Promise.resolve({ items: [], total: 0, source: { tool: 'qa', generatedAt: '2026-10-19T12:00:00.000Z' } });
    if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve({ itens: [] });
    if (rota.startsWith('/trabalho/vistas')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
});
afterEach(cleanup);

describe('Implantação · Rodada da semana', () => {
  it('a ROOT vê as duas abas; a Rodada é a tela do /operacao e fica no endereço', async () => {
    render(<ImplantacaoPage />);
    const rodada = await screen.findByTestId('implantacao-aba-rodada');
    expect(screen.getByTestId('implantacao-aba-implantacao')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Implantação de clientes' })).toBeInTheDocument();
    fireEvent.click(rodada);
    expect(new URLSearchParams(window.location.search).get('aba')).toBe('rodada');
    expect(await screen.findByText('Operação da Root')).toBeInTheDocument();
    await waitFor(() => expect(apiGet.mock.calls.some(([r]) => String(r).startsWith('/tenants/plataforma/operacao/painel'))).toBe(true));
  });

  it('fora da sessão da plataforma não há abas, nem com ?aba=rodada no link', async () => {
    plataforma = false;
    window.history.replaceState({}, '', '/trabalho/implantacao?aba=rodada');
    render(<ImplantacaoPage />);
    expect(await screen.findByRole('heading', { name: 'Implantação de clientes' })).toBeInTheDocument();
    await waitFor(() => expect(apiGet.mock.calls.some(([r]) => r === '/tenants/plataforma/quem-sou')).toBe(true));
    expect(screen.queryByTestId('implantacao-aba-rodada')).toBeNull();
    expect(apiGet.mock.calls.some(([r]) => String(r).startsWith('/tenants/plataforma/operacao/painel'))).toBe(false);
  });
});
