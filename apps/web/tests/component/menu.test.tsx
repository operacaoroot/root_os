import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* A sidebar preserva a hierarquia declarada, o acesso e a seção ativa. */

let PERMISSOES: string[] = [];
let CAMINHO = '/painel';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));

let MODULOS_LIGADOS: string[] | null = null;

vi.mock('@/components/modulos', () => ({
  useModulos: () => ({
    modulos: MODULOS_LIGADOS,
    ligado: (m: string) => !MODULOS_LIGADOS || MODULOS_LIGADOS.includes(m),
  }),
}));

vi.mock('next/navigation', () => ({ usePathname: () => CAMINHO, useRouter: () => ({ push: vi.fn() }) }));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    title,
    ...resto
  }: {
    href: string;
    children: React.ReactNode;
    title?: string;
  }) => (
    <a href={href} title={title} {...resto}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line import/first
import { Sidebar, CHAVE_MENU } from '@/components/Sidebar';
// eslint-disable-next-line import/first
import { Paleta } from '@/components/Paleta';
// eslint-disable-next-line import/first
import { Topbar } from '@/components/Topbar';
// eslint-disable-next-line import/first
import { NAV } from '@mktos/shared';

const TODAS = ['dashboard.ver', 'tarefas.ver', 'pauta.ver', 'leads.ver', 'mcp.ver'];
const TODAS_DO_NAV = [...new Set(NAV.map((n) => n.permission))];

const link = (href: string) => document.querySelector(`a[href="${href}"]`);

beforeEach(() => {
  PERMISSOES = [...TODAS];
  CAMINHO = '/painel';
  MODULOS_LIGADOS = null;
  localStorage.clear();
});

describe('a barra lateral', () => {
  it('abre a gaveta móvel com nomes visíveis e fecha com Escape', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const abrir = screen.getByRole('button', { name: 'Abrir navegação' });
    expect(abrir).toHaveAttribute('aria-expanded', 'false');

    await user.click(abrir);
    expect(abrir).toHaveAttribute('aria-expanded', 'true');
    const gaveta = screen.getByRole('dialog', { name: 'Navegação do ROOT OS' });
    expect(gaveta).toHaveTextContent('Pendências');
    expect(gaveta).toHaveTextContent('Quadro interno');

    await user.keyboard('{Escape}');
    expect(abrir).toHaveAttribute('aria-expanded', 'false');
    expect(abrir).toHaveFocus();
  });

  it('bloqueia scroll do fundo e encerra o modo modal ao passar para desktop', async () => {
    const ouvintes = new Set<(e: MediaQueryListEvent) => void>();
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '(min-width: 820px)',
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => ouvintes.add(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => ouvintes.delete(fn),
    }));
    try {
      const user = userEvent.setup();
      render(<><main id="root-os-main" tabIndex={-1} /><Sidebar /></>);
      const abrir = screen.getByRole('button', { name: 'Abrir navegação' });
      await user.click(abrir);
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.overflow).toBe('hidden');
      await waitFor(() => expect(document.querySelector('#root-os-nav button[aria-label="Fechar navegação"]')).toHaveFocus());

      act(() => {
        for (const fn of ouvintes) fn({ matches: true } as MediaQueryListEvent);
      });
      expect(abrir).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.getElementById('root-os-main')).toHaveFocus();
      expect(document.body.style.overflow).toBe('');
      expect(document.documentElement.style.overflow).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('desenha Referências dentro de Produção de conteúdo, e não no topo da seção', () => {
    render(<Sidebar />);
    const trabalho = link('/pauta')!;
    const tarefas = link('/referencias')!;
    expect(trabalho).toBeInTheDocument();
    // o mesmo invólucro: é isso que faz o filho andar junto com o pai
    expect(trabalho.parentElement).toBe(tarefas.parentElement);
    // e o pai vem primeiro
    expect(trabalho.compareDocumentPosition(tarefas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fechar a seção esconde por CSS e guarda a escolha — sem apagar do DOM', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const cabecalho = screen.getByRole('button', { name: /trabalho/i });
    expect(cabecalho).toHaveAttribute('aria-expanded', 'true');

    await user.click(cabecalho);

    expect(cabecalho).toHaveAttribute('aria-expanded', 'false');
    // O item permanece no DOM para restaurar a escolha ao reabrir.
    expect(link('/trabalho')).toBeInTheDocument();
    expect(link('/trabalho')!.parentElement!.parentElement).toHaveClass('hidden');
    expect(JSON.parse(localStorage.getItem(CHAVE_MENU)!)).toContain('trabalho');
  });

  it('a seção da tela aberta ignora o fechamento guardado', () => {
    localStorage.setItem(CHAVE_MENU, JSON.stringify(['trabalho']));
    CAMINHO = '/tarefas';
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /trabalho/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('marca apenas Custos de IA quando a rota está dentro de /painel', () => {
    CAMINHO = '/painel/custo-ia';
    render(<Sidebar />);
    expect(link('/painel/custo-ia')).toHaveAttribute('aria-current', 'page');
    expect(link('/painel')).not.toHaveAttribute('aria-current');
  });

  /*
   * O caso real: `funil` pede `dashboard.ver` e o pai dele, `leads`, pede
   * `leads.ver`. Quem opera sem `leads.ver` TEM o Funil — e ele precisa
   * aparecer, no primeiro nível, e não sumir com o pai.
   */
  it('filho sem o pai aparece no primeiro nível', () => {
    PERMISSOES = ['dashboard.ver'];
    render(<Sidebar />);
    expect(link('/leads')).toBeNull();
    expect(link('/funil')).toBeInTheDocument();
  });

  it('a gaveta móvel mostra os nomes das seções novas e o filho órfão promovido', async () => {
    PERMISSOES = ['dashboard.ver'];
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const gaveta = screen.getByRole('dialog', { name: 'Navegação do ROOT OS' });
    expect(gaveta).toHaveTextContent('Motor Comercial');
    // sem leads.ver o Funil não some: sobe ao primeiro nível da seção
    const funil = gaveta.querySelector('a[href="/funil"]')!;
    expect(funil).toBeInTheDocument();
    expect(funil.className).not.toContain('pl-[28px]');
  });

  it('desenha as seções na ordem do contrato e Registros dentro de Configurações', () => {
    PERMISSOES = TODAS_DO_NAV;
    render(<Sidebar />);
    const titulos = Array.from(document.querySelectorAll('nav[aria-label="Destinos"] h2')).map((h) =>
      h.textContent?.trim(),
    );
    expect(titulos).toEqual([
      'Dia a dia', 'Contexto', 'Trabalho', 'Motor de Marketing', 'Motor Comercial',
      'Motor Financeiro', 'Motor de IA', 'Resultados', 'Configurações da empresa', 'Registros',
      'Configurações da conta',
    ]);
    const registros = screen.getByRole('button', { name: /^registros$/i });
    expect(registros.className).toContain('pl-5');
    // só as seções de apoio começam fechadas
    expect(screen.getByRole('button', { name: /configurações da empresa/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /motor de ia/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('Registros fica recuada dentro da mãe quando ela está visível', () => {
    PERMISSOES = TODAS_DO_NAV;
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /^registros$/i }).className).toContain('pl-5');
  });

  it('Registros vira seção de primeiro nível, com a divisória do apoio, quando a mãe não está visível', () => {
    PERMISSOES = ['aprovacoes.ver', 'auditoria.ver'];
    render(<Sidebar />);
    const titulos = Array.from(document.querySelectorAll('nav[aria-label="Destinos"] h2')).map((h) =>
      h.textContent?.trim(),
    );
    expect(titulos).toEqual(['Dia a dia', 'Registros']);
    const botao = screen.getByRole('button', { name: /^registros$/i });
    expect(botao.className).not.toContain('pl-5');
    expect(botao.className).toContain('px-2');
    const secao = document.querySelector('section[aria-label="Registros"]')!;
    expect(secao.querySelector('div[aria-hidden].border-t')).not.toBeNull();
  });

  it('preferência de seção fechada com chave antiga é ignorada sem erro', async () => {
    localStorage.setItem(CHAVE_MENU, JSON.stringify(['secao-que-nao-existe-mais', 'trabalho', 42]));
    const user = userEvent.setup();
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /^trabalho$/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /motor de marketing/i })).toHaveAttribute('aria-expanded', 'true');
    // o próximo clique regrava a preferência já sem a chave morta
    await user.click(screen.getByRole('button', { name: /motor de marketing/i }));
    expect(JSON.parse(localStorage.getItem(CHAVE_MENU)!)).toEqual(['trabalho', 'conteudo']);
  });

  it('JSON estragado na preferência cai no padrão, sem erro', () => {
    localStorage.setItem(CHAVE_MENU, '{não é json');
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /^trabalho$/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('/assinatura não aparece na barra, mesmo com todas as permissões', () => {
    PERMISSOES = TODAS_DO_NAV;
    render(<Sidebar />);
    expect(link('/assinatura')).toBeNull();
    expect(link('/config')).toBeInTheDocument();
  });

  it('/assinatura não aparece na paleta, e o título da Topbar continua resolvendo', () => {
    PERMISSOES = TODAS_DO_NAV;
    render(<Paleta aberto fechar={() => {}} />);
    const dialogo = screen.getByRole('dialog', { name: 'Ir para' });
    expect(dialogo).not.toHaveTextContent('Plano e assinatura');
    expect(dialogo).toHaveTextContent('Configurações da conta');
  });

  it('a paleta só lista o que as permissões e os módulos liberam, e nada sem acesso aparece como ação', async () => {
    PERMISSOES = ['dashboard.ver'];
    render(<Paleta aberto fechar={() => {}} />);
    const dialogo = screen.getByRole('dialog', { name: 'Ir para' });
    expect(dialogo).toHaveTextContent('Visão geral da empresa');
    // sem as demais permissões, nenhuma outra tela do NAV é oferecida
    const oferecidas = screen.getAllByRole('button').map((b) => b.querySelector('span')?.textContent);
    const semAcesso = NAV.filter((n) => !PERMISSOES.includes(n.permission)).map((n) => n.label);
    expect(oferecidas.filter((r) => semAcesso.includes(r ?? ''))).toEqual([]);
    expect(oferecidas).toEqual(
      NAV.filter((n) => PERMISSOES.includes(n.permission) && !n.oculto).map((n) => n.label),
    );
  });

  it('a paleta não oferece tela de módulo desligado', () => {
    PERMISSOES = TODAS_DO_NAV;
    MODULOS_LIGADOS = ['trabalho'];
    render(<Paleta aberto fechar={() => {}} />);
    const dialogo = screen.getByRole('dialog', { name: 'Ir para' });
    expect(dialogo).toHaveTextContent('Quadro interno');
    const oferecidas = screen.getAllByRole('button').map((b) => b.querySelector('span')?.textContent);
    for (const n of NAV.filter((i) => i.modulo && i.modulo !== 'trabalho')) {
      expect(oferecidas, n.key).not.toContain(n.label);
    }
  });

  it('busca por função que não existe devolve vazio, e não um item inventado', async () => {
    const user = userEvent.setup();
    PERMISSOES = TODAS_DO_NAV;
    render(<Paleta aberto fechar={() => {}} />);
    const campo = screen.getByPlaceholderText('ir para…');
    // 'whatsapp' saiu da lista: o cockpit (lane B) trouxe o "Simulador de WhatsApp" ao menu.
    for (const termo of ['proposta', 'assinar contrato', 'nota fiscal', 'editor de processos']) {
      await user.clear(campo);
      await user.type(campo, termo);
      expect(screen.queryAllByRole('button'), termo).toHaveLength(0);
      expect(screen.getByText('Nenhuma tela do menu tem esse nome.'), termo).toBeInTheDocument();
    }
  });

  it('a busca casa com o nome da tela e da seção, e marca a tela que ainda está em preparação', async () => {
    const user = userEvent.setup();
    PERMISSOES = TODAS_DO_NAV;
    render(<Paleta aberto fechar={() => {}} />);
    const campo = screen.getByPlaceholderText('ir para…');
    await user.type(campo, 'motor de ia');
    expect(screen.getByRole('button', { name: /Agentes de IA/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Processos.*em preparação/ })).toBeInTheDocument();
    await user.clear(campo);
    // 'contratos' virou tela (Contratos vivos, lane C); 'medição' segue só no texto de apoio.
    await user.type(campo, 'medição'); // palavra só do texto de apoio da seção
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('sem nenhuma permissão a paleta diz que nada está liberado', () => {
    PERMISSOES = [];
    render(<Paleta aberto fechar={() => {}} />);
    expect(screen.getByText('Nenhuma tela do menu está liberada para o seu acesso.')).toBeInTheDocument();
  });

  it('o subtítulo das telas de Marketing não herda o texto de apoio de Trabalho', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/marketing/ideias';
    render(<Topbar />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Banco de ideias');
    expect(document.body.textContent).toContain('ideias da casa antes de virar peça');
  });

  it('a Topbar de /painel usa o mesmo rótulo do menu', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/painel';
    render(<Topbar />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Visão geral da empresa');
  });

  it('a Topbar de /assinatura ainda mostra o título do item oculto', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/assinatura';
    render(<Topbar />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Plano e assinatura');
  });
});
