import {
  EfeitoSchema,
  ORDEM_DOS_NIVEIS,
  SinalSchema,
  avaliar,
  classificar,
  maior,
  subir,
  type Capacidade,
  type Decisao,
  type Efeito,
  type Nivel,
  type Politica,
  type Sinal,
} from '@mktos/policy';
import { z } from 'zod';
import {
  acimaDoTeto,
  foraDaJanela,
  fusoDaPolitica,
  horarioNoFuso,
  minutosDoDia,
  minutosNoFuso,
} from './limites';

/*
 * O SIMULADOR DA TELA DA RÉGUA — RF-P-09.
 *
 * O operador descreve uma ação hipotética e recebe três coisas: o nível
 * calculado, quais gatilhos acenderam e o que seria exigido dele. Este arquivo
 * é a parte que pensa; o controller só empacota e a tela só desenha.
 *
 * TRÊS REGRAS QUE O DESENHO INTEIRO SERVE
 *
 * 1. QUEM DECIDE É `avaliar()`, do pacote puro, e ninguém mais. Nada aqui
 *    recalcula nível: a decisão sai da MESMA função que a porta chama em
 *    produção. Uma segunda régua — no front ou aqui — diverge da primeira no
 *    dia em que a política mudar, e a tela passaria a ensinar o errado.
 *
 * 2. SIMULAR NÃO É EXECUTAR. Este módulo é puro: sem Nest, sem Prisma, sem
 *    rede. Ele não cria aprovação, não chama efeito e não grava no RASTRO —
 *    não tem como. A garantia não é uma promessa no comentário: é a ausência
 *    de qualquer coisa que escreva.
 *
 * 3. A TABELA DE GATILHOS É DADO, NÃO CÓDIGO. "Quais gatilhos acenderam" sai
 *    percorrendo `politica.gatilhos` — a seção do próprio documento que mapeia
 *    campo -> valor -> nível. Reescrever os `if` de `classificar()` aqui só
 *    para explicar a decisão seria criar a segunda régua pela porta dos
 *    fundos. E, como nem tabela nem motor são infalíveis, o resultado CONFERE
 *    um contra o outro: divergiram, sai aviso — a tela diz que discordam em vez
 *    de escolher um e mentir.
 *
 * O QUE ESTE ARQUIVO NÃO SABE
 * Três dos seis sinais dependem de histórico no banco (`volume_atipico`,
 * `erro_recente`) ou de quem é o destinatário (`destinatario_novo`): quem os
 * calcula de verdade é `sinais.service.ts`, com I/O. Numa simulação eles são
 * INFORMADOS pelo operador ("e se fosse um destinatário novo?"), e o resultado
 * diz isso em `origem`, para ninguém confundir hipótese com medição.
 *
 * A JANELA E O TETO NÃO MORAM AQUI. Eles são `./limites.ts`, e a porta importa
 * DAQUELE arquivo — não deste. O caminho quente do gateway não tem por que
 * depender de um módulo chamado "simulador" para comparar um relógio.
 */

/** Piso de quem escreve fora do OS: a escada nunca devolve menos que isto. */
const PISO_DE_ESCRITA: Nivel = 'R2';

/**
 * O efeito de partida do formulário — o mais inofensivo que existe.
 *
 * Não é falha-fechada, e é de propósito: aqui não se decide execução nenhuma.
 * É um formulário em branco, e começar com tudo ligado (destrutivo, irreversível,
 * restrito) faria o operador ter de DESMARCAR oito campos para simular a ação
 * mais banal. Falha fechada continua valendo onde ela protege alguma coisa: a
 * capacidade que não existe no catálogo vale R5, e é `avaliar(null)` quem diz.
 */
export const EFEITO_NEUTRO: Efeito = {
  escreveForaDoOS: false,
  produzArtefato: false,
  reversibilidade: 'automatica',
  exposicaoExterna: false,
  impactoFinanceiro: 'nenhum',
  sensibilidade: 'interna',
  destruicao: false,
  obrigacaoLegal: false,
};

