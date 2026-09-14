/* ==========================================================================
 * CUSTO DE IA — a conta que a tela faz, e a procedência de cada parcela (RF-B-03)
 * ==========================================================================
 *
 * Nada aqui inventa número. A regra é uma só, e vale linha a linha E no agregado:
 *
 *     parcela que não foi MEDIDA nunca aparece como dinheiro medido,
 *     e o que não foi medido aparece como NÃO MEDIDO — nunca como zero.
 *
 * "E no agregado" não é enfeite da frase: a versão anterior respeitava a regra em
 * cada linha da tabela por dia e a abandonava no cartão grande, que somava uma
 * janela inteiramente sem preço e imprimia "US$ 0,00 · conferido com o banco".
 *
 * ----------------------------------------------------------------------------
 * AS TRÊS PARCELAS, E O QUE CADA UMA É
 * ----------------------------------------------------------------------------
 *   · MEDIDO (`medidoUsd`) — o custo que o provedor informou, tokens contados,
 *     preço da tabela aplicado. É o único número que pode ser chamado de "custo
 *     real medido". Ele entra no livro-caixa por UM caminho só (`liquidar()`, a
 *     partir de `step()`), e esse caminho grava um passo de sessão para todo
 *     passo de modelo — por isso o medido do livro-caixa e a soma por agente
 *     descrevem o MESMO dinheiro.
 *   · ESTIMADO (`estimadoUsd`) — conta nossa, por DOIS métodos diferentes debaixo
 *     do mesmo nome, e a tela é obrigada a dizer isso:
 *       (a) o tamanho do texto que voltou, quando a chamada é `complete()` (que
 *           não devolve uso). É a maior parte do gasto de relatório, curadoria,
 *           pauta e ficha, e fica na ordem do custo real;
 *       (b) a RESERVA — o teto de saída do pedido —, quando o modelo servido saiu
 *           da tabela de preço no meio da chamada. Esse superestima: é cerca de
 *           SETE VEZES o custo típico de uma resposta de texto.
 *     Somar estimado com medido e chamar o resultado de medido é a mentira que
 *     este arquivo existe para não contar. Escondê-lo do total é a outra: sem ele
 *     a tabela por agente somava vinte e dois por cento do gasto e chamava de
 *     total.
 *   · NÃO MEDIDO (`chamadasSemPreco`) — chamadas cujo modelo servido não está na
 *     tabela de preço. Não há custo a somar, e somar zero faria uma empresa que
 *     gastou muito parecer barata. Viajam como CONTAGEM e aparecem como "n não
 *     medidas".
 *
 * ----------------------------------------------------------------------------
 * QUANDO NÃO HÁ TOTAL A MOSTRAR
 * ----------------------------------------------------------------------------
 * O livro-caixa do teto só é escrito para empresa que tenha linha de configuração
 * de teto — e nada no produto cria essa linha hoje. Para essas empresas o eixo
 * por dia vem VAZIO, e qualquer soma sobre ele daria zero: exatamente o mesmo
 * número de quem não gastou nada. A API detecta o caso (`livroCaixa`) e a tela
 * RECUSA mostrar total, em vez de mostrar zero com selo de conferido.
 *
 * ----------------------------------------------------------------------------
 * O ALERTA COMPARA O MESMO NÚMERO QUE O TETO CORTA
 * ----------------------------------------------------------------------------
 * `comprometidoUsd` = medido + estimado + reservado + arrasto. É exatamente a
 * soma que `TetoDeCustoIaService` usa para recusar a chamada. Alertar sobre
 * qualquer outra soma (só o medido, por exemplo) produziria uma pílula verde na
 * hora em que a próxima chamada é recusada — e a tela perderia a única coisa que
 * ela tinha para oferecer.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE PAINEL NÃO VÊ
 * ----------------------------------------------------------------------------
 * A vetorização (embeddings) não passa pelo envelope do teto e NÃO está em
 * nenhum número daqui. A API manda essa lista em `naoCoberto`, e a tela mostra —
 * com teste de componente cobrando, porque "a tela é obrigada" escrito em
 * comentário não obriga ninguém: o revisor apagou a seção inteira e a suíte
 * ficou verde.
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * O CONTRATO com `apps/api/src/llm/relatorio-custo.service.ts`.
 *
 * Cópia declarada, e não importação: `@mktos/shared` não publica nada do custo
 * de IA, e criar essa dependência por um punhado de campos custaria mais que a
 * duplicação (mesma decisão de `CODIGO_CONECTOR_DESLIGADO` em `lib/api.ts`). O
 * que amarra os dois lados é o teste de cada suíte.
 * ------------------------------------------------------------------------ */

