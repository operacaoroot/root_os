/*
 * ============================================================================
 * A PARTE PURA DA ASSINATURA — quem decide suspender, e o que a impede — RF-O-03
 * ============================================================================
 *
 * Nada aqui toca banco, rede, Nest ou relógio implícito: o agora entra por
 * parâmetro. É de propósito, e o motivo é o mesmo do `cofre/segredo.ts`: a
 * promessa central desta fatia — "suspender não apaga nada, e reativar devolve
 * tudo" — precisa poder ser exercitada por tentativa, dezenas de vezes, em todos
 * os estados em que o provedor pode responder errado.
 *
 * ----------------------------------------------------------------------------
 * A REGRA QUE GOVERNA O ARQUIVO INTEIRO
 * ----------------------------------------------------------------------------
 * **Suspende-se por PROVA POSITIVA de inadimplência, nunca por ausência de
 * prova.** Silêncio do provedor, erro de rede, resposta vazia, leitura
 * incompleta — todos significam "não sei", e "não sei" NUNCA vira suspensão.
 *
 * Não é zelo: esta execução já produziu duas guardas mal calibradas que apagavam
 * dado de cliente. A forma que o erro toma aqui é conhecida e barata de
 * escrever sem querer:
 *
 *     const pagou = cobrancas.some((c) => c.status === 'paga');
 *     if (!pagou) suspender();          // ← lista VAZIA suspende todo mundo
 *
 * Uma falha de autenticação no provedor devolve lista vazia com a mesma cara de
 * "cliente sem cobrança nenhuma". O código acima suspenderia a carteira inteira
 * numa rodada, e a suspensão de um cliente que pagou é indistinguível, para ele,
 * de ter perdido a conta.
 *
 * ----------------------------------------------------------------------------
 * OS QUATRO ESTADOS, E POR QUE SÃO QUATRO
 * ----------------------------------------------------------------------------
 *   ativa .......... em dia (ou dentro do vencimento). Acesso inteiro.
 *   inadimplente ... tem cobrança vencida, AINDA DENTRO DA CARÊNCIA. Acesso
 *                    inteiro, e a tela avisa. É o degrau que existe para que a
 *                    suspensão nunca seja a primeira notícia — sem ele, o
 *                    cliente descobre o atraso quando o sistema já fechou.
 *   suspensa ....... vencida além da carência. Acesso bloqueado, DADO INTACTO.
 *   cancelada ...... a relação acabou. Acesso bloqueado, dado intacto, e nenhuma
 *                    conferência automática a tira daqui (ver `TERMINAIS`).
 */

/** Os estados possíveis de uma assinatura. Espelha o CHECK do banco. */
export const ESTADOS_DE_ASSINATURA = ['ativa', 'inadimplente', 'suspensa', 'cancelada'] as const;
export type EstadoDeAssinatura = (typeof ESTADOS_DE_ASSINATURA)[number];

/** Os estados possíveis de uma cobrança. Espelha o CHECK do banco. */
export const ESTADOS_DE_COBRANCA = ['aberta', 'paga', 'vencida', 'cancelada'] as const;
export type EstadoDeCobranca = (typeof ESTADOS_DE_COBRANCA)[number];

export function ehEstadoDeAssinatura(v: unknown): v is EstadoDeAssinatura {
  return typeof v === 'string' && (ESTADOS_DE_ASSINATURA as readonly string[]).includes(v);
}

export function ehEstadoDeCobranca(v: unknown): v is EstadoDeCobranca {
  return typeof v === 'string' && (ESTADOS_DE_COBRANCA as readonly string[]).includes(v);
}

/**
 * Estados dos quais a CONFERÊNCIA AUTOMÁTICA não tira ninguém.
 *
 * Só `cancelada`, e a razão é que cancelamento é decisão comercial de gente: uma
 * cobrança antiga que o provedor devolva como paga não pode ressuscitar um
 * contrato encerrado. Sair daqui é sempre ato explícito (`reativar`).
 */
export const TERMINAIS: ReadonlySet<EstadoDeAssinatura> = new Set<EstadoDeAssinatura>(['cancelada']);

/**
 * Os estados que BLOQUEIAM o acesso ao produto.
 *
 * UM predicado, um caminho. A alternativa — `suspensa` bloquear pelo gate e
 * `cancelada` bloquear por outra regra em outro lugar — é como dois controles
 * que dizem a mesma coisa divergem, e o que ficar para trás é o que deixa
 * passar.
 *
 * BLOQUEAR NÃO É APAGAR, e a diferença é o coração da fatia: o que este conjunto
 * governa é uma resposta HTTP. Nenhuma linha de dado do cliente muda de estado
 * por causa dele, nem quando ele entra, nem quando ele sai.
 */
