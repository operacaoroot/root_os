import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FinanceiroPage from '@/app/financeiro/page';
import LayoutFinanceiro from '@/app/financeiro/layout';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const a = {
  id: 'recebivel-a', clienteId: A, descricao: 'Recebível A', valor: '250.00', status: 'previsto',
  data: '2026-11-04T00:00:00Z', vencimento: '2026-11-10T00:00:00Z', recebidoEm: null,
};
const b = { ...a, id: 'recebivel-b', clienteId: B, descricao: 'Recebível B', valor: '175.00' };
const acordoA = {
  id: 'acordo-a', clienteId: A, produto: 'Acordo A', valor: '250.00', tipo: 'pagante', fechadoEm: null,
  parcelas: [{ id: 'parcela-a', numero: 1, valor: '250.00', vencimento: '2026-11-12T00:00:00Z', pagaEm: null }],
};
const paginaA = { items: [a], total: 1, page: 1, limit: 30, periodo: null, estados: [
  { status: 'previsto', quantidade: 1, valor: '250.00' },
  { status: 'realizado', quantidade: 0, valor: '0.00' },
  { status: 'conciliado', quantidade: 0, valor: '0.00' },
] };
const clientes = [{ id: A, nome: 'Cliente A', interno: false }, { id: B, nome: 'Cliente B', interno: false }];
const rota = '/api/finance/carteira';
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
let conta: { token: string; user: { id: string } };
let podeLer: boolean;
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ ...conta, ready: true, can: (p: string) => p !== 'financeiro.ver' || podeLer }) }));

function pendente() {
  let resolver!: (r: Response) => void;
  const promessa = new Promise<Response>((resolve) => { resolver = resolve; });
  return { promessa, resolver };
}