export const ROTA_DO_RELATORIO = '/dashboard/custo-ia';

export interface DiaDeCusto {
  dia: string;
  medidoUsd: number;
  estimadoUsd: number;
  reservadoUsd: number;
  chamadas: number;
  chamadasSemPreco: number;
  cortes: number;
}

export interface AgenteDeCusto {
  slug: string;
  nome: string;
  iniciais: string;
  medidoUsd: number;
  passos: number;
  passosNaoMedidos: number;
  sessoes: number;
  ultimoEm: string | null;
}

export interface AgenteNoDia {
  dia: string;
  slug: string;
  medidoUsd: number;
  passos: number;
  passosNaoMedidos: number;
}

export interface ConsumoDeHoje {
  dia: string;
  fusoHorario: string;
  ativo: boolean;
  tetoUsd: number;
  gastoUsd: number;
  gastoEstimadoUsd: number;
  reservadoUsd: number;
  arrastoUsd: number;
  comprometidoUsd: number;
  restanteUsd: number;
  chamadas: number;
  chamadasSemPreco: number;
  cortes: number;
}

/**
 * O ORÇAMENTO MENSAL DE UM AGENTE, com o gasto do MÊS (fatia A3).
 *
 * ATENÇÃO AO PERÍODO: todo o resto deste relatório fala da janela de `dias`
 * dias; isto fala do MÊS CORRENTE no fuso de cada agente, porque é esse o
 * recorte do orçamento e é ele que corta. Somar um com o outro produz um número
 * que não existe — a tela mostra os dois com o período escrito em cada um.
 */
export interface OrcamentoDeAgente {
  agentSlug: string;
  nome: string;
  iniciais: string;
  /** `AAAA-MM` no fuso do agente. */
  mes: string;
  fusoHorario: string;
  /** `false` = ninguém definiu orçamento para este agente. Não é zero. */
  configurado: boolean;
  /** `false` = em observação: soma, mostra e NÃO corta. */
  ativo: boolean;
  orcamentoUsd: number;
  gastoUsd: number;
  passos: number;
  /** Passos cujo modelo não tem preço: não medidos, e o orçamento não os vê. */
  passosNaoMedidos: number;
  sessoes: number;
  restanteUsd: number | null;
  percentual: number | null;
  ultimoEm: string | null;
  definidoEm: string | null;
  definidoPor: string | null;
  motivo: string | null;
}

export interface ForaDoRelatorio {
  oQue: string;
  onde: string;
  ordemDeGrandeza: string;
  procedencia: string;
}

/** O estado do livro-caixa na janela — quem decide se há total a mostrar. */
export interface LivroCaixa {
  linhas: number;
  tetoConfigurado: boolean;
  passosComCusto: number;
  gastoDosPassosUsd: number;
  totalConfiavel: boolean;
  motivo: string | null;
}

export interface RelatorioDeCustoIa {
  orgId: string;
  fusoHorario: string;
  de: string;
  ate: string;
  dias: number;
  teto: {
    configurado: boolean;
    ativo: boolean;
    tetoDiarioUsd: number | null;
    percentualAlerta: number;
    definidoEm: string | null;
    motivo: string | null;
  };
  hoje: ConsumoDeHoje | null;
  porDia: DiaDeCusto[];
  porAgente: AgenteDeCusto[];
  porAgenteEDia: AgenteNoDia[];
  livroCaixa: LivroCaixa;
  conferencia: { medidoUsd: number; estimadoUsd: number; chamadas: number; linhas: number };
  atribuidoAAgenteUsd: number;
  /** Mês corrente por agente — período DIFERENTE do resto. Ver o tipo. */
  orcamentoDeAgentes: OrcamentoDeAgente[];
  naoCoberto: ForaDoRelatorio[];
  geradoEm: string;
}

