/*
 * AS TAREFAS DO COMERCIAL NO FUNIL E NO PAINEL (adendo de 21/10/2026, §A1).
 *
 *  · o bloco "Tarefas do comercial" no topo do Funil vivo (quadro e lista): as
 *    sem lead, a contagem no cabeçalho, recolhível com o estado lembrado, o
 *    filtro "Responsável" do funil valendo para ele, "+ tarefa" (Enter salva,
 *    Esc desfaz), concluir com um clique e editar só o que mudou;
 *  · o cartão do funil: a tarefa mais antiga como a próxima ação (ou como
 *    segunda linha) e a contagem das abertas;
 *  · o painel do lead: o bloco "Tarefas" com as do lead e "+ tarefa" já ligada.
 *
 * No jsdom não há layout: os 390 px sem rolagem lateral se conferem pelas
 * classes que deixam o bloco encolher e o formulário quebrar a linha.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMERCIAL_ETAPAS, TAREFA_IGUAL_JA_EXISTE, type CartaoDoFunil, type FichaDoLead, type FunilVivo, type TarefaDoComercial, type TarefasDoComercial } from '@mktos/shared';

let RESPOSTAS: Record<string, unknown> = {};
const gets: string[] = [];
const posts: { caminho: string; corpo: unknown }[] = [];
const patches: { caminho: string; corpo: unknown }[] = [];
/** A recusa da API no próximo POST (M3: título repetido que a tela não via). */
let RECUSA_DO_POST: { corpo: Record<string, unknown>; status: number } | null = null;

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => true }) }));
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      gets.push(caminho);
      const chave = Object.keys(RESPOSTAS).sort((a, b) => b.length - a.length).find((k) => caminho.startsWith(k));
      return chave ? RESPOSTAS[chave] : [];
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      if (RECUSA_DO_POST) { const r = RECUSA_DO_POST; RECUSA_DO_POST = null; throw real.erroDaResposta(r.corpo, r.status); }
      return {};
    }),
    apiPatch: vi.fn(async (caminho: string, corpo: unknown) => {
      patches.push({ caminho, corpo });
      return {};
    }),
  };
});

import FunilPage from '@/app/comercial/funil/page';
import { ProvedorDoPainel } from '@/app/comercial/_painel/provedor';
import { CHAVE_DO_BLOCO_RECOLHIDO } from '@/app/comercial/_funil/TarefasDoComercial';
import { proximaAcaoDoCartao } from '@/app/comercial/_funil/proxima-acao-do-cartao';

const tarefa = (id: string, titulo: string, extra: Partial<TarefaDoComercial> = {}): TarefaDoComercial => ({
  id, titulo, pessoa: null, responsavelTexto: null, prazo: null, situacao: 'sem_prazo', status: { nome: 'A fazer', tipo: 'aberta' },
  lead: null, criadaEm: '2026-10-20T12:00:00.000Z', updatedAt: `2026-10-20T12:00:00.000Z`, ...extra,
});

const lista = (tarefas: TarefaDoComercial[]): TarefasDoComercial => ({
  hoje: '2026-10-21',
  pessoas: [{ id: '11111111-1111-4111-8111-111111111111', nome: 'Ana Sintética' }, { id: '22222222-2222-4222-8222-222222222222', nome: 'Beto Sintético' }],
  tarefas,
  abertas: tarefas.filter((t) => t.status.tipo !== 'concluida').length,
});

const cartao = (leadId: string, nome: string, extra: Partial<CartaoDoFunil> = {}): CartaoDoFunil => ({
  leadId, nome, empresa: null, etapa: 'qualificacao', saude: null, proximaAcao: null, precisaDeDecisao: false,
  parado: false, diasNaEtapa: 0, motivoSaida: null, voltaEm: null, perfil: null, produto: null, voltaPara: null, balao: null, ...extra,
});

function funil(cartoes: CartaoDoFunil[]): FunilVivo {
  return {
    colunas: [
      ...COMERCIAL_ETAPAS.map((e) => ({ etapa: e, rotulo: e, cartoes: cartoes.filter((c) => c.etapa === e) })),
      { etapa: 'saidas' as const, rotulo: 'Saídas', cartoes: [] },
    ],
  };
}

