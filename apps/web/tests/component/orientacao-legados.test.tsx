import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiGet = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a), apiPatch: vi.fn() };
});

let PODE_EDITAR = false;

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['tarefas.ver'] },
    can: () => PODE_EDITAR,
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
    PODE_EDITAR = false;
    apiGet.mockResolvedValue({ total: 0, items: [], statuses: [], eixos: [], formatos: [], overdue: 0 });
  });

  it('/conteudo diz que é espelho do ClickUp, sem dizer leitura, e aponta Quadro interno, Pauta e Banco de ideias', async () => {
    render(<ConteudoPage />);
    const nota = await screen.findByTestId('conteudo-orientacao');
    expect(hrefs(nota)).toEqual(['/trabalho', '/pauta', '/marketing/ideias']);
    expect(screen.getByText(/espelho da lista Gestão de/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('para consulta');
  });

  it('/tarefas aponta o Quadro interno como lugar do trabalho do dia a dia', async () => {
    const { container } = render(<TarefasPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(hrefs(container)).toContain('/trabalho');
    expect(container.textContent).toContain('Quadro interno');
    expect(container.textContent).toContain('separada do quadro interno');
    expect(container.textContent).not.toContain('para consulta');
  });

  it('com permissão de editar, os seletores de etapa existem e o texto não promete só leitura', async () => {
    PODE_EDITAR = true;
    apiGet.mockImplementation((rota: string) =>
      Promise.resolve(
        rota.startsWith('/content')
          ? {
              total: 1,
              statuses: ['ideia'],
              eixos: [],
              formatos: [],
              items: [{ id: 'c1', title: 'Tema', status: 'ideia', statusType: 'open' }],
            }
          : {
              total: 1,
              overdue: 0,
              items: [{ id: 't1', title: 'Tarefa', status: 'aberta', priority: 'media', assignee: null }],
            },
      ),
    );
    for (const Pagina of [ConteudoPage, TarefasPage]) {
      const { container, unmount } = render(<Pagina />);
      await waitFor(() => expect(container.querySelector('select[title], td select')).not.toBeNull());
      expect(container.textContent).not.toContain('para consulta');
      expect(container.textContent?.toLowerCase()).not.toContain('somente leitura');
      unmount();
    }
  });
});
