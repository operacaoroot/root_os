import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '@/lib/auth';
const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
import LoginPage from '@/app/login/page';
const fetchMock = vi.fn();
const user = { id: 'pessoa-qa', name: 'Pessoa de exercício', email: 'qa@example.invalid', roles: ['leitor'], permissions: [] as string[] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/login'); nav.replace.mockReset(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
describe('entrada autenticada', () => {
  it.each([['obsidian.ver', '/contexto'], ['pauta.ver', '/contexto/marca'], ['', '/painel']])('login com %s abre %s', async (permission, destino) => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/auth/google/disponivel') ? response({ disponivel: false }) : response({ token: 'token-login-sintetico', user: { ...user, permissions: permission ? [permission] : [] } }));
    render(<AuthProvider><LoginPage /></AuthProvider>); const u = userEvent.setup();
    await u.type(screen.getByLabelText('Senha'), 'senha-sintetica'); await u.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(destino));
  });
  it('valida token Google antes de abrir Contexto e remove fragmento da URL', async () => {
    localStorage.setItem('mktos_token', 'sessao-antiga-expirada');
    window.history.replaceState(null, '', '/login#token=token-google-sintetico');
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/auth/me') ? response({ ...user, permissions: ['obsidian.ver'] }) : response({ disponivel: true }));
    render(<AuthProvider><LoginPage /></AuthProvider>);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/contexto'));
    expect(window.location.hash).toBe(''); expect(localStorage.getItem('mktos_token')).toBe('token-google-sintetico'); expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ headers: { Authorization: 'Bearer token-google-sintetico' } }));
  });
  it('credenciais inválidas mostram erro e não navegam', async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/auth/google/disponivel') ? response({ disponivel: false }) : response({ message: 'Credenciais inválidas' }, 401));
    render(<AuthProvider><LoginPage /></AuthProvider>); const u = userEvent.setup(); await u.type(screen.getByLabelText('Senha'), 'senha-sintetica'); await u.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciais inválidas'); expect(nav.replace).not.toHaveBeenCalled();
  });
});
