import { BadRequestException } from '@nestjs/common';
import { CONNECTORS } from '@mktos/shared';

/*
 * O DESLIGAMENTO DE CONECTOR, POR EMPRESA — RF-G-06.
 *
 * Este arquivo é a parte PURA da fatia: o mapa de quem é quem, o que o
 * interruptor de fato faz em cada conector, e o texto da recusa. Nada aqui toca
 * banco, e é de propósito — a suíte precisa interrogar o mapa contra o catálogo
 * inteiro sem subir Nest nem Postgres.
 *
 * TRÊS COISAS QUE O DESLIGAMENTO **NÃO** É, e que decidiram o desenho inteiro:
 *
 *  1. NÃO É APAGAR CREDENCIAL. Desligar o Google não mexe em `GoogleAccount`,
 *     não mexe em `IntegrationAccount.status` e não mexe em `config`. Religar é
 *     apagar uma linha de `ConectorDesligado` — o token continua onde estava e
 *     ninguém refaz OAuth. Se um dia o desligamento passar a revogar token,
 *     religar vira "refaça a autorização", que é outra fatia e outra promessa.
 *
 *  2. NÃO É O BOTÃO "Conectar/Desconectar" QUE JÁ EXISTE. Aquele
 *     (`IntegrationsService.toggle`) diz se a empresa TEM a integração montada,
 *     só funciona em conector de chave/API (`isManaged`) e recusa os de OAuth —
 *     justamente os do Google. Este aqui vale para TODOS, inclusive os de OAuth,
 *     porque a pergunta é outra: "pare de usar isto agora", e não "isto está
 *     configurado?".
 *
 *  3. NÃO É ERRO TÉCNICO. Ferramenta de conector desligado é RECUSA DE
 *     POLÍTICA: motivo legível em português, evento no RASTRO, e nada de 500.
 */

/**
 * Conectores que a tela agrupa sob uma credencial só.
 *
 * `CONNECTORS` lista `gmail`, `gcal`, `gdocs` e `drive` separados porque são
 * quatro superfícies — mas a credencial é UMA (`GoogleAccount`, uma linha por
 * empresa) e quem opera pensa "desligar o Google", não "desligar o gcal". O
 * grupo existe só na ENTRADA: desligar `google` grava as quatro linhas, e a
 * consulta continua sendo uma pergunta simples por chave de conector. Um segundo
 * espaço de nomes dentro da tabela custaria caro em toda leitura.
 */
export const GRUPOS_DE_CONECTOR: Readonly<Record<string, readonly string[]>> = {
  google: ['gmail', 'gcal', 'gdocs', 'drive'],
};

/** Todas as chaves de conector que existem, do catálogo único. */
export const CHAVES_DE_CONECTOR: ReadonlySet<string> = new Set(CONNECTORS.map((c) => c.key));

