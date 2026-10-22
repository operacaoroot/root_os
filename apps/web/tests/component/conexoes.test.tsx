import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A TELA DE CONEXÕES — fatia 5.4 (RF-X-01, RF-X-02, RF-X-06), refeita na rodada
 * dos agentes (A6, 21/10/2026) com o cartão único (`CartaoDeConexao`).
 *
 * A regra de desenho continua: A TELA NÃO CALCULA, ELA DESENHA O QUE O SERVIDOR
 * DECIDIU. O que esta suíte cobra:
 *
 *  1. O ESTADO É A SONDA, no vocabulário único: Conectado · Não configurado ·
 *     Erro: <motivo> · Desligado. "Erro" leva a frase REAL do conector, e
 *     "Desligado" nunca vira verde;
 *  2. A HORA DA MEDIÇÃO está à vista em todo cartão;
 *  3. DERRUBAR UM CONECTOR MARCA SÓ ELE; o aviso do topo conta quantos caíram;
 *  4. CONECTOR NOVO APARECE SEM TELA NOVA, com as mesmas ações;
 *  5. DESCONECTAR ≠ DESLIGAR: queimar a credencial só existe quando ela é da
 *     empresa, pede confirmação e vai à rota da revogação; desligar pede motivo
 *     e vai à rota do desligamento;
 *  6. TESTAR sonda pela chave do CONTRATO e atualiza as linhas irmãs juntas;
 *  7. QUEM USA vem do servidor (o cadastro único), e a credencial nunca aparece;
 *  8. quem não administra só lê e testa.
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

let PERMISSOES: string[] = ['dashboard.ver', 'admin.usuarios', 'tarefas.editar'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));
// O conteúdo próprio da Evolution e do Granola tem suíte própria; aqui só o cartão.
vi.mock('@/app/conexoes/ConexaoEvolution', () => ({ ConexaoEvolution: () => <p>conteúdo da Evolution</p> }));
vi.mock('@/app/conexoes/ConexaoGranola', () => ({ ConexaoGranola: () => <p>conteúdo do Granola</p> }));

// eslint-disable-next-line import/first
import ConexoesPage from '@/app/conexoes/page';

const AGORA = new Date().toISOString();
const SEGREDO = 'valor-de-credencial-que-nunca-vem';

function cartao(over: Record<string, unknown>) {
  return {
    key: 'x',
    nome: 'X',
    paraQueServe: 'Serve para algo.',
    categoria: 'teste',
    fase: 1,
    estado: 'conectado',
    motivo: null,
    medidoEm: AGORA,
    latenciaMs: 120,
    conta: null,
    ultimaSincronizacao: null,
    credencialNoCofre: false,
    desligado: false,
    desligadoEm: null,
    motivoDesligado: null,
    textoDoDesligamento: 'Desligar recusa a chamada na hora, com motivo.',
    grupo: null,
    contrato: null,
    usadoPor: [],
    ...over,
  };
}

const contratoDe = (chave: string, escopo: 'empresa' | 'processo', irmas: string[] = []) => ({
  chave,
  rotulo: chave === 'google' ? 'Google (Gmail, Agenda, Docs, Drive)' : chave,
  escopoDaCredencial: escopo,
  linhasIrmas: irmas,
});

