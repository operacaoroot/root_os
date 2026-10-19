import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PainelDeTarefas, TarefaDoDia } from '@mktos/shared';

/*
 * VISÃO GERAL DA EMPRESA (19/10/2026): o resumo das tarefas de todas as áreas.
 * Todo número leva à lista de Dia a dia › Tarefas já filtrada, e só a equipe
 * (não as contas do sistema) aparece como responsável.
 */

const apiGet = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a) };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['dashboard.ver', 'tarefas.ver'] },
    can: () => true,
  }),
}));

// eslint-disable-next-line import/first
import VisaoGeralPage from '@/app/painel/page';

const tarefa = (id: string, situacao: TarefaDoDia['situacao'], pessoa: TarefaDoDia['pessoa']): TarefaDoDia => ({
  id, titulo: `Tarefa ${id}`, area: { id: 'a1', nome: 'Comercial', cor: '#000' }, cliente: null, pessoa,
  responsavelTexto: null, prazo: situacao === 'atrasada' ? '2026-10-10' : null, situacao,
  status: { nome: 'A fazer', cor: '#888' }, lista: { id: 'l1', nome: 'Comercial' }, externalUrl: null, updatedAt: '2026-10-19T12:00:00Z',
});

const lucas = { id: 'p-lucas', nome: 'Lucas Fernandes' };
const PAINEL: PainelDeTarefas = {
  hoje: '2026-10-19',
  areas: [{ id: 'a1', nome: 'Comercial', cor: '#000', ordem: 0 }],
  pessoas: [lucas, { id: 'p-pedro', nome: 'Pedro Magnago' }, { id: 'p-rodrigo', nome: 'Rodrigo Saggioro' }],
  clientes: [],
  resumo: [],
  tarefas: [tarefa('1', 'atrasada', lucas), tarefa('2', 'atrasada', lucas), tarefa('3', 'sem_prazo', null)],
};

describe('Visão geral da empresa: o resumo das tarefas', () => {
  const location = window.location;
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (rota: string) => {
      if (rota === '/trabalho/todas') return PAINEL;
      throw new Error(`Rota sem fixture: ${rota}`);
    });
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '' } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: location });
  });

  it('o número de atrasadas leva à lista de tarefas filtrada por atrasadas', async () => {
    render(<VisaoGeralPage />);
    const numero = await screen.findByRole('button', { name: /^Atrasadas\s*2/ });
    fireEvent.click(numero);
    expect(window.location.href).toBe('/dia-a-dia?ver=lista&situacao=atrasada');
  });

  it('as colunas de responsável são as pessoas da equipe, com Pedro e Rodrigo mesmo zerados', async () => {
    render(<VisaoGeralPage />);
    await screen.findByText('Tarefas por responsável');
    for (const nome of ['Lucas', 'Pedro', 'Rodrigo', 'Sem responsável']) {
      expect(screen.getAllByText(nome).length, nome).toBeGreaterThan(0);
    }
  });
});
