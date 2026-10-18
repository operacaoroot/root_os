import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * /atendimento LEGÍVEL — rodada do painel P4 (18/10/2026). Só forma.
 *
 * Esta suíte prova a tela nova por cima da mesma resposta de sempre:
 * três grupos, a linha compacta com o pedido em português, os contadores, o
 * filtro por tipo na query e os estados vazios que explicam. As travas (quem
 * propôs não assina, o lote só com o cartão, a senha e o motivo) são de
 * `atendimento.test.tsx` e `pauta-lote-da-semana.test.tsx`, que continuam lá.
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
  propostaEm: '2026-10-18T12:00:00.000Z',
  expiraEm: '2026-10-18T12:15:00.000Z',
  esperandoMs: 5 * 60_000,
  decididoPor: null,
  decididoEm: null,
  motivo: null,
};

const POSSO = {
  ...BASE,
  id: 'ap-zap',
  gaveta: 'esperando',
  resumo: 'comercial.mensagem m-1',
  capacidade: 'comercial.whatsapp.enviar',
  canal: 'whatsapp',
  recurso: { tipo: 'comercial.mensagem', id: 'm-1' },
  alvo: 'Marina Duarte',
  conteudo: { leadId: 'l-1', mensagemId: 'm-1', texto: 'Oi, Marina', destino: 'lead' },
  proponente: { id: 'u-ana', tipo: 'user', nome: 'Ana' },
  aprovadores: [{ id: 'u-eu', nome: 'Rodrigo', email: 'r@x', alcada: 'responsavel' }],
  euPossoAprovar: true,
  porQueNao: null,
};

const PROPUS = {
  ...BASE,
  id: 'ap-mover',
  gaveta: 'esperando',
  resumo: 'Mover Construtora Alicerce de E5 · Diagnóstico para E6 · Proposta (portões cumpridos). Pedido por Rodrigo pela tela do funil.',
  capacidade: null,
  recurso: { tipo: 'lead', id: 'l-2' },
  alvo: 'Construtora Alicerce',
  conteudo: null,
  proponente: { id: 'u-eu', tipo: 'user', nome: 'Rodrigo' },
  aprovadores: [{ id: 'u-ana', nome: 'Ana', email: 'a@x', alcada: 'responsavel' }],
  euPossoAprovar: false,
  porQueNao: 'Você propôs esta ação, e quem propõe não assina. Ela precisa de outra pessoa com alçada.',
};

const FALTA_TITULAR = {
  ...BASE,
  id: 'ap-lote',
  gaveta: 'esperando',
  nivel: 'R4',
  exigeReauth: true,
  exigeMotivo: true,
  alcadaMinima: 'titular',
  resumo: 'Semana de ep-12: 4 post(s) no @operacaoroot',
  capacidade: 'pauta.semana.aprovar',
  recurso: { tipo: 'pauta.semana.aprovar', id: 'lote-1' },
  conteudo: { loteId: 'lote-1' },
  proponente: { id: 'u-ana', tipo: 'user', nome: 'Ana' },
  aprovadores: [{ id: 'u-li', nome: 'Lidiane', email: 'l@x', alcada: 'titular' }],
  euPossoAprovar: false,
  porQueNao: 'Esta ação exige alçada "titular" e a sua é "responsavel".',
};

const VENCIDA = {
  ...BASE,
  id: 'ap-velha',
  gaveta: 'expirou',
  resumo: 'x',
  capacidade: 'instagram.post.publicar',
  recurso: { tipo: 'instagram.post.publicar', id: 'p' },
  conteudo: { formato: 'story', legenda: 'Bom dia' },
  expiraEm: '2026-10-17T12:00:00.000Z',
  proponente: { id: 'agente', tipo: 'ai', nome: 'curador' },
  aprovadores: [],
  euPossoAprovar: false,
  porQueNao: 'O prazo desta aprovação venceu.',
};

const RECUSADA = {
  ...VENCIDA,
  id: 'ap-nao',
  gaveta: 'recusada',
  status: 'rejeitada',
  capacidade: 'email.enviar',
  conteudo: { para: 'cliente@x.com', assunto: 'Contrato' },
  decididoPor: 'Ana',
  decididoEm: '2026-10-18T11:00:00.000Z',
};