export const PedidoDeSimulacaoSchema = z
  .object({
    /** Uma capacidade do catálogo DESTA empresa. Exclui `efeito`. */
    capabilityId: z.string().min(1).max(200).optional(),
    /** Ou o efeito descrito à mão, quando a ação não existe no catálogo. */
    efeito: EfeitoSchema.partial().optional(),
    /** Rótulo livre só para a tela e para o log. Não entra em decisão nenhuma. */
    descricao: z.string().max(500).optional(),
    /** Os sinais que o operador está SUPONDO acesos. */
    sinais: z.array(SinalSchema).max(SinalSchema.options.length).optional(),
    /** RF-G-07: procedência externa é sinal de mão única — marca, não desmarca. */
    procedenciaExterna: z.boolean().optional(),
    /**
     * `HH:MM` hipotético, conferido contra a janela horária DESTA empresa. É a
     * hora de parede do fuso da política (São Paulo), não a do servidor.
     */
    horario: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'horário no formato HH:MM')
      .optional(),
    /**
     * Um instante de verdade (ISO com fuso), lido no fuso da política pela
     * MESMA conta da porta. É o "e se fosse neste instante?".
     */
    momento: z.string().datetime({ offset: true }).optional(),
    /**
     * O "e se fosse agora?" da tela. A hora vem do relógio do SERVIDOR, que é o
     * da porta, e não do navegador: um computador com o relógio adiantado veria
     * 20:05 e R4 enquanto a porta, no mesmo instante, daria 19:55 e R3.
     */
    agora: z.literal(true).optional(),
    /** Valor hipotético, conferido contra o teto DESTA empresa. */
    valorCentavos: z.number().int().nonnegative().max(1_000_000_000).optional(),
    /** Só vale em R2, onde a aprovação é configurável por cliente. */
    aprovacaoR2Ligada: z.boolean().optional(),
  })
  .refine((p) => Boolean(p.capabilityId) || Boolean(p.efeito), {
    message: 'descreva a ação: escolha uma capacidade do catálogo ou descreva o efeito dela',
  })
  .refine(
    (p) => [p.horario, p.momento, p.agora].filter((v) => v !== undefined).length <= 1,
    { message: 'informe o horário, o instante OU agora, só um deles' },
  );

export type PedidoDeSimulacao = z.infer<typeof PedidoDeSimulacaoSchema>;

/* ------------------------------------------------------------ gatilhos ------ */

export interface GatilhoAceso {
  /** Campo do efeito: `reversibilidade`, `impactoFinanceiro`, `alcance`… */
  campo: string;
  valor: string;
  /** `'R2'`…`'R5'`, ou `'+1'` no caso do alcance. */
  elevaPara: string;
  texto: string;
}

const ehNivel = (v: unknown): v is Nivel =>
  typeof v === 'string' && (ORDEM_DOS_NIVEIS as readonly string[]).includes(v);

/**
 * Quais gatilhos do documento acendem para este efeito.
 *
 * Percorre `politica.gatilhos`, que é a tabela do próprio documento normativo
 * (`campo -> valor -> nível`, com `null` para "não acende"). Não reimplementa
 * `classificar()`: quem confere se os dois concordam é `simularAcao`.
 */
export function gatilhosAcesos(politica: Politica, efeito: Efeito): GatilhoAceso[] {
  const acesos: GatilhoAceso[] = [];

  // O desvio do começo de `classificar()`: quem não escreve fora do OS não
  // chega em gatilho nenhum. Esta é a única regra da escada repetida aqui, e
  // ela é repetida como EXPLICAÇÃO — a conferência abaixo reprova se mentir.
  if (!efeito.escreveForaDoOS) {
    const nivel: Nivel = efeito.produzArtefato ? 'R1' : 'R0';
    return [
      {
        campo: 'escreveForaDoOS',
        valor: 'false',
        elevaPara: nivel,
        texto: efeito.produzArtefato
          ? 'não escreve fora do OS, mas produz artefato: para em R1'
          : 'não escreve fora do OS e não produz artefato: para em R0',
      },
    ];
  }

  acesos.push({
    campo: 'escreveForaDoOS',
    valor: 'true',
    elevaPara: PISO_DE_ESCRITA,
    texto: `escreve fora do OS: o piso é ${PISO_DE_ESCRITA}`,
  });

  const tabela = (politica.gatilhos ?? {}) as Record<string, unknown>;
  const doEfeito = efeito as unknown as Record<string, unknown>;

  for (const [campo, regra] of Object.entries(tabela)) {
    if (campo === 'alcance' || campo === 'escreveForaDoOS') continue;
    if (!regra || typeof regra !== 'object' || Array.isArray(regra)) continue;
    const valor = String(doEfeito[campo]);
    const eleva = (regra as Record<string, unknown>)[valor];
    if (!ehNivel(eleva)) continue; // `null` no documento = não acende
    acesos.push({
      campo,
      valor,
      elevaPara: eleva,
      texto: `${campo} = ${valor} eleva para ${eleva}`,
    });
  }

  const alcance = tabela.alcance as { limite?: unknown; acimaDoLimite?: unknown } | undefined;
  const limite = typeof alcance?.limite === 'number' ? alcance.limite : null;
  if (limite !== null && (efeito.alcance ?? 1) > limite) {
    acesos.push({
      campo: 'alcance',
      valor: String(efeito.alcance ?? 1),
      elevaPara: typeof alcance?.acimaDoLimite === 'string' ? alcance.acimaDoLimite : '+1',
      texto: `alcance ${efeito.alcance} acima de ${limite}: sobe um degrau`,
    });
  }

  return acesos;
}

