import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A FILA DE APROVAÇÃO COMO TELA DE TRABALHO — fatia 3.10, RF-A-05.
 *
 * O que esta suíte prova é a regra de desenho da fatia inteira: A TELA NÃO
 * CALCULA, ELA DESENHA O QUE O SERVIDOR DECIDIU.
 *
 * Os casos decisivos são três, e todos vieram de defeito real:
 *
 *  1. O CONTEÚDO EXATO aparece. Não o resumo: o corpo da mensagem que vai sair.
 *     Quem assina precisa ler o que assina — é por isso que a aprovação é presa
 *     a um hash do conteúdo.
 *  2. A TELA NÃO OFERECE BOTÃO QUE A API VAI RECUSAR. Desde a onda 7, quem
 *     propôs não assina; a tela mostra a frase que o servidor calculou a partir
 *     do BANCO, no lugar do botão. Uma segunda conta aqui no navegador (ler os
 *     papéis do token, por exemplo) prometeria o que a trava nega.
 *  3. A RECUSA DE CONECTOR DESLIGADO é reconhecida PELO CÓDIGO, não pela frase.
 *     `ErroDaApi` e `CODIGO_CONECTOR_DESLIGADO` entram de verdade aqui (via
 *     `importActual`), então casar por substring do português reprova.
 *
 * E mais três, que vieram da reprovação da fatia:
 *
 *  4. O CONTEÚDO EXATO só aparece para quem pode DECIDIR. A fila é a primeira
 *     superfície da casa a devolver o corpo de uma ação retida; quem só
 *     acompanha vê tudo menos o texto.
 *  5. O QUE A EXECUÇÃO RECUSARIA HOJE vira explicação, não botão. As três
 *     conferências da porta (catálogo, régua de hoje, formato dos argumentos)
 *     recusam DEPOIS de a aprovação virar `confirmada` — e de lá só se recusa.
 *  6. A GAVETA "confirmada" TEM SAÍDA, e é a mesma rota de recusar que a tela já
 *     chama. Enquanto o botão ficava escondido ali, o item esperava expirar.
 *
 * O que a suíte do navegador NÃO prova, e não tem como: a MONTAGEM da resposta.
 * Aqui tudo chega simulado. Quem prova o filtro de empresa, os tetos e a
 * conferência da porta contra banco de verdade é
 * `apps/api/test/fila-de-aprovacao.test.ts`.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api', async () => {
  // O tradutor de erro e o código da recusa são os DE VERDADE; só as duas
  // funções de rede são trocadas.
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['aprovacoes.ver'] },
    can: (p: string) => p === 'aprovacoes.ver',
  }),
}));

// eslint-disable-next-line import/first
import AtendimentoPage from '@/app/atendimento/page';
// eslint-disable-next-line import/first
import { ErroDaApi, CODIGO_CONECTOR_DESLIGADO } from '@/lib/api';

/* --------------------------------------------------------------- a fila ---- */

const ITEM_BASE = {
  gaveta: 'esperando' as const,
  status: 'pendente',
  nivel: 'R3' as const,
  nivelBase: 'R2' as const,
  resumo: 'WhatsApp para o grupo Estratégia',
  capacidade: 'whatsapp.mensagem.enviar',
  canal: 'whatsapp',
  recurso: { tipo: 'whatsapp.mensagem.enviar', id: '120363@g.us' },
  agente: 'curador',
  correlationId: 'corr-1',
  conteudo: { destino: '120363@g.us', corpo: 'Bom dia — a pauta de hoje saiu às 8h.' },
  conteudoOculto: false,
  hashDoConteudo: 'a1b2c3d4e5f6',
  impedimento: null,
  gatilhos: ['destinatario_novo', 'fora_da_janela'],
  motivoDaRegua: 'escreve fora do OS com exposição externa',
  exigeReauth: false,
  exigeMotivo: false,
  alcadaMinima: 'responsavel',
  propostaEm: '2026-09-11T12:00:00.000Z',
  expiraEm: '2026-09-11T12:15:00.000Z',
  esperandoMs: 5 * 60 * 1000,
  decididoPor: null,
  decididoEm: null,
  motivo: null,
};