/* --------------------------------------------------------------------------
 * FORMATO
 * ------------------------------------------------------------------------ */

/** O travessão. Um só lugar, para nunca virar "0,00" por descuido de digitação. */
export const NAO_MEDIDO = '—';

/**
 * Dólar, escrito em português.
 *
 * DÓLAR e não real, e isso é decisão, não preguiça: o provedor cobra em dólar e
 * o livro-caixa guarda dólar. Converter aqui gravaria na tela uma cotação que
 * envelhece entre o cálculo e a leitura — e o número que o operador compara com
 * a fatura deixaria de bater (ver o comentário de `TetoDeCustoIa.tetoDiarioUsd`
 * no schema).
 */
export function usd(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: valor !== 0 && Math.abs(valor) < 0.01 ? 4 : 2,
  });
}

/**
 * O rótulo de um valor que PODE não ter sido medido.
 *
 * `medivel === false` devolve travessão, sempre — inclusive quando o valor é
 * zero, que é justamente o caso perigoso: um zero vindo de "não há preço para
 * este modelo" tem a mesma cara de um zero vindo de "não gastou nada", e os dois
 * levam a conversas opostas com o cliente.
 */
export function rotuloUsd(valor: number, medivel = true): string {
  return medivel ? usd(valor) : NAO_MEDIDO;
}

/** Todas as chamadas foram em modelo sem preço? Então não há o que medir. */
export function tudoSemPreco(d: { chamadas: number; chamadasSemPreco: number }): boolean {
  return d.chamadas > 0 && d.chamadasSemPreco >= d.chamadas;
}

/* --------------------------------------------------------------------------
 * O TOTAL DA JANELA, CONFERIDO
 * ------------------------------------------------------------------------ */

export interface TotalDaJanela {
  /** Soma de `medidoUsd` das linhas — o custo real medido no período. */
  medidoUsd: number;
  /** Soma de `estimadoUsd` das linhas. Parcela própria, nunca fundida acima. */
  estimadoUsd: number;
  /** medido + estimado. É gasto; NÃO é "custo medido". */
  gastoUsd: number;
  chamadas: number;
  chamadasSemPreco: number;
  cortes: number;
  diasComGasto: number;
  /**
   * A JANELA INTEIRA foi de modelo sem preço?
   *
   * A mesma pergunta de `tudoSemPreco`, feita no agregado — porque é no agregado
   * que a resposta vira um cartão grande. Verdadeiro aqui significa que o
   * "US$ 0,00" do medido é ausência de preço, não ausência de gasto, e a tela
   * imprime travessão.
   */
  tudoSemPreco: boolean;
  /**
   * Há total a mostrar? Vem da API (`livroCaixa.totalConfiavel`), não é conta
   * daqui: quem sabe que o livro-caixa não foi escrito é quem consultou o banco.
   */
  disponivel: boolean;
  motivoIndisponivel: string | null;
  /**
   * A soma feita AQUI bate com o que o banco devolveu?
   *
   * As duas leituras saem do MESMO instantâneo (a API as faz numa transação
   * `REPEATABLE READ`), então divergir não é concorrência: é perda na conversão
   * de `Decimal`, corte de página ou payload adulterado. São QUATRO campos, e
   * não dois — comparar só dinheiro deixa passar uma contagem de chamadas
   * absurda, que foi como esta conferência já aprovou um payload inventado.
   */
  confere: boolean;
  divergenciaUsd: number;
  /** O que divergiu, com nome, para a tarja dizer o quê em vez de só gritar. */
  divergencias: string[];
}

/** Tolerância da conferência: a última casa da coluna `Decimal(12,6)` do banco. */
export const TOLERANCIA_USD = 0.000001;

function seis(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(6));
}

