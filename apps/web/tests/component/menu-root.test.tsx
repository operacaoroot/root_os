import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/*
 * O grupo ROOT do menu (hoje, Propostas) só aparece quando a API confirma a
 * sessão da plataforma. Empresa cliente tem as mesmas permissões e não pode ver.
 */

let EH_PLATAFORMA = false;
let CAMINHO = '/painel';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Lucas', email: 'l@x.com', roles: [], permissions: ['dashboard.ver', 'leads.ver'] },
    can: () => true,
  }),
}));

vi.mock('@/lib/plataforma', () => ({ useEhPlataforma: () => EH_PLATAFORMA }));

vi.mock('@/components/modulos', () => ({
  useModulos: () => ({ modulos: null, ligado: () => true }),
}));

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
import { Sidebar } from '@/components/Sidebar';
import { NavegacaoDoModulo } from '@/components/NavegacaoDoModulo';
import { Paleta } from '@/components/Paleta';

const titulos = () =>
  Array.from(document.querySelectorAll('nav[aria-label="Destinos"] h2')).map((h) => h.textContent?.trim());

describe('grupo ROOT do menu', () => {
  beforeEach(() => {
    EH_PLATAFORMA = false;
    CAMINHO = '/painel';
    localStorage.clear();
  });

  it('empresa cliente não vê o grupo nem o link de Propostas', () => {
    render(<><Sidebar /><NavegacaoDoModulo /><Paleta aberto fechar={() => {}} /></>);
    expect(titulos()).not.toContain('ROOT');
    expect(document.querySelector('a[href="/propostas"]')).toBeNull();
  });

  it('a sessão da plataforma encontra Propostas dentro de Comercial e na busca', () => {
    EH_PLATAFORMA = true;
    CAMINHO = '/leads';
    render(<><Sidebar /><NavegacaoDoModulo /><Paleta aberto fechar={() => {}} /></>);
    expect(screen.getByRole('link', { name: 'Propostas' })).toHaveAttribute('href', '/propostas');
    expect(screen.getByRole('button', { name: /Propostas.*Comercial/ })).toBeInTheDocument();
  });

  it('em /propostas o item fica marcado como a tela aberta', () => {
    EH_PLATAFORMA = true;
    CAMINHO = '/propostas';
    render(<><Sidebar /><NavegacaoDoModulo /><Paleta aberto fechar={() => {}} /></>);
    expect(screen.getByRole('link', { name: 'Propostas' }).getAttribute('aria-current')).toBe('page');
  });
});
