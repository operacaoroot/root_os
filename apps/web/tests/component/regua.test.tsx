import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A TELA DA RÉGUA — fatia 2.3, RF-P-09.
 *
 * O que este arquivo prova é UMA coisa, e ela é a regra de desenho da fatia
 * inteira: A TELA PERGUNTA, A API RESPONDE. O operador submete uma ação
 * hipotética, a tela manda para `POST /api/policy/simular` e desenha nível,
 * gatilhos acesos e exigências EXATAMENTE como vieram.
 *
 * O caso decisivo é "mostra o nível que o SERVIDOR calculou": a tela roda no
 * modo em que o EFEITO vai no corpo da requisição — o único em que o navegador
 * teria o efeito em mãos —, o servidor responde R5 para o efeito mais inofensivo
 * que existe, e a asserção é sobre o SELO, não sobre o cartão em volta dele.
 * Assim as duas cópias possíveis morrem: a que classificaria o efeito diria R0,
 * e a que lesse o nível do catálogo não tem catálogo para ler.
 *
 * A conta em si (nível, gatilho, exigência) é provada contra a régua de verdade
 * em `tests/unit/regua-simulador.test.ts`, que roda o motor sem mock nenhum.
 * Que o catálogo chega filtrado pelos módulos da empresa, e que o menu e a API
 * pedem a mesma permissão, é `tests/unit/regua-modulos.test.ts`.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
let busca = new URLSearchParams();

/*
 * A PERMISSÃO DE QUEM ESTÁ OLHANDO, e ela não é mais "tudo liberado".
 *
 * A Régua é painel de leitura e pede `mcp.ver` — a permissão que o Gestor e o
 * Analista têm. `admin.usuarios` ficou sendo o que ela ERA, e hoje só governa a
 * aba "Quem autoriza", cujas rotas (`/users`, `/roles`) continuam exigindo-a.
 * Um `can: () => true` fixo apagaria justamente essa diferença.
 */
let permissoes: string[] = ['mcp.ver'];

vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => busca,
}));

// eslint-disable-next-line import/first
import ReguaPage from '@/app/regua/page';

/* ------------------------------------------------------------- o painel ---- */

const EFEITO_INOFENSIVO = {
  escreveForaDoOS: false,
  produzArtefato: false,
  reversibilidade: 'automatica' as const,
  exposicaoExterna: false,
  impactoFinanceiro: 'nenhum' as const,
  sensibilidade: 'interna' as const,
  destruicao: false,
  obrigacaoLegal: false,
};

const aprovacao = (over: Record<string, unknown> = {}) => ({
  exigida: 'sempre' as const,
  vinculo: 'conteudo' as const,
  usoUnico: true,
  validadeSegundos: 900,
  reautenticacao: false,
  alcadaMinima: 'responsavel' as const,
  ...over,
});

