import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { formaDaAssinatura, rotuloNaLinha } from '@/app/atendimento/organizar-fila';

/*
 * /atendimento · DECIDIR SEM TROCAR DE TELA — rodada do trabalho T7 (19/10/2026).
 *
 *   · R2/R3 que cabe na linha (o mover com destino conferido, a sala versão N
 *     conferida): um clique aprova, sem abrir nada;
 *   · R4 que cabe na linha: a caixa de motivo e senha abre ali, e "Aprovar" vai
 *     junto com a senha (nada de um clique só);
 *   · conteúdo longo: o clique abre no lugar, com o botão ao lado;
 *   · vencida: "Pedir de novo" chama o servidor; o mover guarda o token NESTA aba.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a), apiPost: (...a: unknown[]) => apiPost(...a) };
});
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, user: null, can: () => true }),
}));

// eslint-disable-next-line import/first
import AtendimentoPage from '@/app/atendimento/page';

const BASE = {
  status: 'pendente',
  gaveta: 'esperando',
  nivel: 'R3',
  nivelBase: 'R3',
  canal: null,
  agente: null,
  correlationId: null,
  conteudoOculto: false,
  hashDoConteudo: 'abc',
  impedimento: null,
  gatilhos: [],
  motivoDaRegua: null,
  exigeReauth: false,
  exigeMotivo: false,
  alcadaMinima: 'responsavel',
  propostaEm: '2026-10-19T12:00:00.000Z',
  expiraEm: '2026-10-19T12:15:00.000Z',
  esperandoMs: 5 * 60_000,
  decididoPor: null,
  decididoEm: null,
  motivo: null,
  proponente: { id: 'u-ana', tipo: 'user', nome: 'Ana' },
  aprovadores: [{ id: 'u-eu', nome: 'Rodrigo', email: 'r@x', alcada: 'responsavel' }],
  euPossoAprovar: true,
  porQueNao: null,
  pedirDeNovo: null,
};

const MOVER = {
  ...BASE,
  id: 'ap-mover',
  resumo: 'Mover Construtora Alicerce de E2 · Qualificação para E3 · Reunião agendada (portões cumpridos).',
  capacidade: null,
  recurso: { tipo: 'lead', id: 'l-1' },
  alvo: 'Construtora Alicerce',
  destinoConferido: { etapa: 'reuniao_agendada', rotulo: 'E3 · Reunião agendada' },
  conteudo: null,
};

const SALA_R4 = {
  ...BASE,
  id: 'ap-sala',
  nivel: 'R4',
  exigeReauth: true,
  exigeMotivo: true,
  alcadaMinima: 'titular',
  resumo: 'comercial.sala l-2:v2',
  capacidade: 'comercial.sala.publicar',
  recurso: { tipo: 'comercial.sala', id: 'l-2:v2' },
  alvo: 'Padaria Sol',
  conteudo: { leadId: 'l-2', versao: 2, hash: 'h-sala' },
  aprovadores: [{ id: 'u-eu', nome: 'Rodrigo', email: 'r@x', alcada: 'titular' }],
};

const ZAP = {
  ...BASE,
  id: 'ap-zap',
  resumo: 'comercial.mensagem m-1',
  capacidade: 'comercial.whatsapp.enviar',
  canal: 'whatsapp',
  recurso: { tipo: 'comercial.mensagem', id: 'm-1' },
  alvo: 'Marina Duarte',
  conteudo: { leadId: 'l-3', mensagemId: 'm-1', texto: 'Oi, Marina. Segue o resumo da nossa conversa.', destino: 'lead' },
};

const VENCIDA_MOVER = {
  ...MOVER,
  id: 'ap-velha',
  gaveta: 'expirou',
  euPossoAprovar: false,
  expiraEm: '2026-10-19T11:00:00.000Z',
  porQueNao: 'O prazo deste pedido venceu sem assinatura: nada mudou. Para mudar, peça de novo.',
  pedirDeNovo: { pode: true, porQueNao: null },
};

const VENCIDA_EMAIL = {
  ...BASE,
  id: 'ap-email',
  gaveta: 'expirou',
  resumo: 'email.enviar',
  capacidade: 'email.enviar',
  recurso: { tipo: 'email.enviar', id: 'e-1' },
  conteudo: { para: 'x@y.z', assunto: 'Oi' },
  euPossoAprovar: false,
  expiraEm: '2026-10-19T11:00:00.000Z',
  porQueNao: 'O prazo desta aprovação venceu.',
  pedirDeNovo: { pode: false, porQueNao: 'O texto do e-mail foi escrito na hora e não fica guardado fora deste pedido. Escreva de novo em Google.' },
};

function fila(itens: unknown[]) {
  return {
    agora: '2026-10-19T12:05:00.000Z',
    eu: { id: 'u-eu', alcada: 'titular', decide: true, decideNestaSessao: true, veConteudo: true },
    censo: { pessoasQueDecidem: 3, porAlcada: { titular: 1, responsavel: 2, operador: 0 }, pessoasLidas: 3, pessoasAtivas: 3, truncado: false },
    itens,
    total: itens.length,
    mostrando: itens.length,
    truncado: false,
    tetos: { vivas: 100, fechadas: 60, pessoas: 500 },
  };
}

const CONTEUDO_DA_SALA = {
  leadId: 'l-2',
  versao: 2,
  estado: 'na_porta',
  conteudo: {
    nome: 'Padaria Sol',
    estacoes: [],
    proximosPassos: [{ oque: 'Kickoff', quando: '2026-10-21', comQuem: 'Rodrigo' }],
    publicados: [],
    combinado: [],
    quemCuida: null,
    whatsapp: { numero: null, rotulo: '[NÚMERO DA ROOT]' },
  },
  anterior: null,
  hashGravado: 'h-sala',
  hashDeAgora: 'h-sala',
  hashAssinado: 'h-sala',
  confere: true,
};

function rotear(itens: unknown[], sala = CONTEUDO_DA_SALA) {
  apiGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/approvals/fila')) return fila(itens);
    if (url.includes('/sala/v/')) return sala;
    throw new Error(`rota inesperada ${url}`);
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/atendimento');
});

describe('T7: a forma da assinatura (pura)', () => {
  it('mover com destino conferido em R2/R3 é um clique; R4 abre a caixa; conteúdo longo abre no lugar', () => {
    expect(formaDaAssinatura(MOVER as never)).toBe('na-linha');
    expect(formaDaAssinatura({ ...MOVER, nivel: 'R4', exigeMotivo: true, exigeReauth: true } as never)).toBe('caixa-na-linha');
    expect(formaDaAssinatura(SALA_R4 as never)).toBe('caixa-na-linha');
    expect(formaDaAssinatura({ ...SALA_R4, nivel: 'R3', exigeMotivo: false, exigeReauth: false } as never)).toBe('na-linha');
    expect(formaDaAssinatura(ZAP as never)).toBe('ler-e-aprovar');
    // mover sem destino conferido, ou impedido, nunca cabe na linha
    expect(formaDaAssinatura({ ...MOVER, destinoConferido: null } as never)).toBe('ler-e-aprovar');
    expect(formaDaAssinatura({ ...MOVER, impedimento: 'x' } as never)).toBe('ler-e-aprovar');
    expect(rotuloNaLinha('na-linha', false)).toBe('Aprovar');
    expect(rotuloNaLinha('caixa-na-linha', true)).toBe('Aprovar como titular');
  });
});

describe('T7: aprovar na linha', () => {
  it('R3 que cabe na linha: um clique aprova, sem abrir o item', async () => {
    rotear([MOVER]);
    apiPost.mockResolvedValue({ ok: true, summary: 'Mover', execucao: { status: 'nada_a_executar' } });
    render(<AtendimentoPage />);
    const botao = await screen.findByTestId('aprov-acao-ap-mover');
    expect(botao).toHaveTextContent('Aprovar');
    expect(screen.getByTestId('aprov-frase-ap-mover')).toHaveTextContent('Mover Construtora Alicerce para Reunião agendada');
    await userEvent.click(botao);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/approvals/ap-mover/confirm', {}, 'tok'));
    expect(screen.queryByTestId('item-ap-mover')).toBeNull();
  });

  it('R4 que cabe na linha: a caixa de motivo e senha abre ali, e Aprovar vai junto com a senha', async () => {
    rotear([SALA_R4]);
    apiPost.mockResolvedValue({ ok: true, summary: 'Sala', execucao: { status: 'executado', resultado: {} } });
    render(<AtendimentoPage />);
    // a versão é conferida na linha antes de o botão acender
    await waitFor(() => expect(screen.getByTestId('aprov-sala-conferida-ap-sala')).toHaveTextContent('versão 2 conferida com o hash'));
    const botao = screen.getByTestId('aprov-acao-ap-sala');
    expect(botao).toHaveTextContent('Aprovar como titular');
    await userEvent.click(botao);
    // nenhum clique só: abrir a caixa não confirma nada
    expect(apiPost).not.toHaveBeenCalled();
    const caixa = screen.getByTestId('aprov-caixa-ap-sala');
    const enviar = within(caixa).getByTestId('aprov-enviar-ap-sala');
    expect(enviar).toBeDisabled();
    expect(screen.getByTestId('aprov-motivo-ap-sala')).toHaveFocus();
    await userEvent.type(screen.getByTestId('aprov-motivo-ap-sala'), 'conferi a versão com o cliente');
    expect(enviar).toBeDisabled();
    await userEvent.type(screen.getByTestId('aprov-senha-ap-sala'), 'segredo');
    expect(enviar).toBeEnabled();
    await userEvent.click(enviar);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/approvals/ap-sala/confirm', { motivo: 'conferi a versão com o cliente', reauth: { senha: 'segredo' } }, 'tok'),
    );
    // a página inteira continua sendo a fila: nada de navegar
    expect(screen.queryByTestId('item-ap-sala')).toBeNull();
  });

  it('a sala que mudou depois do pedido não acende o botão na linha', async () => {
    rotear([SALA_R4], { ...CONTEUDO_DA_SALA, hashDeAgora: 'outro', confere: false });
    render(<AtendimentoPage />);
    await waitFor(() => expect(screen.getByTestId('aprov-sala-conferida-ap-sala')).toHaveTextContent('a versão mudou depois do pedido'));
    expect(screen.getByTestId('aprov-acao-ap-sala')).toBeDisabled();
  });

  it('conteúdo longo (WhatsApp): o clique abre no lugar e o botão fica ao lado do texto', async () => {
    rotear([ZAP]);
    apiPost.mockResolvedValue({ ok: true, summary: 'Zap', execucao: { status: 'executado', resultado: {} } });
    render(<AtendimentoPage />);
    const linha = await screen.findByTestId('aprov-acao-ap-zap');
    expect(linha).toHaveTextContent('Ler e confirmar');
    await userEvent.click(linha);
    const aberto = screen.getByTestId('item-ap-zap');
    expect(aberto).toHaveTextContent('Oi, Marina. Segue o resumo da nossa conversa.');
    // o botão vem antes de "Por que parou", logo depois do conteúdo
    const botao = within(aberto).getByRole('button', { name: 'Confirmar' });
    const porQue = within(aberto).getByText(/Por que parou em/);
    expect(botao.compareDocumentPosition(porQue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(botao);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/approvals/ap-zap/confirm', {}, 'tok'));
  });
});

describe('T7: a vencida se pede de novo', () => {
  it('não se aprova; "Pedir de novo" chama o servidor, diz quem assina e guarda o token do mover nesta aba', async () => {
    rotear([VENCIDA_MOVER, VENCIDA_EMAIL]);
    apiPost.mockResolvedValue({
      ok: true,
      anterior: 'ap-velha',
      approvalId: 'ap-nova',
      expiraEm: '2026-10-19T12:20:00.000Z',
      mensagem: 'Pedido de novo, a partir da etapa de agora. Você pediu, então não assina.',
      paraQuemPediu: {
        moverDoFunil: {
          leadId: 'l-1',
          pedido: { approvalId: 'ap-nova', token: 'tok-unico', expiraEm: '2026-10-19T12:20:00.000Z', de: 'qualificacao', para: 'reuniao_agendada', pendencias: [], resumo: 's' },
        },
      },
    });
    render(<AtendimentoPage />);
    const historico = await screen.findByTestId('aprov-grupo-historico');
    expect(within(historico).getByTestId('aprov-repediveis')).toHaveTextContent('1 vencida pode ser pedida de novo.');
    await userEvent.click(within(historico).getByTestId('aprov-historico-alternar'));

    expect(screen.queryByRole('button', { name: /^(Aprovar|Confirmar)/ })).toBeNull();
    expect(screen.getByTestId('aprov-pedir-de-novo-aviso-ap-velha')).toHaveTextContent('você vira quem pede, e outra pessoa assina');
    const botao = screen.getByTestId('aprov-pedir-de-novo-ap-velha');
    expect(botao).toHaveAttribute('title', expect.stringMatching(/Você não poderá assinar/));
    // o e-mail não tem caminho seguro: sem botão, e o porquê ao abrir
    expect(screen.queryByTestId('aprov-pedir-de-novo-ap-email')).toBeNull();
    await userEvent.click(screen.getByTestId('aprov-expandir-ap-email'));
    expect(screen.getByTestId('aprov-sem-repedido-ap-email')).toHaveTextContent('Escreva de novo em Google');

    await userEvent.click(botao);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/approvals/ap-velha/pedir-de-novo', {}, 'tok'));
    expect(await screen.findByRole('status')).toHaveTextContent('Você pediu, então não assina. O pedido vale nesta aba até');
    const guardado = JSON.parse(window.sessionStorage.getItem('comercial.mover.l-1') ?? '{}');
    expect(guardado).toMatchObject({ approvalId: 'ap-nova', token: 'tok-unico', leadId: 'l-1' });
  });
});
