import type { AgentTipo, EstadoDeAgente, RiskLevel } from '@prisma/client';

import { agentesDaSemente, type AgenteDaSemente } from './complementos';

/* ==========================================================================
 * O ROSTER DE ENTRADA — os agentes que toda empresa nova ganha (RF-O-02)
 * ==========================================================================
 *
 * `prisma/seed-tripulacao.ts` semeia a tripulação da ROOT, e é um comando de
 * terminal que percorre TODAS as empresas do banco. Este é outro problema: a
 * empresa que acaba de nascer pelo caminho de entrada precisa de DOIS agentes
 * antes de qualquer pessoa clicar em coisa alguma, e ninguém vai rodar comando
 * nenhum por ela:
 *
 *   · o CARREGADOR DE CONTEXTO (IM-04), que conduz a carga guiada;
 *   · o ASSISTENTE (CE-01), que responde a primeira pergunta livre depois dela.
 *
 * DESDE A RODADA DOS AGENTES (21/10/2026, A1) os dois saem do CADASTRO ÚNICO
 * (`funcoesDaSemente('entrada')`), com o complemento de `complementos.ts`. O
 * assistente é UMA definição só (a mesma da tripulação): o que separa a empresa
 * nova da casa é o FILTRO DE MÓDULO aplicado na hora de semear (`semear.ts` +
 * `capacidades-da-empresa.ts`). Numa empresa sem módulo contratado, o assistente
 * nasce só com as capacidades da espinha (memória e painel), todas de leitura.
 *
 * O QUE O CADASTRO NÃO DECLARA PARA O ASSISTENTE, e é a decisão mais importante:
 * nenhuma capacidade de escrita externa. As duas que a tripulação antiga declarava
 * "para a régua aparecer" (`whatsapp.mensagem.enviar` R3, `financeiro.pagamento.baixar`
 * R5) e as duas sem efeito (`contexto.nota.ler`, `numeros.funil.ler`) saíram: numa
 * empresa com UM usuário, a escrita externa ficaria presa na fila para sempre
 * (quem propõe não aprova), e a ferramenta sem efeito só ensina o modelo a pedir
 * o que nunca roda.
 */

export interface AgenteDoRoster {
  slug: string;
  nome: string;
  iniciais: string;
  missao: string;
  pilar: string;
  tipo: AgentTipo;
  estado: EstadoDeAgente;
  autonomiaAte: RiskLevel;
  /** Só identificadores que EXISTEM no catálogo da política (o teste do cadastro confere). */
  capacidades: readonly string[];
  /** Os quatro campos que uma pessoa escreve. Os outros três: ver `sop.ts`. */
  sop: {
    proposito: string;
    gatilho: string;
    passos: readonly string[];
    definicaoDePronto: string;
    observacoes?: string;
  };
}

/** Uma linha do cadastro como agente de roster (que exige procedimento). */
export function paraRoster(a: AgenteDaSemente): AgenteDoRoster {
  if (!a.sop) {
    throw new Error(`o agente "${a.slug}" é semeado por roster e não tem procedimento em complementos.ts`);
  }
  return {
    slug: a.slug,
    nome: a.nome,
    iniciais: a.iniciais,
    missao: a.missao,
    pilar: a.pilar,
    tipo: a.tipo,
    estado: a.estado,
    autonomiaAte: a.autonomiaAte,
    capacidades: a.capacidades,
    sop: a.sop,
  };
}

export const ROSTER_DE_ENTRADA: readonly AgenteDoRoster[] = agentesDaSemente('entrada').map(paraRoster);

/** O agente do roster por slug, ou `undefined`. */
export function agenteDoRoster(slug: string): AgenteDoRoster | undefined {
  return ROSTER_DE_ENTRADA.find((a) => a.slug === slug);
}
