import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumoDoWhatsapp } from '@mktos/shared';

/*
 * O WHATSAPP NO DIA A DIA E A BOLHA DO MENU (produção 22C, W4). Dados fictícios.
 */

let RESUMO: ResumoDoWhatsapp | Error | null = null;
let PERMISSOES: string[] = ['dashboard.ver', 'tarefas.ver', 'leads.ver'];
let MODULO_LEADS = true;
const pedidos: string[] = [];

vi.mock('@/lib/plataforma', () => ({ useEhPlataforma: () => false }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pessoa de Exemplo', email: 'exemplo@exemplo.invalid', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));
vi.mock('@/components/modulos', () => ({
  useModulos: () => ({
    modulos: MODULO_LEADS ? null : ['trabalho', 'pauta'],
    ligado: (m: string) => (m === 'leads' ? MODULO_LEADS : true),
  }),
}));
vi.mock('@/components/caixa', async () => {
  const real = await vi.importActual<typeof import('@/components/caixa')>('@/components/caixa');
  return { ...real, useCaixa: () => ({ contador: null, falhou: false, carregando: false, recarregar: () => {} }) };
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/dia-a-dia',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));
// Layout 26/10: WhatsApp e Implantação entram pelo `meio` da Visão geral.
vi.mock('@/components/tarefas/VisaoGeralDasTarefas', () => ({ VisaoGeralDasTarefas: ({ meio }: { meio?: React.ReactNode }) => <div data-testid="visao-geral-tarefas">{meio}</div> }));
vi.mock('@/components/tarefas/ImplantacaoNoDiaADia', () => ({ ImplantacaoNoDiaADia: () => null }));
vi.mock('@/components/AniversariosDoDia', () => ({ AniversariosDoDia: () => null }));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      pedidos.push(caminho);
      if (caminho === '/whatsapp/resumo') {
        if (RESUMO instanceof Error) throw RESUMO;
        return RESUMO;
      }
      return null;
    }),
  };
});

import { WhatsappNoDiaADia } from '@/components/whatsapp/WhatsappNoDiaADia';
import { INTERVALO_DA_BOLHA_MS, textoDaBolha, urlDaCaixa } from '@/components/whatsapp/bolha-do-whatsapp';
import { Sidebar } from '@/components/Sidebar';
import VisaoGeralPage from '@/app/dia-a-dia/page';

function resumo(n: Partial<ResumoDoWhatsapp['naoLidas']>, semVinculo = 0): ResumoDoWhatsapp {
  const naoLidas = { leads: 0, clientes: 0, semVinculo: 0, equipe: 0, comunidade: 0, ...n, total: 0 };
  naoLidas.total = naoLidas.leads + naoLidas.clientes + naoLidas.semVinculo + naoLidas.equipe + naoLidas.comunidade;
  return { naoLidas, conversasSemVinculo: semVinculo, geradoEm: '2026-10-22T13:05:00.000Z' };
}

