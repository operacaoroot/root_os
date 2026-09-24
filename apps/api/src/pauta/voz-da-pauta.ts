/*
 * O BLOCO DE VOZ DO ROTEIRO (MC8) — o ponto onde o MC10 entra.
 *
 * Hoje só o prompt do roteiro chama `blocoDeVoz`, e recebe o tom da casa: um
 * resumo das regras que a curadoria e as peças seguem escrevendo à mão em
 * `rodada.service.ts` (SYSTEM_CURADORIA, SYSTEM_PECAS). O MC10 lê o perfil de
 * voz do autor na memória (`voz.pedro`, escrito pelo caminho da ADR-011) e o
 * entrega aqui; ligar a curadoria e as peças a este bloco é trabalho do MC10.
 */

export const TOM_DA_CASA = [
  'Tom da casa (ROOT):',
  '- português do Brasil, direto, frases curtas, para falar em voz alta;',
  '- sem emoji, sem "no mundo da IA", sem jargão de palco;',
  '- fala de quem toca o negócio para quem toca o negócio: custo, tempo, cliente, decisão da semana;',
  '- não promete o que a matéria não sustenta.',
].join('\n');

/** Teto do perfil que entra no prompt: voz é instrução, não acervo. */
const TETO_DO_PERFIL = 4_000;

/** O perfil de voz do autor quando houver (MC10); sem ele, o tom da casa. */
export function blocoDeVoz(perfil?: string | null): string {
  const p = (perfil ?? '').trim();
  if (!p) return TOM_DA_CASA;
  return `Voz de quem apresenta (perfil do autor):\n${p.slice(0, TETO_DO_PERFIL)}`;
}
