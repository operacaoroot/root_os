import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { METAS_CATALOGO, type MetaMedida, type MetasDoMesPainel } from '@mktos/shared';

/*
 * METAS DO MÊS — ROOT-53a, o lado da tela. O que ela garante: "sem dado" nunca
 * aparece como zero, fonte bloqueada mostra o motivo, "sem acesso" não mostra
 * número, e o texto da estratégia só vira meta quando a pessoa escolhe
 * indicador e alvo. A aba nova não mexe no painel do desafio.
 */

const apiGet = vi.fn();
const apiPut = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
    apiPost: vi.fn(),
  };
});

let permissoes = ['dashboard.ver', 'relatorios.gerar', 'leads.ver', 'bio.ver', 'pauta.ver'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import { MetasDoMes } from '@/app/metas/MetasDoMes';
// eslint-disable-next-line import/first
import MetasPage from '@/app/metas/page';

const SEMANAS = [
  { semana: '2026-W40', segunda: '2026-09-28', domingo: '2026-10-04', primeiroDia: '2026-10-01', ultimoDia: '2026-10-04', diasNoMes: 4 },
  { semana: '2026-W41', segunda: '2026-10-05', domingo: '2026-10-11', primeiroDia: '2026-10-05', ultimoDia: '2026-10-11', diasNoMes: 7 },
];

function meta(over: Partial<MetaMedida> = {}): MetaMedida {
  return {
    indicador: 'leads.novos',
    rotulo: 'Leads novos',
    unidade: 'leads',
    calculo: 'Leads que entraram no período.',
    alvo: 30,
    campanhaId: null,
    campanhaNome: null,
    origem: null,
    observacao: null,
    estado: 'com_dado',
    motivo: null,
    valor: 12,
    pct: 40,
    semanas: [
      { ...SEMANAS[0], estado: 'com_dado', valor: 7 },
      { ...SEMANAS[1], estado: 'com_dado', valor: 5 },
    ],
    ...over,
  };
}

function painel(over: Partial<MetasDoMesPainel> = {}): MetasDoMesPainel {
  return {
    mes: '2026-10',
    nota: { id: 'n1', versao: 2, atualizadoEm: '2026-10-02T12:00:00.000Z' },
    metas: [meta()],
    semanas: SEMANAS,
    avisos: [],
    catalogo: METAS_CATALOGO.map((i) => ({ ...i, permitido: true })),
    estrategia: null,
    meses: ['2026-10'],
    geradoEm: '2026-10-12T12:00:00.000Z',
    ...over,
  };
}

const servir = (p: MetasDoMesPainel) => apiGet.mockImplementation(async (path: string) => (path.startsWith('/goals/month/') ? p : {}));

async function abrir(p: MetasDoMesPainel) {
  servir(p);
  render(<MetasDoMes />);
  await screen.findByText(/Semana de segunda a domingo/);
}

beforeEach(() => {
  apiGet.mockReset();
  apiPut.mockReset();
  permissoes = ['dashboard.ver', 'relatorios.gerar', 'leads.ver', 'bio.ver', 'pauta.ver'];
});

describe('a medição na tela', () => {
  it('mostra o número, o alvo, o percentual e cada semana', async () => {
    await abrir(painel());
    const cartao = document.querySelector('[data-indicador="leads.novos"]') as HTMLElement;
    expect(within(cartao).getByText('Leads novos')).toBeInTheDocument();
    expect(within(cartao).getByText('12')).toBeInTheDocument();
    expect(within(cartao).getByText(/\/ 30 leads/)).toBeInTheDocument();
    expect(within(cartao).getByText('com dado')).toBeInTheDocument();
    expect(cartao.querySelector('[data-semana="2026-W40"]')).toHaveTextContent('W40 · 01/10–04/10');
    expect(cartao.querySelector('[data-semana="2026-W40"]')).toHaveTextContent('7 leads');
  });

  it('"sem dado" aparece como traço e como texto, nunca como zero', async () => {
    await abrir(
      painel({
        metas: [
          meta({
            estado: 'sem_dado',
            valor: null,
            pct: null,
            motivo: 'A fonte ainda não tem registro que cubra este mês: nenhum número foi contado.',
            semanas: [
              { ...SEMANAS[0], estado: 'sem_dado', valor: null },
              { ...SEMANAS[1], estado: 'sem_dado', valor: null },
            ],
          }),
        ],
      }),
    );
    const cartao = document.querySelector('[data-indicador="leads.novos"]') as HTMLElement;
    expect(within(cartao).getByText('—')).toBeInTheDocument();
    expect(within(cartao).getAllByText('sem dado').length).toBeGreaterThanOrEqual(3);
    expect(within(cartao).getByText(/nenhum número foi contado/)).toBeInTheDocument();
    expect(within(cartao).queryByText(/^0 /)).toBeNull();
    expect(within(cartao).queryByText('0')).toBeNull();
  });

  it('semana que ainda não começou diz isso, em vez de mostrar número', async () => {
    await abrir(painel({ metas: [meta({ semanas: [{ ...SEMANAS[0], estado: 'com_dado', valor: 3 }, { ...SEMANAS[1], estado: 'futura', valor: null }] })] }));
    expect(document.querySelector('[data-semana="2026-W41"]')).toHaveTextContent('ainda não começou');
  });

  it('fonte bloqueada mostra o motivo e esconde as semanas', async () => {
    await abrir(
      painel({
        metas: [
          meta({
            indicador: 'instagram.visualizacoes',
            rotulo: 'Visualizações no Instagram',
            unidade: 'visualizações',
            estado: 'bloqueada',
            valor: null,
            pct: null,
            motivo: 'Sem a foto de performance do mês. Conecte o Instagram e colete os números em Marketing › Performance.',
            semanas: [{ ...SEMANAS[0], estado: 'sem_dado', valor: null }],
          }),
        ],
      }),
    );
    const cartao = document.querySelector('[data-indicador="instagram.visualizacoes"]') as HTMLElement;
    expect(within(cartao).getByText('fonte bloqueada')).toBeInTheDocument();
    expect(within(cartao).getByText(/Sem a foto de performance do mês/)).toBeInTheDocument();
    expect(cartao.querySelector('[data-semana]')).toBeNull();
  });

  it('"sem acesso" não mostra número nem semana, só o alvo e o porquê', async () => {
    await abrir(
      painel({
        metas: [meta({ estado: 'sem_acesso', valor: null, pct: null, motivo: 'O número vem de leads e exige a permissão leads.ver.' })],
      }),
    );
    const cartao = document.querySelector('[data-indicador="leads.novos"]') as HTMLElement;
    expect(within(cartao).getByText('sem acesso')).toBeInTheDocument();
    expect(within(cartao).getByText('—')).toBeInTheDocument();
    expect(within(cartao).getByText(/\/ 30 leads/)).toBeInTheDocument();
    expect(within(cartao).getByText(/permissão leads\.ver/)).toBeInTheDocument();
    expect(cartao.querySelector('[data-semana]')).toBeNull();
  });

  it('mês sem nota: "sem meta", com o caminho para definir', async () => {
    await abrir(painel({ nota: null, metas: [], meses: [] }));
    expect(screen.getByText(/Este mês ainda não tem meta/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Definir as metas do mês' })).toBeInTheDocument();
  });

  it('nota malformada volta como aviso, sem derrubar a tela', async () => {
    await abrir(painel({ metas: [], avisos: ['A nota das metas não é um JSON válido (foi editada fora da tela?).'] }));
    expect(screen.getByText(/não é um JSON válido/)).toBeInTheDocument();
    expect(screen.queryByText(/Este mês ainda não tem meta/)).toBeNull();
  });

  it('erro da API aparece escrito', async () => {
    apiGet.mockRejectedValue(new Error('Falha de rede'));
    render(<MetasDoMes />);
    expect(await screen.findByText(/Falha de rede/)).toBeInTheDocument();
  });
});

describe('o mês de abertura (N5)', () => {
  it('é o mês de São Paulo, não o do relógio do navegador', async () => {
    // 01/11 02:00 em UTC ainda é 31/10 23:00 em São Paulo.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T02:00:00.000Z') });
    try {
      servir(painel());
      render(<MetasDoMes />);
      await screen.findByText(/Semana de segunda a domingo/);
      expect(apiGet).toHaveBeenCalledWith('/goals/month/2026-10', 'tok');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a revisão', () => {
  it('quem não pode gerar relatório só lê: sem botão de revisar', async () => {
    permissoes = ['dashboard.ver'];
    await abrir(painel());
    expect(screen.queryByRole('button', { name: /metas do mês/ })).toBeNull();
  });

  it('salva a lista com o alvo digitado em pt-BR, a versão lida e o indicador escolhido', async () => {
    apiPut.mockResolvedValue(painel({ nota: { id: 'n1', versao: 3, atualizadoEm: '2026-10-12T12:00:00.000Z' } }));
    await abrir(painel());
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Revisar as metas do mês' }));

    await u.clear(screen.getByLabelText('Alvo da meta 1'));
    await u.type(screen.getByLabelText('Alvo da meta 1'), '1.500,5');
    await u.click(screen.getByRole('button', { name: 'Adicionar meta' }));
    await u.selectOptions(screen.getByLabelText('Indicador da meta 2'), 'leads.por_campanha');
    await u.type(screen.getByLabelText('Alvo da meta 2'), '8');
    await u.type(screen.getByLabelText('Campanha da meta 2'), 'camp-1');
    await u.click(screen.getByRole('button', { name: 'Salvar revisão' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [caminho, corpo, token] = apiPut.mock.calls[0];
    expect(caminho).toMatch(/^\/goals\/month\/\d{4}-\d{2}$/);
    expect(token).toBe('tok');
    expect(corpo).toEqual({
      versao: 2,
      metas: [
        { indicador: 'leads.novos', alvo: 1500.5, campanhaId: null, origem: null, observacao: null },
        { indicador: 'leads.por_campanha', alvo: 8, campanhaId: 'camp-1', origem: null, observacao: null },
      ],
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Salvar revisão' })).toBeNull());
  });

  it('não envia meta sem indicador ou sem alvo, e diz o que falta', async () => {
    await abrir(painel({ nota: null, metas: [] }));
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Definir as metas do mês' }));
    await u.click(screen.getByRole('button', { name: 'Adicionar meta' }));
    await u.click(screen.getByRole('button', { name: 'Salvar revisão' }));
    expect(screen.getByText('Escolha o indicador de cada meta.')).toBeInTheDocument();

    await u.selectOptions(screen.getByLabelText('Indicador da meta 1'), 'bio.cliques');
    await u.click(screen.getByRole('button', { name: 'Salvar revisão' }));
    expect(screen.getByText(/Informe um alvo maior que zero para Cliques na bio/)).toBeInTheDocument();
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('o erro da API na revisão (conflito de versão, por exemplo) fica visível e a edição continua', async () => {
    apiPut.mockRejectedValue(new Error('A nota mudou desde a leitura (versão 2, agora 3) — recarregue e tente de novo.'));
    await abrir(painel());
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Revisar as metas do mês' }));
    await u.click(screen.getByRole('button', { name: 'Salvar revisão' }));
    expect(await screen.findByText(/A nota mudou desde a leitura/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar revisão' })).toBeInTheDocument();
  });

  it('remover e cancelar não gravam nada', async () => {
    await abrir(painel());
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Revisar as metas do mês' }));
    await u.click(screen.getByRole('button', { name: 'Remover a meta 1' }));
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(apiPut).not.toHaveBeenCalled();
  });
});

describe('as metas escritas na estratégia', () => {
  const estrategia = {
    notaId: 'nota-1-00000000',
    versao: 4,
    linhas: [
      { itemId: 'nota-1-00000000:aaaaaaaaaaaa', texto: 'Chegar a 40 leads até 31/10', origem: 'estrategia:nota-1-00000000:aaaaaaaaaaaa@v4', jaViraMeta: false },
      { itemId: 'nota-1-00000000:bbbbbbbbbbbb', texto: 'Publicar 12 peças', origem: 'estrategia:nota-1-00000000:bbbbbbbbbbbb@v4', jaViraMeta: true },
    ],
  };

  it('lista as linhas; o texto não vira meta sozinho e o que já virou fica marcado', async () => {
    await abrir(painel({ estrategia }));
    expect(screen.getByText('Chegar a 40 leads até 31/10')).toBeInTheDocument();
    expect(screen.getByText('já virou meta')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Criar meta desta linha' })).toHaveLength(1);
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('criar meta da linha abre a revisão SEM indicador nem alvo, e grava a origem quando a pessoa escolhe', async () => {
    apiPut.mockResolvedValue(painel());
    await abrir(painel({ estrategia }));
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Criar meta desta linha' }));

    const novoIndicador = screen.getByLabelText('Indicador da meta 2') as HTMLSelectElement;
    expect(novoIndicador.value).toBe('');
    expect((screen.getByLabelText('Alvo da meta 2') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/estrategia:nota-1-00000000:aaaaaaaaaaaa@v4/)).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Salvar revisão' }));
    expect(screen.getByText('Escolha o indicador de cada meta.')).toBeInTheDocument();
    expect(apiPut).not.toHaveBeenCalled();

    await u.selectOptions(novoIndicador, 'leads.novos');
    await u.type(screen.getByLabelText('Alvo da meta 2'), '25');
    // A meta 1 já é leads.novos: troca para outro indicador para não repetir.
    await u.selectOptions(screen.getByLabelText('Indicador da meta 1'), 'bio.cliques');
    await u.click(screen.getByRole('button', { name: 'Salvar revisão' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const metas = apiPut.mock.calls[0][1].metas;
    expect(metas[1]).toEqual({
      indicador: 'leads.novos',
      alvo: 25,
      campanhaId: null,
      origem: 'estrategia:nota-1-00000000:aaaaaaaaaaaa@v4',
      observacao: 'Chegar a 40 leads até 31/10',
    });
  });

  it('quem não pode editar vê as linhas, mas não o botão de criar meta', async () => {
    permissoes = ['dashboard.ver', 'pauta.ver'];
    await abrir(painel({ estrategia }));
    expect(screen.getByText('Chegar a 40 leads até 31/10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar meta desta linha' })).toBeNull();
  });
});

describe('a aba na página de Metas', () => {
  it('abre no painel do desafio e troca para as metas do mês sem recarregar o painel', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/goals/panel') throw new Error('painel do desafio indisponível');
      if (path.startsWith('/goals/month/')) return painel();
      return {};
    });
    render(<MetasPage />);
    expect(screen.getByRole('tab', { name: 'Desafio 365 dias' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/painel do desafio indisponível/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/goals/panel', 'tok');

    const u = userEvent.setup();
    await u.click(screen.getByRole('tab', { name: 'Metas do mês' }));
    expect(screen.getByRole('tab', { name: 'Metas do mês' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Leads novos')).toBeInTheDocument();
    expect(apiGet.mock.calls.some(([p]) => String(p).startsWith('/goals/month/'))).toBe(true);
  });
});


describe('isolamento de respostas por mês', () => {
  function pendente<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
  }

  it.each(['inversa', 'direta'])('preserva setembro ao resolver os GETs na ordem %s e salva alvo 200', async (ordem) => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T12:00:00Z') });
    try {
      const outubro = pendente<MetasDoMesPainel>();
      const setembro = pendente<MetasDoMesPainel>();
      apiGet.mockImplementation((path: string) => path.endsWith('2026-10') ? outubro.promise : setembro.promise);
      apiPut.mockResolvedValue(painel({ mes: '2026-09', nota: { id: 'setembro', versao: 1, atualizadoEm: '2026-10-07T12:00:00Z' }, metas: [meta({ alvo: 200 })] }));
      render(<MetasDoMes />);
      expect(apiGet).toHaveBeenCalledWith('/goals/month/2026-10', 'tok');
      fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-09' } });
      expect(apiGet).toHaveBeenCalledWith('/goals/month/2026-09', 'tok');
      const antigo = () => outubro.resolve(painel({ nota: { id: 'outubro', versao: 1, atualizadoEm: '2026-10-07T12:00:00Z' }, metas: [meta({ alvo: 900 })] }));
      const atual = () => setembro.resolve(painel({ mes: '2026-09', nota: { id: 'setembro', versao: 1, atualizadoEm: '2026-10-07T12:00:00Z' }, metas: [meta({ alvo: 200 })] }));
      for (const resolver of ordem === 'inversa' ? [atual, antigo] : [antigo, atual]) {
        await act(async () => { resolver(); });
      }
      expect(screen.getByLabelText('Mês')).toHaveValue('2026-09');
      fireEvent.click(screen.getByRole('button', { name: 'Revisar as metas do mês' }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar revisão' })); });
      expect(apiPut).toHaveBeenCalledWith('/goals/month/2026-09', {
        versao: 1,
        metas: [{ indicador: 'leads.novos', alvo: 200, campanhaId: null, origem: null, observacao: null }],
      }, 'tok');
      expect(screen.getByText(/\/ 200 leads/)).toBeInTheDocument();
      expect(screen.queryByText(/\/ 900 leads/)).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('ignora erro de GET do mês abandonado', async () => {
    const antigo = pendente<MetasDoMesPainel>();
    apiGet.mockReturnValueOnce(antigo.promise).mockResolvedValue(painel({ mes: '2026-09' }));
    render(<MetasDoMes />);
    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-09' } });
    await screen.findByText('Leads novos');
    await act(async () => { antigo.reject(new Error('erro do mês anterior')); });
    expect(screen.queryByText(/erro do mês anterior/)).toBeNull();
    expect(screen.getByText('Leads novos')).toBeInTheDocument();
  });

  it.each(['sucesso', 'erro'])('preserva a revisão atual quando o PUT anterior termina com %s', async (resultado) => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T12:00:00Z') });
    try {
      const gravacao = pendente<MetasDoMesPainel>();
      apiPut.mockReturnValueOnce(gravacao.promise);
      apiGet.mockImplementation(async (path: string) => painel({ mes: path.split('/').at(-1), metas: [meta({ alvo: 200 })] }));
      render(<MetasDoMes />);
      await screen.findByText('Leads novos');
      fireEvent.click(screen.getByRole('button', { name: 'Revisar as metas do mês' }));
      fireEvent.click(screen.getByRole('button', { name: 'Salvar revisão' }));
      expect(apiPut.mock.calls[0][0]).toBe('/goals/month/2026-10');
      fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-09' } });
      await screen.findByText('Leads novos');
      fireEvent.click(screen.getByRole('button', { name: 'Revisar as metas do mês' }));
      fireEvent.change(screen.getByLabelText('Alvo da meta 1'), { target: { value: '250' } });
      await act(async () => {
        if (resultado === 'sucesso') gravacao.resolve(painel({ nota: { id: 'outubro', versao: 1, atualizadoEm: '2026-10-07T12:00:00Z' }, metas: [meta({ alvo: 900 })] }));
        else gravacao.reject(new Error('erro de gravação de outubro'));
      });
      expect(screen.getByText('Revisão de 2026-09')).toBeInTheDocument();
      expect(screen.getByLabelText('Alvo da meta 1')).toHaveValue('250');
      expect(screen.getByRole('button', { name: 'Salvar revisão' })).toBeEnabled();
      expect(screen.queryByText(/erro de gravação de outubro/)).toBeNull();
      expect(screen.queryByText(/\/ 900 leads/)).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
