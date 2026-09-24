import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet, apiPost, sessao } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  sessao: { token: 'token-a', ready: true, permissions: ['mcp.ver', 'mcp.executar'] as string[] },
}));

vi.mock('@/lib/api', () => ({ apiGet, apiPost }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: sessao.token,
    ready: sessao.ready,
    can: (permission: string) => sessao.permissions.includes(permission),
  }),
}));

import { FerramentaPage } from '@/ferramentas/FerramentaPage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  sessao.token = 'token-a';
  sessao.ready = true;
  sessao.permissions = ['mcp.ver', 'mcp.executar'];
});

describe('FerramentaPage: dono sessão+slug e bilhete da Porta', () => {
  it('não mostra nem envia rascunho antigo depois da troca de sessão com POST pendente', async () => {
    const leituraA = deferred<{ registros: Array<{ id: string; orgId: string; titulo: string; texto: string }> }>();
    const leituraB = deferred<{ registros: Array<{ id: string; orgId: string; titulo: string; texto: string }> }>();
    apiGet.mockImplementation((path: string) => path.includes('/alpha/') ? leituraA.promise : leituraB.promise);
    const post = deferred<{ status: string }>();
    apiPost.mockReturnValue(post.promise);
    const view = render(<FerramentaPage slug="alpha" />);
    await act(async () => { leituraA.resolve({ registros: [{ id: 'a', orgId: 'org-a', titulo: 'antigo', texto: 'não pode vazar' }] }); });
    expect(await screen.findByText('antigo')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'rascunho A' } });
    fireEvent.change(screen.getByPlaceholderText('Texto'), { target: { value: 'texto A' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Criar registro' }));

    sessao.token = 'token-b';
    view.rerender(<FerramentaPage slug="beta" />);
    // Mesmo que o browser dispare submit programaticamente no render da troca,
    // antes de a limpeza do efeito ser relevante, o rascunho A não vira POST B.
    fireEvent.submit(screen.getByRole('button', { name: 'Criar registro' }));
    expect(screen.queryByText('antigo')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Título')).toHaveValue('');
    expect(screen.getByPlaceholderText('Texto')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Criar registro' })).toBeDisabled();

    await act(async () => { post.resolve({ status: 'executado' }); });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/ferramentas/alpha/registros', { titulo: 'rascunho A', texto: 'texto A' }, 'token-a'));
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(apiGet.mock.calls[1][0]).toBe('/ferramentas/beta/registros');
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('nega double-submit síncrono enquanto o primeiro POST está pendente', async () => {
    apiGet.mockResolvedValue({ registros: [] });
    const post = deferred<{ status: string }>();
    apiPost.mockReturnValue(post.promise);
    render(<FerramentaPage slug="alpha" />);
    await screen.findByText('Nenhum registro.');
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'um' } });
    fireEvent.change(screen.getByPlaceholderText('Texto'), { target: { value: 'dois' } });
    const botao = screen.getByRole('button', { name: 'Criar registro' });
    fireEvent.submit(botao);
    fireEvent.submit(botao);
    expect(apiPost).toHaveBeenCalledTimes(1);
    await act(async () => { post.resolve({ status: 'aguardando_aprovacao' }); });
  });

  it('descarta leitura antiga após troca de token, slug e permissão', async () => {
    const antiga = deferred<{ registros: Array<{ id: string; orgId: string; titulo: string; texto: string }> }>();
    apiGet.mockReturnValue(antiga.promise);
    const view = render(<FerramentaPage slug="alpha" />);
    sessao.token = 'token-b';
    sessao.permissions = [];
    view.rerender(<FerramentaPage slug="beta" />);
    expect(screen.getByText('Sem permissão para ver esta ferramenta.')).toBeInTheDocument();
    await act(async () => { antiga.resolve({ registros: [{ id: 'a', orgId: 'a', titulo: 'segredo A', texto: 'A' }] }); });
    expect(screen.queryByText('segredo A')).not.toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('trata leitura e criação retidas como bilhete, sem assumir registros', async () => {
    apiGet.mockResolvedValue({ status: 'aguardando_aprovacao', mensagem: 'fila de aprovação' });
    apiPost.mockResolvedValue({ status: 'aguardando_aprovacao', mensagem: 'criação retida' });
    render(<FerramentaPage slug="alpha" />);
    expect(await screen.findByText('fila de aprovação')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'título' } });
    fireEvent.change(screen.getByPlaceholderText('Texto'), { target: { value: 'texto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar registro' }));
    expect(await screen.findByText('criação retida')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum registro.')).toBeInTheDocument();
  });
});