function irPara(url: string) {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  RESPOSTAS = {};
  RECUSA_DO_POST = null;
  gets.length = 0;
  posts.length = 0;
  patches.length = 0;
  window.localStorage.clear();
  // Layout 26/10: estes testes conferem o card inteiro (avisos por extenso), que é a densidade "cheio".
  window.localStorage.setItem('root-os:trabalho:densidade', 'cheio');
  irPara('/comercial/funil');
});
afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('o bloco "Tarefas do comercial" no Funil vivo', () => {
  it('mostra as sem lead com a contagem, no quadro e na lista, e cabe em 390 px', async () => {
    RESPOSTAS['/comercial/funil'] = funil([]);
    RESPOSTAS['/comercial/tarefas'] = lista([
      tarefa('t1', 'Atualizar o pipe', { prazo: '2026-10-19', situacao: 'atrasada', pessoa: { id: '11111111-1111-4111-8111-111111111111', nome: 'Ana Sintética' } }),
      tarefa('t2', 'Entrar no grupo de networking'),
      tarefa('t3', 'Colher feedback', { status: { nome: 'Feito', tipo: 'concluida' }, situacao: 'feita' }),
    ]);
    render(<FunilPage />);
    const bloco = await screen.findByTestId('funil-tarefas-do-comercial');
    await waitFor(() => expect(within(bloco).getByTestId('funil-tarefas-contagem')).toHaveTextContent('2'));
    expect(gets).toContain('/comercial/tarefas?semLead=1');
    expect(within(bloco).getByText('Atualizar o pipe')).toBeInTheDocument();
    // I6 (produção 22B): o responsável é o avatar (o nome no balão), e a linha diz o prazo.
    expect(within(bloco).getByText('prazo 19/10 · atrasada').closest('p')).toHaveClass('text-warn');
    expect(within(within(bloco).getByTestId('tarefa-responsavel-t1')).getByRole('img', { name: 'Responsável: Ana Sintética' })).toHaveAttribute('title', 'Responsável: Ana Sintética');
    expect(within(bloco).getByText('1 atrasada')).toBeInTheDocument();
    // A concluída fica recolhida, como histórico.
    expect(within(bloco).queryByText('Colher feedback')).toBeNull();
    await userEvent.setup().click(within(bloco).getByTestId('funil-tarefas-feitas'));
    expect(within(bloco).getByText('Colher feedback')).toHaveClass('line-through');
    // 390 px: o bloco encolhe com a página e o formulário quebra a linha.
    expect(bloco).toHaveClass('min-w-0');

    // No formato lista o bloco continua no topo.
    await userEvent.setup().click(screen.getByTestId('funil-visao-lista'));
    expect(screen.getByTestId('funil-tarefas-do-comercial')).toBeInTheDocument();
  });

  it('o filtro "Responsável" do funil vale para o bloco', async () => {
    irPara('/comercial/funil?dono=eu');
    RESPOSTAS['/comercial/funil'] = funil([]);
    RESPOSTAS['/comercial/tarefas'] = lista([]);
    render(<FunilPage />);
    await waitFor(() => expect(gets).toContain('/comercial/tarefas?semLead=1&pessoa=eu'));
    expect(await screen.findByText(/Nenhuma tarefa do comercial sem lead aberta/)).toBeInTheDocument();
  });

  it('recolhe e lembra: na próxima abertura vem recolhido', async () => {
    RESPOSTAS['/comercial/funil'] = funil([]);
    RESPOSTAS['/comercial/tarefas'] = lista([tarefa('t1', 'Atualizar o pipe')]);
    const { unmount } = render(<FunilPage />);
    const u = userEvent.setup();
    const alternar = await screen.findByTestId('funil-tarefas-alternar');
    expect(alternar).toHaveAttribute('aria-expanded', 'true');
    await u.click(alternar);
    expect(alternar).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem(CHAVE_DO_BLOCO_RECOLHIDO)).toBe('1');
    unmount();
    render(<FunilPage />);
    await waitFor(() => expect(screen.getByTestId('funil-tarefas-alternar')).toHaveAttribute('aria-expanded', 'false'));
    // Recolhido, a contagem continua no cabeçalho.
    await waitFor(() => expect(screen.getByTestId('funil-tarefas-contagem')).toHaveTextContent('1'));
  });

  it('"+ tarefa": Enter salva com título, responsável e prazo; Esc desfaz sem gravar', async () => {
    RESPOSTAS['/comercial/funil'] = funil([]);
    RESPOSTAS['/comercial/tarefas'] = lista([]);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-tarefas-mais'));
    await u.type(screen.getByTestId('funil-tarefas-nova-titulo'), 'Escrever para o contato');
    await u.keyboard('{Escape}');
    expect(screen.queryByTestId('funil-tarefas-nova')).toBeNull();
    expect(posts).toEqual([]);
    // O foco volta ao "+ tarefa" no quadro seguinte.
    await waitFor(() => expect(screen.getByTestId('funil-tarefas-mais')).toHaveFocus());

    await u.click(screen.getByTestId('funil-tarefas-mais'));
    await u.selectOptions(screen.getByTestId('funil-tarefas-nova-pessoa'), '22222222-2222-4222-8222-222222222222');
    await u.type(screen.getByTestId('funil-tarefas-nova-prazo'), '2026-10-24');
    await u.type(screen.getByTestId('funil-tarefas-nova-titulo'), 'Checar a integração{Enter}');
    await waitFor(() => expect(posts).toEqual([{
      caminho: '/comercial/tarefas',
      corpo: { titulo: 'Checar a integração', pessoaId: '22222222-2222-4222-8222-222222222222', prazo: '2026-10-24' },
    }]));
    // Sem lead: o bloco do funil nunca liga a tarefa a um lead.
    expect((posts[0].corpo as Record<string, unknown>).leadId).toBeUndefined();
  });

  it('M3: "+ tarefa" com título igual a uma aberta à vista dá a frase do Dia a dia sem chamar a API; a recusa da API também aparece', async () => {
    RESPOSTAS['/comercial/funil'] = funil([]);
    RESPOSTAS['/comercial/tarefas'] = lista([
      tarefa('t1', 'Fazer FUP da proposta'),
      tarefa('t2', 'Colher feedback', { status: { nome: 'Feito', tipo: 'concluida' }, situacao: 'feita' }),
    ]);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-tarefas-mais'));
    await u.type(screen.getByTestId('funil-tarefas-nova-titulo'), 'proposta: fazer FUP{Enter}');
    const form = screen.getByTestId('funil-tarefas-nova');
    expect(await within(form).findByRole('alert')).toHaveTextContent(TAREFA_IGUAL_JA_EXISTE);
    expect(posts).toEqual([]);

    // A concluída não segura: vai à API, e a recusa dela (outra aba criou) também aparece com a frase.
    RECUSA_DO_POST = { corpo: { message: TAREFA_IGUAL_JA_EXISTE, code: 'tarefa_igual' }, status: 409 };
    await u.clear(screen.getByTestId('funil-tarefas-nova-titulo'));
    await u.type(screen.getByTestId('funil-tarefas-nova-titulo'), 'Colher feedback{Enter}');
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(await within(screen.getByTestId('funil-tarefas-nova')).findByRole('alert')).toHaveTextContent(TAREFA_IGUAL_JA_EXISTE);
  });

  it('concluir é um clique, com a versão lida; editar manda só o que mudou', async () => {
    RESPOSTAS['/comercial/funil'] = funil([]);
    RESPOSTAS['/comercial/tarefas'] = lista([tarefa('t1', 'Atualizar o pipe', { prazo: '2026-10-25', situacao: 'proximos_7', updatedAt: '2026-10-21T09:00:00.000Z' })]);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('tarefa-concluir-t1'));
    await waitFor(() => expect(patches).toEqual([{ caminho: '/comercial/tarefas/t1', corpo: { expectedUpdatedAt: '2026-10-21T09:00:00.000Z', etapa: 'concluida' } }]));

    patches.length = 0;
    await u.click(screen.getByTestId('tarefa-editar-botao-t1'));
    const titulo = screen.getByTestId('tarefa-editar-t1-titulo');
    expect(titulo).toHaveValue('Atualizar o pipe');
    await u.clear(titulo);
    await u.type(titulo, 'Atualizar o pipe do mês{Enter}');
    await waitFor(() => expect(patches).toEqual([{ caminho: '/comercial/tarefas/t1', corpo: { expectedUpdatedAt: '2026-10-21T09:00:00.000Z', titulo: 'Atualizar o pipe do mês' } }]));
  });
});

