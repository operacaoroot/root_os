import { escolherModelo, funcaoPorId, type EsforcoDaFuncao } from '@mktos/shared';

import type { LlmEffort } from './llm.provider';

/*
 * O MODELO E O ESFORÇO DE UMA CHAMADA (rodada dos agentes, 21/10/2026, A1).
 *
 * Uma regra só, usada pelo provedor (que manda o pedido) e pelo envelope do teto
 * (que reserva o custo dele), para as duas contas nunca divergirem:
 *
 *   1. `model`/`effort` EXPLÍCITOS na chamada valem por cima de tudo (é como o
 *      laço do agente passa o que a tela de Agentes ajustou no registro);
 *   2. senão, a FUNÇÃO do cadastro único: `LLM_MODELO_<ID>`/`LLM_ESFORCO_<ID>`,
 *      depois o cadastro (`escolherModelo` do shared);
 *   3. senão, o padrão do provedor (`ANTHROPIC_MODEL`/`ANTHROPIC_EFFORT`).
 *
 * Cada metade cai sozinha: modelo explícito sem esforço explícito leva o esforço
 * da função (ou do padrão), e vice-versa.
 */

export interface PadraoDoProvedor {
  modelo: string;
  esforco: LlmEffort;
}

export interface ModeloDaChamada {
  modelo: string;
  esforco: LlmEffort;
  origem: 'explicito' | 'variavel' | 'cadastro' | 'padrao';
}

export function modeloDaChamada(
  input: { funcao?: string; model?: string; effort?: LlmEffort },
  padrao: PadraoDoProvedor,
  ambiente: Readonly<Record<string, string | undefined>> = process.env,
): ModeloDaChamada {
  const escolha = escolherModelo(input.funcao, { modelo: padrao.modelo, esforco: padrao.esforco as EsforcoDaFuncao }, ambiente);
  const model = input.model?.trim();
  const effort = input.effort;
  return {
    modelo: model || escolha.modelo,
    esforco: (effort ?? escolha.esforco) as LlmEffort,
    origem: model || effort ? 'explicito' : escolha.origem,
  };
}

/**
 * Em nome de quem o gasto é contado: o `agentSlug` informado, senão o slug da
 * função no cadastro. Vazio = gasto da empresa sem agente (o caso de sempre).
 */
export function slugDaChamada(input: { agentSlug?: string; funcao?: string }): string {
  return input.agentSlug?.trim() || (input.funcao ? funcaoPorId(input.funcao)?.slug ?? '' : '');
}

/*
 * O FALLBACK DE SERVIDOR POR MODELO (skill `claude-api`, 21/10/2026):
 *  · Opus 5.5, Opus 5, Sonnet 5.5 e Fable 5.1 aceitam `fallbacks: "default"`
 *    com o beta `server-side-fallback-2026-07-01` (o Sonnet 5.5 SÓ nessa forma);
 *  · o Haiku 5.5 NÃO tem fallback de servidor: com `"default"` a recusa fica
 *    recusa, e com lista de modelos é 400 — então o parâmetro não vai;
 *  · modelo fora desta lista também não leva (não se manda parâmetro que o
 *    modelo pode recusar com 400).
 */
const COM_FALLBACK_DE_SERVIDOR = ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1'];

/** O beta que liga a forma `"default"` do fallback. */
export const BETA_DO_FALLBACK = 'server-side-fallback-2026-07-01';

export function aceitaFallbackDeServidor(modelo: string): boolean {
  const base = modelo.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, '');
  return COM_FALLBACK_DE_SERVIDOR.includes(base);
}

/** A ferramenta de busca na web do servidor que cada modelo aceita. */
export function tipoDaBuscaNaWeb(modelo: string): 'web_search_20260209' | 'web_search_20250305' {
  // A variante com filtro dinâmico é de Opus 5.5/5/4.8/4.7/4.6 e Sonnet 5.5/5/4.6;
  // o resto (Haiku inclusive) fica com a básica.
  return /^claude-(opus-(5-5|5|4-8|4-7|4-6)|sonnet-(5-5|5|4-6))(?:-\d{8})?$/.test(modelo)
    ? 'web_search_20260209'
    : 'web_search_20250305';
}
