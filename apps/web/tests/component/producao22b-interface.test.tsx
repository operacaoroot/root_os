import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * PRODUÇÃO 22B (22/10/2026), lane A, a tela:
 *
 *  I1 · o botão de recolher logo à frente da logo; o acordeão abre, FECHA e troca;
 *       a engrenagem do topo (Perfil, Lixeira, Registro de ações, Configurações,
 *       só o que a permissão libera; teclado, Esc e clique fora); o "⋯" da árvore
 *       só no hover e no foco (sempre no toque), com o menu por portal sempre
 *       dentro da janela nas três larguras; ícone e cor (gravar, mostrar, apagar).
 *  I3 · a árvore sem a pasta Clientes (que chega em `pastasDoComercial`), a
 *       Implantação achando a lista dela do mesmo jeito, e o "⋯" dizendo por que
 *       a lista não sai direto, com "Arquivar todas as N tarefas".
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn(), del = vi.fn();
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: (...a: unknown[]) => del(...a), apiBlob: vi.fn(),
}));
let permissoes = ['tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok', ready: true,
    user: { id: 'eu', name: 'Pessoa', email: 'p@x.invalid', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));
vi.mock('@/lib/plataforma', () => ({ useEhPlataforma: () => false }));
vi.mock('@/components/modulos', () => ({ useModulos: () => ({ modulos: null, ligado: () => true }) }));
let CAMINHO = '/trabalho';
vi.mock('next/navigation', () => ({
  usePathname: () => CAMINHO,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));

import { Sidebar, passoDoAcordeao } from '@/components/Sidebar';
import { EngrenagemDoUsuario, itensDaEngrenagem } from '@/components/EngrenagemDoUsuario';
import { posicaoDoMenu, MARGEM_DO_MENU } from '@/lib/posicao-do-menu';
import { AcoesDaListaNaArvore, CLASSE_DO_GATILHO_DA_ARVORE, LARGURA_DO_MENU_DA_ARVORE, porqueNaoSaiDireto } from '@/components/trabalho/ExcluirDaArvore';
import { DialogoDeIcone, IconeDaLista } from '@/components/trabalho/IconeDaLista';
import TrabalhoPage from '@/app/trabalho/page';
import ImplantacaoPage from '@/app/trabalho/implantacao/page';

afterEach(cleanup);

// ---------------------------------------------------------------- I1 · menu lateral

const linksDasAreas = () => Array.from(document.querySelectorAll<HTMLAnchorElement>('#root-os-nav a[data-area]'));
const area = (nome: string) => linksDasAreas().find((a) => a.textContent?.trim() === nome)!;
const TODAS = ['dashboard.ver', 'tarefas.ver', 'tarefas.editar', 'pauta.ver', 'leads.ver', 'mcp.ver', 'auditoria.ver'];

describe('I1: o menu lateral', () => {
  beforeEach(() => { permissoes = [...TODAS]; CAMINHO = '/trabalho'; localStorage.clear(); });

  it('o passo do acordeão: aberta fecha, a da tela reabre, outra navega; recolhido e item único navegam', () => {
    expect(passoDoAcordeao({ compacta: false, temLista: true, aberta: true, ativa: true })).toBe('fechar');
    expect(passoDoAcordeao({ compacta: false, temLista: true, aberta: false, ativa: true })).toBe('abrir');
    expect(passoDoAcordeao({ compacta: false, temLista: true, aberta: false, ativa: false })).toBe('navegar');
    expect(passoDoAcordeao({ compacta: true, temLista: true, aberta: false, ativa: true })).toBe('navegar');
    expect(passoDoAcordeao({ compacta: false, temLista: false, aberta: false, ativa: true })).toBe('navegar');
  });

  it('acordeão: clicar de novo na área aberta recolhe; de novo reabre; outra área troca; a rota continua marcada', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    expect(area('Trabalho')).toHaveAttribute('aria-expanded', 'true');
    const subsecoes = () => screen.queryByRole('list', { name: 'Subseções de Trabalho' });
    expect(within(subsecoes()!).getByRole('link', { name: 'Tarefas' })).toHaveAttribute('aria-current', 'page');

    await user.click(area('Trabalho'));
    expect(area('Trabalho')).toHaveAttribute('aria-expanded', 'false');
    expect(subsecoes()).toBeNull();
    // A área continua marcada como a da tela atual.
    expect(area('Trabalho')).toHaveAttribute('aria-current', 'true');

    await user.click(area('Trabalho'));
    expect(area('Trabalho')).toHaveAttribute('aria-expanded', 'true');
    expect(within(subsecoes()!).getByRole('link', { name: 'Tarefas' })).toHaveAttribute('aria-current', 'page');

    await user.click(area('Dia a dia'));
    expect(area('Dia a dia')).toHaveAttribute('aria-expanded', 'true');
    expect(area('Trabalho')).toHaveAttribute('aria-expanded', 'false');
  });

  it('o botão de recolher fica logo à frente da logo, no topo, e não mais no rodapé', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const logo = screen.getByRole('link', { name: 'ROOT OS, início' });
    const botao = screen.getByRole('button', { name: 'Recolher menu' });
    expect(logo.nextElementSibling).toBe(botao);
    expect(screen.getByRole('group', { name: 'Tema da interface' }).parentElement!.contains(botao)).toBe(false);
    await user.click(botao);
    const expandir = screen.getByRole('button', { name: 'Expandir menu' });
    // Recolhido: o R e o botão continuam lado a lado.
    expect(logo.nextElementSibling).toBe(expandir);
    expect(localStorage.getItem('root-os:menu-recolhido')).toBe('1');
  });
});

