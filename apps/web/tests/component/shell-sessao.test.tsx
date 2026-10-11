import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replace = vi.fn(), retrySession = vi.fn();
let auth: { user: { id: string } | null; token: string | null; ready: boolean; sessionError: string | null };
let path = '/contexto/marca';
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ ...auth, retrySession }) }));
vi.mock('next/navigation', () => ({ usePathname: () => path, useRouter: () => ({ replace }) }));
vi.mock('@/lib/api', () => ({ apiGet: () => Promise.resolve({ bloqueado: false }) }));
vi.mock('@/components/Sidebar', () => ({ Sidebar: () => <aside>Menu autorizado</aside> }));
vi.mock('@/components/Topbar', () => ({ Topbar: () => null }));
vi.mock('@/components/ChatFlutuante', () => ({ ChatFlutuante: () => null }));
vi.mock('@/components/NavegacaoDoModulo', () => ({ NavegacaoDoModulo: () => <nav>Abas autorizadas</nav> }));
vi.mock('@/components/modulos', () => ({ ModulosProvider: ({ children }: any) => children, useModulos: () => ({ ligado: () => true }) }));
vi.mock('@/components/caixa', () => ({ CaixaProvider: ({ children }: any) => children }));
import { AppShell } from '@/components/AppShell';

beforeEach(() => { replace.mockReset(); retrySession.mockReset(); path = '/contexto/marca'; auth = { user: null, token: 'token-qa', ready: false, sessionError: null }; });
describe('porta da sessão do produto', () => {
  it('não monta página, menu ou abas enquanto confirma o token', () => {
    render(<AppShell><p>Conteúdo privado</p></AppShell>);
    expect(screen.queryByText('Conteúdo privado')).toBeNull();
    expect(screen.queryByText('Menu autorizado')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
  it('falha transitória conserva a sessão e oferece repetir sem mostrar conteúdo', async () => {
    auth.ready = true; auth.sessionError = 'Não foi possível confirmar sua sessão.';
    render(<AppShell><p>Conteúdo privado</p></AppShell>);
    expect(screen.getByRole('alert')).toHaveTextContent(auth.sessionError);
    expect(screen.queryByText('Conteúdo privado')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retrySession).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });
  it('sessão removida por 401 vai ao login sem interpretar falha como dados vazios', async () => {
    auth = { user: null, token: null, ready: true, sessionError: 'Sua sessão expirou. Entre novamente.' };
    render(<AppShell><p>Conteúdo privado</p></AppShell>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('Conteúdo privado')).toBeNull();
  });
  it('sessão confirmada monta o conteúdo e suas abas', () => {
    auth.ready = true; auth.user = { id: 'pessoa-qa' };
    render(<AppShell><p>Conteúdo privado</p></AppShell>);
    expect(screen.getByText('Conteúdo privado')).toBeInTheDocument();
    expect(screen.getByText('Abas autorizadas')).toBeInTheDocument();
  });
  it('login público continua disponível quando sessão expirou', () => {
    path = '/login'; auth.ready = true; auth.token = null;
    render(<AppShell><p>Formulário de login</p></AppShell>);
    expect(screen.getByText('Formulário de login')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
