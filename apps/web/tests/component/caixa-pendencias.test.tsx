import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CaixaResposta, PendenciaNaCaixa, PendenciasDaCaixa } from '@mktos/shared';

/*
 * AS PENDÊNCIAS DOS AGENTES NA CAIXA (rodada dos agentes, 21/10/2026).
 *
 *  1. A aba Decisões traz as pendências para TODA pessoa (sem `leads.ver` também),
 *     agrupadas por urgência e cliente, com a função de origem pelo nome do cadastro;
 *  2. a opção é UM TOQUE (`POST /pendencias/:id/responder` com a escolha), e
 *     "descartar" é `POST /pendencias/:id/descartar`;
 *  3. o CONTADOR é o total da mesma leitura, e cai quando a pessoa age.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a), apiPost: (...a: unknown[]) => apiPost(...a) };
});

let PERMISSOES: string[] = [];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/caixa',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
}));

// eslint-disable-next-line import/first
import CaixaPage from '@/app/caixa/page';
// eslint-disable-next-line import/first
import { ModulosProvider } from '@/components/modulos';

const AGORA = new Date();
const CAIXA: CaixaResposta = {
  agora: AGORA.toISOString(),
  eu: { id: 'u-eu', nome: 'Pedro', alcada: 'responsavel', decide: true, decideNestaSessao: true, ativo: true },
  aprovacoes: { estado: 'ok', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 },
  tarefas: { estado: 'ok', itens: [], truncado: false, teto: 50, identidades: ['Pedro'], diasSemMovimento: 7, horasPresa: 24 },
  conversa: { estado: 'ok', itens: [], truncado: false, dias: 7, teto: 20 },
  total: 0,
  totalParcial: false,
  source: { tool: 'caixa-pessoal', generatedAt: AGORA.toISOString() },
};
const VAZIA = { estado: 'ok', itens: [], proximo: null, identidades: ['Pedro'], limpoAte: null, incluirLimpos: false, incluirMeus: false, tarefasTruncadas: false, agora: AGORA.toISOString() };

function pendencia(id: string, over: Partial<PendenciaNaCaixa> = {}): PendenciaNaCaixa {
  return {
    id, funcao: 'TR-07', tipo: 'tarefa.cobranca', titulo: `Pendência ${id}`, contexto: 'Bom dia. 1 venceu.',
    opcoes: [{ chave: 'vou-tratar', rotulo: 'Vou tratar hoje' }, { chave: 'ja-tratei', rotulo: 'Já tratei' }],
    paraUsuarioId: 'u-eu', refTipo: 'cobranca', refId: '2026-10-21', estado: 'aberta', escolha: null, decididaPor: null, decididaEm: null,
    criadaEm: AGORA.toISOString(), funcaoNome: 'Cobrador de tarefas', urgencia: 'urgente', motivoDaUrgencia: 'há tarefa vencida',
    cliente: null, clienteDe: 'nenhum', ...over,
  };
}

let restantes: PendenciaNaCaixa[] = [];
const resposta = (): PendenciasDaCaixa => {
  const urgentes = restantes.filter((p) => p.urgencia === 'urgente');
  const depois = restantes.filter((p) => p.urgencia === 'depois');
  return {
    total: restantes.length,
    grupos: [
      ...(urgentes.length ? [{ cliente: null, urgencia: 'urgente' as const, itens: urgentes }] : []),
      ...(depois.length ? [{ cliente: 'Padaria Exemplo', urgencia: 'depois' as const, itens: depois }] : []),
    ],
    triagem: 'modelo',
    doCache: 0,
  };
};

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  window.history.replaceState(null, '', '/caixa?aba=decisoes');
  PERMISSOES = ['dashboard.ver', 'tarefas.ver'];
  restantes = [
    pendencia('p1'),
    pendencia('p2', { funcao: 'TR-05', funcaoNome: 'Arquivista do cliente', tipo: 'arquivo.classificar', titulo: 'Arquivo sem subpasta', urgencia: 'depois', motivoDaUrgencia: null, cliente: 'Padaria Exemplo', clienteDe: 'explicito', opcoes: [{ chave: '02-contrato', rotulo: '02-contrato' }] }),
  ];
  apiGet.mockImplementation((caminho: string) => {
    if (caminho === '/caixa') return Promise.resolve(CAIXA);
    if (caminho.startsWith('/caixa/atividade')) return Promise.resolve(VAZIA);
    if (caminho === '/caixa/pendencias') return Promise.resolve(resposta());
    if (caminho === '/tenants/modulos') return Promise.resolve({ modulos: ['trabalho'], catalogo: ['trabalho', 'leads'] });
    return Promise.reject(new Error(`rota inesperada ${caminho}`));
  });
  apiPost.mockImplementation((caminho: string) => {
    const id = /\/pendencias\/([^/]+)\//.exec(caminho)?.[1];
    restantes = restantes.filter((p) => p.id !== id);
    return Promise.resolve({ ok: true });
  });
});

const renderCaixa = () => render(<ModulosProvider><CaixaPage /></ModulosProvider>);

describe('as pendências dos agentes na aba Decisões', () => {
  it('sem leads.ver: a aba traz as pendências agrupadas, com a função pelo nome do cadastro', async () => {
    renderCaixa();
    const lista = await screen.findByTestId('caixa-pendencias');
    expect(lista).toHaveTextContent('Pendências dos agentes · 2');
    const grupos = screen.getAllByTestId('caixa-pendencias-grupo');
    expect(grupos.map((g) => g.querySelector('h3')?.textContent)).toEqual(['Urgente · sem cliente (1)', 'Depois · Padaria Exemplo (1)']);
    const p1 = screen.getByTestId('pendencia-p1');
    expect(p1).toHaveTextContent('TR-07 · Cobrador de tarefas');
    expect(p1).toHaveTextContent('há tarefa vencida');
    expect(within(p1).getByRole('button', { name: 'Vou tratar hoje' })).toBeTruthy();
    expect(apiGet.mock.calls.some(([c]) => c === '/comercial/fila')).toBe(false);
  });

  it('um toque responde pela rota das pendências e o contador cai; descartar também', async () => {
    renderCaixa();
    const contador = await screen.findByTestId('caixa-pendencias-contador');
    await waitFor(() => expect(within(contador).getByText('2')).toBeTruthy());
    fireEvent.click(await screen.findByTestId('pendencia-p1-opcao-vou-tratar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pendencias/p1/responder', { escolha: 'vou-tratar' }, 'tok'));
    await waitFor(() => expect(screen.queryByTestId('pendencia-p1')).toBeNull());
    await waitFor(() => expect(within(screen.getByTestId('caixa-pendencias-contador')).getByText('1')).toBeTruthy());
    expect(screen.getByTestId('caixa-pendencias-aviso')).toHaveTextContent('Respondido: Vou tratar hoje.');
    fireEvent.click(screen.getByTestId('pendencia-p2-descartar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pendencias/p2/descartar', {}, 'tok'));
    await waitFor(() => expect(screen.getByTestId('caixa-pendencias')).toHaveTextContent('Nenhuma pendência dos agentes esperando por você.'));
    await waitFor(() => expect(within(screen.getByTestId('caixa-pendencias-contador')).getByText('0')).toBeTruthy());
  });

  it('a API recusa: o erro aparece no cartão e ele continua lá', async () => {
    apiPost.mockRejectedValueOnce(new Error('Esta pendência já foi decidida.'));
    renderCaixa();
    fireEvent.click(await screen.findByTestId('pendencia-p1-opcao-ja-tratei'));
    expect(await within(screen.getByTestId('pendencia-p1')).findByRole('alert')).toHaveTextContent('Esta pendência já foi decidida.');
  });
});
