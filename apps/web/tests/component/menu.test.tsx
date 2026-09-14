import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * O MENU EM DOIS NÍVEIS — fatia A1 de docs/PLANO-CONTROLE-DE-AGENTES.md.
 *
 * A forma vem do painel do Paperclip: seções que abrem e fecham, com sub-itens
 * dentro do item que os abriga. `nav.test.ts` cobra o DADO (quem é filho de
 * quem, e que ninguém desaparece); esta suíte cobra a TELA, que é onde as duas
 * coisas que custam acesso acontecem:
 *
 *  1. O filho é desenhado DENTRO do pai — se ele voltar para o topo, o submenu
 *     virou enfeite e a barra volta a ser uma lista de 27 coisas.
 *  2. FECHAR É CSS, e só vale no menu largo. Abaixo de 820px a barra é um
 *     trilho de ícones sem cabeçalho de seção: se o fechar apagasse os itens do
 *     DOM, quem estivesse no trilho perderia telas sem ter como reabrir.
 *  3. A seção da tela ABERTA nunca fica fechada, mesmo que a pessoa a tenha
 *     fechado antes. Menu que esconde onde você está desorienta.
 */

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

describe('o submenu da barra lateral', () => {
  it('desenha Tarefas dentro de Trabalho, e não no topo da seção', () => {
    render(<Sidebar />);
    const trabalho = link('/trabalho')!;
    const tarefas = link('/tarefas')!;
    expect(trabalho).toBeInTheDocument();
    // o mesmo invólucro: é isso que faz o filho andar junto com o pai
    expect(trabalho.parentElement).toBe(tarefas.parentElement);
    // e o pai vem primeiro
    expect(trabalho.compareDocumentPosition(tarefas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fechar a seção esconde por CSS e guarda a escolha — sem apagar do DOM', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const cabecalho = screen.getByRole('button', { name: /a execução/i });
    expect(cabecalho).toHaveAttribute('aria-expanded', 'true');

    await user.click(cabecalho);

    expect(cabecalho).toHaveAttribute('aria-expanded', 'false');
    // O item CONTINUA no DOM: no trilho de ícones ele segue clicável.
    expect(link('/trabalho')).toBeInTheDocument();
    expect(link('/trabalho')!.parentElement!.parentElement).toHaveClass('hidden');
    expect(JSON.parse(localStorage.getItem(CHAVE_MENU)!)).toContain('execucao');
  });

  it('a seção da tela aberta ignora o fechamento guardado', () => {
    localStorage.setItem(CHAVE_MENU, JSON.stringify(['execucao']));
    CAMINHO = '/tarefas';
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /a execução/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
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