export function totalDaJanela(r: RelatorioDeCustoIa): TotalDaJanela {
  let medido = 0;
  let estimado = 0;
  let chamadas = 0;
  let semPreco = 0;
  let cortes = 0;
  let diasComGasto = 0;

  for (const d of r.porDia) {
    medido += d.medidoUsd;
    estimado += d.estimadoUsd;
    chamadas += d.chamadas;
    semPreco += d.chamadasSemPreco;
    cortes += d.cortes;
    if (d.medidoUsd > 0 || d.estimadoUsd > 0) diasComGasto++;
  }

  medido = seis(medido);
  estimado = seis(estimado);

  const difMedido = seis(Math.abs(medido - r.conferencia.medidoUsd));
  const difEstimado = seis(Math.abs(estimado - r.conferencia.estimadoUsd));
  const divergencia = seis(difMedido + difEstimado);

  const divergencias: string[] = [];
  if (difMedido > TOLERANCIA_USD) {
    divergencias.push(
      `medido: a tela soma ${usd(medido)} e o banco devolveu ${usd(r.conferencia.medidoUsd)}`,
    );
  }
  if (difEstimado > TOLERANCIA_USD) {
    divergencias.push(
      `estimado: a tela soma ${usd(estimado)} e o banco devolveu ${usd(r.conferencia.estimadoUsd)}`,
    );
  }
  if (chamadas !== r.conferencia.chamadas) {
    divergencias.push(
      `chamadas: a tela soma ${chamadas} e o banco contou ${r.conferencia.chamadas}`,
    );
  }
  if (r.porDia.length !== r.conferencia.linhas) {
    divergencias.push(
      `linhas: chegaram ${r.porDia.length} e o banco tem ${r.conferencia.linhas} na janela`,
    );
  }

  return {
    medidoUsd: medido,
    estimadoUsd: estimado,
    gastoUsd: seis(medido + estimado),
    chamadas,
    chamadasSemPreco: semPreco,
    cortes,
    diasComGasto,
    tudoSemPreco: tudoSemPreco({ chamadas, chamadasSemPreco: semPreco }),
    disponivel: r.livroCaixa.totalConfiavel,
    motivoIndisponivel: r.livroCaixa.totalConfiavel ? null : r.livroCaixa.motivo,
    confere: divergencias.length === 0,
    divergenciaUsd: divergencia,
    divergencias,
  };
}

/* --------------------------------------------------------------------------
 * QUANTO DO GASTO TEM DONO
 * ------------------------------------------------------------------------ */

/**
 * Por que a soma por agente passou do livro-caixa.
 *
 * Afirmar sempre a mesma causa ("é o caso de borda da virada do dia") enterrava
 * o defeito: numa empresa sem livro-caixa a diferença é o GASTO INTEIRO, e a
 * frase mandava não olhar.
 */
export type CausaDoExcedente =
  /** O livro-caixa não tem linha nenhuma. A diferença é o gasto inteiro. */
  | 'livro-caixa-nao-escrito'
  /** Sobra pequena: um passo liquidado do outro lado da meia-noite. */
  | 'virada-do-dia'
  /** Nem uma coisa nem outra. Isto é defeito, e a tela diz que é. */
  | 'inexplicado';

/**
 * Até que fração do atribuído a sobra ainda cabe na virada do dia.
 *
 * A virada move UM passo de UM agente para o rótulo do dia seguinte. Cinco por
 * cento é folga generosa para isso e apertada para qualquer outra coisa.
 */
export const FRACAO_DA_VIRADA = 0.05;

export interface AtribuicaoPorAgente {
  /** Soma do custo medido dos passos, por agente. */
  atribuidoUsd: number;
  /**
   * Medido do livro-caixa que NÃO casou com passo nenhum.
   *
   * NÃO é "chamada simples". `complete()` liquida por um caminho que grava ZERO
   * no medido e joga tudo no estimado; o medido só é escrito por `liquidar()`,
   * que tem um chamador só, e esse chamador grava um passo de sessão para todo
   * passo de modelo. Logo o dinheiro de relatório, curadoria, pauta e ficha
   * NUNCA aparece aqui — e o que sobra tende a zero: é resíduo de borda, não a
   * conta do que roda de madrugada. Por isso a linha se chama NÃO ATRIBUÍDO.
   */
  naoAtribuidoUsd: number;
  /** O medido do livro-caixa — o denominador honesto do eixo por agente. */
  medidoUsd: number;
  /**
   * O estimado do livro-caixa, INTEIRO.
   *
   * Não é atribuível a agente (o livro-caixa guarda por empresa e dia, sem dono),
   * e por isso viaja na linha do não atribuído. Sem ele a tabela por agente
   * somaria uma fração do gasto e chamaria de total.
   */
  estimadoUsd: number;
  /** medido + estimado: o gasto do período. É o rodapé honesto da tabela. */
  gastoUsd: number;
  /** Os passos somam MAIS que o livro-caixa? */
  excedente: boolean;
  excedenteUsd: number;
  /** E, se somam, por quê — ver `CausaDoExcedente`. */
  causa: CausaDoExcedente | null;
}

