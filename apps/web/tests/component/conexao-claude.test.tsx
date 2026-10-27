import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * O CLAUDE (ANTHROPIC) EM CONEXÕES (leva 5, L8, 27/10/2026).
 *
 * O estado do CONECTOR é o do cartão padrão (`conexoes.test.tsx`). Este é o
 * conteúdo da gaveta "Configurar", e o que promete: a chave digitada vai ao cofre
 * e some do campo; a tela nunca mostra a chave, só a data e os 4 últimos; Testar
 * faz uma chamada e mostra o resultado em português; Remover pede confirmação e
 * diz que volta a variável de ambiente; o modelo por função é só leitura; o teto
 * diário tem o link da tela; quem não administra só lê. No catálogo, o cartão do
 * Claude tem Testar e Configurar, e não tem Conectar, Desconectar nem Desligar.
 * Chaves daqui são inventadas.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiDelete = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
  };
});

let PERMISSOES = ['dashboard.ver', 'admin.usuarios'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Rodrigo', email: 'r@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));
vi.mock('@/app/conexoes/ConexaoEvolution', () => ({ ConexaoEvolution: () => null }));
vi.mock('@/app/conexoes/ConexaoGranola', () => ({ ConexaoGranola: () => null }));

// eslint-disable-next-line import/first
import { ConexaoClaude } from '@/app/conexoes/ConexaoClaude';
// eslint-disable-next-line import/first
import IntegracoesPage from '@/app/conexoes/page';

const CHAVE_DIGITADA = 'sk-ant-api03-chave-inventada-que-nao-pode-voltar-0000005678';

function estado(over: Record<string, unknown> = {}) {
  return {
    chave: { origem: 'ambiente', gravadaEm: null, versao: null, final: null, ambienteTemChave: true },
    modelosPermitidos: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    modelosPorFuncao: [
      { id: 'CO-03', nome: 'Leitor de ata do comercial', area: 'Comercial', tipo: 'agente', estado: 'ativo', modelo: 'claude-opus-5-5', esforco: 'high', origem: 'cadastro' },
      { id: 'CO-11', nome: 'Vigia das 08h', area: 'Comercial', tipo: 'agente', estado: 'ativo', modelo: 'claude-sonnet-5-5', esforco: 'medium', origem: 'variavel' },
    ],
    teto: { configurado: true, ativo: true, tetoUsd: 20, comprometidoUsd: 1.5, restanteUsd: 18.5, dia: '2026-10-27' },
    caminhoDoTeto: '/painel/custo-ia',
    ...over,
  };
}
const NO_COFRE = { origem: 'cofre', gravadaEm: '2026-10-27T01:30:00.000Z', versao: 2, final: '5678', ambienteTemChave: true };

let ESTADO = estado();

const linhaDoCartao = (key: string, nome: string, over: Record<string, unknown> = {}) => ({
  key, nome, paraQueServe: 'p', categoria: 'ai', fase: 0, estado: 'conectado', motivo: 'chave da variável de ambiente da API',
  medidoEm: new Date().toISOString(), latenciaMs: 120, conta: 'chave da variável de ambiente da API', ultimaSincronizacao: null, credencialNoCofre: false,
  desligado: false, desligadoEm: null, motivoDesligado: null, textoDoDesligamento: 't', grupo: null,
  contrato: { chave: key, rotulo: nome, escopoDaCredencial: 'empresa', linhasIrmas: [] }, usadoPor: [{ id: 'CO-03', nome: 'Leitor de ata do comercial', tipo: 'agente', estado: 'ativo' }], ...over,
});
const CARTOES = {
  autoridadeGerenciar: true,
  geradoEm: new Date().toISOString(),
  items: [linhaDoCartao('anthropic', 'Claude (Anthropic)'), linhaDoCartao('zapsign', 'ZapSign', { contrato: { chave: 'zapsign', rotulo: 'ZapSign', escopoDaCredencial: 'processo', linhasIrmas: [] } })],
};

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSOES = ['dashboard.ver', 'admin.usuarios'];
  ESTADO = estado();
  apiGet.mockImplementation(async (rota: string) => {
    if (rota === '/integrations/cartoes') return CARTOES;
    if (rota === '/integrations/anthropic/estado') return ESTADO;
    throw new Error(`rota inesperada ${rota}`);
  });
});

