import { ContextSource, type ContextKind } from '@prisma/client';

import {
  SLUG_DO_CARREGADOR,
  TEMAS_DA_CARGA,
  TEMAS_OBRIGATORIOS,
  chaveDoTema,
  temaPorId,
  type TemaDaCarga,
} from '../agents/roster';

/* ==========================================================================
 * A CARGA GUIADA — a execução do procedimento do carregador (RF-M-05)
 * ==========================================================================
 *
 * O ROTEIRO NÃO MORA AQUI. Ele é o procedimento do agente carregador
 * (`agents/roster/carregador-de-contexto.ts`), gravado em `Sop` e validado
 * pelos mesmos sete campos que a tela cobra. Este arquivo é o EXECUTOR: dado o
 * que já foi respondido, ele diz qual é a próxima pergunta e transforma cada
 * resposta em nota da memória.
 *
 * A DISTINÇÃO QUE É A FATIA INTEIRA — e ela é medível, não retórica:
 *
 *   · num formulário, quem responde escolhe o campo, escreve o rótulo e decide
 *     onde aquilo vai parar;
 *   · aqui quem responde escreve SÓ O CONTEÚDO. Título, espécie
 *     (`ContextKind`), etiquetas, chave estável e procedência são decididos
 *     pelo procedimento. É isso que faz a resposta virar memória em vez de
 *     virar texto num campo.
 *
 * E o procedimento APROFUNDA em vez de recusar: resposta rasa não devolve
 * "campo obrigatório", devolve outra pergunta — a que o tema declarou.
 *
 * NENHUMA CHAMADA DE MODELO NO CAMINHO DE ENTRADA, e a decisão está declarada
 * para não parecer esquecimento. A suficiência de uma resposta é medida por
 * regra do tema. O alternativo — um turno de modelo por resposta — custa
 * dinheiro e latência exatamente no minuto em que a pessoa está decidindo se
 * fica, e ainda deixaria a carga dependente do provedor estar de pé. O lugar
 * onde o modelo entra de verdade é DEPOIS: a primeira pergunta livre, que roda
 * pelo laço do agente com sessão, RASTRO e teto de custo.
 *
 * PURO: sem banco, sem Nest, sem rede. A suíte exercita isto sem
 * `TEST_DATABASE_URL`.
 */

/** Teto do corpo de uma nota da carga. Ver `cortar`. */
const MAX_CARACTERES_DA_RESPOSTA = 4000;

/**
 * Corta por PONTO DE CÓDIGO, nunca por unidade de 16 bits.
 *
 * `String.prototype.slice` conta unidades UTF-16: cortar no meio de um emoji
 * (ou de qualquer caractere fora do plano básico) deixa meia unidade
 * substituta, o Postgres recusa a gravação com `invalid byte sequence` e uma
 * carga que deu certo vira erro. O mesmo cuidado já está em
 * `memory/procedencia.ts` (`formaDoCorpo`), pelo mesmo motivo.
 */
export function cortar(texto: string, maximo = MAX_CARACTERES_DA_RESPOSTA): string {
  const letras = Array.from(texto);
  return letras.length <= maximo ? texto : letras.slice(0, maximo).join('');
}

/** Quantos caracteres úteis a resposta tem, contados em ponto de código. */
export function tamanhoUtil(resposta: string): number {
  return Array.from(normalizar(resposta)).length;
}

