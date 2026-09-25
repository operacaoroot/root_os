import { ContextKind } from '@prisma/client';

/* ==========================================================================
 * O CARREGADOR DE CONTEXTO — o agente que faz a carga guiada (RF-M-05)
 * ==========================================================================
 *
 * A PROMESSA DA FATIA, em uma frase: o cliente responde, o sistema estrutura,
 * e NINGUÉM DA ROOT PREENCHE. O que separa isto de um formulário não é a tela:
 * é quem carrega o procedimento. Num formulário, o roteiro mora no componente
 * e o que sai é o texto cru dentro do campo que a pessoa escolheu. Aqui o
 * roteiro é o PROCEDIMENTO de um agente — os sete campos do RF-N-02, gravados
 * em `Sop` e validados por `validarProcedimento` —, e é ele que decide:
 *
 *   · qual é a próxima pergunta (e quando aprofundar em vez de seguir);
 *   · em que ESPÉCIE de nota a resposta vira (`ContextKind`: regra, definição,
 *     dicionário, decisão, fato) — que é a estruturação de verdade, porque é
 *     ela que muda o que a memória sabe fazer com aquilo depois;
 *   · sob que CHAVE ESTÁVEL ela é gravada, para responder de novo corrigir em
 *     vez de duplicar;
 *   · que PROCEDÊNCIA ela carrega (RF-M-02), sem a qual a nota nem entra.
 *
 * POR QUE O ROTEIRO MORA AQUI E NÃO EM `onboarding/`
 * Porque ele é do AGENTE. O módulo de entrada executa o procedimento; não é
 * dono dele. Um dia o dono da conta vai editar os passos deste agente na tela
 * de Agentes e a carga guiada muda junto — que é exatamente o que se quer de
 * um procedimento, e o oposto do que se consegue com um formulário.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ: falar com banco, com Nest ou com modelo. É dado
 * puro, para que a suíte possa exercitá-lo sem `TEST_DATABASE_URL` e para que
 * o mesmo roteiro seja lido pela semente, pela tela e pelo teste.
 */

export const SLUG_DO_CARREGADOR = 'carregador-de-contexto';

/** O agente que responde a primeira pergunta livre depois da carga. */
export const SLUG_DO_ASSISTENTE = 'assistente';

/**
 * Um tema da carga guiada.
 *
 * "Tema" e não "campo": o que se pede é uma resposta em português sobre um
 * assunto, não o preenchimento de uma caixa. O que o sistema faz depois com a
 * resposta é o que está declarado aqui.
 */
export interface TemaDaCarga {
  /** Entra na CHAVE ESTÁVEL da nota (`onboarding:<id>`). Nunca mude um id em uso. */
  id: string;
  /** A pergunta de abertura, como uma pessoa a faria. */
  pergunta: string;
  /**
   * O título que a NOTA recebe. É escrito aqui e não pela pessoa: título é
   * estrutura, e pedir título a quem está respondendo é devolver o trabalho.
   */
  titulo: string;
  /** A espécie da nota. É a estruturação que a memória usa depois. */
  kind: ContextKind;
  /** As etiquetas da nota. Fixas por tema, pelo mesmo motivo do título. */
  tags: readonly string[];
  /**
   * Sem este tema a carga não fecha. Os opcionais existem para que ninguém
   * fique preso numa pergunta que não se aplica ao negócio dele.
   */
  obrigatorio: boolean;
  /**
   * Quantos caracteres úteis uma resposta precisa ter para o procedimento
   * considerar que ela RESPONDEU.
   *
   * Não é validação de formulário: quando a resposta fica abaixo disto, o
   * procedimento não recusa — ele APROFUNDA, com a pergunta de `aprofundar`.
   * A diferença aparece na tela: um formulário diz "campo obrigatório", o
   * procedimento pergunta outra vez, de outro jeito.
   */
  minimo: number;
  /** A pergunta de aprofundamento, quando a primeira resposta ficou rasa. */
  aprofundar: string;
  /**
   * Palavras que, quando ausentes, sugerem que a resposta ficou genérica.
   * Vazio = o tema não tem como checar isso sem inventar regra.
   *
   * É heurística barata de propósito. O alternativo é uma chamada de modelo
   * por resposta no caminho de ENTRADA do produto — custo e latência no exato
   * momento em que a pessoa está decidindo se fica.
   */
  sinaisDeConcretude: readonly string[];
}

