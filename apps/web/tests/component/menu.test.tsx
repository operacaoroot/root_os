import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* A sidebar preserva a hierarquia declarada, o acesso e a seção ativa. */

let PERMISSOES: string[] = [];
let CAMINHO = '/painel';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));

vi.mock('@/components/modulos', () => ({
  useModulos: () => ({ modulos: null, ligado: () => true }),
}));

vi.mock('next/navigation', () => ({ usePathname: () => CAMINHO }));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    title,
    ...resto
  }: {
    href: string;
    children: React.ReactNode;
    title?: string;
  }) => (
    <a href={href} title={title} {...resto}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line import/first
import { Sidebar, CHAVE_MENU } from '@/components/Sidebar';

const TODAS = ['dashboard.ver', 'tarefas.ver', 'pauta.ver', 'leads.ver', 'mcp.ver'];

const link = (href: string) => document.querySelector(`a[href="${href}"]`);

beforeEach(() => {
  PERMISSOES = [...TODAS];
  CAMINHO = '/painel';
  localStorage.clear();
});

describe('a barra lateral', () => {
  it('abre a gaveta móvel com nomes visíveis e fecha com Escape', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const abrir = screen.getByRole('button', { name: 'Abrir navegação' });
    expect(abrir).toHaveAttribute('aria-expanded', 'false');

    await user.click(abrir);
    expect(abrir).toHaveAttribute('aria-expanded', 'true');
    const gaveta = screen.getByRole('dialog', { name: 'Navegação do ROOT OS' });
    expect(gaveta).toHaveTextContent('Pendências');
    expect(gaveta).toHaveTextContent('Quadro interno');

    await user.keyboard('{Escape}');
    expect(abrir).toHaveAttribute('aria-expanded', 'false');
    expect(abrir).toHaveFocus();
  });

  it('bloqueia scroll do fundo e encerra o modo modal ao passar para desktop', async () => {
    const ouvintes = new Set<(e: MediaQueryListEvent) => void>();
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '(min-width: 820px)',
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => ouvintes.add(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => ouvintes.delete(fn),
    }));
    try {
      const user = userEvent.setup();
      render(<><main id="root-os-main" tabIndex={-1} /><Sidebar /></>);
      const abrir = screen.getByRole('button', { name: 'Abrir navegação' });
      await user.click(abrir);
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.overflow).toBe('hidden');
      await waitFor(() => expect(document.querySelector('#root-os-nav button[aria-label="Fechar navegação"]')).toHaveFocus());

      act(() => {
        for (const fn of ouvintes) fn({ matches: true } as MediaQueryListEvent);
      });
      expect(abrir).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.getElementById('root-os-main')).toHaveFocus();
      expect(document.body.style.overflow).toBe('');
      expect(document.documentElement.style.overflow).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('desenha Referências dentro de Produção de conteúdo, e não no topo da seção', () => {
    render(<Sidebar />);
    const trabalho = link('/pauta')!;
    const tarefas = link('/referencias')!;
    expect(trabalho).toBeInTheDocument();
    // o mesmo invólucro: é isso que faz o filho andar junto com o pai
    expect(trabalho.parentElement).toBe(tarefas.parentElement);
    // e o pai vem primeiro
    expect(trabalho.compareDocumentPosition(tarefas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fechar a seção esconde por CSS e guarda a escolha — sem apagar do DOM', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const cabecalho = screen.getByRole('button', { name: /trabalho/i });
    expect(cabecalho).toHaveAttribute('aria-expanded', 'true');

    await user.click(cabecalho);

    expect(cabecalho).toHaveAttribute('aria-expanded', 'false');
    // O item permanece no DOM para restaurar a escolha ao reabrir.
    expect(link('/trabalho')).toBeInTheDocument();
    expect(link('/trabalho')!.parentElement!.parentElement).toHaveClass('hidden');
    expect(JSON.parse(localStorage.getItem(CHAVE_MENU)!)).toContain('trabalho');
  });

  it('a seção da tela aberta ignora o fechamento guardado', () => {
    localStorage.setItem(CHAVE_MENU, JSON.stringify(['trabalho']));
    CAMINHO = '/tarefas';
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /trabalho/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('marca apenas Custos de IA quando a rota está dentro de /painel', () => {
    CAMINHO = '/painel/custo-ia';
    render(<Sidebar />);
    expect(link('/painel/custo-ia')).toHaveAttribute('aria-current', 'page');
    expect(link('/painel')).not.toHaveAttribute('aria-current');
  });

  /*
   * O caso real: `funil` pede `dashboard.ver` e o pai dele, `leads`, pede
   * `leads.ver`. Quem opera sem `leads.ver` TEM o Funil — e ele precisa
   * aparecer, no primeiro nível, e não sumir com o pai.
   */
  it('filho sem o pai aparece no primeiro nível', () => {
    PERMISSOES = ['dashboard.ver'];
    render(<Sidebar />);
    expect(link('/leads')).toBeNull();
    expect(link('/funil')).toBeInTheDocument();
  });
});