/** O nível que a TABELA do documento produz — só para conferir contra o motor. */
export function nivelPelaTabela(acesos: readonly GatilhoAceso[]): Nivel {
  let n: Nivel = 'R0';
  for (const g of acesos) if (ehNivel(g.elevaPara)) n = maior(n, g.elevaPara);
  if (acesos.some((g) => g.elevaPara === '+1')) n = subir(n);
  return n;
}

/* --------------------------------------------------------------- sinais ----- */

export interface SinalAceso {
  id: Sinal;
  /** A descrição do documento. Vazia quando o sinal não está declarado nele. */
  descricao: string;
  /**
   * `calculado` — a simulação derivou o sinal dos limites DESTA empresa.
   * `declarado` — procedência externa, que ninguém calcula (RF-G-07).
   * `informado` — o operador supôs, porque de verdade só o banco saberia.
   */
  origem: 'calculado' | 'declarado' | 'informado';
  /** Mão única no runtime: existe marcar, não existe desmarcar. */
  maoUnica: boolean;
  porque: string;
}

/**
 * Os sinais desta simulação.
 *
 * Dois saem de conta com os limites da empresa (janela e teto) e os outros
 * quatro vêm do operador — três porque exigiriam histórico no banco, e a
 * procedência externa porque ela é DECLARADA pelo runtime, nunca calculada.
 */
export function sinaisDaSimulacao(
  politica: Politica,
  pedido: PedidoDeSimulacao,
  fuso: string = fusoDaPolitica(),
): SinalAceso[] {
  const descricoes = new Map(
    (politica.escalonamento?.sinais ?? []).map((s) => [s.id as Sinal, s.descricao]),
  );
  const limites = politica.limitesPadrao;
  const pedidos = new Set<Sinal>(pedido.sinais ?? []);
  const acesos: SinalAceso[] = [];

  const anotar = (id: Sinal, origem: SinalAceso['origem'], porque: string) => {
    if (acesos.some((s) => s.id === id)) return;
    acesos.push({
      id,
      descricao: descricoes.get(id) ?? '',
      origem,
      maoUnica: id === 'fonte_nao_confiavel',
      porque,
    });
  };

  if (pedido.procedenciaExterna || pedidos.has('fonte_nao_confiavel')) {
    anotar(
      'fonte_nao_confiavel',
      'declarado',
      'o pedido foi montado a partir de mensagem, documento ou página: conteúdo externo ' +
        'só ELEVA nível, e a marca é de mão única — existe marcar, não existe desmarcar',
    );
  }

  if (pedido.horario !== undefined || pedido.momento !== undefined) {
    const relogio = relogioDaSimulacao(pedido, fuso);
    const minutos =
      pedido.horario !== undefined
        ? minutosDoDia(pedido.horario)
        : minutosNoFuso(new Date(pedido.momento as string), fuso);
    if (foraDaJanela(minutos, limites.janelaHoraria)) {
      anotar(
        'fora_da_janela',
        'calculado',
        `${relogio.horario ?? 'hora ilegível'} (${fuso}) está fora da janela desta empresa ` +
          `(${limites.janelaHoraria[0]}–${limites.janelaHoraria[1]})`,
      );
    }
  } else if (pedidos.has('fora_da_janela')) {
    anotar('fora_da_janela', 'informado', 'suposto pelo operador, sem horário informado');
  }

  if (pedido.valorCentavos !== undefined) {
    if (acimaDoTeto(pedido.valorCentavos, limites.tetoCustoCentavosPorExecucao)) {
      anotar(
        'valor_acima_do_limite',
        'calculado',
        `${pedido.valorCentavos} centavos acima do teto desta empresa ` +
          `(${limites.tetoCustoCentavosPorExecucao} centavos por execução)`,
      );
    }
  } else if (pedidos.has('valor_acima_do_limite')) {
    anotar('valor_acima_do_limite', 'informado', 'suposto pelo operador, sem valor informado');
  }

  for (const id of ['destinatario_novo', 'volume_atipico', 'erro_recente'] as const) {
    if (!pedidos.has(id)) continue;
    anotar(
      id,
      'informado',
      'suposto pelo operador — na execução real quem mede é o histórico do banco',
    );
  }

  return acesos;
}