const CARTOES = {
  autoridadeGerenciar: true,
  geradoEm: AGORA,
  items: [
    cartao({
      key: 'gmail', nome: 'Gmail', grupo: 'google', credencialNoCofre: true,
      estado: 'erro', motivo: 'O Google respondeu HTTP 401: {"error":"invalid_credentials"}. É preciso conectar de novo.',
      contrato: contratoDe('google', 'empresa', ['gcal']),
      usadoPor: [{ id: 'CO-13', nome: 'Redator da minuta', tipo: 'agente', estado: 'ativo' }],
    }),
    cartao({
      key: 'gcal', nome: 'Google Agenda', grupo: 'google', credencialNoCofre: true,
      estado: 'erro', motivo: 'a mesma falha do Gmail', contrato: contratoDe('google', 'empresa', ['gmail']),
      usadoPor: [{ id: 'AG-01', nome: 'Vigia da agenda', tipo: 'agente', estado: 'ativo' }],
    }),
    cartao({
      key: 'clickup', nome: 'ClickUp', estado: 'desligado', desligado: true, desligadoEm: AGORA,
      motivo: 'o Trabalho mora no OS', motivoDesligado: 'o Trabalho mora no OS', medidoEm: null, latenciaMs: null,
      contrato: contratoDe('clickup', 'processo'),
      usadoPor: [{ id: 'RO-01', nome: 'Sincronizador do ClickUp', tipo: 'rotina', estado: 'desligado' }],
    }),
    cartao({
      key: 'zapsign', nome: 'ZapSign (assinatura de contrato)', estado: 'nao_configurado',
      motivo: 'ZAPSIGN_API_TOKEN ausente no ambiente da API.', latenciaMs: null, contrato: contratoDe('zapsign', 'processo'),
    }),
    cartao({
      key: 'asaas', nome: 'Asaas (cobranças + conta digital)', estado: 'conectado', conta: 'produção',
      contrato: contratoDe('asaas', 'processo'),
      usadoPor: [{ id: 'FI-02', nome: 'Conciliação', tipo: 'rotina', estado: 'ativo' }],
    }),
    cartao({
      key: 'conector-novo-de-fora', nome: 'Conector de fora (declarado pelo contrato)', categoria: 'teste', fase: 0,
      conta: 'respondeu.', contrato: contratoDe('conector-novo-de-fora', 'empresa'),
    }),
    cartao({ key: 'evolution', nome: 'WhatsApp do comercial (Evolution)', estado: 'nao_configurado', motivo: 'Evolution não configurada nesta empresa.', contrato: contratoDe('evolution', 'empresa') }),
    cartao({ key: 'granola', nome: 'Granola', estado: 'nao_configurado', motivo: 'Granola não conectado.', contrato: contratoDe('granola', 'empresa') }),
  ],
};

const card = (nome: string) => screen.getByRole('region', { name: nome });

async function telaCarregada() {
  await waitFor(() => expect(screen.getByRole('region', { name: 'ClickUp' })).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSOES = ['dashboard.ver', 'admin.usuarios', 'tarefas.editar'];
  apiGet.mockImplementation(async (rota: string) => {
    if (rota === '/integrations/cartoes') return structuredClone(CARTOES);
    throw new Error(`rota inesperada ${rota}`);
  });
});

describe('o estado é a sonda, no vocabulário único', () => {
  it('Conectado, Não configurado, Erro: <motivo> e Desligado, cada um no seu cartão', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    expect(within(card('Asaas (cobranças + conta digital)')).getByTestId('estado-asaas')).toHaveTextContent(/^Conectado$/);
    expect(within(card('ZapSign (assinatura de contrato)')).getByTestId('estado-zapsign')).toHaveTextContent(/^Não configurado$/);
    expect(within(card('ClickUp')).getByTestId('estado-clickup')).toHaveTextContent(/^Desligado$/);
    const erro = within(card('Gmail')).getByTestId('estado-gmail');
    expect(erro.textContent).toMatch(/^Erro: O Google respondeu HTTP 401/);
    expect(erro.textContent).toContain('invalid_credentials');
  });

  it('Desligado nunca é verde e diz que não mediu', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    const selo = within(card('ClickUp')).getByTestId('estado-clickup');
    expect(selo.className).not.toMatch(/text-good/);
    expect(within(card('ClickUp')).getByTestId('medido-clickup')).toHaveTextContent('não medido: desligado');
    expect(within(card('ClickUp')).getByRole('button', { name: 'Religar' })).toBeInTheDocument();
  });

  it('a HORA da medição está à vista em todo cartão medido', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    expect(within(card('Asaas (cobranças + conta digital)')).getByTestId('medido-asaas')).toHaveTextContent(/há \d+ s/);
    expect(screen.getByTestId('legenda-dos-estados')).toHaveTextContent('Conectado · Não configurado · Erro: <motivo> · Desligado');
  });
});

