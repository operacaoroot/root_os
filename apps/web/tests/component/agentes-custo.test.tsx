import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * ==========================================================================
 * A TELA DE AGENTES: HORAS HONESTAS E ORÇAMENTO MENSAL — fatia A3
 * ==========================================================================
 *
 * A DÍVIDA QUE ESTA SUÍTE FECHA, escrita no CLAUDE.md: "A tela de Agentes ainda
 * mente sobre o mesmo número: ela publica horas 'por semana' que são acumulado
 * de vida inteira, com as passagens que FALHARAM dentro, e mostra a fórmula na
 * tela."
 *
 * A parte de baixo do conserto (a conta, a fonte e o contrato da API) tem suíte
 * na api — `test/horas-do-agente.test.ts`. Aqui se cobra o que só a TELA pode
 * errar:
 *
 *  1. O NÚMERO SEMANAL APARECE COM A JANELA ESCRITA, e a fórmula visível é a
 *     verdadeira (× passagens da semana, não × execuções da vida).
 *  2. O ACUMULADO APARECE COM O NOME DELE, ao lado, e nunca no lugar do
 *     semanal.
 *  3. "NÃO DEU PARA CONTAR" NÃO VIRA ZERO. Falhar medindo é ausência de
 *     medição, e a tela precisa dizer isso em vez de publicar 0 h.
 *  4. O ORÇAMENTO DIZ ANTES DO CLIQUE o que vai acontecer: observação soma e
 *     não corta; zero valendo PARA o agente e exige motivo escrito.
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
    slug: 'analista',
    nome: 'Analista de dados',
    iniciais: 'AD',
    missao: 'medir o que aconteceu',
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
    /* O estado que a dívida produzia: cem passagens na vida, cinquenta com erro. */
    execucoes: 100,
    falhas: 50,
    horas: {
      estado: 'medida',
      naSemana: 0.7,
      passagensNaSemana: 2,
      diasDaJanela: 7,
      janelaCoberta: true,
      cobreDesde: '2026-09-07T12:00:00.000Z',
    },
    horasAcumuladas: 16.7,
    passagensBemSucedidas: 50,
    linhaDeBase: { minutosPorExecucao: 20, informadaEm: '2026-09-01T10:00:00.000Z' },
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
      horasSemana: 0.7,
      horasSemanaDe: {
        agentesContados: itens.length,
        semLinhaDeBase: 0,
        semHistorico: 0,
        parciais: 0,
        diasDaJanela: 7,
      },
      semLinhaDeBase: 0,
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
  apiPost.mockResolvedValue({ ok: true });
});

/* ------------------------------------------------------------------ horas -- */

