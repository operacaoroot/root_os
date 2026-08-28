/**
 * Escada de risco ROOT — classificação pura, sem I/O.
 * Espelha `09 - Escada de risco R0-R5.md`. Mudou lá, muda aqui.
 */

export type Nivel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5'

export type Reversibilidade = 'automatica' | 'manual' | 'nenhuma'
export type ImpactoFinanceiro = 'nenhum' | 'obrigacao' | 'movimento'
export type Sensibilidade = 'publica' | 'interna' | 'confidencial' | 'restrita'
export type Alcada = 'operador' | 'responsavel' | 'titular'

export type Sinal =
  | 'destinatario_novo'
  | 'fora_da_janela'
  | 'volume_atipico'
  | 'fonte_nao_confiavel'
  | 'erro_recente'
  | 'valor_acima_do_limite'

export interface Efeito {
  escreveForaDoOS: boolean
  produzArtefato: boolean
  reversibilidade: Reversibilidade
  exposicaoExterna: boolean
  impactoFinanceiro: ImpactoFinanceiro
  sensibilidade: Sensibilidade
  /** Apaga dado ou derruba acesso — o "apaga" da definição de R5. */
  destruicao: boolean
  obrigacaoLegal: boolean
  alcance?: number
}

export interface Aprovacao {
  exigida: 'nunca' | 'configuravel' | 'sempre'
  vinculo: 'nenhum' | 'conteudo'
  usoUnico: boolean
  validadeSegundos: number
  reautenticacao: boolean
  alcadaMinima: Alcada
}

export interface Capacidade {
  id: string
  descricao: string
  nivel: Nivel
  efeito: Efeito
  desfazer?: string
}

export interface Decisao {
  nivel: Nivel
  nivelBase: Nivel
  permitido: boolean
  exigeAprovacao: boolean
  exigeReautenticacao: boolean
  exigeMotivo: boolean
  aprovacao: Aprovacao
  sinaisAcionados: Sinal[]
  motivo: string
}

const ORDEM: readonly Nivel[] = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'] as const

const ALCANCE_LIMITE = 10

export const APROVACAO_POR_NIVEL: Record<Nivel, Aprovacao> = {
  R0: { exigida: 'nunca', vinculo: 'nenhum', usoUnico: false, validadeSegundos: 0, reautenticacao: false, alcadaMinima: 'operador' },
  R1: { exigida: 'nunca', vinculo: 'nenhum', usoUnico: false, validadeSegundos: 0, reautenticacao: false, alcadaMinima: 'operador' },
  R2: { exigida: 'configuravel', vinculo: 'conteudo', usoUnico: true, validadeSegundos: 900, reautenticacao: false, alcadaMinima: 'operador' },
  R3: { exigida: 'sempre', vinculo: 'conteudo', usoUnico: true, validadeSegundos: 900, reautenticacao: false, alcadaMinima: 'responsavel' },
  R4: { exigida: 'sempre', vinculo: 'conteudo', usoUnico: true, validadeSegundos: 600, reautenticacao: true, alcadaMinima: 'titular' },
  R5: { exigida: 'sempre', vinculo: 'conteudo', usoUnico: true, validadeSegundos: 300, reautenticacao: true, alcadaMinima: 'titular' },
}

export function maior(a: Nivel, b: Nivel): Nivel {
  return ORDEM.indexOf(a) >= ORDEM.indexOf(b) ? a : b
}

export function subir(n: Nivel, degraus = 1): Nivel {
  return ORDEM[Math.min(ORDEM.indexOf(n) + degraus, ORDEM.length - 1)]
}

/**
 * Resolve o nível a partir do efeito da ação.
 * O nível é o gatilho mais alto acionado — nunca a média.
 */
export function classificar(e: Efeito): Nivel {
  if (!e.escreveForaDoOS) return e.produzArtefato ? 'R1' : 'R0'

  let nivel: Nivel = 'R2'

  // Irreversibilidade exige assinatura humana no conteúdo (R3), e para por aí:
  // o que empurra além disso é o que a ação TOCA, não o fato de não ter volta.
  if (e.reversibilidade !== 'automatica') nivel = maior(nivel, 'R3')

  if (e.exposicaoExterna) nivel = maior(nivel, 'R3')

  if (e.impactoFinanceiro === 'obrigacao') nivel = maior(nivel, 'R4')
  if (e.impactoFinanceiro === 'movimento') nivel = maior(nivel, 'R5')

  if (e.sensibilidade === 'confidencial') nivel = maior(nivel, 'R3')
  if (e.sensibilidade === 'restrita') nivel = maior(nivel, 'R4')

  if (e.destruicao) nivel = maior(nivel, 'R5')
  if (e.obrigacaoLegal) nivel = maior(nivel, 'R5')

  if ((e.alcance ?? 1) > ALCANCE_LIMITE) nivel = subir(nivel)

  return nivel
}

/**
 * Sinais não acumulam e param em R4: um dia atípico eleva a exigência,
 * mas não pode bloquear sozinho o que a capacidade permite por natureza.
 */
export function escalonar(base: Nivel, sinais: readonly Sinal[]): Nivel {
  if (sinais.length === 0) return base
  if (base === 'R5') return 'R5'
  return minimo(subir(base), 'R4')
}

function minimo(a: Nivel, b: Nivel): Nivel {
  return ORDEM.indexOf(a) <= ORDEM.indexOf(b) ? a : b
}

export interface Contexto {
  sinais?: readonly Sinal[]
  /** Vale só para R2, onde a aprovação é configurável por cliente. */
  aprovacaoR2Ligada?: boolean
}

/**
 * Decisão final do Policy Engine. O Tool Gateway consome isto e não
 * consulta mais nada — inclusive o `motivo`, que vai para o RASTRO.
 */
export function avaliar(capacidade: Capacidade | null, ctx: Contexto = {}): Decisao {
  // Fail closed: ferramenta não classificada entra bloqueada.
  if (!capacidade) {
    return {
      nivel: 'R5',
      nivelBase: 'R5',
      permitido: false,
      exigeAprovacao: true,
      exigeReautenticacao: true,
      exigeMotivo: true,
      aprovacao: APROVACAO_POR_NIVEL.R5,
      sinaisAcionados: [],
      motivo: 'capacidade sem classificação vale R5',
    }
  }

  const sinais = ctx.sinais ?? []
  const nivelBase = maior(capacidade.nivel, classificar(capacidade.efeito))
  const nivel = escalonar(nivelBase, sinais)
  const aprovacao = APROVACAO_POR_NIVEL[nivel]

  const exigeAprovacao =
    aprovacao.exigida === 'sempre' ||
    (aprovacao.exigida === 'configuravel' && ctx.aprovacaoR2Ligada !== false)

  const motivo =
    nivel === 'R5'
      ? 'R5 é preparado e encaminhado, nunca executado pelo OS'
      : sinais.length > 0
        ? `${nivelBase} elevado para ${nivel} por: ${sinais.join(', ')}`
        : `classificado como ${nivel}`

  return {
    nivel,
    nivelBase,
    permitido: nivel !== 'R5',
    exigeAprovacao,
    exigeReautenticacao: aprovacao.reautenticacao,
    exigeMotivo: nivel === 'R4' || nivel === 'R5',
    aprovacao,
    sinaisAcionados: [...sinais],
    motivo,
  }
}