/**
 * A parte do gasto que tem dono, a parte que não tem, e a parte que não é
 * medida em dinheiro por agente nenhum.
 */
export function atribuicaoPorAgente(r: RelatorioDeCustoIa): AtribuicaoPorAgente {
  const medido = seis(r.conferencia.medidoUsd);
  const estimado = seis(r.conferencia.estimadoUsd);
  const atribuido = seis(r.atribuidoAAgenteUsd);
  const excedenteUsd = seis(Math.max(atribuido - medido, 0));
  const excedente = atribuido - medido > TOLERANCIA_USD;

  let causa: CausaDoExcedente | null = null;
  if (excedente) {
    if (!r.livroCaixa.totalConfiavel || r.livroCaixa.linhas === 0) {
      causa = 'livro-caixa-nao-escrito';
    } else if (atribuido > 0 && excedenteUsd / atribuido <= FRACAO_DA_VIRADA) {
      causa = 'virada-do-dia';
    } else {
      causa = 'inexplicado';
    }
  }

  return {
    atribuidoUsd: atribuido,
    naoAtribuidoUsd: seis(Math.max(medido - atribuido, 0)),
    medidoUsd: medido,
    estimadoUsd: estimado,
    gastoUsd: seis(medido + estimado),
    excedente,
    excedenteUsd,
    causa,
  };
}

/** A frase do excedente, dita pela causa e não por um chute fixo. */
export function fraseDoExcedente(a: AtribuicaoPorAgente): string | null {
  if (!a.excedente || !a.causa) return null;
  const cabeca =
    `Os passos por agente somam ${usd(a.atribuidoUsd)} e o livro-caixa registra ` +
    `${usd(a.medidoUsd)} — ${usd(a.excedenteUsd)} a mais. `;
  if (a.causa === 'livro-caixa-nao-escrito') {
    return (
      cabeca +
      'O livro-caixa não tem linha nenhuma nesta janela: a diferença é o gasto inteiro, e não ' +
      'uma sobra. Nenhum total desta tela vale enquanto isso não for corrigido.'
    );
  }
  if (a.causa === 'virada-do-dia') {
    return (
      cabeca +
      'A sobra é pequena o bastante para ser o caso de borda da virada do dia (um passo ' +
      'liquidado na linha de ontem e rotulado como hoje). Não use a diferença como medida de nada.'
    );
  }
  return (
    cabeca +
    'Isso NÃO cabe no caso de borda da virada do dia. É defeito: ou o livro-caixa perdeu ' +
    'liquidação, ou passo foi contado duas vezes. Investigue antes de usar qualquer número daqui.'
  );
}

/* --------------------------------------------------------------------------
 * O ALERTA DE TETO
 * ------------------------------------------------------------------------ */

export type EstadoDoTeto =
  /** Ninguém definiu teto para esta empresa. Não é teto zero. */
  | 'sem-teto'
  /** Teto definido como zero: a empresa está desligada para IA. */
  | 'zerado'
  | 'ok'
  /** Cruzou o percentual configurado. */
  | 'atencao'
  /** Encostou ou passou do teto: a próxima chamada é recusada. */
  | 'estourado';

export interface AlertaDeTeto {
  estado: EstadoDoTeto;
  /** O teto RECUSA a chamada, ou só observa e soma? (`TetoDeCustoIa.ativo`) */
  impoe: boolean;
  /** Percentual do teto já comprometido. `null` quando não há teto. */
  percentual: number | null;
  /** O percentual configurado que aciona o alerta. */
  limiar: number;
  tetoUsd: number | null;
  /** medido + estimado + reservado + arrasto — a mesma soma que corta. */
  comprometidoUsd: number | null;
  /** Disparou? É `atencao` ou `estourado`, e só isso. */
  disparou: boolean;
  /** A frase, pronta, em português. */
  frase: string;
}

