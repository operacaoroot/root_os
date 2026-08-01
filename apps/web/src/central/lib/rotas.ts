/**
 * A Central mora sob um prefixo dentro do painel, não na raiz do domínio.
 * Todo link interno passa por aqui: mover a superfície pra um domínio próprio
 * (como a bio fez) é trocar BASE por "" e reescrever o host no middleware.
 */
export const BASE = "/central";

export const rotas = {
  inicio: BASE,
  materiais: `${BASE}/materiais`,
  material: (slug: string) => `${BASE}/materiais/${slug}`,
  busca: (termo: string) => `${BASE}/materiais?busca=${encodeURIComponent(termo)}`,
  trilhas: `${BASE}/trilhas`,
  trilha: (slug: string) => `${BASE}/trilhas/${slug}`,
  favoritos: `${BASE}/favoritos`,
  sobre: `${BASE}/sobre`,
  resgate: (codigo: string) => `${BASE}/r/${codigo}`,
};
