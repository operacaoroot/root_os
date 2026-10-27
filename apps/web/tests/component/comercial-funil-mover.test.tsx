/*
 * O FUNIL VIVO QUE SE MOVE SEM LIMITAÇÃO (rodada da interface U4, 20/10/2026).
 *
 * Substitui a suíte da rodada do painel (P5), que media o pedido e a
 * assinatura. Agora: mover pelo menu e pelo arraste grava direto (POST
 * /comercial/lead/:id/mover, sem token) e a tela diz só a mensagem da API, com
 * e sem as conclusões que ficaram para trás. Todas as etapas valem, menos a de
 * agora; E8 e E9 dizem o que o mover à mão não faz. A saída abre o motivo num
 * campo de texto, sem trava. Os chips das etapas saíram; ficam a rolagem das
 * colunas e o teclado. No cabeçalho, [Vistas] [Filtros (n)] com o responsável
 * primeiro e no endereço, e a troca Quadro · Lista.
 *
 * Leva 5 (L5, 27/10/2026): o cartão anda na hora e volta se a API negar; a
 * coluna não recarrega inteira; E8 e E9 pedem a confirmação com o aviso da regra
 * (no arrasto e no menu). Leva 5 (L2): o botão direito no cartão abre o menu do lead.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMERCIAL_ETAPAS, type CartaoDoFunil, type FunilVivo } from '@mktos/shared';

let RESPOSTAS: Record<string, unknown> = {};
const gets: string[] = [];
const posts: { caminho: string; corpo: unknown }[] = [];
let RESPOSTA_DO_POST: (caminho: string, corpo: unknown) => unknown = () => ({});
let PERMISSOES: string[] | null = null;

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: (p: string) => PERMISSOES === null || PERMISSOES.includes(p) }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/comercial/funil', useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
// O Histórico (AuditLog) é do agente do L2: aqui um dublê.
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
      if (!chave) throw new real.ErroDaApi('não encontrado', 404);
      return RESPOSTAS[chave];
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      const r = RESPOSTA_DO_POST(caminho, corpo);
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

function funil(cartoes: CartaoDoFunil[], extra: Partial<FunilVivo> = {}): FunilVivo {
  return {
    colunas: [
      ...COMERCIAL_ETAPAS.map((e) => ({ etapa: e, rotulo: e, cartoes: cartoes.filter((c) => c.etapa === e) })),
      { etapa: 'saidas' as const, rotulo: 'Saídas', cartoes: cartoes.filter((c) => ['desqualificado', 'geladeira', 'perdido', 'parceiro'].includes(c.etapa)) },
    ],
    ...extra,
  };
}

const MOVIDO = (para: string, mensagem: string, pendencias: string[] = []) => ({
  ok: true, mudou: true, de: 'novo_lead', para, balao: null, pendencias, semConclusoesDe: [], mensagem, aviso: null,
});

/** Um DataTransfer de mentira: o jsdom não tem. */
function dataTransfer() {
  const dados: Record<string, string> = {};
  return { setData: (t: string, v: string) => { dados[t] = v; }, getData: (t: string) => dados[t] ?? '', effectAllowed: 'all', dropEffect: 'none' };
}

function irPara(url: string) {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  // Layout 26/10: estes testes conferem o card inteiro (avisos por extenso), que é a densidade "cheio".
  window.localStorage.setItem('root-os:trabalho:densidade', 'cheio');
  RESPOSTAS = {};
  gets.length = 0;
  posts.length = 0;
  RESPOSTA_DO_POST = () => ({});
  PERMISSOES = null;
  irPara('/comercial/funil');
});
afterEach(() => cleanup());