/** Espaços e quebras normalizados; o texto da pessoa fica intacto no resto. */
export function normalizar(resposta: string): string {
  return String(resposta ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

/**
 * A resposta RESPONDEU o tema?
 *
 * Duas conferências, e nenhuma delas é validação de formulário — as duas
 * decidem se o procedimento SEGUE ou APROFUNDA:
 *
 *  1. TAMANHO ÚTIL acima do mínimo do tema. É grosseiro de propósito: o que
 *     se quer pegar é "sim", "não sei", "depois eu vejo";
 *  2. quando o tema declara sinais de concretude, pelo menos um presente.
 *
 * A segunda conferência é opcional por tema e hoje nenhum a usa. Ela está aqui
 * porque a alternativa — deduzir concretude do texto — é o tipo de regra que
 * parece proteger e não protege.
 */
export function respostaSuficiente(tema: TemaDaCarga, resposta: string): boolean {
  const texto = normalizar(resposta);
  if (tamanhoUtil(texto) < tema.minimo) return false;
  if (tema.sinaisDeConcretude.length === 0) return true;
  const baixo = texto.toLowerCase();
  return tema.sinaisDeConcretude.some((s) => baixo.includes(s.toLowerCase()));
}

/** O que a tela precisa mostrar agora. */
export interface PerguntaDaCarga {
  temaId: string;
  /** O texto da pergunta — de abertura ou de aprofundamento. */
  pergunta: string;
  /** `aprofundar` quando a resposta anterior daquele tema ficou rasa. */
  modo: 'abrir' | 'aprofundar';
  titulo: string;
  obrigatorio: boolean;
  /** Posição na conversa, para a tela poder dizer "3 de 8". */
  ordem: number;
  total: number;
}

/** O estado da carga, derivado do que está na memória. Sem tabela nova. */
export interface EstadoDaCarga {
  /** Temas que já viraram nota, na ordem do roteiro. */
  respondidos: string[];
  /** Temas obrigatórios que ainda faltam. Vazio = a carga pode fechar. */
  faltando: string[];
  /** Temas cuja última resposta NÃO passou por `respostaSuficiente`. */
  rasos: string[];
  /** A próxima pergunta, ou `null` quando não há mais o que perguntar. */
  proxima: PerguntaDaCarga | null;
  /**
   * A carga pode fechar?
   *
   * Os obrigatórios todos respondidos **e nenhum deles raso**. A segunda metade
   * é correção de um defeito que a revisão pegou: até ela, seis respostas de
   * dois caracteres deixavam `pronta: true`, e a tela mostrava o botão de
   * concluir AO MESMO TEMPO que a pergunta de aprofundamento. Duas afirmações
   * opostas na mesma tela, e a que o botão fazia era a errada — o retrato saía
   * feito de seis "ok".
   */
  pronta: boolean;
  totalDeTemas: number;
}

/** O que a carga conhece de cada tema já respondido. */
export interface RespostaGravada {
  temaId: string;
  /**
   * O CORPO GRAVADO, e não uma medida dele.
   *
   * Era `tamanho: number`, calculado por quem chamava — e `respostaSuficiente`,
   * a função que existe para decidir isto, não era usada em caminho de escrita
   * nenhum: a regra vivia em dois lugares e só um deles rodava em produção.
   * Passando o corpo, quem decide é sempre a mesma função, e os sinais de
   * concretude de um tema (hoje vazios, mas declarados) passam a valer também
   * aqui — antes eles eram invisíveis para o estado da carga.
   */
  corpo: string;
  /**
   * Quantas versões aquela nota já tem — é ele que conta as INSISTÊNCIAS.
   *
   * Vem de `ContextItem.versao`, que a memória já mantém: responder de novo
   * grava versão nova sob a mesma chave. Não há tabela de progresso (ver o
   * cabeçalho de `passos.ts`) e não precisa haver — o número de vezes que a
   * pessoa respondeu aquele tema já está gravado no fato.
   */
  versao: number;
}

/**
 * Quantas versões bastam para o procedimento parar de aprofundar.
 *
 * ELE EXISTE PARA A CARGA NÃO VIRAR ARMADILHA. `pronta` passou a exigir que
 * nenhum tema obrigatório esteja raso — sem este limite, quem respondesse curto
 * duas vezes ficaria preso na mesma pergunta para sempre, numa tela que promete
 * "menos de uma hora, sem falar com ninguém". O procedimento do agente manda
 * APROFUNDAR quando a resposta vem rasa; mandar aprofundar sem fim é outra
 * coisa, e é pior do que o formulário que ele veio substituir.
 *
 * DOIS: a primeira resposta abre, a segunda é a insistência. Quem insiste está
 * dizendo que é aquilo mesmo — e o que ele escreveu vira nota do mesmo jeito,
 * com o tema continuando listado em `rasos` para quem for ler o retrato depois.
 */
export const VERSOES_ATE_ACEITAR = 2;

/**
 * Onde a conversa está.
 *
 * DERIVADO DA MEMÓRIA, e não de uma tabela de progresso — a decisão é do
 * desenho e vale ser dita: uma tabela de estado de onboarding seria uma
 * segunda verdade sobre o mesmo fato ("este tema foi carregado?"), e as duas
 * divergiriam no primeiro erro de rede entre gravar a nota e marcar o passo. A
 * pergunta "o que já foi carregado?" tem uma resposta só, e ela está na
 * memória, que é onde o contexto mora.
 */
export function estadoDaCarga(gravadas: readonly RespostaGravada[]): EstadoDaCarga {
  const porTema = new Map(gravadas.map((r) => [r.temaId, r]));
  const respondidos: string[] = [];
  const rasos: string[] = [];

  for (const tema of TEMAS_DA_CARGA) {
    const gravada = porTema.get(tema.id);
    if (!gravada) continue;
    respondidos.push(tema.id);
    // A MESMA função que o procedimento usa para decidir aprofundar. Ver
    // `RespostaGravada.corpo`.
    if (!respostaSuficiente(tema, gravada.corpo)) rasos.push(tema.id);
  }

  const faltando = TEMAS_OBRIGATORIOS.filter((id) => !respondidos.includes(id));
  /*
   * OS QUE AINDA CABE APROFUNDAR: obrigatórios, rasos e respondidos UMA vez. O
   * tema em que a pessoa já insistiu sai daqui — ver `VERSOES_ATE_ACEITAR`.
   */
  const aAprofundar = rasos.filter(
    (id) =>
      TEMAS_OBRIGATORIOS.includes(id) &&
      (porTema.get(id)?.versao ?? 1) < VERSOES_ATE_ACEITAR,
  );

  /*
   * A ORDEM DA CONVERSA: primeiro aprofundar o que ficou raso e é obrigatório,
   * depois abrir o próximo tema. Aprofundar antes de seguir é o que o
   * procedimento manda ("quando a resposta vier rasa demais para virar nota,
   * APROFUNDE") e é o que separa isto de um formulário, que só teria marcado o
   * campo de vermelho e seguido em frente.
   *
   * Tema OPCIONAL raso não puxa aprofundamento: quem respondeu curto num tema
   * que nem era obrigatório já disse o que tinha a dizer.
   */
  const paraAprofundar = aAprofundar[0];
  const proximoAberto = TEMAS_DA_CARGA.find((t) => !respondidos.includes(t.id));

  let proxima: PerguntaDaCarga | null = null;
  if (paraAprofundar) {
    const tema = temaPorId(paraAprofundar) as TemaDaCarga;
    proxima = {
      temaId: tema.id,
      pergunta: tema.aprofundar,
      modo: 'aprofundar',
      titulo: tema.titulo,
      obrigatorio: tema.obrigatorio,
      ordem: TEMAS_DA_CARGA.indexOf(tema) + 1,
      total: TEMAS_DA_CARGA.length,
    };
  } else if (proximoAberto) {
    proxima = {
      temaId: proximoAberto.id,
      pergunta: proximoAberto.pergunta,
      modo: 'abrir',
      titulo: proximoAberto.titulo,
      obrigatorio: proximoAberto.obrigatorio,
      ordem: TEMAS_DA_CARGA.indexOf(proximoAberto) + 1,
      total: TEMAS_DA_CARGA.length,
    };
  }

  return {
    respondidos,
    faltando,
    rasos,
    proxima,
    /*
     * NENHUM OBRIGATÓRIO RASO — ver `EstadoDaCarga.pronta`. Com `proxima`
     * apontando para um aprofundamento, `pronta` é necessariamente falso: as
     * duas leem a MESMA lista, então a tela não tem como mostrar as duas coisas.
     */
    pronta: faltando.length === 0 && aAprofundar.length === 0,
    totalDeTemas: TEMAS_DA_CARGA.length,
  };
}

/** A nota que a resposta de um tema vira. É o que o procedimento estrutura. */
export interface NotaDaCarga {
  chave: string;
  titulo: string;
  corpo: string;
  kind: ContextKind;
  tags: string[];
  sourceType: ContextSource;
  sourceRef: string;
  motivo: string;
}

/** Resposta vazia não vira nota — e quem chama precisa saber por quê. */
export class RespostaVaziaError extends Error {
  constructor(readonly temaId: string) {
    super(`a resposta do tema "${temaId}" veio vazia; nota sem corpo não é memória, é ruído.`);
    this.name = 'RespostaVaziaError';
  }
}

/** Tema que não existe no roteiro. Erro de quem chamou, não invariante quebrada. */
export class TemaDesconhecidoError extends Error {
  constructor(readonly temaId: string) {
    super(
      `"${temaId}" não é um tema do roteiro do carregador. Temas: ` +
        TEMAS_DA_CARGA.map((t) => t.id).join(', '),
    );
    this.name = 'TemaDesconhecidoError';
  }
}

/**
 * A ESTRUTURAÇÃO: a resposta em português vira nota da memória.
 *
 * Quem responde escreveu só `resposta`. Tudo o mais vem do procedimento — e a
 * procedência, que RF-M-02 exige e `exigirProcedencia` cobra na entrada da
 * memória, vem preenchida daqui, nunca de quem digitou.
 *
 * `operador` é a procedência certa e vale explicar por que não é `upload` nem
 * `promocao`: alguém DIGITOU NA TELA, que é literalmente o que `operador`
 * significa no enum (`schema.prisma`). O `sourceRef` diz QUEM perguntou e
 * SOBRE O QUÊ — `carregador-de-contexto:negocio` — para que, seis meses
 * depois, quem ler a nota saiba que ela veio da carga de entrada e não de
 * alguém escrevendo solto na tela de Memória.
 */
export function notaDoTema(temaId: string, resposta: string): NotaDaCarga {
  const tema = temaPorId(temaId);
  if (!tema) throw new TemaDesconhecidoError(temaId);

  const corpo = cortar(normalizar(resposta));
  if (!corpo) throw new RespostaVaziaError(temaId);

  return {
    chave: chaveDoTema(tema.id),
    titulo: tema.titulo,
    corpo,
    kind: tema.kind,
    tags: [...tema.tags],
    sourceType: ContextSource.operador,
    sourceRef: `${SLUG_DO_CARREGADOR}:${tema.id}`,
    motivo: `carga guiada de entrada — tema "${tema.id}"`,
  };
}
