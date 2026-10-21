/*
 * A IMPLANTAÇÃO DE CLIENTES NUMA TELA SÓ (rodada do trabalho T1, 19/10/2026).
 *
 * O item de menu "Implantação de clientes" abre o kanban denso da lista
 * "Onboarding de cliente" da pasta "Clientes", que é a da estrutura sugerida do
 * Trabalho e onde o fechamento comercial abre o card (sexta escrita). A tela, a
 * API (que recusa criar cartão solto nessa lista) e o card do fechamento acham
 * a MESMA lista pela mesma regra: pelo nome, sem diferença de maiúscula nem de
 * espaço, como a estrutura sugerida faz.
 */

export const LISTA_DA_IMPLANTACAO = 'Onboarding de cliente';
export const PASTA_DA_IMPLANTACAO = 'Clientes';

/** O nome comparável de pasta e lista (o mesmo critério da estrutura sugerida). */
export function chaveDoNomeDoTrabalho(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

interface PastaComListas {
  id: string;
  name: string;
  parentId?: string | null;
  lists: { id: string; name: string }[];
}

/** A lista da implantação dentro da árvore do Trabalho, ou nulo quando ainda não existe. */
export function listaDaImplantacao(pastas: readonly PastaComListas[]): { pastaId: string; listaId: string } | null {
  const pasta = pastas.find((p) => !p.parentId && chaveDoNomeDoTrabalho(p.name) === chaveDoNomeDoTrabalho(PASTA_DA_IMPLANTACAO));
  if (!pasta) return null;
  const lista = pasta.lists.find((l) => chaveDoNomeDoTrabalho(l.name) === chaveDoNomeDoTrabalho(LISTA_DA_IMPLANTACAO));
  return lista ? { pastaId: pasta.id, listaId: lista.id } : null;
}

/*
 * QUEM TRABALHA NESTA ETAPA (rodada de produção 1, 21/10/2026): o painel do card da
 * implantação mostra, só para ler, os agentes do roster do onboarding e o relógio do
 * trilho, com o último fato de cada um neste cliente e o que vai fazer. Nada inventado:
 * o último fato é um marco gravado; o que vai fazer é o gatilho do procedimento do
 * agente e a pendência que o relógio calcula do que está gravado.
 */
export type EstadoDoAgenteNaEtapa = 'ativo' | 'pausado' | 'planejado' | 'encerrado' | 'ausente';

export interface FatoNaEtapa {
  texto: string;
  /** ISO do marco. */
  em: string;
}

export interface AgenteNaEtapa {
  slug: string;
  nome: string;
  iniciais: string;
  missao: string;
  /** `ausente`: o agente não foi semeado nesta empresa. */
  estado: EstadoDoAgenteNaEtapa;
  ultimoFato: FatoNaEtapa | null;
  oQueVaiFazer: string;
  /**
   * Do cadastro único (rodada dos agentes, 21/10/2026): o id da função (IM-01...),
   * para que serve, o estado declarado e o modelo com o esforço. Ausentes quando a
   * função não está no cadastro.
   */
  funcao?: string;
  paraQueServe?: string;
  estadoDeclarado?: string;
  modelo?: string | null;
  esforco?: string | null;
}

export interface RelogioNaEtapa {
  nome: string;
  /** Do cadastro único (IM-05): o id e para que serve. */
  funcao?: string;
  paraQueServe?: string;
  /** A rotina existe e está ligada. */
  ligado: boolean;
  proximaPassagemEm: string | null;
  ultimoFato: FatoNaEtapa | null;
  /** O que a próxima passagem grava para este cliente (as pendências de agora). */
  vaiFazer: string[];
}

export interface QuemTrabalhaNaEtapa {
  trilhoId: string;
  fase: string;
  faseRotulo: string;
  agentes: AgenteNaEtapa[];
  relogio: RelogioNaEtapa;
}

/** A frase de quem tenta abrir cartão solto na implantação: a porta é o comercial. */
export const PORTA_DA_IMPLANTACAO =
  'O cliente entra na implantação pelo contrato assinado no comercial. Quem fechou fora do sistema entra por "Registrar cliente já fechado", no Funil vivo. Para começar antes do fechamento, use "Iniciar onboarding" a partir do lead.';
