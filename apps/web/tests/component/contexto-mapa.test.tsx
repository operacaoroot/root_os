import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * ============================================================================
 * O MAPA DO CONTEXTO — fatia 4.4, RF-M-04 e RF-B-01
 * ============================================================================
 *
 * O critério de pronto da fatia tem três frases, e cada uma delas é fácil de
 * fingir. Esta suíte existe para que fingir fique vermelho:
 *
 *  1. CLICAR NUM NÓ ABRE O REGISTRO REAL. Não é um balão com o nome do ponto: a
 *     nota vai buscar `GET /memoria/:id` e `GET /memoria/:id/versoes`, o agente
 *     vai buscar `GET /agents/:slug`, e a gaveta mostra corpo, procedência,
 *     histórico e procedimento;
 *  2. EMPRESA VAZIA ENSINA COMO CARREGAR. Com os eixos de contexto vazios, a
 *     tela não desenha mapa nenhum: ela mostra o caminho de carga, e o botão
 *     daquele caminho chama a rota que de fato relê a vault;
 *  3. NÃO HÁ DADO DE EXEMPLO FIXO NO FRONT. Zero registro, zero ponto. O que
 *     aparece no desenho é exatamente o que as rotas devolveram.
 *
 * E mais três que a revisão cobra, e que num mapa custam caro:
 *
 *  4. O NÚMERO É O DA API. A memória que declara `total: 12` aparece como 12,
 *     mesmo que a listagem tenha devolvido menos linhas do que isso;
 *  5. ZERO NÃO É "NÃO SEI". Eixo sem permissão e eixo que falhou dizem isso, e
 *     NENHUM dos dois deixa a tela declarar a empresa vazia — nem quando é um só
 *     no meio de eixos vazios, que é o caso misto que a versão anterior desta
 *     suíte não cobria;
 *  6. LINHA SÓ ONDE HÁ VÍNCULO DECLARADO. O mapa não deduz relação.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTA SUÍTE APRENDEU A PEGAR, E ANTES NÃO PEGAVA
 * ----------------------------------------------------------------------------
 * Dezoito casos passavam enquanto o clique do mouse não abria NADA em navegador
 * de verdade. A causa era `setPointerCapture` no `pointerdown` da raiz do SVG: o
 * `pointerup` era redirecionado para a raiz e o `click` nascia no ancestral
 * comum — a própria raiz —, com o grupo do ponto fora do caminho de propagação.
 * O jsdom não implementa captura de ponteiro nem a classe `PointerEvent`, então
 * a linha virava coisa nenhuma e `userEvent.click` disparava direto no elemento.
 *
 * Por isso há aqui um clique DE MOUSE DE VERDADE (`cliqueDeMouse`), com a
 * captura de ponteiro emulada e o redirecionamento que o navegador faz — e uma
 * catraca (`captura.elemento`) que proíbe capturar o ponteiro no elemento que
 * hospeda os nós clicáveis enquanto o gesto ainda pode ser clique. Teste que não
 * pode ficar vermelho não é teste.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
  };
});

let PERMISSOES: string[] = [
  'obsidian.ver',
  'obsidian.editar',
  'mcp.ver',
  'automacoes.ver',
  'dashboard.ver',
];

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// eslint-disable-next-line import/first
import { ErroDaApi } from '@/lib/api';
// eslint-disable-next-line import/first
import ContextoPage from '@/app/contexto/page';
// eslint-disable-next-line import/first
import {
  montarMapa,
  estadoDaEmpresa,
  DESCIDA_DO_ROTULO,
  DESLOCAMENTO_DO_ROTULO,
  DISTANCIA_MINIMA_ENTRE_PONTOS,
  LADO,
  METADE_DO_ROTULO,
  RAIO_DO_NO,
  TETO_POR_EIXO,
  type FontesDoMapa,
} from '@/app/contexto/grafo';

/* --------------------------------------------------- o mouse de verdade -- */

/*
 * A CAPTURA DE PONTEIRO, EMULADA — o jsdom não tem nenhuma das três funções.
 *
 * Guarda quem capturou, para que o clique abaixo redirecione o `pointerup` como
 * o navegador redireciona. É também a catraca: depois de um `pointerdown` em
 * cima de um ponto, `captura.elemento` TEM de continuar nulo — capturar ali é
 * exatamente o defeito que deixou o mapa sem clique de mouse.
 */
const captura: { elemento: Element | null; ponteiro: number | undefined } = {
  elemento: null,
  ponteiro: undefined,
};

const proto = Element.prototype as unknown as Record<string, unknown>;
proto.setPointerCapture = function (this: Element, id: number) {
  captura.elemento = this;
  captura.ponteiro = id;
};
proto.releasePointerCapture = function (this: Element) {
  if (captura.elemento === this) captura.elemento = null;
};
proto.hasPointerCapture = function (this: Element) {
  return captura.elemento === this;
};

