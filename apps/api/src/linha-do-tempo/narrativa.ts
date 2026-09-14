/* ========================================================================== *
 * A LINHA DO TEMPO — fatia A9 do controle de agentes
 * ========================================================================== *
 *
 * O QUE ESTE ARQUIVO É
 * --------------------
 * O núcleo PURO da leitura narrativa do RASTRO: dicionário de tipos de evento,
 * famílias, a lista do que pode sair de um payload e o codificador de cursor.
 * Nada aqui sabe de Nest, de HTTP ou de banco — é o que permite interrogar a
 * decisão caso a caso sem subir aplicação nenhuma (a mesma escolha de
 * `tenants/modulos.ts` e de `agents/estado-do-agente.ts`).
 *
 * POR QUE ESTA TELA EXISTE SE JÁ EXISTE `/rastro`
 * -----------------------------------------------
 * Não é fonte nova: as duas leem o MESMO fato. O que muda é a pergunta.
 *
 *   `/rastro`          é PROVA   — evento cru, cadeia de hash, verificação.
 *   `/linha-do-tempo`  é HISTÓRIA — o que aconteceu nesta empresa, em ordem,
 *                                   com o ator e o objeto legíveis, agrupado
 *                                   por dia e filtrável por agente e por tipo.
 *
 * Não há tabela nova e não há segundo caminho de escrita. Quem escreve linha no
 * RASTRO continua sendo `EventLogService.registrar`, e mais nada. Um segundo
 * escritor seria uma segunda verdade sobre o mesmo fato — exatamente o defeito
 * que o ADR-011 evita na memória.
 *
 * O QUE NÃO SAI POR AQUI, E É DECISÃO E NÃO ESQUECIMENTO
 * ------------------------------------------------------
 * CONTEÚDO. O payload de um evento carrega os campos que a política nomeia
 * (`argumentos`, `resumo`, `resultado`, `motivo`, `estadoAnterior`…), e eles são
 * conteúdo de negócio: o corpo da mensagem que ia sair no WhatsApp, o motivo
 * escrito por uma pessoa, o número de telefone de quem mandou uma decisão por
 * canal. A linha do tempo devolve IDENTIFICADOR, nunca conteúdo — e a régua é
 * uma LISTA DE PERMISSÃO (`IDENTIFICADORES_DO_OBJETO`), não uma lista de
 * proibição: chave de payload que ninguém declarou aqui simplesmente não sai.
 *
 * Lista de proibição seria o defeito de sempre: `payload` é `Json` livre, e a
 * próxima chamada a `registrar` inventa uma chave que a lista de proibição não
 * conhece — e o vazamento nasce calado, do lado de dentro de uma rota de
 * leitura. Com lista de permissão, o pior caso é uma coluna a menos na tela.
 *
 * Quem precisa do conteúdo exato de uma ação retida tem `/atendimento`, que
 * pede permissão própria (`aprovacoes.ver`) e existe para isso. E cada item da
 * linha diz `temConteudo` quando o evento carrega campos que esta rota não
 * devolve: tela não mente, inclusive sobre o que ela não mostra.
 *
 * O EVENTO QUE NÃO SEI NOMEAR APARECE COM O TIPO CRU
 * --------------------------------------------------
 * `nomear` devolve `conhecido: false` e o próprio tipo como rótulo. Esconder o
 * evento desconhecido seria mentir sobre o que aconteceu — e a tela que some
 * com o que não entende é pior do que a tela que admite não entender, porque a
 * primeira parece completa. "Não sei ler este evento" é informação.
 *
 * O dicionário, portanto, é CONVENIÊNCIA e não contrato: tipo novo em qualquer
 * chamada a `registrar` continua aparecendo na linha no minuto seguinte, sem
 * ninguém precisar editar este arquivo. O que se ganha editando é o rótulo em
 * português e a família para filtrar.
 */

