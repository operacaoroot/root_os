import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiGet = vi.fn();
const apiPost = vi.fn();
let tokenAtual: string | null = 'sessao-a';
let permissoes: string[] = ['admin.permissoes', 'obsidian.editar'];

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...args: unknown[]) => apiGet(...args), apiPost: (...args: unknown[]) => apiPost(...args) };
});
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: tokenAtual, ready: true, user: null, can: (permission: string) => permissoes.includes(permission) }),
}));

import { ConectorLocal } from '@/app/contexto/ConectorLocal';

const fonte = {
  id: 'fonte-1', nome: 'Documentos', tipo: 'pasta', raizLogica: 'cliente/documentos', incluir: ['**/*.md'], excluir: [],
  tiposPermitidos: ['.md'], modo: 'importacao', regraExclusao: 'ignorar', tamanhoMaximo: 2097152, escopoVersao: 1,
  revokedAt: null, ultimaRemessaTentativaEm: null, ultimaRemessaSucessoEm: null, ultimaRemessaStatus: null,
  ultimaRemessaItens: null, ultimaRemessaErros: null,
};

beforeEach(() => {
  tokenAtual = 'sessao-a'; permissoes = ['admin.permissoes', 'obsidian.editar']; apiGet.mockReset(); apiPost.mockReset();
  apiGet.mockImplementation((path: string) => path === '/conector/fontes' ? Promise.resolve([]) : Promise.resolve([]));
  apiPost.mockResolvedValue({});
});