export const ESTADOS_QUE_BLOQUEIAM: ReadonlySet<EstadoDeAssinatura> = new Set<EstadoDeAssinatura>([
  'suspensa',
  'cancelada',
]);

/** O retrato mínimo da assinatura de que a decisão precisa. */
export interface AssinaturaParaDecisao {
  status: EstadoDeAssinatura;
  diasDeCarencia: number;
  /**
   * A MARCA DA REATIVAÇÃO EXPLÍCITA — cobranças vencidas ATÉ aqui não decidem
   * mais nada.
   *
   * Ela existe porque a reativação à mão prometia uma coisa que não entregava.
   * `reativar` é a saída declarada para pagamento por fora (PIX direto, boleto
   * de outra conta), acordo comercial e suspensão indevida que precisa ser
   * desfeita AGORA — e nos três casos o PROVEDOR CONTINUA DIZENDO VENCIDO,
   * porque o dinheiro não passou por ele. Sem esta marca, a conferência seguinte
   * relia a mesma cobrança e suspendia de novo: medido, a reativação durava um
   * segundo.
   *
   * É um INSTANTE e não uma bandeira, e a diferença é o que impede o perdão de
   * virar isenção vitalícia: perdoa-se o que já estava vencido quando alguém
   * decidiu reativar, e só isso. A fatura do mês seguinte vence depois desta
   * marca, não é perdoada, e suspende normalmente.
   *
   * `null` = nunca houve reativação explícita; nada é perdoado.
   */
  perdoadasAte: Date | null;
}

/** O retrato mínimo de uma cobrança de que a decisão precisa. */
export interface CobrancaParaDecisao {
  id: string;
  referencia: string;
  status: EstadoDeCobranca;
  vencimento: Date;
}

/**
 * O resultado de UMA leitura do provedor.
 *
 * `completa` é o campo que separa esta fatia de uma armadilha real: o provedor
 * pagina, e uma leitura que parou no meio (rede caiu, teto de páginas, timeout)
 * tem a MESMA cara de uma leitura inteira com poucas cobranças. Sem este campo,
 * "a página 1 não tinha a cobrança paga" viraria "não pagou".
 *
 * Ele não é opcional de propósito: quem produz a leitura é obrigado a responder.
 */
export interface LeituraDoProvedor {
  /** A leitura terminou? Falso = paginação interrompida, teto atingido, erro. */
  completa: boolean;
  cobrancas: readonly CobrancaParaDecisao[];
}

export type MotivoDeNaoDecidir =
  | 'leitura_incompleta'
  | 'estado_terminal'
  | 'sem_mudanca';

/**
 * O RETRATO DA LEITURA CORRENTE, e por que ele não é "as linhas do banco".
 *
 * Esta interface é a correção de um defeito que passou por revisão adversarial
 * e foi REPRODUZIDO contra o banco. A função pura sempre esteve certa; quem a
 * chamava é que entregava a ela TODAS as linhas espelhadas da empresa, e não as
 * que a leitura corrente confirmou.
 *
 * O que isso produzia, em três passos:
 *
 *   1. o provedor devolve uma cobrança vencida; ela é espelhada;
 *   2. o provedor para de mencioná-la (ela foi paga por fora, foi cancelada
 *      lá dentro, sumiu do filtro, o que for) e passa a devolver LISTA VAZIA;
 *   3. a conferência seguinte lia a linha VELHA do espelho e suspendia — em
 *      leitura COMPLETA e VAZIA, que é exatamente o cenário que o cabeçalho
 *      deste arquivo declara impossível.
 *
 * E como o espelho nunca apaga (de propósito: é o histórico de pagamento do
 * cliente), uma cobrança vencida espelhada UMA vez decidia acesso PARA SEMPRE.
 *
 * A regra, então, e ela vale para quem for escrever o próximo chamador: **o
 * espelho guarda o histórico; ele não decide acesso.** Quem decide é o que o
 * provedor disse AGORA.
 */
export type CobrancasDaLeituraCorrente = readonly CobrancaParaDecisao[];

