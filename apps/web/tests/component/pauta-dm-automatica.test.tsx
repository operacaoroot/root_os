import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PautaComentarioNaFila, PautaFilaDeComentarios } from '@mktos/shared';

/*
 * MD11 — A DM AUTOMÁTICA SOB O LOTE DA SEMANA, o lado da tela.
 *
 * No "Aprovar a semana": as regras da DM (uma por matéria) com o texto exato,
 * o teto por dia, o estado da nota e o "fica fora". Em /atendimento: a regra
 * no cartão do lote, com o texto que estranhos vão receber e o destino do
 * link. Na fila de comentários: a regra com "enviadas hoje", o Pausar com
 * motivo e o que a DM automática fez com cada linha.
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
import { AprovarASemana } from '@/app/pauta/AprovarASemana';
// eslint-disable-next-line import/first
import { ComentariosComPalavra } from '@/app/pauta/ComentariosComPalavra';
// eslint-disable-next-line import/first
import AtendimentoPage from '@/app/atendimento/page';

const TEXTO_DA_DM =
  'Mensagem automática, enviada porque você comentou AGENTES no nosso post.\n\nO link da matéria que saiu no post (Agentes de IA):\nhttps://bio.teste/r/l1';

function estado(over: Record<string, unknown> = {}) {
  return {
    episodioId: 'e4',
    apelido: 'ep-04',
    status: 'agendado',
    automaticaLigada: true,
    impedimentos: [],
    pecas: [],
    lotes: [],
    youtube: { entra: false, faltas: [], publicarEm: null, capacidades: [], noLote: null, automatica: true },
    dm: {
      automatica: false,
      regras: [
        {
          itemId: 'item-1', itemN: 1, palavra: 'AGENTES', materia: 'Agentes de IA', texto: TEXTO_DA_DM, bytes: 150, link: 'https://bio.teste/r/l1',
          destino: 'https://noticia.exemplo/agentes', janelaDe: '2026-09-28T12:00:00.000Z', janelaAte: '2026-10-05T12:00:00.000Z', tetoPorDia: 100, problema: null, noLote: null,
        },
        {
          itemId: 'item-2', itemN: 2, palavra: 'BATCH', materia: 'The Batch', texto: null, bytes: 0, link: null, destino: null, janelaDe: null, janelaAte: null,
          tetoPorDia: 100, problema: 'A matéria não tem link público (newsletter ou caixa de entrada): não há link para mandar.', noLote: null,
        },
      ],
    },
    ...over,
  };
}

function montarAprovacao() {
  const onErro = vi.fn();
  render(<AprovarASemana episodioId="e4" token="tok" podePublicar onErro={onErro} onMudou={vi.fn()} />);
  return { onErro };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiBlob.mockRejectedValue(new Error('sem imagem no teste'));
});

describe('MD11: a DM automática no "Aprovar a semana"', () => {
  it('mostra cada regra com o texto exato e o teto, diz que a nota está desligada e explica a matéria que fica de fora', async () => {
    apiGet.mockResolvedValue(estado());
    montarAprovacao();
    const dm = await screen.findByLabelText('A DM automática');
    expect(dm).toHaveTextContent('desligada — assinada, nada sai sozinho');
    expect(dm).toHaveTextContent(/a resposta segue à mão/);
    const m1 = within(dm).getByLabelText('DM da matéria 1');
    expect(m1.querySelector('pre')?.textContent).toBe(TEXTO_DA_DM);
    expect(m1).toHaveTextContent('até 100 por dia');
    expect(within(dm).getByLabelText('DM da matéria 2')).toHaveTextContent('Fica de fora: A matéria não tem link público');
    // Só com a DM, a semana ainda se aprova: é um item do lote como os posts.
    expect(screen.getByRole('button', { name: 'Aprovar a semana (1 DM automática)' })).toBeEnabled();
  });

  it('"fica fora" tira a DM do lote e vai no pedido de montagem; sem nada dentro, o botão desliga', async () => {
    apiGet.mockResolvedValue(estado({ pecas: [{ id: 'p1', formato: 'carrossel', itemN: 1, titulo: 'Carrossel', status: 'rascunho', slot: '2026-09-28T15:00:00.000Z', problema: null, noLote: null, etapa: 'proposto' }] }));
    apiPost.mockImplementation(async (url: string) => {
      if (url.endsWith('/preparar-aprovacao')) return { loteId: 'l1', hashConteudo: 'h', validaAte: 'x', itens: 1, fora: ['dm'], substituidos: [] };
      if (url.endsWith('/pedir-assinatura')) return { status: 'aguardando_aprovacao', fila: '/atendimento', expiraEm: '2026-09-28T13:10:00.000Z', approvalId: 'a1' };
      throw new Error(`rota inesperada ${url}`);
    });
    montarAprovacao();
    const dm = await screen.findByLabelText('A DM automática');
    expect(screen.getByRole('button', { name: 'Aprovar a semana (1 post + 1 DM automática)' })).toBeEnabled();
    await userEvent.click(within(dm).getByRole('checkbox', { name: 'fica fora' }));
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar a semana (1 post)' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e4/semana/preparar-aprovacao', { fora: ['dm'] }, 'tok'));
  });

  it('a regra já assinada aparece com o lote e não entra de novo; com a nota ligada, a tela diz ligada', async () => {
    const e = estado();
    const [r1, r2] = (e.dm as { regras: Array<Record<string, unknown>> }).regras;
    apiGet.mockResolvedValue({ ...e, dm: { automatica: true, regras: [{ ...r1, noLote: { loteId: 'l0', estadoDoLote: 'ativo' } }, r2] } });
    montarAprovacao();
    const dm = await screen.findByLabelText('A DM automática');
    expect(dm).toHaveTextContent('ligada');
    expect(within(dm).getByLabelText('DM da matéria 1')).toHaveTextContent('assinado e valendo');
    expect(within(dm).queryByRole('checkbox', { name: 'fica fora' })).toBeNull();
    expect(screen.getByRole('button', { name: /Aprovar a semana \(/ })).toBeDisabled();
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
  conteudo: { loteId: 'lote-1', hashConteudo: 'f'.repeat(64), totalDeItens: 1, validaAte: '2026-10-04T12:00:00.000Z' },
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
  loteId: 'lote-1', estado: 'aguardando', hashCurto: 'f00f00f00f00', validaAte: '2026-10-04T12:00:00.000Z', total: 1, divergentes: 0, handle: 'operacaoroot',
  itens: [],
  youtube: [],
  dm: [
    {
      itemId: 'dm1', apelido: 'ep-04', itemN: 1, palavra: 'AGENTES', materia: 'Agentes de IA', texto: TEXTO_DA_DM, bytes: 150, link: 'https://bio.teste/r/l1',
      destino: 'https://noticia.exemplo/agentes', pecas: [{ id: 'p1', formato: 'carrossel', titulo: 'C' }, { id: 'p3', formato: 'corte', titulo: 'K' }],
      tetoPorDia: 100, janelaDe: '2026-09-28T12:00:00.000Z', janelaAte: '2026-10-05T12:00:00.000Z', handle: 'operacaoroot', estadoDoItem: 'ativo', hashCurto: 'ddd', divergente: null,
      horario: '08:00–20:00', fuso: 'America/Sao_Paulo',
    },
  ],
};

describe('MD11: a regra da DM no cartão do lote, em /atendimento', () => {
  it('a titular lê o texto exato que estranhos vão receber, o destino do link, os posts, o teto e a janela', async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve(url.startsWith('/pauta/lotes/') ? CONTEUDO : FILA));
    render(<AtendimentoPage />);
    const cartao = await screen.findByTestId('cartao-do-lote', {}, { timeout: 4000 });
    const dm = within(cartao).getByTestId('item-da-dm-dm1');
    expect(dm).toHaveTextContent('DM automática · quem comentar AGENTES · ep-04 m1');
    expect(dm).toHaveTextContent('de @operacaoroot · até 100 por dia');
    expect(dm).toHaveTextContent('vale nos posts: carrossel e corte');
    expect(dm).toHaveTextContent('o link leva a https://noticia.exemplo/agentes');
    expect(dm.querySelector('pre')?.textContent).toBe(TEXTO_DA_DM);
    expect(dm).toHaveTextContent('150 de 1000 bytes');
    // A janela é a da política, que a MD3 deixa configurar: a titular lê a que vale.
    expect(dm).toHaveTextContent('das 08:00–20:00 (America/Sao_Paulo)');
    expect(await screen.findByRole('button', { name: 'Aprovar e executar' }, { timeout: 4000 })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------ a fila */

