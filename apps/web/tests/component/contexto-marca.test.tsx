import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PautaMarcaPainel, PautaMarcaPrevia } from '@mktos/shared';

const apiGet = vi.fn();
let token = 'sessao-a';
let permissoes = ['pauta.ver', 'pauta.editar', 'obsidian.ver'];

vi.mock('@/lib/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token, ready: true, can: (p: string) => permissoes.includes(p) }),
}));

// eslint-disable-next-line import/first
import MarcaPage from '@/app/contexto/marca/page';

const painel: PautaMarcaPainel = {
  perfil: null, perfilVersao: null, perfilAtualizadoEm: null,
  pilaresTexto: '', pilaresVersao: null, pilares: [], avisos: [], bloco: '',
  projecoes: { perfil: null, pilares: null },
};
const previa: PautaMarcaPrevia = {
  destino: 'perfil', fonteContextItemId: '6f786a46-8bb0-4de8-acb8-c968d116a3f2',
  fonteChave: 'editorial:marca:guia.md', fonteVersao: 1, fonteHash: 'a'.repeat(64),
  secoesUsadas: [{ titulo: 'O papel', hash: 'b'.repeat(64) }],
  textoProposto: 'Texto inicial da fonte para revisão.',
  destinoContextItemId: null, destinoVersao: null, destinoHash: null,
  textoAtual: '', diferenca: true, estado: 'pronto', aviso: null,
};

function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => { resolver = resolve; });
  return { promessa, resolver };
}

beforeEach(() => {
  token = 'sessao-a';
  permissoes = ['pauta.ver', 'pauta.editar', 'obsidian.ver'];
  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => url === '/pauta/marca' ? Promise.resolve(painel) : Promise.resolve(previa));
});

describe('projeção da marca no contexto', () => {
  it('não troca uma revisão digitada pela resposta antiga de Atualizar prévia', async () => {
    const pessoa = userEvent.setup();
    render(<MarcaPage />);
    await pessoa.click(await screen.findByRole('button', { name: 'Conferir guia de perfil' }));
    const campo = await screen.findByLabelText('Texto proposto para perfil');
    const antiga = pendente<PautaMarcaPrevia>();
    apiGet.mockImplementation((url: string) => url === '/pauta/marca' ? Promise.resolve(painel) : antiga.promessa);
    await pessoa.click(screen.getByRole('button', { name: 'Atualizar prévia de perfil' }));
    await pessoa.type(campo, ' revisto');
    antiga.resolver({ ...previa, textoProposto: 'Resposta atrasada' });
    await waitFor(() => expect(campo).toHaveValue(`${previa.textoProposto} revisto`));
  });

  it('oculta os dados antigos e descarta prévia pendente quando a sessão muda', async () => {
    const pessoa = userEvent.setup();
    const { rerender } = render(<MarcaPage />);
    await pessoa.click(await screen.findByRole('button', { name: 'Conferir guia de perfil' }));
    expect(await screen.findByDisplayValue(previa.textoProposto)).toBeInTheDocument();
    const antiga = pendente<PautaMarcaPrevia>();
    apiGet.mockImplementation((url: string) => url === '/pauta/marca' ? Promise.resolve(painel) : antiga.promessa);
    await pessoa.click(screen.getByRole('button', { name: 'Atualizar prévia de perfil' }));
    token = 'sessao-b';
    permissoes = ['pauta.ver'];
    rerender(<MarcaPage />);
    expect(screen.queryByDisplayValue(previa.textoProposto)).not.toBeInTheDocument();
    antiga.resolver({ ...previa, textoProposto: 'Resposta da sessão anterior' });
    await waitFor(() => expect(screen.queryByDisplayValue('Resposta da sessão anterior')).not.toBeInTheDocument());
    expect(screen.getByText(/sua conta precisa de acesso/)).toBeInTheDocument();
  });
});