export type Transicao =
  | {
      muda: true;
      de: EstadoDeAssinatura;
      para: EstadoDeAssinatura;
      /** A cobrança que sustenta a decisão, quando há uma. */
      cobrancaId: string | null;
      motivo: string;
    }
  | { muda: false; porque: MotivoDeNaoDecidir; motivo: string };

/**
 * Esta cobrança está vencida ALÉM da carência, em `agora`?
 *
 * `status === 'vencida'` é exigido, e não deduzido da data: quem decide se uma
 * cobrança venceu é quem recebe o dinheiro. Uma cobrança que o provedor ainda
 * chama de `aberta` com a data no passado é um boleto que ele ainda aceita —
 * tratá-la como vencida aqui suspenderia quem está a caminho do banco.
 *
 * A carência é somada em DIAS DE 24 HORAS, e não em "dias de calendário". A
 * diferença aparece duas vezes por ano, no horário de verão de quem usa: com
 * calendário, um dia tem 23 ou 25 horas dependendo da zona, e a fronteira da
 * suspensão andaria uma hora para cada lado sem ninguém entender. Vinte e quatro
 * horas é sempre vinte e quatro horas, e o erro máximo contra o cliente é uma
 * hora numa carência de sete dias.
 */
export function vencidaAlemDaCarencia(
  cobranca: CobrancaParaDecisao,
  diasDeCarencia: number,
  agora: Date,
): boolean {
  if (cobranca.status !== 'vencida') return false;
  const limite = cobranca.vencimento.getTime() + diasDeCarencia * 86_400_000;
  return agora.getTime() > limite;
}

/** Cobrança vencida, mas ainda dentro da carência. */
export function vencidaNaCarencia(
  cobranca: CobrancaParaDecisao,
  diasDeCarencia: number,
  agora: Date,
): boolean {
  if (cobranca.status !== 'vencida') return false;
  return !vencidaAlemDaCarencia(cobranca, diasDeCarencia, agora);
}

/**
 * A DECISÃO. Dado o estado atual e UMA leitura do provedor, para onde ir.
 *
 * Devolve `{ muda: false }` — e não uma transição para o mesmo estado — sempre
 * que não houver o que fazer. É essa forma que torna o método que a consome
 * IDEMPOTENTE de graça: rodar duas vezes seguidas não reescreve data nenhuma,
 * não registra evento duplicado e não move `suspensaEm` para frente. "Alguém
 * rodou duas vezes" deixa de ser um caso a tratar e passa a ser um caso que não
 * existe.
 *
 * AS TRÊS RECUSAS, em ordem, e cada uma é uma pergunta do enunciado da fatia:
 *
 *  1. LEITURA INCOMPLETA — "e quando a rede cai no meio?". Não decide. Nem para
 *     suspender (o cliente perderia acesso por um timeout) nem para reativar (o
 *     sistema abriria a porta por não ter conseguido ver a dívida).
 *  2. ESTADO TERMINAL — contrato cancelado não volta por conferência.
 *  3. SEM MUDANÇA — já está onde deveria estar.
 *
 * E a que não é recusa e sim o desenho: LISTA VAZIA NUNCA SUSPENDE. Uma leitura
 * completa sem cobrança nenhuma significa "esta empresa não tem cobrança
 * vencida", que é o oposto de inadimplência. É aqui que mora o erro descrito no
 * cabeçalho, e é por isso que a decisão procura o que ESTÁ VENCIDO em vez de
 * procurar o que está pago.
 *
 * `leitura.cobrancas` É A LEITURA CORRENTE, NUNCA O ESPELHO INTEIRO. Ver
 * `CobrancasDaLeituraCorrente`: a garantia acima é falsa se quem chama entregar
 * as linhas velhas do banco, porque aí "lista vazia" nunca chega até aqui.
 */
