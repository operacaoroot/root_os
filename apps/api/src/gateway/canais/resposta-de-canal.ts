import { createHmac, timingSafeEqual } from 'node:crypto';

import { chaveDeIdentidadeWhatsapp, ehGrupoDeWhatsapp } from './identidade-de-canal';

/*
 * ============================================================================
 * A QUARTA PORTA DE ENTRADA DE CONTEÚDO EXTERNO — e a única que DECIDE
 * ============================================================================
 *
 * A onda 8 ligou três camadas de defesa (cerca, neutralização e marca de
 * procedência) nas três portas por onde conteúdo de fora alimenta o MODELO: o
 * contexto do agente, o resultado de ferramenta que volta para ele, e o pedido
 * quando vem de canal de terceiro (`agents/context-builder.service.ts`,
 * `agents/agent-runtime.service.ts`).
 *
 * Esta é a quarta porta, e ela é de outra natureza — pior. O que entra por aqui
 * NÃO alimenta o modelo: **decide**. Uma mensagem de WhatsApp que atravesse esta
 * função vira confirmação de uma ação de R3 e sai da casa.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ESTA PORTA NÃO USA CERCA NEM NEUTRALIZAÇÃO — a decisão, por escrito
 * ----------------------------------------------------------------------------
 * As três camadas existem para o caso "o modelo vai LER isto". Cerca diz ao
 * modelo que aquilo é dado; neutralização desarma carregador de instrução
 * escondida; a marca de procedência sobe o nível da ação derivada. Nenhuma delas
 * se aplica aqui, porque **nada do que entra por esta porta chega a modelo
 * nenhum**: não há prompt, não há chamada de LLM, não há contexto montado. Há um
 * casamento literal contra uma expressão regular fechada.
 *
 * Cercar aqui seria pior do que inútil: acrescentaria uma chamada a
 * `blocoExterno` no inventário que `test/adversarial.test.ts` congela — um
 * inventário cujo propósito é justamente que ninguém cerque o que NÃO deve ser
 * cercado. A catraca continua com as duas entradas de sempre, de propósito.
 *
 * A defesa desta porta é outra, e é mais dura: **o formato aceito é uma linha
 * inteira, exata, e nada mais**. Não há interpretação, não há "entendi que você
 * quis dizer sim", não há intenção inferida. O que não casa por completo é
 * IGNORADO. Conteúdo que chega de fora continua sendo dado; aqui ele nem chega a
 * ser dado — ele é comparado com uma constante.
 *
 * ----------------------------------------------------------------------------
 * OS ATAQUES, UM POR UM, E ONDE CADA UM MORRE
 * ----------------------------------------------------------------------------
 *  1. ALGUÉM NO GRUPO ESCREVENDO O QUE PARECE UMA CONFIRMAÇÃO.
 *     Morre em `ehGrupoDeWhatsapp`: mensagem de grupo NUNCA é decisão. O canal
 *     de decisão é a conversa DIRETA com a pessoa cadastrada — e é para lá, e só
 *     para lá, que o pedido é enviado. O grupo de estratégia da ROOT continua
 *     sendo o que sempre foi: um lugar onde se conversa.
 *
 *  2. ALGUÉM CITANDO UMA MENSAGEM ANTIGA.
 *     O texto citado (`contextInfo.quotedMessage`) NUNCA é lido. Só o que a
 *     pessoa DIGITOU conta. Citar o pedido original é o gesto natural de quem
 *     responde no WhatsApp, então a citação é permitida — ela só não vale como
 *     conteúdo. O código tem de estar no texto digitado.
 *
 *  3. ALGUÉM ENCAMINHANDO A MENSAGEM ORIGINAL DE VOLTA.
 *     Morre em `isForwarded`/`forwardingScore`: mensagem encaminhada é
 *     descartada inteira, mesmo que o texto encaminhado case com o formato. É o
 *     caso em que o texto é literalmente o nosso, e é justamente por isso que
 *     ele não pode valer — quem encaminha não escreveu nada.
 *
 *  4. ALGUÉM COM NÚMERO PARECIDO.
 *     Morre em `identidade-de-canal.ts` e na consulta por igualdade. Aqui só se
 *     extrai o endereço; quem decide se ele é alguém é o banco.
 *
 *  5. BOTÃO, LISTA, ENQUETE, MODELO, LEGENDA DE IMAGEM, MENSAGEM EDITADA.
 *     Morrem em `textoDigitado`: só `conversation` e `extendedTextMessage.text`
 *     contam. Resposta de botão é uma estrutura que o remetente controla inteira
 *     e que NINGUÉM digitou; mensagem editada é texto que mudou depois de
 *     enviado, e "depois de enviado" é exatamente o que não pode valer numa
 *     decisão. Legenda de imagem fica de fora pelo mesmo motivo de sempre:
 *     superfície a mais sem ganho nenhum.
 *
 *     A EDIÇÃO GANHOU CONFERÊNCIA PRÓPRIA, e a razão é que a lista branca acima
 *     SUPUNHA uma coisa sobre o provedor: que uma edição chega embrulhada em
 *     `editedMessage`, com o texto lá dentro. Se a Evolution normalizar a edição
 *     para o formato de sempre — o mesmo `conversation`, com o texto novo —, a
 *     lista branca deixa passar e a suposição vira buraco. Agora são três
 *     travas independentes: (a) o EVENTO tem de ser `messages.upsert` (edição
 *     chega em `messages.update`); (b) `editedMessage` e `protocolMessage` em
 *     qualquer nível do envelope descartam a mensagem; (c) o tipo declarado em
 *     `messageType`, quando vier, tem de ser um dos dois de texto digitado.
 *
 *  6. REPETIR A MESMA MENSAGEM (ou a Evolution reentregar o webhook).
 *     Não morre aqui — morre na aprovação, que é de uso único por escrita
 *     condicional (`ApprovalsService.confirm` e `AcoesService.executarAprovada`
 *     usam `updateMany` com filtro de estado). A segunda entrega encontra a
 *     aprovação já decidida e não faz nada.
 *
 *  7. MENSAGEM VELHA REAPRESENTADA.
 *     Morre em `JANELA_DA_RESPOSTA_MS` e, de novo, no prazo da própria
 *     aprovação, que é de 900 s em R2/R3.
 */