describe('A3: as horas param de mentir', () => {
  it('o número é o da SEMANA, com a janela escrita e a fórmula verdadeira', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    render(<AgentesPage />);

    const c = await waitFor(() => card('Analista de dados'));
    const texto = c.textContent ?? '';

    // o número medido, com o período à vista
    expect(texto).toContain('0.7 h');
    expect(texto).toContain('7 dias');
    // a fórmula é × PASSAGENS DA SEMANA. A antiga era × 100 execuções.
    expect(texto).toContain('20 min × 2 passagem');
    expect(texto).not.toContain('20 min × 100');
  });

  it('o acumulado aparece com o NOME dele, e não no lugar do semanal', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    render(<AgentesPage />);

    const texto = (await waitFor(() => card('Analista de dados'))).textContent ?? '';
    /*
     * 16,7 h é o acumulado honesto (50 passagens boas × 20 min). Ele pode
     * aparecer — é informação de verdade —, desde que diga que é acumulado. O
     * que não pode é ocupar a linha do semanal, que era exatamente o defeito.
     */
    expect(texto).toContain('16.7 h acumuladas');
    expect(texto).toMatch(/0\.7 h[\s\S]*devolvidas em 7 dias/);
  });

  it('o cartão do topo declara a janela e quantos agentes ficaram fora da soma', async () => {
    apiGet.mockResolvedValue(
      roster([agente()], {
        horasSemana: 12.5,
        horasSemanaDe: {
          agentesContados: 3,
          semLinhaDeBase: 2,
          semHistorico: 1,
          parciais: 0,
          diasDaJanela: 7,
        },
      }),
    );
    render(<AgentesPage />);

    expect(await screen.findByText(/Horas devolvidas · 7 dias/)).toBeTruthy();
    expect(screen.getByText(/medido de 3 agente\(s\)/)).toBeTruthy();
    expect(screen.getByText(/2 fora por falta de linha de base/)).toBeTruthy();
    expect(screen.getByText(/1 sem histórico/)).toBeTruthy();
  });

  it('"não deu para contar" NÃO vira zero hora — é ausência de medição', async () => {
    apiGet.mockResolvedValue(
      roster([
        agente({
          horas: {
            estado: 'sem-historico',
            naSemana: null,
            passagensNaSemana: 0,
            diasDaJanela: 7,
            janelaCoberta: false,
            cobreDesde: null,
          },
        }),
      ]),
    );
    render(<AgentesPage />);

    const texto = (await waitFor(() => card('Analista de dados'))).textContent ?? '';
    expect(texto).toContain('não deu para contar as passagens da semana');
    expect(texto).not.toContain('0 h devolvidas');
  });

  it('sem linha de base, a tela oferece declarar em vez de publicar número', async () => {
    apiGet.mockResolvedValue(
      roster(
        [
          agente({
            horas: {
              estado: 'sem-linha-de-base',
              naSemana: null,
              passagensNaSemana: 0,
              diasDaJanela: 7,
              janelaCoberta: false,
              cobreDesde: null,
            },
            horasAcumuladas: null,
            linhaDeBase: null,
          }),
        ],
        { horasSemana: null, semLinhaDeBase: 1 },
      ),
    );
    render(<AgentesPage />);

    const c = await waitFor(() => card('Analista de dados'));
    expect(within(c).getByText(/informar a linha de base/)).toBeTruthy();
    expect(screen.getByText(/ninguém informou a linha de base ainda/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------- orçamento -- */

describe('A3: o orçamento mensal diz o que faz ANTES do clique', () => {
  it('sem orçamento, a tela diz que só o teto da empresa o segura', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    render(<AgentesPage />);

    const c = await waitFor(() => card('Analista de dados'));
    expect(within(c).getByText(/sem orçamento mensal/)).toBeTruthy();
    expect(within(c).getByText(/definir orçamento/)).toBeTruthy();
  });

  it('orçamento VALENDO diz que a chamada é recusada, e cita quem decidiu', async () => {
    apiGet.mockResolvedValue(
      roster([
        agente({
          orcamento: {
            mensalUsd: 20,
            ativo: true,
            definidoEm: '2026-09-10T12:00:00.000Z',
            definidoPor: 'Pedro',
            motivo: 'piloto do mês',
          },
        }),
      ]),
    );
    render(<AgentesPage />);

    const c = await waitFor(() => card('Analista de dados'));
    expect(c.textContent).toContain('valendo: passa disso e a chamada é recusada');
    expect(c.textContent).toContain('por Pedro');
    expect(c.textContent).toContain('piloto do mês');
  });

  it('orçamento EM OBSERVAÇÃO não tem a mesma cara — ele soma e NÃO corta', async () => {
    /*
     * Dizer só "tem orçamento" treinaria a pessoa a achar que está protegida
     * quando não está: em observação, nenhuma chamada é recusada.
     */
    apiGet.mockResolvedValue(
      roster([
        agente({
          orcamento: {
            mensalUsd: 20,
            ativo: false,
            definidoEm: null,
            definidoPor: null,
            motivo: null,
          },
        }),
      ]),
    );
    render(<AgentesPage />);

    const c = await waitFor(() => card('Analista de dados'));
    expect(c.textContent).toContain('em observação: soma e NÃO corta');
    expect(c.textContent).not.toContain('passa disso e a chamada é recusada');
  });

  it('desligar o corte avisa que nada será recusado', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    render(<AgentesPage />);

    const c = await waitFor(() => card('Analista de dados'));
    await userEvent.click(within(c).getByText(/definir orçamento/));
    await userEvent.click(within(c).getByLabelText(/cortar quando estourar/));

    expect(within(c).getByText(/fica em OBSERVAÇÃO/)).toBeTruthy();
  });

  it('ZERO VALENDO avisa que PARA o agente, e o motivo passa a ser obrigatório', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    render(<AgentesPage />);

    const c = await waitFor(() => card('Analista de dados'));
    await userEvent.click(within(c).getByText(/definir orçamento/));
    await userEvent.type(within(c).getByPlaceholderText('20,00'), '0');

    expect(within(c).getByText(/toda chamada de modelo dele passa a ser recusada/)).toBeTruthy();
    const salvar = within(c).getByRole('button', { name: /salvar/i });
    expect((salvar as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(
      within(c).getByPlaceholderText('motivo (obrigatório)'),
      'agente em revisão',
    );
    expect((salvar as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(salvar);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/agents/analista/orcamento',
        { mensalUsd: 0, ativo: true, motivo: 'agente em revisão' },
        'tok',
      ),
    );
  });

  it('vírgula decimal é aceita — o valor vai em ponto para a API', async () => {
    apiGet.mockResolvedValue(roster([agente()]));
    render(<AgentesPage />);

    const c = await waitFor(() => card('Analista de dados'));
    await userEvent.click(within(c).getByText(/definir orçamento/));
    await userEvent.type(within(c).getByPlaceholderText('20,00'), '12,50');
    await userEvent.click(within(c).getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/agents/analista/orcamento',
        { mensalUsd: 12.5, ativo: true, motivo: undefined },
        'tok',
      ),
    );
  });

  it('sem a dupla que a API exige, a tela não oferece o botão', async () => {
    PERMISSOES = ['mcp.ver'];
    apiGet.mockResolvedValue(roster([agente()]));
    render(<AgentesPage />);

    const c = await waitFor(() => card('Analista de dados'));
    expect(within(c).queryByText(/definir orçamento/)).toBeNull();
  });
});
