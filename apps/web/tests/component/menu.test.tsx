import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A sidebar preserva a hierarquia declarada, o acesso e a seção ativa.
 * Desde 20/10/2026 (rodada da interface, U1) as subseções de cada área moram só no menu
 * lateral: a área aberta mostra a lista delas, e o campo principal não tem mais abas.
 */

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
import { modulosDeNavegacao, rotuloDoDestino } from '@/components/navegacao-modulos';

const TODAS = ['dashboard.ver', 'tarefas.ver', 'pauta.ver', 'leads.ver', 'mcp.ver'];
const TODAS_DO_NAV = [...new Set(NAV.map((n) => n.permission))];

const link = (href: string) => document.querySelector(`a[href="${href}"]`);
/** Os links das áreas (um por área), sem as subseções da área aberta. */
const linksDasAreas = () => Array.from(document.querySelectorAll<HTMLAnchorElement>('#root-os-nav a[data-area]'));
const area = (nome: string) => linksDasAreas().find((a) => a.textContent?.trim() === nome)!;
const subsecoes = (nome: string) => within(screen.getByRole('list', { name: `Subseções de ${nome}` }));

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
    expect(gaveta).toHaveTextContent('Marketing');

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

  // Versão final (19/10/2026) e rodada da interface (20/10/2026): dez áreas na ordem das
  // SECOES, com o WhatsApp depois do Comercial e o Contexto depois da IA.
  it('mostra dez áreas, na ordem das seções, e só a área aberta mostra subseções', () => {
    PERMISSOES = TODAS_DO_NAV;
    render(<Sidebar />);
    expect(linksDasAreas().map((el) => el.textContent)).toEqual([
      'Dia a dia', 'Trabalho', 'Marketing', 'Comercial', 'WhatsApp', 'Financeiro',
      'IA e automações', 'Contexto', 'Resultados', 'Configurações',
    ]);
    // /painel é do Dia a dia (o item oculto): só ele abre; as subseções das outras áreas não aparecem.
    expect(screen.getAllByRole('list', { name: /^Subseções de / })).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'Subseções de Dia a dia' })).toBeInTheDocument();
    expect(link('/contexto/marca')).toBeNull();
    expect(link('/referencias')).toBeNull();
  });

  it('o campo principal não tem mais abas: o menu é o único lugar das subseções', () => {
    expect(existsSync(join(__dirname, '..', '..', 'src', 'components', 'NavegacaoDoModulo.tsx'))).toBe(false);
    const shell = readFileSync(join(__dirname, '..', '..', 'src', 'components', 'AppShell.tsx'), 'utf8');
    expect(shell).not.toMatch(/NavegacaoDoModulo/);
  });

  it('a logo é o link de início, com nome acessível e sem "ROOT OS" escrito', () => {
    PERMISSOES = TODAS_DO_NAV;
    render(<Sidebar />);
    const logo = screen.getByRole('link', { name: 'ROOT OS, início' });
    expect(logo).toHaveAttribute('href', '/dia-a-dia');
    expect(logo.querySelector('[data-logo-root] svg')).not.toBeNull();
    const aside = document.getElementById('root-os-nav')!;
    expect(aside.textContent).not.toMatch(/ROOT OS/);
    expect(aside.textContent?.toLowerCase()).not.toMatch(/operação root/);
    // Os textos de antes vão para o title do link.
    expect(logo).toHaveAttribute('title', 'ROOT OS · operação root');
  });

  it('a logo leva à entrada do Dia a dia que a permissão libera', () => {
    PERMISSOES = ['dashboard.ver'];
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: 'ROOT OS, início' })).toHaveAttribute('href', '/caixa');
  });

  it('Dia a dia entra na Visão geral e as subseções seguem a ordem final, sem o Painel geral', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/dia-a-dia';
    render(<Sidebar />);
    expect(area('Dia a dia')).toHaveAttribute('href', '/dia-a-dia');
    expect(area('Dia a dia')).toHaveAttribute('aria-expanded', 'true');
    const lista = subsecoes('Dia a dia');
    expect(lista.getAllByRole('link').map((el) => el.textContent)).toEqual([
      'Visão geral', 'Pendências', 'Aprovações', 'Agenda',
    ]);
    expect(lista.getByRole('link', { name: 'Visão geral' })).toHaveAttribute('aria-current', 'page');
    expect(link('/painel')).toBeNull();
  });

  it('acordeão: clicar noutra área abre o grupo dela e fecha o anterior', async () => {
    const user = userEvent.setup();
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/dia-a-dia';
    render(<Sidebar />);
    await user.click(area('Trabalho'));
    expect(screen.queryByRole('list', { name: 'Subseções de Dia a dia' })).toBeNull();
    expect(area('Dia a dia')).toHaveAttribute('aria-expanded', 'false');
    expect(area('Trabalho')).toHaveAttribute('aria-expanded', 'true');
    expect(subsecoes('Trabalho').getAllByRole('link').map((el) => el.textContent)).toEqual([
      'Tarefas', 'Todas as tarefas', 'Implantação de clientes', 'Atas',
    ]);
    expect(subsecoes('Trabalho').getByRole('link', { name: 'Todas as tarefas' })).toHaveAttribute('href', '/trabalho/todas');
  });

  it('área com uma subseção só não mostra lista: o WhatsApp é um link', async () => {
    const user = userEvent.setup();
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/whatsapp';
    render(<Sidebar />);
    expect(area('WhatsApp')).toHaveAttribute('href', '/whatsapp');
    expect(area('WhatsApp')).toHaveAttribute('aria-current', 'true');
    expect(area('WhatsApp')).not.toHaveAttribute('aria-expanded');
    expect(screen.queryByRole('list', { name: 'Subseções de WhatsApp' })).toBeNull();
    await user.click(area('WhatsApp'));
    expect(screen.queryAllByRole('list', { name: /^Subseções de / })).toHaveLength(0);
  });

  it('Comercial entra no Painel geral, na ordem final, sem Clientes, Tarefas nem o Simulador', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/comercial';
    render(<Sidebar />);
    expect(area('Comercial')).toHaveAttribute('href', '/comercial');
    const lista = subsecoes('Comercial');
    expect(lista.getAllByRole('link').map((el) => el.textContent)).toEqual([
      'Painel geral', 'Funil vivo', 'Propostas', 'Lista de leads', 'Contratos vivos',
      'Torre das automações', 'Relatório da semana',
    ]);
    expect(lista.getByRole('link', { name: 'Painel geral' })).toHaveAttribute('aria-current', 'page');
    expect(link('/comercial/simulador')).toBeNull();
    expect(link('/comercial/rodada')).toBeNull();
    expect(link('/clientes')).toBeNull();
    expect(link('/comercial/tarefas')).toBeNull();
    expect(link('/comercial/decisoes')).toBeNull();
    expect(link('/funil')).toBeNull();
  });

  it('Banco de ideias e Estratégia do mês ficam no Marketing', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/marketing/ideias';
    render(<Sidebar />);
    expect(area('Marketing')).toHaveAttribute('aria-current', 'true');
    const lista = subsecoes('Marketing');
    expect(lista.getByRole('link', { name: 'Banco de ideias' })).toHaveAttribute('aria-current', 'page');
    expect(lista.getByRole('link', { name: 'Estratégia do mês' })).toHaveAttribute('href', '/marketing/estrategia');
  });

  it('Marca é uma subseção de Contexto e seleciona a área, preservando URL', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/contexto/marca';
    render(<Sidebar />);
    expect(area('Contexto')).toHaveAttribute('aria-current', 'true');
    const lista = subsecoes('Contexto');
    expect(lista.getByRole('link', { name: 'Mapa da empresa' })).toHaveAttribute('href', '/contexto');
    expect(lista.getByRole('link', { name: 'Marca e brandbook' })).toHaveAttribute('aria-current', 'page');
  });

  it('quem só pode ver Marca entra em Contexto sem ganhar acesso ao mapa', () => {
    PERMISSOES = ['pauta.ver'];
    CAMINHO = '/contexto/marca';
    render(<Sidebar />);
    // Uma subseção só: a área é o próprio link da Marca, sem lista.
    expect(area('Contexto')).toHaveAttribute('href', '/contexto/marca');
    expect(area('Contexto')).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('link', { name: 'Mapa da empresa' })).toBeNull();
    expect(link('/contexto')).toBeNull();
  });

  it('Marca desaparece quando Pauta está desligada, sem esconder mapa permitido', () => {
    PERMISSOES = TODAS_DO_NAV;
    MODULOS_LIGADOS = ['trabalho'];
    CAMINHO = '/contexto';
    render(<Sidebar />);
    expect(area('Contexto')).toHaveAttribute('href', '/contexto');
    expect(link('/contexto/marca')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Marca e brandbook' })).toBeNull();
  });

  it('nas subrotas de custo só IA e a subseção correta ficam ativas', () => {
    CAMINHO = '/painel/custo-ia';
    render(<Sidebar />);
    expect(area('IA e automações')).toHaveAttribute('aria-current', 'true');
    expect(area('Dia a dia')).not.toHaveAttribute('aria-current');
    expect(subsecoes('IA e automações').getByRole('link', { name: 'Custos de IA' })).toHaveAttribute('aria-current', 'page');
  });

  it('a área sem o primeiro item entra pelo primeiro que a permissão libera', () => {
    // Sem tarefas.ver, Dia a dia entra em Pendências; o funil antigo do Lucas não volta ao menu.
    PERMISSOES = ['dashboard.ver'];
    CAMINHO = '/caixa';
    render(<Sidebar />);
    expect(area('Dia a dia')).toHaveAttribute('href', '/caixa');
    expect(link('/funil')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Comercial' })).toBeNull();
  });

  it('Configurações reúne conta, empresa e registros nas subseções', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/config';
    render(<Sidebar />);
    const lista = subsecoes('Configurações');
    for (const nome of ['Equipe', 'Integrações', 'Regras e permissões', 'Registro de ações', 'Atividade', 'Configurações da conta']) {
      expect(lista.getByRole('link', { name: nome })).toBeInTheDocument();
    }
    expect(link('/assinatura')).toBeNull();
  });

  it('Registros tem entrada mesmo quando nenhuma outra configuração foi liberada', () => {
    PERMISSOES = ['auditoria.ver'];
    CAMINHO = '/rastro';
    render(<Sidebar />);
    expect(area('Configurações')).toHaveAttribute('href', '/rastro');
    expect(subsecoes('Configurações').getByRole('link', { name: 'Registro de ações' })).toHaveAttribute('aria-current', 'page');
  });

  it('as preferências antigas não escondem áreas nem causam erro', () => {
    localStorage.setItem(CHAVE_MENU, '{não é json');
    render(<Sidebar />);
    expect(area('Marketing')).toBeInTheDocument();
  });

  it('/assinatura permanece fora da lateral e das subseções', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/config';
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
    // O Painel geral saiu do menu e da busca em 20/10/2026; Pendências segue.
    expect(dialogo).toHaveTextContent('Pendências');
    expect(dialogo).not.toHaveTextContent('Painel geral da empresa');
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
    expect(dialogo).toHaveTextContent('Tarefas');
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
    // 'proposta' e 'whatsapp' viraram telas na versão final (Propostas, WhatsApp).
    for (const termo of ['assinar contrato', 'nota fiscal', 'editor de processos']) {
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
    await user.type(campo, 'medição'); // palavra só do texto de apoio da seção
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
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Painel geral da empresa');
  });

  it('a Topbar de /assinatura ainda mostra o título do item oculto', () => {
    PERMISSOES = TODAS_DO_NAV;
    CAMINHO = '/assinatura';
    render(<Topbar />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Plano e assinatura');
  });
});
