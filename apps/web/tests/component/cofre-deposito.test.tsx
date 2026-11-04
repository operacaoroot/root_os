import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EntregarAcessos from '../../src/app/entregar-acessos/page';
const token = '11111111-1111-4111-8111-111111111111.' + 'A'.repeat(43);
const estado = { cliente: 'JUMA', expiraEm: '2026-11-10T12:00:00Z', podeEnviar: true };
beforeEach(() => { window.history.replaceState(null, '', `/entregar-acessos#${token}`); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function preencher() {
  await screen.findByText('Enviar acessos · JUMA');
  fireEvent.change(screen.getByLabelText('Sistema ou serviço'), { target: { value: 'ERP teste' } });
  fireEvent.change(screen.getByLabelText('Senha ou chave de acesso'), { target: { value: 'sintetico' } });
}
describe('formulário de depósito', () => {
  it('retira token da URL, envia somente via POST e limpa a senha após recibo', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => estado })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, recibo: 'recibo-teste' }) });
    vi.stubGlobal('fetch', fetch); render(<EntregarAcessos />); await preencher();
    expect(window.location.hash).toBe('');
    fireEvent.click(screen.getByText('Enviar para a ROOT'));
    await screen.findByText('Acesso recebido pela ROOT.');
    expect(screen.getByLabelText('Senha ou chave de acesso')).toHaveValue('');
    const [url, options] = fetch.mock.calls[1];
    expect(url).not.toContain(token); expect(options.method).toBe('POST');
    expect(options.credentials).toBe('omit'); expect(JSON.parse(options.body).token).toBe(token);
    expect(localStorage.getItem('cofre')).toBeNull();
  });
  it('falha sem confirmação preserva o mesmo pedido para retentar e bloqueia edição', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => estado })
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, recibo: 'recibo-teste' }) });
    vi.stubGlobal('fetch', fetch); render(<EntregarAcessos />); await preencher();
    fireEvent.click(screen.getByText('Enviar para a ROOT'));
    await screen.findByText('Confirmar envio');
    expect(screen.getByLabelText('Senha ou chave de acesso')).toBeDisabled();
    fireEvent.click(screen.getByText('Confirmar envio'));
    await screen.findByText('Acesso recebido pela ROOT.');
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[1][1].body);
  });
  it('link inválido não mostra formulário', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    render(<EntregarAcessos />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('expirou'));
    expect(screen.queryByLabelText('Senha ou chave de acesso')).toBeNull();
  });
});