/** Um evento de ponteiro que o jsdom aceita construir, com os campos que React lê. */
function evento(tipo: string, extra: Record<string, unknown> = {}) {
  const ev = new MouseEvent(tipo, { bubbles: true, cancelable: true });
  for (const [chave, valor] of Object.entries(extra)) {
    Object.defineProperty(ev, chave, { value: valor, configurable: true });
  }
  return ev;
}

function ancestralComum(a: Element, b: Element): Element {
  let no: Element | null = a;
  while (no && !no.contains(b)) no = no.parentElement;
  return no ?? document.body;
}

function disparar(alvo: Element, ev: Event) {
  act(() => {
    alvo.dispatchEvent(ev);
  });
}

/**
 * UM CLIQUE DE MOUSE COMO O NAVEGADOR FAZ.
 *
 * Desce no alvo; sobe onde a captura de ponteiro mandar (é isso que
 * `setPointerCapture` muda); e o `click` nasce no ANCESTRAL COMUM entre os dois
 * pontos — que é a regra que faz o clique sumir quando a raiz captura.
 * `userEvent.click` não faz nada disso: ele dispara os três no mesmo elemento.
 */
const PONTEIRO = 7;

function soltarEClicar(alvo: Element, x: number) {
  const ondeSolta = captura.elemento ?? alvo;
  disparar(ondeSolta, evento('pointerup', { pointerId: PONTEIRO, clientX: x, clientY: 10 }));
  disparar(ancestralComum(alvo, ondeSolta), evento('click', { clientX: x, clientY: 10 }));
}

function cliqueDeMouse(alvo: Element) {
  disparar(alvo, evento('pointerdown', { pointerId: PONTEIRO, clientX: 10, clientY: 10 }));
  soltarEClicar(alvo, 10);
}

/* ----------------------------------------------------------------- dados -- */

const AGORA = '2026-09-11T12:00:00.000Z';

function nota(over: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    chave: 'operador:desconto',
    kind: 'regra',
    title: 'Desconto só com aprovação',
    body: 'Nenhum desconto acima de 10% sai sem o dono aprovar.',
    tags: ['comercial'],
    sourceType: 'operador',
    sourceRef: 'reunião de 10/09',
    procedencia: 'operador:reunião de 10/09',
    validFrom: null,
    validUntil: null,
    supersedesId: null,
    confidence: 1,
    contentHash: 'abc123',
    versao: 2,
    temVetor: true,
    arquivadoEm: null,
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    ...over,
  };
}

function agente(over: Record<string, unknown> = {}) {
  return {
    slug: 'analista-de-pauta',
    nome: 'Analista de pauta',
    iniciais: 'AP',
    missao: 'Lê os feeds e propõe a pauta da semana.',
    pilar: 'conteúdo',
    dono: { id: 'p1', nome: 'Pedro Magnago' },
    tipo: 'llm',
    estado: 'rodando',
    autonomiaAte: 'R2',
    rebaixadoAte: null,
    capacidades: ['pauta.coletar'],
    cron: '0 7 * * 1',
    ultimaExecucaoEm: AGORA,
    ultimoStatus: 'ok',
    execucoes: 12,
    falhas: 0,
    horasDevolvidas: 3,
    temProcedimento: true,
    faltando: [],
    ...over,
  };
}

/** O que `GET /agents/:slug` acrescenta: o procedimento. */
function detalheDoAgente(over: Record<string, unknown> = {}) {
  return {
    slug: 'analista-de-pauta',
    sop: {
      proposito: 'Manter a pauta da semana cheia sem ninguém garimpar feed.',
      gatilho: 'toda segunda às 7h, e quando alguém pede pauta no grupo',
      passos: ['ler os feeds', 'cruzar com o acervo', 'propor cinco pautas'],
      definicaoDePronto: 'cinco pautas com fonte, na fila de aprovação',
      observacoes: null,
      versao: 3,
      atualizadoEm: AGORA,
    },
    escalacao: 'em caso de dúvida, chamar Pedro Magnago',
    formato: { faltando: [] },
    ...over,
  };
}

function rotina(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    slug: 'pauta-semanal',
    nome: 'Pauta semanal',
    tipo: 'pauta',
    cron: '0 7 * * 1',
    tz: 'America/Sao_Paulo',
    ativo: true,
    estado: 'rodando',
    dispara: true,
    origem: 'pauta',
    agenteSlug: 'analista-de-pauta',
    execucoes: 9,
    falhas: 1,
    ultimaExecucaoEm: AGORA,
    ultimoStatus: 'ok',
    proximaExecucaoEm: AGORA,
    minutosDevolvidos: 90,
    ...over,
  };
}

