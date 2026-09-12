import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A TELA DE CONEXÕES — fatia 5.4, RF-X-01, RF-X-02, RF-X-06.
 *
 * Metade do critério de pronto desta fatia é sobre o que a PESSOA vê, e até aqui
 * só a API tinha teste. O que esta suíte cobra é a mesma regra de desenho do
 * resto do produto — A TELA NÃO CALCULA, ELA DESENHA O QUE O SERVIDOR DECIDIU —
 * aplicada aos quatro pontos do critério:
 *
 *  1. O ESTADO EXIBIDO CORRESPONDE AO ESTADO REAL. O selo principal é a `saude`
 *     (uma sonda), não o `status` (um registro de banco que continua dizendo
 *     "conectado" depois de o token ter sido revogado do lado do fornecedor);
 *  2. DERRUBAR UM CONECTOR MARCA SÓ ELE. As outras linhas continuam verdes e a
 *     tela inteira continua de pé — é a degradação, vista de fora;
 *  3. A MENSAGEM É A DO CONECTOR. Nada de tabela de "erro conhecido → texto
 *     bonito": o que o fornecedor disse é o que aparece;
 *  4. CONECTOR NOVO APARECE SEM TELA NOVA. Uma linha que o catálogo estático não
 *     conhece, declarada só pelo contrato, ganha card, selo e os mesmos botões.
 *
 * E mais duas que vieram da revisão: `nao_verificado` NUNCA é verde, e a IDADE
 * da medição está à vista (a API guarda cada sonda por trinta segundos, e isso
 * só é honesto enquanto a tela diz de quando é o que ela mostra).
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

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));

let PERMISSOES: string[] = ['dashboard.ver', 'admin.usuarios', 'tarefas.editar'];

// eslint-disable-next-line import/first
import ConexoesPage from '@/app/conexoes/page';

/* ------------------------------------------------------------- o catálogo -- */

const AGORA = new Date('2026-09-11T12:00:00.000Z').toISOString();

function linha(over: Record<string, unknown>) {
  return {
    key: 'x',
    label: 'X',
    category: 'produtividade',
    phase: 1,
    authType: 'oauth2',
    requires: 'credencial do root',
    status: 'disconnected',
    health: null,
    connectedAt: null,
    lastSyncAt: null,
    lastError: null,
    managed: false,
    desligado: false,
    desligadoEm: null,
    desligadoPor: null,
    motivoDesligado: null,
    grupo: null,
    aplicacaoDoDesligamento: 'recusa',
    textoDoDesligamento: 'Toda ferramenta deste conector é recusada com motivo.',
    contrato: null,
    saude: null,
    ...over,
  };
}

const contratoDe = (chave: string, escopo: 'empresa' | 'processo', irmas: string[] = []) => ({
  chave,
  rotulo: chave === 'google' ? 'Google (Gmail, Agenda, Docs, Drive)' : chave,
  escopoDaCredencial: escopo,
  verbos: ['autorizar', 'sincronizar', 'saude', 'revogar'],
  linhasIrmas: irmas,
});

const saude = (over: Record<string, unknown>) => ({
  estado: 'conectado',
  mensagem: null,
  apuracao: 'tentativa',
  verificadoEm: AGORA,
  latenciaMs: 120,
  ...over,
});

/**
 * O catálogo que a API devolveria com um conector VERDE, um VERMELHO, um
 * DESLIGADO (portanto não sondado) e um que nem existe no catálogo estático.
 */
const CATALOGO = {
  items: [
    linha({
      key: 'gmail',
      label: 'Gmail',
      // O REGISTRO DO BANCO DIZ "conectado"; a sonda diz que o token morreu.
      status: 'error',
      contrato: contratoDe('google', 'empresa', ['gcal']),
      saude: saude({
        estado: 'erro',
        mensagem:
          'O Google respondeu HTTP 401 ao conferir a conta: {"error":"invalid_credentials"} — ' +
          'a autorização desta empresa foi revogada do lado do Google.',
      }),
    }),
    linha({
      key: 'gcal',
      label: 'Google Agenda',
      status: 'error',
      contrato: contratoDe('google', 'empresa', ['gmail']),
      saude: saude({ estado: 'erro', mensagem: 'a mesma falha do Gmail' }),
    }),
    linha({
      key: 'clickup',
      label: 'ClickUp',
      authType: 'api_key',
      managed: true,
      status: 'connected',
      contrato: contratoDe('clickup', 'processo'),
      saude: saude({ mensagem: 'token pessoal de pedro.' }),
    }),
    linha({
      key: 'whatsapp',
      label: 'WhatsApp (Evolution)',
      authType: 'api_key',
      managed: true,
      status: 'connected',
      desligado: true,
      desligadoEm: AGORA,
      desligadoPor: 'pedro',
      motivoDesligado: 'suspeita de vazamento',
      contrato: contratoDe('whatsapp', 'processo'),
      saude: saude({
        estado: 'nao_verificado',
        apuracao: 'nao_verificado',
        latenciaMs: null,
        mensagem:
          '"WhatsApp (Evolution)" está desligado para esta empresa desde ontem. Nada foi ' +
          'chamado: sondar a saúde sairia da casa. Religue em Conexões para voltar a medir.',
      }),
    }),
    linha({
      key: 'conector-novo-de-fora',
      label: 'Conector de fora (declarado pelo contrato)',
      category: 'teste',
      phase: 0,
      requires: 'declarado pelo próprio conector',
      contrato: contratoDe('conector-novo-de-fora', 'empresa'),
      saude: saude({ mensagem: 'respondeu.' }),
    }),
  ],
  source: { tool: 'banco-interno', generatedAt: AGORA },
};

