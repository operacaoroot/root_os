/*
 * O FUNIL VIVO QUE SE MOVE (rodada do painel P5, 18/10/2026).
 *
 * Mover pelo menu e pelo arraste vira PEDIDO (a mudança de etapa é escrita
 * sensível); concluir manda o token de uso único no cabeçalho. Etapas de
 * sistema e voltar aparecem desligadas com o porquê. A coluna "Saídas" e as
 * saídas do menu levam ao registro de saída, com motivo. O balão persistente,
 * os chips que levam até a coluna e as etiquetas com explicação acessível.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMERCIAL_ETAPAS, COMERCIAL_FILTROS_DO_FUNIL, type CartaoDoFunil, type FunilVivo } from '@mktos/shared';

let RESPOSTAS: Record<string, unknown> = {};
const posts: { caminho: string; corpo: unknown }[] = [];
let RESPOSTA_DO_POST: (caminho: string) => unknown = () => ({});

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => true }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/comercial/funil', useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      const chave = Object.keys(RESPOSTAS).find((k) => caminho.startsWith(k));
      return chave ? RESPOSTAS[chave] : undefined;
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      const r = RESPOSTA_DO_POST(caminho);
      if (r instanceof Error) throw r;
      return r;
    }),
  };
});

import FunilPage from '@/app/comercial/funil/page';

const cartao = (leadId: string, nome: string, etapa: CartaoDoFunil['etapa'], extra: Partial<CartaoDoFunil> = {}): CartaoDoFunil => ({
  leadId, nome, empresa: null, etapa, saude: null, proximaAcao: null, precisaDeDecisao: false,
  parado: false, diasNaEtapa: 0, motivoSaida: null, voltaEm: null, perfil: null, produto: null, voltaPara: null, balao: null, ...extra,
});

function funil(...cartoes: CartaoDoFunil[]): FunilVivo {
  return {
    colunas: [
      ...COMERCIAL_ETAPAS.map((e) => ({ etapa: e, rotulo: e, cartoes: cartoes.filter((c) => c.etapa === e) })),
      { etapa: 'saidas' as const, rotulo: 'Saídas', cartoes: cartoes.filter((c) => ['desqualificado', 'geladeira', 'perdido', 'parceiro'].includes(c.etapa)) },
    ],
  };
}

const PEDIDO = (para: string, pendencias: string[] = []) => ({
  approvalId: 'ap-1', token: 'token-de-uso-unico', expiraEm: new Date(Date.now() + 600_000).toISOString(), de: 'novo_lead', para, pendencias, resumo: 'Mover',
});

/** Um DataTransfer de mentira: o jsdom não tem. */
function dataTransfer() {
  const dados: Record<string, string> = {};
  return { setData: (t: string, v: string) => { dados[t] = v; }, getData: (t: string) => dados[t] ?? '', effectAllowed: 'all', dropEffect: 'none' };
}

const fetchMock = vi.fn();