// ---------------------------------------------------------------- I1 · engrenagem

describe('I1: a engrenagem do topo', () => {
  it('só os itens que a permissão libera, na ordem', () => {
    expect(itensDaEngrenagem([], null).map((i) => i.rotulo)).toEqual(['Perfil']);
    expect(itensDaEngrenagem(['tarefas.editar', 'auditoria.ver'], '/config').map((i) => [i.rotulo, i.href])).toEqual([
      ['Perfil', '/perfil'], ['Lixeira', '/lixeira'], ['Registro de ações', '/rastro'], ['Configurações', '/config'],
    ]);
    expect(itensDaEngrenagem(['tarefas.ver', 'auditoria.ver'], null).map((i) => i.chave)).toEqual(['perfil', 'rastro']);
    expect(itensDaEngrenagem(['tarefas.editar'], null, false).map((i) => i.chave)).toEqual(['perfil']);
  });

  it('abre pelo clique, anda pelas setas, fecha com Esc (o foco volta) e com clique fora', async () => {
    permissoes = ['tarefas.ver', 'tarefas.editar'];
    render(<div><EngrenagemDoUsuario /><p>fora</p></div>);
    const botao = screen.getByRole('button', { name: 'Configurações e registros' });
    expect(botao).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(botao);
    const menu = screen.getByRole('menu');
    const itens = within(menu).getAllByRole('menuitem');
    expect(itens.map((i) => i.textContent)).toEqual(['Perfil', 'Lixeira']);
    expect(itens[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(itens[1]).toHaveFocus();
    expect(itens[1]).toHaveAttribute('href', '/lixeira');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(botao).toHaveFocus();
    fireEvent.click(botao);
    fireEvent.mouseDown(screen.getByText('fora'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('sem tarefas.editar não há Lixeira; com auditoria.ver há o Registro de ações', () => {
    permissoes = ['tarefas.ver', 'auditoria.ver'];
    render(<EngrenagemDoUsuario />);
    fireEvent.click(screen.getByTestId('engrenagem'));
    expect(screen.queryByTestId('engrenagem-lixeira')).toBeNull();
    expect(screen.getByTestId('engrenagem-rastro')).toHaveAttribute('href', '/rastro');
  });
});

// ---------------------------------------------------------------- I1 · o menu do "⋯" cabe

describe('I1: o menu do "⋯" sempre dentro da janela', () => {
  const JANELAS = [{ largura: 390, altura: 844 }, { largura: 768, altura: 1024 }, { largura: 1440, altura: 900 }];
  const ALTURA = 220;
  const dentro = (p: ReturnType<typeof posicaoDoMenu>, j: { largura: number; altura: number }) => {
    const altura = p.maxAltura ?? ALTURA;
    expect(p.left).toBeGreaterThanOrEqual(MARGEM_DO_MENU);
    expect(p.left + p.largura).toBeLessThanOrEqual(j.largura - MARGEM_DO_MENU);
    expect(p.top).toBeGreaterThanOrEqual(MARGEM_DO_MENU);
    expect(p.top + altura).toBeLessThanOrEqual(j.altura - MARGEM_DO_MENU);
  };

  for (const j of JANELAS) {
    it(`em ${j.largura} px: botão na ponta direita, na esquerda, embaixo e numa janela baixa`, () => {
      const botao = (x: number, y: number) => ({ left: x, right: x + 20, top: y, bottom: y + 20 });
      const direita = posicaoDoMenu(botao(j.largura - 28, 100), { largura: LARGURA_DO_MENU_DA_ARVORE, altura: ALTURA }, j);
      dentro(direita, j);
      expect(direita.lado).toBe('baixo');
      // Na ponta direita, o menu termina onde termina o botão.
      expect(direita.left + direita.largura).toBe(j.largura - 8);

      const esquerda = posicaoDoMenu(botao(10, 100), { largura: LARGURA_DO_MENU_DA_ARVORE, altura: ALTURA }, j);
      dentro(esquerda, j);
      expect(esquerda.left).toBeGreaterThanOrEqual(MARGEM_DO_MENU);

      const embaixo = posicaoDoMenu(botao(200, j.altura - 40), { largura: LARGURA_DO_MENU_DA_ARVORE, altura: ALTURA }, j);
      dentro(embaixo, j);
      expect(embaixo.lado).toBe('cima');

      const baixa = { largura: j.largura, altura: 300 };
      const apertado = posicaoDoMenu(botao(200, 140), { largura: LARGURA_DO_MENU_DA_ARVORE, altura: 400 }, baixa);
      expect(apertado.maxAltura).not.toBeNull();
      expect(apertado.top).toBeGreaterThanOrEqual(MARGEM_DO_MENU);
      expect(apertado.top + apertado.maxAltura!).toBeLessThanOrEqual(baixa.altura - MARGEM_DO_MENU);
    });
  }

  it('janela mais estreita que o menu: a largura encolhe e cabe', () => {
    const p = posicaoDoMenu({ left: 250, right: 270, top: 10, bottom: 30 }, { largura: 600, altura: 100 }, { largura: 280, altura: 600 });
    expect(p.largura).toBe(280 - 16);
    expect(p.left).toBe(8);
  });
});

// ---------------------------------------------------------------- I1 · o "⋯" da árvore

describe('I1: o "⋯" da árvore', () => {
  beforeEach(() => { post.mockReset(); post.mockResolvedValue({ id: 'l', arquivadas: 3 }); });

  function Linha({ total = 3 }: { total?: number }) {
    return (
      <div className="group/arvore" data-testid="linha">
        <button type="button">Financeiro</button>
        <AcoesDaListaNaArvore
          lista={{ id: 'l-fin', name: 'Financeiro', total }} token="tok"
          aoRenomear={() => {}} aoAparencia={() => {}} aoExcluir={() => {}} aoMudar={() => {}} aoErro={() => {}}
        />
      </div>
    );
  }

  it('só aparece no hover e no foco da linha; no toque, sempre; aberto, continua', () => {
    for (const c of ['opacity-0', 'group-hover/arvore:opacity-100', 'group-focus-within/arvore:opacity-100', '[@media(hover:none)]:opacity-100', 'aria-expanded:opacity-100']) {
      expect(CLASSE_DO_GATILHO_DA_ARVORE.split(' ')).toContain(c);
    }
    render(<Linha />);
    const gatilho = screen.getByTestId('trabalho-lista-acoes-l-fin');
    for (const c of CLASSE_DO_GATILHO_DA_ARVORE.split(' ')) expect(gatilho.className).toContain(c);
    expect(screen.getByTestId('linha').className).toContain('group/arvore');
  });

  it('o menu abre por portal (fora da linha), com o texto que quebra linha, e Esc devolve o foco', () => {
    render(<Linha />);
    const gatilho = screen.getByTestId('trabalho-lista-acoes-l-fin');
    fireEvent.click(gatilho);
    const menu = screen.getByRole('menu');
    expect(screen.getByTestId('linha').contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe('fixed');
    for (const item of within(menu).getAllByRole('menuitem')) expect(item.className).toContain('whitespace-normal');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(gatilho).toHaveFocus();
  });

  it('I3: diz por que a lista não sai direto e oferece "Arquivar todas as N tarefas"', () => {
    expect(porqueNaoSaiDireto(0)).toBeUndefined();
    expect(porqueNaoSaiDireto(1)).toBe('Tem 1 tarefa ativa: antes de sair, ela vai para outra lista ou é arquivada.');
    render(<Linha total={3} />);
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-fin'));
    expect(screen.getByTestId('trabalho-lista-acoes-l-fin-excluir')).toHaveTextContent('Tem 3 tarefas ativas: antes de sair, elas vão para outra lista ou são arquivadas.');
    expect(screen.getByTestId('trabalho-lista-acoes-l-fin-arquivar')).toHaveTextContent('Arquivar todas as 3 tarefas');
    expect(screen.getByTestId('trabalho-lista-acoes-l-fin-aparencia')).toHaveTextContent('Ícone e cor');
  });
});

// ---------------------------------------------------------------- I1 · ícone e cor

describe('I1: ícone e cor', () => {
  it('desenha emoji, ícone do catálogo ou o ponto da cor; sem nada, nada', () => {
    const { container, rerender } = render(<IconeDaLista icone="📣" cor="mag" />);
    expect(screen.getByTestId('icone-da-lista')).toHaveTextContent('📣');
    expect(screen.getByTestId('icone-da-lista').className).toContain('text-mag');
    rerender(<IconeDaLista icone="Wallet" cor="good" />);
    expect(screen.getByTestId('icone-da-lista').getAttribute('data-icone')).toBe('Wallet');
    rerender(<IconeDaLista cor="warn" />);
    expect(screen.getByTestId('icone-da-lista').getAttribute('data-cor')).toBe('warn');
    rerender(<IconeDaLista icone={null} cor={null} />);
    expect(container.innerHTML).toBe('');
    rerender(<IconeDaLista icone="NaoExiste" cor="#fff" />);
    expect(container.innerHTML).toBe('');
  });

  it('o seletor grava emoji e cor, e apaga com "Sem ícone" e "Sem cor"', async () => {
    const aoSalvar = vi.fn().mockResolvedValue(undefined);
    const aoFechar = vi.fn();
    const { unmount } = render(<DialogoDeIcone titulo="Ícone e cor da lista Financeiro" inicial={{}} aoSalvar={aoSalvar} aoFechar={aoFechar} />);
    fireEvent.click(screen.getByTestId('icone-emoji-💰'));
    fireEvent.click(screen.getByTestId('cor-good'));
    fireEvent.click(screen.getByTestId('icone-salvar'));
    await waitFor(() => expect(aoSalvar).toHaveBeenCalledWith({ icone: '💰', cor: 'good' }));
    await waitFor(() => expect(aoFechar).toHaveBeenCalled());
    unmount();

    aoSalvar.mockClear();
    render(<DialogoDeIcone titulo="t" inicial={{ icone: 'Wallet', cor: 'bad' }} aoSalvar={aoSalvar} aoFechar={() => {}} />);
    expect(screen.getByTestId('icone-catalogo-Wallet')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByTestId('icone-colado'), { target: { value: 'abc' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Cole um emoji só.');
    fireEvent.click(screen.getByTestId('icone-sem'));
    fireEvent.click(screen.getByTestId('cor-sem'));
    fireEvent.click(screen.getByTestId('icone-salvar'));
    await waitFor(() => expect(aoSalvar).toHaveBeenCalledWith({ icone: null, cor: null }));
  });
});

// ---------------------------------------------------------------- I3 · a árvore sem a Clientes

const V1 = '2026-10-21T10:00:00.000Z';
const GESTAO = 'a0a0a0a0-0000-4000-8000-00000000000a';
const CLIENTES = 'c0c0c0c0-0000-4000-8000-00000000000c';
const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#87909e', order, total: 0, limite: null });
const lista = (id: string, name: string, total = 0, extra: Record<string, unknown> = {}) => ({
  id, name, externalId: null, spaceId: null, order: 0, total, fields: [], natureza: 'tarefas' as const,
  statuses: [st(`${id}-a`, 'A fazer', 'open', 0), st(`${id}-f`, 'Feito', 'closed', 1)], ...extra,
});
const pasta = (id: string, name: string, lists: ReturnType<typeof lista>[], extra: Record<string, unknown> = {}) =>
  ({ id, name, order: 0, spaceId: null, parentId: null, externalId: null, lists, ...extra });
const ESTRUTURA = {
  espacos: [],
  folders: [pasta(GESTAO, 'Gestão', [lista('l-fin', 'Financeiro', 2, { icone: '💰', cor: 'good' })], { icone: 'Wallet', cor: 'info' })],
  listasSoltas: [lista('l-avulsa', 'Avulsa')],
  pastasDoComercial: [pasta(CLIENTES, 'Clientes', [lista('l-est', 'Esteira de clientes'), lista('l-onb', 'Onboarding de cliente', 1)])],
  camposGlobais: [], tags: [], responsaveis: [], agentes: [], pessoas: [],
};

describe('I3: a pasta Clientes fora do Trabalho', () => {
  beforeEach(() => {
    permissoes = ['tarefas.ver', 'tarefas.editar'];
    get.mockReset(); post.mockReset(); patch.mockReset();
    get.mockImplementation((rota: string) => {
      if (rota === '/trabalho/estrutura') return Promise.resolve({ ...ESTRUTURA });
      if (rota === '/trabalho/arquivadas') return Promise.resolve({ pastas: [], listas: [] });
      if (rota.startsWith('/trabalho/tarefas?')) return Promise.resolve({ total: 0, items: [], source: { tool: 'qa', generatedAt: V1 } });
      if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve({ itens: [] });
      if (rota.startsWith('/trabalho/implantacao')) return Promise.resolve({ cartoes: [], itens: [] });
      if (rota.startsWith('/tenants/plataforma')) return Promise.reject(new Error('não'));
      return Promise.resolve([]);
    });
    patch.mockResolvedValue({});
  });

  it('a árvore não mostra a Clientes nem as listas dela; mostra o ícone da lista e da pasta', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-avulsa');
    render(<TrabalhoPage />);
    await screen.findByTestId(`trabalho-arvore-pasta-${GESTAO}`);
    const arvore = screen.getByTestId('trabalho-arvore');
    expect(within(arvore).queryByText('Clientes')).toBeNull();
    expect(within(arvore).queryByText('Esteira de clientes')).toBeNull();
    expect(within(arvore).queryByText('Onboarding de cliente')).toBeNull();
    expect(within(screen.getByTestId('trabalho-arvore-lista-l-fin')).getByTestId('icone-da-lista')).toHaveTextContent('💰');
    expect(within(screen.getByTestId(`trabalho-arvore-pasta-${GESTAO}`)).getByTestId('icone-da-lista').getAttribute('data-icone')).toBe('Wallet');
  });

  it('"⋯" › Ícone e cor grava pelo PATCH da lista; apagar manda null', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-avulsa');
    render(<TrabalhoPage />);
    await screen.findByTestId(`trabalho-arvore-pasta-${GESTAO}`);
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-fin'));
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-fin-aparencia'));
    const dialogo = await screen.findByTestId('dialogo-de-icone');
    fireEvent.click(within(dialogo).getByTestId('icone-sem'));
    fireEvent.click(within(dialogo).getByTestId('cor-sem'));
    await act(async () => { fireEvent.click(within(dialogo).getByTestId('icone-salvar')); });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/trabalho/listas/l-fin', { icone: null, cor: null }, 'tok'));
    expect(screen.getByTestId('trabalho-arvore-aviso')).toHaveTextContent('A lista Financeiro ficou sem ícone.');
  });

  it('o link de uma lista do Comercial no Trabalho ainda abre o quadro dela (ficha, painel do lead)', async () => {
    window.history.replaceState({}, '', '/trabalho?lista=l-est');
    render(<TrabalhoPage />);
    await waitFor(() => expect(get.mock.calls.some(([r]) => typeof r === 'string' && r.startsWith('/trabalho/tarefas?') && r.includes('listId=l-est'))).toBe(true));
  });

  it('a Implantação acha a lista Onboarding de cliente em pastasDoComercial, como antes', async () => {
    CAMINHO = '/trabalho/implantacao';
    window.history.replaceState({}, '', '/trabalho/implantacao');
    render(<ImplantacaoPage />);
    await waitFor(() => expect(get.mock.calls.some(([r]) => typeof r === 'string' && r.startsWith('/trabalho/tarefas?') && r.includes('listId=l-onb'))).toBe(true));
    expect(screen.queryByTestId('implantacao-sem-lista')).toBeNull();
  });
});
