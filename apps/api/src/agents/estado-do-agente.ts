import { EstadoDeAgente, SessionStatus } from '@prisma/client';

/**
 * ============================================================================
 * O ESTADO DO AGENTE — fatia A2 (plano `docs/PLANO-CONTROLE-DE-AGENTES.md`)
 * ============================================================================
 *
 * Este arquivo é o ÚNICO lugar que sabe o que cada estado quer dizer: quem
 * roda, quem não roda, para onde cada um pode ir e como a recusa se chama no
 * rastro. Existe por um defeito que o repositório já pagou duas vezes — duas
 * telas publicando versões contraditórias do mesmo fato (as horas por semana de
 * `/agentes` contra as de `/rotinas`) — e a forma de não repeti-lo é a regra
 * morar no código que a cumpre, não no componente que a desenha.
 *
 * ----------------------------------------------------------------------------
 * DOIS EIXOS, E POR QUE NÃO UM
 * ----------------------------------------------------------------------------
 * O plano pede seis palavras: ativo, ocioso, rodando, erro, pausado, encerrado.
 * Elas não são seis valores de uma coluna — são DOIS eixos:
 *
 *   · ESTADO (`EstadoDeAgente`, no banco): a DECISÃO do dono. planejado, ativo,
 *     pausado, encerrado. Só muda quando alguém clica, e a mudança tem autor,
 *     data e motivo;
 *   · SITUAÇÃO (derivada, nunca gravada): o que está ACONTECENDO. rodando
 *     (sessão viva agora), erro (a última passagem falhou), ocioso (nem uma nem
 *     outra) — e, para os estados que não trabalham, a própria palavra do
 *     estado, porque "ocioso" ao lado de "encerrado" seria uma promessa falsa
 *     de que basta esperar.
 *
 * Colapsar os dois numa coluna foi considerado e está recusado: pausar no meio
 * de uma passagem apagaria o "rodando", e o laço gravando `erro` apagaria o
 * `pausado` que uma pessoa declarou. O banco passaria a ter uma verdade escrita
 * pela máquina por cima da decisão de gente.
 */

/* ========================================================================== *
 * QUEM TRABALHA
 * ========================================================================== */

/**
 * O único estado em que o laço aceita rodar.
 *
 * Lista, e não `!== 'pausado'`, porque a pergunta é "quem trabalha" e não "quem
 * está parado": estado novo que alguém acrescente ao enum nasce FORA daqui, ou
 * seja, sem autonomia, e precisa ser declarado de propósito para ganhar
 * passagem. O contrário (negar a lista dos parados) daria trabalho a todo valor
 * que ninguém pensou.
 */
export const ESTADOS_QUE_TRABALHAM: readonly EstadoDeAgente[] = [EstadoDeAgente.ativo];

export function estadoTrabalha(estado: EstadoDeAgente): boolean {
  return ESTADOS_QUE_TRABALHAM.includes(estado);
}

/**
 * A ORDEM EM QUE OS AGENTES APARECEM NA LISTA.
 *
 * Explícita, e não a ordem do enum, porque as duas querem coisas diferentes: o
 * enum está declarado na ordem do CICLO DE VIDA (nasce planejado, vira ativo,
 * pode ser pausado, acaba encerrado) e a tela quer os que TRABALHAM primeiro.
 * Ordenar pela coluna no `ORDER BY` amarraria a lista à ordem de declaração — e
 * foi o que aconteceu quando o enum mudou nesta fatia: a lista passou a abrir
 * com os agentes que nunca foram ligados.
 */
export const ORDEM_NA_TELA: readonly EstadoDeAgente[] = [
  EstadoDeAgente.ativo,
  EstadoDeAgente.planejado,
  EstadoDeAgente.pausado,
  EstadoDeAgente.encerrado,
];

export function postoNaTela(estado: EstadoDeAgente): number {
  const i = ORDEM_NA_TELA.indexOf(estado);
  // Estado que ninguém ordenou vai para o fim, nunca para o começo.
  return i === -1 ? ORDEM_NA_TELA.length : i;
}

/* ========================================================================== *
 * A RECUSA, COM CAUSA PRÓPRIA
 * ========================================================================== */

/**
 * A causa de cada recusa por estado — o mesmo papel que `agente_rebaixado`
 * cumpre na porta (RF-N-07).
 *
 * Causa é rótulo ESTÁVEL e em minúsculas com sublinhado, para agrupar no rastro
 * seis meses depois sem depender da frase; a frase é o que a pessoa lê e pode
 * mudar sem quebrar relatório. Foi exatamente essa separação que faltou quando
 * o impedimento do laço só escrevia texto: dava para ver o agente recusando e
 * não dava para contar quantas vezes, nem por qual motivo.
 */
export const CAUSA_DA_RECUSA: Record<
  Exclude<EstadoDeAgente, 'ativo'>,
  { causa: string; motivo: string }
> = {
  planejado: {
    causa: 'agente_planejado',
    motivo:
      'Agente ainda não tem dono nem capacidade declarada — está planejado, não rodando.',
  },
  pausado: {
    causa: 'agente_pausado',
    motivo:
      'Agente pausado pelo dono. Ele não executa até alguém retomar em /agentes — a volta é ' +
      'por decisão de gente, não por relógio.',
  },
  encerrado: {
    causa: 'agente_encerrado',
    motivo:
      'Agente encerrado. Ele não executa e não volta: encerrar é tirar de circulação para ' +
      'sempre, e o histórico dele continua no rastro e nas sessões.',
  },
};

/** A recusa deste estado, ou `null` quando o estado trabalha. */
export function recusaPorEstado(
  estado: EstadoDeAgente,
): { causa: string; motivo: string } | null {
  if (estadoTrabalha(estado)) return null;
  return CAUSA_DA_RECUSA[estado as Exclude<EstadoDeAgente, 'ativo'>];
}