beforeEach(() => {
  RESPOSTAS = {};
  posts.length = 0;
  RESPOSTA_DO_POST = () => ({});
  window.sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('mover pelo menu', () => {
  it('as etapas de sistema e voltar aparecem desligadas com o porquê; a saída avisa que pede motivo', async () => {
    RESPOSTAS['/comercial/funil'] = funil(cartao('a', 'Construtora Alicerce', 'reuniao_agendada'));
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    const menu = screen.getByRole('menu', { name: /Mover Construtora Alicerce para/ });
    expect(within(menu).getByTestId('funil-mover-para-contrato')).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByTestId('funil-mover-para-contrato')).toHaveAccessibleDescription(/entra sozinho quando o cliente aceita a proposta na sala/);
    expect(within(menu).getByTestId('funil-mover-para-fechado')).toHaveAccessibleDescription(/fecha sozinho quando a 1ª parcela é paga/);
    expect(within(menu).getByTestId('funil-mover-para-novo_lead')).toHaveAccessibleDescription(/não é avanço: registre uma saída com motivo/);
    expect(within(menu).getByTestId('funil-mover-para-proposta')).toHaveAttribute('aria-disabled', 'false');
    expect(within(menu).getByTestId('funil-mover-para-perdido')).toHaveTextContent('pede motivo');
    // Clicar na desligada não pede nada.
    await u.click(within(menu).getByTestId('funil-mover-para-contrato'));
    expect(posts).toHaveLength(0);
    // Esc fecha e devolve o foco ao botão.
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('funil-mover-a')).toHaveFocus();
  });

  it('escolher pede a mudança, mostra o que ainda não foi feito, e concluir manda o token no cabeçalho', async () => {
    RESPOSTAS['/comercial/funil'] = funil(cartao('a', 'Construtora Alicerce', 'novo_lead'));
    RESPOSTA_DO_POST = () => PEDIDO('reuniao_agendada', ['dono do lead (E1)', 'sistema ou ERP em uso (E2)']);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    await u.click(screen.getByTestId('funil-mover-para-reuniao_agendada'));
    expect(posts).toEqual([{ caminho: '/comercial/lead/a/mover/pedido', corpo: { para: 'reuniao_agendada' } }]);
    const pedido = await screen.findByTestId('funil-pedido-a');
    expect(pedido).toHaveTextContent('Vai mover, mas ainda não foi feito: dono do lead (E1); sistema ou ERP em uso (E2).');
    expect(within(pedido).getByRole('link', { name: '/atendimento' })).toHaveAttribute('href', '/atendimento');
    // Enquanto o pedido espera, o mesmo cartão não pede outra mudança.
    expect(screen.getByTestId('funil-mover-a')).toBeDisabled();

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, mudou: true, de: 'novo_lead', para: 'reuniao_agendada', balao: { pendencias: ['dono do lead (E1)'], movidoPor: 'Sócia', em: new Date().toISOString() } }) });
    await u.click(within(pedido).getByRole('button', { name: 'concluir a mudança' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/comercial\/lead\/a\/mover$/);
    expect((init.headers as Record<string, string>)['x-approval-token']).toBe('token-de-uso-unico');
    expect(JSON.parse(String(init.body))).toEqual({ para: 'reuniao_agendada' });
    expect(await screen.findByText('Movido para E3, com pendências.')).toBeInTheDocument();
    expect(screen.queryByTestId('funil-pedido-a')).toBeNull();
    expect(window.sessionStorage.getItem('comercial.mover.a')).toBeNull();
  });

  it('sem a assinatura ainda, concluir avisa e o pedido fica de pé (inclusive depois de recarregar a tela)', async () => {
    RESPOSTAS['/comercial/funil'] = funil(cartao('a', 'Lead A', 'novo_lead'));
    RESPOSTA_DO_POST = () => PEDIDO('qualificacao');
    const { unmount } = render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    await u.click(screen.getByTestId('funil-mover-para-qualificacao'));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ message: 'Aprovação não confirmada pelo humano.' }) });
    await u.click(await screen.findByRole('button', { name: 'concluir a mudança' }));
    expect(await screen.findByText(/A assinatura ainda não veio/)).toBeInTheDocument();
    unmount();
    render(<FunilPage />);
    expect(await screen.findByTestId('funil-pedido-a')).toHaveTextContent('para E2');
  });
});