/** As famílias em que a tela agrupa os eventos. Vocabulário FECHADO. */
export const FAMILIAS = {
  agente: { rotulo: 'Agentes', descricao: 'quem trabalha: estado declarado, invocação, recusa de passagem' },
  ferramenta: { rotulo: 'Ferramentas', descricao: 'o que a porta classificou, executou, reteve ou recusou' },
  aprovacao: { rotulo: 'Aprovações', descricao: 'o que precisou de gente, e o que saiu depois da assinatura' },
  memoria: { rotulo: 'Memória', descricao: 'o que o sistema passou a saber sobre a empresa' },
  tarefa: { rotulo: 'Tarefas', descricao: 'quem ficou com o trabalho na mão' },
  conexao: { rotulo: 'Conexões', descricao: 'conector ligado, desligado ou recusando' },
  segredo: { rotulo: 'Segredos', descricao: 'o cofre desta empresa: credencial guardada, revogada, chave rotacionada' },
  custo: { rotulo: 'Custo de IA', descricao: 'teto, orçamento e o que foi recusado por dinheiro' },
  conta: { rotulo: 'A conta', descricao: 'entrada no produto, provisionamento e assinatura' },
  plataforma: { rotulo: 'Plataforma', descricao: 'o acesso de suporte que esta empresa autorizou ou revogou' },
  pauta: { rotulo: 'Pauta', descricao: 'as rodadas de conteúdo' },
  rastro: { rotulo: 'O próprio rastro', descricao: 'retenção e expurgo — o registro falando de si' },
  outro: { rotulo: 'Sem família', descricao: 'evento que esta tela ainda não sabe classificar' },
} as const;

export type FamiliaDeEvento = keyof typeof FAMILIAS;

export const CHAVES_DE_FAMILIA = Object.keys(FAMILIAS) as FamiliaDeEvento[];

/**
 * Tipo de evento -> como a tela o chama.
 *
 * Levantado do código em 14/09/2026 varrendo as chamadas a
 * `EventLogService.registrar`. Está deliberadamente INCOMPLETO como contrato:
 * ver o cabeçalho. O que ele não conhece aparece cru.
 *
 * O rótulo é uma FRASE DE FATO no passado ("Ferramenta recusada"), nunca um
 * nome de função nem o tipo traduzido palavra por palavra: quem lê esta tela
 * quer saber o que aconteceu, não como o código chama o que aconteceu.
 */