/*
 * ==========================================================================
 * O QUE O DESLIGAMENTO FAZ HOJE, CONECTOR A CONECTOR — e por que isto existe
 * ==========================================================================
 *
 * Desligar é DUAS coisas:
 *
 *   1. a DECISÃO fica gravada (linha em `ConectorDesligado`, evento no RASTRO,
 *      linha na auditoria, selo na tela). Isto vale para os 16 conectores;
 *   2. a CHAMADA é recusada com motivo antes de sair da casa. Isto depende de
 *      alguém PERGUNTAR ao interruptor — e quem pergunta por TODA ferramenta de
 *      agente é a porta, desde que o gancho entrou.
 *
 * A primeira versão desta fatia oferecia o interruptor para as 16 linhas e o
 * aviso do topo da tela afirmava a segunda coisa para todas elas. Era falso
 * para quinze — inclusive para o WhatsApp, que é a única escrita externa de
 * verdade ligada hoje, e é justamente o caso de emergência para o qual o botão
 * existe. Anunciar proteção que não existe é pior do que não ter o botão: quem
 * clica em emergência para de procurar outro jeito de parar a máquina.
 *
 * O GANCHO DA PORTA ENTROU (11/09/2026, estabilização da onda 6), e é por isso
 * que esta lista agora é o catálogo inteiro. `ToolGateway.executar` pergunta ao
 * interruptor logo depois de conferir o escopo do agente, e
 * `AcoesService.executarAprovada` pergunta de novo antes de executar uma ação
 * aprovada — sem o segundo, uma aprovação criada ANTES do desligamento ainda
 * sairia depois dele. Nenhuma ferramenta de agente escapa dos dois.
 *
 * O QUE CONTINUA ABERTO, e que esta constante NÃO promete fechar: o caminho HTTP
 * DIRETO, quando uma pessoa clica na tela fora do laço do agente. `ClickupService`
 * já pergunta nos três métodos que falam com a API do ClickUp; os serviços de
 * Google, Meta e WhatsApp precisam da mesma linha no começo do método que fala
 * com a API externa, e `ConectoresService.envolver` existe exatamente para isso.
 * É fatia própria.
 *
 * E oito das dezesseis chaves (openai, telegram, asana, zapier, apify, pluggy,
 * asaas, ofx) não têm HOJE nenhuma capacidade apontando para elas em
 * `CONECTOR_DA_CAPACIDADE` — nelas a recusa é verdadeira por vacuidade no
 * caminho do agente, e o caminho HTTP direto é o de sempre. A catraca da suíte
 * cobra entrada no mapa para toda capacidade nova, então uma capacidade futura
 * que use qualquer uma delas já nasce coberta.
 */
export const CONECTORES_COM_RECUSA_LIGADA: ReadonlySet<string> = CHAVES_DE_CONECTOR;

/**
 * O que desligar este conector faz HOJE:
 *   · `recusa`   — a chamada é barrada com motivo antes de sair da casa;
 *   · `registro` — a decisão fica gravada, e a chamada ainda NÃO é barrada.
 */
export type AplicacaoDoDesligamento = 'recusa' | 'registro';

export function aplicacaoDoDesligamento(chave: string): AplicacaoDoDesligamento {
  return CONECTORES_COM_RECUSA_LIGADA.has(chave) ? 'recusa' : 'registro';
}

/**
 * A frase que a tela mostra por linha. Mora aqui, e não no componente, porque é
 * a mesma afirmação que a API precisa poder sustentar — texto da promessa e
 * código que a cumpre no mesmo arquivo, para não voltarem a divergir.
 *
 * `registro` ficou SEM NENHUMA CHAVE quando o gancho da porta entrou, e continua
 * escrito de propósito: é o que aparece se algum dia uma chave sair de
 * `CONECTORES_COM_RECUSA_LIGADA`. Apagar a frase obrigaria quem fizesse esse
 * caminho de volta a reescrevê-la — e a reescrita é justamente onde a promessa
 * e o código voltam a divergir.
 */
export const TEXTO_DA_APLICACAO: Readonly<Record<AplicacaoDoDesligamento, string>> = {
  recusa:
    'Desligar recusa a chamada na hora, com motivo, e o registro fica no rastro. ' +
    'Vale para toda ferramenta de agente: a porta pergunta antes de executar, e ' +
    'pergunta de novo antes de soltar uma ação que já estava aprovada.',
  registro:
    'Desligar aqui REGISTRA a decisão (com autor, data e motivo) mas ainda NÃO barra a chamada: ' +
    'a trava vale quando o gancho da porta entrar.',
};

/** O rótulo humano de um conector, para a mensagem de recusa. */
export function rotuloDoConector(chave: string): string {
  return CONNECTORS.find((c) => c.key === chave)?.label ?? chave;
}

/** A que grupo uma chave pertence, quando pertence a algum. */
export function grupoDoConector(chave: string): string | null {
  for (const [grupo, chaves] of Object.entries(GRUPOS_DE_CONECTOR)) {
    if (chaves.includes(chave)) return grupo;
  }
  return null;
}

/**
 * Erro de ENTRADA: alvo que não é conector nem grupo conhecido.
 *
 * `BadRequestException` e não `Error`: chave errada vinda da tela é 400 com a
 * lista do que existe, não 500. A mensagem carrega o catálogo inteiro porque
 * quem erra a chave está quase sempre a uma letra de acertar.
 */
