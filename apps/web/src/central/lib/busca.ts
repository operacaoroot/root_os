import type { Material } from "@/central/types";

/** Normaliza pra comparação: minúsculas, sem acento, sem aspas, aparada. */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/["'“”‘’]/g, "")
    .trim();
}

/** Reduz plural simples ("skills" → "skill"). */
export function singular(s: string): string {
  return normalizar(s).replace(/s$/, "");
}

function igual(a: string, b: string): boolean {
  return normalizar(a) === normalizar(b) || singular(a) === singular(b);
}

/** Distância de edição limitada a 1 — tolera um erro de digitação em termos ≥5 letras. */
export function quaseIgual(a: string, b: string): boolean {
  const x = normalizar(a);
  const y = normalizar(b);
  if (x === y) return true;
  if (x.length < 5 || Math.abs(x.length - y.length) > 1) return false;
  // um caractere trocado
  if (x.length === y.length) {
    let dif = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) dif++;
    return dif === 1;
  }
  // um caractere inserido/removido
  const [curto, longo] = x.length < y.length ? [x, y] : [y, x];
  let i = 0;
  let j = 0;
  let pulos = 0;
  while (i < curto.length && j < longo.length) {
    if (curto[i] === longo[j]) {
      i++;
      j++;
    } else {
      pulos++;
      if (pulos > 1) return false;
      j++;
    }
  }
  return true;
}

export type ResultadoBusca = {
  /** "codigo" = acerto exato de resgate (abrir direto); "termo"/"texto" = lista. */
  camada: "codigo" | "termo" | "texto" | "nenhuma";
  materiais: Material[];
};

function textoIndexavel(m: Material): string {
  const blocos = JSON.stringify(m.blocos);
  return normalizar(
    [m.card, m.tagline, m.titulo, m.resumo, ...m.resolve, ...m.tags, ...m.ferramentas, blocos].join(
      " ",
    ),
  );
}

/**
 * Busca em 3 camadas:
 * 1. codigo exato (resgate do reel) → um único material;
 * 2. aliases/tags/ferramentas/categoria → lista;
 * 3. texto (título, resumo, problemas que resolve, conteúdo) → lista parcial.
 */
export function buscar(termo: string, materiais: Material[]): ResultadoBusca {
  const t = normalizar(termo);
  if (!t) return { camada: "nenhuma", materiais: [] };

  // 1 — código de resgate (único por construção; tolera 1 erro de digitação)
  const porCodigo = materiais.filter((m) => igual(m.codigo, t) || quaseIgual(m.codigo, t));
  if (porCodigo.length > 0) return { camada: "codigo", materiais: porCodigo };

  // 2 — vocabulário declarado
  const porTermo = materiais.filter((m) =>
    [...m.aliases, ...m.tags, ...m.ferramentas].some((a) => igual(a, t) || quaseIgual(a, t)),
  );
  if (porTermo.length > 0) return { camada: "termo", materiais: porTermo };

  // 3 — texto corrido (todas as palavras do termo precisam aparecer)
  const palavras = t.split(/\s+/).filter((p) => p.length > 1);
  if (palavras.length === 0) return { camada: "nenhuma", materiais: [] };
  const porTexto = materiais.filter((m) => {
    const idx = textoIndexavel(m);
    return palavras.every((p) => idx.includes(p) || idx.includes(singular(p)));
  });
  if (porTexto.length > 0) return { camada: "texto", materiais: porTexto };

  return { camada: "nenhuma", materiais: [] };
}

/** Sugestões pra estado sem resultado: códigos e termos mais próximos. */
export function sugestoes(termo: string, materiais: Material[], max = 4): string[] {
  const t = normalizar(termo);
  const candidatos = new Set<string>();
  for (const m of materiais) {
    for (const c of [m.codigo, ...m.aliases]) {
      const n = normalizar(c);
      if (n.startsWith(t.slice(0, 2)) || quaseIgual(c, t)) candidatos.add(c.toLowerCase());
      if (candidatos.size >= max * 3) break;
    }
  }
  return [...candidatos].slice(0, max);
}