export function decidirTransicao(
  assinatura: AssinaturaParaDecisao,
  leitura: LeituraDoProvedor,
  agora: Date,
): Transicao {
  if (!leitura.completa) {
    return {
      muda: false,
      porque: 'leitura_incompleta',
      motivo:
        'a leitura do provedor não terminou: sem saber o que há, o sistema não muda o acesso ' +
        'de ninguém — nem para suspender, nem para liberar.',
    };
  }

  if (TERMINAIS.has(assinatura.status)) {
    return {
      muda: false,
      porque: 'estado_terminal',
      motivo: `assinatura ${assinatura.status}: só sai daqui por ato explícito de quem administra.`,
    };
  }

  const carencia = Math.max(0, assinatura.diasDeCarencia);

  /*
   * O PERDÃO DA REATIVAÇÃO EXPLÍCITA, aplicado ANTES de qualquer contagem.
   *
   * Filtra por VENCIMENTO e não por identificador: a cobrança que o provedor
   * devolve hoje pode ter identificador novo (ele reemite, renumera, junta
   * parcelas), e uma lista de ids perdoados envelheceria na primeira reemissão —
   * voltando a suspender quem já tinha sido reativado à mão, que é o defeito que
   * esta marca existe para consertar.
   *
   * `>` e não `>=`: uma cobrança que vence no MESMO instante em que alguém
   * reativou está perdoada. O erro para o lado do cliente, como todo o resto
   * deste arquivo.
   */
  const perdao = assinatura.perdoadasAte;
  const relevantes = perdao
    ? leitura.cobrancas.filter((c) => c.vencimento.getTime() > perdao.getTime())
    : leitura.cobrancas;
  const perdoadas = leitura.cobrancas.length - relevantes.length;

  const alemDaCarencia = relevantes.filter((c) => vencidaAlemDaCarencia(c, carencia, agora));
  const naCarencia = relevantes.filter((c) => vencidaNaCarencia(c, carencia, agora));

  let destino: EstadoDeAssinatura;
  let cobrancaId: string | null = null;
  let motivo: string;

  if (alemDaCarencia.length > 0) {
    // A MAIS ANTIGA sustenta a decisão: é a que explica há quanto tempo a
    // empresa está devendo, e é ela que a tela mostra.
    const maisAntiga = [...alemDaCarencia].sort(
      (a, b) => a.vencimento.getTime() - b.vencimento.getTime(),
    )[0];
    destino = 'suspensa';
    cobrancaId = maisAntiga.id;
    motivo =
      `cobrança ${maisAntiga.referencia} venceu em ${maisAntiga.vencimento.toISOString().slice(0, 10)} ` +
      `e passou da carência de ${carencia} dia(s)`;
  } else if (naCarencia.length > 0) {
    const maisAntiga = [...naCarencia].sort(
      (a, b) => a.vencimento.getTime() - b.vencimento.getTime(),
    )[0];
    destino = 'inadimplente';
    cobrancaId = maisAntiga.id;
    motivo =
      `cobrança ${maisAntiga.referencia} venceu em ${maisAntiga.vencimento.toISOString().slice(0, 10)}, ` +
      `dentro da carência de ${carencia} dia(s)`;
  } else {
    destino = 'ativa';
    motivo = perdoadas
      ? `nenhuma cobrança vencida que valha: ${perdoadas} foi(ram) perdoada(s) pela reativação ` +
        `de ${perdao!.toISOString().slice(0, 10)}`
      : 'nenhuma cobrança vencida na leitura do provedor';
  }

  if (destino === assinatura.status) {
    return { muda: false, porque: 'sem_mudanca', motivo };
  }

  return { muda: true, de: assinatura.status, para: destino, cobrancaId, motivo };
}

/**
 * O acesso ao produto está bloqueado neste estado?
 *
 * NULO (assinatura inexistente) NÃO BLOQUEIA, e esta é a decisão de falha mais
 * importante do módulo. Hoje nenhuma empresa tem linha de assinatura — inclusive
 * a da própria ROOT. Se ausência bloqueasse, esta fatia derrubaria a carteira
 * inteira no minuto em que subisse, e um defeito futuro que impedisse a criação
 * da linha (uma migração que não rodou, um provisionamento que falhou no meio)
 * trancaria clientes que pagaram em dia.
 *
 * O QUE ISSO CUSTA, escrito para ninguém "consertar" depois sem saber: empresa
 * sem linha de assinatura NÃO é cobrada e NÃO é suspensa. Quem responde por isso
 * é o provisionamento, que precisa criar a linha — não este predicado, que
 * responderia trancando gente.
 */
export function acessoBloqueado(status: EstadoDeAssinatura | null | undefined): boolean {
  if (!status) return false;
  return ESTADOS_QUE_BLOQUEIAM.has(status);
}