/** Que horas a simulação está supondo, já no fuso da política. */
export function relogioDaSimulacao(
  pedido: PedidoDeSimulacao,
  fuso: string = fusoDaPolitica(),
): { fuso: string; horario: string | null } {
  if (pedido.horario !== undefined) return { fuso, horario: pedido.horario };
  if (pedido.momento !== undefined) {
    return { fuso, horario: horarioNoFuso(new Date(pedido.momento), fuso) };
  }
  return { fuso, horario: null };
}

/* ----------------------------------------------------------- exigências ----- */

export interface Exigencia {
  chave: string;
  titulo: string;
  detalhe: string;
}

/**
 * O que seria exigido do operador nesse nível.
 *
 * Tudo sai da decisão e do próprio documento (`niveis[nivel]`, `invariantes`):
 * nenhuma frase aqui afirma regra que a política não diga.
 */
export function exigenciasDe(
  politica: Politica,
  decisao: Decisao,
  capacidade: Capacidade | null,
): Exigencia[] {
  const doNivel = politica.niveis?.[decisao.nivel];
  const ap = decisao.aprovacao;
  const itens: Exigencia[] = [];

  if (doNivel?.bloqueado) {
    itens.push({
      chave: 'bloqueado',
      titulo: 'O OS não executa',
      detalhe: decisao.motivo,
    });
  }

  if (decisao.exigeAprovacao) {
    itens.push({
      chave: 'aprovacao',
      titulo: 'Aprovação de uma pessoa, antes de agir',
      detalhe:
        `alçada mínima ${ap.alcadaMinima}; ` +
        `${ap.vinculo === 'conteudo' ? 'presa ao conteúdo exato' : 'sem vínculo com o conteúdo'}; ` +
        `${ap.usoUnico ? 'uso único' : 'reutilizável'}; ` +
        `vale por ${ap.validadeSegundos} segundos`,
    });
    const invAprovador = (politica.invariantes ?? []).find((i) => i.startsWith('aprovador'));
    if (invAprovador) {
      itens.push({ chave: 'aprovador', titulo: 'Quem pode aprovar', detalhe: invAprovador });
    }
  } else if (ap.exigida === 'configuravel') {
    itens.push({
      chave: 'aprovacao',
      titulo: 'Aprovação desligada nesta simulação',
      detalhe:
        'neste nível a aprovação é configurável por cliente, e a simulação está com ela ' +
        'desligada — ligada, a ação passaria pela fila de aprovação',
    });
  } else {
    itens.push({
      chave: 'aprovacao',
      titulo: 'Nenhuma aprovação',
      detalhe: 'este nível não exige aprovação de ninguém',
    });
  }

  if (decisao.exigeReautenticacao) {
    itens.push({
      chave: 'reautenticacao',
      titulo: 'Reautenticação de quem aprova',
      detalhe: 'a senha é pedida de novo na hora da aprovação, não basta a sessão aberta',
    });
  }

  if (decisao.exigeMotivo) {
    itens.push({
      chave: 'motivo',
      titulo: 'Motivo escrito',
      detalhe: 'a ação só passa com um motivo registrado, e ele fica no rastro',
    });
  }

  if (doNivel?.rastro?.length) {
    itens.push({
      chave: 'rastro',
      titulo: 'O que o rastro vai guardar',
      detalhe: doNivel.rastro.join(', '),
    });
  }

  if (capacidade?.desfazer) {
    itens.push({
      chave: 'desfazer',
      titulo: 'Desfazer declarado',
      detalhe: `esta capacidade se desfaz por "${capacidade.desfazer}"`,
    });
  }

  return itens;
}