describe('mover sem limitação, pelo menu', () => {
  it('todas as etapas valem, menos a de agora; E8 e E9 dizem o que o mover à mão não faz; a saída avisa que pede motivo', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Construtora Alicerce', 'reuniao_agendada')]);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    const menu = screen.getByRole('menu', { name: /Mover Construtora Alicerce para/ });
    expect(within(menu).queryByTestId('funil-mover-para-reuniao_agendada')).toBeNull();
    for (const item of within(menu).getAllByRole('menuitem')) expect(item).toHaveAttribute('aria-disabled', 'false');
    expect(within(menu).getByTestId('funil-mover-para-novo_lead')).toHaveAttribute('aria-disabled', 'false');
    expect(within(menu).getByTestId('funil-mover-para-contrato')).toHaveAccessibleDescription(/só a etapa muda: o contrato e a cobrança nascem do aceite/);
    expect(within(menu).getByTestId('funil-mover-para-fechado')).toHaveAccessibleDescription(/só a etapa muda: cobrança, contrato, cliente e card da implantação/);
    expect(within(menu).getByTestId('funil-mover-para-perdido')).toHaveTextContent('pede motivo');
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('funil-mover-a')).toHaveFocus();
  });

  it('para trás grava direto, sem token, e a tela diz só a mensagem', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'proposta')]);
    RESPOSTA_DO_POST = () => MOVIDO('qualificacao', 'Movido para E2 · Qualificação.');
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    await u.click(screen.getByTestId('funil-mover-para-qualificacao'));
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/lead/a/mover', corpo: { para: 'qualificacao' } }]));
    expect(await screen.findByTestId('funil-mensagem-a')).toHaveTextContent('Movido para E2 · Qualificação.');
    // Nada de pedido, assinatura ou /atendimento.
    expect(screen.queryByText(/assina|\/atendimento|pedido/i)).toBeNull();
    expect(gets.some((g) => g.includes('/mover/pedido'))).toBe(false);
  });

  it('com conclusões pendentes, a mensagem diz sem quais conclusões ficou', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'novo_lead')]);
    const mensagem = 'Movido para E3 · Reunião agendada sem as conclusões de E1 · Novo lead: dono do lead (E1).';
    RESPOSTA_DO_POST = () => MOVIDO('reuniao_agendada', mensagem, ['dono do lead (E1)']);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    await u.click(screen.getByTestId('funil-mover-para-reuniao_agendada'));
    expect(await screen.findByTestId('funil-mensagem-a')).toHaveTextContent(mensagem);
  });

  it('para negócio fechado à mão grava direto; o aviso do cartão diz que só a etapa mudou', async () => {
    RESPOSTAS['/comercial/funil'] = funil([
      cartao('a', 'Lead A', 'fechado', { avisoDoMover: { texto: 'Negócio fechado à mão: só a etapa mudou.', por: 'Sócia', em: '2026-10-20T15:00:00.000Z' } }),
    ]);
    render(<FunilPage />);
    const aviso = await screen.findByTestId('funil-aviso-mao-a');
    expect(aviso).toHaveTextContent('movido à mão');
    expect(aviso).toHaveTextContent('Negócio fechado à mão: só a etapa mudou.');
    expect(aviso).toHaveTextContent('por Sócia');
  });

  it('o erro da API aparece no cartão, e o cartão fica onde estava', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'novo_lead')]);
    RESPOSTA_DO_POST = () => new Error('Quem move precisa ser um usuário ativo desta empresa.');
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    await u.click(screen.getByTestId('funil-mover-para-qualificacao'));
    expect(await screen.findByTestId('funil-mensagem-a')).toHaveTextContent('Quem move precisa ser um usuário ativo desta empresa.');
  });

  it('sem leads.editar não há botão de mover nem arraste', async () => {
    PERMISSOES = ['leads.ver'];
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'novo_lead')]);
    render(<FunilPage />);
    const card = await screen.findByTestId('funil-card-a');
    expect(screen.queryByTestId('funil-mover-a')).toBeNull();
    expect(card).toHaveAttribute('draggable', 'false');
  });

  it('Tab para fora do menu fecha sem roubar o foco', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'novo_lead'), cartao('b', 'Lead B', 'novo_lead')]);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    fireEvent.blur(screen.getByRole('menu'), { relatedTarget: screen.getByTestId('funil-mover-b') });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('a saída leva o motivo no mesmo gesto, sem trava', () => {
  it('pelo menu: a saída já vem escolhida; o motivo escrito vai junto', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'proposta')]);
    RESPOSTA_DO_POST = () => MOVIDO('perdido', 'Movido para Saída · Perdido.');
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    await u.click(screen.getByTestId('funil-mover-para-perdido'));
    const form = await screen.findByTestId('funil-saida-a');
    expect(within(form).getAllByRole('combobox')[0]).toHaveValue('perdido');
    await u.type(within(form).getByTestId('funil-saida-a-motivo'), 'fechou com outro');
    await u.click(within(form).getByRole('button', { name: 'mover para a saída' }));
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/lead/a/mover', corpo: { para: 'perdido', motivo: 'fechou com outro' } }]));
    expect(await screen.findByTestId('funil-mensagem-a')).toHaveTextContent('Movido para Saída · Perdido.');
  });

  it('pelo arraste em Saídas: escolhe a saída; sem motivo escrito também vai, e o campo diz o que acontece', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'proposta')]);
    RESPOSTA_DO_POST = () => ({ ...MOVIDO('geladeira', 'Movido para Saída · Geladeira.'), aviso: 'Saída sem motivo informado.' });
    render(<FunilPage />);
    const card = await screen.findByTestId('funil-card-a');
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('funil-coluna-saidas'), { dataTransfer: dt });
    const form = await screen.findByTestId('funil-saida-a');
    const u = userEvent.setup();
    const botao = within(form).getByRole('button', { name: 'mover para a saída' });
    expect(botao).toBeDisabled();
    expect(within(form).getByTestId('funil-saida-a-motivo')).toHaveAccessibleDescription(/sem motivo informado/);
    await u.selectOptions(within(form).getAllByRole('combobox')[0], 'geladeira');
    expect(botao).toBeEnabled();
    await u.click(botao);
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/lead/a/mover', corpo: { para: 'geladeira' } }]));
  });

  it('o cartão que saiu sem motivo mostra o aviso', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'perdido', { motivoSaida: 'outro', avisoDoMover: { texto: 'Saída sem motivo informado.', por: null, em: '2026-10-20T15:00:00.000Z' } })]);
    render(<FunilPage />);
    expect(await screen.findByTestId('funil-aviso-mao-a')).toHaveTextContent('Saída sem motivo informado.');
  });
});

