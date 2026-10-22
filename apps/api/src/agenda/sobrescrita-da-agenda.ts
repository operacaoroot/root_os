import {
  avaliar,
  lerPolitica,
  resolverPolitica,
  verificarCatalogo,
  verificarReversibilidade,
  type Capacidade,
  type CapacidadeCatalogo,
  type Decisao,
  type DeltaPolitica,
  type Politica,
} from '@mktos/policy';

import { CAPACIDADE_DE_PADRONIZAR, CAPACIDADE_DE_RESTAURAR } from './vigia-da-agenda';

/* ==========================================================================
 * "O VIGIA AGE SOZINHO": A SOBRESCRITA ASSINADA DA POLÍTICA — a parte pura
 * ==========================================================================
 *
 * O pedido do roteiro (A5): o Rodrigo deixa o vigia da agenda corrigir o título
 * sem passar pela fila, por SOBRESCRITA ASSINADA DA POLÍTICA desta empresa
 * (RF-P-04, RF-P-06, `packages/policy/src/sobrescrita.ts`), sem afrouxar o
 * efeito no código. Este arquivo monta o delta e diz, pela MESMA régua da
 * porta, se ele vale — e, se não vale, por quê. Quem aplica é o
 * `PolicyService.sobrescrever` (com autor e motivo), pelo comando em
 * `sobrescrita-da-agenda.cli.ts`.
 *
 * O QUE O DELTA DIZ: para esta empresa, `agenda.evento.padronizar` é R2 —
 * reversível automaticamente, porque o título antigo fica na primeira linha da
 * descrição e uma capacidade de desfazer (`agenda.evento.restaurar`) o devolve.
 * O EFEITO NO CÓDIGO NÃO MUDA: o conector continua só trocando o título e
 * acrescentando o Meet.
 *
 * POR QUE ELE AINDA NÃO FAZ O VIGIA AGIR SOZINHO (medido aqui, não suposto):
 *   1. a escada decide pelo efeito (`nivelBase = maior(declarado, classificar(efeito))`):
 *      com `reversibilidade: manual`, nenhuma sobrescrita desce de R3. Declarar
 *      `automatica` exige um `desfazer` IMPLEMENTADO (`verificarReversibilidade`).
 *      Desde a produção 22 (22/10/2026) ele existe: `agenda.evento.restaurar`
 *      (R3, `POST /agenda/restaurar/:eventoId`, efeito no conector do Google),
 *      e a régua aceita o documento da sobrescrita;
 *   2. mesmo em R2, a porta (`ToolGateway`) chama a régua sem
 *      `aprovacaoR2Ligada` (o `avaliar` aceita o campo; ninguém o passa), e R2
 *      fica RETIDO como R3. Desligar a aprovação de R2 por empresa ainda não
 *      tem onde ser escrito.
 * Resta a segunda peça, e ela é decisão do Rodrigo (se o vigia age sozinho):
 * enquanto ninguém passar `aprovacaoR2Ligada: false` por empresa, a análise
 * continua dizendo por que não. O comando aplica a sobrescrita assim mesmo,
 * com autor e motivo.
 */

/** A capacidade de desfazer que tornaria a padronização reversível de verdade. */
export const CAPACIDADE_DE_DESFAZER = CAPACIDADE_DE_RESTAURAR;
/** O motivo escrito da assinatura (RF-P-06) precisa dizer alguma coisa. */
export const MOTIVO_MINIMO = 20;

/**
 * O DELTA desta empresa com a padronização em R2. Parte do delta que a empresa
 * já tem (a sobrescrita SUBSTITUI o delta inteiro — esquecer as capacidades que
 * já estavam lá seria desfazer, sem assinatura, o que outra pessoa assinou).
 */
export function deltaDoVigiaSozinho(base: Politica, atual: DeltaPolitica | null, hoje: string): DeltaPolitica {
  const cap = (atual?.capacidades ?? []).find((c) => c.id === CAPACIDADE_DE_PADRONIZAR) ?? base.capacidades.find((c) => c.id === CAPACIDADE_DE_PADRONIZAR);
  if (!cap) throw new Error(`${CAPACIDADE_DE_PADRONIZAR} não está na política base: rode db:seed:politica antes.`);
  const copia = JSON.parse(JSON.stringify(cap)) as CapacidadeCatalogo;
  const nova: CapacidadeCatalogo = {
    ...copia,
    nivel: 'R2',
    desfazer: CAPACIDADE_DE_DESFAZER,
    efeito: { ...copia.efeito, reversibilidade: 'automatica' },
  };
  return {
    versao: atual?.versao ?? '1.0.0',
    atualizadoEm: hoje,
    origem: atual?.origem ?? 'sobrescrita da empresa',
    descricao: atual?.descricao ?? 'sobrescrita de política da empresa',
    estende: atual?.estende ?? 'politica-marketing-os.json',
    ...(atual?.limitesPadrao ? { limitesPadrao: atual.limitesPadrao } : {}),
    capacidades: [...(atual?.capacidades ?? []).filter((c) => c.id !== CAPACIDADE_DE_PADRONIZAR), nova],
  };
}

export interface AnaliseDaSobrescrita {
  /** O que a régua recusa no documento resolvido (o mesmo que `PolicyService.sobrescrever` devolve como 400). */
  problemas: string[];
  /** A decisão da régua para a padronização, como a porta a pede hoje (sem `aprovacaoR2Ligada`). */
  decisao: Decisao;
  /** O vigia sairia sem fila? Só com o documento válido E sem aprovação exigida. */
  ageSozinho: boolean;
  /** Por que não, em frases. Vazio quando `ageSozinho`. */
  porQueNao: string[];
}

/** Lê o delta pela MESMA régua da porta e diz se o vigia passaria a agir sozinho. */
export function analisarSobrescrita(base: Politica, delta: DeltaPolitica): AnaliseDaSobrescrita {
  const resolvida = lerPolitica(resolverPolitica(base, delta), 'sobrescrita do vigia da agenda');
  const problemas = [
    ...verificarCatalogo(resolvida)
      .filter((l) => !l.ok)
      .map((l) => `${l.id}: declarado=${l.declarado} calculado=${l.calculado}${l.problemas.length ? ` (${l.problemas.join('; ')})` : ''}`),
    ...verificarReversibilidade(resolvida).map((l) => `${l.id} (${l.nivel}): ${l.motivo}${l.desfazer ? ` → ${l.desfazer}` : ''}`),
  ];
  const cap = resolvida.capacidades.find((c) => c.id === CAPACIDADE_DE_PADRONIZAR) as unknown as Capacidade;
  // A porta chama a régua com os sinais e mais nada: `aprovacaoR2Ligada` não é passado.
  const decisao = avaliar(cap, {});
  const porQueNao: string[] = [];
  if (problemas.length) {
    porQueNao.push(
      `a régua recusa a sobrescrita: ${problemas.join(' | ')}. Confira se a política do banco tem ` +
        `${CAPACIDADE_DE_DESFAZER} (1.12.0 em diante: rode db:seed:politica).`,
    );
  }
  if (decisao.exigeAprovacao) {
    porQueNao.push(
      decisao.nivel === 'R2'
        ? 'mesmo em R2 a porta retém: o ToolGateway não passa `aprovacaoR2Ligada` à régua, então a aprovação configurável de R2 fica sempre ligada.'
        : `a capacidade continua ${decisao.nivel}, e ${decisao.nivel} exige aprovação sempre.`,
    );
  }
  return { problemas, decisao, ageSozinho: porQueNao.length === 0, porQueNao };
}