/**
 * O card de um conector.
 *
 * `getByText` sozinho não serve: o rótulo aparece também na caixa de avisos do
 * topo (que lista quem caiu) e dentro do botão de desligar. O card é o único em
 * que o rótulo é o TÍTULO — a `div.font-medium`.
 */
function card(nome: string): HTMLElement {
  const titulo = screen
    .getAllByText(nome)
    .find((el) => el.className.includes('font-medium'));
  const alvo = titulo?.closest('div.flex.flex-col');
  if (!alvo) throw new Error(`não achei o card de "${nome}"`);
  return alvo as HTMLElement;
}

/** Espera a tela carregar sem depender de um rótulo que aparece em dois lugares. */
async function telaCarregada(): Promise<void> {
  await waitFor(() => expect(screen.getByText(/o hub de conectores/)).toBeInTheDocument());
  await waitFor(() => expect(card('ClickUp')).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSOES = ['dashboard.ver', 'admin.usuarios', 'tarefas.editar'];
  apiGet.mockResolvedValue(structuredClone(CATALOGO));
});

/* ------------------------------------------------- 1. o estado é o real ---- */

describe('o selo é a sonda, não o registro do banco', () => {
  it('mostra verde só onde a sonda respondeu, e vermelho com a mensagem REAL', async () => {
    render(<ConexoesPage />);
    await telaCarregada();

    expect(within(card('ClickUp')).getByText('conectado')).toBeInTheDocument();

    const gmail = card('Gmail');
    expect(within(gmail).getByText('erro')).toBeInTheDocument();
    // A frase do fornecedor chega inteira — a tela não tem tradutor de erro.
    expect(within(gmail).getByText(/invalid_credentials/)).toBeInTheDocument();
    expect(within(gmail).getByText(/HTTP 401/)).toBeInTheDocument();
  });

  it('`não verificado` é CINZA e diz por quê — nunca verde', async () => {
    render(<ConexoesPage />);
    await telaCarregada();

    const wa = card('WhatsApp (Evolution)');
    const selo = within(wa).getByText('não verificado');
    expect(selo).toBeInTheDocument();
    expect(selo.className).not.toMatch(/text-good/);
    expect(within(wa).queryByText('conectado')).not.toBeInTheDocument();
    expect(within(wa).getByText(/Nada foi chamado/)).toBeInTheDocument();
  });

  it('a IDADE da medição está à vista (a API guarda a sonda por pouco tempo)', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    // "sondado há …" — sem isso, guardar a medição por trinta segundos viraria
    // "conectado" sobre uma chamada que ninguém sabe de quando é.
    expect(within(card('ClickUp')).getByText(/sondado há/)).toBeInTheDocument();
  });
});

/* ----------------------------------------------------- 2. a degradação ----- */

describe('derrubar um conector degrada só o que depende dele', () => {
  it('marca as linhas do conector caído e deixa as outras verdes', async () => {
    render(<ConexoesPage />);
    await telaCarregada();

    // O aviso do topo conta quantos caíram e afirma o resto.
    expect(screen.getByText(/2 conector\(es\) com problema/)).toBeInTheDocument();
    expect(screen.getByText(/Só o que depende deles está\s+degradado/)).toBeInTheDocument();

    // E as linhas que não dependem do Google seguem verdes.
    expect(within(card('ClickUp')).getByText('conectado')).toBeInTheDocument();
    expect(
      within(card('Conector de fora (declarado pelo contrato)')).getByText('conectado'),
    ).toBeInTheDocument();
  });

  it('as duas linhas da MESMA credencial dizem que o erro é o mesmo', async () => {
    render(<ConexoesPage />);
    await telaCarregada();
    expect(within(card('Gmail')).getByText(/mesma credencial de gcal/)).toBeInTheDocument();
  });
});

/* --------------------------------- 3. conector novo sem tocar na tela ------ */