/**
 * OS OITO TEMAS.
 *
 * A ordem é a da conversa, não a do modelo de dados: começa pelo que a pessoa
 * responde sem pensar (o que você vende) e termina no que exige memória (a
 * decisão dos últimos noventa dias). Os dois últimos são opcionais porque
 * negócio recém-aberto não tem decisão para contar, e travar a carga nisso
 * seria travar justamente quem mais precisa entrar.
 *
 * SEIS OBRIGATÓRIOS — e o número tem conta atrás: o degrau de entrada promete
 * "menos de uma hora, sem falar com ninguém". Seis respostas de dois a três
 * minutos cabem em vinte minutos com folga para o OAuth e para a leitura do
 * retrato. Oito obrigatórios não cabiam.
 */
export const TEMAS_DA_CARGA: readonly TemaDaCarga[] = [
  {
    id: 'negocio',
    pergunta:
      'Em duas ou três frases: o que a sua empresa vende, e para quem? Escreva como você ' +
      'explicaria para alguém que nunca ouviu falar dela.',
    titulo: 'O que a empresa faz',
    kind: ContextKind.fato,
    tags: ['onboarding', 'negocio'],
    obrigatorio: true,
    minimo: 60,
    aprofundar:
      'Ficou curto para eu entender o negócio. Me conte o que a pessoa recebe quando compra de ' +
      'você, e o que ela tinha antes de comprar.',
    sinaisDeConcretude: [],
  },
  {
    id: 'cliente-ideal',
    pergunta:
      'Descreva o cliente com quem dá certo: porte, segmento, quem decide a compra. E, se ' +
      'ajudar, o cliente com quem NÃO dá certo.',
    titulo: 'Quem é o cliente certo',
    kind: ContextKind.definicao,
    tags: ['onboarding', 'cliente'],
    obrigatorio: true,
    minimo: 60,
    aprofundar:
      'Me dê um exemplo real: pense num cliente bom que você tem hoje e descreva o que ele tem ' +
      'que os outros não têm.',
    sinaisDeConcretude: [],
  },
  {
    id: 'oferta-e-preco',
    pergunta:
      'Qual é a sua oferta principal e como você cobra por ela? Pode falar em faixa, não ' +
      'preciso do número exato.',
    titulo: 'Oferta principal e como se cobra',
    kind: ContextKind.fato,
    tags: ['onboarding', 'oferta'],
    obrigatorio: true,
    minimo: 40,
    aprofundar:
      'Faltou a parte do dinheiro: é mensalidade, projeto fechado, comissão, por hora? E em que ' +
      'faixa costuma ficar?',
    sinaisDeConcretude: [],
  },
  {
    id: 'numeros-que-importam',
    pergunta:
      'Que números você olha toda semana para saber se o mês está indo bem? Diga o nome que ' +
      'VOCÊS usam para cada um.',
    titulo: 'Os números que a casa olha',
    kind: ContextKind.definicao,
    tags: ['onboarding', 'metricas'],
    obrigatorio: true,
    minimo: 40,
    aprofundar:
      'Me diga também o que cada um desses números significa. Por exemplo: o que ' +
      'conta como "venda fechada" para vocês.',
    sinaisDeConcretude: [],
  },
  {
    id: 'vocabulario',
    pergunta:
      'Que palavras a sua operação usa e que alguém de fora entenderia errado? (nomes de ' +
      'etapas, apelidos de produto, siglas internas)',
    titulo: 'O vocabulário da casa',
    kind: ContextKind.dicionario,
    tags: ['onboarding', 'dicionario'],
    obrigatorio: true,
    minimo: 30,
    aprofundar:
      'Vale qualquer coisa que você explica toda vez que entra gente nova. Cite duas ou três e ' +
      'o que cada uma quer dizer.',
    sinaisDeConcretude: [],
  },
  {
    id: 'regras-da-casa',
    pergunta:
      'O que ninguém pode fazer em nome da empresa? Pense em desconto, promessa a cliente, ' +
      'prazo, tom de mensagem.',
    titulo: 'As regras da casa',
    kind: ContextKind.regra,
    tags: ['onboarding', 'regra'],
    obrigatorio: true,
    minimo: 30,
    aprofundar:
      'Pense na última vez em que alguém fez algo que você não teria feito. Qual é a regra que ' +
      'faltava estar escrita?',
    sinaisDeConcretude: [],
  },
  {
    id: 'canais',
    pergunta: 'Por onde os seus clientes chegam hoje? Liste do que mais traz para o que menos traz.',
    titulo: 'Por onde o cliente chega',
    kind: ContextKind.fato,
    tags: ['onboarding', 'aquisicao'],
    obrigatorio: false,
    minimo: 30,
    aprofundar: 'Se puder, diga mais ou menos quanto vem de cada um, mesmo que seja um chute.',
    sinaisDeConcretude: [],
  },
  {
    id: 'decisao-recente',
    pergunta:
      'Qual foi a decisão mais importante dos últimos noventa dias, e por que vocês decidiram ' +
      'assim?',
    titulo: 'A decisão recente que explica o resto',
    kind: ContextKind.decisao,
    tags: ['onboarding', 'decisao'],
    obrigatorio: false,
    minimo: 50,
    aprofundar: 'Falta o porquê. O que vocês consideraram e descartaram antes de decidir assim?',
    sinaisDeConcretude: [],
  },
] as const;

