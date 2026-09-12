/**
 * ============================================================================
 * O CONECTOR FICTÍCIO — a prova de que conector novo entra sem tocar no núcleo
 * ============================================================================
 *
 * RF-X-06: "conector novo implementa o contrato e aparece no catálogo sem
 * alterar o núcleo". Uma afirmação dessas não se prova lendo código — prova-se
 * escrevendo um conector que não existe em lugar nenhum e vendo-o aparecer.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ELE MORA EM `test/`, E NÃO EM `src/`
 * ----------------------------------------------------------------------------
 * Porque o registro do contrato tem uma TRAVA DE ARRANQUE
 * (`RegistroDeConectores.onApplicationBootstrap`): se um conector da lista
 * cobrada não se inscrever, a API não sobe. É proteção contra o modo de falha
 * silencioso — um conector que esquece a inscrição some da tela sem nada avisar.
 *
 * Só que a trava corta nos dois sentidos. Um conector de teste que morasse em
 * `src/` e entrasse na lista cobrada passaria a ser OBRIGATÓRIO em produção; e
 * mesmo fora da lista, ele apareceria no catálogo real de toda empresa, com
 * botões que não fazem nada. Aqui em `test/` ele não é empacotado (a pasta fica
 * fora do `tsconfig.json` de build), não se inscreve em processo nenhum e a
 * suíte ainda o exerce por inteiro.
 *
 * A CHAVE É PROPOSITALMENTE FEIA. `conector-de-teste-ficticio` não é nome que
 * alguém digite por engano, e é ela que a varredura da suíte procura em `src/` e
 * em `packages/` para provar que o núcleo não foi tocado.
 */

import {
  type ConectorDoContrato,
  type ContextoDoVerbo,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  naoConfigurado,
} from '../src/integrations/contrato-de-conector';

/** A chave. A suíte varre `src/` atrás dela para provar que ninguém a conhece. */
export const CHAVE_FICTICIA = 'conector-de-teste-ficticio';

export interface ComportamentoFicticio {
  /**
   * O que a sonda faz. `pendurar` nunca resolve — é o teste de degradação.
   *
   * Os três "verdes" são os defeitos que a catraca tem de pegar, e eles são
   * diferentes entre si:
   *   · `verde-sem-sonda`          — assina `declaracao`. O caso óbvio;
   *   · `verde-com-latencia-invalida` — assina `tentativa` e manda `null`;
   *   · `verde-com-latencia-inventada` — assina `tentativa` e manda um número
   *     bonito que ele não mediu. É o que prova que o REGISTRO carimba por cima.
   */
  sonda?:
    | 'ok'
    | 'sem-credencial'
    | 'estourar'
    | 'pendurar'
    | 'verde-sem-sonda'
    | 'verde-com-latencia-invalida'
    | 'verde-com-latencia-inventada';
  /** A empresa que "autorizou". Outra empresa recebe `nao_configurado`. */
  empresaAutorizada?: string;
  /** Conta quantas vezes cada verbo foi chamado — para provar que NÃO foi. */
  chamadas?: Record<string, number>;
  /** Segura a sonda por este tempo, para a medição do registro ter o que medir. */
  atrasoMs?: number;
}

/**
 * Um conector que implementa o contrato inteiro e nada mais.
 *
 * Repare no que ele NÃO precisa: nenhuma entrada em `CONNECTORS`
 * (`packages/shared`), nenhuma linha no registro de conectores configurados,
 * nenhuma edição em `IntegrationsService`, nenhum caso especial na tela. Ele
 * declara `chave`, `rotulo`, `categoria`, `exige` e os quatro verbos — e o
 * catálogo monta a linha a partir disso.
 */
