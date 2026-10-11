import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('@/lib/plataforma', () => ({ useEhPlataforma: () => false }));

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
import { NavegacaoDoModulo } from '@/components/NavegacaoDoModulo';
import { modulosDeNavegacao, rotuloDoDestino } from '@/components/navegacao-modulos';

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
    expect(gaveta).toHaveTextContent('Dia a dia');
    expect(gaveta).toHaveTextContent('Trabalho');

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

  it('mostra nove áreas em vez de todos os destinos na lateral', () => {
    PERMISSOES = TODAS_DO_NAV;
    render(<Sidebar />);
    const destinos = within(screen.getByRole('navigation', { name: 'Destinos' }));
    expect(destinos.getAllByRole('link').map((el) => el.textContent)).toEqual([
      'Dia a dia', 'Contexto', 'Trabalho', 'Marketing', 'Comercial', 'Financeiro',
      'IA e automações', 'Resultados', 'Configurações',
    ]);
    expect(link('/contexto/marca')).toBeNull();
    expect(link('/referencias')).toBeNull();
  });

  it('Marca é uma aba de Contexto e seleciona o módulo, preservando URL', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/contexto/marca';
    render(<><Sidebar /><NavegacaoDoModulo /></>);
    expect(screen.getByRole('link', { name: 'Contexto' })).toHaveAttribute('aria-current', 'true');
    const abas = screen.getByRole('navigation', { name: 'Abas de Contexto' });
    expect(within(abas).getByRole('link', { name: 'Mapa da empresa' })).toHaveAttribute('href', '/contexto');
    expect(within(abas).getByRole('link', { name: 'Marca e brandbook' })).toHaveAttribute('aria-current', 'page');
  });

  it('quem só pode ver Marca entra em Contexto sem ganhar acesso ao mapa', () => {
    PERMISSOES = ['pauta.ver'];
    CAMINHO = '/contexto/marca';
    render(<><Sidebar /><NavegacaoDoModulo /></>);
    expect(screen.getByRole('link', { name: 'Contexto' })).toHaveAttribute('href', '/contexto/marca');
    expect(screen.queryByRole('link', { name: 'Mapa da empresa' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Marca e brandbook' })).toHaveAttribute('href', '/contexto/marca');
  });

  it('Marca desaparece quando Pauta está desligada, sem esconder mapa permitido', () => {
    PERMISSOES = TODAS_DO_NAV;
    MODULOS_LIGADOS = ['trabalho'];
    CAMINHO = '/contexto';
    render(<><Sidebar /><NavegacaoDoModulo /></>);
    expect(screen.getByRole('link', { name: 'Mapa da empresa' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Marca e brandbook' })).toBeNull();
  });

  it('nas subrotas de custo só IA e a aba correta ficam ativas', () => {
    CAMINHO = '/painel/custo-ia';
    render(<><Sidebar /><NavegacaoDoModulo /></>);
    expect(screen.getByRole('link', { name: 'IA e automações' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Dia a dia' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Custos de IA' })).toHaveAttribute('aria-current', 'page');
  });

  it('filho permitido continua acessível sem a permissão do pai', () => {
    PERMISSOES = ['dashboard.ver'];
    CAMINHO = '/funil';
    render(<><Sidebar /><NavegacaoDoModulo /></>);
    expect(screen.getByRole('link', { name: 'Comercial' })).toHaveAttribute('href', '/funil');
    expect(screen.getByRole('link', { name: 'Funil de vendas' })).toHaveAttribute('aria-current', 'page');
    expect(link('/leads')).toBeNull();
  });

  it('Configurações reúne conta, empresa e registros em abas distintas', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/config';
    render(<NavegacaoDoModulo />);
    const abas = screen.getByRole('navigation', { name: 'Abas de Configurações' });
    for (const nome of ['Equipe', 'Integrações', 'Regras e permissões', 'Registro de ações', 'Atividade', 'Configurações da conta']) {
      expect(within(abas).getByRole('link', { name: nome })).toBeInTheDocument();
    }
    expect(link('/assinatura')).toBeNull();
  });

  it('Registros tem entrada mesmo quando nenhuma outra configuração foi liberada', () => {
    PERMISSOES = ['auditoria.ver'];
    CAMINHO = '/rastro';
    render(<><Sidebar /><NavegacaoDoModulo /></>);
    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute('href', '/rastro');
    expect(screen.getByRole('link', { name: 'Registro de ações' })).toHaveAttribute('aria-current', 'page');
  });

  it('as preferências antigas não escondem áreas nem causam erro', () => {
    localStorage.setItem(CHAVE_MENU, '{não é json');
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: 'Trabalho' })).toBeInTheDocument();
  });

  it('/assinatura permanece fora da lateral e das abas', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/config';
    render(<><Sidebar /><NavegacaoDoModulo /></>);
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
      modulosDeNavegacao(PERMISSOES).flatMap((area) => area.itens.map(rotuloDoDestino)),
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
    for (const termo of ['proposta', 'assinar contrato', 'whatsapp', 'editor de processos']) {
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
    await user.type(campo, 'contratos'); // palavra só do texto de apoio da seção
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('a paleta busca brandbook, mantém foco dentro do diálogo e fecha com Escape no resultado', async () => {
    const user = userEvent.setup();
    const fechar = vi.fn();
    PERMISSOES = TODAS_DO_NAV;
    render(<Paleta aberto fechar={fechar} />);
    const campo = screen.getByPlaceholderText('ir para…');
    await user.type(campo, 'brandbook');
    const resultado = screen.getByRole('button', { name: /Marca e brandbook.*Contexto/ });
    await user.tab();
    expect(resultado).toHaveFocus();
    await user.tab();
    expect(campo).toHaveFocus();
    await user.tab({ shift: true });
    expect(resultado).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(fechar).toHaveBeenCalledOnce();
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
