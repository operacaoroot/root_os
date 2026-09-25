import { ContextKind } from '@prisma/client';

import { TEMAS_DA_CARGA, chaveDoTema } from '../../agents/roster';

/* ==========================================================================
 * A ESPINHA — o formulário único do onboarding, em quatro blocos
 * ==========================================================================
 *
 * É a fusão que a nota do Pedro (23/09/2026, §6) pede: o Typeform, o
 * questionário de admissão e as "15 perguntas" viram UM formulário, em blocos,
 * com a regra "rico em informação, leve de responder".
 *
 *   A · qualificação — antes da 1ª reunião, até 5 min (a porta do ponto zero);
 *   B · os 8 temas da carga guiada — IMPORTADOS de `carregador-de-contexto.ts`,
 *       como estão. Não existe nono questionário: o que o cliente confirma pelo
 *       link é a mesma nota, com a mesma chave estável, que ele carregaria
 *       sozinho em `/entrar`;
 *   C · intenção — três perguntas abertas (card 08 do ClickUp);
 *   D · operação e linha de base — a dupla, o número de partida, o ambiente,
 *       os anexos, a primeira pergunta e a cadência de status.
 *
 * UMA ESPINHA, DUAS SUPERFÍCIES. O roteiro do kickoff (`roteiro.ts`) é esta
 * lista escrita como conversa; o link do cliente é esta lista com o que a ata
 * já respondeu em modo confirmar. Se o roteiro não pergunta um tema, a ata não
 * tem o que pré-preencher e o tema chega em branco — e quem conduz sabe disso
 * antes do cliente, porque a cobertura é medida sobre a mesma lista.
 *
 * RAMOS POR NÍVEL (decisão de 23/09): o tronco vale para todos; um tema com
 * `niveis` só entra quando o nível do trilho está na lista. No "beabá" o tema
 * de acessos vira "quem participa da turma".
 *
 * PURO: sem banco, sem Nest. Os ids NUNCA mudam depois de usados — eles entram
 * na chave estável da nota (`onboarding:<id>`) e em `OnboardingItem.temaId`.
 */

export type Bloco = 'A' | 'B' | 'C' | 'D';

export type Nivel = 'beaba' | 'avancar-junto' | 'entregar-pronto';
export const NIVEIS: readonly Nivel[] = ['beaba', 'avancar-junto', 'entregar-pronto'] as const;
export const ROTULO_DO_NIVEL: Record<Nivel, string> = {
  beaba: 'Ensinar o beabá',
  'avancar-junto': 'Avançar junto',
  'entregar-pronto': 'Entregar pronto',
};

export type Perfil = 'P1' | 'P2' | 'P3' | 'nao-entra';
export const PERFIS: readonly Perfil[] = ['P1', 'P2', 'P3', 'nao-entra'] as const;

/** Quais blocos um link cobre. `A` antes da 1ª reunião; `BCD` depois do contrato. */
export type BlocosDoConvite = 'A' | 'BCD';

export interface TemaDaEspinha {
  id: string;
  bloco: Bloco;
  titulo: string;
  /** A pergunta como uma pessoa a faria — é o que o roteiro e o link mostram. */
  pergunta: string;
  /** A segunda pergunta, quando a primeira resposta vem rasa. */
  aprofundar: string;
  obrigatorio: boolean;
  /** Ausente = tronco (vale para todo nível). Presente = só nestes níveis. */
  niveis?: readonly Nivel[];
  /** `escolha` mostra opções; `texto` é o padrão. */
  formato: 'texto' | 'escolha';
  opcoes?: readonly string[];
  /** A espécie e as etiquetas da nota que a resposta vira na memória do cliente. */
  kind: ContextKind;
  tags: readonly string[];
  /** Quantos caracteres úteis uma resposta precisa ter para não ser rasa. */
  minimo: number;
}

