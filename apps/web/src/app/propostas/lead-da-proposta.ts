import type { PainelComercialNegocio } from '@mktos/shared';

/*
 * O LEAD DA PROPOSTA (rodada de produção 3, I5, 22/10/2026): a parte sem tela.
 * Fica fora do page.tsx porque página do App Router não exporta nada além do componente.
 */

/** Sem acento, minúsculo, só letras e números separados por espaço. */
export const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Os leads da busca do "Vincular": empresa, contato ou telefone/e-mail contendo o texto, sem acento; em ordem de empresa. */
export function leadsDaBusca(negocios: readonly PainelComercialNegocio[], texto: string, limite = 8): PainelComercialNegocio[] {
  const q = semAcento(texto);
  const todos = q ? negocios.filter((n) => [n.titulo, n.nome, n.contato ?? ''].some((x) => semAcento(x).includes(q))) : [...negocios];
  return todos.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR')).slice(0, limite);
}
