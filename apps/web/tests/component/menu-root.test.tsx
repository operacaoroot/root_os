import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

/*
 * Propostas virou item do NAV na versão final (19/10/2026): Comercial, `leads.ver`. A
 * tela mostra as propostas da sala da empresa da sessão, e as antigas do serviço de
 * propostas só na sessão da plataforma. Por isso o item não depende mais de ser a
 * plataforma, e na plataforma ele aparece UMA vez.
 *
 * Rodada da interface (20/10/2026, U1, item 10): a Rodada da semana (a tela de
 * `/operacao`) é item do Comercial só para a sessão da plataforma (`ITENS_DA_ROOT`),
 * em `/comercial/rodada`, depois dos Contratos vivos. "Operação da Root" não vira item.
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
import { Paleta } from '@/components/Paleta';

const titulos = () =>
  Array.from(document.querySelectorAll('nav[aria-label="Destinos"] h2')).map((h) => h.textContent?.trim());

describe('grupo ROOT do menu', () => {
  beforeEach(() => {
    EH_PLATAFORMA = false;
    CAMINHO = '/painel';
    localStorage.clear();
  });

  it('empresa cliente com leads.ver vê Propostas no Comercial, sem grupo ROOT nem Operação', () => {
    CAMINHO = '/leads';
    render(<><Sidebar /><Paleta aberto fechar={() => {}} /></>);
    expect(titulos()).not.toContain('ROOT');
    expect(screen.getByRole('link', { name: 'Propostas' })).toHaveAttribute('href', '/propostas');
    expect(document.querySelector('a[href="/operacao"]')).toBeNull();
  });

  it('a sessão da plataforma encontra Propostas uma vez só, no Comercial e na busca', () => {
    EH_PLATAFORMA = true;
    CAMINHO = '/leads';
    render(<><Sidebar /><Paleta aberto fechar={() => {}} /></>);
    expect(screen.getAllByRole('link', { name: 'Propostas' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Propostas.*Comercial/ })).toHaveLength(1);
  });

  it('em /propostas o item fica marcado como a tela aberta', () => {
    EH_PLATAFORMA = true;
    CAMINHO = '/propostas';
    render(<><Sidebar /><Paleta aberto fechar={() => {}} /></>);
    expect(screen.getByRole('link', { name: 'Propostas' }).getAttribute('aria-current')).toBe('page');
  });

  it('"Operação da Root" não é item: nem no menu, nem na busca', () => {
    EH_PLATAFORMA = true;
    CAMINHO = '/operacao';
    render(<><Sidebar /><Paleta aberto fechar={() => {}} /></>);
    expect(screen.queryByRole('link', { name: 'Operação da Root' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Operação da Root/ })).toBeNull();
  });

  it('a plataforma vê a Rodada da semana no Comercial, depois dos Contratos vivos, e na busca', () => {
    EH_PLATAFORMA = true;
    CAMINHO = '/comercial/rodada';
    render(<><Sidebar /><Paleta aberto fechar={() => {}} /></>);
    const lista = screen.getByRole('list', { name: 'Subseções de Comercial' });
    const nomes = Array.from(lista.querySelectorAll('a')).map((a) => a.textContent);
    expect(nomes.indexOf('Rodada da semana')).toBe(nomes.indexOf('Contratos vivos') + 1);
    const rodada = within(lista).getByRole('link', { name: 'Rodada da semana' });
    expect(rodada).toHaveAttribute('href', '/comercial/rodada');
    expect(rodada).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('button', { name: /Rodada da semana.*Comercial/ })).toHaveLength(1);
  });

  it('empresa cliente não vê a Rodada da semana: nem no menu, nem na busca', () => {
    CAMINHO = '/comercial/rodada';
    render(<><Sidebar /><Paleta aberto fechar={() => {}} /></>);
    expect(document.querySelector('a[href="/comercial/rodada"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Rodada da semana/ })).toBeNull();
  });
});