export class ConectorDesconhecidoError extends BadRequestException {
  constructor(alvo: string) {
    super(
      `Conector desconhecido: "${alvo}". Use uma chave do catálogo ` +
        `(${[...CHAVES_DE_CONECTOR].join(', ')}) ou um grupo (${Object.keys(GRUPOS_DE_CONECTOR).join(', ')}).`,
    );
    this.name = 'ConectorDesconhecidoError';
  }
}

/**
 * Traduz o alvo que veio da tela — chave de conector OU grupo — na lista de
 * chaves que vão virar linha. Lança em alvo desconhecido: gravar uma chave que
 * não existe criaria um desligamento que nunca recusa nada e ninguém consegue
 * ver na tela.
 */
export function expandirAlvo(alvo: string): string[] {
  const limpo = alvo.trim();
  if (limpo in GRUPOS_DE_CONECTOR) return [...GRUPOS_DE_CONECTOR[limpo]];
  if (CHAVES_DE_CONECTOR.has(limpo)) return [limpo];
  throw new ConectorDesconhecidoError(alvo);
}

/*
 * O MAPA CAPACIDADE → CONECTOR.
 *
 * POR QUE UM MAPA ESCRITO À MÃO E NÃO A `rota` DA CAPACIDADE. Dá para deduzir
 * quase tudo do prefixo da rota (`GET /google/gmail` → gmail), e foi assim que
 * este mapa foi CONFERIDO — mas deduzir em tempo de execução amarraria o
 * desligamento ao texto de um campo que existe para documentar a ferramenta ao
 * modelo. No dia em que alguém renomeasse uma rota, o conector pararia de ser
 * reconhecido e a recusa sumiria em silêncio. Mapa explícito erra ALTO: a
 * catraca em `test/conector-desligado.test.ts` reprova capacidade nova sem
 * entrada aqui.
 *
 * `null` QUER DIZER "NÃO SAI DA CASA", e é a maioria: listar tarefa, ler DRE,
 * buscar lead — tudo isso lê o banco do próprio OS. Espelho de ClickUp lido do
 * banco é `null`; o que ESCREVE no ClickUp é `clickup`.
 *
 * O CATÁLOGO QUE VALE É A UNIÃO, NÃO O DELTA. `politica-marketing-os.json` tem
 * 51 capacidades e é um DELTA sobre `politica-root.json`, que tem 16: o que a
 * execução enxerga é a união resolvida por `resolverPolitica`, com 60. A
 * primeira versão deste mapa (e a catraca que o guarda) lia só o delta, e as
 * NOVE capacidades que só existem na base ficavam sem decisão declarada —
 * inclusive emitir nota fiscal, baixar pagamento, excluir registro e criar
 * tarefa no ClickUp. Como capacidade desconhecida devolve `null`, elas nunca
 * seriam bloqueáveis, com a suíte verde. As nove estão declaradas abaixo.
 *
 * QUATRO CAPACIDADES ADMINISTRATIVAS FICAM DE FORA DE PROPÓSITO, mesmo mexendo
 * em conector. Todas pelo mesmo motivo: são as rotas que CONSERTAM a situação, e
 * recusá-las faria desligar um conector trancar a porta por dentro.
 *   · `credencial.rotacionar` (PUT /integrations/:key) — administra conector; se
 *     o desligamento a recusasse, religar exigiria banco na mão.
 *   · `conector.desligar` e `conector.religar` — o próprio interruptor. Se o
 *     desligamento se recusasse, ele seria de mão única.
 *   · `usuario.permissao.alterar` — administração pura, nenhum conector.
 */
