import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Cofre from '../../src/app/cofre/page';

const clienteA = '11111111-1111-4111-8111-111111111111';
const clienteB = '22222222-2222-4222-8222-222222222222';
const interno = '33333333-3333-4333-8333-333333333333';
const item = {
  id: 'item-a', clienteId: clienteA, tipo: 'senha', titulo: 'Item A', onde: null,
  temUsuario: false, temSegredo: true, temNotas: false, arquivo: null,
};
const clientes = [
  { id: clienteA, nome: 'Cliente A', interno: false },
  { id: clienteB, nome: 'Cliente B', interno: false },
  { id: interno, nome: 'ROOT interno', interno: true },
];
const pessoa = { id: 'conta-2', name: 'Mariana', email: 'mariana@exemplo.test', clienteAcessoPerfil: null };
const eu = { id: 'conta-1', name: 'Admin', email: 'admin@exemplo.test', clienteAcessoPerfil: null };
let auth: { user: { id: string; roles: string[] }; token: string };
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ ...auth, ready: true, can: () => true }) }));
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function preparar({
  amplo = true,
  revelar = () => Promise.resolve(json({ id: item.id, segredo: 'Segredo A' })),
  baixar = () => Promise.resolve(new Response('arquivo de teste')),
} = {}) {
  let pessoas: { id: string; name: string; email: string; clienteAcessoPerfil: unknown }[] = [eu, pessoa];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/clientes-escopo/pessoas')) return json(pessoas);
    if (url.endsWith(`/clientes-escopo/pessoas/${pessoa.id}`) && init?.method === 'PUT') {
      const { modo, clienteIds } = JSON.parse(init.body as string);
      pessoas = [eu, { ...pessoa, clienteAcessoPerfil: { modo, vinculos: clienteIds.map((clienteId: string) => ({ clienteId })) } }];
      return json({ userId: pessoa.id, modo, clienteIds });
    }
    const path = url.split('/cofre-da-empresa')[1];
    if (path === '/estado') return json({ temSenha: true, aberto: false, bloqueadoAte: null, minutosDaSessao: 15 });
    if (path === '/destrancar') return json({ token: 'sessao-cofre' });
    if (path === '/clientes') return json({ amplo, clientes: amplo ? clientes : clientes.slice(0, 2) });
    if (path === `/itens/${item.id}/revelar`) return revelar();
    if (path === `/itens/${item.id}/arquivo`) return baixar();
    if (path === `/itens/${item.id}` && init?.method === 'PATCH') return json({ id: item.id });
    if (path === '/itens' && init?.method === 'POST') return json({ id: 'novo-item' });
    if (path === '/depositos' && init?.method === 'POST') return json({
      id: 'novo-link', cliente: 'Cliente B', clienteId: clienteB,
      expiraEm: '2099-01-01T00:00:00Z', revogadoEm: null, recebidos: 0, caminho: '/entregar-acessos#novo-link',
    });
    if (path === '/itens?clienteId=sem') return json([{ ...item, clienteId: null, titulo: 'Acesso legado' }]);
    if (path === `/itens?clienteId=${clienteA}` || path === '/itens') {
      return json([{ ...item, arquivo: { nome: 'arquivo-a.pdf', tipo: 'application/pdf', tamanho: 10 } }]);
    }
    if (path.startsWith('/itens?') || path.startsWith('/depositos')) return json([]);
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function destrancar() {
  fireEvent.change(await screen.findByPlaceholderText('Senha do cofre'), { target: { value: 'senha-ficticia' } });
  fireEvent.click(screen.getByRole('button', { name: 'Destrancar' }));
  return screen.findByRole('combobox', { name: 'Cliente do cofre' });
}

beforeEach(() => { auth = { user: { id: 'conta-1', roles: [] }, token: 'login-1' }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('escopo de clientes no cofre', () => {
  it('descarta uma revelação de A que termina depois da troca para B', async () => {
    let terminar!: (response: Response) => void;
    const revelar = () => new Promise<Response>((resolve) => { terminar = resolve; });
    const fetch = preparar({ revelar });
    render(<Cofre />);
    const seletor = await destrancar();
    fireEvent.change(seletor, { target: { value: clienteA } });
    await screen.findByText('Item A');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar' }));
    fireEvent.change(seletor, { target: { value: clienteB } });
    expect(screen.queryByText('Item A')).not.toBeInTheDocument();
    await act(async () => terminar(json({ id: item.id, segredo: 'Segredo A' })));
    expect(screen.queryByText('Segredo A')).not.toBeInTheDocument();
    expect(fetch.mock.calls.find(([url]) => url.endsWith('/revelar'))?.[1]?.signal?.aborted).toBe(true);
    expect(fetch.mock.calls.some(([url]) => url.endsWith(`/itens?clienteId=${clienteB}`))).toBe(true);
    expect(fetch.mock.calls.some(([url]) => url.endsWith(`/depositos?clienteId=${clienteB}`))).toBe(true);
  });

  it('cria o item e o link com o ID selecionado e limpa o link na troca', async () => {
    const fetch = preparar();
    render(<Cofre />);
    const seletor = await destrancar();
    expect(screen.getByRole('option', { name: 'ROOT interno' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sem classificação' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Novo item' })).toBeDisabled();
    fireEvent.change(seletor, { target: { value: clienteB } });
    fireEvent.click(screen.getByRole('button', { name: '+ Novo item' }));
    fireEvent.change(screen.getByPlaceholderText(/Título/), { target: { value: 'Portal B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText('Guardado no cofre.');
    const criarItem = fetch.mock.calls.find(([url, init]) => url.endsWith('/itens') && init?.method === 'POST');
    expect(JSON.parse(criarItem?.[1]?.body as string)).toMatchObject({ titulo: 'Portal B', clienteId: clienteB });

    fireEvent.click(screen.getByText('Receber acessos de um cliente'));
    expect(screen.queryByLabelText('Cliente do link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de 7 dias' }));
    expect(await screen.findByLabelText('Link para o cliente')).toHaveValue(`${window.location.origin}/entregar-acessos#novo-link`);
    const criarLink = fetch.mock.calls.find(([url, init]) => url.endsWith('/depositos') && init?.method === 'POST');
    expect(JSON.parse(criarLink?.[1]?.body as string)).toEqual({ clienteId: clienteB });
    fireEvent.change(seletor, { target: { value: clienteA } });
    expect(screen.queryByLabelText('Link para o cliente')).not.toBeInTheDocument();
  });

  it('remove o cofre aberto quando muda a conta e omite os escopos exclusivos de ALL', async () => {
    preparar({ amplo: false });
    const { rerender } = render(<Cofre />);
    const seletor = await destrancar();
    expect(screen.queryByRole('option', { name: 'Sem classificação' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'ROOT interno' })).not.toBeInTheDocument();
    expect(screen.queryByText('Acesso por cliente')).not.toBeInTheDocument();
    fireEvent.change(seletor, { target: { value: clienteA } });
    await screen.findByText('Item A');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar' }));
    await screen.findByText('Segredo A');
    auth = { user: { id: 'conta-2', roles: [] }, token: 'login-2' };
    rerender(<Cofre />);
    expect(screen.queryByText('Segredo A')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Cliente do cofre' })).not.toBeInTheDocument();
    await screen.findByPlaceholderText('Senha do cofre');
  });

  it('encerra o formulário e ignora um download de A que chega depois da troca', async () => {
    let terminar!: (response: Response) => void;
    const baixar = () => new Promise<Response>((resolve) => { terminar = resolve; });
    const fetch = preparar({ baixar });
    const criarUrl = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = criarUrl; });
    render(<Cofre />);
    const seletor = await destrancar();
    fireEvent.change(seletor, { target: { value: clienteA } });
    fireEvent.click(await screen.findByRole('button', { name: 'arquivo-a.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'editar' }));
    expect(await screen.findByPlaceholderText('Senha')).toHaveValue('Segredo A');
    fireEvent.change(seletor, { target: { value: clienteB } });
    expect(screen.queryByPlaceholderText('Senha')).not.toBeInTheDocument();
    await act(async () => terminar(new Response('arquivo de teste')));
    expect(fetch.mock.calls.find(([url]) => url.endsWith('/arquivo'))?.[1]?.signal?.aborted).toBe(true);
    expect(criarUrl).not.toHaveBeenCalled();
  });

  it('permite classificar um item legado pelo ID do destino autorizado', async () => {
    const fetch = preparar();
    render(<Cofre />);
    const seletor = await destrancar();
    fireEvent.change(seletor, { target: { value: 'sem' } });
    await screen.findByText('Acesso legado');
    fireEvent.click(screen.getByRole('button', { name: 'editar' }));
    fireEvent.change(await screen.findByLabelText('Cliente do item'), { target: { value: clienteB } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText('Guardado no cofre.');
    const atualizar = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(atualizar?.[1]?.body as string)).toMatchObject({ clienteId: clienteB });
  });

  it('permite ao administrador amplo salvar e conferir a carteira de outra pessoa', async () => {
    auth.user.roles = ['admin_master'];
    const fetch = preparar();
    render(<Cofre />);
    await destrancar();
    fireEvent.click(screen.getByText('Acesso por cliente'));
    const escolherPessoa = await screen.findByLabelText('Pessoa');
    expect(screen.getByRole('option', { name: /Admin/ })).toBeDisabled();
    fireEvent.change(escolherPessoa, { target: { value: pessoa.id } });
    fireEvent.change(screen.getByLabelText('Tipo de acesso'), { target: { value: 'SELECTED' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cliente B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar acesso' }));
    await screen.findByText('Acesso atualizado.');
    const chamadas = fetch.mock.calls.filter(([url]) => url.includes('/clientes-escopo/pessoas'));
    expect(chamadas.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'PUT', 'GET']);
    expect(chamadas[1][0]).toMatch(new RegExp(`/pessoas/${pessoa.id}$`));
    expect(JSON.parse(chamadas[1][1]?.body as string)).toEqual({ modo: 'SELECTED', clienteIds: [clienteB] });
    expect(screen.getByRole('checkbox', { name: 'Cliente B' })).toBeChecked();
  });

  it.each([
    { amplo: false, roles: ['admin_master'] },
    { amplo: true, roles: [] },
  ])('oculta a gestão sem papel administrativo e acesso amplo ($amplo, $roles)', async ({ amplo, roles }) => {
    auth.user.roles = roles;
    const fetch = preparar({ amplo });
    render(<Cofre />);
    await destrancar();
    expect(screen.queryByText('Acesso por cliente')).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => url.includes('/clientes-escopo/pessoas'))).toBe(false);
  });
});
