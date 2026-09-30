import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PautaMarcaPainel, PautaMarcaPrevia } from '@mktos/shared';

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
let token = 'sessao-a';
let permissoes = ['pauta.ver', 'pauta.editar', 'obsidian.ver'];

vi.mock('@/lib/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiPut: (...args: unknown[]) => apiPut(...args),
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
  apiPost.mockReset();
  apiPut.mockReset();
  apiGet.mockImplementation((url: string) => url === '/pauta/marca' ? Promise.resolve(painel) : Promise.resolve(previa));
});

describe('projeção da marca no contexto', () => {
  it('não deixa salvar outro destino enquanto a aplicação ainda espera resposta', async () => {
    const pessoa = userEvent.setup();
    const respostaDaAplicacao = pendente<PautaMarcaPainel>();
    apiPost.mockReturnValue(respostaDaAplicacao.promessa);
    apiPut.mockResolvedValue(painel);
    apiGet.mockImplementation((url: string) => url === '/pauta/marca'
      ? Promise.resolve(painel)
      : Promise.resolve({ ...previa, textoProposto: 'A'.repeat(100) }));
    render(<MarcaPage />);
    const salvarPilares = await screen.findByRole('button', { name: 'Salvar os pilares' });
    await waitFor(() => expect(salvarPilares).toBeEnabled());
    const campoPilares = screen.getByRole('textbox', { name: 'Pilares de conteúdo' });
    await pessoa.type(campoPilares, 'Rascunho de outro destino');
    await pessoa.click(screen.getByRole('button', { name: 'Conferir guia de perfil' }));
    await pessoa.click(await screen.findByRole('button', { name: 'Aplicar somente perfil' }));
    expect(salvarPilares).toBeDisabled();
    await pessoa.click(salvarPilares);
    expect(apiPut).not.toHaveBeenCalled();
    respostaDaAplicacao.resolver({ ...painel, perfil: 'A'.repeat(100), perfilVersao: 1, pilaresTexto: 'Estado antigo do servidor' });
    await waitFor(() => expect(salvarPilares).toBeEnabled());
    expect(campoPilares).toHaveValue('Rascunho de outro destino');
    await pessoa.click(salvarPilares);
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(apiPut).toHaveBeenCalledWith('/pauta/marca/pilares', { pilares: 'Rascunho de outro destino', versao: undefined }, 'sessao-a');
  });

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