describe('mover pelo arraste', () => {
  it('soltar numa etapa adiante pede a mudança; soltar no E8 avisa por quê e não pede nada', async () => {
    RESPOSTAS['/comercial/funil'] = funil(cartao('a', 'Lead A', 'novo_lead'));
    RESPOSTA_DO_POST = () => PEDIDO('qualificacao');
    render(<FunilPage />);
    const card = await screen.findByTestId('funil-card-a');
    expect(card).toHaveAttribute('draggable', 'true');

    let dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId('funil-coluna-contrato'), { dataTransfer: dt });
    expect(await screen.findByText(/não aceita: entra sozinho quando o cliente aceita/)).toBeInTheDocument();
    fireEvent.drop(screen.getByTestId('funil-coluna-contrato'), { dataTransfer: dt });
    expect(await screen.findByText(/E8 não aceita este cartão: entra sozinho/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);

    dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId('funil-coluna-qualificacao'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('funil-coluna-qualificacao'), { dataTransfer: dt });
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/lead/a/mover/pedido', corpo: { para: 'qualificacao' } }]));
    expect(await screen.findByTestId('funil-pedido-a')).toBeInTheDocument();
  });

  it('soltar em Saídas abre o registro de saída: o motivo é obrigatório e vai pela rota de saída', async () => {
    RESPOSTAS['/comercial/funil'] = funil(cartao('a', 'Lead A', 'proposta'));
    render(<FunilPage />);
    const card = await screen.findByTestId('funil-card-a');
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('funil-coluna-saidas'), { dataTransfer: dt });
    const form = await screen.findByTestId('funil-saida-a');
    const u = userEvent.setup();
    const registrar = within(form).getByRole('button', { name: 'registrar saída' });
    expect(registrar).toBeDisabled();
    const [qual, motivo] = within(form).getAllByRole('combobox');
    await u.selectOptions(qual, 'perdido');
    expect(registrar).toBeDisabled();
    await u.selectOptions(motivo, 'preco');
    await u.click(registrar);
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/lead/a/saida', corpo: { saida: 'perdido', motivo: 'preco' } }]));
    expect(await screen.findByText('Saída registrada.')).toBeInTheDocument();
  });
});

describe('o balão, os chips e as etiquetas', () => {
  it('o cartão movido com pendência mostra o balão com a lista e quem moveu', async () => {
    RESPOSTAS['/comercial/funil'] = funil(
      cartao('a', 'Lead A', 'reuniao_agendada', { balao: { pendencias: ['dono do lead (E1)', 'sistema ou ERP em uso (E2)'], movidoPor: 'Sócia da conta', em: '2026-10-18T15:00:00.000Z' } }),
      cartao('b', 'Lead B', 'reuniao_agendada'),
    );
    render(<FunilPage />);
    const balao = await screen.findByTestId('funil-balao-a');
    expect(balao).toHaveTextContent('movido com pendências');
    expect(balao).toHaveTextContent('dono do lead (E1); sistema ou ERP em uso (E2)');
    expect(balao).toHaveTextContent('por Sócia da conta');
    expect(screen.queryByTestId('funil-balao-b')).toBeNull();
  });

  it('os chips contam cada etapa; clicar rola até a coluna e põe o foco no cabeçalho dela', async () => {
    RESPOSTAS['/comercial/funil'] = funil(cartao('a', 'Lead A', 'proposta'), cartao('b', 'Lead B', 'proposta'), cartao('c', 'Lead C', 'perdido'));
    const rolar = vi.fn();
    Element.prototype.scrollIntoView = rolar;
    render(<FunilPage />);
    const chip = await screen.findByTestId('funil-chip-proposta');
    expect(chip).toHaveAccessibleName('E6 · Proposta: 2 leads. Ir para a coluna');
    expect(screen.getByTestId('funil-chip-saidas')).toHaveTextContent('1');
    expect(screen.getAllByTestId(/^funil-chip-/)).toHaveLength(COMERCIAL_ETAPAS.length + 1);
    await userEvent.setup().click(chip);
    const coluna = screen.getByTestId('funil-coluna-proposta');
    expect(rolar).toHaveBeenCalledTimes(1);
    expect(rolar.mock.contexts[0]).toBe(coluna);
    expect(document.activeElement).toBe(within(coluna).getByRole('heading', { name: /E6 · Proposta/ }));
  });

  it('cada etiqueta de filtro tem a explicação do shared como descrição acessível, também no foco', async () => {
    RESPOSTAS['/comercial/funil'] = funil();
    render(<FunilPage />);
    for (const f of COMERCIAL_FILTROS_DO_FUNIL) {
      const etiqueta = await screen.findByTestId(`funil-etiqueta-${f.chave}`);
      expect(etiqueta).toHaveAccessibleDescription(f.explicacao);
      expect(document.getElementById(`funil-etiqueta-dica-${f.chave}`)).toHaveAttribute('role', 'tooltip');
    }
    screen.getByTestId('funil-etiqueta-parados').focus();
    expect(screen.getByTestId('funil-etiqueta-parados')).toHaveAccessibleDescription(/limite de "lead parado"/);
  });
});