export const NARRATIVA: Readonly<Record<string, { familia: FamiliaDeEvento; rotulo: string }>> = {
  // ── a porta (gateway) ───────────────────────────────────────────────────
  'tool.proposta': { familia: 'ferramenta', rotulo: 'Ferramenta proposta' },
  'tool.resultado': { familia: 'ferramenta', rotulo: 'Ferramenta executada' },
  'tool.recusado': { familia: 'ferramenta', rotulo: 'Ferramenta recusada pela régua' },
  'tool.erro': { familia: 'ferramenta', rotulo: 'Ferramenta falhou na execução' },
  'conector.recusado': { familia: 'conexao', rotulo: 'Ferramenta barrada: conector desligado' },

  // ── a fila de aprovação ─────────────────────────────────────────────────
  'acao.executada': { familia: 'aprovacao', rotulo: 'Ação aprovada executada' },
  'acao.falhou': { familia: 'aprovacao', rotulo: 'Ação aprovada falhou ao executar' },
  'aprovacao.invalida': { familia: 'aprovacao', rotulo: 'Aprovação rejeitada: vínculo quebrado' },
  'canal.decisao.ignorada': { familia: 'aprovacao', rotulo: 'Decisão por canal ignorada' },

  // ── os agentes ──────────────────────────────────────────────────────────
  'agente.invocado': { familia: 'agente', rotulo: 'Agente invocado à mão' },
  'agente.pausado': { familia: 'agente', rotulo: 'Agente pausado' },
  'agente.retomado': { familia: 'agente', rotulo: 'Agente retomado' },
  'agente.encerrado': { familia: 'agente', rotulo: 'Agente encerrado' },
  'agente.replanejado': { familia: 'agente', rotulo: 'Agente devolvido a planejado' },
  'agente.passagem_recusada': { familia: 'agente', rotulo: 'Passagem do agente recusada' },
  'agente.orcamento_definido': { familia: 'custo', rotulo: 'Orçamento mensal do agente definido' },

  // ── o dinheiro da IA ────────────────────────────────────────────────────
  'ia.recusada_por_teto': { familia: 'custo', rotulo: 'Chamada de IA recusada: teto da empresa no dia' },
  'ia.recusada_por_orcamento': { familia: 'custo', rotulo: 'Chamada de IA recusada: orçamento do agente' },
  'ia.reserva_liberada': { familia: 'custo', rotulo: 'Reserva de custo devolvida' },

  // ── a memória ───────────────────────────────────────────────────────────
  'memoria.item.criado': { familia: 'memoria', rotulo: 'Nota de contexto criada' },
  'memoria.item.alterado': { familia: 'memoria', rotulo: 'Nota de contexto alterada' },
  'memoria.item.arquivado': { familia: 'memoria', rotulo: 'Nota de contexto arquivada' },
  'memoria.item.restaurado': { familia: 'memoria', rotulo: 'Nota de contexto restaurada' },

  // ── as tarefas (fatia A4) ───────────────────────────────────────────────
  'tarefa.assumida': { familia: 'tarefa', rotulo: 'Tarefa assumida por um agente' },
  'tarefa.soltada': { familia: 'tarefa', rotulo: 'Tarefa devolvida à fila' },
  'tarefa.checkout_recusado': { familia: 'tarefa', rotulo: 'Tarefa já estava com outro agente' },

  // ── as conexões e o cofre ───────────────────────────────────────────────
  'conector.desligado': { familia: 'conexao', rotulo: 'Conector desligado para a empresa' },
  'conector.religado': { familia: 'conexao', rotulo: 'Conector religado' },
  'cofre.segredo.guardado': { familia: 'segredo', rotulo: 'Credencial guardada no cofre' },
  'cofre.segredo.revogado': { familia: 'segredo', rotulo: 'Credencial revogada' },
  'cofre.chave.rotacionada': { familia: 'segredo', rotulo: 'Chave do cofre rotacionada' },

  // ── a conta ─────────────────────────────────────────────────────────────
  'onboarding.empresa.aberta': { familia: 'conta', rotulo: 'Empresa aberta no produto' },
  'onboarding.contexto.carregado': { familia: 'conta', rotulo: 'Contexto inicial carregado' },
  'tenant.provisionamento.iniciado': { familia: 'conta', rotulo: 'Provisionamento iniciado' },
  'tenant.provisionado': { familia: 'conta', rotulo: 'Empresa provisionada' },
  'assinatura.definida': { familia: 'conta', rotulo: 'Assinatura definida' },
  'assinatura.ativa': { familia: 'conta', rotulo: 'Assinatura reativada' },
  'assinatura.inadimplente': { familia: 'conta', rotulo: 'Assinatura em atraso' },
  'assinatura.suspensa': { familia: 'conta', rotulo: 'Assinatura suspensa' },
  'assinatura.cancelada': { familia: 'conta', rotulo: 'Assinatura cancelada' },

  // ── o acesso de suporte (RF-B-02) ───────────────────────────────────────
  'plataforma.suporte.autorizado': { familia: 'plataforma', rotulo: 'Acesso de suporte autorizado pela empresa' },
  'plataforma.suporte.revogado': { familia: 'plataforma', rotulo: 'Acesso de suporte revogado' },
  'plataforma.suporte.usado': { familia: 'plataforma', rotulo: 'Acesso de suporte usado' },
  'plataforma.suporte.negado': { familia: 'plataforma', rotulo: 'Acesso de suporte negado' },
  'plataforma.suporte.teto': { familia: 'plataforma', rotulo: 'Tentativas de suporte no teto de recusa' },

  // ── conteúdo ────────────────────────────────────────────────────────────
  'pauta.rodada': { familia: 'pauta', rotulo: 'Rodada de pauta' },

  // ── o registro falando de si ────────────────────────────────────────────
  'rastro.retencao.definida': { familia: 'rastro', rotulo: 'Prazo de retenção do rastro definido' },
  'rastro.retencao.herdada': { familia: 'rastro', rotulo: 'Prazo de retenção volta a ser o da política' },
  'rastro.expurgo': { familia: 'rastro', rotulo: 'Rastro vencido expurgado' },
};