function linha(over: Partial<PautaComentarioNaFila> = {}): PautaComentarioNaFila {
  return {
    id: 'l1',
    usuario: 'fulano.silva',
    palavra: 'AGENTES',
    pecaId: 'p1',
    formato: 'carrossel',
    apelido: 'ep-04',
    itemN: 1,
    tituloDaPeca: 'Carrossel dos agentes',
    comentadoEm: new Date(Date.now() - 3600_000).toISOString(),
    expiraEm: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    respondidoEm: null,
    respondidoPor: null,
    texto: 'x https://bio.teste/r/l1',
    motivo: null,
    automatica: null,
    ...over,
  };
}

function fila(over: Partial<PautaFilaDeComentarios> = {}): PautaFilaDeComentarios {
  return {
    linhas: [linha()],
    textos: [],
    pendentes: 1,
    conta: { handle: 'operacaoroot', podeLerComentarios: true },
    ultimaColeta: null,
    dmAutomatica: {
      ligada: true,
      regras: [{ loteItemId: 'i1', apelido: 'ep-04', itemN: 1, palavra: 'AGENTES', estadoDoItem: 'ativo', motivoDaPausa: null, tetoPorDia: 100, enviadasHoje: 37, janelaAte: '2026-10-05T12:00:00.000Z' }],
    },
    source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    ...over,
  };
}