function fila(itens: unknown[]) {
  return {
    agora: '2026-10-18T12:05:00.000Z',
    eu: { id: 'u-eu', alcada: 'responsavel', decide: true, decideNestaSessao: true, veConteudo: true },
    censo: { pessoasQueDecidem: 3, porAlcada: { titular: 1, responsavel: 2, operador: 0 }, pessoasLidas: 3, pessoasAtivas: 3, truncado: false },
    itens,
    total: itens.length,
    mostrando: itens.length,
    truncado: false,
    tetos: { vivas: 100, fechadas: 60, pessoas: 500 },
  };
}

const TODOS = [POSSO, PROPUS, FALTA_TITULAR, VENCIDA, RECUSADA];

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  window.history.replaceState(null, '', '/atendimento');
});
afterEach(() => window.history.replaceState(null, '', '/atendimento'));

describe('P4: os três grupos', () => {
  it('eu posso em "Depende de você"; eu propus e falta a titular em "Aguardando outra pessoa"; vencida e recusada no histórico recolhido', async () => {
    apiGet.mockResolvedValue(fila(TODOS));
    render(<AtendimentoPage />);

    const voce = await screen.findByTestId('aprov-grupo-voce');
    const outra = screen.getByTestId('aprov-grupo-outra');
    const historico = screen.getByTestId('aprov-grupo-historico');

    expect(within(voce).getByTestId('aprov-item-ap-zap')).toBeInTheDocument();
    expect(within(outra).getByTestId('aprov-item-ap-mover')).toBeInTheDocument();
    expect(within(outra).getByTestId('aprov-item-ap-lote')).toBeInTheDocument();
    expect(within(outra).getByTestId('aprov-espera-ap-mover')).toHaveTextContent('Você pediu: assina outra pessoa · Pode assinar: Ana');
    expect(within(outra).getByTestId('aprov-espera-ap-lote')).toHaveTextContent('Falta a titular · Pode assinar: Lidiane');

    // o histórico conta, mas nasce recolhido
    expect(historico).toHaveTextContent('Decididas e vencidas 2');
    expect(within(historico).queryByTestId('aprov-item-ap-velha')).toBeNull();
    const alternar = within(historico).getByTestId('aprov-historico-alternar');
    expect(alternar).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(alternar);
    expect(alternar).toHaveAttribute('aria-expanded', 'true');
    expect(within(historico).getByTestId('aprov-item-ap-velha')).toHaveTextContent('venceu 17/10 09:00');
    expect(within(historico).getByTestId('aprov-item-ap-nao')).toHaveTextContent('recusada por Ana 18/10 08:00');
    // no histórico não há passo nenhum
    expect(within(historico).queryAllByRole('button', { name: /confirmar|assinar|recusar/i })).toHaveLength(0);
  });

  it('a linha diz quem pediu, o quê em português, o nível em palavras, há quanto tempo e quando vence', async () => {
    apiGet.mockResolvedValue(fila(TODOS));
    render(<AtendimentoPage />);

    const zap = await screen.findByTestId('aprov-item-ap-zap');
    expect(screen.getByTestId('aprov-frase-ap-zap')).toHaveTextContent('Enviar WhatsApp para Marina Duarte');
    expect(zap).toHaveTextContent('Ana');
    expect(zap).toHaveTextContent('R3: pede uma segunda pessoa');
    expect(zap).toHaveTextContent('há 5 min · vence em 10 min');
    expect(within(zap).getByTestId('aprov-acao-ap-zap')).toHaveTextContent('Ler e confirmar');
    expect(within(zap).getByTestId('aprov-recusar-ap-zap')).toHaveTextContent('Recusar');

    expect(screen.getByTestId('aprov-frase-ap-mover')).toHaveTextContent('Mover Construtora Alicerce para Proposta');
    expect(screen.getByTestId('aprov-frase-ap-lote')).toHaveTextContent('Aprovar a semana do episódio 12');
    // o texto inteiro vai no title, para a linha cortar com reticências sem perder nada
    expect(screen.getByTitle('Ana · Aprovar a semana do episódio 12')).toBeInTheDocument();
    // quem propôs tem só o "cancelar"
    expect(screen.queryByTestId('aprov-acao-ap-mover')).toBeNull();
    expect(screen.getByTestId('aprov-recusar-ap-mover')).toHaveTextContent('Cancelar o que eu propus');
  });

  it('expandir mostra o conteúdo exato, e o passo de dentro é o que confirma, pelo mesmo endpoint', async () => {
    apiGet.mockResolvedValue(fila(TODOS));
    apiPost.mockResolvedValue({ ok: true, summary: 'x', execucao: { status: 'executado', resultado: {} } });
    render(<AtendimentoPage />);

    const expandir = await screen.findByTestId('aprov-expandir-ap-zap');
    expect(expandir).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(screen.getByTestId('aprov-acao-ap-zap'));
    expect(expandir).toHaveAttribute('aria-expanded', 'true');
    const aberto = screen.getByTestId('item-ap-zap');
    expect(aberto).toHaveFocus();
    expect(within(aberto).getByText('Oi, Marina')).toBeInTheDocument();
    expect(within(aberto).getByTestId('aprov-condicoes-ap-zap')).toHaveTextContent('Outra pessoa que não quem pediu (Ana)');
    await userEvent.click(within(aberto).getByTestId('aprov-acao-ap-zap'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/approvals/ap-zap/confirm', {}, 'tok'));
  });
});

describe('P4: contadores e filtro', () => {
  it('o topo conta o que espera você e o que vence hoje', async () => {
    apiGet.mockResolvedValue(fila(TODOS));
    render(<AtendimentoPage />);
    expect(await screen.findByTestId('aprov-contador-voce')).toHaveTextContent('aguardando você 1');
    expect(screen.getByTestId('aprov-contador-hoje')).toHaveTextContent('vencendo hoje 3');
  });

  it('filtrar por tipo grava na query, esconde os outros e não mexe nos contadores', async () => {
    apiGet.mockResolvedValue(fila(TODOS));
    render(<AtendimentoPage />);

    const lote = await screen.findByTestId('aprov-filtro-lote');
    expect(lote).toHaveTextContent('Lote da semana 1');
    expect(screen.getByTestId('aprov-filtro-todos')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(lote);
    expect(lote).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toBe('?tipo=lote');
    expect(screen.getByTestId('aprov-item-ap-lote')).toBeInTheDocument();
    expect(screen.queryByTestId('aprov-item-ap-zap')).toBeNull();
    expect(screen.getByTestId('aprov-vazio-voce')).toHaveTextContent('Nada esperando por você em Lote da semana.');
    expect(screen.getByTestId('aprov-contador-voce')).toHaveTextContent('aguardando você 1');

    await userEvent.click(screen.getByTestId('aprov-filtro-todos'));
    expect(window.location.search).toBe('');
    expect(screen.getByTestId('aprov-item-ap-zap')).toBeInTheDocument();
  });

  it('o filtro vem da query ao abrir a tela', async () => {
    window.history.replaceState(null, '', '/atendimento?tipo=comercial');
    apiGet.mockResolvedValue(fila(TODOS));
    render(<AtendimentoPage />);
    expect(await screen.findByTestId('aprov-item-ap-mover')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('aprov-filtro-comercial')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.queryByTestId('aprov-item-ap-lote')).toBeNull();
  });
});

describe('P4: estados vazios que explicam', () => {
  it('sem nada na fila, cada grupo diz o que significa e que não há nada', async () => {
    apiGet.mockResolvedValue(fila([]));
    render(<AtendimentoPage />);
    const voce = await screen.findByTestId('aprov-grupo-voce');
    expect(within(voce).getByTestId('aprov-vazio-voce')).toHaveTextContent('Nada esperando por você.');
    expect(voce).toHaveTextContent('O que você pode assinar agora');
    const outra = screen.getByTestId('aprov-grupo-outra');
    expect(within(outra).getByTestId('aprov-vazio-outra')).toHaveTextContent('Nada esperando outra pessoa.');
    expect(outra).toHaveTextContent('quem pede não assina');
    expect(screen.getByTestId('aprov-grupo-historico')).toHaveTextContent('Nada daqui saiu da casa.');
    expect(screen.getByTestId('aprov-contador-voce')).toHaveTextContent('aguardando você 0');
  });
});