/**
 * O alerta do dia corrente.
 *
 * `hoje` vem do MESMO serviço que recusa a chamada, e não de uma conta refeita
 * aqui. Se um dia esta função passar a recalcular o comprometido a partir de
 * `porDia`, a pílula deixa de falar do teto e passa a falar de outra coisa
 * parecida — sem `reservadoUsd` e sem `arrastoUsd`, ela ficaria verde
 * exatamente no momento em que a porta começa a cortar.
 */
export function alertaDoTeto(r: RelatorioDeCustoIa): AlertaDeTeto {
  const limiar = r.teto.percentualAlerta;

  if (!r.teto.configurado || !r.hoje) {
    return {
      estado: 'sem-teto',
      impoe: false,
      percentual: null,
      limiar,
      tetoUsd: null,
      comprometidoUsd: null,
      disparou: false,
      frase: 'sem teto definido — nada corta, nada alerta e o livro-caixa não é escrito',
    };
  }

  const teto = r.hoje.tetoUsd;
  const comprometido = r.hoje.comprometidoUsd;
  const impoe = r.hoje.ativo;
  const observando = impoe ? '' : ' (teto em observação: soma, não corta)';

  if (teto <= 0) {
    return {
      estado: 'zerado',
      impoe,
      percentual: null,
      limiar,
      tetoUsd: teto,
      comprometidoUsd: comprometido,
      disparou: true,
      frase: `teto zerado: nenhuma chamada de IA passa${observando}`,
    };
  }

  // Arredondado para uma casa: o percentual é leitura, não conta de dinheiro.
  const percentual = Number(((comprometido / teto) * 100).toFixed(1));

  if (comprometido >= teto) {
    return {
      estado: 'estourado',
      impoe,
      percentual,
      limiar,
      tetoUsd: teto,
      comprometidoUsd: comprometido,
      disparou: true,
      frase: `no teto do dia: ${usd(comprometido)} de ${usd(teto)}${
        impoe ? ' — a próxima chamada é recusada' : observando
      }`,
    };
  }

  if (percentual >= limiar) {
    return {
      estado: 'atencao',
      impoe,
      percentual,
      limiar,
      tetoUsd: teto,
      comprometidoUsd: comprometido,
      disparou: true,
      frase: `${percentual}% do teto do dia — alerta em ${limiar}%${observando}`,
    };
  }

  return {
    estado: 'ok',
    impoe,
    percentual,
    limiar,
    tetoUsd: teto,
    comprometidoUsd: comprometido,
    disparou: false,
    frase: `${percentual}% do teto do dia${observando}`,
  };
}

/** A cor do estado, na escala da casa (globals.css). */
export const TOM_DO_TETO: Record<EstadoDoTeto, 'default' | 'good' | 'warn' | 'bad'> = {
  'sem-teto': 'default',
  zerado: 'bad',
  ok: 'good',
  atencao: 'warn',
  estourado: 'bad',
};

/** `2026-09-11` -> `11/09`. Sem `new Date`: o rótulo já vem no fuso da empresa. */
export function diaCurto(dia: string): string {
  const [, mes, d] = dia.split('-');
  return mes && d ? `${d}/${mes}` : dia;
}

/* --------------------------------------------------------------------------
 * O ORÇAMENTO MENSAL POR AGENTE — fatia A3
 * ------------------------------------------------------------------------ */

export type EstadoDoOrcamento =
  /** Ninguém definiu orçamento para este agente. Não é orçamento zero. */
  | 'sem-orcamento'
  /** Definido como zero E valendo: este agente está desligado para IA. */
  | 'zerado'
  | 'ok'
  /** Cruzou o percentual configurado do orçamento. */
  | 'atencao'
  /** Encostou ou passou: a próxima chamada dele é recusada. */
  | 'estourado';