describe('mover pelo arraste', () => {
  it('soltar em qualquer etapa grava direto, inclusive para trás; no E8 abre a confirmação com o aviso da regra (L5)', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'proposta')]);
    RESPOSTA_DO_POST = (_c, corpo) => MOVIDO((corpo as { para: string }).para, 'Movido.');
    render(<FunilPage />);
    const u = userEvent.setup();
    let card = await screen.findByTestId('funil-card-a');
    expect(card).toHaveAttribute('draggable', 'true');
    // E8: o arrasto não é bloqueado nem move calado: abre a confirmação no cartão.
    let dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId('funil-coluna-contrato'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('funil-coluna-contrato'), { dataTransfer: dt });
    const confirmar = await screen.findByTestId('funil-confirmar-a');
    expect(confirmar).toHaveTextContent(/só a etapa muda: o contrato e a cobrança nascem do aceite/);
    expect(posts).toHaveLength(0);
    await u.click(screen.getByTestId('funil-confirmar-mover-a'));
    await waitFor(() => expect(posts.at(-1)).toEqual({ caminho: '/comercial/lead/a/mover', corpo: { para: 'contrato' } }));
    // O cartão anda na hora (está na coluna E8), sem reler a lista inteira.
    await waitFor(() => expect(within(screen.getByTestId('funil-coluna-contrato')).getByTestId('funil-card-a')).toBeInTheDocument());
    expect(gets.filter((g) => g.startsWith('/comercial/funil'))).toHaveLength(1);
    // Para trás vai direto (o cartão remontou na coluna nova: pega de novo).
    card = screen.getByTestId('funil-card-a');
    dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId('funil-coluna-novo_lead'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('funil-coluna-novo_lead'), { dataTransfer: dt });
    await waitFor(() => expect(posts.at(-1)).toEqual({ caminho: '/comercial/lead/a/mover', corpo: { para: 'novo_lead' } }));
    await waitFor(() => expect(within(screen.getByTestId('funil-coluna-novo_lead')).getByTestId('funil-card-a')).toBeInTheDocument());
    expect(screen.queryByText(/não aceita/)).toBeNull();
  });
});