describe('o cartão do funil com a tarefa do lead', () => {
  const comTarefa = (eh: boolean) => cartao('a', 'Contato A', {
    empresa: 'Empresa A Sintética',
    proximaAcao: { tipo: 'formulario', quando: null, descricao: 'o lead responde as 4 perguntas na sala' },
    tarefa: { id: 't9', titulo: 'Fazer FUP da proposta', prazo: '2026-10-22', situacao: 'proximos_7', responsavel: 'Ana Sintética', ehProximaAcao: eh },
    tarefasAbertas: 2,
  });

  it('a tarefa vem como a próxima ação, com o prazo; a da ficha desce para a segunda linha', async () => {
    RESPOSTAS['/comercial/funil'] = funil([comTarefa(true)]);
    RESPOSTAS['/comercial/tarefas'] = lista([]);
    render(<FunilPage />);
    expect(await screen.findByTestId('funil-proxima-a')).toHaveTextContent('tarefa: Fazer FUP da proposta · prazo 22/10');
    expect(screen.getByTestId('funil-segunda-a')).toHaveTextContent('o lead responde as 4 perguntas na sala');
    expect(within(screen.getByTestId('funil-card-a')).getByText('2 tarefas abertas')).toBeInTheDocument();
  });

  it('quando a ficha vem antes, a tarefa é a segunda linha; o formato lista diz o mesmo', async () => {
    RESPOSTAS['/comercial/funil'] = funil([comTarefa(false)]);
    RESPOSTAS['/comercial/tarefas'] = lista([]);
    render(<FunilPage />);
    expect(await screen.findByTestId('funil-proxima-a')).toHaveTextContent('o lead responde as 4 perguntas na sala');
    expect(screen.getByTestId('funil-segunda-a')).toHaveTextContent('tarefa: Fazer FUP da proposta · prazo 22/10');
    await userEvent.setup().click(screen.getByTestId('funil-visao-lista'));
    const celula = screen.getByTestId('funil-linha-proxima-a');
    expect(celula).toHaveTextContent('o lead responde as 4 perguntas na sala');
    expect(celula).toHaveTextContent('tarefa: Fazer FUP da proposta · prazo 22/10');
    expect(celula).toHaveTextContent('2 tarefas abertas');
  });

  it('sem tarefa, o cartão fica como antes; atrasada leva o aviso', () => {
    expect(proximaAcaoDoCartao(cartao('b', 'B'))).toEqual({ principal: null, segunda: null });
    const r = proximaAcaoDoCartao(cartao('c', 'C', { tarefa: { id: 'x', titulo: 'Ligar', prazo: '2026-10-19', situacao: 'atrasada', responsavel: null, ehProximaAcao: true } }));
    expect(r.principal).toEqual({ texto: 'tarefa: Ligar', quando: 'prazo 19/10, atrasada', atrasada: true });
    expect(r.segunda).toBeNull();
  });
});

