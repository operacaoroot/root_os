import type { Categoria, Material, Trilha } from "@/central/types";
import { categoriaSchema, materialSchema, trilhaSchema } from "@/central/lib/schemas";
import { normalizar } from "@/central/lib/busca";
import { ativo } from "@/central/lib/frescor";
import { categorias as categoriasBrutas } from "./categorias";
import { trilhas as trilhasBrutas } from "./trilhas";
import { materiaisComecando } from "./materiais/comecando";
import { materiaisMemoriaAgentes } from "./materiais/memoria-agentes";
import { materiaisAutomacaoCusto } from "./materiais/automacao-custo";
import { materiaisCriacaoFormacao } from "./materiais/criacao-formacao";

const materiaisBrutos: Material[] = [
  ...materiaisComecando,
  ...materiaisMemoriaAgentes,
  ...materiaisAutomacaoCusto,
  ...materiaisCriacaoFormacao,
];

/* ------------------------------------------------------------------
   Validação no import — dado inválido derruba o build, não a produção.
   ------------------------------------------------------------------ */

function validar(): { materiais: Material[]; categorias: Categoria[]; trilhas: Trilha[] } {
  const erros: string[] = [];

  for (const c of categoriasBrutas) {
    const r = categoriaSchema.safeParse(c);
    if (!r.success) erros.push(`categoria ${c.id}: ${r.error.issues[0]?.message}`);
  }
  for (const m of materiaisBrutos) {
    const r = materialSchema.safeParse(m);
    if (!r.success) {
      const i = r.error.issues[0];
      erros.push(`material ${m.id} (${m.slug}): ${i?.path.join(".")} — ${i?.message}`);
    }
  }
  for (const t of trilhasBrutas) {
    const r = trilhaSchema.safeParse(t);
    if (!r.success) erros.push(`trilha ${t.id}: ${r.error.issues[0]?.message}`);
  }

  // codigo ÚNICO — a correção do defeito nº 1 da referência
  const codigos = new Map<string, string>();
  for (const m of materiaisBrutos) {
    const chave = normalizar(m.codigo);
    const dono = codigos.get(chave);
    if (dono) erros.push(`codigo duplicado "${m.codigo}" em ${dono} e ${m.slug}`);
    codigos.set(chave, m.slug);
  }

  // slugs e ids únicos
  const slugs = new Set<string>();
  const ids = new Set<string>();
  for (const m of materiaisBrutos) {
    if (slugs.has(m.slug)) erros.push(`slug duplicado: ${m.slug}`);
    if (ids.has(m.id)) erros.push(`id duplicado: ${m.id}`);
    slugs.add(m.slug);
    ids.add(m.id);
  }

  // referências íntegras
  const idsCategorias = new Set(categoriasBrutas.map((c) => c.id));
  for (const m of materiaisBrutos) {
    if (!idsCategorias.has(m.categoriaId))
      erros.push(`material ${m.slug}: categoria inexistente ${m.categoriaId}`);
    for (const rel of m.relacionados ?? [])
      if (!ids.has(rel)) erros.push(`material ${m.slug}: relacionado inexistente ${rel}`);
  }
  for (const t of trilhasBrutas)
    for (const item of t.itens)
      if (!ids.has(item.materialId))
        erros.push(`trilha ${t.slug}: material inexistente ${item.materialId}`);

  if (erros.length > 0) {
    throw new Error(`Dados inválidos na Root Central:\n- ${erros.join("\n- ")}`);
  }

  return { materiais: materiaisBrutos, categorias: categoriasBrutas, trilhas: trilhasBrutas };
}

const dados = validar();

/* ------------------------------------------------------------------
   API de leitura
   ------------------------------------------------------------------ */

export const categorias = dados.categorias.slice().sort((a, b) => a.ordem - b.ordem);
export const trilhas = dados.trilhas;

/** Catálogo completo (inclui agendados) — uso interno/build. */
export const todosMateriais = dados.materiais;

/** Catálogo visível: respeita `ativoEm`, mais recente primeiro. */
export function materiaisAtivos(agora?: Date): Material[] {
  return todosMateriais
    .filter((m) => ativo(m, agora))
    .sort((a, b) => new Date(b.publicadoEm).getTime() - new Date(a.publicadoEm).getTime());
}

export function materialPorSlug(slug: string): Material | undefined {
  return todosMateriais.find((m) => m.slug === slug);
}

export function materialPorCodigo(codigo: string): Material | undefined {
  const alvo = normalizar(codigo);
  return todosMateriais.find((m) => normalizar(m.codigo) === alvo);
}

export function materialPorId(id: string): Material | undefined {
  return todosMateriais.find((m) => m.id === id);
}

export function categoriaPorId(id: string): Categoria | undefined {
  return categorias.find((c) => c.id === id);
}

export function trilhaPorSlug(slug: string): Trilha | undefined {
  return trilhas.find((t) => t.slug === slug);
}

/** Relacionados: os declarados primeiro, completados por categoria/tags. */
export function relacionadosDe(m: Material, max = 3): Material[] {
  const escolhidos: Material[] = [];
  for (const id of m.relacionados ?? []) {
    const r = materialPorId(id);
    if (r && ativo(r)) escolhidos.push(r);
  }
  if (escolhidos.length < max) {
    const tags = new Set(m.tags);
    const extras = materiaisAtivos()
      .filter(
        (x) =>
          x.id !== m.id &&
          !escolhidos.some((e) => e.id === x.id) &&
          (x.categoriaId === m.categoriaId || x.tags.some((t) => tags.has(t))),
      )
      .slice(0, max - escolhidos.length);
    escolhidos.push(...extras);
  }
  return escolhidos.slice(0, max);
}

export function ferramentasDisponiveis(): string[] {
  const set = new Set<string>();
  for (const m of todosMateriais) for (const f of m.ferramentas) set.add(f);
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