const PAINEL = {
  politica: {
    versao: '9.9.9-empresa',
    atualizadoEm: '2026-09-11',
    origem: 'sobrescrita desta empresa',
    descricao: 'régua da empresa de teste',
    versaoDaEmpresa: 4,
  },
  niveis: [
    {
      nivel: 'R0' as const,
      nome: 'Consulta',
      escreve: false,
      bloqueado: false,
      rastro: ['ator', 'fontes', 'custo'],
      aprovacao: aprovacao({ exigida: 'nunca', vinculo: 'nenhum', usoUnico: false, validadeSegundos: 0, alcadaMinima: 'operador' }),
      exigeAprovacao: false,
      exigeReautenticacao: false,
      exigeMotivo: false,
      permitido: true,
      motivo: 'classificado como R0',
    },
    {
      nivel: 'R3' as const,
      nome: 'Saída externa',
      escreve: true,
      bloqueado: false,
      rastro: ['aprovador', 'canal', 'entrega'],
      aprovacao: aprovacao(),
      exigeAprovacao: true,
      exigeReautenticacao: false,
      exigeMotivo: false,
      permitido: true,
      motivo: 'classificado como R3',
    },
    {
      nivel: 'R5' as const,
      nome: 'Irreversível',
      escreve: true,
      bloqueado: true,
      rastro: ['preparo', 'encaminhadoPara'],
      aprovacao: aprovacao({ validadeSegundos: 300, reautenticacao: true, alcadaMinima: 'titular' }),
      exigeAprovacao: true,
      exigeReautenticacao: true,
      exigeMotivo: true,
      permitido: false,
      motivo: 'R5 é preparado e encaminhado, nunca executado pelo OS',
    },
  ],
  escalonamento: {
    regra: 'qualquer sinal aceso sobe exatamente um nível, com teto em R4',
    sinais: [
      {
        id: 'fonte_nao_confiavel' as const,
        descricao: 'contexto veio de mensagem, PDF, anexo ou página web',
        origem: 'declarado pelo runtime',
        quando: 'o pedido foi montado a partir de conteúdo externo',
        maoUnica: true,
      },
      {
        id: 'fora_da_janela' as const,
        descricao: 'fora da janela de horário acordada',
        origem: 'limite da empresa',
        quando: 'a hora cai fora de 09:00–12:00',
        maoUnica: false,
      },
    ],
  },
  gatilhos: { exposicaoExterna: { false: null, true: 'R3' } },
  invariantes: ['o nível é o gatilho mais alto acionado, nunca a média'],
  limites: {
    porExecucao: 10,
    porHora: 30,
    porDia: 200,
    janelaHoraria: ['09:00', '12:00'] as [string, string],
    tetoCustoCentavosPorExecucao: 500,
  },
  janelaLegivel: true,
  fuso: 'America/Sao_Paulo',
  retencao: { rastroDias: 1825 },
  capacidades: [
    {
      id: 'operacao.tarefa.alterar',
      descricao: 'Altera o status de uma tarefa.',
      nivel: 'R4' as const,
      nivelCalculado: 'R4' as const,
      efeito: { ...EFEITO_INOFENSIVO, escreveForaDoOS: true, sensibilidade: 'restrita' as const },
      desfazer: 'operacao.tarefa.alterar',
      ferramenta: 'tarefa_atualizar_status',
      rota: 'PATCH /tasks/:id',
      validaArgumentos: true,
      agentes: [
        {
          slug: 'ana',
          nome: 'Ana da Operação',
          estado: 'rodando',
          ativo: true,
          autonomiaAte: 'R2' as const,
          acimaDaAutonomia: true,
        },
      ],
    },
    {
      id: 'credencial.rotacionar',
      descricao: 'Rotaciona uma credencial.',
      nivel: 'R5' as const,
      nivelCalculado: 'R5' as const,
      efeito: { ...EFEITO_INOFENSIVO, escreveForaDoOS: true, destruicao: true },
      desfazer: null,
      ferramenta: null,
      rota: null,
      validaArgumentos: false,
      agentes: [],
    },
  ],
  agentes: [
    {
      slug: 'ana',
      nome: 'Ana da Operação',
      estado: 'rodando',
      ativo: true,
      autonomiaAte: 'R2' as const,
      /*
       * `nivelEfetivo` e `porque` chegam PRONTOS. O id que não está no catálogo
       * vem com o degrau que `avaliar(null)` devolveu no servidor — aqui ele é
       * R4 de propósito, um valor que nenhuma cópia ingênua da escada no
       * navegador escreveria: a que existia escrevia `?? 'R5'`.
       */
      capacidades: [
        {
          id: 'operacao.tarefa.alterar',
          nivel: 'R4' as const,
          nivelEfetivo: 'R4' as const,
          porque: 'nível R4, acima do teto declarado R2 deste agente',
          acimaDaAutonomia: true,
        },
        {
          id: 'inventada.que.nao.existe',
          nivel: null,
          nivelEfetivo: 'R4' as const,
          porque: 'não está no catálogo desta empresa: capacidade sem classificação',
          acimaDaAutonomia: true,
        },
      ],
      semClassificacao: ['inventada.que.nao.existe'],
      ocultasPorModulo: 3,
    },
  ],
  capacidadesOcultasPorModulo: 7,
  sobrescritas: {
    herdaTudo: false,
    emVigor: {
      versao: 4,
      motivo: 'tarefa carrega dado restrito nesta operação',
      responsavel: { id: 'u9', nome: 'Rodrigo Saggioro', email: 'r@x.com' },
      ativaDe: '2026-09-10T12:00:00.000Z',
      ativaAte: null,
      emVigor: true,
      criadoEm: '2026-09-10T12:00:00.000Z',
      diffDaBase: {
        capacidades: [
          {
            id: 'operacao.tarefa.alterar',
            de: 'R2' as const,
            para: 'R4' as const,
            direcao: 'sobe' as const,
            campos: ['efeito', 'nivel'],
            travas: {},
            afrouxa: false,
          },
          /*
           * A LINHA QUE A CÓPIA DO FRONT PINTAVA ERRADO: o nível não desce
           * (`direcao: 'igual'`), e mesmo assim ela AFROUXA — desligar a
           * validação de argumentos é trava de execução, e o servidor a conta
           * como afrouxamento. A dedução antiga (`desce || nova || afrouxa`)
           * pintava isto de verde.
           */
          {
            id: 'crm.lead.alterar',
            de: 'R2' as const,
            para: 'R2' as const,
            direcao: 'igual' as const,
            campos: ['argsSchema'],
            travas: { argsSchema: { direcao: 'afrouxa', porque: 'deixou de validar argumentos' } },
            afrouxa: true,
          },
        ],
        limites: [],
        secoes: [],
      },
      diffDaVersaoAnterior: null,
    },
    historico: [
      {
        versao: 4,
        motivo: 'tarefa carrega dado restrito nesta operação',
        responsavel: { id: 'u9', nome: 'Rodrigo Saggioro', email: 'r@x.com' },
        ativaDe: '2026-09-10T12:00:00.000Z',
        ativaAte: null,
        emVigor: true,
        criadoEm: '2026-09-10T12:00:00.000Z',
        diffDaBase: { capacidades: [], limites: [], secoes: [] },
        diffDaVersaoAnterior: null,
      },
    ],
    idsSobrescritos: ['operacao.tarefa.alterar'],
    trava: { minimoDoMotivo: 10, regra: 'rebaixar nível nunca é automático' },
  },
  efeitoNeutro: EFEITO_INOFENSIVO,
};

