import { FERRAMENTAS_GERADAS, TOOL_HASH } from '../ferramentas-geradas/index';

/** Ponte estável: o núcleo conhece esta interface, nunca pastas/slugs individuais. */
export type FerramentaGerada = (typeof FERRAMENTAS_GERADAS)[number];

export function ferramentaGerada(slug: string): FerramentaGerada | null {
  return FERRAMENTAS_GERADAS.find((ferramenta) => ferramenta.slug === slug) ?? null;
}

export function ferramentaAtivacao(slug: string): string | null {
  return ferramentaGerada(slug)?.activationKey ?? null;
}

export function ferramentasGeradas(): readonly FerramentaGerada[] {
  return FERRAMENTAS_GERADAS;
}

/** Identidade futura do artefato core + conjunto de ferramentas. */
export const FERRAMENTAS_TOOL_HASH = TOOL_HASH;