/* ------------------------------------------------------------ resultado ----- */

export type OrigemDaAcao = 'catalogo' | 'descrita' | 'desconhecida';

export interface ResultadoDaSimulacao {
  acao: {
    origem: OrigemDaAcao;
    capabilityId: string | null;
    rotulo: string;
    descricao: string;
    /** Nulo só quando a capacidade pedida não existe no catálogo da empresa. */
    efeito: Efeito | null;
  };
  nivel: Nivel;
  nivelBase: Nivel;
  permitido: boolean;
  exigeAprovacao: boolean;
  exigeReautenticacao: boolean;
  exigeMotivo: boolean;
  motivo: string;
  aprovacao: Decisao['aprovacao'];
  gatilhos: GatilhoAceso[];
  sinais: SinalAceso[];
  exigencias: Exigencia[];
  rastro: string[];
  avisos: string[];
  /** A hora que a simulação supôs, no fuso da política. Nula sem hora informada. */
  relogio: { fuso: string; horario: string | null };
  /** Procedência da régua usada — é a resposta a "de qual política é este nível". */
  politica: { versao: string; atualizadoEm: string; origem: string };
}

/**
 * `agora: true` vira o `momento` lido do relógio de quem roda a simulação, que
 * é o servidor. Uma leitura só, para o sinal e a hora mostrada não discordarem
 * na virada do minuto.
 */
export function resolverAgora(
  pedido: PedidoDeSimulacao,
  relogio: () => Date = () => new Date(),
): PedidoDeSimulacao {
  if (!pedido.agora) return pedido;
  return { ...pedido, agora: undefined, momento: relogio().toISOString() };
}

/**
 * A simulação inteira. Pura a menos do relógio (que só é lido com `agora`):
 * recebe o documento que vale para a empresa e o pedido, devolve o resultado.
 * Não escreve em lugar nenhum.
 */
export function simularAcao(
  politica: Politica,
  pedidoBruto: PedidoDeSimulacao,
  fuso: string = fusoDaPolitica(),
  relogio: () => Date = () => new Date(),
): ResultadoDaSimulacao {
  const pedido = resolverAgora(pedidoBruto, relogio);
  const avisos: string[] = [];

  let origem: OrigemDaAcao;
  let capacidade: Capacidade | null;
  let rotulo: string;

  if (pedido.capabilityId) {
    const doCatalogo = politica.capacidades.find((c) => c.id === pedido.capabilityId) ?? null;
    capacidade = (doCatalogo as Capacidade | null) ?? null;
    origem = doCatalogo ? 'catalogo' : 'desconhecida';
    rotulo = pedido.capabilityId;
    if (!doCatalogo) {
      avisos.push(
        `"${pedido.capabilityId}" não está no catálogo desta empresa. A régua trata capacidade ` +
          'sem classificação como R5 e bloqueia — é a invariante 2, e é o que a porta faria.',
      );
    }
  } else {
    const efeito: Efeito = { ...EFEITO_NEUTRO, ...(pedido.efeito ?? {}) };
    rotulo = pedido.descricao?.trim() || 'ação hipotética';
    capacidade = {
      id: '(hipotética)',
      descricao: rotulo,
      // `avaliar` usa o MAIOR entre o nível declarado e o calculado: declarar o
      // calculado é neutro, e evita que um R0 fixo pareça um piso inventado.
      nivel: classificar(efeito),
      efeito,
    };
    origem = 'descrita';
    avisos.push(
      'esta ação não existe no catálogo: o nível abaixo é o que o EFEITO descrito produz, ' +
        'não uma autorização. Para executar de verdade ela precisaria estar classificada — ' +
        'capacidade sem classificação vale R5.',
    );
  }

  const sinais = sinaisDaSimulacao(politica, pedido, fuso);
  const decisao = avaliar(capacidade, {
    sinais: sinais.map((s) => s.id),
    aprovacaoR2Ligada: pedido.aprovacaoR2Ligada,
  });

  const gatilhos = capacidade?.efeito ? gatilhosAcesos(politica, capacidade.efeito) : [];

  /*
   * A CONFERÊNCIA. A tabela do documento e o motor têm de dar o mesmo chão. Se
   * discordarem, o certo é dizer que discordam: a decisão continua sendo a do
   * motor (é ela que a porta usa), e o aviso aponta onde o documento e o código
   * se separaram.
   */
  if (capacidade?.efeito) {
    const peloMotor = classificar(capacidade.efeito);
    const pelaTabela = nivelPelaTabela(gatilhos);
    if (peloMotor !== pelaTabela) {
      avisos.push(
        `a tabela de gatilhos do documento diz ${pelaTabela} e o motor da escada diz ` +
          `${peloMotor} para este efeito. Vale o motor — é ele que a porta consulta. ` +
          'Os gatilhos listados abaixo estão desatualizados em relação ao código.',
      );
    }
    if (capacidade.nivel !== peloMotor && origem === 'catalogo') {
      avisos.push(
        `o catálogo declara "${capacidade.id}" em ${capacidade.nivel} e o efeito dela ` +
          `calcula ${peloMotor}: a decisão usa o MAIOR dos dois (${decisao.nivelBase}).`,
      );
    }
  }

  return {
    acao: {
      origem,
      capabilityId: pedido.capabilityId ?? null,
      rotulo,
      descricao: capacidade?.descricao ?? rotulo,
      efeito: capacidade?.efeito ?? null,
    },
    nivel: decisao.nivel,
    nivelBase: decisao.nivelBase,
    permitido: decisao.permitido,
    exigeAprovacao: decisao.exigeAprovacao,
    exigeReautenticacao: decisao.exigeReautenticacao,
    exigeMotivo: decisao.exigeMotivo,
    motivo: decisao.motivo,
    aprovacao: decisao.aprovacao,
    gatilhos,
    sinais,
    exigencias: exigenciasDe(politica, decisao, capacidade),
    rastro: politica.niveis?.[decisao.nivel]?.rastro ?? [],
    avisos,
    relogio: relogioDaSimulacao(pedido, fuso),
    politica: {
      versao: politica.versao,
      atualizadoEm: politica.atualizadoEm,
      origem: politica.origem,
    },
  };
}