const A: readonly TemaDaEspinha[] = [
  {
    id: 'a-empresa',
    bloco: 'A',
    titulo: 'O que a empresa faz, e quantas pessoas',
    pergunta: 'O que a sua empresa faz, em uma frase? E quantas pessoas trabalham nela?',
    aprofundar: 'Diga o que vocês vendem e para quem, e um número aproximado de gente.',
    obrigatorio: true,
    formato: 'texto',
    kind: ContextKind.fato,
    tags: ['onboarding', 'triagem', 'negocio'],
    minimo: 20,
  },
  {
    id: 'a-sistemas',
    bloco: 'A',
    titulo: 'Os sistemas e o acesso ao dado',
    pergunta:
      'Quais sistemas vocês usam (ERP, CRM, planilhas, WhatsApp)? O acesso aos dados é seu, ' +
      'via API ou via exportação?',
    aprofundar: 'Cite o nome do sistema principal e quem consegue tirar um relatório dele hoje.',
    obrigatorio: true,
    formato: 'texto',
    kind: ContextKind.fato,
    tags: ['onboarding', 'triagem', 'sistema'],
    minimo: 10,
  },
  {
    id: 'a-tarefa-que-toma-tempo',
    bloco: 'A',
    titulo: 'A tarefa que mais toma tempo',
    pergunta:
      'Qual tarefa mais toma tempo da equipe hoje? Quantas horas por semana, mais ou menos?',
    aprofundar: 'Pense na tarefa que alguém repete toda semana e reclama. Quantas horas ela leva?',
    obrigatorio: true,
    formato: 'texto',
    kind: ContextKind.fato,
    tags: ['onboarding', 'triagem', 'dor'],
    minimo: 15,
  },
  {
    id: 'a-tirar-do-prato',
    bloco: 'A',
    titulo: 'A única coisa a tirar do prato',
    pergunta: 'Se pudesse tirar UMA coisa do prato amanhã, qual seria?',
    aprofundar: 'Uma só. A que mais atrapalha, não a mais fácil de resolver.',
    obrigatorio: true,
    formato: 'texto',
    kind: ContextKind.fato,
    tags: ['onboarding', 'triagem', 'dor'],
    minimo: 10,
  },
  {
    id: 'a-uso-de-ia',
    bloco: 'A',
    titulo: 'O uso de IA hoje',
    pergunta: 'Como é o seu uso de IA hoje?',
    aprofundar: 'Escolha a opção mais próxima do que acontece de verdade, não do que gostaria.',
    obrigatorio: true,
    formato: 'escolha',
    opcoes: ['nunca uso', 'uso o chat às vezes', 'uso todo dia', 'já automatizei algo'],
    kind: ContextKind.fato,
    tags: ['onboarding', 'triagem', 'ia'],
    minimo: 4,
  },
] as const;

/** Os 8 temas da carga guiada, como estão no código, vestidos de tema da espinha. */
const B: readonly TemaDaEspinha[] = TEMAS_DA_CARGA.map((t) => ({
  id: t.id,
  bloco: 'B' as const,
  titulo: t.titulo,
  pergunta: t.pergunta,
  aprofundar: t.aprofundar,
  obrigatorio: t.obrigatorio,
  formato: 'texto' as const,
  kind: t.kind,
  tags: t.tags,
  minimo: t.minimo,
}));

const C: readonly TemaDaEspinha[] = [
  {
    id: 'c-duvidas',
    bloco: 'C',
    titulo: 'As dúvidas de hoje',
    pergunta: 'Quais são as principais dúvidas que você tem hoje sobre isso tudo?',
    aprofundar: 'Vale a dúvida que você não perguntou na reunião por parecer boba.',
    obrigatorio: false,
    formato: 'texto',
    kind: ContextKind.nota,
    tags: ['onboarding', 'intencao'],
    minimo: 10,
  },
  {
    id: 'c-desejo',
    bloco: 'C',
    titulo: 'O que mais deseja que saia daqui',
    pergunta: 'O que você mais deseja que saia daqui?',
    aprofundar: 'Descreva como seria uma semana boa daqui a 90 dias.',
    obrigatorio: true,
    formato: 'texto',
    kind: ContextKind.definicao,
    tags: ['onboarding', 'intencao', 'objetivo'],
    minimo: 20,
  },
  {
    id: 'c-dia-a-dia',
    bloco: 'C',
    titulo: 'O que precisa no dia a dia',
    pergunta: 'Do que você precisa, na prática, para o dia a dia melhorar?',
    aprofundar: 'Pense em terça-feira de manhã: o que teria de ser diferente?',
    obrigatorio: false,
    formato: 'texto',
    kind: ContextKind.nota,
    tags: ['onboarding', 'intencao'],
    minimo: 10,
  },
] as const;

