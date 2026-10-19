import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/*
 * O QUADRO DENSO NA TELA (rodada da implantação I2, 18/10/2026).
 *
 *  1. o compacto mostra nome, dias (magenta acima de 5), próxima ação e o
 *     rodapé com a última movimentação ou comentário, lidos da rota do quadro;
 *  2. o título é o alvo esticado: clicar em qualquer ponto do cartão abre o painel;
 *  3. focar o cartão mostra o balão com os três últimos passos e o último
 *     comentário, ligado por aria-describedby; Esc fecha;
 *  4. o seletor de densidade grava no localStorage e o médio mostra o selo de
 *     procedência com link para o lead;
 *  5. "meus" filtra pelo nome da sessão.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const apiBlob = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
    apiBlob: (...a: unknown[]) => apiBlob(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Rodrigo', email: 'r@x.com', roles: [], permissions: ['tarefas.ver', 'tarefas.editar'] },
    can: (p: string) => ['tarefas.ver', 'tarefas.editar'].includes(p),
  }),
}));

// eslint-disable-next-line import/first
import TrabalhoPage from '@/app/trabalho/page';

/* --------------------------------------------------------------- fixtures -- */

const PASTA = { id: 'f-1', name: 'Comercial', order: 0, lists: [] as unknown[] };

const ESTEIRA = {
  id: 'l-esteira',
  name: 'Esteira de clientes',
  order: 0,
  externalId: null,
  total: 4,
  statuses: [
    { id: 's-diag', name: 'Diagnóstico', type: 'custom', color: '#4194f6', order: 0, total: 1, limite: null },
    { id: 's-impl', name: 'Implantação', type: 'custom', color: '#ff7800', order: 1, total: 3, limite: 2 },
    { id: 's-onb', name: 'Onboarding', type: 'custom', color: '#f9d900', order: 2, total: 0, limite: 3 },
    { id: 's-fim', name: 'Encerrado', type: 'closed', color: '#6b7280', order: 3, total: 1, limite: null },
  ],
  fields: [],
};

function tarefa(over: Record<string, unknown> = {}) {
  return {
    id: 't-1', listId: 'l-esteira', title: 'ProMedical',
    statusId: 's-impl', statusName: 'Implantação', statusType: 'custom', statusColor: '#ff7800',
    priority: 'normal', assignee: 'Rodrigo',
    agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null,
    statusDesde: null, minutos: 0,
    dueDate: null, startDate: null, overdue: false,
    parentId: null, subtasks: 0, comments: 0,
    externalId: null, externalUrl: null, archived: false, order: 0,
    tags: [], values: [],
    ...over,
  };
}

const ITENS = [
  tarefa({ id: 't-alicerce', title: 'Construtora Alicerce', assignee: 'Rodrigo', statusDesde: new Date(Date.now() - 7 * 86_400_000).toISOString() }),
  tarefa({ id: 't-lume', title: 'Studio Lume', assignee: 'Marina', statusDesde: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
];

const MOVIMENTO = {
  itens: [
    {
      tarefaId: 't-alicerce',
      ultimo: { tipo: 'comentario', quem: 'Marina', frase: '“mandei os acessos”', em: new Date(Date.now() - 86_400_000).toISOString() },
      passos: [
        { tipo: 'status', quem: 'Pedro', frase: 'moveu para Implantação', em: new Date(Date.now() - 2 * 3_600_000 - 86_400_000).toISOString() },
        { tipo: 'criacao', quem: 'Fechamento comercial', frase: 'abriu o card', em: new Date(Date.now() - 7 * 86_400_000).toISOString() },
      ],
      ultimoComentario: { tipo: 'comentario', quem: 'Marina', frase: '“mandei os acessos”', em: new Date(Date.now() - 86_400_000).toISOString() },
      proximaAcao: { texto: 'marcar o kickoff com o cliente', dono: null, quando: null, fonte: 'implantacao' },
      procedencia: { tipo: 'fechamento', leadId: 'lead-1', rotulo: 'criado pelo fechamento · 11/10/2026' },
    },
  ],
};

function servir() {
  apiGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/estrutura')) {
      return Promise.resolve({ folders: [PASTA], listasSoltas: [ESTEIRA], camposGlobais: [], tags: [], responsaveis: ['Rodrigo'], agentes: [] });
    }
    if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve(MOVIMENTO);
    if (rota.startsWith('/trabalho/tarefas?')) {
      return Promise.resolve({ items: ITENS, total: ITENS.length, source: { tool: 'trabalho-interno', generatedAt: '2026-10-18T12:00:00.000Z' } });
    }
    if (rota.startsWith('/tenants/onboarding/trilhos')) return Promise.resolve([]);
    const id = rota.slice('/trabalho/tarefas/'.length);
    const achada = ITENS.find((t) => t.id === id) ?? ITENS[0];
    return Promise.resolve({
      ...achada, description: null, listName: ESTEIRA.name,
      createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-17T10:00:00.000Z',
      comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [],
    });
  });
}

