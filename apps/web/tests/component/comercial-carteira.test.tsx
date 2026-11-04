import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LayoutDoComercial from '@/app/comercial/layout';
import ComercialPage from '@/app/comercial/page';
import ListaDeLeadsPage from '@/app/leads/page';
import PropostasPage from '@/app/propostas/page';
import LayoutDeLeads from '@/app/leads/layout';
import LayoutDePropostas from '@/app/propostas/layout';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const leadA = { leadId: 'lead-a', clienteId: A, nome: 'Negócio A', empresa: 'Oficina A', etapa: 'sessao' };
const leadB = { ...leadA, leadId: 'lead-b', clienteId: B, nome: 'Negócio B', empresa: 'Oficina B' };
const contratoA = { id: 'contrato-a', leadId: leadA.leadId, clienteId: A, numero: 'ROOT-QA-A', estado: 'assinado', nome: 'Oficina A' };
const clientes = [{ id: A, nome: 'Carteira A', interno: false }, { id: B, nome: 'Carteira B', interno: false }];
const rota = '/api/comercial/carteira';
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
let conta: { token: string; user: { id: string } };
let podeLer: boolean;
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ ...conta, ready: true, can: (p: string) => p !== 'leads.ver' || podeLer }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function pendente() {
  let resolver!: (r: Response) => void;
  const promessa = new Promise<Response>((resolve) => { resolver = resolve; });
  return { promessa, resolver };
}