const D: readonly TemaDaEspinha[] = [
  {
    id: 'd-dupla',
    bloco: 'D',
    titulo: 'A dupla: quem responde e quem dá acesso',
    pergunta:
      'Quem conhece as regras do negócio e vai responder as perguntas (o dono das perguntas)? ' +
      'E quem cuida dos sistemas e do acesso (o guardião)? Nome e papel de cada um.',
    aprofundar:
      'Precisam ser duas pessoas nomeadas. Quem propõe uma ação no OS não pode aprová-la; se ' +
      'você estiver viajando, quem diz sim?',
    obrigatorio: true,
    formato: 'texto',
    kind: ContextKind.definicao,
    tags: ['onboarding', 'operacao', 'pessoas'],
    minimo: 15,
  },
  {
    id: 'd-linha-de-base',
    bloco: 'D',
    titulo: 'A linha de base: o número de partida',
    pergunta:
      'O número de partida da frente escolhida: hoje, quanto é? (por exemplo, minutos para achar ' +
      'um documento, ou horas por semana na tarefa). Quem mediu e quando.',
    aprofundar: 'Sem número de partida não existe antes/depois. Um chute honesto vale mais do que nada.',
    obrigatorio: true,
    formato: 'texto',
    kind: ContextKind.fato,
    tags: ['onboarding', 'operacao', 'linha-de-base'],
    minimo: 6,
  },
  {
    id: 'd-ambiente',
    bloco: 'D',
    titulo: 'O ambiente das máquinas',
    pergunta:
      'Nas máquinas de quem vai usar: qual sistema operacional, quem é o administrador da máquina, ' +
      'e existe antivírus ou VPN corporativa?',
    aprofundar: 'Se não souber, diga quem sabe: a TI, o Júnior, o suporte terceirizado.',
    obrigatorio: true,
    niveis: ['avancar-junto', 'entregar-pronto'],
    formato: 'texto',
    kind: ContextKind.fato,
    tags: ['onboarding', 'operacao', 'ambiente'],
    minimo: 10,
  },
  {
    id: 'd-acessos',
    bloco: 'D',
    titulo: 'O que conectamos primeiro',
    pergunta: 'Qual sistema conectamos primeiro, e quem libera o acesso a ele?',
    aprofundar:
      'Não precisa de senha nenhuma aqui, nunca. Só o nome do sistema e de quem tem a chave.',
    obrigatorio: true,
    niveis: ['avancar-junto', 'entregar-pronto'],
    formato: 'texto',
    kind: ContextKind.fato,
    tags: ['onboarding', 'operacao', 'acesso'],
    minimo: 6,
  },
  {
    id: 'd-turma',
    bloco: 'D',
    titulo: 'Quem participa',
    pergunta: 'Quem da sua equipe participa da turma? Nome e o que cada um faz.',
    aprofundar: 'Inclua quem vai usar no dia a dia, não só quem decide.',
    obrigatorio: true,
    niveis: ['beaba'],
    formato: 'texto',
    kind: ContextKind.definicao,
    tags: ['onboarding', 'operacao', 'pessoas'],
    minimo: 10,
  },
  {
    id: 'd-anexos',
    bloco: 'D',
    titulo: 'Documentos e materiais',
    pergunta:
      'Documentos, processos ou material de marca que ajudam a gente a entender a casa: mande o ' +
      'link (Drive, pasta) ou envie no grupo.',
    aprofundar: 'Um organograma, um manual de bolso, o padrão de nome de arquivo: qualquer coisa serve.',
    obrigatorio: false,
    formato: 'texto',
    kind: ContextKind.nota,
    tags: ['onboarding', 'operacao', 'anexos'],
    minimo: 4,
  },
  {
    id: 'd-primeira-pergunta',
    bloco: 'D',
    titulo: 'A pergunta da primeira semana',
    pergunta:
      'Se amanhã você pudesse perguntar uma coisa ao seu próprio dado, qual seria? É por ela que ' +
      'vamos medir se a implantação ficou pronta.',
    aprofundar: 'Uma pergunta que hoje custa uma tarde para responder e você gostaria de ter em um minuto.',
    obrigatorio: true,
    formato: 'texto',
    kind: ContextKind.definicao,
    tags: ['onboarding', 'operacao', 'primeiro-resultado'],
    minimo: 15,
  },
  {
    id: 'd-status',
    bloco: 'D',
    titulo: 'Como e quando quer notícia',
    pergunta: 'Como você quer receber o status do trabalho: por qual canal e com que frequência?',
    aprofundar: 'Grupo, e-mail ou painel? Toda semana, ou só quando acontecer algo?',
    obrigatorio: true,
    formato: 'texto',
    kind: ContextKind.regra,
    tags: ['onboarding', 'operacao', 'comunicacao'],
    minimo: 6,
  },
] as const;