describe('L5: o funil fluido', () => {
  it('o cartão anda na hora pelo menu e, se a API negar, volta para onde estava com o aviso', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'proposta')]);
    let negar!: (e: unknown) => void;
    RESPOSTA_DO_POST = () => new Promise((_r, rej) => { negar = rej; });
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    await u.click(screen.getByTestId('funil-mover-para-qualificacao'));
    // Antes da resposta: já está em E2.
    await waitFor(() => expect(within(screen.getByTestId('funil-coluna-qualificacao')).getByTestId('funil-card-a')).toBeInTheDocument());
    expect(screen.getByTestId('funil-card-a')).toHaveAttribute('data-recem-movido', 'true');
    // A API nega: volta para E6 com a mensagem.
    await act(async () => { negar(new Error('Quem move precisa ser um usuário ativo desta empresa.')); await new Promise((r) => setTimeout(r, 10)); });
    await waitFor(() => expect(within(screen.getByTestId('funil-coluna-proposta')).getByTestId('funil-card-a')).toBeInTheDocument());
    expect(screen.getByTestId('funil-mensagem-a')).toHaveTextContent('Quem move precisa ser um usuário ativo desta empresa.');
  });

  it('depois do mover a coluna não recarrega: só o cartão é relido (a ficha do lead)', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'proposta')]);
    RESPOSTAS['/comercial/lead/a'] = { leadId: 'a', etapa: 'qualificacao', etapaDesde: '2026-10-27T12:00:00.000Z', proximaAcao: { tipo: 'formulario', quando: null, descricao: 'o lead responde as 4 perguntas na sala (M1 com o link)' }, saude: null, balao: null, motivoSaida: null, voltaEm: null, produto: null, perfil: null, dono: null };
    RESPOSTA_DO_POST = () => MOVIDO('qualificacao', 'Movido para E2 · Qualificação.');
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    await u.click(screen.getByTestId('funil-mover-para-qualificacao'));
    await waitFor(() => expect(gets).toContain('/comercial/lead/a'));
    expect(await screen.findByTestId('funil-proxima-a')).toHaveTextContent('o lead responde as 4 perguntas na sala');
    expect(gets.filter((g) => g.startsWith('/comercial/funil'))).toHaveLength(1);
  });

  it('a confirmação de E9 pelo menu diz o que o mover à mão não faz; cancelar não move', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'contrato')]);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-mover-a'));
    await u.click(screen.getByTestId('funil-mover-para-fechado'));
    const confirmar = await screen.findByTestId('funil-confirmar-a');
    expect(confirmar).toHaveTextContent(/cliente e card da implantação nascem do fechamento de verdade/);
    await u.click(within(confirmar).getByRole('button', { name: 'cancelar' }));
    expect(screen.queryByTestId('funil-confirmar-a')).toBeNull();
    expect(posts).toHaveLength(0);
  });
});

describe('L2: o menu do lead no cartão', () => {
  it('o botão direito abre o menu com as seis ações; "mover" lista as etapas e grava; Esc fecha', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'proposta', { empresa: 'Construtora Alicerce' })]);
    RESPOSTA_DO_POST = () => MOVIDO('follow_up', 'Movido para E7 · Follow-up.');
    render(<FunilPage />);
    const card = await screen.findByTestId('funil-card-a');
    fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });
    const menu = await screen.findByTestId('menu-do-lead');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Abrir', 'Mover de etapa', 'Copiar link da sala', 'Vincular WhatsApp', 'Editar valor negociado', 'Histórico']);
    fireEvent.click(within(menu).getByTestId('menu-do-lead-mover'));
    expect(within(menu).queryByTestId('menu-do-lead-mover-para-proposta')).toBeNull();
    fireEvent.click(within(menu).getByTestId('menu-do-lead-mover-para-follow_up'));
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/lead/a/mover', corpo: { para: 'follow_up' } }]));
    expect(await screen.findByTestId('menu-do-lead-feito')).toHaveTextContent('Movido para E7 · Follow-up.');
    await waitFor(() => expect(within(screen.getByTestId('funil-coluna-follow_up')).getByTestId('funil-card-a')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId('menu-do-lead')).toBeNull());
  });

  it('o "⋯" abre o menu; Histórico abre o AuditLog do lead; copiar link da sala vai à área de transferência', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'proposta')]);
    RESPOSTA_DO_POST = (caminho) => (caminho.endsWith('/sala/link') ? { link: 'https://os.operacaoroot.com/s/abc', validaAte: '2026-11-01T00:00:00.000Z' } : {});
    render(<FunilPage />);
    const u = userEvent.setup();
    // O user-event instala o stub dele no navigator.clipboard: o espião entra depois do setup.
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true });
    await u.click(await screen.findByTestId('menu-do-lead-botao-a'));
    let menu = await screen.findByTestId('menu-do-lead');
    fireEvent.click(within(menu).getByTestId('menu-do-lead-historico'));
    expect(await screen.findByTestId('historico-dublê')).toHaveTextContent('histórico de a');
    await waitFor(() => expect(screen.queryByTestId('menu-do-lead')).toBeNull());
    await u.click(screen.getByTestId('menu-do-lead-botao-a'));
    menu = await screen.findByTestId('menu-do-lead');
    fireEvent.click(within(menu).getByTestId('menu-do-lead-copiar-link-da-sala'));
    await waitFor(() => expect(posts.at(-1)).toEqual({ caminho: '/comercial/lead/a/sala/link', corpo: {} }));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith('https://os.operacaoroot.com/s/abc'));
    expect(await screen.findByTestId('menu-do-lead-feito')).toHaveTextContent('Link da sala copiado.');
  });
});