function servir({
  escopo = () => Promise.resolve(json({ amplo: false, clientes })),
  detalhe = () => Promise.resolve(json(leadA)),
} = {}) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url, 'http://localhost');
    const clienteId = searchParams.get('clienteId');
    if (pathname === '/api/clientes-escopo/me') return escopo();
    if (pathname === `${rota}/leads` && clienteId) {
      const page = Number(searchParams.get('page'));
      const limit = Number(searchParams.get('limit'));
      return json({ items: [clienteId === A ? leadA : leadB], total: 1, page, limit });
    }
    if (pathname === `${rota}/leads/${leadA.leadId}` && clienteId === A) return detalhe();
    if (pathname === `${rota}/contratos` && clienteId === A) {
      return json({ items: [contratoA], total: 1, page: 1, limit: 30 });
    }
    if (pathname === `${rota}/contratos/${contratoA.id}` && clienteId === A) return json(contratoA);
    return new Response(null, { status: 403 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const pagina = () => <LayoutDoComercial><ComercialPage /></LayoutDoComercial>;

beforeEach(() => {
  conta = { token: 'sessao-1', user: { id: 'pessoa-1' } };
  podeLer = true;
  window.history.replaceState({}, '', '/comercial');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('carrega a lista restrita do cliente permitido e mantém o painel organizacional desmontado', async () => {
  window.history.replaceState({}, '', '/comercial?lead=fora-da-carteira&clienteId=sem');
  const fetch = servir();
  render(pagina());
  const seletor = await screen.findByRole('combobox', { name: 'Cliente do Comercial' });
  expect(seletor).toHaveValue(A);
  expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual(['Carteira A', 'Carteira B']);
  expect(await screen.findByRole('button', { name: 'Negócio A' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar leads' }), { target: { value: 'sessão' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  await screen.findByRole('button', { name: 'Negócio A' });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/clientes-escopo/me',
    `${rota}/leads?clienteId=${A}&page=1&limit=30`,
    `${rota}/leads?clienteId=${A}&page=1&limit=30&q=sess%C3%A3o`,
  ]);
  expect(screen.queryByRole('button', { name: /novo lead|enviar contrato|emitir/i })).not.toBeInTheDocument();
});

it('abre contratos da carteira sem consultar quadro, documentos ou signatários', async () => {
  const fetch = servir();
  render(pagina());
  fireEvent.click(await screen.findByRole('button', { name: 'Contratos' }));
  fireEvent.click(await screen.findByRole('button', { name: 'ROOT-QA-A' }));
  expect(await screen.findByRole('heading', { name: 'ROOT-QA-A' })).toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/contratos'))).toEqual([
    `${rota}/contratos?clienteId=${A}&page=1&limit=30`,
    `${rota}/contratos/contrato-a?clienteId=${A}`,
  ]);
});

it('cancela o detalhe ao trocar de cliente e descarta a resposta atrasada', async () => {
  const detalhe = pendente();
  const fetch = servir({ detalhe: () => detalhe.promessa });
  render(pagina());
  fireEvent.click(await screen.findByRole('button', { name: 'Negócio A' }));
  await screen.findByText('Carregando detalhe…');
  fireEvent.change(screen.getByRole('combobox', { name: 'Cliente do Comercial' }), { target: { value: B } });
  await screen.findByRole('button', { name: 'Negócio B' });
  expect(fetch.mock.calls.find(([url]) => url.includes('/leads/lead-a?'))?.[1]?.signal?.aborted).toBe(true);
  await act(async () => detalhe.resolver(json({ ...leadA, nome: 'Detalhe antigo de A' })));
  expect(screen.queryByText('Detalhe antigo de A')).not.toBeInTheDocument();
  expect(screen.queryByText('Negócio A')).not.toBeInTheDocument();
});

it('descarta um detalhe que diverge do cliente consultado', async () => {
  servir({ detalhe: async () => json({ ...leadA, clienteId: B, nome: 'Dado de outro cliente' }) });
  render(pagina());
  fireEvent.click(await screen.findByRole('button', { name: 'Negócio A' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Registro indisponível para este cliente.');
  expect(screen.queryByText('Dado de outro cliente')).not.toBeInTheDocument();
});

it('desmonta a carteira na troca de conta mesmo quando o token é igual', async () => {
  const segunda = pendente();
  let leituras = 0;
  servir({ escopo: () => ++leituras === 1 ? Promise.resolve(json({ amplo: false, clientes })) : segunda.promessa });
  const view = render(pagina());
  await screen.findByRole('button', { name: 'Negócio A' });
  conta = { ...conta, user: { id: 'pessoa-2' } };
  view.rerender(pagina());
  expect(screen.queryByText('Negócio A')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Cliente do Comercial' })).not.toBeInTheDocument();
  await act(async () => segunda.resolver(json({ amplo: false, clientes: [clientes[1]] })));
  expect(await screen.findByRole('button', { name: 'Negócio B' })).toBeInTheDocument();
});

it('sem papel de leitura, a carteira restrita não consulta dados comerciais', async () => {
  podeLer = false;
  const fetch = servir();
  render(pagina());
  expect(await screen.findByText('Seu acesso atual não permite abrir o Comercial.')).toBeInTheDocument();
  expect(fetch.mock.calls.every(([url]) => url === '/api/clientes-escopo/me')).toBe(true);
});

it('mantém o conteúdo original para ALL', async () => {
  const fetch = servir({ escopo: async () => json({ amplo: true, clientes }) });
  render(<LayoutDoComercial><p>Conteúdo amplo de Comercial</p></LayoutDoComercial>);
  expect(await screen.findByText('Conteúdo amplo de Comercial')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Cliente do Comercial' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/clientes-escopo/me']);
});

it('usa carteira também na entrada Lista de leads', async () => {
  window.history.replaceState({}, '', '/leads');
  const fetch = servir();
  render(<LayoutDeLeads><ListaDeLeadsPage /></LayoutDeLeads>);
  expect(await screen.findByRole('button', { name: 'Negócio A' })).toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/clientes-escopo/me',
    `${rota}/leads?clienteId=${A}&page=1&limit=30`,
  ]);
});

it('impede a consulta organizacional ao abrir Propostas diretamente', async () => {
  window.history.replaceState({}, '', '/propostas');
  const fetch = servir();
  render(<LayoutDePropostas><PropostasPage /></LayoutDePropostas>);
  expect(await screen.findByRole('link', { name: 'Abrir Comercial' })).toHaveAttribute('href', '/comercial');
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/clientes-escopo/me']);
});