describe('conector novo aparece sem tela nova (RF-X-06)', () => {
  it('ganha card, selo e os mesmos botões, com o rótulo que a API mandou', async () => {
    render(<ConexoesPage />);
    await telaCarregada();

    const c = card('Conector de fora (declarado pelo contrato)');
    expect(within(c).getByRole('button', { name: 'Verificar' })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Autorizar' })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Sincronizar' })).toBeInTheDocument();
    // Categoria e fase vêm do que o próprio conector declarou.
    expect(within(c).getByText(/teste · fase 0/)).toBeInTheDocument();
  });
});

/* ------------------------------------------- 4. revogar ≠ desligar --------- */

describe('revogar ≠ desligar, e a tela não oferece o botão errado', () => {
  it('credencial do PROCESSO não ganha botão de revogar', async () => {
    render(<ConexoesPage />);
    await telaCarregada();

    const clickup = card('ClickUp');
    expect(within(clickup).queryByText(/Revogar credencial/)).not.toBeInTheDocument();
    // Mas o interruptor por empresa, esse, existe para ele.
    expect(within(clickup).getByRole('button', { name: /Desligar ClickUp/ })).toBeInTheDocument();
  });

  it('credencial da EMPRESA ganha revogar, com confirmação e aviso de que não tem volta', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ tipo: 'revogado', segredos: ['access_token'], resumo: 'queimada.' });
    render(<ConexoesPage />);
    await telaCarregada();

    const gmail = card('Gmail');
    await user.click(within(gmail).getByText(/Revogar credencial/));

    // Duas etapas: o primeiro clique abre o aviso, não queima nada.
    expect(apiPost).not.toHaveBeenCalled();
    expect(within(gmail).getByText(/não tem volta/)).toBeInTheDocument();

    await user.click(within(gmail).getByRole('button', { name: 'Queimar credencial' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/integrations/google/revogacao',
        expect.anything(),
        'tok',
      ),
    );
    // O resumo do conector é o que a pessoa lê — a tela não inventa frase.
    expect(await screen.findByText('queimada.')).toBeInTheDocument();
  });

  it('desligar pede motivo e manda para a rota do desligamento, não para a de revogação', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ ok: true });
    render(<ConexoesPage />);
    await telaCarregada();

    const clickup = card('ClickUp');
    await user.click(within(clickup).getByRole('button', { name: /Desligar ClickUp/ }));
    await user.type(within(clickup).getByLabelText(/Motivo/), 'incidente');
    await user.click(within(clickup).getByRole('button', { name: 'Desligar agora' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/integrations/clickup/desligamento',
        { motivo: 'incidente' },
        'tok',
      ),
    );
  });
});

/* ------------------------------------------------- 5. verificar de novo ---- */

describe('verificar de novo', () => {
  it('sonda pela chave do CONTRATO e atualiza as linhas irmãs juntas', async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation(async (rota: string) => {
      if (rota === '/integrations/catalog') return structuredClone(CATALOGO);
      return saude({ estado: 'conectado', mensagem: 'voltou a responder.', latenciaMs: 87 });
    });

    render(<ConexoesPage />);
    await telaCarregada();

    await user.click(within(card('Gmail')).getByRole('button', { name: 'Verificar' }));

    // Uma credencial, uma chamada — e pela chave do contrato (`google`), não
    // pela linha da tela (`gmail`).
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/integrations/google/saude', 'tok'),
    );
    // As duas superfícies do Google viram verde juntas: é a mesma medição.
    await waitFor(() => {
      expect(within(card('Gmail')).getByText('conectado')).toBeInTheDocument();
      expect(within(card('Google Agenda')).getByText('conectado')).toBeInTheDocument();
    });
  });

  it('quem não administra não vê autorizar/sincronizar, mas ainda pode verificar', async () => {
    PERMISSOES = ['dashboard.ver'];
    render(<ConexoesPage />);
    await telaCarregada();

    const c = card('ClickUp');
    expect(within(c).getByRole('button', { name: 'Verificar' })).toBeInTheDocument();
    expect(within(c).queryByRole('button', { name: 'Autorizar' })).not.toBeInTheDocument();
    expect(within(c).queryByRole('button', { name: 'Sincronizar' })).not.toBeInTheDocument();
  });
});

/* ----------------------------------------------------- 6. o que sobra ------ */

describe('o resto da tela continua honesto', () => {
  it('o aviso do desligamento separa quem é BARRADO de quem só fica REGISTRADO', async () => {
    const comRegistro = structuredClone(CATALOGO);
    comRegistro.items[3].aplicacaoDoDesligamento = 'registro';
    apiGet.mockResolvedValue(comRegistro);

    render(<ConexoesPage />);
    await telaCarregada();

    expect(screen.getByText(/ainda não é barrada/)).toBeInTheDocument();
  });

  it('erro de rede vira caixa vermelha, e não tela em branco', async () => {
    apiGet.mockRejectedValue(new Error('API fora do ar'));
    render(<ConexoesPage />);
    expect(await screen.findByText('API fora do ar')).toBeInTheDocument();
  });
});