describe('o balão e as colunas, sem os chips das etapas', () => {
  it('o cartão movido com pendências mostra o balão com a lista e quem moveu (o balão da P5 fica)', async () => {
    RESPOSTAS['/comercial/funil'] = funil([
      cartao('a', 'Lead A', 'reuniao_agendada', { balao: { pendencias: ['dono do lead (E1)', 'sistema ou ERP em uso (E2)'], movidoPor: 'Sócia da conta', em: '2026-10-18T15:00:00.000Z' } }),
      cartao('b', 'Lead B', 'reuniao_agendada'),
    ]);
    render(<FunilPage />);
    const balao = await screen.findByTestId('funil-balao-a');
    expect(balao).toHaveTextContent('movido com pendências');
    expect(balao).toHaveTextContent('dono do lead (E1); sistema ou ERP em uso (E2)');
    expect(balao).toHaveTextContent('por Sócia da conta');
    expect(screen.queryByTestId('funil-balao-b')).toBeNull();
  });

  it('não há chips das etapas; as colunas continuam, com a contagem no cabeçalho', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'proposta'), cartao('b', 'Lead B', 'proposta'), cartao('c', 'Lead C', 'perdido')]);
    render(<FunilPage />);
    await screen.findByTestId('funil-coluna-proposta');
    expect(screen.queryAllByTestId(/^funil-chip-/)).toHaveLength(0);
    expect(screen.queryByRole('navigation', { name: 'etapas do funil' })).toBeNull();
    expect(screen.queryAllByTestId(/^funil-etiqueta-/)).toHaveLength(0);
    expect(screen.getAllByTestId(/^funil-coluna-/)).toHaveLength(COMERCIAL_ETAPAS.length + 1);
    expect(within(screen.getByTestId('funil-coluna-proposta')).getByRole('heading', { name: /E6 · Proposta/ })).toHaveTextContent('2');
  });

  it('as setas andam entre os cartões das colunas', async () => {
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'novo_lead'), cartao('b', 'Lead B', 'novo_lead'), cartao('c', 'Lead C', 'proposta')]);
    render(<FunilPage />);
    const linkA = (await screen.findByTestId('funil-card-a')).querySelector<HTMLElement>('[data-cartao-do-funil]')!;
    linkA.focus();
    fireEvent.keyDown(linkA, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('funil-card-b').querySelector('[data-cartao-do-funil]'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByTestId('funil-card-c').querySelector('[data-cartao-do-funil]'));
  });
});