/* ========================================================================== *
 * PARA ONDE CADA ESTADO PODE IR
 * ========================================================================== */

/**
 * As transições permitidas. `encerrado` NÃO TEM SAÍDA, e essa lista vazia é a
 * fatia inteira numa linha: encerrar é diferente de pausar porque não volta, e
 * é diferente de apagar porque o histórico fica.
 *
 * `planejado → pausado` existe de propósito: um agente que nunca rodou pode ser
 * congelado antes de ganhar dono, e o dono descobre isso pela tela em vez de
 * receber um "transição inválida" que não explica nada.
 *
 * Repetir o estado atual NÃO está aqui, e é idempotência recusada de propósito:
 * pausar o que já está pausado reescreveria autor, data e motivo, e é a data do
 * "desde quando este agente está parado" que alguém audita. Mesmo raciocínio da
 * idempotência de `ConectoresService.desligar`, que não move `desligadoEm`.
 */
export const TRANSICOES: Record<EstadoDeAgente, readonly EstadoDeAgente[]> = {
  planejado: [EstadoDeAgente.ativo, EstadoDeAgente.pausado, EstadoDeAgente.encerrado],
  ativo: [EstadoDeAgente.pausado, EstadoDeAgente.encerrado],
  pausado: [EstadoDeAgente.ativo, EstadoDeAgente.encerrado],
  encerrado: [],
};

export function transicaoPermitida(de: EstadoDeAgente, para: EstadoDeAgente): boolean {
  return TRANSICOES[de].includes(para);
}

/**
 * Os estados que EXIGEM motivo escrito.
 *
 * Só `encerrado`, e o corte é o mesmo da régua em R4/R5: decisão irreversível
 * pede razão por escrito. Pausar não pede porque o freio tem de ser rápido —
 * cobrar redação de quem está tentando parar a máquina é a forma mais fácil de
 * fazer a pessoa não parar.
 */
export const ESTADOS_QUE_EXIGEM_MOTIVO: readonly EstadoDeAgente[] = [EstadoDeAgente.encerrado];

export function exigeMotivo(estado: EstadoDeAgente): boolean {
  return ESTADOS_QUE_EXIGEM_MOTIVO.includes(estado);
}

/** O evento do rastro de cada transição. Um por destino, nomeado pelo verbo. */
export const EVENTO_DA_TRANSICAO: Record<EstadoDeAgente, string> = {
  planejado: 'agente.replanejado',
  ativo: 'agente.retomado',
  pausado: 'agente.pausado',
  encerrado: 'agente.encerrado',
};

/* ========================================================================== *
 * A SITUAÇÃO — o eixo derivado
 * ========================================================================== */

export type SituacaoDoAgente =
  | 'rodando'
  | 'ocioso'
  | 'erro'
  | 'planejado'
  | 'pausado'
  | 'encerrado';

/**
 * QUANTO TEMPO UMA SESSÃO `rodando` AINDA CONTA COMO SESSÃO VIVA.
 *
 * `Session.status` nasce `rodando` e só sai disso quando alguém a encerra. Um
 * processo que morre no meio (deploy, OOM, timeout de rede) deixa a linha em
 * `rodando` PARA SEMPRE — e derivar o selo direto dela faria o agente aparecer
 * "rodando" em verde pelo resto da vida, que é a mentira mais cara que esta tela
 * poderia contar, porque é justo o selo que alguém olha para decidir se pode
 * pausar.
 *
 * O corte é o teto de tempo do próprio agente (`tetoSegundos`, 180 s no padrão)
 * mais esta margem: passado o teto, a passagem já deveria ter terminado, e uma
 * linha ainda aberta é abandono, não trabalho.
 */
export const MARGEM_DA_SESSAO_VIVA_MS = 60_000;

/** Uma sessão, como a derivação precisa vê-la. */
export interface SessaoEmCurso {
  agentId: string;
  status: SessionStatus;
  ultimaAtividadeEm: Date;
}

/**
 * A situação de um agente. Ordem de precedência escrita, não acidental:
 *
 *   1. o ESTADO manda, quando ele não trabalha. `encerrado`, `pausado` e
 *      `planejado` respondem por si — dizer "ocioso" de um agente encerrado
 *      prometeria que basta esperar;
 *   2. sessão viva agora vence tudo o mais: ele está trabalhando;
 *   3. `ultimoStatus === 'falhou'` vira `erro`. É o mesmo campo que o
 *      rebaixamento do RF-N-07 lê, e é de propósito: a tela mostra `erro` no
 *      mesmo instante em que a porta começa a apertar o teto dele;
 *   4. sobra `ocioso` — ativo e sem nada acontecendo. É o estado normal.
 */
export function situacaoDoAgente(
  agente: {
    id: string;
    estado: EstadoDeAgente;
    ultimoStatus: string | null;
    tetoSegundos: number;
  },
  sessoes: readonly SessaoEmCurso[],
  agora: Date = new Date(),
): SituacaoDoAgente {
  if (!estadoTrabalha(agente.estado)) return agente.estado as SituacaoDoAgente;

  const limite = agora.getTime() - (agente.tetoSegundos * 1000 + MARGEM_DA_SESSAO_VIVA_MS);
  const viva = sessoes.some(
    (s) =>
      s.agentId === agente.id &&
      s.status === SessionStatus.rodando &&
      s.ultimaAtividadeEm.getTime() >= limite,
  );
  if (viva) return 'rodando';
  if (agente.ultimoStatus === SessionStatus.falhou) return 'erro';
  return 'ocioso';
}
