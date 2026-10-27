/*
 * O painel do lead (lane UX): abre pela URL, a aba mora na query (trocar não
 * empilha histórico), Esc e o fundo fecham, o foco volta a quem abriu e fica
 * preso dentro, a ação dentro do painel atualiza o fio sem navegar, e as rotas
 * antigas redirecionam para a tela de fundo com o painel aberto.
 *
 * Leva 5 (L4, 27/10/2026): a primeira aba é a Geral (e o `aba=fio` de antes cai
 * nela); Fio, Dinheiro e Decisões saíram da fila mas abrem por link direto.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisaoNaFila, FichaDoLead } from '@mktos/shared';

let RESPOSTAS: Record<string, unknown> = {};
const posts: { caminho: string; corpo: unknown }[] = [];
const gets: string[] = [];
let AO_POSTAR: ((caminho: string) => void) | null = null;
const redirecionado = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => true }) }));
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: (url: string) => redirecionado(url),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
// O Histórico (AuditLog) é do agente do L2: aqui um dublê que só diz se está aberto.
vi.mock('@/app/comercial/_painel/historico', () => ({
  HistoricoDaEntidade: ({ aberto, entityId }: { aberto: boolean; entityId: string }) => (aberto ? <div data-testid="historico-dublê">histórico de {entityId}</div> : null),
  TIPO_DA_ENTIDADE_DO_LEAD: 'lead',
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      gets.push(caminho);
      const chave = Object.keys(RESPOSTAS).sort((a, b) => b.length - a.length).find((k) => caminho.startsWith(k));
      const r = chave ? RESPOSTAS[chave] : undefined;
      if (r instanceof Error) throw r;
      if (r === undefined) throw new real.ErroDaApi('não encontrado', 404);
      return typeof r === 'function' ? (r as () => unknown)() : r;
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      AO_POSTAR?.(caminho);
      return {};
    }),
  };
});

import { ProvedorDoPainel, LinkDoLead } from '@/app/comercial/_painel/provedor';
import FioAntigo from '@/app/comercial/lead/[id]/page';
import SessaoAntiga from '@/app/comercial/lead/[id]/sessao/page';
import FechamentoAntigo from '@/app/comercial/lead/[id]/fechamento/page';
import ContratoAntigo from '@/app/comercial/contratos/[leadId]/page';
import FunilPage from '@/app/comercial/funil/page';
import { useCarregar } from '@/app/comercial/_ui';

function ficha(fio: FichaDoLead['fio'] = []): FichaDoLead {
  return {
    leadId: 'l1', nome: 'Marina Duarte', telefone: '(32) 99999-0001', email: null, empresa: 'Construtora Alicerce', cnpj: null, canal: null, origemIndicacao: null,
    perfil: 'P2', pontuacao: 70, sistemaErp: 'Omie', baseDados: true, dono: { id: 'u1', nome: 'Mesa' }, socioDaConta: null, produto: 'operacao',
    valorCentavos: 1_199_700, parcelas: 3, forma: 'pix', validade: null, propostaVersao: 1, etapa: 'follow_up', etapaDesde: '2026-10-12T13:00:00.000Z',
    motivoSaida: null, voltaEm: null, saude: null, proximaAcao: null, proximasAcoesAutomaticas: [],
    portao: { proxima: 'contrato', faltando: ['aceite'], itens: [{ chave: 'aceite', rotulo: 'aceite na sala', cumprido: false }] },
    ligadoA: { sala: 'x', ata: true, proposta: 1, contrato: null, cobranca: null },
    fio,
  };
}

const linha = (type: string, resumo: string, em = '2026-10-13T13:00:00.000Z') => ({ eventoId: `${type}-${em}`, type, fonte: 'sistema' as const, resumo, em, dia: 2 });

const decisao: DecisaoNaFila = {
  id: 'd1', leadId: 'l1', leadNome: 'Construtora Alicerce', tipo: 'pedido_de_ajuste', titulo: 'Construtora Alicerce pediu 8% de desconto', contexto: 'Leu a proposta 3 vezes.',
  opcoes: [{ chave: 'desconto:8', rotulo: 'Aprovar 8%' }, { chave: 'manter', rotulo: 'Manter o preço', efeito: 'nada muda' }],
  padrao: 'manter', expiraEm: new Date(Date.now() + 4 * 3600_000).toISOString(), criadaEm: new Date().toISOString(),
  estado: 'aberta', escolha: null, decididoPor: null, canal: null,
};

function irPara(url: string) {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  RESPOSTAS = {
    '/comercial/lead/l1/sessao': { diagnostico: null, leitorDeAta: [], proposta: null, versoes: [] },
    // Leva 5 (L4): o extra da Geral e as pendências.
    '/comercial/lead/l1/geral': { leadId: 'l1', tipoDePessoa: null, preferenciasDeAtendimento: null, parcelaCentavos: null, proposta: { origem: 'sala', link: null, ref: null, versao: 1 }, negocioTravado: false },
    '/comercial/lead/l1/pendencias': { leadId: 'l1', etapa: 'follow_up', passos: [], feitos: 0, geradoEm: '2026-10-13T13:00:00.000Z' },
    '/comercial/lead/l1': ficha([linha('whats.recebida', 'oi, quero saber da Operação ROOT', '2026-10-12T13:00:00.000Z')]),
    '/comercial/decisoes': [decisao],
    '/comercial/fechamentos/l1': { chave: '', versao: 0, estado: 'pendente', iniciadoEm: null, concluidoEm: null, escritas: [], copiadoSemRedigitar: [], aprovacao: null, vetado: false },
    '/comercial/contratos/l1': { leadId: 'l1', cliente: 'Construtora Alicerce', produto: null, valorCentavos: null, descontoPct: null, parcelas: [], reguaDeCobranca: [], entregas: [], primeiroValorEm: null, saude: null, faseDaImplantacao: null, marcos: [], aditivos: null },
  };
  posts.length = 0;
  gets.length = 0;
  redirecionado.mockClear();
  AO_POSTAR = null;
  irPara('/comercial/funil?filtro=parados');
});

afterEach(() => {
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

function Fundo() {
  return (
    <main id="root-os-main" tabIndex={-1}>
      <p>a tela de trás</p>
      <LinkDoLead leadId="l1" aba="decisoes">abrir a Alicerce</LinkDoLead>
      <LinkDoLead leadId="l1" aba="sessao">abrir a sessão</LinkDoLead>
    </main>
  );
}

describe('painel do lead', () => {
  it('abre pela URL com o nome do lead, a aba certa e a página de trás travada', async () => {
    irPara('/comercial/funil?lead=l1&aba=sessao');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const dialogo = await screen.findByRole('dialog', { name: 'Construtora Alicerce' });
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(within(dialogo).getByRole('tab', { name: 'Sessão' })).toHaveAttribute('aria-selected', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByText('a tela de trás')).toBeInTheDocument(); // o fundo continua lá
    expect(within(dialogo).getByText('E7 · Follow-up')).toBeInTheDocument(); // o chip da etapa no cabeçalho
  });

  it('abrir por clique empilha UMA entrada, trocar de aba substitui, e a URL só muda na query', async () => {
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const antes = window.history.length;
    const link = await screen.findByRole('link', { name: 'abrir a Alicerce' });
    expect(link).toHaveAttribute('href', '/comercial/funil?filtro=parados&lead=l1&aba=decisoes');
    await u.click(link);
    const dialogo = await screen.findByRole('dialog', { name: 'Construtora Alicerce' });
    expect(window.location.pathname).toBe('/comercial/funil');
    expect(window.location.search).toBe('?filtro=parados&lead=l1&aba=decisoes');
    expect(window.history.length).toBe(antes + 1);
    // A aba antiga (Decisões) aberta por link fica no fim da fila; a Geral é a primeira.
    expect(within(dialogo).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Geral', 'Pendências e sugestões', 'Sala', 'WhatsApp', 'Decisões1']);
    await u.click(within(dialogo).getByRole('tab', { name: 'Pendências e sugestões' }));
    expect(window.location.search).toBe('?filtro=parados&lead=l1&aba=pendencias');
    expect(window.history.length).toBe(antes + 1);
    expect(within(dialogo).getByRole('tab', { name: 'Pendências e sugestões' })).toHaveAttribute('aria-selected', 'true');
    // Fora da fila, a Decisões some quando a pessoa sai dela.
    expect(within(dialogo).queryByRole('tab', { name: /Decisões/ })).toBeNull();
  });

  it('Esc fecha, o foco volta ao link que abriu e o filtro fica na URL', async () => {
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const link = await screen.findByRole('link', { name: 'abrir a Alicerce' });
    await u.click(link);
    const dialogo = await screen.findByRole('dialog');
    await waitFor(() => expect(dialogo.contains(document.activeElement)).toBe(true)); // o foco entrou no painel
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(window.location.search).toBe('?filtro=parados'));
    expect(document.activeElement).toBe(link);
    expect(document.body.style.overflow).toBe('');
  });

  it('o clique no fundo fecha; com texto digitado e não salvo, pede confirmação antes', async () => {
    irPara('/comercial/funil?lead=l1&aba=sessao');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    await screen.findByRole('dialog');
    const ata = await screen.findByPlaceholderText(/transcrição da conversa/);
    await u.type(ata, 'texto que ninguém salvou');
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fundo = document.querySelector('[data-fundo-do-painel]') as HTMLElement;
    await u.pointer({ keys: '[MouseLeft>]', target: fundo });
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    confirmar.mockReturnValue(true);
    await u.pointer({ keys: '[MouseLeft>]', target: fundo });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.search).toBe(''); // aberto pela URL: fechar só limpa a query
  });

  it('sem texto digitado, o fundo fecha sem perguntar', async () => {
    irPara('/comercial/funil?lead=l1&aba=fio');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    await screen.findByRole('dialog');
    const confirmar = vi.spyOn(window, 'confirm');
    await u.pointer({ keys: '[MouseLeft>]', target: document.querySelector('[data-fundo-do-painel]') as HTMLElement });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('o foco fica preso: Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último', async () => {
    irPara('/comercial/funil?lead=l1&aba=geral');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const dialogo = await screen.findByRole('dialog');
    await within(dialogo).findByTestId('ficha-cartao-quem');
    const fechar = within(dialogo).getByRole('button', { name: 'fechar o painel do lead' });
    const focaveis = Array.from(dialogo.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.tabIndex >= 0);
    const ultimo = focaveis[focaveis.length - 1];
    ultimo.focus();
    await u.tab();
    expect(document.activeElement).toBe(focaveis[0]);
    expect(focaveis[0]).toBe(fechar);
    await u.tab({ shift: true });
    expect(document.activeElement).toBe(ultimo);
  });

  it('decidir dentro do painel atualiza o fio e as decisões sem navegar, com o aviso no canto', async () => {
    irPara('/comercial/funil?lead=l1&aba=decisoes');
    // Leva 5: o fio resumido mora na variante B da Geral (a linha do tempo); o inteiro, no Histórico.
    window.localStorage.setItem('painel.variante', 'B');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const dialogo = await screen.findByRole('dialog');
    const caminho = window.location.pathname;
    // Depois da resposta, a API devolve a decisão tomada e o fio com a linha nova.
    AO_POSTAR = () => {
      RESPOSTAS['/comercial/decisoes'] = [{ ...decisao, estado: 'tomada', escolha: 'manter', decididoPor: 'Mesa' }];
      RESPOSTAS['/comercial/lead/l1'] = ficha([
        linha('whats.recebida', 'oi, quero saber da Operação ROOT', '2026-10-12T13:00:00.000Z'),
        linha('decisao.tomada', 'decisão tomada: manter o preço', '2026-10-13T14:00:00.000Z'),
      ]);
    };
    const leiturasAntes = gets.filter((g) => g === '/comercial/lead/l1').length;
    await u.click(await within(dialogo).findByRole('button', { name: /Manter o preço/ }));
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/decisoes/d1/responder', corpo: { escolha: 'manter' } }]));
    await waitFor(() => expect(gets.filter((g) => g === '/comercial/lead/l1').length).toBe(leiturasAntes + 1)); // relê o lead, uma chamada
    // O aviso aparece no canto com o efeito escrito pela API.
    expect(await screen.findByText('Respondido: Manter o preço. Nada muda.')).toBeInTheDocument();
    await waitFor(() => expect(within(dialogo).queryByRole('button', { name: /Manter o preço/ })).toBeNull());
    await u.click(within(dialogo).getByRole('tab', { name: 'Geral' }));
    const linhaDoTempo = await within(dialogo).findByTestId('ficha-linha-do-tempo');
    expect(await within(linhaDoTempo).findByText('decisão tomada: manter o preço')).toBeInTheDocument();
    expect(window.location.pathname).toBe(caminho);
    expect(window.location.search).toBe('?lead=l1&aba=geral');
    // "ver tudo" abre o Histórico (o AuditLog do lead).
    await u.click(within(linhaDoTempo).getByTestId('ficha-ver-tudo'));
    expect(await screen.findByTestId('historico-dublê')).toHaveTextContent('histórico de l1');
    window.localStorage.removeItem('painel.variante');
  });

  it('o voltar do navegador fecha o painel aberto por clique', async () => {
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('link', { name: 'abrir a Alicerce' }));
    await screen.findByRole('dialog');
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('o texto digitado não se perde calado (revisão da lane UX)', () => {
  it('trocar de aba com a ata digitada pergunta; recusado, fica na aba', async () => {
    irPara('/comercial/funil?lead=l1&aba=sessao');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const dialogo = await screen.findByRole('dialog');
    await u.type(await within(dialogo).findByPlaceholderText(/transcrição da conversa/), 'ata pela metade');
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await u.click(within(dialogo).getByRole('tab', { name: 'Geral' }));
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(within(dialogo).getByRole('tab', { name: 'Sessão' })).toHaveAttribute('aria-selected', 'true');
    expect(window.location.search).toBe('?lead=l1&aba=sessao');
  });

  it('o voltar do navegador com texto digitado pergunta; recusado, o painel continua aberto', async () => {
    irPara('/comercial/funil');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('link', { name: 'abrir a sessão' }));
    const dialogo = await screen.findByRole('dialog');
    await u.type(await within(dialogo).findByPlaceholderText(/transcrição da conversa/), 'ata pela metade');
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(confirmar).toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(window.location.search).toBe('?lead=l1&aba=sessao');
  });

  it('dentro do painel as seções são h3: o nome do lead é o único h2', async () => {
    irPara('/comercial/funil?lead=l1&aba=geral');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const dialogo = await screen.findByRole('dialog', { name: 'Construtora Alicerce' });
    await within(dialogo).findByTestId('ficha-cartao-quem');
    expect(within(dialogo).getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(within(dialogo).getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
  });
});

describe('useCarregar: só o pedido mais recente escreve (revisão da lane UX, achado 5)', () => {
  it('o tique que saiu antes e voltou depois da releitura não põe o estado velho de volta', async () => {
    let soltarVelho!: (v: unknown) => void;
    const respostas = [new Promise((r) => { soltarVelho = r; }), Promise.resolve({ v: 'novo' })];
    RESPOSTAS['/teste/ordem'] = () => respostas.shift();
    let recarregar!: () => Promise<void>;
    function Sonda() {
      const c = useCarregar<{ v: string }>('/teste/ordem');
      recarregar = c.recarregar;
      return <p>valor: {c.dados?.v ?? 'nada'}</p>;
    }
    render(<Sonda />);
    await waitFor(() => expect(gets.filter((g) => g === '/teste/ordem')).toHaveLength(1)); // o primeiro (velho) está no ar
    await act(async () => { await recarregar(); }); // a releitura depois da ação volta primeiro
    expect(screen.getByText('valor: novo')).toBeInTheDocument();
    await act(async () => { soltarVelho({ v: 'velho' }); await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByText('valor: novo')).toBeInTheDocument();
  });
});

describe('o funil abre o painel pelo teclado', () => {
  const cartao = (leadId: string, nome: string) => ({
    leadId, nome, empresa: null, etapa: 'follow_up' as const, saude: null, proximaAcao: null, precisaDeDecisao: false,
    parado: false, diasNaEtapa: 0, motivoSaida: null, voltaEm: null, perfil: null, produto: null,
  });

  it('setas andam entre os cartões e Enter abre o painel na aba Geral', async () => {
    irPara('/comercial/funil');
    RESPOSTAS['/comercial/funil'] = { colunas: [{ etapa: 'follow_up', rotulo: 'Follow-up', cartoes: [cartao('l0', 'Lead Zero'), cartao('l1', 'Construtora Alicerce')] }] };
    render(<ProvedorDoPainel><FunilPage /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const primeiro = await screen.findByRole('link', { name: /Lead Zero/ });
    primeiro.focus();
    await u.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveTextContent('Construtora Alicerce');
    await u.keyboard('{Enter}');
    const dialogo = await screen.findByRole('dialog', { name: 'Construtora Alicerce' });
    expect(within(dialogo).getByRole('tab', { name: 'Geral' })).toHaveAttribute('aria-selected', 'true');
    expect(window.location.search).toBe('?lead=l1&aba=geral');
  });
});

describe('rotas antigas do lead redirecionam para o painel (nada de 404)', () => {
  it.each([
    ['fio', FioAntigo, { id: 'l1' }, '/comercial/funil?lead=l1&aba=geral'],
    ['sessão', SessaoAntiga, { id: 'l1' }, '/comercial/funil?lead=l1&aba=sessao'],
    ['fechamento', FechamentoAntigo, { id: 'l1' }, '/comercial/funil?lead=l1&aba=dinheiro'],
    ['contrato vivo', ContratoAntigo, { leadId: 'l1' }, '/comercial/contratos?lead=l1&aba=dinheiro'],
  ] as const)('%s', async (_nome, Pagina, params, destino) => {
    await expect((Pagina as (p: { params: Promise<unknown> }) => Promise<void>)({ params: Promise.resolve(params) })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirecionado).toHaveBeenCalledWith(destino);
  });
});
