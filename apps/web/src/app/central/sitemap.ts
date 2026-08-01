import type { MetadataRoute } from "next";
import { materiaisAtivos, trilhas } from "@/central/data";
import { rotas } from "@/central/lib/rotas";

const URL_BASE = process.env.NEXT_PUBLIC_URL_BASE ?? "https://os.operacaoroot.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const fixas: MetadataRoute.Sitemap = [
    rotas.inicio,
    rotas.materiais,
    rotas.trilhas,
    rotas.sobre,
  ].map((p) => ({
    url: `${URL_BASE}${p}`,
    changeFrequency: "weekly",
    priority: p === rotas.inicio ? 1 : 0.8,
  }));

  const materiais: MetadataRoute.Sitemap = materiaisAtivos().map((m) => ({
    url: `${URL_BASE}${rotas.material(m.slug)}`,
    lastModified: m.verificadoEm ?? m.publicadoEm,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const paginasTrilhas: MetadataRoute.Sitemap = trilhas.map((t) => ({
    url: `${URL_BASE}${rotas.trilha(t.slug)}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...fixas, ...materiais, ...paginasTrilhas];
}