beforeEach(() => {
  RESUMO = null;
  PERMISSOES = ['dashboard.ver', 'tarefas.ver', 'leads.ver'];
  MODULO_LEADS = true;
  pedidos.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('as regras da bolha e do link', () => {
  it('zero, negativo e nada não desenham; acima de 99 vira 99+', () => {
    expect(textoDaBolha(0)).toBeNull();
    expect(textoDaBolha(null)).toBeNull();
    expect(textoDaBolha(-3)).toBeNull();
    expect(textoDaBolha(1)).toBe('1');
    expect(textoDaBolha(99)).toBe('99');
    expect(textoDaBolha(100)).toBe('99+');
    expect(textoDaBolha(1234)).toBe('99+');
  });

  it('cada filtro abre a caixa com o parâmetro', () => {
    expect(urlDaCaixa('leads')).toBe('/whatsapp?filtro=leads');
    expect(urlDaCaixa('clientes')).toBe('/whatsapp?filtro=clientes');
    expect(urlDaCaixa('sem_vinculo')).toBe('/whatsapp?filtro=sem_vinculo');
  });
});

describe('o cartão "WhatsApp" do Dia a dia', () => {
  it('não lidas de leads, clientes e sem vínculo, cada linha com o link do filtro, e a chamada para ligar', async () => {
    RESUMO = resumo({ leads: 3, clientes: 1, semVinculo: 2 }, 4);
    render(<WhatsappNoDiaADia token="tok" />);
    const leads = await screen.findByTestId('whatsapp-linha-leads');
    expect(leads.getAttribute('href')).toBe('/whatsapp?filtro=leads');
    expect(leads.textContent).toMatch(/Leads\s*3 não lidas/);
    const clientes = screen.getByTestId('whatsapp-linha-clientes');
    expect(clientes.getAttribute('href')).toBe('/whatsapp?filtro=clientes');
    expect(clientes.textContent).toMatch(/Clientes\s*1 não lida\b/);
    const sem = screen.getByTestId('whatsapp-linha-sem_vinculo');
    expect(sem.getAttribute('href')).toBe('/whatsapp?filtro=sem_vinculo');
    expect(sem.textContent).toMatch(/Sem vínculo\s*2 não lidas/);
    const chamada = screen.getByTestId('whatsapp-sem-vinculo-chamada');
    expect(chamada.getAttribute('href')).toBe('/whatsapp?filtro=sem_vinculo');
    expect(chamada.textContent).toContain('Conversas sem vínculo: 4');
    expect(screen.queryByTestId('whatsapp-linha-equipe')).toBeNull();
    expect(screen.getByText(/medido às 10:05/)).toBeTruthy();
    expect(pedidos).toEqual(['/whatsapp/resumo']);
  });

  it('a equipe aparece só quando tem não lida, e não deixa o cartão calmo', async () => {
    RESUMO = resumo({ equipe: 2 });
    render(<WhatsappNoDiaADia token="tok" />);
    const equipe = await screen.findByTestId('whatsapp-linha-equipe');
    expect(equipe.getAttribute('href')).toBe('/whatsapp?filtro=equipe');
    expect(screen.queryByTestId('whatsapp-nada-novo')).toBeNull();
    expect(screen.queryByTestId('whatsapp-sem-vinculo-chamada')).toBeNull();
  });

  // Layout 26/10: a comunidade é uma faixa própria, como a equipe, fora de leads, clientes e sem vínculo.
  it('a comunidade aparece só quando tem não lida, com o link do filtro, e não deixa o cartão calmo', async () => {
    RESUMO = resumo({ comunidade: 12 });
    render(<WhatsappNoDiaADia token="tok" />);
    const comunidade = await screen.findByTestId('whatsapp-linha-comunidade');
    expect(comunidade.getAttribute('href')).toBe('/whatsapp?filtro=comunidade');
    expect(comunidade.textContent).toMatch(/Comunidade\s*12 não lidas/);
    expect(screen.getByTestId('whatsapp-linha-sem_vinculo').textContent).toMatch(/Sem vínculo\s*0 não lidas/);
    expect(screen.queryByTestId('whatsapp-linha-equipe')).toBeNull();
    expect(screen.queryByTestId('whatsapp-nada-novo')).toBeNull();
  });

  it('sem comunidade com não lida, a linha não aparece', async () => {
    RESUMO = resumo({ leads: 1 });
    render(<WhatsappNoDiaADia token="tok" />);
    await screen.findByTestId('whatsapp-linha-leads');
    expect(screen.queryByTestId('whatsapp-linha-comunidade')).toBeNull();
  });

  it('tudo zero: uma linha calma, sem linhas nem chamada', async () => {
    RESUMO = resumo({});
    render(<WhatsappNoDiaADia token="tok" />);
    expect((await screen.findByTestId('whatsapp-nada-novo')).textContent).toBe('Nada novo no WhatsApp.');
    expect(screen.queryByTestId('whatsapp-linha-leads')).toBeNull();
    expect(screen.queryByTestId('whatsapp-sem-vinculo-chamada')).toBeNull();
  });

  it('só conversas sem vínculo, nenhuma não lida: mostra a chamada, não a linha calma', async () => {
    RESUMO = resumo({}, 3);
    render(<WhatsappNoDiaADia token="tok" />);
    expect((await screen.findByTestId('whatsapp-sem-vinculo-chamada')).textContent).toContain('Conversas sem vínculo: 3');
    expect(screen.queryByTestId('whatsapp-nada-novo')).toBeNull();
  });

  it('erro: o cartão diz que não carregou, com o caminho para a caixa', async () => {
    RESUMO = new Error('fora do ar');
    render(<WhatsappNoDiaADia token="tok" />);
    const erro = await screen.findByTestId('whatsapp-resumo-erro');
    expect(erro.textContent).toContain('O resumo do WhatsApp não carregou.');
    expect(erro.querySelector('a')?.getAttribute('href')).toBe('/whatsapp');
  });

  it('resposta torta conta como erro, nunca como zero', async () => {
    RESUMO = { naoLidas: null } as unknown as ResumoDoWhatsapp;
    render(<WhatsappNoDiaADia token="tok" />);
    expect(await screen.findByTestId('whatsapp-resumo-erro')).toBeTruthy();
    expect(screen.queryByTestId('whatsapp-nada-novo')).toBeNull();
  });
});

describe('o cartão na Visão geral do Dia a dia', () => {
  it('aparece com o módulo leads e leads.ver, junto das tarefas', async () => {
    RESUMO = resumo({ leads: 1 });
    render(<VisaoGeralPage />);
    expect(await screen.findByTestId('whatsapp-linha-leads')).toBeTruthy();
    expect(screen.getByTestId('visao-geral-tarefas')).toBeTruthy();
  });

  it('sem leads.ver não aparece nem pergunta', async () => {
    PERMISSOES = ['dashboard.ver', 'tarefas.ver'];
    render(<VisaoGeralPage />);
    expect(screen.getByTestId('visao-geral-tarefas')).toBeTruthy();
    expect(screen.queryByTestId('dia-a-dia-whatsapp')).toBeNull();
    expect(pedidos).not.toContain('/whatsapp/resumo');
  });

  it('sem o módulo leads não aparece nem pergunta', async () => {
    MODULO_LEADS = false;
    render(<VisaoGeralPage />);
    expect(screen.queryByTestId('dia-a-dia-whatsapp')).toBeNull();
    expect(pedidos).not.toContain('/whatsapp/resumo');
  });

  it('o erro do resumo não derruba o Dia a dia', async () => {
    RESUMO = new Error('fora do ar');
    render(<VisaoGeralPage />);
    expect(await screen.findByTestId('whatsapp-resumo-erro')).toBeTruthy();
    expect(screen.getByTestId('visao-geral-tarefas')).toBeTruthy();
  });
});

describe('a bolha de não lidas no item WhatsApp do menu', () => {
  const itemDoWhatsapp = () => document.querySelector('#root-os-nav a[data-area="whatsapp"]') as HTMLElement | null;

  it('mostra o total, com aria-label e title com o número', async () => {
    RESUMO = resumo({ leads: 3, clientes: 2, equipe: 1 });
    render(<Sidebar />);
    const bolha = await screen.findByTestId('whatsapp-bolha');
    expect(bolha.textContent).toBe('6');
    expect(bolha.getAttribute('aria-label')).toBe('6 mensagens não lidas no WhatsApp');
    expect(bolha.getAttribute('title')).toBe('6 mensagens não lidas no WhatsApp');
    expect(itemDoWhatsapp()!.contains(bolha)).toBe(true);
    expect(screen.getByLabelText('6 mensagens não lidas no WhatsApp')).toBe(bolha);
  });

  it('uma só: frase no singular', async () => {
    RESUMO = resumo({ semVinculo: 1 });
    render(<Sidebar />);
    expect((await screen.findByTestId('whatsapp-bolha')).getAttribute('aria-label')).toBe('1 mensagem não lida no WhatsApp');
  });

  it('acima de 99 escreve 99+, e o aria-label diz o número inteiro', async () => {
    RESUMO = resumo({ leads: 150 });
    render(<Sidebar />);
    const bolha = await screen.findByTestId('whatsapp-bolha');
    expect(bolha.textContent).toBe('99+');
    expect(bolha.getAttribute('aria-label')).toBe('150 mensagens não lidas no WhatsApp');
  });

  it('zero: sem bolha', async () => {
    RESUMO = resumo({});
    render(<Sidebar />);
    await waitFor(() => expect(pedidos).toContain('/whatsapp/resumo'));
    expect(itemDoWhatsapp()).toBeTruthy();
    expect(screen.queryByTestId('whatsapp-bolha')).toBeNull();
  });

  it('falha: sem bolha (não inventa número)', async () => {
    RESUMO = new Error('fora do ar');
    render(<Sidebar />);
    await waitFor(() => expect(pedidos).toContain('/whatsapp/resumo'));
    expect(screen.queryByTestId('whatsapp-bolha')).toBeNull();
  });

  it('sem leads.ver: sem item, sem bolha e sem pergunta', async () => {
    PERMISSOES = ['dashboard.ver', 'tarefas.ver'];
    RESUMO = resumo({ leads: 5 });
    render(<Sidebar />);
    await act(async () => {});
    expect(itemDoWhatsapp()).toBeNull();
    expect(screen.queryByTestId('whatsapp-bolha')).toBeNull();
    expect(pedidos).not.toContain('/whatsapp/resumo');
  });

  it('relê a cada 30 s com a aba visível, e não relê com a aba escondida', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    RESUMO = resumo({ leads: 1 });
    render(<Sidebar />);
    await act(async () => {});
    expect(pedidos.filter((p) => p === '/whatsapp/resumo')).toHaveLength(1);
    expect(screen.getByTestId('whatsapp-bolha').textContent).toBe('1');

    RESUMO = resumo({ leads: 4 });
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DA_BOLHA_MS);
    });
    expect(pedidos.filter((p) => p === '/whatsapp/resumo')).toHaveLength(2);
    expect(screen.getByTestId('whatsapp-bolha').textContent).toBe('4');

    const visivel = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DA_BOLHA_MS * 3);
    });
    expect(pedidos.filter((p) => p === '/whatsapp/resumo')).toHaveLength(2);

    // Voltar para a aba relê na hora.
    visivel.mockReturnValue('visible');
    RESUMO = resumo({ leads: 7 });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(pedidos.filter((p) => p === '/whatsapp/resumo')).toHaveLength(3);
    expect(screen.getByTestId('whatsapp-bolha').textContent).toBe('7');
    visivel.mockRestore();
  });
});
