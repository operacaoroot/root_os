import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiGet = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a) };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['dashboard.ver'] },
    can: () => true,
  }),
}));

vi.mock('@/app/custo-ia/Pilula', () => ({ PilulaCustoIa: () => null }));

// eslint-disable-next-line import/first
import DashboardPage from '@/app/painel/page';

describe('painel: cartão "Tarefas atrasadas"', () => {
  beforeEach(() => {
    apiGet.mockReset();
    const resumo = new Proxy({} as Record<string, unknown>, { get: (_t, k) => (k === 'then' ? undefined : 0) });
    apiGet.mockResolvedValue(resumo);
  });

  it('leva ao Quadro interno, não à lista paralela /tarefas', async () => {
    render(<DashboardPage />);
    const rotulo = await screen.findByText('Tarefas atrasadas');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/dashboard/summary', 'tok'));
    const link = rotulo.closest('a');
    expect(link?.getAttribute('href')).toBe('/trabalho');
  });
});
