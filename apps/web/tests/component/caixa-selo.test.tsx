import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CaixaContextValue } from '@/components/caixa';

/*
 * ==========================================================================
 * O SELO DA CAIXA NA BARRA LATERAL — fatia A7
 * ==========================================================================
 *
 * `tests/unit/caixa-selo.test.ts` cobra as FRASES (o que o selo escreve e o que
 * ele se recusa a escrever). Esta suíte cobra a BARRA: que o selo está no item
 * certo, que ele carrega a explicação num `title` e que ele não aparece em item
 * nenhum além da Caixa.
 *
 * O terceiro caso é o que evita o pior desfecho: um selo grudado no item errado
 * manda a pessoa procurar trabalho onde não há nenhum, e o número continua
 * certo — ninguém desconfia.
 */

let CAIXA: CaixaContextValue = {
  contador: {
    quantos: 3,
    parcial: false,
    aprovacoes: 2,
    tarefas: 1,
    medidoEm: new Date().toISOString(),
  },
  falhou: false,
  carregando: false,
  recarregar: () => {},
};

vi.mock('@/lib/plataforma', () => ({ useEhPlataforma: () => false }));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: {
      id: 'u1',
      name: 'Pedro',
      email: 'p@x.com',
      roles: [],
      permissions: ['dashboard.ver', 'mcp.ver', 'tarefas.ver'],
    },
    can: () => true,
  }),
}));

vi.mock('@/components/modulos', () => ({
  useModulos: () => ({ modulos: null, ligado: () => true }),
}));

vi.mock('@/components/caixa', async () => {
  const real = await vi.importActual<typeof import('@/components/caixa')>('@/components/caixa');
  return { ...real, useCaixa: () => CAIXA };
});

vi.mock('next/navigation', () => ({ usePathname: () => '/painel' }));

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
import { Sidebar } from '@/components/Sidebar';

// Versão final (19/10/2026): o Dia a dia entra na Visão geral (/dia-a-dia); o selo continua no item da área.
// Desde 20/10/2026 a logo e a subseção Visão geral também levam a /dia-a-dia: o item é o da área.
const itemDaCaixa = () => document.querySelector('#root-os-nav a[data-area="dia"]');

describe('A7: o selo mora no item da Caixa, e explica o que é', () => {
  it('o número medido aparece dentro do item da Caixa', () => {
    render(<Sidebar />);
    const item = itemDaCaixa();
    expect(item).toBeTruthy();
    expect(item!.textContent).toContain('3');
  });

  it('o selo carrega a frase com a hora da medição — número sem hora promete tempo real', () => {
    render(<Sidebar />);
    const selo = screen.getByLabelText(/aprovação\(ões\) que você pode assinar/);
    expect(selo.getAttribute('title')).toMatch(/Medido às \d{2}:\d{2}/);
  });

  it('nenhum outro item do menu ganha selo', () => {
    render(<Sidebar />);
    const outros = [...document.querySelectorAll('a[href]')].filter((a) => a !== itemDaCaixa());
    for (const a of outros) {
      expect(a.querySelector('[aria-label]'), `${a.getAttribute('href')} ganhou selo`).toBeNull();
    }
  });

  it('medição que falhou desenha "?" — e o "?" se explica', () => {
    CAIXA = { contador: null, falhou: true, carregando: false, recarregar: () => {} };
    render(<Sidebar />);
    expect(itemDaCaixa()!.textContent).toContain('?');
    expect(screen.getByLabelText(/não é zero/)).toBeTruthy();
  });

  it('zero não desenha selo nenhum: vitória se diz na tela, não em cima do ícone', () => {
    CAIXA = {
      contador: { quantos: 0, parcial: false, aprovacoes: 0, tarefas: 0, medidoEm: new Date().toISOString() },
      falhou: false,
      carregando: false,
      recarregar: () => {},
    };
    render(<Sidebar />);
    expect(itemDaCaixa()!.querySelector('[aria-label]')).toBeNull();
  });
});
