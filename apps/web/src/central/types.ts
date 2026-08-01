/* Modelo de conteúdo da Root Central — ver docs/content-model.md */

export type Nivel = "iniciante" | "intermediario" | "avancado";
export type Custo = "gratuito" | "freemium" | "pago";
export type Situacao = "verificado" | "atualizado" | "requer-revisao" | "descontinuado";

export type TipoMaterial =
  | "tutorial"
  | "prompt"
  | "repositorio"
  | "curso"
  | "template"
  | "automacao"
  | "skill"
  | "mcp"
  | "ferramenta"
  | "checklist"
  | "estudo-de-caso";

/** Blocos de conteúdo — as primitivas com que todo material é montado. */
export type Bloco =
  | { tipo: "passo"; n: number; titulo: string; sub?: string; blocos: Bloco[] }
  | { tipo: "texto"; conteudo: string }
  | {
      tipo: "callout";
      variante: "info" | "nota" | "atencao" | "risco";
      titulo?: string;
      conteudo: string;
    }
  | { tipo: "link"; label: string; selo?: string; href: string }
  | { tipo: "prompt"; rotulo: string; conteudo: string }
  | { tipo: "comando"; linguagem: string; conteudo: string; aviso?: string }
  | { tipo: "lista"; estilo: "letras" | "numeros" | "marcadores"; itens: string[] }
  | {
      tipo: "requisitos";
      itens: { texto: string; obrigatorio: boolean; href?: string; nota?: string }[];
    }
  | { tipo: "exemplo"; contexto: string; prompt: string; resultado: string }
  | { tipo: "dialogo"; linhas: [quem: string, texto: string][] };

export interface Material {
  id: string;
  slug: string;
  /** Código de resgate — ÚNICO no catálogo. O que a pessoa comenta no reel. */
  codigo: string;
  /** Termos de descoberta — podem repetir entre materiais. */
  aliases: string[];

  card: string;
  tagline: string;
  titulo: string;
  resumo: string;

  capa?: string;
  capaAlt?: string;

  categoriaId: string;
  tipo: TipoMaterial;
  nivel: Nivel;
  custo: Custo;
  ferramentas: string[];
  plataformas: string[];
  tags: string[];
  /** Problemas que o material resolve, em linguagem de gente. Alimenta a busca. */
  resolve: string[];
  minutosEstimados?: number;
  prerequisitos?: string[];

  blocos: Bloco[];

  publicadoEm: string;
  ativoEm?: string;
  verificadoEm?: string;
  descontinuado?: boolean;
  destaque: boolean;

  origemUrl?: string;
  relacionados?: string[];
}

export interface Categoria {
  id: string;
  slug: string;
  nome: string;
  descricao: string;
  ordem: number;
}

export interface Trilha {
  id: string;
  slug: string;
  titulo: string;
  descricao: string;
  paraQuem: string;
  nivel: Nivel;
  itens: { materialId: string; nota?: string }[];
  prerequisitos?: string[];
}