/*
 * ============================================================================
 * O GATE DE ROTA — o que um suspenso AINDA alcança
 * ============================================================================
 *
 * Bloquear tudo tranca o cliente do lado de fora do próprio conserto: sem
 * autenticação ele não entra, sem a resposta de "quais módulos eu tenho" o
 * painel não monta, e sem a rota da assinatura ele não vê por que está fora nem
 * consegue avisar que pagou. O bloqueio ficaria correto e inútil.
 *
 * ----------------------------------------------------------------------------
 * POR QUE A LISTA PASSOU A SER DE CAMINHOS, E NÃO DE FAMÍLIAS
 * ----------------------------------------------------------------------------
 * A primeira escrita liberava `tenants` INTEIRO, porque o web precisa de
 * `GET /api/tenants/modulos` para montar. Na mesma onda nasceram três famílias
 * novas embaixo daquele prefixo — `tenants/onboarding`, `tenants/plataforma` e
 * `tenants/suporte` — e as três ficaram liberadas para empresa suspensa SEM
 * NINGUÉM DECIDIR NADA. Foi o exato acidente que `PREFIXOS_DA_ESPINHA` existe
 * para não ter: o silêncio, e não a decisão errada.
 *
 * Então a unidade aqui é o CAMINHO, e liberar uma família inteira passou a
 * exigir a palavra `familia: true` escrita à mão, com o motivo ao lado. A
 * diferença prática: acrescentar `@Controller('tenants/qualquercoisa')` não
 * libera nada; acrescentar rota dentro de `auth` libera, e é por isso que
 * `assinatura.test.ts` varre os `@Controller()` do código e REPROVA quando a
 * conta de rotas liberadas muda sem alguém declarar a nova.
 *
 *   auth ............. família. Entrar, sair, saber quem sou, o OAuth do Google.
 *                      Um suspenso que não consegue autenticar não chega em tela
 *                      nenhuma, e cada rota de lá é um passo do mesmo login.
 *   health ........... família. É do operador da plataforma, não do cliente, e
 *                      responde igual para todo mundo.
 *   config ........... família. Preferências do painel (tema, idioma, senha).
 *                      Sem ela a casca quebra ANTES de desenhar a tela que
 *                      explica o bloqueio, e preferência de tela não é dado de
 *                      negócio.
 *   assinatura ....... família. É a tela de suspensão inteira: ver o contrato,
 *                      guardar a credencial, conferir, reativar.
 *   tenants/modulos .. CAMINHO, e só ele. O web não monta sem esta resposta. O
 *                      resto de `tenants` fica de fora, nominalmente:
 *                      `tenants/provisionar` cria empresa, `tenants/onboarding`
 *                      carrega contexto, `tenants/plataforma` e
 *                      `tenants/suporte` são o console de quem OPERA a
 *                      plataforma — nada disso é caminho de quem está suspenso
 *                      voltando a pagar.
 */
export interface CaminhoLiberadoNaSuspensao {
  /** Os segmentos depois de `api`, separados por `/`. Minúsculas. */
  caminho: string;
  /** `true` libera tudo abaixo dele; `false` libera só o caminho exato. */
  familia: boolean;
  porque: string;
}

export const LIBERADOS_NA_SUSPENSAO: readonly CaminhoLiberadoNaSuspensao[] = [
  {
    caminho: 'auth',
    familia: true,
    porque: 'sem autenticar não há sessão, e sem sessão não há tela que explique o bloqueio',
  },
  {
    caminho: 'health',
    familia: true,
    porque: 'é do operador da plataforma; não carrega dado de empresa nenhuma',
  },
  {
    caminho: 'config',
    familia: true,
    porque: 'preferência de tela não é dado de negócio, e sem ela a casca quebra antes da tela',
  },
  {
    caminho: 'assinatura',
    familia: true,
    porque: 'é a própria tela de suspensão: ver, conferir, reativar e guardar a credencial',
  },
  {
    caminho: 'tenants/modulos',
    familia: false,
    porque:
      'o web não monta sem saber quais módulos a empresa tem. O RESTO de `tenants` fica de fora ' +
      'de propósito — provisionar, onboarding, console da plataforma e acesso de suporte não são ' +
      'caminho de quem está suspenso voltando a pagar',
  },
] as const;

/**
 * Os segmentos de um caminho da API, nas DUAS grafias.
 *
 * Mesmo cuidado de `segmentoDaApi` (em `tenants/modulos.ts`) e pelos mesmos três
 * motivos — minúsculas porque o Express casa rota sem diferenciar caixa;
 * percent-decoding porque `%74enants` é a mesma rota no dia em que alguém trocar
 * o roteador; query e fragmento fora porque o que chega ao interceptor é
 * `originalUrl`. A diferença é que aqui a decisão precisa de mais de um
 * segmento, e `segmentoDaApi` devolve só o primeiro — copiar a normalização
 * seria a segunda cópia de uma trava, então este arquivo faz a dele e o teste
 * confere as duas contra os mesmos casos.
 */