beforeEach(() => {
  window.localStorage.removeItem('root-os:trabalho:densidade');
  window.history.replaceState({}, '', '/trabalho');
  vi.clearAllMocks();
  servir();
});

describe('quadro denso na tela', () => {
  it('o compacto traz dias, próxima ação e o rodapé da última movimentação', async () => {
    render(<TrabalhoPage />);
    const rodape = await screen.findByTestId('trabalho-rodape-t-alicerce');
    expect(rodape.textContent).toBe('Marina · “mandei os acessos” · há 1d');
    const cartao = rodape.closest('[data-work-task-id]') as HTMLElement;
    expect(cartao.getAttribute('data-densidade')).toBe('compacto');
    expect(within(cartao).getByText('marcar o kickoff com o cliente')).toBeTruthy();
    const dias = cartao.querySelector('[data-idade-dias]') as HTMLElement;
    expect(dias.getAttribute('data-idade-dias')).toBe('7');
    expect(dias.className).toContain('text-mag');
    const lume = screen.getByTestId('trabalho-rodape-t-lume');
    expect(lume.textContent).toBe('sem movimento registrado');
    expect((lume.closest('[data-work-task-id]') as HTMLElement).querySelector('[data-idade-dias]')!.className).not.toContain('text-mag');
  });

  it('o clique em qualquer ponto do cartão abre o painel (o título é o alvo esticado)', async () => {
    render(<TrabalhoPage />);
    const abrir = await screen.findByRole('button', { name: 'Construtora Alicerce' });
    expect(abrir.className).toContain('after:absolute');
    expect(abrir.className).toContain('after:inset-0');
    fireEvent.click(abrir);
    expect(await screen.findByRole('dialog', { name: 'Detalhes da tarefa' })).toBeTruthy();
  });

  it('focar mostra o balão com os passos e o último comentário; Esc fecha', async () => {
    render(<TrabalhoPage />);
    const abrir = await screen.findByRole('button', { name: 'Construtora Alicerce' });
    fireEvent.focus(abrir);
    const balao = await screen.findByTestId('trabalho-balao');
    expect(balao.getAttribute('role')).toBe('tooltip');
    await waitFor(() => expect(abrir.getAttribute('aria-describedby')).toBe(balao.id));
    const texto = (balao.textContent ?? '').replace(/\s+/g, ' ');
    expect(texto).toContain('Pedro · moveu para Implantação');
    expect(texto).toContain('Fechamento comercial · abriu o card');
    expect(texto).toContain('Marina · “mandei os acessos”');
    expect(texto).toContain('clique abre o painel');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('trabalho-balao')).toBeNull());
  });

  it('a densidade grava no localStorage; o médio mostra o selo com link para o lead', async () => {
    render(<TrabalhoPage />);
    await screen.findByTestId('trabalho-rodape-t-alicerce');
    fireEvent.click(screen.getByTestId('trabalho-densidade-medio'));
    expect(window.localStorage.getItem('root-os:trabalho:densidade')).toBe('medio');
    const selo = await screen.findByTestId('trabalho-procedencia-t-alicerce');
    expect(selo.getAttribute('href')).toBe('/comercial/lead/lead-1');
    expect(selo.textContent).toBe('criado pelo fechamento · 11/10/2026');
    expect(screen.getByTestId('trabalho-quadro').getAttribute('data-densidade')).toBe('medio');
  });

  it('"meus" deixa só o que é da pessoa da sessão', async () => {
    render(<TrabalhoPage />);
    await screen.findByTestId('trabalho-rodape-t-lume');
    fireEvent.click(screen.getByTestId('trabalho-escopo-meus'));
    await waitFor(() => expect(screen.queryByTestId('trabalho-rodape-t-lume')).toBeNull());
    expect(screen.getByTestId('trabalho-rodape-t-alicerce')).toBeTruthy();
    expect(window.location.search).toContain('escopo=meus');
  });
});
