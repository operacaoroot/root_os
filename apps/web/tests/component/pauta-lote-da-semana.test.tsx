import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * MD8 — APROVAR A SEMANA NUM PONTO SÓ, o lado da tela.
 *
 * Na aba Semana: o botão "Aprovar a semana" por episódio, o estado da
 * publicação automática ao lado, as peças com a linha do tempo, o "fica
 * fora", a montagem que pede a assinatura em seguida e o "Cancelar a semana"
 * com confirmação. Em /atendimento: o cartão do lote com o conteúdo de cada
 * post — e o botão de aprovar só depois de ele carregar.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiBlob = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
    apiBlob: (...a: unknown[]) => apiBlob(...a),
  };
});

const permissoes = ['pauta.ver', 'pauta.editar', 'pauta.publicar', 'aprovacoes.ver', 'aprovacoes.decidir'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Lucas', email: 'l@x.com', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import { AbaSemana } from '@/app/pauta/AbaSemana';
// eslint-disable-next-line import/first
import AtendimentoPage from '@/app/atendimento/page';

function peca(over: Record<string, unknown> = {}) {
  return {
    id: 'p1', formato: 'carrossel', status: 'rascunho', titulo: 'O preço caiu', legenda: 'Legenda', palavraChave: 'PRECO', episodioId: 'e4', apelido: 'ep-04',
    itemN: 1, materia: 'Preço', em: '2026-09-28T15:00:00.000Z', agendadaPara: null, slotProposto: '2026-09-28T15:00:00.000Z',
    midia: { onde: 'storage', imagens: [1, 2, 3], esperadas: 3 }, postada: null, motivoParaNaoAgendar: null, publicacao: null, lote: null,
    ...over,
  };
}

function agenda(pecas: unknown[], over: Record<string, unknown> = {}) {
  return {
    de: '2026-09-28', ate: '2026-10-04', fuso: 'America/Sao_Paulo', hoje: '2026-09-28', origemDaGrade: 'padrao', grade: { slots: [], feriados: [] },
    dias: [
      {
        dia: '2026-09-28', diaDaSemana: 'seg', feriado: null,
        linhas: pecas.map((p, i) => ({ hora: `1${i}:00`, formato: (p as { formato: string }).formato, em: (p as { em: string }).em, daGrade: true, peca: p })),
      },
    ],
    paraDistribuir: [],
    publicacaoAutomatica: false,
    ...over,
  };
}

function estado(over: Record<string, unknown> = {}) {
  return {
    episodioId: 'e4', apelido: 'ep-04', status: 'derivacao', automaticaLigada: false, impedimentos: [],
    pecas: [
      { id: 'p1', formato: 'carrossel', itemN: 1, titulo: 'O preço caiu', status: 'rascunho', slot: '2026-09-28T15:00:00.000Z', problema: null, noLote: null, etapa: 'proposto' },
      { id: 'p2', formato: 'story', itemN: 1, titulo: 'Story do preço', status: 'rascunho', slot: '2026-09-29T12:00:00.000Z', problema: 'Falta o JPEG 1 da peça no OS (é o que a Meta baixa): rode a /root-midia no Mac.', noLote: null, etapa: 'proposto' },
      { id: 'p3', formato: 'corte', itemN: 1, titulo: 'Corte do preço', status: 'rascunho', slot: '2026-09-29T21:00:00.000Z', problema: null, noLote: null, etapa: 'proposto' },
    ],
    lotes: [],
    ...over,
  };
}

function rotas(e: unknown, a: unknown) {
  apiGet.mockImplementation(async (url: string) => (url.startsWith('/pauta/agenda') ? a : e));
}

const renderAba = () => render(<AbaSemana token="tok" editavel podePostar onErro={vi.fn()} bump={0} />);

beforeEach(() => {
  vi.clearAllMocks();
  apiBlob.mockRejectedValue(new Error('sem imagem no teste'));
});

describe('MD8: "Aprovar a semana" na aba Semana', () => {
  it('lista o episódio com o estado da publicação automática e abre as peças com a linha do tempo', async () => {
    rotas(estado(), agenda([peca()]));
    renderAba();
    const secao = await screen.findByRole('region', { name: 'Aprovar a semana' });
    expect(secao).toHaveTextContent('publicação automática desligada');
    expect(secao).toHaveTextContent('ep-04');
    // A linha do tempo também está no slot da agenda.
    expect(screen.getAllByLabelText('Etapa: proposto').length).toBeGreaterThan(0);

    await userEvent.click(within(secao).getByRole('button', { name: 'Aprovar a semana' }));
    const painel = await screen.findByLabelText('Aprovar a semana de ep-04');
    expect(painel).toHaveTextContent('desligada — assinada, a semana não sai sozinha');
    const story = within(painel).getByLabelText('Story da matéria 1');
    // A peça com problema começa fora do lote, e diz o que fazer.
    expect(within(story).getByRole('checkbox', { name: 'fica fora' })).toBeChecked();
    expect(story).toHaveTextContent('Fora do lote: Falta o JPEG 1');
    expect(within(painel).getByRole('button', { name: 'Aprovar a semana (2 posts)' })).toBeEnabled();
  });

  it('monta o lote com o "fica fora" e pede a assinatura em seguida: a tela diz que a titular assina em /atendimento', async () => {
    rotas(estado(), agenda([peca()]));
    apiPost.mockImplementation(async (url: string) => {
      if (url.endsWith('/preparar-aprovacao')) return { loteId: 'l1', hashConteudo: 'h', validaAte: 'x', itens: 1, fora: ['p2', 'p3'], substituidos: [] };
      if (url.endsWith('/pedir-assinatura')) return { status: 'aguardando_aprovacao', fila: '/atendimento', expiraEm: '2026-09-28T13:10:00.000Z', approvalId: 'a1' };
      throw new Error(`rota inesperada ${url}`);
    });
    renderAba();
    const secao = await screen.findByRole('region', { name: 'Aprovar a semana' });
    await userEvent.click(within(secao).getByRole('button', { name: 'Aprovar a semana' }));
    const painel = await screen.findByLabelText('Aprovar a semana de ep-04');
    await userEvent.click(within(within(painel).getByLabelText('Corte vertical da matéria 1')).getByRole('checkbox', { name: 'fica fora' }));
    await userEvent.click(within(painel).getByRole('button', { name: 'Aprovar a semana (1 post)' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/approvals/lotes/l1/pedir-assinatura', {}, 'tok'));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e4/semana/preparar-aprovacao', { fora: ['p2', 'p3'] }, 'tok');
    expect(await within(painel).findByRole('status')).toHaveTextContent('a titular assina em /atendimento');
  });

  it('com impedimento da semana (página de links fora do ar), o botão não monta nada', async () => {
    rotas(estado({ impedimentos: ['A página de links do episódio não está no ar: publique antes.'] }), agenda([peca()]));
    renderAba();
    const secao = await screen.findByRole('region', { name: 'Aprovar a semana' });
    await userEvent.click(within(secao).getByRole('button', { name: 'Aprovar a semana' }));
    const painel = await screen.findByLabelText('Aprovar a semana de ep-04');
    expect(painel).toHaveTextContent('A página de links do episódio não está no ar');
    expect(within(painel).getByRole('button', { name: /Aprovar a semana \(/ })).toBeDisabled();
  });

  it('o lote ativo: a peça mostra "ativo" e não oferece "Publicar agora"; "Cancelar a semana" pede confirmação e revoga', async () => {
    const ativa = peca({ status: 'aprovada', agendadaPara: '2026-09-28T15:00:00.000Z', slotProposto: null, lote: { loteId: 'l1', itemId: 'i1', estadoDoLote: 'ativo', estadoDoItem: 'ativo', janelaAte: 'x' } });
    const e = estado({
      automaticaLigada: true,
      pecas: [{ id: 'p1', formato: 'carrossel', itemN: 1, titulo: 'O preço caiu', status: 'aprovada', slot: '2026-09-28T15:00:00.000Z', problema: null, noLote: { loteId: 'l1', estadoDoLote: 'ativo' }, etapa: 'ativo' }],
      lotes: [{ id: 'l1', estado: 'ativo', validaAte: '2026-10-04T12:00:00.000Z', hashCurto: 'abc123def456', approvalId: 'a1', aprovadoEm: 'x', itens: 1, ativos: 1, montadoPorMim: true }],
    });
    rotas(e, agenda([ativa], { publicacaoAutomatica: true }));
    apiPost.mockResolvedValue({ estado: 'revogado' });
    renderAba();
    const slot = await screen.findByLabelText('Carrossel de ep-04');
    expect(within(slot).getByLabelText('Etapa: ativo')).toBeInTheDocument();
    expect(within(slot).queryByRole('button', { name: 'Publicar agora' })).toBeNull();
    expect(slot).toHaveTextContent('Sai pelo OS no horário, pela semana assinada');

    const secao = screen.getByRole('region', { name: 'Aprovar a semana' });
    expect(secao).toHaveTextContent('publicação automática ligada');
    await userEvent.click(within(secao).getByRole('button', { name: 'Aprovar a semana' }));
    const lote = await screen.findByLabelText('Lote abc123def456');
    expect(lote).toHaveTextContent('1 de 1 post(s) valendo');
    // A peça no lote ativo não tem "fica fora": sair é reagendar, editar ou cancelar a semana.
    expect(within(screen.getByLabelText('Aprovar a semana de ep-04')).queryByRole('checkbox')).toBeNull();

    await userEvent.click(within(lote).getByRole('button', { name: 'Cancelar a semana' }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(lote).toHaveTextContent('Nada mais sai por este lote');
    await userEvent.click(within(lote).getByRole('button', { name: 'Confirmar: cancelar a semana' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pauta/lotes/l1/cancelar', {}, 'tok'));
  });

  it('sem pauta.publicar, a tela mostra o estado e não oferece montar nem cancelar', async () => {
    rotas(estado(), agenda([peca()]));
    render(<AbaSemana token="tok" editavel podePostar={false} onErro={vi.fn()} bump={0} />);
    const secao = await screen.findByRole('region', { name: 'Aprovar a semana' });
    await userEvent.click(within(secao).getByRole('button', { name: 'Aprovar a semana' }));
    const painel = await screen.findByLabelText('Aprovar a semana de ep-04');
    expect(within(painel).queryByRole('button', { name: /Aprovar a semana \(/ })).toBeNull();
    expect(within(painel).queryByRole('checkbox')).toBeNull();
  });
});

/* ------------------------------------------------------------ /atendimento */

const LOTE_NA_FILA = {
  id: 'ap-lote',
  gaveta: 'esperando',
  status: 'pendente',
  nivel: 'R4',
  nivelBase: 'R3',
  resumo: 'pauta.semana.aprovar',
  capacidade: 'pauta.semana.aprovar',
  canal: null,
  recurso: { tipo: 'pauta.semana.aprovar', id: 'lote-1' },
  agente: null,
  correlationId: 'c',
  conteudo: { loteId: 'lote-1', hashConteudo: 'f'.repeat(64), totalDeItens: 2, validaAte: '2026-10-04T12:00:00.000Z' },
  conteudoOculto: false,
  hashDoConteudo: 'f00f00f00f00',
  impedimento: null,
  gatilhos: ['alcance'],
  motivoDaRegua: null,
  exigeReauth: true,
  exigeMotivo: true,
  alcadaMinima: 'titular',
  proponente: { id: 'u-pedro', tipo: 'user', nome: 'Pedro' },
  propostaEm: '2026-09-28T12:00:00.000Z',
  expiraEm: '2026-09-28T12:10:00.000Z',
  esperandoMs: 60_000,
  decididoPor: null,
  decididoEm: null,
  motivo: null,
  aprovadores: [{ id: 'u-eu', nome: 'Lucas', email: 'l@x.com', alcada: 'titular' }],
  euPossoAprovar: true,
  porQueNao: null,
};

const FILA = {
  agora: '2026-09-28T12:01:00.000Z',
  eu: { id: 'u-eu', alcada: 'titular', decide: true, decideNestaSessao: true, veConteudo: true },
  censo: { pessoasQueDecidem: 2, porAlcada: { titular: 2, responsavel: 0, operador: 0 }, pessoasLidas: 2, pessoasAtivas: 2, truncado: false },
  itens: [LOTE_NA_FILA],
  total: 1,
  mostrando: 1,
  truncado: false,
  tetos: { vivas: 100, fechadas: 60, pessoas: 500 },
};

const CONTEUDO = {
  loteId: 'lote-1', estado: 'aguardando', hashCurto: 'f00f00f00f00', validaAte: '2026-10-04T12:00:00.000Z', total: 2, divergentes: 1, handle: 'operacaoroot',
  itens: [
    {
      itemId: 'i1', pecaId: 'p1', formato: 'carrossel', titulo: 'O preço caiu', apelido: 'ep-04', itemN: 1, legenda: 'A legenda inteira do carrossel.\n\nComente PRECO',
      midia: { tipo: 'imagens', n: [1, 2, 3] }, agendadaPara: '2026-09-28T15:00:00.000Z', janelaAte: 'x', handle: 'operacaoroot', estadoDoItem: 'ativo', hashCurto: 'aaa', divergente: null,
    },
    {
      itemId: 'i2', pecaId: 'p3', formato: 'corte', titulo: 'Corte do preço', apelido: 'ep-04', itemN: 1, legenda: 'Legenda do corte',
      midia: { tipo: 'video', bytes: 5000, duracaoSeg: 42 }, agendadaPara: '2026-09-29T21:00:00.000Z', janelaAte: 'x', handle: 'operacaoroot', estadoDoItem: 'ativo', hashCurto: 'bbb',
      divergente: 'A peça mudou depois de o lote ser montado (texto, mídia, horário ou conta): este item não sai.',
    },
  ],
};

describe('MD8: o lote da semana em /atendimento', () => {
  it('a titular lê cada post (legenda inteira, horário em São Paulo, @, mídia e a divergência) e só então vê o botão de aprovar', async () => {
    let soltar: (v: unknown) => void = () => undefined;
    apiGet.mockImplementation((url: string) =>
      url.startsWith('/pauta/lotes/') ? new Promise((ok) => (soltar = ok)) : Promise.resolve(FILA),
    );
    render(<AtendimentoPage />);
    await screen.findByTestId('item-ap-lote', {}, { timeout: 4000 });
    expect(screen.getByTestId('lote-esperando-ap-lote')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar e executar' })).toBeNull();

    soltar(CONTEUDO);
    // Folga no tempo: com a suíte inteira em paralelo, o cartão chegou a passar de 1 s.
    const cartao = await screen.findByTestId('cartao-do-lote', {}, { timeout: 4000 });
    expect(apiGet).toHaveBeenCalledWith('/pauta/lotes/lote-1/conteudo', 'tok');
    expect(cartao).toHaveTextContent('2 post(s) · hash da lista f00f00f00f00');
    expect(cartao).toHaveTextContent('destino @operacaoroot');
    const carrossel = within(cartao).getByTestId('item-do-lote-i1');
    expect(carrossel).toHaveTextContent('28/09 12:00 · carrossel · ep-04 m1');
    expect(carrossel.querySelector('pre')?.textContent).toBe('A legenda inteira do carrossel.\n\nComente PRECO');
    expect(within(cartao).getByTestId('item-do-lote-i2')).toHaveTextContent('mp4 42 s');
    expect(within(cartao).getByTestId('divergente-i2')).toHaveTextContent('mudou depois');
    expect(cartao).toHaveTextContent('1 post(s) mudaram depois de o lote ser montado e NÃO saem');
    expect(await screen.findByRole('button', { name: 'Aprovar e executar' }, { timeout: 4000 })).toBeInTheDocument();
    // R4: senha e motivo.
    expect(screen.getByText(/R4 exige motivo escrito/)).toBeInTheDocument();
    expect(screen.getByText(/R4 exige que você prove de novo/)).toBeInTheDocument();
  });

  it('se o conteúdo do lote não carrega, não há botão de aprovar: sem ler, não se assina', async () => {
    apiGet.mockImplementation((url: string) => (url.startsWith('/pauta/lotes/') ? Promise.reject(new Error('403')) : Promise.resolve(FILA)));
    render(<AtendimentoPage />);
    expect(await screen.findByTestId('lote-sem-conteudo')).toHaveTextContent('não assine');
    expect(screen.queryByRole('button', { name: 'Aprovar e executar' })).toBeNull();
    // Recusar segue ao alcance: o pedido não precisa esperar 10 min na fila.
    apiPost.mockResolvedValue({});
    await userEvent.click(screen.getByTestId('recusar-lote-ap-lote'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/approvals/ap-lote/reject', {}, 'tok'));
  });
});