export const CONECTOR_DA_CAPACIDADE: Readonly<Record<string, string | null>> = {
  // Conhecimento — vault indexado localmente.
  'contexto.memoria.buscar': 'obsidian',
  'contexto.nota.ler': 'obsidian',
  // A mesma MEMÓRIA, com o nome que ela tem na base ROOT.
  'memoria.buscar': 'obsidian',

  // Google — quatro superfícies, uma credencial (ver GRUPOS_DE_CONECTOR).
  'contexto.arquivo.listar': 'drive',
  'contexto.documento.ler': 'gdocs',
  'comunicacao.email.buscar': 'gmail',
  'comunicacao.email.ler': 'gmail',
  'comunicacao.agenda.listar': 'gcal',
  'agenda.evento.criar': 'gcal',
  'documento.criar': 'gdocs',
  'documento.anexar': 'gdocs',
  'email.enviar': 'gmail',

  // Meta / Instagram.
  'social.instagram.resumo': 'instagram',
  'social.instagram.midia': 'instagram',
  // MD6: a conta de publicação da bio (Login do Instagram) responde pela MESMA
  // chave — desligar o Instagram em /conexoes para também a publicação.
  'instagram.post.publicar': 'instagram',
  // MD9: a leitura dos comentários da conta de publicação também para com o
  // Instagram desligado — a fila da DM deixa de encher, nada mais.
  'instagram.comentario.ler': 'instagram',

  // MD10: o canal do YouTube, com credencial própria (não é o Google da empresa).
  // Desligar o YouTube em /conexoes barra a sessão de envio, o token do Mac e o agendamento.
  'youtube.video.enviar': 'youtube',
  'youtube.video.publicar': 'youtube',

  // ClickUp — só a ESCRITA sai da casa; a listagem lê o espelho no banco.
  'clickup.tarefa.alterar': 'clickup',
  'clickup.tarefa.criar': 'clickup',

  // WhatsApp pela Evolution (instância e número dedicados do root).
  'whatsapp.mensagem.enviar': 'whatsapp',

  // Daqui para baixo: nada sai da casa.
  'numeros.painel.ler': null,
  'numeros.funil.ler': null,
  'numeros.meta.ler': null,
  'numeros.evento.resumo': null,
  'numeros.evento.listar': null,
  'financeiro.resumo.ler': null,
  'financeiro.conta.listar': null,
  'financeiro.lancamento.listar': null,
  'financeiro.fluxo.ler': null,
  'financeiro.dre.ler': null,
  'financeiro.plano.listar': null,
  'financeiro.pagavel.listar': null,
  'financeiro.kpi.ler': null,
  'financeiro.conciliacao.ler': null,
  // Lista as conexões JÁ GRAVADAS no banco; não chama a Pluggy.
  'financeiro.banco.listar': null,
  // Os dois escrevem na tabela de lançamentos do PRÓPRIO OS (rota
  // `/finance/transactions`), não num financeiro de origem — por isso `null` e
  // não a lista de baixo. Quem sai da casa é `financeiro.pagamento.baixar`.
  'financeiro.lancamento.criar': null,
  'financeiro.lancamento.excluir': null,
  'operacao.tarefa.listar': null,
  'operacao.tarefa.atrasada': null,
  'operacao.tarefa.alterar': null,
  'operacao.trabalho.estrutura': null,
  'operacao.trabalho.listar': null,
  'operacao.trabalho.ler': null,
  'crm.lead.buscar': null,
  'crm.lead.ler': null,
  'crm.lead.alterar': null,
  'pecas.campanha.listar': null,
  'pecas.campanha.ler': null,
  'pecas.campanha.alterar': null,
  'pecas.conteudo.estatistica': null,
  'pecas.conteudo.listar': null,
  // Monta o texto do rascunho; quem manda é `email.enviar`.
  'email.rascunhar': null,
  'relatorio.gerar': null,
  'usuario.permissao.alterar': null,
  'credencial.rotacionar': null,
  // O próprio interruptor: ver a nota das quatro exceções, acima.
  'conector.desligar': null,
  'conector.religar': null,

  // --- Daqui para baixo, o que só existe na base ROOT (politica-root.json) ---
  // A cópia só-leitura do ERP mora no banco do OS; consultar não sai da casa.
  'espelho.consultar': null,
  // MD7: assinar o lote só LIGA o lote, dentro do OS. O que sai é cada item,
  // pela porta, e cada item pergunta ao interruptor do conector DELE na hora:
  // desligar o Instagram segura os posts da semana mesmo com o lote assinado.
  'pauta.semana.aprovar': null,
  // O CRM deste produto é tabela do próprio OS — mesmo caso de `crm.lead.alterar`.
  'crm.lead.criar': null,
};

