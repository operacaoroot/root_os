import { z } from "zod";

/* Validação dos dados no build — dado inválido derruba o build, não a produção. */

const nivelSchema = z.enum(["iniciante", "intermediario", "avancado"]);
const custoSchema = z.enum(["gratuito", "freemium", "pago"]);
const tipoSchema = z.enum([
  "tutorial",
  "prompt",
  "repositorio",
  "curso",
  "template",
  "automacao",
  "skill",
  "mcp",
  "ferramenta",
  "checklist",
  "estudo-de-caso",
]);

const blocoSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion("tipo", [
    z.object({
      tipo: z.literal("passo"),
      n: z.number().int().positive(),
      titulo: z.string().min(1),
      sub: z.string().optional(),
      blocos: z.array(blocoSchema),
    }),
    z.object({ tipo: z.literal("texto"), conteudo: z.string().min(1) }),
    z.object({
      tipo: z.literal("callout"),
      variante: z.enum(["info", "nota", "atencao", "risco"]),
      titulo: z.string().optional(),
      conteudo: z.string().min(1),
    }),
    z.object({
      tipo: z.literal("link"),
      label: z.string().min(1),
      selo: z.string().optional(),
      href: z.string().min(4),
    }),
    z.object({
      tipo: z.literal("prompt"),
      rotulo: z.string().min(1),
      conteudo: z.string().min(1),
    }),
    z.object({
      tipo: z.literal("comando"),
      linguagem: z.string().min(1),
      conteudo: z.string().min(1),
      aviso: z.string().optional(),
    }),
    z.object({
      tipo: z.literal("lista"),
      estilo: z.enum(["letras", "numeros", "marcadores"]),
      itens: z.array(z.string().min(1)).min(1),
    }),
    z.object({
      tipo: z.literal("requisitos"),
      itens: z
        .array(
          z.object({
            texto: z.string().min(1),
            obrigatorio: z.boolean(),
            href: z.string().optional(),
            nota: z.string().optional(),
          }),
        )
        .min(1),
    }),
    z.object({
      tipo: z.literal("exemplo"),
      contexto: z.string().min(1),
      prompt: z.string().min(1),
      resultado: z.string().min(1),
    }),
    z.object({
      tipo: z.literal("dialogo"),
      linhas: z.array(z.tuple([z.string(), z.string()])).min(1),
    }),
  ]),
);

export const materialSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug em kebab-case"),
  codigo: z.string().regex(/^[A-Z0-9]+$/, "codigo em CAIXA ALTA sem espaço"),
  aliases: z.array(z.string().min(1)),
  card: z.string().min(4).max(80),
  tagline: z.string().min(10).max(220),
  titulo: z.string().min(4),
  resumo: z.string().min(20).max(400),
  capa: z.string().optional(),
  capaAlt: z.string().optional(),
  categoriaId: z.string().min(1),
  tipo: tipoSchema,
  nivel: nivelSchema,
  custo: custoSchema,
  ferramentas: z.array(z.string()),
  plataformas: z.array(z.string()),
  tags: z.array(z.string()),
  resolve: z.array(z.string()).min(1),
  minutosEstimados: z.number().int().positive().optional(),
  prerequisitos: z.array(z.string()).optional(),
  blocos: z.array(blocoSchema).min(1),
  publicadoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  ativoEm: z.string().optional(),
  verificadoEm: z.string().optional(),
  descontinuado: z.boolean().optional(),
  destaque: z.boolean(),
  origemUrl: z.string().url().optional(),
  relacionados: z.array(z.string()).optional(),
});

export const categoriaSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  nome: z.string().min(1),
  descricao: z.string().min(1),
  ordem: z.number().int(),
});

export const trilhaSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  titulo: z.string().min(1),
  descricao: z.string().min(1),
  paraQuem: z.string().min(1),
  nivel: nivelSchema,
  itens: z.array(z.object({ materialId: z.string(), nota: z.string().optional() })).min(2),
  prerequisitos: z.array(z.string()).optional(),
});