/**
 * O prefixo do tipo -> a família em que ele cai quando o tipo exato é
 * desconhecido. É como `pauta.ficha_gerada`, que ninguém declarou, ainda
 * aparece dentro do filtro "Pauta" em vez de cair em "Sem família".
 *
 * DERIVADO do dicionário, nunca redigitado: um prefixo cuja família fosse
 * declarada duas vezes divergiria na primeira edição, e a lista do menu passaria
 * a discordar da lista do filtro. Prefixo com mais de uma família no dicionário
 * fica de FORA do mapa — ambiguidade não se resolve escolhendo em silêncio, e o
 * evento cai em `outro`, que é a resposta honesta.
 */
export const FAMILIA_POR_PREFIXO: Readonly<Record<string, FamiliaDeEvento>> = (() => {
  const vistas = new Map<string, Set<FamiliaDeEvento>>();
  for (const [tipo, { familia }] of Object.entries(NARRATIVA)) {
    const prefixo = tipo.split('.')[0];
    if (!vistas.has(prefixo)) vistas.set(prefixo, new Set());
    vistas.get(prefixo)!.add(familia);
  }
  const mapa: Record<string, FamiliaDeEvento> = {};
  for (const [prefixo, familias] of vistas) {
    if (familias.size === 1) mapa[prefixo] = [...familias][0];
  }
  return mapa;
})();

export interface EventoNomeado {
  /** O que a pessoa lê. Igual ao tipo cru quando `conhecido` é falso. */
  rotulo: string;
  familia: FamiliaDeEvento;
  /** Falso = "não sei ler este evento". A tela DIZ isso, não esconde a linha. */
  conhecido: boolean;
}

/** Como a tela chama este evento. Nunca lança, nunca devolve rótulo vazio. */
export function nomear(tipo: string): EventoNomeado {
  const conhecido = NARRATIVA[tipo];
  if (conhecido) return { rotulo: conhecido.rotulo, familia: conhecido.familia, conhecido: true };
  const porPrefixo = FAMILIA_POR_PREFIXO[tipo.split('.')[0]];
  return { rotulo: tipo, familia: porPrefixo ?? 'outro', conhecido: false };
}

/* ========================================================================== *
 * O QUE PODE SAIR DE UM PAYLOAD
 * ========================================================================== */

/**
 * As chaves de payload que a linha do tempo devolve, e o nome de cada uma na
 * tela. LISTA DE PERMISSÃO — ver o cabeçalho para o porquê.
 *
 * Todas são IDENTIFICADOR ou RÓTULO ESTÁVEL: o slug de um agente, o id de uma
 * tarefa, a chave de uma capacidade, a causa de uma recusa. Nenhuma é texto que
 * uma pessoa escreveu nem conteúdo que ia sair para fora da casa.
 *
 * O QUE FICOU DE FORA DE PROPÓSITO, e cada caso tem nome:
 *  - `motivo` — é texto livre de gente (`motivoDoDesligamento`, o motivo de uma
 *    suspensão). Conteúdo.
 *  - `remetente` — é número de telefone de quem mandou decisão por canal.
 *  - `erro`, `sinais`, `argumentos`, `resumo`, `resultado`, `estadoAnterior`,
 *    `estadoNovo`, `preparo` — conteúdo do evento, ou objeto aninhado.
 *  - qualquer valor em dólar (`gastoUsd`, `estimativaUsd`) — número de dinheiro
 *    da empresa é leitura da tela de Custos, que tem permissão própria; e um
 *    número solto aqui, sem a conta em volta, é o tipo de dado que a tela de
 *    Agentes já publicou errado uma vez.
 */
