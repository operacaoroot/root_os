import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CaixaResposta, FilaDeDecisoes } from '@mktos/shared';

/*
 * ==========================================================================
 * PENDÊNCIAS › DECISÕES (rodada do trabalho T6, 19/10/2026)
 * ==========================================================================
 *
 *  1. A ABA só aparece para quem tem `leads.ver` com o módulo `leads` ligado;
 *     sem isso, nem a aba, nem o contador, nem a leitura da fila;
 *  2. O CONTADOR do topo publica o número da fila e leva à aba;
 *  3. OS BOTÕES são os da tela antiga: a mesma rota
 *     (`POST /comercial/decisoes/:id/responder`) com o mesmo corpo, provado
 *     clicando a mesma opção nas duas telas;
 *  4. AS SETAS andam pelas três abas;
 *  5. `/comercial` redireciona para o Funil vivo preservando a query.
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

let PERMISSOES: string[] = [];

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));

const redirect = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/caixa',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: (...a: unknown[]) => redirect(...a),
}));

// eslint-disable-next-line import/first
import CaixaPage from '@/app/caixa/page';
// eslint-disable-next-line import/first
import FilaAntiga from '@/app/comercial/decisoes/page';
// eslint-disable-next-line import/first
import ComercialPage from '@/app/comercial/page';
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

const FILA: FilaDeDecisoes = {
  resumo: { decisoes: 1, acoesAutomaticasHoje: 3, leadsVivos: 9, automacoesComErro: 0 },
  decisoes: [
    {
      id: 'd1', leadId: 'l1', leadNome: 'Construtora Alicerce', tipo: 'pedido_de_ajuste',
      titulo: 'Construtora Alicerce pediu 8% de desconto', contexto: 'Leu a proposta 3 vezes.',
      opcoes: [{ chave: 'desconto:8', rotulo: 'Aprovar 8%' }, { chave: 'manter', rotulo: 'Manter o preço', efeito: 'nada muda' }],
      padrao: 'manter', expiraEm: new Date(AGORA.getTime() + 4 * 3600_000).toISOString(), criadaEm: AGORA.toISOString(),
      estado: 'aberta', escolha: null, decididoPor: null, canal: null, propostoPor: 'outra-pessoa',
    },
  ],
  rodouSozinhoHoje: [],
};

const VAZIA = { estado: 'ok', itens: [], proximo: null, identidades: ['Pedro'], limpoAte: null, incluirLimpos: false, incluirMeus: false, tarefasTruncadas: false, agora: AGORA.toISOString() };
const TAREFAS = { estado: 'ok', itens: [], truncado: false, teto: 200, identidades: ['Pedro'], listas: [], status: [], filtros: { responsavel: 'eu', encerradas: false }, agora: AGORA.toISOString() };

let MODULOS: string[] = ['trabalho', 'leads'];
let fila: FilaDeDecisoes;

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  redirect.mockReset();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/caixa');
  PERMISSOES = ['dashboard.ver', 'tarefas.ver', 'leads.ver', 'aprovacoes.decidir'];
  MODULOS = ['trabalho', 'leads'];
  fila = FILA;
  apiGet.mockImplementation((caminho: string) => {
    if (caminho === '/caixa') return Promise.resolve(CAIXA);
    if (caminho.startsWith('/caixa/atividade')) return Promise.resolve(VAZIA);
    if (caminho.startsWith('/caixa/tarefas')) return Promise.resolve(TAREFAS);
    if (caminho === '/comercial/fila') return Promise.resolve(fila);
    if (caminho === '/tenants/modulos') return Promise.resolve({ modulos: MODULOS, catalogo: ['trabalho', 'leads'] });
    return Promise.reject(new Error(`rota inesperada ${caminho}`));
  });
  apiPost.mockResolvedValue({ ok: true });
});

function renderCaixa() {
  return render(
    <ModulosProvider>
      <CaixaPage />
    </ModulosProvider>,
  );
}

const leuAFila = () => apiGet.mock.calls.some(([c]) => c === '/comercial/fila');

describe('T6: a aba Decisões em Pendências', () => {
  it('com leads.ver: a aba aparece, o contador mostra a fila e leva à aba', async () => {
    renderCaixa();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Atividade', 'Minhas tarefas', 'Decisões']);
    const contador = await screen.findByTestId('caixa-decisoes');
    await waitFor(() => expect(within(contador).getByText('1')).toBeTruthy());
    expect(contador.textContent).toContain('Decisões do comercial');
    fireEvent.click(within(contador).getByRole('button', { name: 'abrir Decisões' }));
    expect(screen.getByTestId('caixa-aba-decisoes').getAttribute('aria-selected')).toBe('true');
    expect(window.location.search).toBe('?aba=decisoes');
    expect(await screen.findByText('Construtora Alicerce pediu 8% de desconto')).toBeTruthy();
    // O padrão escrito e o que acontece se ninguém responder vêm do mesmo cartão.
    expect(screen.getByText(/Se ninguém responder até/).textContent).toContain('Manter o preço');
  });

  it('sem leads.ver: sem aba, sem contador e sem ler a fila; ?aba=decisoes cai na Atividade', async () => {
    PERMISSOES = ['dashboard.ver', 'tarefas.ver', 'aprovacoes.decidir'];
    window.history.replaceState(null, '', '/caixa?aba=decisoes');
    renderCaixa();
    await waitFor(() => expect(screen.getByTestId('caixa-aprovacoes')).toBeTruthy());
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Atividade', 'Minhas tarefas']);
    expect(screen.getByTestId('caixa-aba-atividade').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('caixa-decisoes')).toBeNull();
    expect(leuAFila()).toBe(false);
  });

  it('com o módulo leads desligado a aba some, mesmo com leads.ver', async () => {
    MODULOS = ['trabalho'];
    renderCaixa();
    await waitFor(() => expect(screen.queryByTestId('caixa-aba-decisoes')).toBeNull());
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    await waitFor(() => expect(screen.queryByTestId('caixa-decisoes')).toBeNull());
  });

  it('?aba=decisoes abre direto, e as setas andam pelas três abas', async () => {
    window.history.replaceState(null, '', '/caixa?aba=decisoes');
    renderCaixa();
    await waitFor(() => expect(screen.getByTestId('caixa-aba-decisoes').getAttribute('aria-selected')).toBe('true'));
    fireEvent.keyDown(screen.getByTestId('caixa-aba-decisoes'), { key: 'ArrowRight' });
    expect(screen.getByTestId('caixa-aba-atividade').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByTestId('caixa-aba-atividade'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('caixa-aba-decisoes').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByTestId('caixa-aba-decisoes'), { key: 'Home' });
    expect(screen.getByTestId('caixa-aba-atividade').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByTestId('caixa-aba-atividade'), { key: 'End' });
    expect(screen.getByTestId('caixa-aba-decisoes').getAttribute('aria-selected')).toBe('true');
  });

  it('o botão de um toque chama a MESMA rota da tela antiga, com o mesmo corpo, e a fila relê', async () => {
    window.history.replaceState(null, '', '/caixa?aba=decisoes');
    const { unmount } = renderCaixa();
    fireEvent.click(await screen.findByRole('button', { name: /Manter o preço/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const naCaixa = apiPost.mock.calls[0];
    expect(naCaixa).toEqual(['/comercial/decisoes/d1/responder', { escolha: 'manter' }, 'tok']);
    // Respondida, a fila relê e o aviso diz o que aconteceu.
    fila = { ...FILA, resumo: { ...FILA.resumo, decisoes: 0 }, decisoes: [] };
    await waitFor(() => expect(screen.getByTestId('caixa-decisoes-aviso').textContent).toMatch(/^Respondido: Manter o preço\./));
    await waitFor(() => expect(screen.getByText(/Nenhuma decisão do comercial esperando agora/)).toBeTruthy());
    await waitFor(() => expect(within(screen.getByTestId('caixa-decisoes')).getByText('0')).toBeTruthy());
    unmount();

    fila = FILA;
    apiPost.mockClear();
    render(<FilaAntiga />);
    fireEvent.click(await screen.findByRole('button', { name: /Manter o preço/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost.mock.calls[0]).toEqual(naCaixa);
  });

  it('a regra do cartão vale aqui: sem aprovacoes.decidir não há botão', async () => {
    PERMISSOES = ['dashboard.ver', 'tarefas.ver', 'leads.ver'];
    window.history.replaceState(null, '', '/caixa?aba=decisoes');
    renderCaixa();
    expect(await screen.findByText(/pede a permissão de decidir aprovações/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Manter o preço/ })).toBeNull();
  });
});

describe('T6: /comercial redireciona para o Funil vivo', () => {
  it('preserva a query, e sem query vai ao funil limpo', async () => {
    await ComercialPage({ searchParams: Promise.resolve({ lead: 'l1', aba: 'decisoes' }) });
    expect(redirect).toHaveBeenCalledWith('/comercial/funil?lead=l1&aba=decisoes');
    redirect.mockReset();
    await ComercialPage({ searchParams: Promise.resolve({ filtro: ['P1', 'P2'] }) });
    expect(redirect).toHaveBeenCalledWith('/comercial/funil?filtro=P1&filtro=P2');
    redirect.mockReset();
    await ComercialPage({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith('/comercial/funil');
  });
});
