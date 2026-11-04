import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrabalhoPage from '@/app/trabalho/page';
import AtasPage from '@/app/trabalho/atas/page';
import ImplantacaoPage from '@/app/trabalho/implantacao/page';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const a = {
  id: 'tarefa-a', listId: 'lista-a', listName: 'Lista A', clienteId: A, title: 'Entrega A',
  statusName: 'A fazer', filhos: [], comentarios: [], updatedAt: '2026-11-04T12:00:00Z',
  carteira: { podeCriar: true, podeCriarSubtarefa: true, podeEditar: true },
};
const b = { id: 'tarefa-b', clienteId: B, title: 'Entrega B', statusName: 'A fazer', filhos: [] };
const clientes = [{ id: A, nome: 'Cliente A', interno: false }, { id: B, nome: 'Cliente B', interno: false }];
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
let conta: { token: string; user: { id: string } };
let podeEditar: boolean;
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ ...conta, ready: true, can: (p: string) => p !== 'tarefas.editar' || podeEditar }) }));

function pendente() {
  let resolver!: (r: Response) => void;
  const promessa = new Promise<Response>((resolve) => { resolver = resolve; });
  return { promessa, resolver };
}

function servir({
  detalhe = () => Promise.resolve(json(a)),
  escopo = () => Promise.resolve(json({ amplo: false, clientes })),
  baixar = () => Promise.resolve(new Response('arquivo')),
  comentar = () => Promise.resolve(json({ id: 'comentario-a', createdAt: '2026-11-04T12:00:00Z' })),
  editar = () => Promise.resolve(json(a)),
  criar = () => Promise.resolve(json({ id: 'tarefa-nova' })),
  listarA = () => Promise.resolve(json({ items: [a], total: 1 })),
} = {}) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url, 'http://localhost');
    if (pathname === '/api/clientes-escopo/me') return escopo();
    if (pathname === '/api/trabalho/tarefas') {
      if (init?.method === 'POST') return criar();
      const cliente = searchParams.get('cliente');
      if (cliente === A) return listarA();
      if (cliente === B) return json({ items: [b], total: 1 });
    }
    if (pathname === '/api/trabalho/tarefas/tarefa-a') return init?.method === 'PATCH' ? editar() : detalhe();
    if (pathname === '/api/trabalho/tarefas/tarefa-a/comentarios' && init?.method === 'POST') return comentar();
    if (pathname === '/api/trabalho/tarefas/tarefa-a/anexos') return json([{
      id: 'arquivo-a', nome: 'Anexo A.pdf', bytes: 512, autorNome: 'Pessoa A',
      estado: 'enviado', driveUrl: 'https://drive.exemplo.invalid/a',
    }]);
    if (pathname === '/api/trabalho/tarefas/tarefa-a/anexos/arquivo-a/arquivo') return baixar();
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  conta = { token: 'sessao-1', user: { id: 'pessoa-1' } };
  podeEditar = true;
  window.history.replaceState({}, '', '/trabalho');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Trabalho com carteira de clientes', () => {
  it('usa apenas clientes liberados, busca no cliente atual e omite ações da organização', async () => {
    window.history.replaceState({}, '', '/trabalho?cliente=sem&lista=lista-da-organizacao');
    const fetch = servir();
    render(<TrabalhoPage />);
    expect(await screen.findByRole('button', { name: 'Entrega A' })).toBeInTheDocument();
    const seletor = screen.getByRole('combobox', { name: 'Cliente do Trabalho' });
    expect(seletor).toHaveValue(A);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Cliente A', 'Cliente B']);
    fireEvent.change(seletor, { target: { value: B } });
    expect(screen.queryByText('Entrega A')).not.toBeInTheDocument();
    await screen.findByRole('button', { name: 'Entrega B' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar tarefas' }), { target: { value: 'prazo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByRole('button', { name: 'Entrega B' });
    const caminhos = fetch.mock.calls.map(([url]) => url);
    expect(caminhos).toEqual([
      '/api/clientes-escopo/me',
      `/api/trabalho/tarefas?cliente=${A}&page=1&limit=30`,
      `/api/trabalho/tarefas?cliente=${B}&page=1&limit=30`,
      `/api/trabalho/tarefas?cliente=${B}&page=1&limit=30&q=prazo`,
    ]);
    expect(screen.queryByRole('button', { name: /nova pasta|configurar lista|delegar/i })).not.toBeInTheDocument();
  });

  it('descarta a lista atrasada de A ao trocar para B', async () => {
    const lista = pendente();
    const fetch = servir({ listarA: () => lista.promessa });
    render(<TrabalhoPage />);
    await screen.findByText('Carregando tarefas…');
    fireEvent.change(screen.getByRole('combobox', { name: 'Cliente do Trabalho' }), { target: { value: B } });
    await screen.findByRole('button', { name: 'Entrega B' });
    expect(fetch.mock.calls.find(([url]) => url.includes(`cliente=${A}`))?.[1]?.signal?.aborted).toBe(true);
    await act(async () => lista.resolver(json({ items: [a], total: 1 })));
    expect(screen.queryByText('Entrega A')).not.toBeInTheDocument();
  });

  it('cancela o detalhe de A ao trocar para B, inclusive quando o transporte ignora o cancelamento', async () => {
    const detalhe = pendente();
    const fetch = servir({ detalhe: () => detalhe.promessa });
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega A' }));
    expect(await screen.findByText('Carregando tarefa…')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Cliente do Trabalho' }), { target: { value: B } });
    await screen.findByRole('button', { name: 'Entrega B' });
    expect(fetch.mock.calls.find(([url]) => url.endsWith('/tarefas/tarefa-a'))?.[1]?.signal?.aborted).toBe(true);
    await act(async () => detalhe.resolver(json({ ...a, description: 'Informação do cliente A' })));
    expect(screen.queryByText('Informação do cliente A')).not.toBeInTheDocument();
    expect(screen.queryByText('Entrega A')).not.toBeInTheDocument();
  });

  it('lista anexos, baixa com a sessão e descarta o arquivo atrasado após trocar de cliente', async () => {
    const arquivo = pendente();
    const fetch = servir({ baixar: () => arquivo.promessa });
    const criarUrl = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = criarUrl; });
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega A' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Anexo A.pdf' }));
    expect(screen.queryByRole('link', { name: 'Abrir no Drive' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Anexar arquivo à tarefa')).not.toBeInTheDocument();
    const download = fetch.mock.calls.find(([url]) => url.endsWith('/anexos/arquivo-a/arquivo'))?.[1];
    expect(new Headers(download?.headers).get('Authorization')).toBe('Bearer sessao-1');
    fireEvent.change(screen.getByRole('combobox', { name: 'Cliente do Trabalho' }), { target: { value: B } });
    expect(screen.queryByText('Anexo A.pdf')).not.toBeInTheDocument();
    expect(download?.signal?.aborted).toBe(true);
    await act(async () => arquivo.resolver(new Response('arquivo de A')));
    expect(criarUrl).not.toHaveBeenCalled();
  });

  it('registra comentário na tarefa selecionada e oculta a escrita para leitura', async () => {
    const fetch = servir();
    const view = render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega A' }));
    fireEvent.change(await screen.findByLabelText('Novo comentário'), { target: { value: '  Entrega conferida  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));
    expect(await screen.findByText('Entrega conferida')).toBeInTheDocument();
    const envio = fetch.mock.calls.find(([url]) => url.endsWith('/tarefas/tarefa-a/comentarios'))?.[1];
    expect(JSON.parse(String(envio?.body))).toEqual({ text: 'Entrega conferida' });
    podeEditar = false;
    view.rerender(<TrabalhoPage />);
    expect(screen.queryByLabelText('Novo comentário')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar tarefa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova subtarefa' })).not.toBeInTheDocument();
  });

  it('edita título e descrição com a versão da tarefa e recarrega depois do sucesso', async () => {
    let titulo = a.title;
    const fetch = servir({
      editar: async () => {
        titulo = 'Entrega A revisada';
        return json({ ...a, title: titulo });
      },
      detalhe: async () => json({ ...a, title: titulo }),
    });
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega A' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar tarefa' }));
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Entrega A revisada' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Revisão aprovada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar tarefa' }));
    expect(await screen.findByRole('heading', { name: 'Entrega A revisada' })).toBeInTheDocument();
    const escrita = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(escrita?.[0]).toBe('/api/trabalho/tarefas/tarefa-a');
    expect(JSON.parse(String(escrita?.[1]?.body))).toEqual({
      title: 'Entrega A revisada', description: 'Revisão aprovada', expectedUpdatedAt: a.updatedAt,
    });
  });

  it.each([
    ['Nova tarefa nesta lista', undefined],
    ['Nova subtarefa', a.id],
  ])('cria %s com a lista e o cliente autorizados', async (acao, parentId) => {
    const fetch = servir();
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega A' }));
    fireEvent.click(await screen.findByRole('button', { name: acao }));
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Confirmar prazo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar tarefa' }));
    expect(await screen.findByText('Tarefa criada.')).toBeInTheDocument();
    const escrita = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(escrita?.[0]).toBe('/api/trabalho/tarefas');
    expect(JSON.parse(String(escrita?.[1]?.body))).toEqual({
      title: 'Confirmar prazo', listId: a.listId, clienteId: A, ...(parentId ? { parentId } : {}),
    });
  });

  it('oculta a criação quando a lista não permite abrir tarefas', async () => {
    servir({ detalhe: async () => json({
      ...a, carteira: { podeCriar: false, podeCriarSubtarefa: true, podeEditar: false },
    }) });
    render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega A' }));
    expect(await screen.findByRole('button', { name: 'Nova subtarefa' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova tarefa nesta lista' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar tarefa' })).not.toBeInTheDocument();
  });

  it('omite detalhe e anexos quando o ID devolvido pertence a outro cliente', async () => {
    const fetch = servir({ detalhe: async () => json({ ...a, clienteId: B, description: 'Descrição fora do cliente escolhido' }) });
    window.history.replaceState({}, '', `/trabalho?cliente=${A}&tarefa=${a.id}`);
    render(<TrabalhoPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Tarefa indisponível para este cliente.');
    expect(screen.queryByText('Descrição fora do cliente escolhido')).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => url.includes('/anexos'))).toBe(false);
  });

  it('limpa o detalhe e a carteira quando muda a conta, mesmo com o mesmo token', async () => {
    const novoEscopo = pendente();
    let primeira = true;
    servir({
      detalhe: async () => json({ ...a, description: 'Informação do cliente A' }),
      escopo: () => {
        if (!primeira) return novoEscopo.promessa;
        primeira = false;
        return Promise.resolve(json({ amplo: false, clientes }));
      },
    });
    const view = render(<TrabalhoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrega A' }));
    await screen.findByText('Informação do cliente A');
    conta = { ...conta, user: { id: 'pessoa-2' } };
    view.rerender(<TrabalhoPage />);
    expect(screen.queryByText('Informação do cliente A')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cliente A' })).not.toBeInTheDocument();
    await act(async () => novoEscopo.resolver(json({ amplo: false, clientes: [clientes[1]] })));
    expect(await screen.findByRole('button', { name: 'Entrega B' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cliente A' })).not.toBeInTheDocument();
  });

  it('sem vínculos ou sem perfil, não consulta tarefas', async () => {
    const fetch = servir({ escopo: async () => json({ amplo: false, clientes: [] }) });
    const view = render(<TrabalhoPage />);
    expect(await screen.findByText('Nenhum cliente disponível em Trabalho.')).toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/clientes-escopo/me']);
    view.unmount();

    fetch.mockClear().mockResolvedValue(new Response(null, { status: 403 }));
    render(<TrabalhoPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/clientes-escopo/me']);
  });

  it.each([AtasPage, ImplantacaoPage])('impede consultas das áreas ainda organizacionais', async (Pagina) => {
    const fetch = servir();
    render(<Pagina />);
    expect(await screen.findByRole('link', { name: 'Abrir Trabalho' })).toHaveAttribute('href', '/trabalho');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/clientes-escopo/me']);
  });
});