export const IDENTIFICADORES_DO_OBJETO: Readonly<Record<string, string>> = {
  capacidade: 'capacidade',
  conector: 'conector',
  rotulo: 'conector',
  agente: 'agente',
  slug: 'agente',
  taskId: 'tarefa',
  itemId: 'nota',
  versao: 'versão',
  modelo: 'modelo',
  gatilho: 'gatilho',
  causa: 'causa',
  estado: 'estado',
  de: 'de',
  para: 'para',
};

/*
 * `canal` NÃO ESTÁ NA LISTA ACIMA, e a ausência é uma invariante e não um
 * esquecimento: `canal` é palavra da POLÍTICA (`niveis.R3.rastro`) e portanto
 * chave de conteúdo. Os dois conjuntos são DISJUNTOS — nenhuma chave de conteúdo
 * sai por esta rota, nem quando o valor dela parece inofensivo ('whatsapp').
 *
 * A regra vale a perda: se um dia bastar uma exceção "porque este valor é só um
 * enum", a próxima exceção vem por analogia, e a lista de permissão deixa de
 * poder ser lida como garantia. Quem cobra a disjunção é um caso de teste.
 */


/**
 * As chaves que a política nomeia (`ConteudoDoEvento`) e que, por serem
 * espalhadas no primeiro nível do payload por `EventLogService.montar`, viram
 * chave de payload. Nenhuma sai por aqui; a presença de qualquer uma é o que
 * acende `temConteudo`.
 *
 * REDIGITADA, e o motivo é o acoplamento ao contrário: `ConteudoDoEvento` é uma
 * `interface`, que não existe em tempo de execução — não há como derivar a lista
 * dela. Quem amarra as duas é um caso de teste que lê o arquivo-fonte do
 * `event-log.service.ts` e compara campo por campo, então campo novo lá reprova
 * a suíte aqui até alguém decidir de que lado ele está.
 */
export const CHAVES_DE_CONTEUDO: readonly string[] = [
  'pergunta',
  'argumentos',
  'fontes',
  'custo',
  'artefato',
  'versaoPrompt',
  'resultado',
  'desfazer',
  'resumo',
  'aprovador',
  'aprovadoEm',
  'canal',
  'entrega',
  'motivo',
  'estadoAnterior',
  'estadoNovo',
  'preparo',
  'encaminhadoPara',
  'encaminhadoEm',
  'desfechoInformado',
  // `referencia` é ONDE o conteúdo cru mora quando ele virou resumo
  // criptográfico. Não é o conteúdo, mas é o ponteiro para ele — e ponteiro para
  // conteúdo confidencial numa tela de lista é meio caminho andado.
  'referencia',
] as const;

/** O teto de caracteres de um identificador na tela. Id de tarefa cabe folgado. */
export const TETO_DO_IDENTIFICADOR = 120;

export interface CampoDoObjeto {
  chave: string;
  valor: string;
}

/**
 * O objeto do evento, em pares legíveis, só com o que a lista de permissão
 * autoriza.
 *
 * Três cortes, e cada um fecha uma porta:
 *  1. chave fora da lista não sai;
 *  2. valor que não é primitivo não sai — mata o objeto aninhado que um dia
 *     entra sob uma chave permitida (`estado: { corpo: '…' }`);
 *  3. string é normalizada (sem quebra de linha) e cortada no teto — quebra de
 *     linha em tela de lista é como cabeçalho disfarçado entra em texto que
 *     alguém lê, e `montarSop` já pagou essa lição.
 */