/* ------------------------------------------------------------- o registro -- */

/** Quanto do rótulo cabe no log antes de virar entulho. */
const LIMITE_DO_ROTULO = 120;

/**
 * Texto de fora, dentro de uma linha de log, sem poder forjar outra.
 *
 * O rótulo da simulação vem do corpo da requisição — `descricao` é texto livre,
 * e `capabilityId` também é uma string qualquer até o catálogo desmenti-la. Um
 * `"\n2026-09-11 ERROR [ToolGateway] efeito executado"` no meio dele entra no
 * arquivo como UMA LINHA NOVA, com a cara de qualquer outra, e vira "prova" de
 * uma coisa que não aconteceu. Aqui todo caractere de controle (quebra de
 * linha, retorno de carro, tabulação, escape de terminal) vira espaço; o que
 * sobra é cercado por aspas e cortado no tamanho.
 */
export function paraLog(texto: string, limite = LIMITE_DO_ROTULO): string {
  // eslint-disable-next-line no-control-regex
  const semControle = texto.replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ');
  const limpo = semControle.replace(/\s+/g, ' ').trim();
  const cortado = limpo.length > limite ? `${limpo.slice(0, limite)}…` : limpo;
  return `"${cortado.replace(/"/g, "'")}"`;
}

/**
 * A linha que o log recebe quando alguém simula.
 *
 * Ela diz, com todas as letras, que foi CONSULTA — é o que permite investigar
 * "quem andou simulando o quê" sem que a simulação vire prova de ação nenhuma.
 * Mora aqui, e não no serviço, porque é função pura de texto: assim a defesa
 * contra injeção de linha tem teste, em vez de ter promessa. Os ids de sinal e
 * o nível não passam pelo sanitizador porque não vêm de fora — são enums do
 * pacote de política, e o esquema já recusou o resto.
 */
export function linhaDeLog(
  orgId: string,
  quem: string | undefined,
  r: ResultadoDaSimulacao,
): string {
  const acesos = r.sinais.map((s) => s.id).join(', ');
  return (
    `CONSULTA (simulação, nada executado) — empresa ${paraLog(orgId, 64)}, ` +
    `por ${paraLog(quem ?? 'desconhecido', 64)}: ${paraLog(r.acao.rotulo)} daria ${r.nivel}` +
    (acesos ? ` (sinais: ${acesos})` : '')
  );
}
