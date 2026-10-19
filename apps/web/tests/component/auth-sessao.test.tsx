import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api';
const fetchMock = vi.fn();
const usuario = { id: 'pessoa-qa', name: 'Pessoa de exercício', email: 'qa@example.invalid', roles: ['leitor'], permissions: ['obsidian.ver'] };
const resposta = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function Painel() {
  const a = useAuth(); return <><p>{a.ready ? 'Pronto' : 'Validando'}</p><p>{a.user?.name ?? 'Sem pessoa confirmada'}</p><p>{a.sessionError}</p><p>{a.token ? 'Tem sessão' : 'Sem sessão'}</p><button onClick={() => void a.retrySession()}>Repetir</button><button onClick={() => void a.login('qa@example.invalid', 'senha-sintetica').catch(() => {})}>Login</button><button onClick={a.logout}>Sair</button></>;
}
function abrir() { return render(<AuthProvider><Painel /></AuthProvider>); }
beforeEach(() => { localStorage.clear(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
function guardar() { localStorage.setItem('mktos_token', 'token-antigo-sintetico'); localStorage.setItem('mktos_user', JSON.stringify({ ...usuario, name: 'Cache não confirmado' })); }
describe('retomada e expiração da sessão', () => {
  it('confere a sessão salva antes de mostrar a pessoa e descarta token inválido', async () => {
    guardar(); fetchMock.mockResolvedValue(resposta(401, { message: 'Token inválido' })); abrir();
    expect(screen.queryByText('Cache não confirmado')).not.toBeInTheDocument();
    expect(await screen.findByText('Sua sessão expirou. Entre novamente.')).toBeInTheDocument();
    expect(screen.getByText('Sem sessão')).toBeInTheDocument(); expect(localStorage.getItem('mktos_token')).toBeNull();
  });
  it('distingue falha transitória e permite validar novamente sem perder o token', async () => {
    guardar(); fetchMock.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(resposta(200, usuario)); abrir();
    expect(await screen.findByText(/Não foi possível confirmar sua sessão/)).toBeInTheDocument(); expect(screen.getByText('Tem sessão')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Repetir' })); expect(await screen.findByText(usuario.name)).toBeInTheDocument();
  });
  it('invalida 401 do token corrente e mantém 403 ou falha do provedor', async () => {
    guardar(); fetchMock.mockResolvedValueOnce(resposta(200, usuario)); abrir(); await screen.findByText(usuario.name);
    fetchMock.mockResolvedValueOnce(resposta(403, { message: 'Acesso insuficiente' })); await act(async () => { await apiGet('/memoria', 'token-antigo-sintetico').catch(() => {}); }); expect(screen.getByText(usuario.name)).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(resposta(401, { message: 'Credencial do provedor expirou' })); await act(async () => { await apiGet('/integrations/qa', 'token-antigo-sintetico').catch(() => {}); }); expect(screen.getByText(usuario.name)).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(resposta(401, { message: 'Token inválido' })); await act(async () => { await apiGet('/memoria', 'token-antigo-sintetico').catch(() => {}); }); expect(screen.getByText('Sem sessão')).toBeInTheDocument();
  });
  it('resposta 401 atrasada da sessão antiga não encerra login novo', async () => {
    guardar(); fetchMock.mockResolvedValueOnce(resposta(200, usuario)); abrir(); await screen.findByText(usuario.name);
    let concluir!: (r: Response) => void; fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { concluir = resolve; })); const antigo = apiGet('/memoria', 'token-antigo-sintetico').catch(() => {});
    fetchMock.mockResolvedValueOnce(resposta(200, { token: 'token-novo-sintetico', user: { ...usuario, name: 'Nova sessão' } })); await userEvent.setup().click(screen.getByRole('button', { name: 'Login' })); await screen.findByText('Nova sessão');
    await act(async () => { concluir(resposta(401, { message: 'Token inválido' })); await antigo; }); expect(screen.getByText('Nova sessão')).toBeInTheDocument(); expect(localStorage.getItem('mktos_token')).toBe('token-novo-sintetico');
  });
  it('credenciais recusadas no login não encerram uma sessão já confirmada', async () => {
    guardar(); fetchMock.mockResolvedValueOnce(resposta(200, usuario)); abrir(); await screen.findByText(usuario.name);
    fetchMock.mockResolvedValueOnce(resposta(401, { message: 'Credenciais inválidas' })); await userEvent.setup().click(screen.getByRole('button', { name: 'Login' })); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); expect(screen.getByText(usuario.name)).toBeInTheDocument();
  });
});