export function objetoDoEvento(payload: unknown): CampoDoObjeto[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return [];
  const campos: CampoDoObjeto[] = [];
  const vistos = new Set<string>();
  for (const [chave, rotulo] of Object.entries(IDENTIFICADORES_DO_OBJETO)) {
    if (!(chave in (payload as Record<string, unknown>))) continue;
    const cru = (payload as Record<string, unknown>)[chave];
    if (cru === null || cru === undefined) continue;
    if (typeof cru === 'object') continue;
    const valor = String(cru).replace(/\s+/g, ' ').trim().slice(0, TETO_DO_IDENTIFICADOR);
    if (!valor) continue;
    // Duas chaves podem apontar para o mesmo rótulo (`conector`/`rotulo`,
    // `agente`/`slug`). A primeira declarada vence — repetir "conector" duas
    // vezes na mesma linha não informa nada.
    if (vistos.has(rotulo)) continue;
    vistos.add(rotulo);
    campos.push({ chave: rotulo, valor });
  }
  return campos;
}

/** O evento carrega conteúdo que esta rota não devolve? */
export function temConteudo(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  return CHAVES_DE_CONTEUDO.some((c) => (payload as Record<string, unknown>)[c] !== undefined);
}

/**
 * O que a conferência por nível gravou sobre esta linha — `payload.rastro`.
 *
 * É metadado do REGISTRO, não conteúdo do fato: qual nível, se a linha saiu
 * completa e com que sensibilidade a capacidade foi classificada. Vale mostrar
 * porque é o que responde "esta linha é confiável?" sem abrir o rastro inteiro,
 * e porque `payload.rastro.faltando` era um campo que ninguém lia.
 */
export function selo(payload: unknown): {
  sensibilidade: string | null;
  registroCompleto: boolean | null;
} {
  const rastro =
    typeof payload === 'object' && payload !== null
      ? ((payload as Record<string, unknown>).rastro as Record<string, unknown> | undefined)
      : undefined;
  if (!rastro || typeof rastro !== 'object') return { sensibilidade: null, registroCompleto: null };
  const sens = rastro.sensibilidade;
  const completo = rastro.completo;
  return {
    sensibilidade: typeof sens === 'string' ? sens : null,
    registroCompleto: typeof completo === 'boolean' ? completo : null,
  };
}

/* ========================================================================== *
 * O CURSOR — paginação por chave, nunca por deslocamento
 * ========================================================================== */

/**
 * CURSOR E NÃO `skip`, e a razão é a natureza do que se lê.
 *
 * O RASTRO só cresce pela frente e pode ENCURTAR por trás (o expurgo por
 * retenção apaga faixas inteiras de `seq`). Com deslocamento, uma linha nova
 * gravada entre duas páginas empurra tudo e a pessoa lê o mesmo evento duas
 * vezes; um expurgo no meio da leitura faz ela pular eventos. Com cursor por
 * `seq`, cada página continua exatamente de onde a anterior parou, e o buraco
 * do expurgo é só um salto na numeração — que é a verdade.
 *
 * `seq` e não `ocorreuEm`: `@@unique([orgId, seq])` garante que não há empate,
 * e empate em coluna de ordenação é a outra forma de repetir ou perder linha.
 * A ordem por `seq` desc é a ordem de gravação, serializada por advisory lock
 * dentro da empresa — a mesma ordem da cadeia de hash.
 *
 * OPACO de propósito: `base64url` do número. Cursor legível convida a aritmética
 * do lado do chamador ("somo 50 e peço a próxima"), que é justamente o
 * deslocamento voltando pela janela.
 */
export function codificarCursor(seq: bigint): string {
  return Buffer.from(seq.toString(), 'utf8').toString('base64url');
}