export interface AlertaDoOrcamento {
  agentSlug: string;
  nome: string;
  estado: EstadoDoOrcamento;
  /** Recusa a chamada, ou só observa e soma? (`Agent.orcamentoAtivo`) */
  impoe: boolean;
  percentual: number | null;
  limiar: number;
  orcamentoUsd: number | null;
  gastoUsd: number;
  restanteUsd: number | null;
  /** Passos do mês cujo modelo não tem preço — invisíveis ao orçamento. */
  passosNaoMedidos: number;
  disparou: boolean;
  frase: string;
}

/**
 * O alerta de UM agente no mês corrente.
 *
 * `limiar` é o MESMO percentual do teto da empresa (`TETO_IA_ALERTA_PERCENT`),
 * e de propósito: dois limiares diferentes para a mesma pergunta ("estou perto
 * do limite?") fariam a tela acender em momentos distintos sem que ninguém
 * soubesse explicar por quê. Um por agente exigiria coluna nova, e ela não
 * entrou nesta fatia.
 *
 * ESTADO NÃO É ALARME QUANDO NÃO IMPÕE: um orçamento em observação que estourou
 * continua estourado (o número é verdade), mas a frase diz que nada foi
 * recusado. Pintar de vermelho e não cortar treina a pessoa a ignorar vermelho.
 */
export function alertaDoOrcamento(o: OrcamentoDeAgente, limiar: number): AlertaDoOrcamento {
  const base = {
    agentSlug: o.agentSlug,
    nome: o.nome,
    impoe: o.ativo,
    limiar,
    gastoUsd: o.gastoUsd,
    passosNaoMedidos: o.passosNaoMedidos,
  };

  if (!o.configurado) {
    return {
      ...base,
      estado: 'sem-orcamento' as const,
      percentual: null,
      orcamentoUsd: null,
      restanteUsd: null,
      disparou: false,
      frase:
        `sem orçamento mensal — gastou ${usd(o.gastoUsd)} em ${o.mes} e só o teto da empresa o ` +
        'segura',
    };
  }

  if (o.orcamentoUsd <= 0) {
    return {
      ...base,
      estado: 'zerado' as const,
      percentual: null,
      orcamentoUsd: 0,
      restanteUsd: 0,
      disparou: o.ativo,
      frase: o.ativo
        ? 'orçamento em US$ 0,00 valendo: nenhuma chamada de modelo deste agente é permitida'
        : 'orçamento em US$ 0,00 e DESLIGADO: nada corta — é o mesmo que não ter orçamento',
    };
  }

  const pct = o.percentual ?? 0;
  const restante = o.restanteUsd ?? 0;
  const sufixo = o.ativo
    ? ''
    : ' (em observação: soma e NÃO corta — nenhuma chamada foi recusada)';

  if (pct >= 100) {
    return {
      ...base,
      estado: 'estourado' as const,
      percentual: pct,
      orcamentoUsd: o.orcamentoUsd,
      restanteUsd: restante,
      disparou: true,
      frase:
        `${usd(o.gastoUsd)} de ${usd(o.orcamentoUsd)} no mês (${pct}%)` +
        (o.ativo ? ' — a próxima chamada deste agente é recusada' : '') +
        sufixo,
    };
  }

  if (pct >= limiar) {
    return {
      ...base,
      estado: 'atencao' as const,
      percentual: pct,
      orcamentoUsd: o.orcamentoUsd,
      restanteUsd: restante,
      disparou: true,
      frase: `${usd(o.gastoUsd)} de ${usd(o.orcamentoUsd)} no mês (${pct}%) — restam ${usd(restante)}${sufixo}`,
    };
  }

  return {
    ...base,
    estado: 'ok' as const,
    percentual: pct,
    orcamentoUsd: o.orcamentoUsd,
    restanteUsd: restante,
    disparou: false,
    frase: `${usd(o.gastoUsd)} de ${usd(o.orcamentoUsd)} no mês (${pct}%)${sufixo}`,
  };
}

/** O panorama inteiro, na ordem em que a API o mandou. */
export function alertasDeOrcamento(r: RelatorioDeCustoIa): AlertaDoOrcamento[] {
  return (r.orcamentoDeAgentes ?? []).map((o) => alertaDoOrcamento(o, r.teto.percentualAlerta));
}
