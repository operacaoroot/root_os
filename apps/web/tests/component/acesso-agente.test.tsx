import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiGet = vi.fn();
const apiPost = vi.fn();
let tokenAtual: string | null = 'sessao-a';
let permissoes: string[] = ['admin.permissoes'];

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...args: unknown[]) => apiGet(...args), apiPost: (...args: unknown[]) => apiPost(...args) };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: tokenAtual,
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x', roles: [], permissions: permissoes },
    can: (permission: string) => permissoes.includes(permission),
  }),
}));

import { AcessoAgente } from '@/app/contexto/AcessoAgente';

const fontes = [{ sourceType: 'vault', sourceRef: 'cliente_%/nota_.md', title: 'Nota sintética' }];

beforeEach(() => {
  tokenAtual = 'sessao-a';
  permissoes = ['admin.permissoes'];
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockImplementation((path: string) => path === '/auth/agent-tokens' ? Promise.resolve([]) : Promise.resolve([]));
  apiPost.mockResolvedValue({ token: 'ros1.org.id.segredo-sintetico', id: 'token-1' });
  localStorage.clear();
});

describe('ponte humana do agente', () => {
  it('emite segredo somente em memória e concede referência literal com destino explícito', async () => {
    const user = userEvent.setup();
    render(<AcessoAgente fontes={fontes} />);

    await user.type(screen.getByLabelText('Nome do token'), 'Claude pessoal');
    await user.click(screen.getByRole('button', { name: 'Emitir token' }));
    expect(await screen.findByText('ros1.org.id.segredo-sintetico')).toBeInTheDocument();
    expect(localStorage.length).toBe(0);

    await user.selectOptions(screen.getByLabelText('Campo'), 'body');
    await user.click(screen.getByRole('button', { name: 'Conceder campo' }));
    await waitFor(() => expect(apiPost.mock.calls.some(([path]) => path === '/memoria/grants')).toBe(true));
    const grantCall = apiPost.mock.calls.find(([path]) => path === '/memoria/grants');
    expect(grantCall?.[1]).toMatchObject({ sourceType: 'vault', sourceRef: 'cliente_%/nota_.md', field: 'body', provider: 'agente_externo' });
    expect((grantCall?.[1] as { consentText: string }).consentText).toContain('possa sair da VPS');
    expect((grantCall?.[1] as { consentText: string }).consentText).toContain('enquanto esta concessão estiver ativa');
    expect((grantCall?.[1] as { consentText: string }).consentText).toContain('não recolhe conteúdo já enviado');
    expect(grantCall?.[2]).toBe('sessao-a');
  });

  it('não oferece grant sem admin.permissoes e limpa segredo ao trocar sessão', async () => {
    permissoes = [];
    const { rerender } = render(<AcessoAgente fontes={fontes} />);
    expect(screen.queryByText('Consentimento por fonte e campo')).not.toBeInTheDocument();

    permissoes = ['admin.permissoes'];
    tokenAtual = 'sessao-b';
    rerender(<AcessoAgente fontes={fontes} />);
    await waitFor(() => expect(screen.queryByText('ros1.org.id.segredo-sintetico')).not.toBeInTheDocument());
  });

  it('descarta emissão que terminou depois da troca de sessão', async () => {
    const user = userEvent.setup();
    let concluir!: (valor: { token: string; id: string }) => void;
    apiPost.mockImplementationOnce(() => new Promise((resolve) => { concluir = resolve; }));
    const { rerender } = render(<AcessoAgente fontes={fontes} />);
    await user.type(screen.getByLabelText('Nome do token'), 'emissão atrasada');
    await user.click(screen.getByRole('button', { name: 'Emitir token' }));
    tokenAtual = 'sessao-nova';
    rerender(<AcessoAgente fontes={fontes} />);
    concluir({ token: 'ros1.sessao-antiga.segredo', id: 'token-antigo' });
    await waitFor(() => expect(screen.queryByText('ros1.sessao-antiga.segredo')).not.toBeInTheDocument());
  });

  it('descarta listagem antiga de tokens quando a sessão muda', async () => {
    let concluirLista!: (valor: unknown) => void;
    apiGet.mockImplementationOnce(() => new Promise((resolve) => { concluirLista = resolve; }));
    const { rerender } = render(<AcessoAgente fontes={fontes} />);
    tokenAtual = 'sessao-nova';
    rerender(<AcessoAgente fontes={fontes} />);
    concluirLista([{ id: 'antigo', name: 'token da sessão antiga', scopes: [], expiresAt: new Date().toISOString(), revokedAt: null }]);
    await waitFor(() => expect(screen.queryByText('token da sessão antiga')).not.toBeInTheDocument());
  });
});
