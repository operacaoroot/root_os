import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PainelDeTarefas, TarefaDoDia, TrabEstrutura } from '@mktos/shared';

/*
 * DIA A DIA › VISÃO GERAL (versão final, 19/10/2026): o dash das tarefas do
 * Lucas, primeira aba e entrada do Dia a dia, com o "por área" trocado por
 * pasta e lista do Trabalho (decisão 4). Todo número leva ao Trabalho já
 * filtrado ("Todas"), e só a equipe (não as contas do sistema) aparece como
 * responsável. O Painel geral da empresa (/painel) não repete o dash: mostra a
 * empresa numa linha por motor.
 */

const apiGet = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a) };
});

let PERMISSOES = ['dashboard.ver', 'tarefas.ver'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import VisaoGeralPage from '@/app/dia-a-dia/page';
// eslint-disable-next-line import/first
import PainelGeralDaEmpresa from '@/app/painel/page';
// eslint-disable-next-line import/first
import { urlDoTrabalho } from '@/components/tarefas/VisaoGeralDasTarefas';

const tarefa = (id: string, situacao: TarefaDoDia['situacao'], pessoa: TarefaDoDia['pessoa'], lista = { id: 'l-esteira', nome: 'Esteira de clientes' }): TarefaDoDia => ({
  id, titulo: `Tarefa ${id}`, area: { id: 'a1', nome: 'Comercial', cor: '#000' }, cliente: null, pessoa, pessoas: pessoa ? [pessoa] : [],
  responsavelTexto: null, prazo: situacao === 'atrasada' ? '2026-10-10' : null, situacao,
  status: { nome: 'A fazer', cor: '#888', tipo: 'aberta' }, lista, externalUrl: null, descricao: null, recorrencia: null, ordem: 0, updatedAt: '2026-10-19T12:00:00Z',
});

const lucas = { id: 'p-lucas', nome: 'Lucas Fernandes' };
const PAINEL: PainelDeTarefas = {
  hoje: '2026-10-19',
  areas: [{ id: 'a1', nome: 'Comercial', cor: '#000', ordem: 0 }],
  pessoas: [lucas, { id: 'p-pedro', nome: 'Pedro Magnago' }, { id: 'p-rodrigo', nome: 'Rodrigo Saggioro' }],
  clientes: [],
  resumo: [],
  tarefas: [
    tarefa('1', 'atrasada', lucas),
    tarefa('2', 'atrasada', lucas, { id: 'l-onb', nome: 'Onboarding de cliente' }),
    tarefa('3', 'sem_prazo', null, { id: 'l-adm', nome: 'Rotinas' }),
    tarefa('4', 'hoje', null, { id: 'l-solta', nome: 'Avulsa' }),
  ],
};

const lista = (id: string, name: string) => ({ id, name, order: 0, externalId: null, total: 0, spaceId: null, statuses: [], fields: [] });
const ESTRUTURA: TrabEstrutura = {
  espacos: [],
  folders: [
    { id: 'f-clientes', name: 'Clientes', order: 0, lists: [lista('l-esteira', 'Esteira de clientes')], spaceId: null, parentId: null, externalId: null },
    // Subpasta: soma na pasta de cima.
    { id: 'f-sub', name: 'Implantação', order: 1, lists: [lista('l-onb', 'Onboarding de cliente')], spaceId: null, parentId: 'f-clientes', externalId: null },
    { id: 'f-adm', name: 'Administrativa', order: 2, lists: [lista('l-adm', 'Rotinas')], spaceId: null, parentId: null, externalId: null },
  ],
  listasSoltas: [lista('l-solta', 'Avulsa')],
  camposGlobais: [],
  tags: [],
  responsaveis: [],
  agentes: [],
};

describe('Dia a dia › Visão geral: o dash das tarefas por pasta e lista', () => {
  const location = window.location;
  beforeEach(() => {
    PERMISSOES = ['dashboard.ver', 'tarefas.ver'];
    apiGet.mockReset();
    apiGet.mockImplementation(async (rota: string) => {
      if (rota === '/trabalho/todas') return PAINEL;
      if (rota === '/trabalho/estrutura') return ESTRUTURA;
      throw new Error(`Rota sem fixture: ${rota}`);
    });
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '' } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: location });
  });

  it('o número de atrasadas leva a Todas no Trabalho, filtrada por atrasadas', async () => {
    render(<VisaoGeralPage />);
    const numero = await screen.findByRole('button', { name: /^Atrasadas\s*2/ });
    fireEvent.click(numero);
    expect(window.location.href).toBe('/trabalho?pasta=todas&visao=lista&overdue=1&concluidas=ocultar');
  });

  it('as colunas de responsável são as pessoas da equipe, com Pedro e Rodrigo mesmo zerados', async () => {
    render(<VisaoGeralPage />);
    await screen.findByText('Tarefas por responsável');
    for (const nome of ['Lucas', 'Pedro', 'Rodrigo', 'Sem responsável']) {
      expect(screen.getAllByText(nome).length, nome).toBeGreaterThan(0);
    }
  });

  it('por pasta: a pasta de cima junta as subpastas, a lista solta é "Sem pasta"; nada por área', async () => {
    render(<VisaoGeralPage />);
    await screen.findByText('Tarefas por pasta');
    expect(screen.queryByText('Tarefas por área')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clientes: 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Administrativa: 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sem pasta: 1' }));
    expect(window.location.href).toBe('/trabalho?pasta=sem-pasta&visao=lista&concluidas=ocultar');
  });

  it('por lista: cada coluna abre a lista na pasta dela', async () => {
    render(<VisaoGeralPage />);
    await screen.findByText('Tarefas por lista');
    fireEvent.click(screen.getByRole('button', { name: 'Onboarding de cliente: 1' }));
    expect(window.location.href).toBe('/trabalho?pasta=f-clientes&lista=l-onb&visao=lista&concluidas=ocultar');
  });

  it('P1 (21/10): carga por prazo, por pasta e por lista sem rolagem lateral na caixa', async () => {
    render(<VisaoGeralPage />);
    for (const titulo of ['Carga por prazo', 'Tarefas por pasta', 'Tarefas por lista']) {
      const quadro = (await screen.findByText(titulo)).closest('section') as HTMLElement;
      expect(quadro.className, titulo).not.toContain('overflow-x-auto');
      expect(quadro.querySelector('[data-grafico-caixa]'), titulo).toBeTruthy();
    }
  });

  it('o endereço do Trabalho leva pessoa, sem responsável e prazo', () => {
    expect(urlDoTrabalho({ pessoa: 'p-lucas' })).toBe('/trabalho?pasta=todas&visao=lista&assigneeUserId=p-lucas&concluidas=ocultar');
    expect(urlDoTrabalho({ pessoa: 'sem' })).toBe('/trabalho?pasta=todas&visao=lista&semResponsavel=1&concluidas=ocultar');
    expect(urlDoTrabalho({ situacao: 'sem_prazo' })).toBe('/trabalho?pasta=todas&visao=lista&prazo=sem_prazo&concluidas=ocultar');
    expect(urlDoTrabalho({ situacao: 'feita' })).toBe('/trabalho?pasta=todas&visao=lista&prazo=feita');
  });

  it('sem tarefas.ver, sem dash', async () => {
    PERMISSOES = ['dashboard.ver'];
    render(<VisaoGeralPage />);
    expect(screen.getByText('Sem acesso às tarefas.')).toBeTruthy();
    expect(apiGet).not.toHaveBeenCalled();
  });
});

describe('Painel geral da empresa: a empresa numa linha por motor, sem repetir o dash', () => {
  beforeEach(() => {
    PERMISSOES = ['dashboard.ver', 'tarefas.ver'];
    apiGet.mockReset();
    apiGet.mockImplementation(async (rota: string) => {
      if (rota === '/trabalho/todas') return PAINEL;
      if (rota.startsWith('/painel/custo-ia') || rota.startsWith('/relatorios')) throw new Error('fora do teste');
      throw new Error(`Rota sem fixture: ${rota}`);
    });
  });

  it('mostra as tarefas resumidas com o caminho para a Visão geral, sem gráficos por pessoa', async () => {
    render(<PainelGeralDaEmpresa />);
    await screen.findByText('Abertas');
    expect(screen.getByRole('link', { name: 'Visão geral' }).getAttribute('href')).toBe('/dia-a-dia');
    expect(screen.queryByText('Tarefas por responsável')).toBeNull();
    // Sem leads.ver, o bloco do comercial não aparece nem é lido.
    expect(screen.queryByText('Comercial')).toBeNull();
    expect(apiGet.mock.calls.some(([c]) => c === '/comercial/painel')).toBe(false);
  });
});
