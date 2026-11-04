/** Um contrato só aparece se a ficha e toda a cadeia apontam para o mesmo lead e cliente. */
type NoContrato = { id: string; leadId: string; partnerId: string | null; paiId: string | null;
  documentoId?: string | null; minutaId?: string | null;
  documento?: {orgId:string; leadId:string} | null; minuta?: {orgId:string; leadId:string} | null; orgId?: string };
export function contratosCoerentes(rows: readonly NoContrato[], fichas: ReadonlyMap<string, string | null>): string[] {
  const nos = new Map(rows.map(r => [r.id, r]));
  const calculados = new Map<string, boolean>();
  return rows.filter(inicio => {
    const caminho: NoContrato[] = [];
    const vistos = new Set<string>();
    let no: NoContrato | undefined = inicio;
    let valido = false;
    while (no) {
      if (!inicio.partnerId || fichas.get(inicio.leadId) !== inicio.partnerId ||
          vistos.has(no.id) || no.leadId !== inicio.leadId || no.partnerId !== inicio.partnerId) break;
      if (calculados.has(no.id)) { valido = calculados.get(no.id)!; break; }
      if ((no.documentoId && (!no.documento || no.documento.leadId !== no.leadId || no.documento.orgId !== no.orgId)) ||
          (no.minutaId && (!no.minuta || no.minuta.leadId !== no.leadId || no.minuta.orgId !== no.orgId))) break;
      vistos.add(no.id);
      caminho.push(no);
      if (!no.paiId) { valido = true; break; }
      no = nos.get(no.paiId);
    }
    for (const item of caminho) calculados.set(item.id, valido);
    return valido;
  }).map(r => r.id);
}
