import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * ==========================================================================
 * A TELA DE AGENTES: ESTADO, BOTÕES E "INVOCAR" — fatia A2
 * ==========================================================================
 *
 * O que esta suíte cobra, e por que cada caso existe:
 *
 *  1. DOIS SELOS, PORQUE SÃO DOIS EIXOS. `estado` é a decisão do dono e
 *     `situacao` é o que está acontecendo. A tela mostra os dois — "ativo ·
 *     ocioso" é informação diferente de "ativo · erro na última passagem" — e
 *     não repete a palavra quando os dois dizem o mesmo;
 *  2. OS BOTÕES VÊM DO SERVIDOR. Quais existem sai de `agente.transicoes`, não
 *     de um `if` daqui. Agente encerrado não ganha botão nenhum: a regra
 *     "encerrado não volta" tem um dono só, e ele é a API;
 *  3. A TELA DIZ O QUE O BOTÃO FAZ ANTES DO CLIQUE — inclusive que o que o
 *     agente tentar acima da autonomia FICA RETIDO e que R3+ precisa de outra
 *     pessoa. É a lição da tela do Google, que anunciava "✅ enviado" em cima de
 *     um 200 de retenção;
 *  4. ENCERRAR PEDE MOTIVO NA TELA, porque a API recusa sem ele. Botão
 *     desabilitado até a pessoa escrever — melhor do que um 400 depois do
 *     clique;
 *  5. OS DOIS KPIs NÃO SE CONFUNDEM. "Em operação" é decisão; "Rodando agora" é
 *     medição. Era um cartão só chamado "Rodando", contando o estado declarado.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
  };
});

let PERMISSOES: string[] = ['mcp.ver', 'mcp.executar', 'admin.usuarios', 'automacoes.executar'];

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import AgentesPage from '@/app/agentes/page';

/* --------------------------------------------------------------- fixtures -- */

function agente(over: Record<string, unknown> = {}) {
  return {
    slug: 'assistente',
    nome: 'Assistente da central',
    iniciais: 'AC',
    missao: 'responder com fonte',
    pilar: 'Contexto',
    dono: { id: 'u-eu', nome: 'Pedro' },
    tipo: 'llm',
    estado: 'ativo',
    situacao: 'ocioso',
    estadoPor: null,
    estadoEm: null,
    estadoMotivo: null,
    transicoes: ['pausado', 'encerrado'],
    autonomiaAte: 'R1',
    rebaixadoAte: null,
    capacidades: ['numeros.painel.ler'],
    cron: null,
    ultimaExecucaoEm: null,
    ultimoStatus: null,
    execucoes: 0,
    falhas: 0,
    /* fatia A3: as horas saem do log de passagens, com o estado da medição. */
    horas: {
      estado: 'sem-linha-de-base',
      naSemana: null,
      passagensNaSemana: 0,
      diasDaJanela: 7,
      janelaCoberta: false,
      cobreDesde: null,
    },
    horasAcumuladas: null,
    passagensBemSucedidas: 0,
    linhaDeBase: null,
    orcamento: null,
    temProcedimento: true,
    procedimento: { versao: 1, atualizadoEm: '2026-09-01T10:00:00.000Z' },
    faltando: [],
    ...over,
  };
}

function roster(itens: Record<string, unknown>[], kpis: Record<string, unknown> = {}) {
  return {
    items: itens,
    kpis: {
      ativos: itens.length,
      rodandoAgora: 0,
      comErro: 0,
      pausados: 0,
      encerrados: 0,
      horasSemana: null,
      horasSemanaDe: {
        agentesContados: 0,
        semLinhaDeBase: itens.length,
        semHistorico: 0,
        parciais: 0,
        diasDaJanela: 7,
      },
      semLinhaDeBase: itens.length,
      comOrcamento: 0,
      semProcedimento: 0,
      ...kpis,
    },
  };
}

const card = (nome: string) => screen.getByText(nome).closest('div.rounded-root') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSOES = ['mcp.ver', 'mcp.executar', 'admin.usuarios', 'automacoes.executar'];
});

/* ------------------------------------------------------------------ casos -- */

describe('A2: os dois selos', () => {
  it('mostra o estado declarado E a situação medida', async () => {
    apiGet.mockResolvedValue(roster([agente({ estado: 'ativo', situacao: 'ocioso' })]));
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByText('ativo')).toBeInTheDocument());
    expect(screen.getByText('ocioso')).toBeInTheDocument();
  });

  it('"erro na última passagem" aparece sem apagar o "ativo"', async () => {
    apiGet.mockResolvedValue(roster([agente({ estado: 'ativo', situacao: 'erro' })]));
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByText('ativo')).toBeInTheDocument());
    expect(screen.getByText('erro na última passagem')).toBeInTheDocument();
  });

  it('não repete a palavra quando os dois eixos dizem o mesmo', async () => {
    apiGet.mockResolvedValue(
      roster([agente({ estado: 'pausado', situacao: 'pausado', transicoes: ['ativo', 'encerrado'] })]),
    );
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getAllByText('pausado')).toHaveLength(1));
  });

  it('quem pausou, quando e por quê — a decisão tem procedência na tela', async () => {
    apiGet.mockResolvedValue(
      roster([
        agente({
          estado: 'pausado',
          situacao: 'pausado',
          transicoes: ['ativo', 'encerrado'],
          estadoPor: 'Lucas Fernandes',
          estadoEm: '2026-09-10T13:00:00.000Z',
          estadoMotivo: 'mandou mensagem errada no grupo',
        }),
      ]),
    );
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByText(/por Lucas Fernandes/)).toBeInTheDocument());
    expect(screen.getByText(/motivo: mandou mensagem errada no grupo/)).toBeInTheDocument();
  });
});

