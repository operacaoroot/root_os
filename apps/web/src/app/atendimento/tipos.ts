/*
 * O contrato de `GET /api/approvals/fila` (fatia 3.10, RF-A-05).
 *
 * Espelho do que `apps/api/src/approvals/approvals.controller.ts` monta. Nada
 * aqui é calculado no navegador: nível, gatilhos, alçada mínima e a lista de
 * quem pode assinar chegam prontos do servidor, da MESMA leitura de banco que a
 * trava de `confirm` faz. Recalcular qualquer um deles aqui seria construir uma
 * segunda régua — a que promete o que a API recusa.
 */

export type Nivel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

/** Em que gaveta da tela o item cai. Quem decide é o servidor. */
export type Gaveta = 'esperando' | 'confirmada' | 'expirou' | 'recusada';

export interface Aprovador {
  id: string;
  nome: string;
  email: string;
  alcada: string;
}

export interface ItemDaFila {
  id: string;
  gaveta: Gaveta;
  status: string;
  nivel: Nivel;
  /** O degrau ANTES dos gatilhos. Diferente de `nivel` = algum sinal subiu. */
  nivelBase: Nivel | null;
  resumo: string;
  capacidade: string | null;
  canal: string | null;
  recurso: { tipo: string; id: string };
  /**
   * O nome do lead a que a ação se refere (rodada do painel P4), para a frase
   * "Enviar WhatsApp para Marina Duarte". Mesma régua do conteúdo: só para quem
   * decide. Opcional porque resposta antiga não o traz.
   */
  alvo?: string | null;
  agente: string | null;
  correlationId: string | null;
  /**
   * O CONTEÚDO EXATO que vai ser executado — os argumentos gravados na passagem
   * pela porta. `null` quando a aprovação é da superfície antiga, que não retém
   * ação nenhuma. `{ redigido: true, chaves }` quando a capacidade é `restrita`.
   *
   * Também `null` quando quem está olhando não pode DECIDIR: o corpo exato só
   * vai para quem assina (ver `conteudoOculto`, e o bloco da rota no
   * controlador). Os dois `null` se distinguem por `conteudoOculto`.
   */
  conteudo: Record<string, unknown> | null;
  /** `true` = existe conteúdo e ele foi retido por permissão, não por falta. */
  conteudoOculto: boolean;
  /**
   * Os 12 primeiros do hash gravado na aprovação. É IDENTIFICADOR, não prova:
   * ninguém recalcula o hash sobre o conteúdo nesta tela.
   */
  hashDoConteudo: string;
  /**
   * O que a execução recusaria HOJE — capacidade fora do catálogo, régua que
   * deixou de permitir, argumentos que não casam mais. `null` = nada impede.
   */
  impedimento: string | null;
  gatilhos: string[];
  motivoDaRegua: string | null;
  exigeReauth: boolean;
  exigeMotivo: boolean;
  alcadaMinima: string;
  proponente: { id: string; tipo: 'user' | 'ai'; nome: string };
  propostaEm: string;
  expiraEm: string;
  esperandoMs: number;
  decididoPor: string | null;
  decididoEm: string | null;
  motivo: string | null;
  aprovadores: Aprovador[];
  euPossoAprovar: boolean;
  /** A frase que substitui o botão. Já vem na ordem das travas de `confirm`. */
  porQueNao: string | null;
}

export interface Fila {
  agora: string;
  eu: {
    id: string;
    alcada: string;
    /** Decide segundo o BANCO. */
    decide: boolean;
    /** Decide segundo o banco E o token desta sessão — é o que vale no botão. */
    decideNestaSessao: boolean;
    /** Recebe o conteúdo exato das ações retidas. */
    veConteudo: boolean;
  };
  censo: {
    pessoasQueDecidem: number;
    porAlcada: { titular: number; responsavel: number; operador: number };
    pessoasLidas: number;
    pessoasAtivas: number;
    /** O censo virou amostra: há mais gente ativa do que o teto lido. */
    truncado: boolean;
  };
  itens: ItemDaFila[];
  /** O TOTAL de aprovações desta empresa, não o que coube na resposta. */
  total: number;
  /** Quantas vieram. Menor que `total` quando o teto cortou. */
  mostrando: number;
  truncado: boolean;
  tetos: { vivas: number; fechadas: number; pessoas: number };
}

/** O que `POST /approvals/:id/confirm` responde depois de executar. */
export interface Confirmacao {
  ok: true;
  summary: string;
  execucao:
    | { status: 'executado'; resultado: unknown }
    | { status: 'sem_efeito'; motivo: string }
    | { status: 'nada_a_executar' };
}
