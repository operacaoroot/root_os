/*
 * O NOME NO CARD DO LEAD (layout 26/10/2026, P-22): a empresa é o título e o
 * representante fica embaixo, como em qualquer CRM. Quando a ficha já tem a
 * empresa, ela manda. Quando não tem, mas o lead foi salvo como
 * "Empresa | Pessoa" (o jeito antigo), a tela separa as duas partes. Nada é
 * regravado: é só como o nome aparece.
 */
export function partesDoLead(nome: string, empresa?: string | null): { titulo: string; pessoa: string | null } {
  const n = (nome ?? '').trim();
  const e = (empresa ?? '').trim();
  if (e && e.toLowerCase() !== n.toLowerCase()) return { titulo: e, pessoa: n || null };
  const i = n.indexOf(' | ');
  if (i > 0) return { titulo: n.slice(0, i).trim(), pessoa: n.slice(i + 3).trim() || null };
  return { titulo: e || n, pessoa: null };
}
