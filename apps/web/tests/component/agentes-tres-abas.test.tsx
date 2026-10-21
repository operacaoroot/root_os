import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CatalogoDeFuncoes, LinhaDoCatalogo } from '@mktos/shared';

/*
 * A TELA DE AGENTES EM TRÊS ABAS (rodada dos agentes, 21/10/2026, A7).
 *
 *  · três abas (Agentes, Rotinas, Automações e integrações), com a contagem;
 *  · o filtro padrão é "ativos"; área e dono moram no endereço da página;
 *  · a linha do agente com registro abre o controle de hoje (o mesmo cartão);
 *  · sem o catálogo, a tela volta à grade de cartões de antes e diz por quê.
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

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Rodrigo', email: 'r@x.com', roles: [], permissions: ['mcp.ver', 'mcp.executar', 'admin.usuarios', 'automacoes.executar'] },
    can: () => true,
  }),
}));

// eslint-disable-next-line import/first
import AgentesPage from '@/app/agentes/page';
// eslint-disable-next-line import/first
import { ErroDaApi } from '@/lib/api';

const LUCAS = { id: 'u-lucas', nome: 'Lucas' };
const PEDRO = { id: 'u-pedro', nome: 'Pedro' };

function linha(over: Partial<LinhaDoCatalogo>): LinhaDoCatalogo {
  return {
    id: 'CO-03',
    slug: 'leitor-de-ata-do-comercial',
    nome: 'Leitor de ata do comercial',
    area: 'Comercial',
    tipo: 'agente',
    aba: 'agentes',
    paraQueServe: 'Lê a transcrição da reunião.',
    estado: 'ativo',
    estadoDeclarado: 'ativo',
    estadoMotivo: null,
    dono: { efetivo: LUCAS, origem: 'padrao', padrao: 'lucas', bancoForaDaEquipe: false },
    modelo: { modelo: 'claude-opus-5-5', esforco: 'high', origem: 'cadastro' },
    modeloExterno: null,
    gatilho: 'ata.chegou',
    frequencia: 'por reunião',
    nivel: '',
    capacidades: [],
    ultima: { em: '2026-10-20T12:00:00.000Z', status: null, fonte: 'gasto' },
    proxima: null,
    rotina: null,
    gastoMes: { totalUsd: 0.1234, chamadas: 3 },
    onde: 'comercial/diagnostico.service.ts',
    soNoPapel: false,
    registrado: false,
    ...over,
  };
}

const CATALOGO: CatalogoDeFuncoes = {
  mes: '2026-10',
  provedor: 'stub',
  padrao: { modelo: 'claude-opus-5-5', esforco: 'high' },
  geradoEm: '2026-10-21T10:00:00.000Z',
  linhas: [
    linha({}),
    linha({ id: 'CO-16', slug: 'triagem-do-whatsapp', nome: 'Triagem do WhatsApp', estado: 'desligado', estadoDeclarado: 'desligado' }),
    linha({
      id: 'IM-01',
      slug: 'leitor-de-ata',
      nome: 'Leitor de ata do onboarding',
      area: 'Implantação',
      dono: { efetivo: PEDRO, origem: 'banco', padrao: 'pedro', bancoForaDaEquipe: false },
      registrado: true,
    }),
    linha({
      id: 'RO-04',
      slug: 'relogio-do-comercial',
      nome: 'Relógio do comercial',
      area: 'Rotinas da casa',
      tipo: 'rotina',
      aba: 'rotinas',
      modelo: null,
      gastoMes: null,
      rotina: { tipo: 'comercial.relogio', cadastradas: 1, ativas: 1 },
      ultima: { em: '2026-10-21T09:00:00.000Z', status: 'ok', fonte: 'rotina' },
      proxima: { em: '2026-10-21T09:30:00.000Z', fonte: 'rotina' },
    }),
    linha({ id: 'CA-02', slug: 'aprovacao-pelo-whatsapp', nome: 'Aprovação pelo WhatsApp', area: 'Canais e integrações', tipo: 'automacao', aba: 'automacoes', modelo: null }),
  ],
};

function agenteDoRoster(slug: string) {
  return {
    slug,
    nome: 'Leitor de ata (registro)',
    iniciais: 'LA',
    missao: 'ler',
    pilar: null,
    dono: PEDRO,
    tipo: 'llm',
    estado: 'ativo',
    situacao: 'ocioso',
    estadoPor: null,
    estadoEm: null,
    estadoMotivo: null,
    transicoes: ['pausado', 'encerrado'],
    autonomiaAte: 'R1',
    rebaixadoAte: null,
    capacidades: [],
    cron: null,
    ultimaExecucaoEm: null,
    ultimoStatus: null,
    execucoes: 0,
    falhas: 0,
    horas: { estado: 'sem-linha-de-base', naSemana: null, passagensNaSemana: 0, diasDaJanela: 7, janelaCoberta: false, cobreDesde: null },
    horasAcumuladas: null,
    passagensBemSucedidas: 0,
    linhaDeBase: null,
    orcamento: null,
    temProcedimento: false,
    procedimento: null,
    faltando: ['dono'],
  };
}

const ROSTER = {
  items: [agenteDoRoster('leitor-de-ata')],
  kpis: {
    ativos: 1, rodandoAgora: 0, comErro: 0, pausados: 0, encerrados: 0, horasSemana: null,
    horasSemanaDe: { agentesContados: 0, semLinhaDeBase: 1, semHistorico: 0, parciais: 0, diasDaJanela: 7 },
    semLinhaDeBase: 1, comOrcamento: 0, semProcedimento: 1,
  },
};

function servir(catalogo: unknown = CATALOGO) {
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/agents') return ROSTER;
    if (url === '/agents/cadastro') {
      if (catalogo instanceof Error) throw catalogo;
      return catalogo;
    }
    return {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/agentes');
});
afterEach(() => cleanup());

describe('as três abas', () => {
  it('Agentes, Rotinas e Automações e integrações, com a contagem dos ativos', async () => {
    servir();
    render(<AgentesPage />);
    const abas = await screen.findAllByRole('tab');
    expect(abas.map((a) => a.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Agentes 2',
      'Rotinas 1',
      'Automações e integrações 1',
    ]);
    expect(abas[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('o padrão é "ativos": o agente desligado não aparece até trocar o filtro', async () => {
    servir();
    render(<AgentesPage />);
    await screen.findByTestId('linha-leitor-de-ata-do-comercial');
    expect(screen.queryByTestId('linha-triagem-do-whatsapp')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'todos');
    expect(screen.getByTestId('linha-triagem-do-whatsapp')).toBeInTheDocument();
    expect(window.location.search).toBe('?estado=todos');
  });

  it('cada linha diz para que serve, dono, modelo e esforço, gatilho, gasto e onde mexer', async () => {
    servir();
    render(<AgentesPage />);
    const li = await screen.findByTestId('linha-leitor-de-ata-do-comercial');
    expect(within(li).getByText('Lê a transcrição da reunião.')).toBeInTheDocument();
    expect(within(li).getByText('Lucas (padrão)')).toBeInTheDocument();
    expect(within(li).getByText(/claude-opus-5-5 · high/)).toBeInTheDocument();
    expect(within(li).getByText('ata.chegou · por reunião')).toBeInTheDocument();
    expect(within(li).getByText(/US\$ 0,1234 · 3 chamada/)).toBeInTheDocument();
    expect(within(li).getByText(/comercial\/diagnostico\.service\.ts/)).toBeInTheDocument();
  });

  it('a aba Rotinas mostra última e próxima execução e leva a /rotinas; vai ao endereço', async () => {
    servir();
    render(<AgentesPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /Rotinas/ }));
    const li = screen.getByTestId('linha-relogio-do-comercial');
    expect(within(li).getByText(/· ok/)).toBeInTheDocument();
    const proxima = new Date('2026-10-21T09:30:00.000Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    expect(within(li).getByText(proxima)).toBeInTheDocument();
    expect(within(li).getByRole('link', { name: /rotinas/ })).toHaveAttribute('href', '/rotinas');
    expect(window.location.search).toBe('?aba=rotinas');
    expect(screen.queryByTestId('linha-leitor-de-ata-do-comercial')).toBeNull();
  });
});

describe('área e dono no endereço', () => {
  it('a página abre com o filtro que está no endereço', async () => {
    window.history.replaceState(null, '', `/agentes?area=Implanta%C3%A7%C3%A3o&dono=${PEDRO.id}`);
    servir();
    render(<AgentesPage />);
    await screen.findByTestId('linha-leitor-de-ata');
    expect(screen.queryByTestId('linha-leitor-de-ata-do-comercial')).toBeNull();
    expect(screen.getByLabelText('Área')).toHaveValue('Implantação');
    expect(screen.getByLabelText('Dono')).toHaveValue(PEDRO.id);
  });

  it('escolher o dono escreve no endereço', async () => {
    servir();
    render(<AgentesPage />);
    await screen.findByTestId('linha-leitor-de-ata-do-comercial');
    await userEvent.selectOptions(screen.getByLabelText('Dono'), LUCAS.id);
    expect(window.location.search).toBe(`?dono=${LUCAS.id}`);
    expect(screen.queryByTestId('linha-leitor-de-ata')).toBeNull();
  });
});

describe('o controle de hoje dentro da linha', () => {
  it('a linha do agente registrado abre o mesmo cartão (procedimento, estado, orçamento)', async () => {
    servir();
    render(<AgentesPage />);
    const li = await screen.findByTestId('linha-leitor-de-ata');
    expect(within(li).queryByText('escrever procedimento')).toBeNull();
    await userEvent.click(within(li).getByRole('button', { name: 'abrir o controle' }));
    expect(within(li).getByText('escrever procedimento')).toBeInTheDocument();
    expect(within(li).getByText(/falta dono/)).toBeInTheDocument();
    expect(within(li).getByRole('link', { name: 'sessões' })).toHaveAttribute('href', '/sessoes?agente=leitor-de-ata');
    // A linha sem registro não oferece controle.
    const semRegistro = screen.getByTestId('linha-leitor-de-ata-do-comercial');
    expect(within(semRegistro).queryByRole('button', { name: 'abrir o controle' })).toBeNull();
  });
});

describe('sem o catálogo', () => {
  it('rota ausente: volta à grade de cartões e diz por quê', async () => {
    servir(new ErroDaApi('Cannot GET /api/agents/cadastro', 404));
    render(<AgentesPage />);
    await screen.findByText(/Catálogo indisponível/);
    expect(screen.getByText('Leitor de ata (registro)')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});