const DO_AGENTE = {
  ...ITEM_BASE,
  id: 'ap-agente',
  proponente: { id: 'agente', tipo: 'ai' as const, nome: 'curador' },
  aprovadores: [{ id: 'u-eu', nome: 'Pedro', email: 'p@x.com', alcada: 'titular' }],
  euPossoAprovar: true,
  porQueNao: null,
};

const QUE_EU_PROPUS = {
  ...ITEM_BASE,
  id: 'ap-meu',
  resumo: 'Publicar a peça do carrossel',
  conteudo: { pecaId: 'pc-9', canal: 'instagram' },
  proponente: { id: 'u-eu', tipo: 'user' as const, nome: 'Pedro' },
  aprovadores: [{ id: 'u-lucas', nome: 'Lucas', email: 'l@x.com', alcada: 'responsavel' }],
  euPossoAprovar: false,
  porQueNao: 'Você propôs esta ação, e quem propõe não assina. Ela precisa de outra pessoa com alçada.',
};

const SEM_NINGUEM = {
  ...ITEM_BASE,
  id: 'ap-orfa',
  resumo: 'Apagar a campanha antiga',
  nivel: 'R4' as const,
  alcadaMinima: 'titular',
  exigeMotivo: true,
  exigeReauth: true,
  conteudo: { campanhaId: 'cmp-1' },
  proponente: { id: 'u-eu', tipo: 'user' as const, nome: 'Pedro' },
  aprovadores: [],
  euPossoAprovar: false,
  porQueNao: 'Você propôs esta ação, e quem propõe não assina. Ela precisa de outra pessoa com alçada.',
};