function conexao(over: Record<string, unknown> = {}) {
  return {
    key: 'obsidian',
    label: 'Obsidian',
    category: 'knowledge',
    authType: 'builtin',
    requires: 'pasta/sync do vault',
    status: 'connected',
    connectedAt: AGORA,
    lastSyncAt: AGORA,
    lastError: null,
    desligado: false,
    motivoDesligado: null,
    saude: {
      estado: 'conectado',
      mensagem: null,
      apuracao: 'tentativa',
      verificadoEm: AGORA,
      latenciaMs: 41,
    },
    ...over,
  };
}

function pessoa(over: Record<string, unknown> = {}) {
  return { id: 'p1', nome: 'Pedro Magnago', ativo: true, papeis: ['Admin'], pilares: ['conteúdo'], agentes: ['analista-de-pauta'], ...over };
}

function organograma(pessoas: Record<string, unknown>[] = [pessoa()]) {
  return {
    pilares: [{ pilar: 'conteúdo', pessoas, agentes: [{ slug: 'analista-de-pauta' }] }],
    semPilar: { pessoas: [], agentes: [] },
    totais: { pessoas: pessoas.length, agentes: 1, agentesSemDono: 0, pilares: 1 },
  };
}

const CONEXOES = '/integrations/catalog?sondar=0';

/** Responde cada rota do mapa. O que não for declarado devolve o vazio da rota. */
function servir(over: Record<string, unknown> = {}) {
  const tabela: Record<string, unknown> = {
    '/memoria': { itens: [nota()], total: 1, comVetor: 1 },
    '/agents': { items: [agente()], kpis: { rodando: 1, horasSemana: 3, semLinhaDeBase: 0, semProcedimento: 0 } },
    '/rotinas': { items: [rotina()], agendadorAtivo: true, descobertaCega: false },
    [CONEXOES]: { items: [conexao()] },
    '/organograma': organograma(),
    ...over,
  };
  apiGet.mockImplementation((caminho: string) => {
    if (caminho in tabela) {
      const v = tabela[caminho];
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    }
    if (caminho.startsWith('/memoria/buscar')) return Promise.resolve({ query: '', modo: 'textual', itens: [], fonte: {} });
    if (caminho.startsWith('/knowledge/search')) return Promise.resolve({ items: [], mode: 'keyword' });
    if (caminho.startsWith('/agents/')) return Promise.resolve(detalheDoAgente());
    if (caminho.startsWith('/memoria/') && caminho.endsWith('/versoes')) {
      return Promise.resolve([
        {
          id: 'v2',
          versao: 2,
          mudanca: 'alteracao',
          kind: 'regra',
          title: 'Desconto só com aprovação',
          sourceType: 'operador',
          sourceRef: 'reunião de 10/09',
          procedencia: 'operador:reunião de 10/09',
          contentHash: 'abc123',
          motivo: 'o dono subiu o teto para 10%',
          autorTipo: 'usuario',
          autorId: 'u1',
          eventoId: 'ev-42',
          eventoSeq: '42',
          semEventoPorque: null,
          criadoEm: AGORA,
        },
      ]);
    }
    if (caminho.startsWith('/memoria/')) return Promise.resolve(nota({ body: 'Corpo vindo do registro aberto.' }));
    return Promise.reject(new Error(`rota não prevista no teste: ${caminho}`));
  });
}

/*
 * O PRIMEIRO DIA DE UM TENANT DE VERDADE.
 *
 * Os quatro eixos de contexto vazios — e o organograma com UMA pessoa, porque é
 * o que `GET /organograma` devolve sempre: quem está logado. Enquanto gente
 * entrava na conta de "a empresa tem algo", este estado era inalcançável em
 * produção e o caminho de carga só existia num teste que ninguém vivia.
 */
const primeiroDia = {
  '/memoria': { itens: [], total: 0, comVetor: 0 },
  '/agents': { items: [], kpis: { rodando: 0, horasSemana: null, semLinhaDeBase: 0, semProcedimento: 0 } },
  '/rotinas': { items: [], agendadorAtivo: true, descobertaCega: false },
  [CONEXOES]: { items: [] },
  '/organograma': organograma([pessoa()]),
};

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  captura.elemento = null;
  captura.ponteiro = undefined;
  PERMISSOES = ['obsidian.ver', 'obsidian.editar', 'mcp.ver', 'automacoes.ver', 'dashboard.ver'];
});

/* ------------------------------------------------------- o clique de mouse -- */