describe('o bloco "Tarefas" do painel do lead', () => {
  function ficha(): FichaDoLead {
    return {
      leadId: 'l1', nome: 'Contato Sintético', telefone: null, email: null, empresa: 'Empresa Sintética', cnpj: null, canal: null, origemIndicacao: null,
      perfil: null, pontuacao: null, sistemaErp: null, baseDados: null, dono: null, socioDaConta: null, produto: null,
      valorCentavos: null, parcelas: null, forma: null, validade: null, propostaVersao: 0, etapa: 'qualificacao', etapaDesde: '2026-10-12T13:00:00.000Z',
      motivoSaida: null, voltaEm: null, saude: null, proximaAcao: null, proximasAcoesAutomaticas: [],
      portao: { proxima: 'reuniao_agendada', faltando: [], itens: [] },
      ligadoA: { sala: null, ata: false, proposta: null, contrato: null, cobranca: null },
      fio: [],
    };
  }

  it('lista as do lead (abertas; concluídas recolhidas) e a nova já nasce ligada a ele', async () => {
    // Leva 5 (L4): o bloco de tarefas mora na aba Pendências e sugestões.
    irPara('/comercial/funil?lead=l1&aba=pendencias');
    RESPOSTAS['/comercial/lead/l1'] = ficha();
    RESPOSTAS['/comercial/decisoes'] = [];
    RESPOSTAS['/comercial/tarefas'] = lista([
      tarefa('t1', 'Fazer FUP da proposta', { lead: { id: 'l1', nome: 'Empresa Sintética' }, prazo: '2026-10-22', situacao: 'proximos_7' }),
      tarefa('t2', 'Mandar o material', { lead: { id: 'l1', nome: 'Empresa Sintética' }, status: { nome: 'Feito', tipo: 'concluida' }, situacao: 'feita' }),
    ]);
    render(<ProvedorDoPainel><main id="root-os-main" tabIndex={-1}>a tela de trás</main></ProvedorDoPainel>);
    const dialogo = await screen.findByRole('dialog', { name: 'Empresa Sintética' });
    const bloco = await within(dialogo).findByTestId('painel-tarefas');
    expect(gets).toContain('/comercial/tarefas?leadId=l1');
    expect(await within(bloco).findByText('Fazer FUP da proposta')).toBeInTheDocument();
    expect(within(bloco).getByText(/tarefas · 1 aberta/)).toBeInTheDocument();
    expect(within(bloco).queryByText('Mandar o material')).toBeNull();
    expect(within(bloco).getByTestId('painel-tarefas-lista-feitas')).toHaveTextContent('ver as concluídas (1)');

    const u = userEvent.setup();
    await u.click(within(bloco).getByTestId('painel-tarefas-lista-mais'));
    await u.type(within(bloco).getByTestId('painel-tarefas-lista-nova-titulo'), 'Marcar a reunião{Enter}');
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/tarefas', corpo: { titulo: 'Marcar a reunião', leadId: 'l1' } }]));
    // O Esc do formulário não fecha o painel.
    await u.click(within(bloco).getByTestId('painel-tarefas-lista-mais'));
    await u.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Empresa Sintética' })).toBeInTheDocument();
  });

  it('Layout 26/10: a tarefa abre no pop-up único POR CIMA do painel, sem sair para /trabalho; Esc fecha só a tarefa', async () => {
    const T1 = '33333333-3333-4333-8333-333333333333';
    irPara('/comercial/funil?lead=l1&aba=pendencias');
    RESPOSTAS['/comercial/lead/l1'] = ficha();
    RESPOSTAS['/comercial/decisoes'] = [];
    RESPOSTAS['/comercial/tarefas'] = lista([tarefa(T1, 'Fazer FUP da proposta', { lead: { id: 'l1', nome: 'Empresa Sintética' } })]);
    RESPOSTAS['/trabalho/estrutura'] = { espacos: [], folders: [], listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [], pessoas: [] };
    RESPOSTAS['/trabalho/tarefas/'] = {
      id: T1, listId: 'l-com', listName: 'Comercial', title: 'Fazer FUP da proposta', statusId: 's1', statusName: 'A fazer', statusType: 'open', statusColor: '#888',
      priority: 'normal', assignee: null, assigneeUserId: null, assigneeUserName: null, assigneeUserEmail: null, assigneeUserIsActive: null,
      agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null, statusDesde: null, minutos: 0, dueDate: null, startDate: null, overdue: false,
      parentId: null, subtasks: 0, comments: 0, externalId: null, externalUrl: null, archived: false, order: 0, tags: [], values: [],
      clienteId: null, clienteNome: null, outrosResponsaveisIds: [], recorrencia: null, updatedAt: '2026-10-20T12:00:00.000Z',
      description: null, createdAt: '2026-10-20T12:00:00.000Z', comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [],
    };
    render(<ProvedorDoPainel><main id="root-os-main" tabIndex={-1}>a tela de trás</main></ProvedorDoPainel>);
    const dialogo = await screen.findByRole('dialog', { name: 'Empresa Sintética' });
    const abrir = await within(dialogo).findByTestId(`tarefa-abrir-${T1}`);
    // Um botão, não um link para /trabalho.
    expect(abrir.tagName).toBe('BUTTON');
    const u = userEvent.setup();
    await u.click(abrir);
    const popup = await screen.findByTestId('tarefa-popup');
    expect(new URLSearchParams(window.location.search).get('tarefa')).toBe(T1);
    expect(new URLSearchParams(window.location.search).get('lead')).toBe('l1');
    // Acima do painel do lead (z-[60]).
    expect(popup.style.zIndex).toBe('65');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('tarefa-popup')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Empresa Sintética' })).toBeInTheDocument();
  });
});
