/*
 * O GRANOLA COMO O BANCO DE ATAS O RECEBE (rodada da interface, 20/10/2026).
 *
 * O banco de atas não importa o conector: a catraca "conector só pela porta"
 * proíbe, e o padrão da casa é o do YouTube (`pauta/cliente-do-youtube.ts`):
 * quem consome declara o contrato e o token, e o módulo do conector
 * (`granola/granola.module.ts`) entrega a implementação por injeção.
 *
 * O que passa por aqui é LEITURA de uma reunião que a própria empresa gravou e
 * autorizou o OS a ler. Não escreve no Granola, não age sobre o mundo e não é
 * capacidade da régua (decisão registrada no relatório da U5: se um dia a
 * leitura precisar de degrau R0 com RASTRO da porta, é capacidade nova, e
 * capacidade nova é decisão humana). Três regras valem para quem implementa:
 *   · a transcrição volta SÓ na memória do processo; o conector não a grava,
 *     não a loga e não a põe em erro;
 *   · o interruptor de Conexões vale: conector desligado recusa antes de sair;
 *   · sem autorização desta empresa, `GranolaNaoConectadoError`, com a frase da tela.
 */

export const FONTE_DO_GRANOLA = Symbol('FONTE_DO_GRANOLA');

export interface ReuniaoDoGranolaListada {
  /** O id da reunião no Granola (UUID ou id público de nota). */
  id: string;
  titulo: string;
  /** ISO, quando o Granola diz. */
  em: string | null;
  /** Como o Granola escreve cada participante ("Nome <email>" ou só o nome). */
  participantes: string[];
  /** Os e-mails dos participantes, em minúsculas. É por eles que o cliente é reconhecido. */
  emails: string[];
  /** O endereço da nota no Granola, quando ele diz. */
  link: string | null;
}

export interface ReuniaoDoGranolaLida extends ReuniaoDoGranolaListada {
  /** A transcrição inteira, crua. Só em memória: quem recebe mascara e descarta. */
  transcricao: string;
}

export interface FonteDoGranola {
  /** Esta empresa autorizou o Granola direto (há token no cofre)? Não sai da casa. */
  conectado(orgId: string): Promise<boolean>;
  /** As reuniões dos últimos `dias`, a mais nova primeiro. */
  listarReunioes(orgId: string, o: { dias: number }): Promise<ReuniaoDoGranolaListada[]>;
  /** Uma reunião, com a transcrição. */
  lerReuniao(orgId: string, id: string): Promise<ReuniaoDoGranolaLida>;
}

/** A empresa não autorizou (ou a autorização foi revogada ou venceu). */
export class GranolaNaoConectadoError extends Error {
  constructor(motivo = 'Conecte o Granola em Configurações › Integrações para ler as reuniões daqui.') {
    super(motivo);
    this.name = 'GranolaNaoConectadoError';
  }
}

/** O Granola não respondeu, ou respondeu num formato que o OS não sabe ler. Nunca carrega a transcrição. */
export class GranolaIndisponivelError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'GranolaIndisponivelError';
  }
}

/** Ids que o Granola usa: UUID ou `not_` + 14. Qualquer outra coisa nem sai da casa. */
export const ID_DE_REUNIAO_DO_GRANOLA = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|not_[A-Za-z0-9]{14})$/i;