describe('o clique do mouse no mapa', () => {
  it('clicar num ponto com o mouse de verdade abre o registro', async () => {
    servir();
    render(<ContextoPage />);

    const ponto = await screen.findByRole('button', { name: /Desconto só com aprovação/ });
    cliqueDeMouse(ponto);

    const gaveta = await screen.findByRole('complementary', { name: 'Registro selecionado' });
    expect(await within(gaveta).findByText('Corpo vindo do registro aberto.')).toBeInTheDocument();
  });

  it('apontar para baixo em cima de um ponto NÃO captura o ponteiro em ninguém', async () => {
    servir();
    render(<ContextoPage />);

    const ponto = await screen.findByRole('button', { name: /Desconto só com aprovação/ });
    disparar(ponto, evento('pointerdown', { pointerId: 7, clientX: 10, clientY: 10 }));

    // A catraca: com a captura ativa, o `pointerup` é redirecionado para quem
    // capturou e o clique do ponto morre no caminho.
    expect(captura.elemento).toBeNull();
  });

  it('arrastar a partir de um ponto move a vista e não abre registro nenhum', async () => {
    servir();
    render(<ContextoPage />);

    const ponto = await screen.findByRole('button', { name: /Desconto só com aprovação/ });
    const svg = screen.getByRole('group', { name: 'Mapa do contexto' });

    disparar(ponto, evento('pointerdown', { pointerId: PONTEIRO, clientX: 10, clientY: 10 }));
    disparar(svg, evento('pointermove', { pointerId: PONTEIRO, clientX: 60, clientY: 10 }));

    // O gesto virou arrasto: AGORA a captura é o que mantém o arrasto vivo com o
    // cursor fora do quadro. É a única hora em que capturar está certo.
    expect(captura.elemento).toBe(svg);

    soltarEClicar(ponto, 60);

    expect(svg.firstElementChild?.getAttribute('transform')).toContain('translate(50 0)');
    expect(screen.queryByRole('complementary', { name: 'Registro selecionado' })).not.toBeInTheDocument();
    // E solta ao terminar: captura esquecida prende o ponteiro da página.
    expect(captura.elemento).toBeNull();
  });
});

/* ------------------------------------------------------------------ tela -- */

