import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* ROOT-09-C2: a lupa da Topbar abre a Paleta abaixo de 1024 px e os temas da gaveta ficam em linha. */

const PERMISSOES = ['dashboard.ver', 'tarefas.ver', 'pauta.ver', 'leads.ver', 'mcp.ver'];

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
    logout: vi.fn(),
  }),
}));

vi.mock('@/components/modulos', () => ({
  useModulos: () => ({ modulos: null, ligado: () => true }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/painel',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, title, ...resto }: { href: string; children: React.ReactNode; title?: string }) => (
    <a href={href} title={title} {...resto}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line import/first
import { Topbar } from '@/components/Topbar';
// eslint-disable-next-line import/first
import { Sidebar, CHAVE_TEMA } from '@/components/Sidebar';

beforeEach(() => {
  localStorage.clear();
});

describe('lupa da Topbar', () => {
  it('abaixo de 1024 px a lupa abre a Paleta, a busca por "assinatura" cai no estado vazio e Esc devolve o foco', async () => {
    const user = userEvent.setup();
    render(<Topbar />);
    const lupa = screen.getByRole('button', { name: 'Buscar no menu' });
    expect(lupa.className).toContain('min-[1024px]:hidden');

    await user.click(lupa);
    const dialogo = screen.getByRole('dialog', { name: 'Ir para' });
    expect(dialogo).toBeInTheDocument();
    const campo = within(dialogo).getByPlaceholderText('ir para…');
    await vi.waitFor(() => expect(campo).toHaveFocus());

    await user.type(campo, 'assinatura');
    expect(screen.getByText('Nenhuma tela do menu tem esse nome.')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(lupa).toHaveFocus();
  });

  it('a lupa abre a mesma lista de telas que o ⌘K', async () => {
    const user = userEvent.setup();
    render(<Topbar />);
    await user.click(screen.getByRole('button', { name: 'Buscar no menu' }));
    const viaLupa = screen.getAllByRole('listitem').length;
    await user.keyboard('{Escape}');
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getAllByRole('listitem')).toHaveLength(viaLupa);
  });

  it('a partir de 1024 px a lupa some e o campo "ir para…" aparece', () => {
    render(<Topbar />);
    const lupa = screen.getByRole('button', { name: 'Buscar no menu' });
    expect(lupa.className).toContain('min-[1024px]:hidden');
    const campo = screen.getByPlaceholderText('ir para…');
    expect(campo.parentElement!.className).toMatch(/\bhidden\b/);
    expect(campo.parentElement!.className).toContain('min-[1024px]:block');
  });
});

describe('temas da gaveta', () => {
  it('os três botões moram no mesmo contêiner, em linha, e trocar escreve root-os:tema', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const grupo = screen.getByRole('group', { name: 'Tema da interface' });
    expect(grupo.className).toContain('flex-row');
    expect(grupo.className).not.toContain('flex-col');
    const botoes = grupo.querySelectorAll('button');
    expect(botoes).toHaveLength(3);

    await user.click(botoes[1]);
    expect(localStorage.getItem(CHAVE_TEMA)).toBe('light');
    expect(botoes[1]).toHaveAttribute('aria-pressed', 'true');
  });
});