describe('A2: os botões vêm das transições que o servidor mandou', () => {
  it('agente ativo: Pausar e Encerrar, nunca Retomar', async () => {
    apiGet.mockResolvedValue(roster([agente({ transicoes: ['pausado', 'encerrado'] })]));
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Encerrar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retomar' })).not.toBeInTheDocument();
  });

  it('agente pausado: Retomar e Encerrar, nunca Pausar de novo', async () => {
    apiGet.mockResolvedValue(
      roster([agente({ estado: 'pausado', situacao: 'pausado', transicoes: ['ativo', 'encerrado'] })]),
    );
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retomar' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
  });

  it('AGENTE ENCERRADO NÃO GANHA BOTÃO — e a tela diz por quê', async () => {
    apiGet.mockResolvedValue(
      roster([agente({ estado: 'encerrado', situacao: 'encerrado', transicoes: [] })]),
    );
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByText('encerrado')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Retomar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invocar' })).not.toBeInTheDocument();
    expect(screen.getByText(/Encerrado não volta/)).toBeInTheDocument();
  });

  it('sem `admin.usuarios` não aparece botão de estado nenhum', async () => {
    PERMISSOES = ['mcp.ver'];
    apiGet.mockResolvedValue(roster([agente()]));
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByText('ativo')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encerrar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invocar' })).not.toBeInTheDocument();
  });

  it('pausar vai direto para a rota de pausar — freio não pede redação', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    apiPost.mockResolvedValue({ ok: true, estado: 'pausado', transicoes: [], desde: null });
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Pausar' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/agents/assistente/pausar', { motivo: undefined }, 'tok'),
    );
  });
});

describe('A2: encerrar é definitivo, e a tela cobra o motivo antes do clique', () => {
  it('o botão de confirmar fica desabilitado até alguém escrever o motivo', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Encerrar' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Encerrar' }));

    // A frase do que vai acontecer aparece JUNTO com o pedido de motivo.
    expect(screen.getByText(/NÃO VOLTA/)).toBeInTheDocument();
    const confirmar = screen.getByRole('button', { name: /Encerrar de vez/ });
    expect(confirmar).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/Motivo/), 'trabalho virou rotina');
    expect(screen.getByRole('button', { name: /Encerrar de vez/ })).toBeEnabled();
  });

  it('o motivo escrito vai no corpo da chamada', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    apiPost.mockResolvedValue({ ok: true, estado: 'encerrado', transicoes: [], desde: null });
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Encerrar' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Encerrar' }));
    await userEvent.type(screen.getByLabelText(/Motivo/), 'trabalho virou rotina');
    await userEvent.click(screen.getByRole('button', { name: /Encerrar de vez/ }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/agents/assistente/encerrar',
        { motivo: 'trabalho virou rotina' },
        'tok',
      ),
    );
  });
});

describe('A2: "Invocar" diz o que vai acontecer ANTES do clique', () => {
  it('avisa que o que passar da autonomia fica retido e precisa de outra pessoa', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Invocar' })).toBeInTheDocument());
    const aviso = within(card('Assistente da central')).getByText(/fica retido em Aprovações/);
    expect(aviso).toBeInTheDocument();
    expect(aviso.textContent).toMatch(/OUTRA pessoa/);
  });

  it('não oferece Invocar para agente pausado — a API recusaria', async () => {
    apiGet.mockResolvedValue(
      roster([agente({ estado: 'pausado', situacao: 'pausado', transicoes: ['ativo', 'encerrado'] })]),
    );
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retomar' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Invocar' })).not.toBeInTheDocument();
  });

  it('MOSTRA O DESFECHO QUE A API DEVOLVEU, não um sucesso inventado', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    apiPost.mockResolvedValue({
      sessionId: 's1',
      status: 'retida',
      resposta: '',
      motivo: 'aguardando aprovação de outra pessoa',
    });
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Invocar' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Invocar' }));

    await waitFor(() => expect(screen.getByText(/passagem:/)).toBeInTheDocument());
    expect(screen.getByText(/retida/)).toBeInTheDocument();
    expect(screen.getByText(/aguardando aprovação de outra pessoa/)).toBeInTheDocument();
  });

  it('a recusa da API aparece na tela, e não em silêncio', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    apiPost.mockRejectedValue(new Error('Agente pausado pelo dono.'));
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Invocar' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Invocar' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Agente pausado'));
  });
});

describe('A2: os dois KPIs não se confundem', () => {
  it('"Em operação" é decisão e "Rodando agora" é medição', async () => {
    apiGet.mockResolvedValue(
      roster([agente(), agente({ slug: 'curador', nome: 'Curador' })], {
        ativos: 2,
        rodandoAgora: 1,
        comErro: 1,
      }),
    );
    render(<AgentesPage />);

    await waitFor(() => expect(screen.getByText('Em operação')).toBeInTheDocument());
    expect(screen.getByText('Rodando agora')).toBeInTheDocument();
    // O cartão de decisão diz, com letras, que não é medição.
    expect(screen.getByText(/não quer dizer que estão rodando agora/)).toBeInTheDocument();
    // E o de medição carrega o número de quem falhou na última passagem.
    expect(screen.getByText(/1 com erro na última passagem/)).toBeInTheDocument();
  });
});
