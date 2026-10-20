import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NAV } from '@mktos/shared';

/*
 * O balão da área no menu recolhido (rodada da interface, 20/10/2026, U1, item 3 da ata).
 * Com o menu em 64 px, hover, foco ou toque no ícone de uma área abre um balão ao lado com
 * as subseções. Interativo: a ponte de hover deixa entrar nele, setas andam, Esc fecha e
 * devolve o foco ao ícone, um balão por vez.
 */

let CAMINHO = '/comercial';
const PERMISSOES = [...new Set(NAV.map((n) => n.permission))];

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES }, can: () => true }),
}));
vi.mock('@/lib/plataforma', () => ({ useEhPlataforma: () => false }));
vi.mock('@/components/modulos', () => ({ useModulos: () => ({ modulos: null, ligado: () => true }) }));
vi.mock('@/components/caixa', async () => {
  const real = await vi.importActual<typeof import('@/components/caixa')>('@/components/caixa');
  return {
    ...real,
    useCaixa: () => ({ contador: { quantos: 3, parcial: false, aprovacoes: 2, tarefas: 1, medidoEm: new Date().toISOString() }, falhou: false, carregando: false, recarregar: () => {} }),
  };
});
vi.mock('next/navigation', () => ({ usePathname: () => CAMINHO, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line import/first
import { PONTE_DO_BALAO_MS, Sidebar } from '@/components/Sidebar';

const icone = (chave: string) => document.querySelector<HTMLAnchorElement>(`#root-os-nav a[data-area="${chave}"]`)!;
const grupo = (chave: string) => icone(chave).closest<HTMLElement>('[data-grupo-da-area]')!;
const baloes = () => screen.queryAllByRole('group').filter((g) => g.hasAttribute('data-balao-da-area'));
const balao = (nome: string) => screen.getByRole('group', { name: nome });

function renderRecolhido() {
  localStorage.setItem('root-os:menu-recolhido', '1');
  return render(<Sidebar />);
}

beforeEach(() => {
  localStorage.clear();
  CAMINHO = '/comercial';
});

describe('o menu recolhido', () => {
  it('não mostra lista de subseções: só os ícones das áreas, com o nome para leitor de tela', () => {
    renderRecolhido();
    expect(screen.getByRole('button', { name: 'Expandir menu' })).toBeInTheDocument();
    expect(screen.queryAllByRole('list', { name: /^Subseções de / })).toHaveLength(0);
    expect(icone('comercial')).toHaveAccessibleName('Comercial');
    expect(baloes()).toHaveLength(0);
  });

  it('a logo vira só o R, e o selo de Pendências continua no Dia a dia', () => {
    renderRecolhido();
    const logo = screen.getByRole('link', { name: 'ROOT OS, início' });
    expect(logo.querySelector('[data-logo-root]')).toHaveAttribute('data-forma', 'recolhida');
    expect(icone('dia').textContent).toContain('3');
    expect(within(icone('dia')).getByLabelText(/aprovação\(ões\) que você pode assinar/)).toBeInTheDocument();
  });
});

describe('o balão da área', () => {
  it('abre no hover, com o nome da área como título e os links das subseções', async () => {
    renderRecolhido();
    fireEvent.mouseEnter(grupo('comercial'));
    const g = balao('Comercial');
    expect(within(g).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Painel geral', 'Funil vivo', 'Propostas', 'Lista de leads', 'Contratos vivos', 'Torre das automações', 'Relatório da semana',
    ]);
    expect(within(g).getByRole('link', { name: 'Painel geral' })).toHaveAttribute('aria-current', 'page');
    expect(icone('comercial')).toHaveAttribute('aria-expanded', 'true');
    expect(icone('comercial')).toHaveAttribute('aria-controls', g.id);
    expect(g.style.position).toBe('fixed');
  });

  it('a ponte de hover: sair do ícone e entrar no balão não fecha; sair dos dois fecha depois da ponte', async () => {
    vi.useFakeTimers();
    try {
      renderRecolhido();
      fireEvent.mouseEnter(grupo('trabalho'));
      expect(balao('Trabalho')).toBeInTheDocument();
      fireEvent.mouseLeave(grupo('trabalho'));
      act(() => { vi.advanceTimersByTime(PONTE_DO_BALAO_MS - 50); });
      // O mouse chega ao balão (que mora dentro do grupo) antes da ponte acabar.
      fireEvent.mouseEnter(grupo('trabalho'));
      act(() => { vi.advanceTimersByTime(PONTE_DO_BALAO_MS * 2); });
      expect(balao('Trabalho')).toBeInTheDocument();
      fireEvent.mouseLeave(grupo('trabalho'));
      act(() => { vi.advanceTimersByTime(PONTE_DO_BALAO_MS + 10); });
      expect(baloes()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('um balão por vez', () => {
    renderRecolhido();
    fireEvent.mouseEnter(grupo('comercial'));
    fireEvent.mouseEnter(grupo('trabalho'));
    expect(baloes()).toHaveLength(1);
    expect(balao('Trabalho')).toBeInTheDocument();
    expect(icone('comercial')).toHaveAttribute('aria-expanded', 'false');
  });

  it('pelo teclado: o foco no ícone abre, Tab e setas andam pelos links, Esc fecha e devolve o foco ao ícone', async () => {
    const user = userEvent.setup();
    renderRecolhido();
    act(() => icone('comercial').focus());
    const g = balao('Comercial');
    const links = within(g).getAllByRole('link');
    await user.tab();
    expect(links[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(links[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(links[links.length - 1]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(links[0]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(baloes()).toHaveLength(0);
    expect(icone('comercial')).toHaveFocus();
    // O foco devolvido não reabre o balão.
    expect(baloes()).toHaveLength(0);
  });

  it('seta para baixo no ícone entra no balão; Tab do último link vai à área seguinte e troca de balão', async () => {
    const user = userEvent.setup();
    renderRecolhido();
    act(() => icone('whatsapp').focus());
    expect(balao('WhatsApp')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(within(balao('WhatsApp')).getByRole('link', { name: 'WhatsApp' })).toHaveFocus());
    await user.tab();
    expect(icone('financeiro')).toHaveFocus();
    expect(baloes()).toHaveLength(1);
    expect(balao('Financeiro')).toBeInTheDocument();
  });

  it('Esc no ícone também fecha', async () => {
    const user = userEvent.setup();
    renderRecolhido();
    act(() => icone('trabalho').focus());
    expect(balao('Trabalho')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(baloes()).toHaveLength(0);
    expect(icone('trabalho')).toHaveFocus();
  });

  it('no toque, o primeiro toque abre o balão em vez de navegar; tocar fora fecha', () => {
    renderRecolhido();
    // A ordem de um toque no navegador: touchstart, os eventos de mouse emulados
    // (mouseenter, mousedown com o foco) e, por fim, o click.
    fireEvent.touchStart(icone('trabalho'));
    fireEvent.mouseEnter(grupo('trabalho'));
    act(() => icone('trabalho').focus());
    expect(baloes()).toHaveLength(0);
    const clique = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => { icone('trabalho').dispatchEvent(clique); });
    expect(clique.defaultPrevented).toBe(true);
    expect(balao('Trabalho')).toBeInTheDocument();
    // Tocar fora fecha.
    act(() => { fireEvent.pointerDown(document.body); });
    expect(baloes()).toHaveLength(0);
    // De novo: o primeiro toque abre, o segundo no mesmo ícone navega.
    const tocar = () => {
      fireEvent.touchStart(icone('trabalho'));
      const e = new MouseEvent('click', { bubbles: true, cancelable: true });
      act(() => { icone('trabalho').dispatchEvent(e); });
      return e;
    };
    expect(tocar().defaultPrevented).toBe(true);
    expect(balao('Trabalho')).toBeInTheDocument();
    expect(tocar().defaultPrevented).toBe(false);
  });

  it('com o menu aberto não há balão: as subseções ficam na lista da área', () => {
    render(<Sidebar />);
    fireEvent.mouseEnter(grupo('trabalho'));
    act(() => icone('trabalho').focus());
    expect(baloes()).toHaveLength(0);
    expect(screen.getByRole('list', { name: 'Subseções de Comercial' })).toBeInTheDocument();
  });

  it('expandir o menu fecha o balão aberto', async () => {
    const user = userEvent.setup();
    renderRecolhido();
    fireEvent.mouseEnter(grupo('comercial'));
    expect(balao('Comercial')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expandir menu' }));
    expect(baloes()).toHaveLength(0);
    expect(screen.getByRole('list', { name: 'Subseções de Comercial' })).toBeInTheDocument();
  });
});