function segmentosDaApi(caminho: string): { cru: string[]; decodificado: string[] } {
  const semQuery = caminho.split(/[?#]/)[0];
  const partes = semQuery
    .split('/')
    .filter((p) => p !== '')
    .map((p) => p.toLowerCase());
  if (partes[0] === 'api') partes.shift();
  const decodificado = partes.map((p) => {
    try {
      return decodeURIComponent(p).toLowerCase();
    } catch {
      // `%zz` não é escape válido: fica o cru, que é o que o Express veria.
      return p;
    }
  });
  return { cru: partes, decodificado };
}

function casaAlgum(segmentos: readonly string[]): boolean {
  return LIBERADOS_NA_SUSPENSAO.some((l) => {
    const alvo = l.caminho.split('/');
    if (!l.familia && segmentos.length !== alvo.length) return false;
    if (segmentos.length < alvo.length) return false;
    return alvo.every((s, i) => segmentos[i] === s);
  });
}

/**
 * Este caminho continua respondendo para uma empresa suspensa?
 *
 * Recebe o CAMINHO, não o prefixo: `/api/tenants/modulos`, `/api/leads?x=1`,
 * `tenants/plataforma/resumo`. Liberado é liberado nas DUAS grafias (crua e
 * decodificada) — basta uma delas não casar para o caminho ser gateado, que é o
 * que impede `/api/%61ssinatura` de decidir por um lado e o roteador pelo outro.
 */
export function liberadoNaSuspensao(caminho: string | null | undefined): boolean {
  if (!caminho) return true; // `/api` cru: não é rota de nada; quem responde é o roteador.
  const seg = segmentosDaApi(caminho);
  if (seg.cru.length === 0) return true;
  return casaAlgum(seg.cru) && casaAlgum(seg.decodificado);
}

/*
 * ============================================================================
 * O TETO DA CONFERÊNCIA — RF-O-03
 * ============================================================================
 *
 * Conferir dispara uma chamada externa POR PÁGINA, com a credencial de cobrança
 * saindo do cofre em cada uma. Sem teto, um clique repetido (ou um `while (true)`
 * de quem descobriu a rota) vira martelo no provedor com a chave do cliente, e
 * ainda gasta o empréstimo do cofre em série. O teto é por EMPRESA e por JANELA,
 * e é de memória do processo de propósito: ele protege o provedor e o cofre, não
 * é contabilidade — e uma tabela nova para contar cliques seria escrita de banco
 * no caminho quente de uma rota que já escreve o que importa.
 *
 * Doze por hora é largo para gente (quem pagou clica duas, três vezes) e estreito
 * para laço.
 */
export const TETO_DE_CONFERENCIAS = 12;
export const JANELA_DO_TETO_MS = 3_600_000;

/** Os carimbos que ainda contam para o teto, dado `agora`. Puro. */
export function carimbosNaJanela(
  carimbos: readonly number[],
  agora: number,
  janelaMs: number = JANELA_DO_TETO_MS,
): number[] {
  const limite = agora - janelaMs;
  return carimbos.filter((c) => c > limite);
}

/**
 * Cabe mais uma conferência? Devolve os carimbos ATUALIZADOS quando cabe.
 *
 * Devolve, em vez de mutar, para que a decisão continue exercitável sem relógio
 * e sem estado global — o mesmo motivo de `decidirTransicao` devolver a transição
 * em vez de aplicá-la.
 */
export function cabeConferencia(
  carimbos: readonly number[],
  agora: number,
  teto: number = TETO_DE_CONFERENCIAS,
  janelaMs: number = JANELA_DO_TETO_MS,
): { cabe: boolean; carimbos: number[]; liberaEm: Date | null } {
  const vivos = carimbosNaJanela(carimbos, agora, janelaMs);
  if (vivos.length < teto) return { cabe: true, carimbos: [...vivos, agora], liberaEm: null };
  const maisAntigo = Math.min(...vivos);
  return { cabe: false, carimbos: vivos, liberaEm: new Date(maisAntigo + janelaMs) };
}

/** O código que a API devolve, e que a tela reconhece sem ler frase em português. */
export const CODIGO_ASSINATURA_SUSPENSA = 'assinatura_suspensa';