export function conectorFicticio(
  comportamento: ComportamentoFicticio = {},
): ConectorDoContrato {
  const conta = (verbo: string) => {
    if (comportamento.chamadas) {
      comportamento.chamadas[verbo] = (comportamento.chamadas[verbo] ?? 0) + 1;
    }
  };

  return {
    chave: CHAVE_FICTICIA,
    rotulo: 'Conector fictício (suíte)',
    escopoDaCredencial: 'empresa',
    categoria: 'teste',
    exige: 'nada — ele só existe dentro da suíte',

    autorizar: async (): Promise<ResultadoDeAutorizacao> => {
      conta('autorizar');
      return { tipo: 'redirecionar', url: 'https://exemplo.invalido/autorizar' };
    },

    sincronizar: async (): Promise<ResultadoDeSincronizacao> => {
      conta('sincronizar');
      return { tipo: 'feito', resumo: '3 item(ns) fictício(s).', numeros: { itens: 3 } };
    },

    saude: async (ctx: ContextoDoVerbo): Promise<SaudeDeConector> => {
      conta('saude');
      const modo = comportamento.sonda ?? 'ok';
      if (comportamento.atrasoMs) {
        await new Promise((r) => setTimeout(r, comportamento.atrasoMs));
      }

      if (
        comportamento.empresaAutorizada !== undefined &&
        comportamento.empresaAutorizada !== ctx.orgId
      ) {
        // A armadilha nº 1 desta fatia, encenada: a credencial do PROCESSO
        // existe, e mesmo assim esta empresa não pode ficar verde.
        return naoConfigurado(
          `A empresa ${ctx.orgId} nunca autorizou este conector (quem autorizou foi ` +
            `${comportamento.empresaAutorizada}).`,
        );
      }

      switch (modo) {
        case 'sem-credencial':
          return naoConfigurado('Falta a credencial fictícia no ambiente.');
        case 'estourar':
          throw new Error('o fornecedor fictício respondeu HTTP 503: manutenção programada');
        case 'pendurar':
          // Nunca resolve. É o conector que trava sem estourar — o caso que só o
          // relógio do registro pega.
          return new Promise<SaudeDeConector>(() => {});
        case 'verde-com-latencia-invalida':
          /*
           * ASSINA A MEDIÇÃO SEM MEDIR. Este é o defeito que a primeira versão
           * da catraca deixava passar: bastava dizer `tentativa`.
           */
          return {
            estado: 'conectado',
            mensagem: 'sondei, juro',
            apuracao: 'tentativa',
            verificadoEm: new Date().toISOString(),
            latenciaMs: null,
          };
        case 'verde-com-latencia-inventada':
          // Número bonito que ele não mediu. O registro carimba o dele por cima.
          return {
            estado: 'conectado',
            mensagem: 'rapidíssimo',
            apuracao: 'tentativa',
            verificadoEm: new Date().toISOString(),
            latenciaMs: 999_999,
          };
        case 'verde-sem-sonda':
          /*
           * O DEFEITO QUE A CATRACA PEGA: verde declarado, sem tentativa nenhuma.
           * Montado à mão de propósito — `conectado()` exige latência medida e
           * não deixa escrever isto por acidente. Aqui é de propósito, para
           * provar que o registro rebaixa.
           */
          return {
            estado: 'conectado',
            mensagem: 'confie em mim',
            apuracao: 'declaracao',
            verificadoEm: new Date().toISOString(),
            latenciaMs: null,
          };
        default:
          return conectado(7, `empresa ${ctx.orgId} respondeu.`);
      }
    },

    revogar: async (): Promise<ResultadoDeRevogacao> => {
      conta('revogar');
      return {
        tipo: 'revogado',
        segredos: ['access_token'],
        resumo: 'Credencial fictícia queimada.',
      };
    },
  };
}

/**
 * Um conector cuja credencial é do PROCESSO — para provar a outra metade da
 * distinção entre desligar e revogar.
 */
export function conectorDeProcesso(chave = 'processo-ficticio'): ConectorDoContrato {
  return {
    chave,
    rotulo: 'Conector de processo (suíte)',
    escopoDaCredencial: 'processo',
    categoria: 'teste',
    exige: 'variável de ambiente fictícia',
    autorizar: async () => ({ tipo: 'manual', instrucao: 'defina a variável e reinicie.' }),
    sincronizar: async () => ({ tipo: 'feito', resumo: 'nada a trazer.' }),
    saude: async () => conectado(1, 'credencial do processo presente.'),
    revogar: async () => ({
      tipo: 'nao_se_aplica',
      motivo:
        'A credencial é do PROCESSO e vale para todas as empresas: não há como queimá-la só ' +
        'para esta. Para esta empresa parar agora, DESLIGUE o conector.',
    }),
  };
}

/**
 * Um conector cuja SONDA REJEITA antes de qualquer `try` interno.
 *
 * É o caso que o `Promise.all` de `sondarVarios` derrubava junto com todos os
 * outros: `saude` não devolve promessa que se resolve, ela estoura de forma
 * síncrona na montagem. Nenhum conector de produção faz isso hoje — e é
 * exatamente por isso que precisa estar aqui: a promessa de degradação não pode
 * depender de nenhum deles continuar não fazendo.
 */
export function conectorQueRejeitaNaCara(chave = 'rejeita-ficticio'): ConectorDoContrato {
  const c = conectorFicticio();
  return {
    ...c,
    chave,
    rotulo: 'Conector que rejeita (suíte)',
    saude: (): Promise<SaudeDeConector> => {
      throw new Error('estourei antes de devolver promessa nenhuma');
    },
  };
}

/** Um conector que só falha, para o teste de degradação. */
export function conectorQuebrado(chave = 'quebrado-ficticio'): ConectorDoContrato {
  const c = conectorFicticio({ sonda: 'estourar' });
  return { ...c, chave, rotulo: 'Conector quebrado (suíte)' };
}

/** Um conector que nunca responde, para o teste de prazo. */
export function conectorPendurado(chave = 'pendurado-ficticio'): ConectorDoContrato {
  const c = conectorFicticio({ sonda: 'pendurar' });
  return { ...c, chave, rotulo: 'Conector pendurado (suíte)' };
}

/** Um conector saudável, para provar que ele não sente a queda dos vizinhos. */
export function conectorSaudavel(chave = 'saudavel-ficticio'): ConectorDoContrato {
  const c = conectorFicticio({ sonda: 'ok' });
  return { ...c, chave, rotulo: 'Conector saudável (suíte)' };
}