describe('a gaveta do Claude', () => {
  it('diz de onde vem a chave, lista o modelo por função (só leitura) e o teto com o link', async () => {
    render(<ConexaoClaude token="tok" gerenciar />);
    expect(await screen.findByTestId('claude-estado-da-chave')).toHaveTextContent('Usando a variável de ambiente da API');
    const tabela = screen.getByTestId('claude-modelos');
    expect(within(tabela).getByText('claude-opus-5-5')).toBeInTheDocument();
    expect(within(tabela).getByText('da variável por função')).toBeInTheDocument();
    expect(within(tabela).queryByRole('combobox')).toBeNull();
    expect(screen.getByText(/Modelos permitidos: claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5/)).toBeInTheDocument();
    expect(screen.getByTestId('claude-teto')).toHaveTextContent('US$ 20.00 por dia');
    expect(screen.getByRole('link', { name: 'Ver o teto diário de custo de IA' })).toHaveAttribute('href', '/painel/custo-ia');
    // Sem chave no cofre, não há o que remover.
    expect(screen.queryByTestId('claude-remover')).toBeNull();
  });

  it('grava a chave no cofre: a chave some do campo e não volta; só a data e os 4 últimos aparecem', async () => {
    apiPut.mockImplementation(async () => {
      ESTADO = estado({ chave: NO_COFRE });
      return { ok: true, final: '5678', versao: 2 };
    });
    render(<ConexaoClaude token="tok" gerenciar />);
    await screen.findByTestId('claude-estado-da-chave');
    const user = userEvent.setup();
    const campo = screen.getByTestId('claude-chave') as HTMLInputElement;
    expect(campo.type).toBe('password');
    expect(screen.getByTestId('claude-gravar')).toBeDisabled();
    await user.type(campo, CHAVE_DIGITADA);
    await user.click(screen.getByTestId('claude-gravar'));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/integrations/anthropic/chave', { chave: CHAVE_DIGITADA }, 'tok'));
    expect(await screen.findByText(/Chave gravada no cofre da empresa \(····5678\)/)).toBeInTheDocument();
    expect(campo.value).toBe('');
    await waitFor(() => expect(screen.getByTestId('claude-estado-da-chave')).toHaveTextContent(/gravada no cofre desta empresa em .* ····5678 \(versão 2\)/));
    expect(document.body.textContent).not.toContain(CHAVE_DIGITADA);
    expect(screen.getByTestId('claude-remover')).toBeInTheDocument();
  });

  it('a chave recusada pela API vira a frase dela, e a chave digitada não aparece', async () => {
    apiPut.mockImplementation(async () => { throw new Error('Isto não parece uma chave da Anthropic: ela começa com "sk-ant-".'); });
    render(<ConexaoClaude token="tok" gerenciar />);
    await screen.findByTestId('claude-estado-da-chave');
    const user = userEvent.setup();
    await user.type(screen.getByTestId('claude-chave'), 'chave-errada');
    await user.click(screen.getByTestId('claude-gravar'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/começa com "sk-ant-"/);
  });

  it('Testar faz uma chamada e mostra o resultado em português; o erro também', async () => {
    apiPost.mockImplementationOnce(async () => ({ ok: true, origem: 'ambiente', final: '9999', modelo: 'claude-opus-5-5', latenciaMs: 230, erro: null }));
    render(<ConexaoClaude token="tok" gerenciar />);
    await screen.findByTestId('claude-estado-da-chave');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('claude-testar'));
    expect(apiPost).toHaveBeenCalledWith('/integrations/anthropic/testar', {}, 'tok');
    expect(await screen.findByTestId('claude-sonda')).toHaveTextContent('A Anthropic respondeu em 230 ms com a chave da variável de ambiente (modelo listado: claude-opus-5-5).');
    apiPost.mockImplementationOnce(async () => ({ ok: false, origem: 'ambiente', final: '9999', modelo: null, latenciaMs: 90, erro: 'A Anthropic recusou a chave (401): inválida ou revogada.' }));
    await user.click(screen.getByTestId('claude-testar'));
    await waitFor(() => expect(screen.getByTestId('claude-sonda')).toHaveTextContent('Erro: A Anthropic recusou a chave (401)'));
  });

  it('Remover pede confirmação, vai à rota e diz que volta a variável de ambiente', async () => {
    ESTADO = estado({ chave: NO_COFRE });
    apiDelete.mockImplementation(async () => {
      ESTADO = estado();
      return { ok: true, revogada: true, voltaPara: 'ambiente' };
    });
    render(<ConexaoClaude token="tok" gerenciar />);
    await screen.findByTestId('claude-remover');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('claude-remover'));
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('claude-remover-confirmar'));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/integrations/anthropic/chave', 'tok'));
    expect(await screen.findByText(/Volta a valer a variável de ambiente da API/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('claude-estado-da-chave')).toHaveTextContent('Usando a variável de ambiente'));
  });

  it('quem não administra só lê: sem campo, sem Testar, sem Remover', async () => {
    ESTADO = estado({ chave: NO_COFRE });
    render(<ConexaoClaude token="tok" gerenciar={false} />);
    expect(await screen.findByTestId('claude-estado-da-chave')).toHaveTextContent('····5678');
    expect(screen.queryByTestId('claude-chave')).toBeNull();
    expect(screen.queryByTestId('claude-testar')).toBeNull();
    expect(screen.queryByTestId('claude-remover')).toBeNull();
    expect(screen.getByTestId('claude-modelos')).toBeInTheDocument();
  });
});

describe('o cartão do Claude na tela de Conexões', () => {
  it('tem Testar e Configurar (com a gaveta), e não tem Conectar, Desconectar nem Desligar', async () => {
    render(<IntegracoesPage />);
    const claude = await screen.findByRole('region', { name: 'Claude (Anthropic)' });
    expect(within(claude).getByTestId('estado-anthropic')).toHaveTextContent('Conectado');
    expect(within(claude).getByRole('button', { name: 'Testar' })).toBeInTheDocument();
    for (const nome of ['Conectar', 'Desconectar', 'Desligar', 'Sincronizar']) {
      expect(within(claude).queryByRole('button', { name: nome }), nome).toBeNull();
    }
    await userEvent.setup().click(within(claude).getByRole('button', { name: 'Configurar' }));
    expect(await within(claude).findByTestId('conteudo-claude')).toBeInTheDocument();
    // Os outros cartões seguem com as ações de sempre.
    const zapsign = screen.getByRole('region', { name: 'ZapSign' });
    expect(within(zapsign).getByRole('button', { name: 'Desligar' })).toBeInTheDocument();
  });
});