const secao = () => screen.getByRole('region', { name: 'Quem comentou e o que responder' });

describe('MD11: a DM automática na fila de comentários', () => {
  it('a regra mostra "enviadas hoje: 37 de 100"; Pausar pede o motivo, chama a rota e recarrega', async () => {
    apiGet.mockResolvedValueOnce(fila()).mockResolvedValueOnce(
      fila({
        dmAutomatica: {
          ligada: true,
          regras: [{ loteItemId: 'i1', apelido: 'ep-04', itemN: 1, palavra: 'AGENTES', estadoDoItem: 'revogado', motivoDaPausa: 'DM automática pausada à mão: robô', tetoPorDia: 100, enviadasHoje: 37, janelaAte: '2026-10-05T12:00:00.000Z' }],
        },
      }),
    );
    apiPost.mockResolvedValue({ estadoNovo: { estado: 'revogado' } });
    render(<ComentariosComPalavra token="tok" podeResponder editavel onErro={vi.fn()} bump={0} />);
    const dm = await within(secao()).findByLabelText('DM automática');
    const regra = within(dm).getByLabelText('Regra da DM AGENTES');
    expect(regra).toHaveTextContent('enviadas hoje: 37 de 100');
    expect(regra).toHaveTextContent('valendo');
    await userEvent.click(within(regra).getByRole('button', { name: 'Pausar' }));
    const confirmar = within(regra).getByRole('button', { name: 'Confirmar: pausar' });
    expect(confirmar).toBeDisabled();
    await userEvent.type(within(regra).getByRole('textbox', { name: 'Por que pausar' }), 'robô comentando');
    await userEvent.click(confirmar);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pauta/dm/regras/i1/pausar', { motivo: 'robô comentando' }, 'tok'));
    await waitFor(() => expect(within(secao()).getByLabelText('Regra da DM AGENTES')).toHaveTextContent('pausada'));
    expect(within(secao()).getByLabelText('Regra da DM AGENTES')).toHaveTextContent('pausada à mão: robô');
  });

  it('cada linha diz o que a DM automática fez: segurada até a janela abrir, enviada, recusada pela Meta ou sem resposta dela; sem pauta.editar não há Pausar', async () => {
    apiGet.mockResolvedValue(
      fila({
        linhas: [
          linha({ id: 'a', usuario: 'noite', automatica: { estado: 'segurado', seguradoAte: '2026-09-29T11:00:00.000Z', enviadoEm: null, motivo: null } }),
          linha({ id: 'b', usuario: 'dia', respondidoEm: '2026-09-28T13:00:00.000Z', respondidoPor: 'DM automática', automatica: { estado: 'enviado', seguradoAte: null, enviadoEm: '2026-09-28T13:00:00.000Z', motivo: null } }),
          linha({ id: 'c', usuario: 'erro', automatica: { estado: 'erro', seguradoAte: null, enviadoEm: null, motivo: 'precisa de Advanced Access (100/2534001)' } }),
          linha({ id: 'd', usuario: 'talvez', automatica: { estado: 'incerto', seguradoAte: null, enviadoEm: null, motivo: null } }),
        ],
      }),
    );
    render(<ComentariosComPalavra token="tok" podeResponder editavel={false} onErro={vi.fn()} bump={0} />);
    const noite = await within(secao()).findByRole('listitem', { name: 'Comentário de @noite' });
    expect(noite).toHaveTextContent('DM automática segurada até a janela de horário abrir (sai a partir de 29/09 08:00)');
    const dia = within(secao()).getByRole('listitem', { name: 'Comentário de @dia' });
    expect(dia).toHaveTextContent('respondido por DM automática');
    expect(dia).toHaveTextContent('DM automática enviada em 28/09 10:00');
    expect(within(secao()).getByRole('listitem', { name: 'Comentário de @erro' })).toHaveTextContent('a Meta recusou a DM automática — precisa de Advanced Access');
    const talvez = within(secao()).getByRole('listitem', { name: 'Comentário de @talvez' });
    expect(talvez).toHaveTextContent('a DM automática pode ter saído, confira no Instagram antes de responder à mão');
    expect(within(secao()).queryByRole('button', { name: 'Pausar' })).toBeNull();
  });

  it('desligada, a fila diz que a resposta é à mão', async () => {
    apiGet.mockResolvedValue(fila({ dmAutomatica: { ligada: false, regras: [] } }));
    render(<ComentariosComPalavra token="tok" podeResponder editavel onErro={vi.fn()} bump={0} />);
    const dm = await within(secao()).findByLabelText('DM automática');
    expect(dm).toHaveTextContent('desligada — a resposta é à mão');
    expect(dm).toHaveTextContent('Nenhuma regra assinada');
  });
});