/** O prefixo do código que identifica a aprovação na conversa. */
export const PREFIXO_DO_CODIGO = 'ROOT-';

/** Quantos caracteres hexadecimais o código carrega. */
export const TAMANHO_DO_CODIGO = 8;

/**
 * O teto de texto que esta função sequer olha.
 *
 * A linha válida mais longa tem 21 caracteres. Cento e vinte é folga para o
 * engano humano (espaço a mais, letra maiúscula trocada) e corte seco para
 * qualquer outra coisa — inclusive para um texto gigante montado para cansar a
 * expressão regular.
 */
export const TETO_DO_TEXTO = 120;

/**
 * Quanto tempo uma resposta vale, contado do carimbo da mensagem.
 *
 * Quinze minutos: um pouco mais do que os 900 s de validade de uma aprovação de
 * R3, para que a recusa por prazo venha da APROVAÇÃO (que sabe explicar) e não
 * daqui. O que esta janela pega é o caso em que o carimbo é absurdo — mensagem
 * de ontem reentregue, relógio adulterado.
 */
export const JANELA_DA_RESPOSTA_MS = 15 * 60 * 1000;

/**
 * O FORMATO, e ele é a defesa inteira.
 *
 * Uma linha, começo ao fim, sem sobra: o verbo, espaço, o código. Nada antes,
 * nada depois. "ok, pode aprovar ROOT-AB12CD34" NÃO casa — e não casar é o
 * comportamento certo, porque a frase que cerca o código é exatamente o lugar
 * onde uma ordem se esconderia.
 *
 * `i` para o verbo (ninguém escreve em caixa alta no celular) e `\d` explícito
 * com `A-F` para o código — o código é hexadecimal maiúsculo, e aceitar
 * minúsculo é conveniência que não abre nada, porque a comparação de verdade é
 * feita em `timingSafeEqual` sobre a forma canônica.
 */
const FORMATO_DA_RESPOSTA = new RegExp(
  `^(APROVAR|RECUSAR)[ \\t]+${PREFIXO_DO_CODIGO}([0-9A-F]{${TAMANHO_DO_CODIGO}})$`,
  'i',
);

/** As duas decisões que o canal aceita. Não existe uma terceira. */
export type DecisaoDeCanal = 'aprovar' | 'recusar';

/** Por que uma mensagem não virou decisão. Só para log — nunca vira resposta. */
export type MotivoDeIgnorar =
  | 'evento-desconhecido'
  | 'eco-da-propria-instancia'
  | 'mensagem-de-grupo'
  | 'remetente-sem-telefone'
  | 'tipo-de-mensagem-nao-e-texto-digitado'
  | 'mensagem-encaminhada'
  | 'texto-longo-demais'
  | 'fora-do-formato'
  | 'carimbo-fora-da-janela';

