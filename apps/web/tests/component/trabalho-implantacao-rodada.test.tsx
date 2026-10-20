import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * A RODADA DA SEMANA SAIU DA IMPLANTAÇÃO (rodada da interface, 20/10/2026, U1, item 10).
 * Ela foi para o Comercial (`/comercial/rodada`), com a mesma trava de plataforma de
 * `/operacao`. A Implantação não tem mais aba nenhuma: nem para a ROOT, nem com
 * `?aba=rodada` no link, que passa a mandar para o endereço novo com o resto da query.
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
import RodadaPage from '@/app/comercial/rodada/page';
// eslint-disable-next-line import/first
import OperacaoPage from '@/app/operacao/page';
// eslint-disable-next-line import/first
import { destinoDaAbaRodada } from '@/lib/rotas-movidas';
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

describe('Implantação sem a Rodada da semana', () => {
  it('nem a ROOT vê aba: a tela é a implantação de sempre, sem ler o painel da operação', async () => {
    render(<ImplantacaoPage />);
    expect(await screen.findByRole('heading', { name: 'Implantação de clientes' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Implantação' })).toBeNull();
    expect(screen.queryByTestId('implantacao-aba-rodada')).toBeNull();
    expect(apiGet.mock.calls.some(([r]) => String(r).startsWith('/tenants/plataforma/operacao/painel'))).toBe(false);
  });

  it('?aba=rodada manda para /comercial/rodada, com o resto da query e sem a aba', async () => {
    const replace = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, search: '?aba=rodada&rodada=2026-10-19', replace } });
    try {
      render(<ImplantacaoPage />);
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/comercial/rodada?rodada=2026-10-19'));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('o destino da aba antiga: só ?aba=rodada redireciona', () => {
    expect(destinoDaAbaRodada({ aba: 'rodada' })).toBe('/comercial/rodada');
    expect(destinoDaAbaRodada({ aba: ['rodada', 'x'], lista: 'l1' })).toBe('/comercial/rodada?lista=l1');
    expect(destinoDaAbaRodada({ aba: 'implantacao' })).toBeNull();
    expect(destinoDaAbaRodada({})).toBeNull();
  });
});

describe('a Rodada da semana no Comercial', () => {
  it('a ROOT vê a tela do /operacao em /comercial/rodada', async () => {
    render(<RodadaPage />);
    expect(await screen.findByText('Operação da Root')).toBeInTheDocument();
    await waitFor(() => expect(apiGet.mock.calls.some(([r]) => String(r).startsWith('/tenants/plataforma/operacao/painel'))).toBe(true));
  });

  it('fora da plataforma devolve o mesmo aviso que o /operacao', async () => {
    plataforma = false;
    const { unmount } = render(<RodadaPage />);
    const aviso = (await screen.findByText('Esta área é da ROOT.')).parentElement!.textContent;
    unmount();
    render(<OperacaoPage />);
    expect((await screen.findByText('Esta área é da ROOT.')).parentElement!.textContent).toBe(aviso);
    expect(apiGet.mock.calls.some(([r]) => String(r).startsWith('/tenants/plataforma/operacao/painel'))).toBe(false);
  });
});
