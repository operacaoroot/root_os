import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A ABA VOZ — MC10.
 *
 * O critério que cabe à tela: mostra o perfil vigente com a procedência e o
 * histórico, aprende a partir de episódios transcritos e de texto colado
 * (dentro dos limites), edita à mão gerando versão nova com a versão lida, e
 * troca a chave. Sem perfil, diz que a pauta escreve no tom da casa.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
  };
});

let permissoes = ['pauta.ver', 'pauta.editar', 'automacoes.executar'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import { AbaVoz } from '@/app/pauta/AbaVoz';
// eslint-disable-next-line import/first
import PautaPage from '@/app/pauta/page';

const PERFIL = '## Ritmo\nFala em blocos curtos e repete o número.\n\n## Nunca diz\n- "alavancar"';

function painel(over: Record<string, unknown> = {}) {
  return {
    chave: 'voz.pedro',
    origemDaChave: 'padrao',
    perfil: {
      id: 'n1',
      corpo: PERFIL,
      versao: 2,
      procedencia: 'promocao:pauta.voz · episódios ep-03',
      sourceType: 'promocao',
      sourceRef: 'pauta.voz · episódios ep-03 · modelo anthropic/claude',
      atualizadoEm: '2026-09-24T12:00:00.000Z',
      arquivado: false,
    },
    historico: [
      { versao: 2, mudanca: 'alteracao', procedencia: 'promocao:pauta.voz · episódios ep-03', motivo: null, criadoEm: '2026-09-24T12:00:00.000Z' },
      { versao: 1, mudanca: 'criacao', procedencia: 'operador:pauta.voz · edição manual', motivo: null, criadoEm: '2026-09-23T12:00:00.000Z' },
    ],
    regrasDaMarca: ['Nunca usar: "alavancar", "sinergia" — nem as variações.', 'Sem emoji.'],
    episodios: [
      { id: 'e3', apelido: 'ep-03', titulo: 'Semana 39', caracteres: 12000 },
      { id: 'e4', apelido: 'ep-04', titulo: 'Semana 40', caracteres: 9000 },
    ],
    iaConfigurada: true,
    ...over,
  };
}

function renderAba(over: Partial<{ editavel: boolean; podeGastarIa: boolean }> = {}) {
  const onErro = vi.fn();
  render(<AbaVoz token="tok" editavel={over.editavel ?? true} podeGastarIa={over.podeGastarIa ?? true} bump={0} onErro={onErro} />);
  return { onErro };
}

const TEXTO = 'Bom, deixa eu te mostrar uma coisa. '.repeat(8);

beforeEach(() => {
  vi.clearAllMocks();
  permissoes = ['pauta.ver', 'pauta.editar', 'automacoes.executar'];
  apiGet.mockResolvedValue(painel());
});

describe('a aba Voz', () => {
  it('mostra o perfil vigente com a procedência, as regras da marca e o histórico', async () => {
    renderAba();
    const texto = await screen.findByLabelText('Texto do perfil');
    expect(within(texto).getByRole('heading', { name: 'Ritmo' })).toBeInTheDocument();
    expect(screen.getByText(/Versão 2/)).toBeInTheDocument();
    expect(screen.getByText('pauta.voz · episódios ep-03 · modelo anthropic/claude')).toBeInTheDocument();
    expect(screen.getByText('Sem emoji.')).toBeInTheDocument();
    const versoes = screen.getByRole('list', { name: 'Versões do perfil' });
    expect(within(versoes).getAllByRole('listitem')).toHaveLength(2);
    expect(apiGet).toHaveBeenCalledWith('/pauta/voz', 'tok');
  });

  it('sem perfil diz que o roteiro e as peças saem no tom da casa', async () => {
    apiGet.mockResolvedValue(painel({ perfil: null, historico: [] }));
    renderAba();
    expect(await screen.findByText(/saem no tom da casa/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escrever à mão' })).toBeEnabled();
  });

  it('aprende dos episódios marcados e do texto colado, e mostra a versão nova', async () => {
    apiPost.mockResolvedValue({ ...painel({ perfil: { ...painel().perfil, versao: 3 } }), material: { fontes: 2, caracteres: 12288, cortado: false } });
    renderAba();
    const botao = await screen.findByRole('button', { name: 'Aprender a voz' });
    expect(botao).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /ep-03/ }));
    await userEvent.click(screen.getByLabelText('Texto colado 1'));
    await userEvent.paste(TEXTO);
    await userEvent.click(botao);
    expect(apiPost).toHaveBeenCalledWith('/pauta/voz/aprender', { episodios: ['e3'], textos: [{ texto: TEXTO.trim() }] }, 'tok');
    expect(await screen.findByText(/Perfil novo \(versão 3\) aprendido de 2 fonte\(s\), 12\.288 caracteres/)).toBeInTheDocument();
  });

  it('texto colado abaixo do mínimo não deixa aprender e diz o mínimo', async () => {
    renderAba();
    await userEvent.click(await screen.findByLabelText('Texto colado 1'));
    await userEvent.paste('curto demais');
    expect(screen.getByText(/mínimo 200/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprender a voz' })).toBeDisabled();
  });

  it('sem automacoes.executar o botão de aprender fica apagado com o porquê', async () => {
    renderAba({ podeGastarIa: false });
    const botao = await screen.findByRole('button', { name: 'Aprender a voz' });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute('title', expect.stringContaining('automacoes.executar'));
  });

  it('editar à mão salva com a versão lida e avisa quando o texto cita palavra proibida', async () => {
    apiPut.mockResolvedValue(painel({ perfil: { ...painel().perfil, versao: 3, sourceType: 'operador' } }));
    renderAba();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar à mão' }));
    const editor = screen.getByLabelText('Editar o perfil');
    await userEvent.clear(editor);
    await userEvent.click(editor);
    await userEvent.paste(`Frases curtas, sem enrolar. Nada de sinergia nem de discurso de palco. ${'x'.repeat(40)}`);
    expect(screen.getByRole('status')).toHaveTextContent('“sinergia”');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar versão' }));
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith(
        '/pauta/voz',
        { perfil: expect.stringContaining('Frases curtas'), versao: 2, chave: 'voz.pedro' },
        'tok',
      ),
    );
    expect(await screen.findByLabelText('Texto do perfil')).toBeInTheDocument();
  });

  it('abrir a edição de um perfil com a palavra proibida só no "Nunca diz" não avisa nada', async () => {
    renderAba();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar à mão' }));
    expect(screen.getByLabelText('Editar o perfil')).toHaveValue(PERFIL);
    expect(screen.queryByText(/a marca proíbe/)).not.toBeInTheDocument();
  });

  it('com a edição aberta, aprender e trocar a chave param; o salvar leva a versão e a chave de onde o rascunho partiu', async () => {
    apiPut.mockResolvedValue(painel({ perfil: { ...painel().perfil, versao: 4 } }));
    const onErro = vi.fn();
    const props = { token: 'tok', editavel: true, podeGastarIa: true, onErro };
    const { rerender } = render(<AbaVoz {...props} bump={0} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar à mão' }));
    await userEvent.click(screen.getByLabelText('Editar o perfil'));
    await userEvent.paste('\n- promessa sem número');
    await userEvent.click(screen.getByRole('checkbox', { name: /ep-03/ }));
    expect(screen.getByRole('button', { name: 'Aprender a voz' })).toBeDisabled();
    expect(screen.getByText(/Termine ou cancele a edição/)).toBeInTheDocument();
    expect(screen.getByLabelText('Chave da voz')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Usar esta chave' })).toBeDisabled();

    // Outra aba aprendeu no meio (v3): o painel recarrega, o rascunho continua da v2.
    apiGet.mockResolvedValue(painel({ perfil: { ...painel().perfil, versao: 3 } }));
    rerender(<AbaVoz {...props} bump={1} />);
    expect(await screen.findByText(/Versão 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar versão' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/pauta/voz', { perfil: `${PERFIL}\n- promessa sem número`, versao: 2, chave: 'voz.pedro' }, 'tok'));
  });

  it('os textos colados somados têm teto: passou, o botão para e diz quanto', async () => {
    renderAba();
    await screen.findByLabelText('Texto colado 1');
    for (let i = 0; i < 3; i++) await userEvent.click(screen.getByRole('button', { name: 'Adicionar outro texto' }));
    ['a', 'b', 'c'].forEach((l, i) => fireEvent.change(screen.getByLabelText(`Texto colado ${i + 1}`), { target: { value: l.repeat(20_000) } }));
    expect(screen.getByText(/Somados: 60\.000 de 60\.000 caracteres/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprender a voz' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Texto colado 4'), { target: { value: TEXTO } });
    expect(screen.getByText(/encurte algum texto/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprender a voz' })).toBeDisabled();
  });

  it('o campo da chave cabe a chave mais longa que o formato aceita', async () => {
    renderAba();
    expect(await screen.findByLabelText('Chave da voz')).toHaveAttribute('maxLength', '63');
  });

  it('sem pauta.editar nada se escreve', async () => {
    renderAba({ editavel: false });
    expect(await screen.findByRole('button', { name: 'Editar à mão' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /ep-03/ })).toBeDisabled();
    expect(screen.getByLabelText('Texto colado 1')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Usar esta chave' })).toBeDisabled();
  });

  it('troca a chave só sob voz., e a recusa da API vai para a caixa da página', async () => {
    apiPut.mockRejectedValueOnce(new Error('Permissão insuficiente'));
    const { onErro } = renderAba();
    const campo = await screen.findByLabelText('Chave da voz');
    await userEvent.clear(campo);
    await userEvent.type(campo, 'regra-desconto');
    expect(screen.getByRole('button', { name: 'Usar esta chave' })).toBeDisabled();
    expect(screen.getByText(/começa com “voz\.”/)).toBeInTheDocument();
    await userEvent.clear(campo);
    await userEvent.type(campo, 'voz.ana');
    await userEvent.click(screen.getByRole('button', { name: 'Usar esta chave' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/voz/chave', { chave: 'voz.ana' }, 'tok');
    await waitFor(() => expect(onErro).toHaveBeenLastCalledWith('Permissão insuficiente'));
  });

  it('a página tem a aba Voz, e ela abre o perfil', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/pauta/voz') return painel();
      return { items: [] };
    });
    render(<PautaPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Voz' }));
    expect(await screen.findByLabelText('Texto do perfil')).toBeInTheDocument();
  });
});