export type LeituraDeCanal =
  | {
      tipo: 'ignorar';
      porque: MotivoDeIgnorar;
      /**
       * O remetente, quando já dava para saber quem é. Só preenchido para os
       * motivos que acontecem DEPOIS de o endereço ter sido reconhecido — serve
       * a uma coisa só: lembrar o formato a quem É identidade cadastrada (ver
       * `pareceTentativaDeDecisao`). Nunca sai daqui para o mundo.
       */
      chaveDaIdentidade?: string;
      /** O texto digitado, quando houve um. Idem: só para o lembrete. */
      texto?: string;
    }
  | {
      tipo: 'decisao';
      decisao: DecisaoDeCanal;
      /** O código, na forma canônica: `ROOT-XXXXXXXX` em maiúsculas. */
      codigo: string;
      /** O endereço do remetente, já reduzido à chave de identidade. */
      chaveDaIdentidade: string;
      /** O id da mensagem na Evolution — entra no registro, não na decisão. */
      mensagemId: string | null;
    };

/**
 * O ÚNICO evento da Evolution que este canal lê.
 *
 * Estava no tipo (`'evento-desconhecido'`) e não estava no código: qualquer
 * corpo com `data.key` e texto decidia, inclusive `messages.update`, que é como
 * uma EDIÇÃO chega. Agora o nome do evento é conferido literalmente.
 */
export const EVENTO_ACEITO = 'messages.upsert';

/** Os dois únicos `messageType` que correspondem a texto digitado. */
const TIPOS_DE_TEXTO_DIGITADO = new Set(['conversation', 'extendedTextMessage']);

/**
 * O CÓDIGO DE UMA APROVAÇÃO — derivado, nunca guardado.
 *
 * `HMAC(segredo, orgId + approvalId + tokenHash)`, truncado. Três propriedades, e
 * as três importam:
 *
 *  · NÃO SE ADIVINHA. Sem o segredo do processo não há como produzir o código de
 *    uma aprovação, mesmo sabendo o id dela. É o que impede alguém cadastrado
 *    (ou alguém que roubou um aparelho cadastrado) de aprovar o que ainda não
 *    viu — quem não recebeu a mensagem não tem o código.
 *  · NÃO PEDE COLUNA NOVA. Não há migração nesta fatia, e não há um segundo
 *    segredo guardado no banco para vazar. `apps/api/prisma/` não é desta fatia,
 *    e mesmo que fosse: coluna a mais é superfície a mais.
 *  · MUDA COM A APROVAÇÃO. `tokenHash` é o sha256 do token de uso único, que é
 *    sorteado por proposta. Duas propostas do mesmo conteúdo têm códigos
 *    diferentes, e um código nunca reaproveita outro.
 *
 * NÃO É O TOKEN DA APROVAÇÃO, e nunca pode virar. O token de `propor()` é o que
 * a superfície antiga aceita como autorização por PORTADOR (`x-approval-token`):
 * mandá-lo por WhatsApp poria numa conversa a chave que dispensa login. O código
 * daqui não autoriza nada sozinho — ele só ENDEREÇA a aprovação. Quem autoriza é
 * a identidade cadastrada, a permissão e a alçada, todas lidas do banco.
 *
 * O `orgId` ENTRA NA DERIVAÇÃO — separação de domínio. O segredo é do PROCESSO e
 * o processo atende várias empresas; com a empresa na entrada, o código de uma
 * nunca é o código da outra, nem por colisão dos 32 bits truncados. Não
 * substitui segredo POR EMPRESA (ver `configuracao-do-canal.ts`), mas custa uma
 * concatenação e tira um caso do caminho.
 */
export function codigoDaAprovacao(
  segredo: string,
  orgId: string,
  approvalId: string,
  tokenHash: string,
): string {
  const bruto = createHmac('sha256', segredo)
    .update(`${orgId}:${approvalId}:${tokenHash}`)
    .digest('hex')
    .slice(0, TAMANHO_DO_CODIGO)
    .toUpperCase();
  return `${PREFIXO_DO_CODIGO}${bruto}`;
}

/**
 * Os dois códigos são o mesmo? Comparação de tempo constante.
 *
 * Exagero? Quase: o código tem 32 bits e o atacante precisaria de muitas
 * tentativas para medir alguma coisa. Mas o custo é zero e o hábito é o que
 * sobrevive — a próxima pessoa que copiar este arquivo para outro canal não vai
 * reintroduzir a comparação preguiçosa.
 */
