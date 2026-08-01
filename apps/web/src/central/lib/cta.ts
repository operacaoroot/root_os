import type { TipoMaterial } from "@/central/types";

/** CTA orientado à ação — nada de "Resgatar material" genérico. */
export const ctaPorTipo: Record<TipoMaterial, string> = {
  tutorial: "Ver o passo a passo",
  prompt: "Copiar o prompt",
  repositorio: "Abrir o repositório",
  curso: "Fazer o curso",
  template: "Baixar o template",
  automacao: "Montar a automação",
  skill: "Instalar a skill",
  mcp: "Conectar o MCP",
  ferramenta: "Conhecer a ferramenta",
  checklist: "Ver o checklist",
  "estudo-de-caso": "Ler o caso",
};

export const rotuloTipo: Record<TipoMaterial, string> = {
  tutorial: "Tutorial",
  prompt: "Prompt",
  repositorio: "Repositório",
  curso: "Curso",
  template: "Template",
  automacao: "Automação",
  skill: "Skill",
  mcp: "MCP",
  ferramenta: "Ferramenta",
  checklist: "Checklist",
  "estudo-de-caso": "Estudo de caso",
};

export const rotuloNivel = {
  iniciante: "Iniciante",
  intermediario: "Intermediário",
  avancado: "Avançado",
} as const;

export const rotuloCusto = {
  gratuito: "Grátis",
  freemium: "Freemium",
  pago: "Pago",
} as const;