function fila(
  itens: unknown[],
  censo = { titular: 1, responsavel: 0, operador: 0 },
  extra: { decide?: boolean; total?: number } = {},
) {
  const decide = extra.decide ?? true;
  const total = extra.total ?? itens.length;
  return {
    agora: '2026-09-11T12:05:00.000Z',
    /*
     * `decideNestaSessao` é o que governa o botão: o banco e o token têm de
     * concordar. `veConteudo` acompanha — o corpo exato só vai para quem assina.
     */
    eu: { id: 'u-eu', alcada: 'titular', decide, decideNestaSessao: decide, veConteudo: decide },
    censo: {
      pessoasQueDecidem: censo.titular + censo.responsavel + censo.operador,
      porAlcada: censo,
      pessoasLidas: 3,
      pessoasAtivas: 3,
      truncado: false,
    },
    itens,
    total,
    mostrando: itens.length,
    truncado: total > itens.length,
    tetos: { vivas: 100, fechadas: 60, pessoas: 500 },
  };
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

/* ------------------------------------------------------- o que a fila mostra */

describe('a fila mostra o que quem assina precisa ler', () => {
  it('desenha o CONTEÚDO EXATO que vai ser executado, não só o resumo', async () => {
    apiGet.mockResolvedValue(fila([DO_AGENTE]));
    render(<AtendimentoPage />);

    // o corpo da mensagem, literal — é o que a pessoa está assinando
    expect(await screen.findByText('Bom dia — a pauta de hoje saiu às 8h.')).toBeInTheDocument();
    expect(screen.getByText('120363@g.us')).toBeInTheDocument();
    // e o hash que prende a aprovação a esse texto
    expect(screen.getByText(/a1b2c3d4e5f6/)).toBeInTheDocument();
  });

  it('o hash é apresentado como identificador, NÃO como assinatura conferida', async () => {
    /*
     * O rótulo antigo dizia "assinatura do conteúdo", e prometia uma
     * verificação que não acontece em lugar nenhum desta tela: ninguém
     * recalcula o hash sobre o texto acima, nem aqui nem na rota que alimenta a
     * fila. Quem confere de verdade é a porta, na hora de propor. Rótulo que
     * promete prova é pior do que rótulo nenhum — ele convida a confiar.
     */
    apiGet.mockResolvedValue(fila([DO_AGENTE]));
    render(<AtendimentoPage />);

    await screen.findByTestId('item-ap-agente');
    expect(screen.getByText(/não conferido aqui/i)).toBeInTheDocument();
    expect(screen.queryByText(/assinatura do conteúdo/i)).not.toBeInTheDocument();
  });

  it('pede a fila ao servidor, e só a ele', async () => {
    apiGet.mockResolvedValue(fila([DO_AGENTE]));
    render(<AtendimentoPage />);
    await screen.findByTestId('item-ap-agente');
    expect(apiGet).toHaveBeenCalledWith('/approvals/fila', 'tok');
  });

  it('mostra o nível e os gatilhos que o SERVIDOR acendeu', async () => {
    // O servidor manda R3 com dois sinais. A tela não classifica nada: se ela
    // tivesse uma cópia da régua, desenharia outro degrau.
    apiGet.mockResolvedValue(fila([DO_AGENTE]));
    render(<AtendimentoPage />);

    expect(await screen.findByTestId('nivel-ap-agente')).toHaveTextContent('R3');
    expect(screen.getByTestId('gatilho-destinatario_novo')).toBeInTheDocument();
    expect(screen.getByTestId('gatilho-fora_da_janela')).toBeInTheDocument();
    // o degrau subiu: o efeito dava R2
    expect(screen.getByText(/o efeito da capacidade dá R2/)).toBeInTheDocument();
  });

  it('diz quem pode aprovar, com a alçada de cada um', async () => {
    apiGet.mockResolvedValue(fila([QUE_EU_PROPUS]));
    render(<AtendimentoPage />);

    const lista = await screen.findByTestId('aprovadores-ap-meu');
    expect(within(lista).getByText('Lucas')).toBeInTheDocument();
    expect(within(lista).getByText('· responsavel')).toBeInTheDocument();
  });

  it('separa o que espera do que já foi recusado', async () => {
    apiGet.mockResolvedValue(
      fila([DO_AGENTE, { ...QUE_EU_PROPUS, id: 'ap-no', gaveta: 'recusada', status: 'rejeitada' }]),
    );
    render(<AtendimentoPage />);

    expect(await screen.findByText(/Esperando decisão/)).toBeInTheDocument();
    expect(screen.getByText(/^Recusada/)).toBeInTheDocument();
  });
});

/* ------------------------------------------- não oferecer botão que recusa -- */

describe('a tela não oferece botão que a API vai recusar', () => {
  it('quem propôs não vê "aprovar" — vê o motivo', async () => {
    apiGet.mockResolvedValue(fila([QUE_EU_PROPUS]));
    render(<AtendimentoPage />);

    await screen.findByTestId('item-ap-meu');
    expect(screen.queryByRole('button', { name: /aprovar e executar/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('porque-nao-ap-meu')).toHaveTextContent(/quem propõe não assina/i);
  });

  it('mas oferece cancelar o que eu mesmo propus — rejeitar não pede alçada', async () => {
    // Do lado da API, `reject` pede gente ativa com a permissão de decidir, e
    // NÃO proíbe o proponente. Esconder este botão seria a tela mais restritiva
    // do que a regra, que é o mesmo erro de sinal trocado.
    apiGet.mockResolvedValue(fila([QUE_EU_PROPUS]));
    apiPost.mockResolvedValue({ ok: true });
    render(<AtendimentoPage />);

    await userEvent.click(await screen.findByRole('button', { name: /cancelar o que eu propus/i }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/approvals/ap-meu/reject', {}, 'tok'));
  });

  it('quando ninguém da empresa pode assinar, a tela diz isso em vez de parecer quebrada', async () => {
    apiGet.mockResolvedValue(fila([SEM_NINGUEM]));
    render(<AtendimentoPage />);

    const caixa = await screen.findByTestId('sem-aprovador-ap-orfa');
    expect(caixa).toHaveTextContent(/Ninguém desta empresa pode assinar/i);
    expect(caixa).toHaveTextContent(/titular/);
    expect(screen.queryByRole('button', { name: /aprovar e executar/i })).not.toBeInTheDocument();
  });

  it('e avisa, no topo, que a empresa tem uma pessoa só com alçada', async () => {
    apiGet.mockResolvedValue(fila([SEM_NINGUEM], { titular: 1, responsavel: 0, operador: 0 }));
    render(<AtendimentoPage />);

    const alerta = await screen.findByTestId('censo-alerta');
    expect(alerta).toHaveTextContent(/uma pessoa só com alçada/i);
    expect(alerta).toHaveTextContent(/regra de duas pessoas/i);
  });

  it('com duas pessoas decidindo, o aviso some', async () => {
    apiGet.mockResolvedValue(fila([DO_AGENTE], { titular: 1, responsavel: 1, operador: 0 }));
    render(<AtendimentoPage />);

    await screen.findByTestId('item-ap-agente');
    expect(screen.queryByTestId('censo-alerta')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- aprovar ----- */

describe('aprovar executa e fecha o evento', () => {
  it('confirma e mostra o desfecho da execução', async () => {
    apiGet.mockResolvedValue(fila([DO_AGENTE]));
    apiPost.mockResolvedValue({
      ok: true,
      summary: 'WhatsApp para o grupo Estratégia',
      execucao: { status: 'executado', resultado: { id: 'msg-1' } },
    });
    render(<AtendimentoPage />);

    await userEvent.click(await screen.findByRole('button', { name: /aprovar e executar/i }));

    // corpo VAZIO: R3 não exige motivo nem reautenticação, e o schema do corpo
    // é `.strict()` — mandar campo a mais é 400.
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/approvals/ap-agente/confirm', {}, 'tok'),
    );
    expect(await screen.findByText(/Aprovada e EXECUTADA/)).toBeInTheDocument();
  });

  it('em R4 manda o motivo escrito e a senha, porque a aprovação exige', async () => {
    const r4 = {
      ...DO_AGENTE,
      id: 'ap-r4',
      nivel: 'R4' as const,
      exigeMotivo: true,
      exigeReauth: true,
    };
    apiGet.mockResolvedValue(fila([r4]));
    apiPost.mockResolvedValue({ ok: true, summary: 'x', execucao: { status: 'executado', resultado: 1 } });
    render(<AtendimentoPage />);

    await screen.findByTestId('item-ap-r4');
    await userEvent.type(screen.getByRole('textbox'), 'cliente confirmou por telefone');
    await userEvent.type(document.querySelector('input[type="password"]')!, 'senha-secreta');
    await userEvent.click(screen.getByRole('button', { name: /aprovar e executar/i }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/approvals/ap-r4/confirm',
        { motivo: 'cliente confirmou por telefone', reauth: { senha: 'senha-secreta' } },
        'tok',
      ),
    );
  });

  it('avisa quando a ação foi aprovada e o efeito não está ligado', async () => {
    apiGet.mockResolvedValue(fila([DO_AGENTE]));
    apiPost.mockResolvedValue({
      ok: true,
      summary: 'x',
      execucao: { status: 'sem_efeito', motivo: '"x" está aprovada, mas o efeito não está ligado.' },
    });
    render(<AtendimentoPage />);

    await userEvent.click(await screen.findByRole('button', { name: /aprovar e executar/i }));
    expect(await screen.findByText(/NÃO executada/)).toBeInTheDocument();
  });
});

/* ------------------------------------------------- conector desligado ------ */

describe('a recusa por conector desligado é reconhecida pelo CÓDIGO', () => {
  it('mostra o caminho de conserto e diz que a aprovação continua na fila', async () => {
    apiGet.mockResolvedValue(fila([DO_AGENTE]));
    apiPost.mockRejectedValue(
      new ErroDaApi(
        'O conector "WhatsApp" está desligado para esta empresa desde 11/09/2026.',
        403,
        CODIGO_CONECTOR_DESLIGADO,
      ),
    );
    render(<AtendimentoPage />);

    await userEvent.click(await screen.findByRole('button', { name: /aprovar e executar/i }));

    expect(await screen.findByText(/está desligado para esta empresa/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /religar em Conexões/i });
    expect(link).toHaveAttribute('href', '/conexoes');
    expect(screen.getByText(/continua PENDENTE na fila/)).toBeInTheDocument();
  });

  it('outra recusa qualquer NÃO ganha o caminho de Conexões', async () => {
    // A decisão é pelo código. Casar por substring da frase em português faria
    // esta recusa (que também fala em conector) abrir o caminho errado.
    apiGet.mockResolvedValue(fila([DO_AGENTE]));
    apiPost.mockRejectedValue(
      new ErroDaApi('Alçada insuficiente para aprovar R3: o conector não tem nada com isso.', 403),
    );
    render(<AtendimentoPage />);

    await userEvent.click(await screen.findByRole('button', { name: /aprovar e executar/i }));

    expect(await screen.findByText(/Alçada insuficiente/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /religar em Conexões/i })).not.toBeInTheDocument();
  });
});

/* ----------------------------------------------- o conteúdo é de quem assina */

describe('o conteúdo exato só aparece para quem pode decidir', () => {
  /*
   * ESTA É A EXPOSIÇÃO QUE A FATIA CRIOU, e vale escrever por extenso: até ela,
   * NENHUMA rota do produto devolvia por HTTP os argumentos de uma chamada de
   * ferramenta. O RASTRO troca conteúdo `confidencial` por resumo criptográfico;
   * a redação que a porta grava em `ToolCall.args` só alcança `restrita`. O
   * corpo de uma mensagem de WhatsApp — que é `confidencial` — está em claro na
   * coluna, e esta tela é o primeiro lugar de onde ele sai.
   *
   * A regra é do Pedro, não do agente: o texto vai só para quem pode DECIDIR,
   * porque é a assinatura informada que justifica a exposição.
   */
  it('quem só ACOMPANHA a fila recebe tudo, menos o texto', async () => {
    const semConteudo = {
      ...DO_AGENTE,
      conteudo: null,
      conteudoOculto: true,
      euPossoAprovar: false,
      porQueNao: 'Seu perfil acompanha a fila, mas não decide nela (falta "aprovacoes.decidir").',
    };
    apiGet.mockResolvedValue(fila([semConteudo], undefined, { decide: false }));
    render(<AtendimentoPage />);

    // a fila continua inteira: nível, gatilhos, prazo, quem assina
    expect(await screen.findByTestId('nivel-ap-agente')).toHaveTextContent('R3');
    expect(screen.getByTestId('gatilho-destinatario_novo')).toBeInTheDocument();

    // o texto, não
    expect(screen.queryByText('Bom dia — a pauta de hoje saiu às 8h.')).not.toBeInTheDocument();
    expect(screen.getByTestId('conteudo-oculto')).toHaveTextContent(/só aparece para quem pode/i);
    expect(screen.getByText(/sem o conteúdo das ações/i)).toBeInTheDocument();
  });

  it('e "oculto por permissão" não se confunde com "não há argumento"', async () => {
    // Os dois chegam como `conteudo: null`. Dizer "a ação não leva argumento
    // nenhum" para quem só não pode ler seria mentir sobre o que existe do
    // outro lado — e sobre o que está prestes a sair da casa.
    const semArgumento = { ...DO_AGENTE, conteudo: {}, conteudoOculto: false };
    apiGet.mockResolvedValue(fila([semArgumento]));
    render(<AtendimentoPage />);

    expect(await screen.findByText(/não leva argumento nenhum/i)).toBeInTheDocument();
    expect(screen.queryByTestId('conteudo-oculto')).not.toBeInTheDocument();
  });
});

/* ------------------------------------- o que a execução recusaria hoje ----- */

describe('impedimento: a tela explica em vez de oferecer botão', () => {
  const IMPEDIDO = {
    ...DO_AGENTE,
    id: 'ap-impedido',
    impedimento:
      'Os argumentos gravados na proposta não casam mais com o formato de ' +
      '"whatsapp.mensagem.enviar": campo desconhecido "destino". Nada foi enviado e a aprovação ' +
      'NÃO foi consumida — o caminho é propor de novo com os argumentos no formato de hoje.',
    euPossoAprovar: false,
    porQueNao:
      'Os argumentos gravados na proposta não casam mais com o formato de ' +
      '"whatsapp.mensagem.enviar": campo desconhecido "destino".',
  };

  it('mostra o motivo da porta e não oferece "aprovar e executar"', async () => {
    /*
     * As três conferências da porta (capacidade fora do catálogo, régua de hoje
     * que não permite, argumentos fora do formato) recusam DEPOIS de a aprovação
     * virar `confirmada` — e de `confirmada` não se confirma de novo. Oferecer o
     * botão aqui é empurrar o item para a gaveta de onde só se recusa.
     */
    apiGet.mockResolvedValue(fila([IMPEDIDO]));
    render(<AtendimentoPage />);

    expect(await screen.findByTestId('impedimento-ap-impedido')).toHaveTextContent(
      /não casam mais com o formato/i,
    );
    expect(screen.queryByRole('button', { name: /aprovar e executar/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('porque-nao-ap-impedido')).toHaveTextContent(
      /não casam mais com o formato/i,
    );
  });

  it('e quem pode decidir ainda consegue RECUSAR o item impedido', async () => {
    // Recusar é a única saída de um item que a execução não aceita mais. Sem
    // este botão ele fica na fila até expirar, ocupando a atenção de todo mundo.
    apiGet.mockResolvedValue(fila([IMPEDIDO]));
    apiPost.mockResolvedValue({ ok: true });
    render(<AtendimentoPage />);

    await userEvent.click(await screen.findByTestId('recusar-ap-impedido'));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/approvals/ap-impedido/reject', {}, 'tok'),
    );
  });
});

/* ------------------------------- a gaveta "confirmada" tem saída ----------- */

describe('a gaveta "confirmada, aguardando execução" não é beco sem saída', () => {
  const NO_LIMBO = {
    ...DO_AGENTE,
    id: 'ap-limbo',
    gaveta: 'confirmada' as const,
    status: 'confirmada',
    decididoPor: 'Pedro',
    decididoEm: '2026-09-11T12:03:00.000Z',
    euPossoAprovar: false,
    porQueNao: 'Já foi confirmada e a execução não concluiu. […] daqui só se recusa.',
  };

  it('oferece RECUSAR, que é a mesma rota que a tela já chama', async () => {
    /*
     * A afirmação anterior desta tela — "só um script tira de lá" — era falsa:
     * `reject` aceita `pendente` E `confirmada` (`approvals.service.ts`), e
     * nenhum script do repositório tira uma aprovação dali (todos confirmam).
     * A saída sempre esteve a uma linha de interface.
     */
    apiGet.mockResolvedValue(fila([NO_LIMBO]));
    apiPost.mockResolvedValue({ ok: true });
    render(<AtendimentoPage />);

    const botao = await screen.findByTestId('recusar-ap-limbo');
    expect(botao).toHaveTextContent(/recusar e tirar da fila/i);
    await userEvent.click(botao);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/approvals/ap-limbo/reject', {}, 'tok'),
    );
  });

  it('e o texto da gaveta descreve as QUATRO causas, não só o conector', async () => {
    // Nomear só o conector desligado era o pior dos dois mundos: é justamente a
    // única das quatro que a fila pergunta ANTES de confirmar — ou seja, a menos
    // provável de ter posto o item ali.
    apiGet.mockResolvedValue(fila([NO_LIMBO]));
    render(<AtendimentoPage />);

    const texto = (await screen.findByText(/Quatro coisas param uma ação já confirmada/i))
      .textContent!;
    expect(texto).toMatch(/conector do canal foi desligado/i);
    expect(texto).toMatch(/saiu do catálogo/i);
    expect(texto).toMatch(/régua de hoje/i);
    expect(texto).toMatch(/argumentos gravados não casam/i);
  });

  it('"quem pode aprovar" some das gavetas já decididas', async () => {
    // A seção afirmava que "a ação fica retida até <prazo> — nada sai", o que é
    // falso sobre uma linha já confirmada e sobre uma que venceu semana passada.
    apiGet.mockResolvedValue(fila([{ ...NO_LIMBO, aprovadores: [] }]));
    render(<AtendimentoPage />);

    await screen.findByTestId('item-ap-limbo');
    expect(screen.queryByText('Quem pode aprovar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sem-aprovador-ap-limbo')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------- o teto não corta em silêncio -- */

describe('o teto da fila se anuncia', () => {
  it('quando há mais aprovações do que couberam, a tela diz quantas faltam', async () => {
    // `total` é o TOTAL (por `count`), não `itens.length`. Enquanto era o
    // segundo, uma empresa com 300 ações esperando lia "100 esperando" e
    // acreditava — e item que não aparece é item que ninguém decide.
    apiGet.mockResolvedValue(fila([DO_AGENTE], undefined, { total: 312 }));
    render(<AtendimentoPage />);

    const alerta = await screen.findByTestId('corte-alerta');
    expect(alerta).toHaveTextContent(/312 aprovações/);
    expect(alerta).toHaveTextContent(/mostrando 1/);
  });

  it('e some quando nada foi cortado', async () => {
    apiGet.mockResolvedValue(fila([DO_AGENTE]));
    render(<AtendimentoPage />);

    await screen.findByTestId('item-ap-agente');
    expect(screen.queryByTestId('corte-alerta')).not.toBeInTheDocument();
  });
});