export const ESPINHA: readonly TemaDaEspinha[] = [...A, ...B, ...C, ...D];

export const ROTULO_DO_BLOCO: Record<Bloco, string> = {
  A: 'Qualificação',
  B: 'A memória da casa',
  C: 'Intenção',
  D: 'Operação e linha de base',
};

export function temaDaEspinha(id: string): TemaDaEspinha | undefined {
  return ESPINHA.find((t) => t.id === id);
}

export function temasDoBloco(bloco: Bloco): TemaDaEspinha[] {
  return ESPINHA.filter((t) => t.bloco === bloco);
}

/**
 * Os temas que valem para um nível. Sem nível decidido, só o tronco: um ramo
 * perguntado antes de o nível existir seria pergunta que talvez não se aplique.
 */
export function espinhaParaNivel(nivel: Nivel | null | undefined): TemaDaEspinha[] {
  return ESPINHA.filter((t) => !t.niveis || (nivel ? t.niveis.includes(nivel) : false));
}

export function temasDoConvite(blocos: BlocosDoConvite, nivel: Nivel | null | undefined): TemaDaEspinha[] {
  const quais: Bloco[] = blocos === 'A' ? ['A'] : ['B', 'C', 'D'];
  return espinhaParaNivel(nivel).filter((t) => quais.includes(t.bloco));
}

/** Os obrigatórios de um conjunto de blocos, para o nível. */
export function obrigatorios(blocos: BlocosDoConvite, nivel: Nivel | null | undefined): TemaDaEspinha[] {
  return temasDoConvite(blocos, nivel).filter((t) => t.obrigatorio);
}

/**
 * A chave estável da nota na memória do cliente.
 *
 * Bloco B usa a MESMA função do carregador — é o que faz a confirmação pelo link
 * e a carga em `/entrar` escreverem a mesma nota, e responder de novo corrigir
 * em vez de duplicar. Os outros blocos seguem o mesmo prefixo, com o id já
 * prefixado pelo bloco (`a-`, `c-`, `d-`), então não há como colidir.
 */
export function chaveDaNotaDaEspinha(temaId: string): string {
  return chaveDoTema(temaId);
}

/** Uma resposta RESPONDEU o tema? A mesma régua do carregador: tamanho útil. */
export function respostaSuficienteNaEspinha(tema: TemaDaEspinha, resposta: string): boolean {
  return Array.from(String(resposta ?? '').trim()).length >= tema.minimo;
}

export function ehNivel(v: unknown): v is Nivel {
  return typeof v === 'string' && (NIVEIS as readonly string[]).includes(v);
}

export function ehPerfil(v: unknown): v is Perfil {
  return typeof v === 'string' && (PERFIS as readonly string[]).includes(v);
}