/**
 * O TERCEIRO ESTADO: sai da casa, e NENHUM interruptor alcança.
 *
 * Existe porque `null` não pode significar duas coisas. Uma capacidade que lê o
 * banco do OS e uma capacidade que escreve num ERP para o qual este produto não
 * tem linha no catálogo de conectores acabam ambas sem recusa — mas por motivos
 * opostos, e apagar a diferença foi exatamente o que deixou nove capacidades
 * invisíveis na primeira versão. Aqui a segunda diz o motivo por escrito.
 *
 * O QUE ISSO CUSTA HOJE: nada, e dá para conferir. Nenhuma das seis tem `rota`
 * nem `ferramenta` no catálogo — são declaradas e não implementadas neste
 * produto, então nenhum agente e nenhuma tela as alcança. Quatro delas são R5, e
 * R5 o OS nunca executa: prepara e entrega a uma pessoa. É a catraca da suíte
 * que segura isso no lugar: entrada daqui que ganhe rota ou ferramenta reprova,
 * e aí a decisão tem de ser retomada — acrescentar a linha do conector em
 * `CONNECTORS` (`packages/shared/src/schemas.ts`) e mover para o mapa acima.
 *
 * O valor é o MOTIVO, em português, porque é ele que a próxima pessoa lê.
 */
export const SEM_INTERRUPTOR: ReadonlyMap<string, string> = new Map([
  [
    'conteudo.publicar',
    'publica em canal público, mas o canal só se decide na chamada. Neste produto ' +
      'as capacidades concretas de publicação (whatsapp.mensagem.enviar, ' +
      'social.instagram.*) têm conector próprio e são alcançadas por ele.',
  ],
  [
    'omie.titulo.alterar',
    'escreve no ERP Omie, que não tem linha em CONNECTORS — não há conector para desligar.',
  ],
  [
    'omie.pagamento.baixar',
    'escreve no ERP Omie, que não tem linha em CONNECTORS. R5: o OS nunca executa, prepara e encaminha.',
  ],
  [
    'nfe.emitir',
    'emite NF-e por um emissor que não tem linha em CONNECTORS. R5: o OS nunca executa, prepara e encaminha.',
  ],
  [
    'registro.excluir',
    'exclui "em qualquer sistema de origem" — o conector depende de qual sistema, e não se ' +
      'sabe na classificação. R5: o OS nunca executa, prepara e encaminha.',
  ],
  [
    'financeiro.pagamento.baixar',
    'baixa título no financeiro de origem, sem linha em CONNECTORS e sem rota neste repositório. ' +
      'R5: o OS nunca executa, prepara e encaminha.',
  ],
]);

/**
 * O conector que uma capacidade usa, ou `null` quando nenhum interruptor a
 * alcança — seja porque ela não sai da casa (o mapa acima), seja porque sai por
 * um conector que este produto não tem no catálogo (`SEM_INTERRUPTOR`).
 *
 * Capacidade DESCONHECIDA também devolve `null`, e isso é escolha: o catálogo
 * aceita sobrescrita por empresa, então pode existir capacidade que este mapa
 * nunca viu. Recusar o desconhecido transformaria o desligamento de um conector
 * em bloqueio geral do que não está no mapa — desproporcional, e sem nada na
 * tela explicando. O que segura o esquecimento é a catraca da suíte, que compara
 * as duas declarações com a UNIÃO do catálogo base com o delta — e não com o
 * delta sozinho, que foi o furo da primeira versão.
 */
export function conectorDaCapacidade(capabilityId: string | null | undefined): string | null {
  if (!capabilityId) return null;
  return CONECTOR_DA_CAPACIDADE[capabilityId] ?? null;
}

/** O que a porta grava e o que o modelo lê quando o conector está desligado. */
export interface RecusaDeConector {
  conector: string;
  rotuloDoConector: string;
  capabilityId: string | null;
  desligadoEm: Date;
  desligadoPor: string | null;
  /** O que a pessoa escreveu ao desligar. */
  motivoDoDesligamento: string | null;
  /** Texto estável para agrupar no relatório. */
  rotulo: string;
  /** Texto completo, em português, para quem levou a recusa. */
  motivo: string;
}