/** O tema pelo id, ou `undefined`. Quem chama decide o que fazer com a falta. */
export function temaPorId(id: string): TemaDaCarga | undefined {
  return TEMAS_DA_CARGA.find((t) => t.id === id);
}

/** Quantos temas precisam estar respondidos para a carga fechar. */
export const TEMAS_OBRIGATORIOS: readonly string[] = TEMAS_DA_CARGA.filter(
  (t) => t.obrigatorio,
).map((t) => t.id);

/**
 * A CHAVE ESTÁVEL da nota de um tema.
 *
 * É o que faz responder de novo CORRIGIR em vez de duplicar — o mesmo papel
 * que `chaveDaVault` cumpre para o acervo do Obsidian (`memory/procedencia.ts`).
 * Sem chave estável, a segunda passada pela carga guiada deixaria a memória da
 * empresa com duas versões de cada resposta e nenhuma delas vencendo.
 */
export function chaveDoTema(temaId: string): string {
  return `onboarding:${temaId}`;
}

/** A chave da nota de retrato — a leitura de volta que fecha a carga. */
export const CHAVE_DO_RETRATO = 'onboarding:retrato';

/*
 * O PROCEDIMENTO DO CARREGADOR — os quatro campos que uma pessoa escreve.
 *
 * Os outros três dos sete (RF-N-02) não moram aqui, e o `sop.ts` explica por
 * quê: `dono` e `pilar` são colunas de `Agent` (preenchidas na semente, com o
 * primeiro administrador da empresa como dono) e `escalacao` é constante do
 * código, injetada em toda SOP e não editável.
 *
 * OS PASSOS SÃO O ROTEIRO EM PORTUGUÊS, e é de propósito que eles descrevam o
 * mesmo comportamento que `onboarding/carga-guiada.ts` executa: o dia em que
 * alguém editar estes passos na tela e o código não seguir, o procedimento
 * vira decoração. `test/onboarding.test.ts` cobra que os dois digam a mesma
 * coisa nos pontos que dá para medir (quantos temas, quais são obrigatórios).
 */
export const PROCEDIMENTO_DO_CARREGADOR = {
  proposito:
    'levantar, em conversa, o contexto que esta empresa precisa ter dentro do OS para que ' +
    'qualquer resposta seguinte saia com fonte — sem que ninguém de fora da empresa preencha nada',
  gatilho: 'a empresa acabou de ser criada e a memória dela está vazia',
  passos: [
    'pergunte um tema por vez, na ordem do roteiro, em português e sem jargão',
    'quando a resposta vier rasa demais para virar nota, APROFUNDE com a pergunta do tema em vez de recusar',
    'transforme cada resposta numa nota da memória: título, espécie (regra, definição, dicionário, decisão, fato), etiquetas e procedência — quem responde escreve só o conteúdo',
    'grave cada nota sob a chave estável do tema, para que responder de novo corrija em vez de duplicar',
    'no fim, leia de volta o que você entendeu, citando a nota de onde veio cada parte',
    'nunca invente o que não foi dito: tema sem resposta aparece como pendente, não como preenchido',
  ],
  definicaoDePronto:
    'os seis temas obrigatórios viraram nota com procedência, e o retrato lido de volta cita a ' +
    'nota de origem de cada parte',
  observacoes:
    'Este agente não executa ação sobre sistema de terceiro: ele pergunta e estrutura. A lista ' +
    'de capacidades dele é vazia de propósito — carga de contexto que precisa de aprovação ' +
    'trava numa empresa recém-criada, onde existe um usuário só e quem propõe não pode aprovar.',
} as const;