describe('degradação, quem usa e o cofre', () => {
  it('o aviso do topo conta só os que caíram; os outros seguem', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    expect(screen.getByTestId('aviso-de-problema')).toHaveTextContent('2 conector(es) com erro: Gmail, Google Agenda');
    expect(within(card('Conector de fora (declarado pelo contrato)')).getByTestId('estado-conector-novo-de-fora')).toHaveTextContent('Conectado');
  });

  it('as linhas da MESMA credencial dizem que são a mesma credencial', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    expect(within(card('Gmail')).getByText('gcal')).toBeInTheDocument();
  });

  it('quem usa vem do cadastro, com o tipo e o estado', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    expect(within(card('ClickUp')).getByText('Sincronizador do ClickUp')).toBeInTheDocument();
    expect(within(card('ClickUp')).getByText(/rotina · desligado/)).toBeInTheDocument();
    expect(within(card('ZapSign (assinatura de contrato)')).getByText(/Nenhum agente nem rotina/)).toBeInTheDocument();
  });

  it('a credencial nunca aparece: só "guardada no cofre" ou "do processo"', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    expect(within(card('Gmail')).getByText('guardada no cofre desta empresa')).toBeInTheDocument();
    expect(within(card('Asaas (cobranças + conta digital)')).getByText('do processo (ambiente da API)')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SEGREDO);
  });

  it('o conteúdo próprio entra como filho do cartão do conector', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    const evolution = card('WhatsApp do comercial (Evolution)');
    await userEvent.click(within(evolution).getByRole('button', { name: 'Configurar' }));
    expect(within(evolution).getByText('conteúdo da Evolution')).toBeInTheDocument();
    expect(within(card('Gmail')).getByRole('link', { name: 'Abrir a página do Google' })).toHaveAttribute('href', '/google');
  });

  /*
   * Produção 22B (I6): Granola e Evolution no MESMO cartão dos demais, do mesmo
   * tamanho (nenhum ocupa a linha inteira), com as ações próprias numa gaveta
   * "Configurar" do próprio cartão. Fechada, a gaveta não monta o conteúdo.
   */
  it('Granola e Evolution: mesmo tamanho dos outros, ações próprias na gaveta Configurar', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    for (const nome of ['Granola', 'WhatsApp do comercial (Evolution)', 'Gmail', 'Asaas (cobranças + conta digital)']) {
      expect(card(nome).className, nome).not.toMatch(/col-span/);
    }
    const granola = card('Granola');
    expect(within(granola).queryByText('conteúdo do Granola')).toBeNull();
    const botao = within(granola).getByRole('button', { name: 'Configurar' });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(botao);
    expect(within(granola).getByRole('group', { name: 'Configurar Granola' })).toHaveTextContent('conteúdo do Granola');
    expect(within(granola).getByRole('button', { name: 'Fechar configuração' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(within(granola).getByRole('button', { name: 'Fechar configuração' }));
    expect(within(granola).queryByText('conteúdo do Granola')).toBeNull();
    // Os outros cartões não têm gaveta.
    expect(within(card('Gmail')).queryByRole('button', { name: 'Configurar' })).toBeNull();
  });
});

describe('conector novo aparece sem tela nova (RF-X-06)', () => {
  it('ganha cartão, estado e as mesmas ações', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    const c = card('Conector de fora (declarado pelo contrato)');
    for (const nome of ['Conectar', 'Testar', 'Desconectar', 'Desligar']) {
      expect(within(c).getByRole('button', { name: nome })).toBeInTheDocument();
    }
  });
});