describe('filtros e vistas no cabeçalho', () => {
  it('o par Vistas e Filtros está no cabeçalho; o responsável é o primeiro filtro e vai ao endereço e à API', async () => {
    RESPOSTAS['/trabalho/vistas'] = [];
    RESPOSTAS['/comercial/funil'] = funil([cartao('a', 'Lead A', 'novo_lead', { donoId: 'u-ana', dono: 'Ana' })], { donos: [{ id: 'u-ana', nome: 'Ana' }] });
    render(<FunilPage />);
    expect(await screen.findByTestId('funil-vistas')).toBeInTheDocument();
    await waitFor(() => expect(gets).toContain('/trabalho/vistas?tela=funil'));
    const u = userEvent.setup();
    await u.click(screen.getByTestId('funil-filtros-botao'));
    const painel = screen.getByTestId('funil-filtros-painel');
    const campos = within(painel).getAllByRole('combobox');
    expect(campos[0]).toBe(within(painel).getByTestId('funil-filtros-dono'));
    expect(within(painel).getByLabelText('Responsável')).toBe(campos[0]);
    expect(within(campos[0]).getByRole('option', { name: 'Ana' })).toBeInTheDocument();
    expect(within(campos[0]).getByRole('option', { name: 'Eu' })).toBeInTheDocument();
    await u.selectOptions(campos[0], 'u-ana');
    expect(window.location.search).toBe('?dono=u-ana');
    await waitFor(() => expect(gets).toContain('/comercial/funil?dono=u-ana'));
    expect(screen.getByTestId('funil-filtros-contagem')).toHaveTextContent('(1)');
    // Os outros filtros do pedido estão no painel.
    for (const chave of ['produto', 'perfil', 'etapa', 'parado', 'decisao', 'q']) expect(within(painel).getByTestId(`funil-filtros-${chave}`)).toBeInTheDocument();
    await u.click(within(painel).getByTestId('funil-filtros-limpar-tudo'));
    expect(window.location.search).toBe('');
  });

  it('abre com os filtros do endereço; o link antigo ?filtro= é traduzido e sai do endereço', async () => {
    RESPOSTAS['/comercial/funil'] = funil([]);
    irPara('/comercial/funil?filtro=parados&lead=l9');
    render(<FunilPage />);
    await waitFor(() => expect(gets).toContain('/comercial/funil?parado=1'));
    expect(window.location.search).toBe('?lead=l9&parado=1');
    cleanup();
    gets.length = 0;
    irPara('/comercial/funil?dono=eu&visao=lista');
    render(<FunilPage />);
    await waitFor(() => expect(gets).toContain('/comercial/funil?dono=eu'));
    expect(await screen.findByTestId('funil-visao-lista')).toHaveAttribute('aria-pressed', 'true');
  });

  it('a busca por empresa ou contato vai à API depois que a pessoa para de digitar', async () => {
    RESPOSTAS['/comercial/funil'] = funil([]);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-filtros-botao'));
    await u.type(screen.getByTestId('funil-filtros-q'), 'alicerce');
    expect(window.location.search).toBe('?q=alicerce');
    await waitFor(() => expect(gets).toContain('/comercial/funil?q=alicerce'));
    expect(gets.filter((g) => g.startsWith('/comercial/funil?q='))).toEqual(['/comercial/funil?q=alicerce']);
  });
});

describe('o formato Lista', () => {
  it('a lista mostra empresa, contato, etapa, dono, produto, dias, próxima ação e pendências; a empresa abre o painel', async () => {
    RESPOSTAS['/comercial/funil'] = funil([
      cartao('a', 'Marina Duarte', 'proposta', {
        empresa: 'Construtora Alicerce', dono: 'Ana', donoId: 'u-ana', produto: 'operacao', diasNaEtapa: 4,
        proximaAcao: { tipo: 'humano', descricao: 'ligar para a Marina', quando: null } as never,
        balao: { pendencias: ['dono do lead (E1)'], movidoPor: 'Ana', em: '2026-10-18T15:00:00.000Z' },
      }),
      cartao('b', 'Lead Sem Dono', 'perdido'),
    ]);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-visao-lista'));
    expect(window.location.search).toBe('?visao=lista');
    const lista = await screen.findByTestId('funil-lista');
    const cabecalhos = within(lista).getAllByRole('columnheader').map((c) => c.textContent);
    // I5 (22/10/2026): o valor entrou nas colunas padrão.
    expect(cabecalhos).toEqual(['Empresa', 'Contato', 'Etapa', 'Responsável', 'Produto', 'Valor', 'Dias na etapa', 'Próxima ação', 'Pendências']);
    const linha = within(lista).getByTestId('funil-linha-a');
    for (const t of ['Construtora Alicerce', 'Marina Duarte', 'E6 · Proposta', 'Ana', 'Operação ROOT', '4', 'ligar para a Marina', 'dono do lead (E1)']) expect(linha).toHaveTextContent(t);
    expect(within(lista).getByTestId('funil-linha-b')).toHaveTextContent('sem responsável');
    expect(within(linha).getByRole('link', { name: 'Construtora Alicerce' })).toHaveAttribute('href', expect.stringContaining('lead=a'));
    expect(screen.queryByTestId('funil-coluna-proposta')).toBeNull();
    // A tabela rola dentro de si; a página não.
    expect(lista.className).toContain('overflow-auto');
    expect(lista.className).toContain('max-w-full');
  });
});