function servir({
  escopo = () => Promise.resolve(json({ amplo: false, clientes })),
  detalhe = () => Promise.resolve(json(a)),
  acordo = () => Promise.resolve(json(acordoA)),
  listaA = () => Promise.resolve(json(paginaA)),
} = {}) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url, 'http://localhost');
    const clienteId = searchParams.get('clienteId');
    if (pathname === '/api/clientes-escopo/me') return escopo();
    if (pathname === `${rota}/recebiveis`) {
      if (clienteId === A) return listaA();
      if (clienteId === B) return json({ items: [b], total: 1, page: 1, limit: 30 });
    }
    if (pathname === `${rota}/recebiveis/${a.id}` && clienteId === A) return detalhe();
    if (pathname === `${rota}/acordos` && clienteId === A) return json({ items: [acordoA], total: 1, page: 1, limit: 30 });
    if (pathname === `${rota}/acordos/${acordoA.id}` && clienteId === A) return acordo();
    return new Response(null, { status: 403 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const pagina = () => <LayoutFinanceiro><FinanceiroPage /></LayoutFinanceiro>;

beforeEach(() => {
  conta = { token: 'sessao-1', user: { id: 'pessoa-1' } };
  podeLer = true;
  window.history.replaceState({}, '', '/financeiro');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('lê somente recebíveis do cliente selecionado, sem saldo, extrato ou contas bancárias', async () => {
  window.history.replaceState({}, '', '/financeiro?clienteId=sem');
  const fetch = servir();
  render(pagina());
  expect(await screen.findByRole('combobox', { name: 'Cliente do Financeiro' })).toHaveValue(A);
  expect(await screen.findByRole('button', { name: 'Recebível A' })).toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/clientes-escopo/me',
    `${rota}/recebiveis?clienteId=${A}&page=1&limit=30`,
  ]);
  expect(screen.queryByText(/saldo bancário|conciliar|conectar banco/i)).not.toBeInTheDocument();
});

it('consulta acordos e abre o detalhe sem oferecer baixar parcela ou criar lançamento', async () => {
  const fetch = servir();
  render(pagina());
  fireEvent.click(await screen.findByRole('button', { name: 'Acordos' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Acordo A' }));
  expect(await screen.findByRole('heading', { name: 'Acordo A' })).toBeInTheDocument();
  expect(screen.getByText('Parcela 1')).toBeInTheDocument();
  expect(screen.getByText('12/11/2026')).toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/acordos'))).toEqual([
    `${rota}/acordos?clienteId=${A}&page=1&limit=30`,
    `${rota}/acordos/acordo-a?clienteId=${A}`,
  ]);
  expect(screen.queryByRole('button', { name: /baixar parcela|novo lançamento|editar/i })).not.toBeInTheDocument();
});

it('avisa quando o detalhe do acordo omite parcelas com vínculo inconsistente', async () => {
  servir({ acordo: async () => json({ ...acordoA, parcelas: [], parcelasIncompletas: true }) });
  render(pagina());
  fireEvent.click(await screen.findByRole('button', { name: 'Acordos' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Acordo A' }));
  expect(await screen.findByText('Há parcelas fora da consulta por inconsistência no vínculo de recebimento.')).toBeInTheDocument();
  expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
});

it('mostra a soma bruta por situação no recorte inteiro da busca, com centavos exatos', async () => {
  const fetch = servir({ listaA: async () => json({
    ...paginaA,
    estados: [{ status: 'previsto', quantidade: 45, valor: '90071992547409.93' }],
    total: 45,
  }) });
  render(pagina());
  await screen.findByRole('button', { name: 'Recebível A' });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar recebíveis' }), { target: { value: 'novembro' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  expect(await screen.findByText('R$ 90.071.992.547.409,93')).toBeInTheDocument();
  expect(screen.getByText('45 títulos')).toBeInTheDocument();
  expect(screen.getByText(/todos os períodos.*novembro/i)).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => url.endsWith('q=novembro'))).toBe(true);
});

it('trocar de cliente cancela o detalhe e ignora a resposta que chega depois', async () => {
  const detalhe = pendente();
  const fetch = servir({ detalhe: () => detalhe.promessa });
  render(pagina());
  fireEvent.click(await screen.findByRole('button', { name: 'Recebível A' }));
  await screen.findByText('Carregando detalhe…');
  fireEvent.change(screen.getByRole('combobox', { name: 'Cliente do Financeiro' }), { target: { value: B } });
  await screen.findByRole('button', { name: 'Recebível B' });
  expect(fetch.mock.calls.find(([url]) => url.includes('/recebiveis/recebivel-a?'))?.[1]?.signal?.aborted).toBe(true);
  await act(async () => detalhe.resolver(json({ ...a, descricao: 'Dado financeiro do cliente anterior' })));
  expect(screen.queryByText('Dado financeiro do cliente anterior')).not.toBeInTheDocument();
});

it('desmonta os dados financeiros na troca de conta com o mesmo token', async () => {
  const segunda = pendente();
  let leituras = 0;
  servir({ escopo: () => ++leituras === 1 ? Promise.resolve(json({ amplo: false, clientes })) : segunda.promessa });
  const view = render(pagina());
  await screen.findByRole('button', { name: 'Recebível A' });
  conta = { ...conta, user: { id: 'pessoa-2' } };
  view.rerender(pagina());
  expect(screen.queryByText('Recebível A')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Cliente do Financeiro' })).not.toBeInTheDocument();
  await act(async () => segunda.resolver(json({ amplo: false, clientes: [clientes[1]] })));
  expect(await screen.findByRole('button', { name: 'Recebível B' })).toBeInTheDocument();
});

it('descarta a lista e os seus totais se a resposta trouxer outro cliente', async () => {
  servir({ listaA: async () => json({ items: [a, b], total: 900, page: 1, limit: 30 }) });
  render(pagina());
  expect(await screen.findByRole('alert')).toHaveTextContent('A lista recebida não corresponde ao cliente selecionado.');
  expect(screen.queryByText('Recebível B')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Próxima' })).not.toBeInTheDocument();
});

it('sem permissão de leitura, não consulta dados financeiros', async () => {
  podeLer = false;
  const fetch = servir();
  render(pagina());
  expect(await screen.findByText('Seu acesso atual não permite abrir o Financeiro.')).toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/clientes-escopo/me']);
});

it('mantém os filhos originais para ALL', async () => {
  const fetch = servir({ escopo: async () => json({ amplo: true, clientes }) });
  render(<LayoutFinanceiro><p>Conteúdo amplo do Financeiro</p></LayoutFinanceiro>);
  expect(await screen.findByText('Conteúdo amplo do Financeiro')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Cliente do Financeiro' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/clientes-escopo/me']);
});