/* ----------------------------------------------------------- o resultado --- */

/**
 * A RESPOSTA QUE NENHUMA CÓPIA DA ESCADA NO FRONT PRODUZIRIA.
 *
 * O efeito que ela descreve é o mais inofensivo que existe — não escreve fora
 * do OS, não produz artefato, nada. Uma reimplementação da régua no navegador
 * diria R0. O servidor diz R5, e é o servidor que manda.
 *
 * O caso decisivo troca `acao.origem` para `descrita` e roda a tela no modo em
 * que o efeito VAI no corpo da requisição — é lá que o navegador teria o efeito
 * em mãos e poderia ser tentado a classificá-lo sozinho.
 */
const RESULTADO_DO_SERVIDOR = {
  acao: {
    origem: 'catalogo' as const,
    capabilityId: 'operacao.tarefa.alterar',
    rotulo: 'operacao.tarefa.alterar',
    descricao: 'Altera o status de uma tarefa.',
    efeito: EFEITO_INOFENSIVO,
  },
  nivel: 'R5' as const,
  nivelBase: 'R4' as const,
  permitido: false,
  exigeAprovacao: true,
  exigeReautenticacao: true,
  exigeMotivo: true,
  motivo: 'R5 é preparado e encaminhado, nunca executado pelo OS',
  aprovacao: aprovacao({ validadeSegundos: 300, reautenticacao: true, alcadaMinima: 'titular' }),
  gatilhos: [
    { campo: 'sensibilidade', valor: 'restrita', elevaPara: 'R4', texto: 'sensibilidade = restrita eleva para R4' },
  ],
  sinais: [
    {
      id: 'fonte_nao_confiavel' as const,
      descricao: 'contexto veio de mensagem, PDF, anexo ou página web',
      origem: 'declarado' as const,
      maoUnica: true,
      porque: 'o pedido foi montado a partir de mensagem, documento ou página',
    },
  ],
  exigencias: [
    { chave: 'bloqueado', titulo: 'O OS não executa', detalhe: 'preparado e encaminhado a uma pessoa' },
    { chave: 'motivo', titulo: 'Motivo escrito', detalhe: 'a ação só passa com um motivo registrado' },
  ],
  rastro: ['preparo', 'encaminhadoPara'],
  avisos: [],
  relogio: { fuso: 'America/Sao_Paulo', horario: '13:00' as string | null },
  politica: { versao: '9.9.9-empresa', atualizadoEm: '2026-09-11', origem: 'sobrescrita desta empresa' },
};

beforeEach(() => {
  busca = new URLSearchParams();
  permissoes = ['mcp.ver'];
  apiGet.mockReset();
  apiPost.mockReset();
  apiPatch.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path === '/policy/regua') return Promise.resolve(PAINEL);
    if (path === '/users') return Promise.resolve({ items: [], total: 0 });
    if (path === '/roles') return Promise.resolve({ items: [] });
    return Promise.reject(new Error(`rota não esperada: ${path}`));
  });
  apiPost.mockResolvedValue(RESULTADO_DO_SERVIDOR);
});