describe('painel do conector local', () => {
  it('exige as duas permissões e cria fonte somente lógica', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ConectorLocal />);
    expect(await screen.findByRole('heading', { name: 'Conector local' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nome da fonte'), 'Documentos');
    await user.type(screen.getByLabelText('Raiz lógica'), 'cliente/documentos');
    await user.click(screen.getByRole('button', { name: 'Criar fonte lógica' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/conector/fontes', expect.objectContaining({
      tipo: 'pasta', raizLogica: 'cliente/documentos', modo: 'importacao', regraExclusao: 'ignorar',
    }), 'sessao-a'));
    expect(screen.getByRole('option', { name: 'sincronização manual (snapshot)' })).not.toBeDisabled();
    expect(screen.getByText(/sincronização é manual/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nome da fonte'), 'Documentos sync');
    await user.type(screen.getByLabelText('Raiz lógica'), 'cliente/documentos-sync');
    await user.selectOptions(screen.getByLabelText('Modo da fonte'), 'sincronizacao');
    await user.click(screen.getByRole('button', { name: 'Criar fonte lógica' }));
    await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith('/conector/fontes', expect.objectContaining({
      modo: 'sincronizacao',
    }), 'sessao-a'));
    permissoes = ['admin.permissoes'];
    rerender(<ConectorLocal />);
    expect(screen.queryByRole('heading', { name: 'Conector local' })).not.toBeInTheDocument();
  });

  it('não mostra controles sem admin.permissoes ou obsidian.editar', () => {
    permissoes = ['admin.permissoes'];
    const { rerender } = render(<ConectorLocal />);
    expect(screen.queryByText('Criar fonte lógica')).not.toBeInTheDocument();
    permissoes = ['obsidian.editar'];
    rerender(<ConectorLocal />);
    expect(screen.queryByText('Criar fonte lógica')).not.toBeInTheDocument();
  });

  it('mostra código uma vez e descarta resposta atrasada ao trocar sessão', async () => {
    const user = userEvent.setup();
    let concluir!: (value: unknown) => void;
    apiGet.mockImplementation((path: string) => path === '/conector/fontes' ? Promise.resolve([fonte]) : Promise.resolve([]));
    apiPost.mockImplementationOnce(() => new Promise((resolve) => { concluir = resolve; }));
    const { rerender } = render(<ConectorLocal />);
    await screen.findByText('Documentos (cliente/documentos)');
    await user.type(screen.getByLabelText('Nome do dispositivo'), 'Notebook');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Emitir código de pareamento' }));
    tokenAtual = 'sessao-b'; rerender(<ConectorLocal />);
    concluir({ id: 'pair-1', codigo: 'codigo-que-nao-deve-voltar', expiraEm: new Date().toISOString() });
    await waitFor(() => expect(screen.queryByText('codigo-que-nao-deve-voltar')).not.toBeInTheDocument());
  });

  it('exibe metadados do pareamento, oculta o segredo e revoga fonte/dispositivo', async () => {
    const user = userEvent.setup();
    const dispositivo = { id: 'device-1', nome: 'Notebook', createdAt: new Date().toISOString(), lastSeenAt: null, revokedAt: null, fonteIds: [fonte.id] };
    apiGet.mockImplementation((path: string) => path === '/conector/fontes' ? Promise.resolve([fonte]) : Promise.resolve([dispositivo]));
    apiPost.mockImplementation((path: string) => path === '/conector/pareamento/codigo'
      ? Promise.resolve({ id: 'pair-1', orgId: 'org-a', sourceIds: [fonte.id], codigo: 'segredo-uma-vez', expiraEm: new Date(Date.now() + 60_000).toISOString() })
      : Promise.resolve({}));
    render(<ConectorLocal />);
    await screen.findByText('Documentos (cliente/documentos)');
    await user.type(screen.getByLabelText('Nome do dispositivo'), 'Notebook');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Emitir código de pareamento' }));
    expect(await screen.findByText('segredo-uma-vez')).toBeInTheDocument();
    expect(screen.getByText(/Pareamento pair-1 · empresa org-a/)).toBeInTheDocument();
    expect(screen.getAllByText(/escopo 1/).length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole('button', { name: 'Ocultar código' }));
    expect(screen.queryByText('segredo-uma-vez')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revogar fonte' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/conector/fontes/fonte-1/revogar', {}, 'sessao-a'));
    await user.click(screen.getByRole('button', { name: 'Revogar dispositivo' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/conector/dispositivos/device-1/revogar', {}, 'sessao-a'));
    expect(apiPost.mock.calls.some(([path]) => String(path).includes('grants'))).toBe(false);
  });

  it('não mantém código visível no primeiro render após troca de sessão', async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((path: string) => path === '/conector/fontes' ? Promise.resolve([fonte]) : Promise.resolve([]));
    apiPost.mockImplementation((path: string) => path === '/conector/pareamento/codigo'
      ? Promise.resolve({ id: 'pair-2', orgId: 'org-a', sourceIds: [fonte.id], codigo: 'segredo-sessao-a', expiraEm: new Date(Date.now() + 60_000).toISOString() })
      : Promise.resolve({}));
    const { rerender } = render(<ConectorLocal />);
    await screen.findByText('Documentos (cliente/documentos)');
    await user.type(screen.getByLabelText('Nome do dispositivo'), 'Notebook');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Emitir código de pareamento' }));
    expect(await screen.findByText('segredo-sessao-a')).toBeInTheDocument();
    tokenAtual = 'sessao-b';
    rerender(<ConectorLocal />);
    await waitFor(() => expect(screen.queryByText('segredo-sessao-a')).not.toBeInTheDocument());
  });

  it('descarta mutação antiga e libera busy para a sessão nova', async () => {
    const user = userEvent.setup();
    let concluir!: (value: unknown) => void;
    apiGet.mockImplementation((path: string) => path === '/conector/fontes' ? Promise.resolve([fonte]) : Promise.resolve([]));
    apiPost.mockImplementationOnce(() => new Promise((resolve) => { concluir = resolve; }));
    const { rerender } = render(<ConectorLocal />);
    await screen.findByText('Documentos (cliente/documentos)');
    await user.click(screen.getByRole('button', { name: 'Revogar fonte' }));
    tokenAtual = 'sessao-b';
    rerender(<ConectorLocal />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revogar fonte' })).not.toBeDisabled());
    concluir({});
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
