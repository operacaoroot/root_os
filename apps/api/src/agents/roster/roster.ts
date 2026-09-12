import { AgentEstado, AgentTipo, RiskLevel } from '@prisma/client';

import {
  PROCEDIMENTO_DO_CARREGADOR,
  SLUG_DO_ASSISTENTE,
  SLUG_DO_CARREGADOR,
} from './carregador-de-contexto';

/* ==========================================================================
 * O ROSTER DE ENTRADA — os agentes que toda empresa nova ganha (RF-O-02)
 * ==========================================================================
 *
 * `prisma/seed-tripulacao.ts` semeia a tripulação da ROOT: oito agentes, seis
 * deles conectores que já rodavam como `setInterval`. Aquele arquivo é um
 * comando de terminal que percorre TODAS as empresas do banco e é rodado por
 * quem tem o servidor na mão.
 *
 * Este é outro problema. A empresa que acaba de nascer pelo caminho de entrada
 * precisa de DOIS agentes antes de qualquer pessoa clicar em coisa alguma, e
 * ninguém vai rodar comando nenhum por ela:
 *
 *   · o CARREGADOR DE CONTEXTO, que conduz a carga guiada;
 *   · o ASSISTENTE, que responde a primeira pergunta livre depois dela.
 *
 * POR QUE NÃO REUSAR A SEMENTE DA TRIPULAÇÃO. Porque ela é o oposto do que a
 * entrada precisa em três pontos que importam: roda para todas as empresas de
 * uma vez (a entrada é de UMA), traz seis conectores que uma empresa cliente
 * não tem como usar (ClickUp da casa, vault da casa, bio do desafio), e declara
 * `whatsapp.mensagem.enviar` e `financeiro.pagamento.baixar` no assistente —
 * duas capacidades de escrita externa que, numa empresa com UM usuário, ficam
 * presas na fila de aprovação para sempre, porque quem propõe não pode aprovar.
 *
 * O QUE ESTE ROSTER NÃO DECLARA, e a decisão é a mais importante do arquivo:
 * NENHUMA CAPACIDADE ACIMA DE R0. A entrada inteira é leitura e escrita na
 * própria memória da empresa. Capacidade nova não entra por aqui de jeito
 * nenhum — ela só entra em produção por semente assinada da política
 * (`packages/policy`), e um roster que inventasse identificador de capacidade
 * produziria um agente cuja porta recusa tudo que ele tentar (o ramo
 * `fora_da_declaracao` de `gateway/tool-gateway.service.ts`).
 */

export interface AgenteDoRoster {
  slug: string;
  nome: string;
  iniciais: string;
  missao: string;
  pilar: string;
  tipo: AgentTipo;
  estado: AgentEstado;
  autonomiaAte: RiskLevel;
  /** Só identificadores que EXISTEM no catálogo da política. Ver o cabeçalho. */
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

export const ROSTER_DE_ENTRADA: readonly AgenteDoRoster[] = [
  {
    slug: SLUG_DO_CARREGADOR,
    nome: 'Carregador de contexto',
    iniciais: 'CC',
    missao:
      'conduzir a carga do contexto da empresa em conversa, transformando cada resposta numa ' +
      'nota da memória com procedência',
    pilar: 'Contexto',
    tipo: AgentTipo.llm,
    estado: AgentEstado.rodando,
    /*
     * R1: ele RASCUNHA (a nota, o retrato) e não age sobre nada de fora. R0
     * seria mentira — escrever nota é mais do que ler —, e R2 abriria a porta
     * para alteração de dado do negócio, que não é o trabalho dele.
     */
    autonomiaAte: RiskLevel.R1,
    capacidades: [],
    sop: PROCEDIMENTO_DO_CARREGADOR,
  },
  {
    slug: SLUG_DO_ASSISTENTE,
    nome: 'Assistente da central',
    iniciais: 'AC',
    missao: 'responder perguntas sobre o negócio em português, sempre com a fonte do número',
    pilar: 'Contexto',
    tipo: AgentTipo.llm,
    estado: AgentEstado.rodando,
    autonomiaAte: RiskLevel.R1,
    /*
     * SÓ LEITURA, e só o que uma empresa sem módulo contratado alcança. As
     * demais capacidades do catálogo pertencem a módulos (`financeiro`,
     * `leads`, `metas`); declará-las aqui faria o agente propor ferramenta que
     * a porta recusa e a tela não mostra — ruído no lugar de alcance. Quem
     * contratar o módulo acrescenta a capacidade na tela de Agentes.
     */
    capacidades: ['contexto.memoria.buscar', 'contexto.nota.ler'],
    sop: {
      proposito:
        'ser o jeito mais rápido de saber algo sobre o próprio negócio sem abrir tela nenhuma',
      gatilho: 'uma pergunta em português, por qualquer canal',
      passos: [
        'busque na memória da empresa o que já foi carregado sobre o assunto',
        'responda em no máximo 10 linhas, citando a nota de onde veio cada afirmação',
        'se a memória não tiver o assunto, diga que não tem — e diga o que precisaria ser carregado',
      ],
      definicaoDePronto: 'a pergunta foi respondida com dado da memória e com a fonte ao lado',
      observacoes:
        'Resposta que afirma número sem citar fonte é DEFEITO: ela marca a sessão ' +
        '(`Session.semProcedencia`) e sobe um degrau na régua das ações seguintes deste agente ' +
        'por 24h. Numa empresa recém-criada isso trava a operação, porque existe um aprovador só ' +
        'e quem propõe não aprova. Sem fonte, a resposta certa é dizer que não tem.',
    },
  },
] as const;

/** O agente do roster por slug, ou `undefined`. */
export function agenteDoRoster(slug: string): AgenteDoRoster | undefined {
  return ROSTER_DE_ENTRADA.find((a) => a.slug === slug);
}