export function codigosIguais(a: string, b: string): boolean {
  const x = Buffer.from(a.toUpperCase(), 'utf8');
  const y = Buffer.from(b.toUpperCase(), 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** O corpo do webhook, como a Evolution o entrega — tudo opcional, tudo suspeito. */
interface EventoDaEvolution {
  event?: unknown;
  data?: unknown;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * O TEXTO QUE A PESSOA DIGITOU — e nada além dele.
 *
 * Devolve `null` para qualquer outra forma de mensagem. A lista do que fica de
 * fora está no cabeçalho do arquivo (ataque 5); o critério é único e vale para o
 * que ainda não existe: **só conta o que alguém escreveu com o teclado, agora**.
 */
function textoDigitado(message: Record<string, unknown>): string | null {
  const conversation = message.conversation;
  if (typeof conversation === 'string') return conversation;

  const estendida = objeto(message.extendedTextMessage);
  if (estendida && typeof estendida.text === 'string') return estendida.text;

  return null;
}

/** O bloco de contexto da mensagem, onde moram a citação e o encaminhamento. */
function contextInfoDe(message: Record<string, unknown>): Record<string, unknown> | null {
  const estendida = objeto(message.extendedTextMessage);
  return objeto(estendida?.contextInfo) ?? objeto(message.contextInfo);
}

/**
 * A mensagem é uma EDIÇÃO (ou outro evento de protocolo) DISFARÇADA?
 *
 * Não confia na forma do envelope: varre o objeto inteiro procurando as chaves
 * que só existem em mensagem editada (`editedMessage`) e em evento de protocolo
 * (`protocolMessage` — é por onde o WhatsApp manda edição e revogação). Uma
 * edição normalizada pelo provedor para o formato de sempre continua trazendo
 * uma dessas em algum nível do envelope; se um dia não trouxer, a conferência do
 * NOME DO EVENTO (`messages.upsert`) e a do `messageType` continuam de pé.
 *
 * A varredura tem profundidade limitada: envelope de webhook é raso, e um corpo
 * fundo de propósito não pode custar pilha.
 */
function ehEdicaoOuProtocolo(valor: unknown, profundidade = 0): boolean {
  if (profundidade > 6) return false;
  const alvo = objeto(valor);
  if (!alvo) return false;
  for (const [chave, dentro] of Object.entries(alvo)) {
    if (chave === 'editedMessage' || chave === 'protocolMessage') return true;
    if (ehEdicaoOuProtocolo(dentro, profundidade + 1)) return true;
  }
  return false;
}

/**
 * A mensagem foi ENCAMINHADA?
 *
 * Duas perguntas porque a Evolution manda as duas formas dependendo da versão, e
 * qualquer uma delas positiva basta. `forwardingScore` é a contagem de saltos: o
 * WhatsApp a usa para marcar "encaminhada muitas vezes", e qualquer valor acima
 * de zero já quer dizer que quem mandou não escreveu.
 */
function foiEncaminhada(ctx: Record<string, unknown> | null): boolean {
  if (!ctx) return false;
  if (ctx.isForwarded === true) return true;
  const saltos = ctx.forwardingScore;
  return typeof saltos === 'number' && saltos > 0;
}

/**
 * O carimbo da mensagem em milissegundos, ou `null` quando não veio.
 *
 * A Evolution manda segundos (número ou string). Quem não manda carimbo nenhum
 * não é recusado por isso: a janela é uma defesa a mais, e a defesa que de fato
 * vale é o prazo da aprovação.
 */
function carimboEmMs(data: Record<string, unknown>): number | null {
  const bruto = data.messageTimestamp;
  const n = typeof bruto === 'string' ? Number(bruto) : bruto;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return n * 1000;
}

/**
 * Lê o webhook e devolve UMA decisão, ou o motivo de ter ignorado.
 *
 * `agora` é parâmetro para o teste poder medir os dois lados da janela sem mexer
 * no relógio do processo.
 */
export function lerRespostaDeCanal(
  evento: unknown,
  agora: number = Date.now(),
): LeituraDeCanal {
  const raiz = objeto(evento) as EventoDaEvolution | null;

  /*
   * O NOME DO EVENTO, conferido literalmente — era o campo que o tipo previa e
   * o código nunca olhava. `messages.upsert` é mensagem NOVA; `messages.update`
   * (edição, recibo de leitura, revogação) e todo o resto morrem aqui, antes de
   * qualquer leitura de texto.
   */
  if (typeof raiz?.event !== 'string' || raiz.event.trim().toLowerCase() !== EVENTO_ACEITO) {
    return { tipo: 'ignorar', porque: 'evento-desconhecido' };
  }

  const data = objeto(raiz?.data);
  if (!data) return { tipo: 'ignorar', porque: 'evento-desconhecido' };

  const key = objeto(data.key);
  if (!key) return { tipo: 'ignorar', porque: 'evento-desconhecido' };

  // Eco da própria instância: o que NÓS mandamos volta pelo webhook.
  if (key.fromMe === true) return { tipo: 'ignorar', porque: 'eco-da-propria-instancia' };

  const remoteJid = key.remoteJid;
  if (ehGrupoDeWhatsapp(remoteJid)) return { tipo: 'ignorar', porque: 'mensagem-de-grupo' };

  /*
   * `participant` só existe em conversa de GRUPO e em transmissão. Numa conversa
   * direta ele não vem — e se vier, a mensagem não é o que diz ser. Ignorar é a
   * leitura certa de uma forma que não deveria existir aqui.
   */
  if (typeof key.participant === 'string' && key.participant.trim() !== '') {
    return { tipo: 'ignorar', porque: 'mensagem-de-grupo' };
  }

  const chaveDaIdentidade = chaveDeIdentidadeWhatsapp(remoteJid);
  if (!chaveDaIdentidade) return { tipo: 'ignorar', porque: 'remetente-sem-telefone' };

  const message = objeto(data.message);
  if (!message) return { tipo: 'ignorar', porque: 'tipo-de-mensagem-nao-e-texto-digitado' };

  /*
   * MENSAGEM EDITADA, conferida em vez de suposta — ver o ataque 5 no cabeçalho.
   * A varredura olha o `data` inteiro (não só `message`) porque a marca pode vir
   * ao lado do envelope, e não dentro dele.
   */
  if (ehEdicaoOuProtocolo(data)) {
    return { tipo: 'ignorar', porque: 'tipo-de-mensagem-nao-e-texto-digitado' };
  }

  /*
   * O TIPO DECLARADO, quando vier. A Evolution manda `messageType` ao lado do
   * envelope; ele não substitui a lista branca de `textoDigitado` (o remetente
   * não o controla, mas a versão do provedor pode omiti-lo) — ele acrescenta uma
   * recusa para o caso de o envelope ser de um tipo e o texto estar no lugar do
   * outro.
   */
  const tipoDeclarado = data.messageType;
  if (typeof tipoDeclarado === 'string' && !TIPOS_DE_TEXTO_DIGITADO.has(tipoDeclarado)) {
    return { tipo: 'ignorar', porque: 'tipo-de-mensagem-nao-e-texto-digitado' };
  }

  const texto = textoDigitado(message);
  if (texto === null) {
    return { tipo: 'ignorar', porque: 'tipo-de-mensagem-nao-e-texto-digitado' };
  }

  if (foiEncaminhada(contextInfoDe(message))) {
    return { tipo: 'ignorar', porque: 'mensagem-encaminhada' };
  }

  if (texto.length > TETO_DO_TEXTO) {
    return { tipo: 'ignorar', porque: 'texto-longo-demais', chaveDaIdentidade };
  }

  const casou = FORMATO_DA_RESPOSTA.exec(texto.trim());
  if (!casou) return { tipo: 'ignorar', porque: 'fora-do-formato', chaveDaIdentidade, texto };

  const quando = carimboEmMs(data);
  if (quando !== null && Math.abs(agora - quando) > JANELA_DA_RESPOSTA_MS) {
    return { tipo: 'ignorar', porque: 'carimbo-fora-da-janela', chaveDaIdentidade };
  }

  return {
    tipo: 'decisao',
    decisao: casou[1].toUpperCase() === 'APROVAR' ? 'aprovar' : 'recusar',
    codigo: `${PREFIXO_DO_CODIGO}${casou[2].toUpperCase()}`,
    chaveDaIdentidade,
    mensagemId: typeof key.id === 'string' ? key.id : null,
  };
}

/**
 * O texto começa com o verbo mas não casou por inteiro?
 *
 * Serve a UMA coisa só: decidir se vale a pena lembrar o formato a quem JÁ É
 * IDENTIDADE CADASTRADA. Quem não é cadastrado nunca recebe resposta nenhuma —
 * nem esta —, então isto não vira oráculo para ninguém de fora.
 */
export function pareceTentativaDeDecisao(texto: string): boolean {
  if (texto.length > TETO_DO_TEXTO) return false;
  return /^\s*(APROVAR|RECUSAR)\b/i.test(texto);
}