describe('desconectar ≠ desligar', () => {
  it('credencial do PROCESSO não ganha Desconectar, mas ganha Desligar', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    const asaas = card('Asaas (cobranças + conta digital)');
    expect(within(asaas).queryByRole('button', { name: 'Desconectar' })).toBeNull();
    expect(within(asaas).getByRole('button', { name: 'Desligar' })).toBeInTheDocument();
  });

  it('credencial da EMPRESA: Desconectar confirma, avisa que não tem volta e vai à revogação', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ tipo: 'revogado', segredos: ['access_token'], resumo: 'queimada.' });
    render(<ConexoesPage />);
    await telaCarregada();
    const gmail = card('Gmail');
    await user.click(within(gmail).getByRole('button', { name: 'Desconectar' }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(within(gmail).getByText(/Não tem volta/)).toBeInTheDocument();
    await user.type(within(gmail).getByLabelText('Motivo'), 'vazou');
    await user.click(within(gmail).getByRole('button', { name: 'Desconectar agora' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/integrations/google/revogacao', { motivo: 'vazou' }, 'tok'));
    expect(await screen.findByText('queimada.')).toBeInTheDocument();
  });

  it('Desligar pede motivo e vai à rota do desligamento (pelo grupo, no Google)', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ ok: true });
    render(<ConexoesPage />);
    await telaCarregada();
    const gmail = card('Gmail');
    await user.click(within(gmail).getByRole('button', { name: 'Desligar' }));
    await user.type(within(gmail).getByLabelText('Motivo'), 'incidente');
    await user.click(within(gmail).getByRole('button', { name: 'Desligar agora' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/integrations/google/desligamento', { motivo: 'incidente' }, 'tok'));
  });

  it('Religar vai à mesma rota com DELETE', async () => {
    const user = userEvent.setup();
    apiDelete.mockResolvedValue({ ok: true });
    render(<ConexoesPage />);
    await telaCarregada();
    await user.click(within(card('ClickUp')).getByRole('button', { name: 'Religar' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/integrations/clickup/desligamento', 'tok'));
  });
});

describe('testar de novo', () => {
  it('sonda pela chave do CONTRATO e atualiza as linhas irmãs juntas', async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation(async (rota: string) => {
      if (rota === '/integrations/cartoes') return structuredClone(CARTOES);
      if (rota === '/integrations/google/saude') {
        return { estado: 'conectado', mensagem: 'contato@empresa.exemplo', apuracao: 'tentativa', verificadoEm: AGORA, latenciaMs: 87 };
      }
      throw new Error(`rota inesperada ${rota}`);
    });
    render(<ConexoesPage />);
    await telaCarregada();
    await user.click(within(card('Gmail')).getByRole('button', { name: 'Testar' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/integrations/google/saude', 'tok'));
    await waitFor(() => {
      expect(within(card('Gmail')).getByTestId('estado-gmail')).toHaveTextContent('Conectado');
      expect(within(card('Google Agenda')).getByTestId('estado-gcal')).toHaveTextContent('Conectado');
    });
    expect(within(card('Gmail')).getByText('contato@empresa.exemplo')).toBeInTheDocument();
  });

  it('Conectar com redirecionamento leva o navegador só a endereço seguro', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign, origin: 'http://localhost' } });
    apiPost.mockResolvedValue({ tipo: 'redirecionar', url: 'https://accounts.exemplo/o/oauth2?x=1' });
    try {
      render(<ConexoesPage />);
      await telaCarregada();
      await user.click(within(card('Gmail')).getByRole('button', { name: 'Conectar' }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/integrations/google/autorizacao', {}, 'tok'));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.exemplo/o/oauth2?x=1'));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('quem não administra testa, mas não conecta, desconecta nem desliga', async () => {
    PERMISSOES = ['dashboard.ver'];
    render(<ConexoesPage />);
    await telaCarregada();
    const c = card('Conector de fora (declarado pelo contrato)');
    expect(within(c).getByRole('button', { name: 'Testar' })).toBeInTheDocument();
    for (const nome of ['Conectar', 'Desconectar', 'Desligar', 'Sincronizar']) {
      expect(within(c).queryByRole('button', { name: nome })).toBeNull();
    }
  });
});

describe('o resto da tela continua honesto', () => {
  it('erro de rede vira caixa vermelha, e não tela em branco', async () => {
    apiGet.mockRejectedValue(new Error('API fora do ar'));
    render(<ConexoesPage />);
    expect(await screen.findByText('API fora do ar')).toBeInTheDocument();
  });

  it('resposta em formato desconhecido não desenha cartão nenhum', async () => {
    apiGet.mockResolvedValue({ items: [{ key: 'x', segredo: SEGREDO }] });
    render(<ConexoesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/formato que esta tela não conhece/);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(document.body.textContent).not.toContain(SEGREDO);
  });
});
