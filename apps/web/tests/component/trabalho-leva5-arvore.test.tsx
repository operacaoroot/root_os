import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRAB_ARQUIVO_DO_CLICKUP, TRAB_PASTA_DO_COMERCIAL_NA_ARVORE } from '@mktos/shared';

/*
 * A ÁRVORE DO TRABALHO NA LEVA 5 (27/10/2026), lanes L1 e L3.
 *
 *  1. L3 · a pasta Clientes (que a API manda em `pastasDoComercial`) volta à árvore, no
 *     fim, RECOLHIDA por padrão e com o selo "Comercial"; abrir mostra a lista Onboarding
 *     de cliente, que se abre pelo clique; a lista não é arrastável e o "⋯" diz por quê;
 *     o que a árvore lembra de aberto fica neste navegador;
 *  2. L1 · a pasta "Arquivo do ClickUp" (marcada) vem recolhida por padrão, com a frase no
 *     título; as listas dela não dão coluna em "Todas" (os status herdados não aparecem).
 *  3. L3 · a Clientes não entra nos segmentos de "Todas" nem no seletor de pasta do topo.
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn();
let permissions = ['tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: vi.fn(), apiBlob: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u', roles: ['analista'] }, can: (p: string) => permissions.includes(p) }) }));
import TrabalhoPage from '@/app/trabalho/page';

const status = (id: string, name: string, type = 'open') => ({ id, name, type, color: '#87909e', order: 0, total: 1, limite: null });
const lista = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, externalId: null, spaceId: null, order: 0, total: 1, statuses: [status(`st-${id}`, 'A fazer'), status(`fim-${id}`, 'Concluída', 'closed')], fields: [], natureza: 'tarefas' as const, ...extra });
const MKT = '0a0a0a0a-0000-4000-8000-000000000001';
const ARQ = '0a0a0a0a-0000-4000-8000-000000000002';
const CLI = '0a0a0a0a-0000-4000-8000-000000000003';
const L_MKT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const L_TEMAS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const L_ONB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const estrutura = {
  espacos: [],
  folders: [
    { id: MKT, name: 'Marketing', order: 0, spaceId: null, parentId: null, externalId: null, lists: [lista(L_MKT, 'Demandas gerais')] },
    {
      id: ARQ, name: 'Arquivo do ClickUp', order: 0, spaceId: null, parentId: MKT, externalId: null, arquivoDoClickUp: true,
      lists: [lista(L_TEMAS, 'Gestão de Temas', { externalId: '901327640001', arquivoDoClickUp: true, statuses: [status('st-ins', 'insights'), status('st-val', 'validar ideia'), status('st-ok', 'complete', 'closed')] })],
    },
  ],
  listasSoltas: [],
  pastasDoComercial: [
    { id: CLI, name: 'Clientes', order: 9, spaceId: null, parentId: null, externalId: null, lists: [lista(L_ONB, 'Onboarding de cliente', { statuses: [status('st-fech', 'Fechado no comercial'), status('st-kick', 'Kickoff marcado'), status('st-enc', 'Encerrado', 'closed')] })] },
  ],
  camposGlobais: [], tags: [], responsaveis: [], agentes: [], pessoas: [],
};
const TAREFA = '11111111-1111-4111-8111-111111111111';
const tarefa = (id: string, listId: string, title: string) => ({
  id, listId, title, statusId: `st-${listId}`, statusName: 'A fazer', statusType: 'open', statusColor: '#87909e', priority: 'normal',
  assignee: null, dueDate: null, startDate: null, overdue: false, archived: false, agenteId: null, agenteNome: null, agenteSlug: null,
  agenteEm: null, statusDesde: null, minutos: 0, parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, order: 0, tags: [], values: [],
});

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/trabalho');
  permissions = ['tarefas.ver', 'tarefas.editar'];
  get.mockReset(); post.mockReset(); patch.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota === '/trabalho/estrutura') return Promise.resolve(estrutura);
    if (rota.startsWith('/trabalho/tarefas?')) return Promise.resolve({ items: [tarefa(TAREFA, L_MKT, 'Postar carrossel')], total: 1 });
    if (rota.startsWith('/trabalho/vistas')) return Promise.resolve([]);
    if (rota === '/trabalho/arquivadas') return Promise.resolve({ listas: [], pastas: [] });
    if (rota.startsWith('/tenants/onboarding/trilhos')) return Promise.resolve([]);
    if (rota === '/organograma/equipe') return Promise.resolve({ pessoas: [] });
    return Promise.resolve(null);
  });
});
afterEach(cleanup);

describe('L3: a pasta Clientes de volta à árvore, recolhida', () => {
  it('aparece no fim, recolhida, com o selo; abrir mostra a lista Onboarding; a escolha fica lembrada', async () => {
    render(<TrabalhoPage />);
    const no = await screen.findByTestId(`trabalho-arvore-no-${CLI}`);
    expect(no).toHaveAttribute('data-pasta-do-comercial');
    expect(within(no).getByTestId(`trabalho-arvore-selo-comercial-${CLI}`)).toHaveTextContent('Comercial');
    const seta = within(no).getByTestId(`trabalho-arvore-recolher-${CLI}`);
    expect(seta).toHaveAttribute('aria-expanded', 'false');
    expect(within(no).queryByTestId(`trabalho-arvore-lista-${L_ONB}`)).toBeNull();
    // A Clientes vem depois das pastas do Trabalho.
    const nos = screen.getAllByTestId(/^trabalho-arvore-no-/).map((n) => n.getAttribute('data-testid'));
    expect(nos.indexOf(`trabalho-arvore-no-${CLI}`)).toBeGreaterThan(nos.indexOf(`trabalho-arvore-no-${MKT}`));
    fireEvent.click(seta);
    const onb = await within(no).findByTestId(`trabalho-arvore-lista-${L_ONB}`);
    expect(seta).toHaveAttribute('aria-expanded', 'true');
    expect(onb).toHaveAttribute('draggable', 'false');
    expect(onb.closest('[data-lista-da-pasta-do-comercial]')).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem('trabalho-arvore-abertas') ?? '[]')).toEqual([CLI]);
    // A pasta Clientes não se arrasta nem entra na ordem; o título diz por quê.
    expect(within(no).getByTestId(`trabalho-arvore-pasta-${CLI}`)).toHaveAttribute('draggable', 'false');
    expect(within(no).getByTestId(`trabalho-arvore-pasta-${CLI}`)).toHaveAttribute('title', TRAB_PASTA_DO_COMERCIAL_NA_ARVORE);
    expect(within(no).queryByTestId(`trabalho-arvore-entre-${CLI}`)).toBeNull();
    // Clicar na lista abre o quadro dela (o endereço leva `?lista=`).
    fireEvent.click(onb);
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('lista')).toBe(L_ONB));
  });

  it('a Clientes não vira chip de pasta no topo nem segmento de Todas', async () => {
    render(<TrabalhoPage />);
    await screen.findByTestId(`trabalho-arvore-no-${CLI}`);
    expect(screen.queryByTestId(`trabalho-pasta-${CLI}`)).toBeNull();
    expect(screen.queryByTestId(`trabalho-segmento-${CLI}`)).toBeNull();
  });
});

describe('L1: o Arquivo do ClickUp na árvore e fora das colunas de Todas', () => {
  it('a pasta vem recolhida por padrão, com a frase, e abre no clique', async () => {
    render(<TrabalhoPage />);
    const no = await screen.findByTestId(`trabalho-arvore-no-${ARQ}`);
    expect(no).toHaveAttribute('data-pasta-do-arquivo-do-clickup');
    const seta = within(no).getByTestId(`trabalho-arvore-recolher-${ARQ}`);
    expect(seta).toHaveAttribute('aria-expanded', 'false');
    expect(within(no).getByTestId(`trabalho-arvore-pasta-${ARQ}`)).toHaveAttribute('title', TRAB_ARQUIVO_DO_CLICKUP);
    expect(within(no).queryByTestId(`trabalho-arvore-lista-${L_TEMAS}`)).toBeNull();
    fireEvent.click(seta);
    const temas = await within(no).findByTestId(`trabalho-arvore-lista-${L_TEMAS}`);
    expect(temas.closest('[data-lista-do-arquivo-do-clickup]')).not.toBeNull();
    // A pasta Marketing (sem marca) continua aberta por padrão.
    expect(screen.getByTestId(`trabalho-arvore-recolher-${MKT}`)).toHaveAttribute('aria-expanded', 'true');
  });

  it('em Todas, os status das listas do Arquivo não viram coluna', async () => {
    window.history.replaceState({}, '', '/trabalho?pasta=todas');
    render(<TrabalhoPage />);
    await screen.findByText('Postar carrossel');
    const colunas = await screen.findAllByTestId(/^trabalho-coluna-|^quadro-coluna-|^coluna-/).catch(() => [] as HTMLElement[]);
    const nomes = (colunas.length ? colunas : Array.from(document.querySelectorAll('[data-status-id]')) as HTMLElement[]).map((c) => c.textContent ?? '');
    const texto = document.body.textContent ?? '';
    expect(texto).toContain('A fazer');
    for (const herdado of ['insights', 'validar ideia', 'complete']) expect(texto, herdado).not.toContain(herdado);
    expect(nomes.join(' ')).not.toContain('insights');
  });
});
