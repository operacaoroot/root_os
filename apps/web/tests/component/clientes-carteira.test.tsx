import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ClientesPage from '@/app/clientes/page';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'pessoa-1' }, token: 'sessao-1', ready: true, can: () => true }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('mostra só o estado das pastas da carteira, sem consultar o CRM ou habilitar a criação', async () => {
  const fetch = vi.fn(async (url: string) => {
    const json = (data: unknown) => new Response(JSON.stringify(data));
    if (url.endsWith('/clientes-escopo/me')) return json({ amplo: false, clientes: [
      { id: 'a', nome: 'Cliente A', interno: false }, { id: 'b', nome: 'Cliente B', interno: false },
    ] });
    if (url.endsWith('/clientes/pastas')) return json([
      { id: 'a', nome: 'Cliente A', pastaDriveUrl: 'https://drive.exemplo.invalid/a', arquivosNaFila: 0 },
      { id: 'b', nome: 'Cliente B', pastaDriveUrl: null, arquivosNaFila: 0 },
      { id: 'c', nome: 'Cliente fora da carteira', pastaDriveUrl: null, arquivosNaFila: 10 },
    ]);
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  render(<ClientesPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Pastas dos clientes no Drive/ }));
  expect(await screen.findByText('Cliente A')).toBeInTheDocument();
  expect(screen.getByText('Pasta criada')).toBeInTheDocument();
  expect(screen.getByText('Cliente B')).toBeInTheDocument();
  expect(screen.queryByText('Cliente fora da carteira')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Criar pasta do cliente' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Abrir pasta do cliente' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/clientes-escopo/me', '/api/clientes/pastas']);
});
