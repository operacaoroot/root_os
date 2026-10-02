import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiGet = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a), apiPatch: vi.fn() };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['tarefas.ver'] },
    can: () => false,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// eslint-disable-next-line import/first
import ConteudoPage from '@/app/conteudo/page';
// eslint-disable-next-line import/first
import TarefasPage from '@/app/tarefas/page';

const hrefs = (el: HTMLElement) => Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));

describe('texto de orientação das telas legadas', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ total: 0, items: [], statuses: [], eixos: [], formatos: [], overdue: 0 });
  });

  it('/conteudo diz que é espelho para consulta e aponta Quadro interno, Pauta e Banco de ideias', async () => {
    render(<ConteudoPage />);
    const nota = await screen.findByTestId('conteudo-orientacao');
    expect(hrefs(nota)).toEqual(['/trabalho', '/pauta', '/marketing/ideias']);
    expect(screen.getByText(/espelho da lista Gestão de/)).toBeTruthy();
  });

  it('/tarefas aponta o Quadro interno como lugar do trabalho migrado', async () => {
    const { container } = render(<TarefasPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(hrefs(container)).toContain('/trabalho');
    expect(container.textContent).toContain('Quadro interno');
    expect(container.textContent).not.toContain('separada do quadro interno');
  });
});