/**
 * O rótulo ESTÁVEL da recusa.
 *
 * Mesmo raciocínio do `ROTULO_DA_RECUSA` da porta: o relatório de calibragem
 * agrupa por esta string, e enfiar o nome do conector aqui espalharia a mesma
 * recusa em uma linha de contagem 1 por conector. O detalhe vai no `motivo` e no
 * payload do evento.
 */
export const ROTULO_CONECTOR_DESLIGADO = 'recusado: conector desligado para esta empresa';

/**
 * O CÓDIGO da recusa — o que a TELA lê para não ter de interpretar prosa.
 *
 * O `motivo` é escrito para uma pessoa e vai mudar de redação; o `rotulo` é
 * escrito para o relatório de calibragem agrupar. Faltava o terceiro
 * destinatário: o front, que precisa distinguir ESTA recusa das outras para
 * oferecer o caminho de conserto (a tela de Conexões) em vez de mostrar mais uma
 * caixa vermelha genérica.
 *
 * Ele viaja no corpo do 403, no campo `error` — que é onde o cliente do web já
 * olha (`lib/api.ts`). Casar por substring da frase em português seria amarrar a
 * tela à redação: a primeira reescrita do texto quebraria o caminho em silêncio.
 */
export const CODIGO_CONECTOR_DESLIGADO = 'conector_desligado';

/** Data em português, sem depender de locale do processo. */
function dataLegivel(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * A frase que chega a quem tentou usar a ferramenta. Ela diz três coisas, e as
 * três importam: QUE está desligado, POR QUE (quando alguém escreveu) e que a
 * credencial continua guardada — senão o operador acha que precisa refazer o
 * OAuth e vai fazer exatamente isso.
 */
export function montarRecusa(entrada: {
  conector: string;
  capabilityId: string | null;
  desligadoEm: Date;
  desligadoPor: string | null;
  motivoDoDesligamento: string | null;
}): RecusaDeConector {
  const rotulo = rotuloDoConector(entrada.conector);
  const porque = entrada.motivoDoDesligamento?.trim()
    ? ` Motivo registrado: "${entrada.motivoDoDesligamento.trim()}".`
    : '';
  return {
    conector: entrada.conector,
    rotuloDoConector: rotulo,
    capabilityId: entrada.capabilityId,
    desligadoEm: entrada.desligadoEm,
    desligadoPor: entrada.desligadoPor,
    motivoDoDesligamento: entrada.motivoDoDesligamento,
    rotulo: ROTULO_CONECTOR_DESLIGADO,
    motivo:
      `O conector "${rotulo}" está desligado para esta empresa desde ` +
      `${dataLegivel(entrada.desligadoEm)}.${porque}` +
      ' Nada foi enviado. A credencial continua guardada: religar em Conexões' +
      ' restabelece o uso sem nova autorização.',
  };
}

/**
 * O CORPO do 403 que a recusa vira quando ela sai por HTTP.
 *
 * Mora aqui, junto da frase, pelo mesmo motivo que `TEXTO_DA_APLICACAO`: a
 * promessa e o código que a cumpre no mesmo arquivo. Quem lança é a fila de
 * aprovação (`gateway/acoes.service.ts` e `approvals/approvals.controller.ts`),
 * e nenhum dos dois deve inventar formato próprio — a tela lê UM contrato.
 *
 * `message` continua sendo a frase em português: é dela que o Nest tira o
 * `Error.message`, então quem já conferia a mensagem (suítes e script de
 * terminal) não muda. `error` carrega o código estável, e os dois campos de
 * conector existem para a tela poder nomear o que religar sem reabrir a frase.
 */
export function corpoDaRecusa(recusa: RecusaDeConector): {
  statusCode: number;
  error: string;
  message: string;
  conector: string;
  rotuloDoConector: string;
} {
  return {
    statusCode: 403,
    error: CODIGO_CONECTOR_DESLIGADO,
    message: recusa.motivo,
    conector: recusa.conector,
    rotuloDoConector: recusa.rotuloDoConector,
  };
}