export class CursorInvalidoError extends Error {
  constructor(readonly cursor: string) {
    super('cursor inválido — use o `proximoCursor` que a resposta anterior devolveu.');
    this.name = 'CursorInvalidoError';
  }
}

/** Decodifica, ou LANÇA. Cursor torto é erro do chamador, não página vazia. */
export function decodificarCursor(cursor: string): bigint {
  let texto: string;
  try {
    texto = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new CursorInvalidoError(cursor);
  }
  if (!/^[1-9][0-9]{0,18}$/.test(texto)) throw new CursorInvalidoError(cursor);
  return BigInt(texto);
}

/* ========================================================================== *
 * OS LIMITES DA PÁGINA E DOS FILTROS
 * ========================================================================== */

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 200;

/** Quantos eventos a contagem de filtros varre. Ver o serviço para o porquê. */
export const JANELA_DOS_FILTROS = 5000;

export function limiteDaPagina(cru: unknown): number {
  const n = typeof cru === 'string' ? Number(cru) : typeof cru === 'number' ? cru : NaN;
  if (!Number.isFinite(n)) return LIMITE_PADRAO;
  return Math.min(Math.max(Math.trunc(n), 1), LIMITE_MAXIMO);
}

/**
 * Filtro de texto vindo da query, conferido contra o formato de um tipo de
 * evento ou de um slug de agente.
 *
 * RECUSA em vez de higienizar: `tipo` e `agente` entram numa comparação exata no
 * banco, então o valor torto não é risco de injeção (o Prisma parametriza) — é
 * risco de a pessoa receber lista vazia achando que não aconteceu nada. Recusar
 * diz a verdade: o que você pediu não é um tipo nem um agente.
 */
export function chaveDeFiltro(cru: unknown): string | undefined {
  if (typeof cru !== 'string') return undefined;
  const t = cru.trim();
  if (!t) return undefined;
  if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(t)) throw new FiltroInvalidoError(t);
  return t;
}

export class FiltroInvalidoError extends Error {
  constructor(readonly valor: string) {
    super(
      `"${valor}" não é um tipo de evento nem um slug de agente. ` +
        'Use um dos valores que a própria resposta devolve em `filtros`.',
    );
    this.name = 'FiltroInvalidoError';
  }
}

export function familiaDeFiltro(cru: unknown): FamiliaDeEvento | undefined {
  if (typeof cru !== 'string') return undefined;
  const t = cru.trim();
  if (!t) return undefined;
  if (!(CHAVES_DE_FAMILIA as string[]).includes(t)) throw new FiltroInvalidoError(t);
  return t as FamiliaDeEvento;
}

/**
 * Os tipos de evento que compõem uma família — para traduzir o filtro por
 * família numa cláusula `tipo IN (…)`.
 *
 * `outro` NÃO é traduzível: ela é definida por exclusão ("tipo que o dicionário
 * não conhece e cujo prefixo não resolve"), e a lista de tipos que um dia vão
 * cair nela não existe em lugar nenhum. Devolve `null`, e o serviço trata isso
 * como "traga tudo e filtre depois de nomear" — a única leitura honesta.
 */
export function tiposDaFamilia(familia: FamiliaDeEvento): string[] | null {
  if (familia === 'outro') return null;
  return Object.entries(NARRATIVA)
    .filter(([, v]) => v.familia === familia)
    .map(([t]) => t);
}

/**
 * Os prefixos que caem nesta família. É a segunda metade do filtro, e sem ela
 * ele MENTE: `pauta.ficha_gerada` não está no dicionário, `nomear` o põe na
 * família `pauta` pelo prefixo, e um filtro só por `tipo IN (…)` o esconderia
 * justamente de quem pediu "me mostre a Pauta".
 */
export function prefixosDaFamilia(familia: FamiliaDeEvento): string[] {
  if (familia === 'outro') return [];
  return Object.entries(FAMILIA_POR_PREFIXO)
    .filter(([, f]) => f === familia)
    .map(([p]) => p);
}