describe('a tela do mapa', () => {
  it('desenha um ponto por registro que a API devolveu, e nenhum a mais', async () => {
    servir();
    render(<ContextoPage />);

    expect(await screen.findByRole('button', { name: /Desconto só com aprovação/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Analista de pauta/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pauta semanal/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Obsidian —/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pedro Magnago —/ })).toBeInTheDocument();
  });

  it('abrir a tela não manda ninguém sondar conector', async () => {
    servir();
    render(<ContextoPage />);

    await screen.findByRole('button', { name: /Obsidian —/ });
    expect(apiGet).toHaveBeenCalledWith(CONEXOES, 'tok');
    expect(apiGet).not.toHaveBeenCalledWith('/integrations/catalog', 'tok');
  });

  it('clicar numa nota abre o registro real: corpo, procedência e histórico versionado', async () => {
    servir();
    render(<ContextoPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Desconto só com aprovação/ }));

    const gaveta = await screen.findByRole('complementary', { name: 'Registro selecionado' });
    // O corpo é o do registro ABERTO (`GET /memoria/:id`), não o da listagem.
    expect(await within(gaveta).findByText('Corpo vindo do registro aberto.')).toBeInTheDocument();
    expect(within(gaveta).getByText('operador:reunião de 10/09')).toBeInTheDocument();
    expect(await within(gaveta).findByText(/o dono subiu o teto para 10%/)).toBeInTheDocument();
    expect(within(gaveta).getByText('evento #42 no rastro')).toBeInTheDocument();

    expect(apiGet).toHaveBeenCalledWith('/memoria/n1', 'tok');
    expect(apiGet).toHaveBeenCalledWith('/memoria/n1/versoes', 'tok');
  });

  it('clicar num agente abre o registro dele: a missão da listagem e o PROCEDIMENTO buscado', async () => {
    servir();
    render(<ContextoPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Analista de pauta/ }));

    const gaveta = await screen.findByRole('complementary', { name: 'Registro selecionado' });
    expect(within(gaveta).getByText('Lê os feeds e propõe a pauta da semana.')).toBeInTheDocument();
    expect(within(gaveta).getByText('Pedro Magnago')).toBeInTheDocument();
    // O procedimento NÃO vem na listagem: ele é a razão da segunda chamada.
    expect(
      await within(gaveta).findByText(/Manter a pauta da semana cheia/),
    ).toBeInTheDocument();
    expect(within(gaveta).getByText(/1\. ler os feeds/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/agents/analista-de-pauta', 'tok');
    expect(within(gaveta).getByRole('link', { name: /ver em Agentes/ })).toHaveAttribute('href', '/agentes');
  });

  it('no primeiro dia do tenant — só a própria pessoa no organograma — a tela ensina a carregar', async () => {
    servir(primeiroDia);
    apiPost.mockResolvedValue({ ok: true, notes: 7 });
    render(<ContextoPage />);

    expect(await screen.findByText(/Este mapa ainda não tem o que desenhar/)).toBeInTheDocument();
    expect(screen.getByText(/0 nota\(s\) na memória/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Mapa do contexto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Legenda do mapa' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /reler a vault agora/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/knowledge/reindex', {}, 'tok'));
    expect(await screen.findByText(/7 nota\(s\) lida\(s\) da vault/)).toBeInTheDocument();
  });

  it('um eixo em erro no meio de eixos vazios NÃO deixa a tela declarar a empresa vazia', async () => {
    servir({
      ...primeiroDia,
      '/agents': new Error('roster fora do ar'),
      '/rotinas': new Error('rotinas fora do ar'),
      [CONEXOES]: new Error('catálogo fora do ar'),
      '/organograma': new Error('organograma fora do ar'),
    });
    render(<ContextoPage />);

    expect(await screen.findByText(/Não deu para ver o contexto inteiro/)).toBeInTheDocument();
    expect(screen.queryByText(/Este mapa ainda não tem o que desenhar/)).not.toBeInTheDocument();
    expect(screen.getByText(/Agentes: não respondeu — roster fora do ar/)).toBeInTheDocument();
  });

  it('eixo sem permissão no meio de eixos vazios também não vira empresa vazia', async () => {
    PERMISSOES = ['obsidian.ver', 'obsidian.editar'];
    servir(primeiroDia);
    render(<ContextoPage />);

    expect(await screen.findByText(/Não deu para ver o contexto inteiro/)).toBeInTheDocument();
    expect(screen.queryByText(/Este mapa ainda não tem o que desenhar/)).not.toBeInTheDocument();
    expect(screen.getByText(/Agentes: seu papel não dá acesso/)).toBeInTheDocument();
  });

  it('a primeira nota exige procedência, e é gravada pela rota da memória', async () => {
    servir(primeiroDia);
    apiPost.mockResolvedValue({ item: { id: 'n9' } });
    render(<ContextoPage />);

    await userEvent.click(await screen.findByRole('button', { name: /escrever a primeira nota/ }));
    await userEvent.type(screen.getByLabelText('Título da nota'), 'Não falamos de preço no primeiro contato');
    await userEvent.type(screen.getByLabelText('Corpo da nota'), 'Preço só depois do diagnóstico.');

    // O passo promete que toda nota exige procedência. Sem ela, não grava.
    expect(screen.getByRole('button', { name: /gravar a nota/ })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Procedência da nota'), 'reunião de 02/09');
    await userEvent.click(screen.getByRole('button', { name: /gravar a nota/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const [caminho, corpo] = apiPost.mock.calls[0];
    expect(caminho).toBe('/memoria');
    expect(corpo).toMatchObject({
      kind: 'regra',
      title: 'Não falamos de preço no primeiro contato',
      sourceType: 'operador',
      sourceRef: 'reunião de 02/09',
    });
    expect(String((corpo as { chave: string }).chave)).toBe('operador:nao-falamos-de-preco-no-primeiro-contato');
  });

  it('o número do eixo é o que a API declarou, e não o de pontos desenhados', async () => {
    servir({ '/memoria': { itens: [nota(), nota({ id: 'n2', chave: 'k2', title: 'Segunda' })], total: 12, comVetor: 2 } });
    render(<ContextoPage />);

    const legenda = await screen.findByRole('complementary', { name: 'Legenda do mapa' });
    expect(within(legenda).getByText('12')).toBeInTheDocument();
    // Só dois pontos foram desenhados — e o total continua sendo 12.
    expect(screen.getByRole('button', { name: /Desconto só com aprovação/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Segunda —/ })).toBeInTheDocument();
  });

  it('a legenda diz que a contagem de conexões é só das em uso', async () => {
    servir();
    render(<ContextoPage />);

    const legenda = await screen.findByRole('complementary', { name: 'Legenda do mapa' });
    expect(within(legenda).getByText(/conta só as em uso por esta empresa/)).toBeInTheDocument();
  });

  it('eixo sem permissão diz sem acesso, e não zero', async () => {
    PERMISSOES = ['obsidian.ver', 'dashboard.ver'];
    servir();
    render(<ContextoPage />);

    const legenda = await screen.findByRole('complementary', { name: 'Legenda do mapa' });
    expect(within(legenda).getAllByText('sem acesso').length).toBe(2); // agentes e rotinas
    expect(apiGet).not.toHaveBeenCalledWith('/agents', 'tok');
    expect(apiGet).not.toHaveBeenCalledWith('/rotinas', 'tok');
  });

  it('recusa por permissão do servidor diz sem acesso — culpar o sistema seria mentira', async () => {
    servir({ '/organograma': new ErroDaApi('Forbidden resource', 403, 'Forbidden') });
    render(<ContextoPage />);

    const legenda = await screen.findByRole('complementary', { name: 'Legenda do mapa' });
    expect(within(legenda).getByText('sem acesso')).toBeInTheDocument();
    expect(within(legenda).queryByText('falhou')).not.toBeInTheDocument();
    expect(within(legenda).queryByText('Forbidden resource')).not.toBeInTheDocument();
  });

  it('eixo que falhou diz que falhou, com a mensagem que veio', async () => {
    servir({ '/organograma': new Error('organograma fora do ar') });
    render(<ContextoPage />);

    const legenda = await screen.findByRole('complementary', { name: 'Legenda do mapa' });
    expect(within(legenda).getByText('falhou')).toBeInTheDocument();
    expect(within(legenda).getByText('organograma fora do ar')).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------- busca -- */

describe('a busca', () => {
  function servirBusca(
    doIndice: { id: string; title: string; path: string; snippet: string }[],
    notas: Record<string, unknown>[],
  ) {
    servir({ '/memoria': { itens: notas, total: notas.length, comVetor: 0 } });
    const base = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((caminho: string) => {
      if (caminho.startsWith('/memoria/buscar'))
        return Promise.resolve({ query: 'x', modo: 'textual', itens: [], fonte: {} });
      if (caminho.startsWith('/knowledge/search'))
        return Promise.resolve({ items: doIndice, mode: 'semantic' });
      return base(caminho);
    });
  }

  it('resultado do índice sem par não é afirmado como "não versionado"', async () => {
    servirBusca(
      [
        { id: 'k1', title: 'Política atual', path: 'comercial/atual.md', snippet: '' },
        { id: 'k2', title: 'Política antiga', path: 'comercial/antiga.md', snippet: '' },
      ],
      [nota({ id: 'n1', chave: 'vault:comercial/atual.md', sourceType: 'vault' })],
    );
    render(<ContextoPage />);

    await userEvent.type(await screen.findByLabelText('Procurar no contexto'), 'politica');

    const aviso = await screen.findByText(/1 resultado\(s\) do índice da vault sem nota correspondente/);
    expect(aviso).toBeInTheDocument();
    expect(aviso.textContent).toMatch(/arquivada de propósito/);
  });

  it('quando NADA casa, a tela acusa divergência de chave e não manda reler a vault', async () => {
    servirBusca(
      [{ id: 'k1', title: 'Política atual', path: 'comercial/atual.md', snippet: '' }],
      // A nota veio da vault, mas com a chave em outro prefixo: o elo quebrou.
      [nota({ id: 'n1', chave: 'obsidian:comercial/atual.md', sourceType: 'vault' })],
    );
    render(<ContextoPage />);

    await userEvent.type(await screen.findByLabelText('Procurar no contexto'), 'politica');

    expect(await screen.findByText(/divergência entre as duas chaves/)).toBeInTheDocument();
    expect(screen.queryByText(/sem nota correspondente nesta listagem/)).not.toBeInTheDocument();
  });

  /*
   * A BUSCA É PAGA — uma das duas rotas gasta vetorização. Enquanto o efeito
   * dependia do catálogo (array novo a cada montagem do mapa), ela redisparava a
   * cada eixo que respondia, a cada recarga e a cada gravação.
   */
  it('recarregar o mapa não redispara a busca', async () => {
    servir();
    apiPost.mockResolvedValue({ ok: true, notes: 3 });
    render(<ContextoPage />);

    await userEvent.type(await screen.findByLabelText('Procurar no contexto'), 'desconto', {
      delay: null,
    });
    const buscas = () =>
      apiGet.mock.calls.filter((c) => String(c[0]).startsWith('/memoria/buscar')).length;
    await waitFor(() => expect(buscas()).toBe(1));

    await userEvent.click(screen.getByRole('button', { name: /reler a vault/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    // Tempo de sobra para um redisparo com espera de 300ms aparecer.
    await new Promise((r) => setTimeout(r, 500));

    expect(buscas()).toBe(1);
    // A espera de 300ms mais a folga do recarregamento não cabem no prazo padrão.
  }, 20000);
});

/* ----------------------------------------------------------------- grafo -- */

function fontes(over: Partial<FontesDoMapa> = {}): FontesDoMapa {
  return {
    memoria: { dado: { itens: [], total: 0, comVetor: 0 } },
    agentes: { dado: { items: [], kpis: { rodando: 0, horasSemana: null, semLinhaDeBase: 0, semProcedimento: 0 } } },
    rotinas: { dado: { items: [], agendadorAtivo: true, descobertaCega: false } },
    conexoes: { dado: { items: [] } },
    organograma: { dado: { pilares: [], semPilar: { pessoas: [], agentes: [] }, totais: { pessoas: 0, agentes: 0, agentesSemDono: 0, pilares: 0 } } },
    ...over,
  } as FontesDoMapa;
}

describe('o grafo', () => {
  it('liga a rotina ao agente e o agente ao dono, porque os dois vínculos existem no dado', () => {
    const mapa = montarMapa(
      fontes({
        agentes: { dado: { items: [agente()], kpis: { rodando: 1, horasSemana: 3, semLinhaDeBase: 0, semProcedimento: 0 } } } as never,
        rotinas: { dado: { items: [rotina()], agendadorAtivo: true, descobertaCega: false } } as never,
        organograma: { dado: organograma() } as never,
      }),
    );

    const relacoes = mapa.arestas.filter((a) => a.tipo === 'relacao').map((a) => `${a.de}→${a.para}`);
    expect(relacoes).toContain('rotina:r1→agente:analista-de-pauta');
    expect(relacoes).toContain('agente:analista-de-pauta→pessoa:p1');
  });

  it('não desenha relação para ponta que não está no mapa', () => {
    const mapa = montarMapa(
      fontes({
        rotinas: { dado: { items: [rotina({ agenteSlug: 'agente-de-outra-empresa' })], agendadorAtivo: true, descobertaCega: false } } as never,
      }),
    );
    expect(mapa.arestas.filter((a) => a.tipo === 'relacao')).toHaveLength(0);
  });

  it('a conexão é julgada pela saúde, não pelo registro de banco', () => {
    const mapa = montarMapa(
      fontes({
        conexoes: {
          dado: {
            items: [
              conexao({
                key: 'gmail',
                label: 'Gmail',
                status: 'connected',
                saude: { estado: 'erro', mensagem: 'token revogado', apuracao: 'tentativa', verificadoEm: AGORA, latenciaMs: null },
              }),
            ],
          },
        } as never,
      }),
    );
    expect(mapa.nos.find((n) => n.id === 'conexao:gmail')?.tom).toBe('bad');
  });

  it('conector do catálogo que esta empresa não usa fica fora do mapa', () => {
    const mapa = montarMapa(
      fontes({
        conexoes: {
          dado: { items: [conexao({ key: 'asana', label: 'Asana', status: 'disconnected', saude: null })] },
        } as never,
      }),
    );
    expect(mapa.nos).toHaveLength(0);
    expect(mapa.eixos.find((e) => e.key === 'conexoes')?.total).toBe(0);
  });

  it('o que passa do teto vira excedente declarado, e não some', () => {
    const muitas = Array.from({ length: TETO_POR_EIXO + 5 }, (_, i) =>
      nota({ id: `n${i}`, chave: `k${i}`, title: `Nota ${i}` }),
    );
    const mapa = montarMapa(
      fontes({ memoria: { dado: { itens: muitas, total: muitas.length, comVetor: 0 } } as never }),
    );
    const eixo = mapa.eixos.find((e) => e.key === 'memoria')!;
    expect(eixo.mostrados).toBe(TETO_POR_EIXO);
    expect(eixo.excedente).toBe(5);
    expect(eixo.total).toBe(muitas.length);
    expect(mapa.catalogo.memoria).toHaveLength(muitas.length);
  });

  /*
   * O CASO MISTO É O QUE FALTAVA. A versão anterior só cobria os extremos —
   * todos falharam, ou todos carregando — e com isso passava verde enquanto um
   * eixo vazio no meio de quatro em erro fazia a tela afirmar que a empresa não
   * tinha nada.
   */
  describe('o que a tela pode afirmar sobre a empresa', () => {
    it('vazia só quando os quatro eixos de contexto foram consultados e vieram vazios', () => {
      expect(estadoDaEmpresa(montarMapa(fontes()))).toBe('vazia');
    });

    it('um eixo vazio e os outros em erro é DESCONHECIDA, não vazia', () => {
      const mapa = montarMapa(
        fontes({
          agentes: { dado: null, erro: 'falhou' },
          rotinas: { dado: null, erro: 'falhou' },
          conexoes: { dado: null, erro: 'falhou' },
          organograma: { dado: null, erro: 'falhou' },
        }),
      );
      expect(estadoDaEmpresa(mapa)).toBe('desconhecida');
    });

    it('um eixo vazio e os outros sem permissão é DESCONHECIDA, não vazia', () => {
      const mapa = montarMapa(
        fontes({
          agentes: { dado: null, semPermissao: true },
          rotinas: { dado: null, semPermissao: true },
          conexoes: { dado: null, semPermissao: true },
          organograma: { dado: null, semPermissao: true },
        }),
      );
      expect(estadoDaEmpresa(mapa)).toBe('desconhecida');
    });

    it('fonte que ainda não voltou é CARREGANDO — não se afirma nada', () => {
      const mapa = montarMapa(
        fontes({ agentes: { dado: null }, rotinas: { dado: null }, conexoes: { dado: null } }),
      );
      expect(estadoDaEmpresa(mapa)).toBe('carregando');
    });

    it('gente não conta: o organograma sempre devolve quem está logado', () => {
      const soAPropriaPessoa = montarMapa(fontes({ organograma: { dado: organograma([pessoa()]) } as never }));
      expect(soAPropriaPessoa.registros).toBe(1);
      expect(soAPropriaPessoa.registrosDeContexto).toBe(0);
      expect(estadoDaEmpresa(soAPropriaPessoa)).toBe('vazia');
    });

    it('gente em erro não impede afirmar o vazio, porque gente não entra na conta', () => {
      const mapa = montarMapa(fontes({ organograma: { dado: null, erro: 'fora do ar' } }));
      expect(estadoDaEmpresa(mapa)).toBe('vazia');
    });
  });

  /*
   * A MOLDURA, NAS DUAS DIMENSÕES. O desenho é calculado, não arrastado por
   * ninguém: se um anel crescer ou o rótulo mudar de tamanho, é aqui que
   * aparece — e não no dia em que um cliente olhar a tela com o nome da própria
   * regra cortado na lateral. A versão anterior conferia só a vertical, e com os
   * eixos cheios o rótulo do ponto mais à esquerda passava da borda.
   */
  it('com todos os eixos cheios, nenhum rótulo sai do quadro e nenhum ponto encosta no vizinho', () => {
    const cheio = (fabrica: (i: number) => Record<string, unknown>) =>
      Array.from({ length: TETO_POR_EIXO }, (_, i) => fabrica(i));

    const mapa = montarMapa(
      fontes({
        memoria: {
          dado: {
            itens: cheio((i) => nota({ id: `n${i}`, chave: `k${i}`, title: `Nota ${i}` })),
            total: TETO_POR_EIXO,
            comVetor: 0,
          },
        } as never,
        agentes: {
          dado: {
            items: cheio((i) => agente({ slug: `a${i}`, nome: `Agente ${i}`, dono: null })),
            kpis: { rodando: 0, horasSemana: null, semLinhaDeBase: 0, semProcedimento: 0 },
          },
        } as never,
        rotinas: {
          dado: {
            items: cheio((i) => rotina({ id: `r${i}`, nome: `Rotina ${i}`, agenteSlug: null })),
            agendadorAtivo: true,
            descobertaCega: false,
          },
        } as never,
        conexoes: {
          dado: { items: cheio((i) => conexao({ key: `c${i}`, label: `Conexão ${i}` })) },
        } as never,
        organograma: {
          dado: {
            pilares: [
              {
                pilar: 'todos',
                pessoas: cheio((i) => pessoa({ id: `p${i}`, nome: `Pessoa ${i}` })),
                agentes: [],
              },
            ],
            semPilar: { pessoas: [], agentes: [] },
            totais: { pessoas: TETO_POR_EIXO, agentes: 0, agentesSemDono: 0, pilares: 1 },
          },
        } as never,
      }),
    );

    expect(mapa.nos).toHaveLength(TETO_POR_EIXO * 5);

    for (const n of mapa.nos) {
      // O ponto.
      expect(n.x - RAIO_DO_NO).toBeGreaterThan(0);
      expect(n.x + RAIO_DO_NO).toBeLessThan(LADO);
      expect(n.y - RAIO_DO_NO).toBeGreaterThan(0);
      // A CAIXA DO RÓTULO, que é maior do que o ponto e é quem estoura primeiro.
      expect(n.x - METADE_DO_ROTULO).toBeGreaterThanOrEqual(0);
      expect(n.x + METADE_DO_ROTULO).toBeLessThanOrEqual(LADO);
      expect(n.y + DESLOCAMENTO_DO_ROTULO + DESCIDA_DO_ROTULO).toBeLessThanOrEqual(LADO);
    }

    let menor = Infinity;
    for (let i = 0; i < mapa.nos.length; i++) {
      for (let j = i + 1; j < mapa.nos.length; j++) {
        menor = Math.min(menor, Math.hypot(mapa.nos[i].x - mapa.nos[j].x, mapa.nos[i].y - mapa.nos[j].y));
      }
    }
    // A DISTÂNCIA COBRADA É A DECLARADA. Antes o arquivo anunciava 72 (o passo
    // dentro de um anel) enquanto o pior caso real era o vão entre dois anéis, e
    // o teste cobrava 2×17 — um número muito menor do que qualquer dos dois.
    expect(menor).toBeGreaterThanOrEqual(DISTANCIA_MINIMA_ENTRE_PONTOS - 1e-9);
    expect(DISTANCIA_MINIMA_ENTRE_PONTOS).toBeGreaterThan(2 * RAIO_DO_NO);
  });

  it('gente que aparece em dois pilares entra uma vez só', () => {
    const org = {
      pilares: [
        { pilar: 'conteúdo', pessoas: [pessoa()], agentes: [] },
        { pilar: 'comercial', pessoas: [pessoa()], agentes: [] },
      ],
      semPilar: { pessoas: [], agentes: [] },
      totais: { pessoas: 1, agentes: 0, agentesSemDono: 0, pilares: 2 },
    };
    const mapa = montarMapa(fontes({ organograma: { dado: org } as never }));
    expect(mapa.nos.filter((n) => n.familia === 'gente')).toHaveLength(1);
  });
});