const irPara = async (aba: string) => {
  await userEvent.click(await screen.findByRole('button', { name: aba }));
};

describe('a tela da Régua', () => {
  it('mostra os degraus e o que cada um exige, vindos da política da empresa', async () => {
    render(<ReguaPage />);

    expect(await screen.findByText('Saída externa')).toBeInTheDocument();
    expect(screen.getByText('Consulta')).toBeInTheDocument();
    expect(screen.getByText('Irreversível')).toBeInTheDocument();
    // o que o degrau exige, e de onde ele veio
    expect(screen.getByText(/alçada mínima titular/)).toBeInTheDocument();
    expect(screen.getByText('motivo escrito')).toBeInTheDocument();
    expect(screen.getByText('o OS nunca executa')).toBeInTheDocument();
    expect(screen.getByText(/sobrescrita desta empresa na versão 4/)).toBeInTheDocument();
  });

  it('mostra os sinais e diz qual é de mão única', async () => {
    render(<ReguaPage />);
    await irPara('Sinais e limites');

    expect(screen.getByText('fonte_nao_confiavel')).toBeInTheDocument();
    expect(screen.getByText('de mão única')).toBeInTheDocument();
    expect(screen.getByText(/Acende quando o pedido foi montado a partir de conteúdo externo/))
      .toBeInTheDocument();
    // os limites são os DESTA empresa, e a janela diz em que fuso é lida (MD3)
    expect(screen.getByText('09:00 – 12:00 (America/Sao_Paulo)')).toBeInTheDocument();
    // janela legível: nada de alarme
    expect(screen.queryByText(/fica aceso em toda ação/)).not.toBeInTheDocument();
  });

  /*
   * Janela ilegível sobe um degrau em TODA ação da empresa. Antes desta fatia
   * isso acontecia calado; agora o servidor grita no log uma vez por empresa e
   * a tela explica na cara de quem está olhando.
   */
  it('avisa quando a janela horária desta empresa é ilegível', async () => {
    apiGet.mockImplementation((path: string) =>
      path === '/policy/regua'
        ? Promise.resolve({
            ...PAINEL,
            janelaLegivel: false,
            limites: { ...PAINEL.limites, janelaHoraria: ['8h', 'oito'] as [string, string] },
          })
        : Promise.reject(new Error(`rota não esperada: ${path}`)),
    );

    render(<ReguaPage />);
    await irPara('Sinais e limites');

    expect(screen.getByText(/fica aceso em toda ação/)).toBeInTheDocument();
  });

  it('mostra, por capacidade, quais agentes a declararam', async () => {
    render(<ReguaPage />);
    await irPara('Capacidades');

    expect(screen.getByText('operacao.tarefa.alterar')).toBeInTheDocument();
    expect(screen.getByText(/Ana da Operação/)).toBeInTheDocument();
    expect(screen.getByText('sobrescrita desta empresa')).toBeInTheDocument();
    // e as que ninguém alcança
    expect(screen.getByText(/nenhum — a porta recusaria/)).toBeInTheDocument();
    expect(screen.getByText(/sem ferramenta/)).toBeInTheDocument();
  });

  it('mostra a fatia do catálogo que cada agente declarou, com o degrau que o SERVIDOR deu', async () => {
    render(<ReguaPage />);
    await irPara('Capacidades');
    await userEvent.click(screen.getByRole('button', { name: 'Por agente' }));

    expect(screen.getByText('Ana da Operação')).toBeInTheDocument();
    expect(screen.getByText(/2 capacidade\(s\) declaradas/)).toBeInTheDocument();
    expect(screen.getByText(/não existem no catálogo/)).toBeInTheDocument();
    // aparece duas vezes de propósito: no alerta e na própria lista declarada
    expect(screen.getAllByText(/inventada\.que\.nao\.existe/).length).toBeGreaterThan(1);

    /*
     * O id que não está no catálogo vem com `nivelEfetivo: 'R4'` na resposta —
     * um valor que o front não teria como inventar. Enquanto ele escrevia
     * `?? 'R5'`, esta asserção seria impossível: a tela mostraria R5 para
     * qualquer coisa, contrariando o servidor sem ninguém notar.
     */
    const rotulo = screen.getByTitle(/não está no catálogo desta empresa/);
    expect(rotulo.textContent).toContain('R4');
    expect(rotulo.textContent).not.toContain('R5');

    // e o que o agente declara e não alcança aparece como contagem, sem id
    expect(screen.getByText(/3 declarada\(s\) de módulo que esta empresa não contratou/))
      .toBeInTheDocument();
  });

  it('mostra a sobrescrita da empresa com data e responsável', async () => {
    render(<ReguaPage />);
    await irPara('Sobrescritas');

    expect(screen.getAllByText(/Rodrigo Saggioro/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/tarefa carrega dado restrito/).length).toBeGreaterThan(0);
    expect(screen.getByText('O que difere da base herdada da ROOT')).toBeInTheDocument();
  });

  /*
   * QUEM DIZ O QUE AFROUXOU É O SERVIDOR. A tela deduzia de `direcao`, e a
   * dedução errava justamente no caso que a trava do RF-P-06 existe para pegar:
   * a capacidade que mantém o nível e desliga a validação de argumentos.
   */
  it('marca como afrouxamento o que o servidor marcou — inclusive sem mudar de nível', async () => {
    render(<ReguaPage />);
    await irPara('Sobrescritas');

    const sobe = screen.getAllByTitle('não afrouxa');
    const afrouxa = screen.getAllByTitle(/afrouxa: exige responsável/);

    expect(sobe.map((e) => e.textContent)).toContain('sobe');
    // `igual` não desce, não é nova — e ainda assim afrouxa, porque a trava de
    // execução da capacidade foi desligada
    expect(afrouxa.map((e) => e.textContent)).toContain('igual');
  });

  it('o redirect de /usuarios cai na aba de quem autoriza — para quem administra gente', async () => {
    permissoes = ['mcp.ver', 'admin.usuarios'];
    busca = new URLSearchParams('aba=pessoas');
    render(<ReguaPage />);

    expect(await screen.findByText(/gerencie acessos e perfis/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/users', 'tok');
  });

  /*
   * A RÉGUA AFROUXOU PARA `mcp.ver`; A ABA DE GENTE NÃO AFROUXOU JUNTO.
   * As rotas dela (`/users`, `/roles`) seguem exigindo `admin.usuarios`, então
   * oferecer o botão a quem não tem seria oferecer um 403 — a mesma armadilha
   * do `/atendimento`, invertida.
   */
  it('quem não administra gente não vê a aba de gente, nem por link direto', async () => {
    busca = new URLSearchParams('aba=pessoas');
    render(<ReguaPage />);

    // cai na escada, que é a aba de entrada
    expect(await screen.findByText('Saída externa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quem autoriza' })).not.toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalledWith('/users', 'tok');
  });

  it('mostra quanto do catálogo do produto esta empresa não enxerga', async () => {
    render(<ReguaPage />);
    await irPara('Capacidades');

    expect(
      screen.getByText(/7 capacidade\(s\) do produto não aparecem aqui/),
    ).toBeInTheDocument();
  });
});

describe('o simulador', () => {
  it('submete a ação hipotética e mostra nível, gatilhos acesos e exigência', async () => {
    render(<ReguaPage />);
    await irPara('Simulador');

    await userEvent.selectOptions(
      screen.getByLabelText('Capacidade'),
      'operacao.tarefa.alterar',
    );
    await userEvent.type(screen.getByLabelText(/Hora da execução/), '13:00');
    await userEvent.click(screen.getByRole('button', { name: /^Simular$/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [rota, corpo] = apiPost.mock.calls[0];
    expect(rota).toBe('/policy/simular');
    expect(corpo).toMatchObject({ capabilityId: 'operacao.tarefa.alterar', horario: '13:00' });

    // o nível
    expect(await screen.findByText('Resultado da simulação')).toBeInTheDocument();
    // os gatilhos acesos, como o servidor os nomeou
    expect(screen.getByText('Gatilhos acesos')).toBeInTheDocument();
    expect(screen.getByText('sensibilidade = restrita eleva para R4')).toBeInTheDocument();
    // os sinais acesos
    expect(screen.getByText('Sinais acesos')).toBeInTheDocument();
    // o que seria exigido
    expect(screen.getByText('O que seria exigido de você')).toBeInTheDocument();
    expect(screen.getByText('Motivo escrito')).toBeInTheDocument();
    expect(screen.getByText('O OS não executa')).toBeInTheDocument();
  });

  it('o botão Agora pede a hora do relógio do servidor e mostra a que ele leu em SP (MD3)', async () => {
    apiPost.mockResolvedValue({
      ...RESULTADO_DO_SERVIDOR,
      relogio: { fuso: 'America/Sao_Paulo', horario: '18:00' },
    });
    render(<ReguaPage />);
    await irPara('Simulador');

    expect(
      screen.getByLabelText(/Hora da execução no fuso America\/Sao_Paulo/),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Hora da execução/), '13:00');
    await userEvent.click(screen.getByRole('button', { name: 'Agora' }));
    expect(screen.getByLabelText(/Hora da execução/)).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /^Simular$/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [, corpo] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    // a hora é a do servidor, a mesma da porta: nem HH:MM nem instante do navegador
    expect(corpo.agora).toBe(true);
    expect(corpo.horario).toBeUndefined();
    expect(corpo.momento).toBeUndefined();
    expect(
      await screen.findByText('Hora considerada: 18:00 em America/Sao_Paulo'),
    ).toBeInTheDocument();
  });

  /*
   * O CASO DECISIVO DA FATIA. Três coisas nele foram consertadas depois da
   * revisão, e cada uma era o que fazia ele passar sem morder:
   *
   *  1. RODA NO MODO "DESCREVER O EFEITO". No modo catálogo o navegador manda
   *     só um id e não tem efeito nenhum em mãos — a frase "o efeito enviado é
   *     o mais inofensivo que existe" era literalmente falsa, porque efeito
   *     nenhum era enviado. Aqui o efeito VAI no corpo, e o teste confere isso.
   *  2. AFIRMA SOBRE O SELO, não sobre o cartão. O cartão repete o nível no
   *     motivo e na linha de explicação: `textContent).toContain('R5')` passava
   *     mesmo com o selo mostrando outro degrau.
   *  3. FECHA AS DUAS CÓPIAS POSSÍVEIS. Uma cópia que CLASSIFICASSE o efeito
   *     neutro diria R0; uma que lesse o nível do CATÁLOGO não teria o que ler,
   *     porque esta ação não está nele. Só sobra desenhar o que o servidor
   *     mandou — que é a regra de desenho da tela inteira.
   */
  it('mostra o nível que o SERVIDOR calculou, e não um recalculado aqui', async () => {
    apiPost.mockResolvedValue({
      ...RESULTADO_DO_SERVIDOR,
      acao: {
        origem: 'descrita' as const,
        capabilityId: null,
        rotulo: 'ação hipotética',
        descricao: 'ação hipotética',
        efeito: EFEITO_INOFENSIVO,
      },
    });

    render(<ReguaPage />);
    await irPara('Simulador');
    await userEvent.click(screen.getByRole('button', { name: 'Descrever o efeito' }));
    await userEvent.click(screen.getByRole('button', { name: /^Simular$/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));

    // o efeito realmente foi no corpo, e é o mais inofensivo que existe
    const [, corpo] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(corpo.capabilityId).toBeUndefined();
    expect(corpo.efeito).toMatchObject(EFEITO_INOFENSIVO);

    // e o SELO — não o cartão em volta dele — mostra o que o servidor disse
    const selo = await screen.findByTestId('nivel-calculado');
    expect(selo.textContent?.trim()).toBe('R5');

    expect(screen.getByText(/Nível base R4/)).toBeInTheDocument();
    expect(screen.getByText('o OS não executa')).toBeInTheDocument();
  });

  it('a procedência externa marcada não desmarca — é de mão única', async () => {
    render(<ReguaPage />);
    await irPara('Simulador');

    const caixa = screen.getByLabelText(/veio de mensagem, documento ou página/);
    expect(caixa).not.toBeChecked();
    await userEvent.click(caixa);
    expect(caixa).toBeChecked();
    expect(caixa).toBeDisabled();

    // só recomeçar a simulação limpa a marca — como no runtime
    await userEvent.click(screen.getByRole('button', { name: 'Recomeçar' }));
    expect(screen.getByLabelText(/veio de mensagem, documento ou página/)).not.toBeChecked();
  });

  it('erro da API aparece na tela e não vira resultado nenhum', async () => {
    apiPost.mockRejectedValueOnce(new Error('Permissão insuficiente'));
    render(<ReguaPage />);
    await irPara('Simulador');
    await userEvent.click(screen.getByRole('button', { name: /^Simular$/ }));

    expect(await screen.findByText('Permissão insuficiente')).toBeInTheDocument();
    expect(screen.queryByText('Resultado da simulação')).not.toBeInTheDocument();
  });
});
