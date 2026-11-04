type Contrato = { orgId:string; partnerId:string|null; tipo:string; comercialContratoId:string|null };
type Registro = { orgId:string; partnerId:string|null; contractId:string|null };
export function financeiroCoerente(r:Registro, contratos:ReadonlyMap<string,Contrato>, comerciais:ReadonlyMap<string,string|null>):boolean {
  if (!r.partnerId || !r.contractId) return false;
  const contrato = contratos.get(r.contractId);
  if (!contrato || contrato.orgId !== r.orgId || contrato.tipo !== 'entrada' || contrato.partnerId !== r.partnerId) return false;
  return !contrato.comercialContratoId || comerciais.get(contrato.comercialContratoId) === r.partnerId;
}
export function parcelaCoerente(orgId:string, clienteId:string, recebimentoId:string|null, recebimento:{orgId:string;partnerId:string|null;type:string}|null, acordoComercialId?:string|null, recebimentoComercialId?:string|null):boolean {
  return !recebimentoId || !!recebimento && recebimento.orgId===orgId && recebimento.partnerId===clienteId && recebimento.type==='entrada' && (!acordoComercialId || acordoComercialId===recebimentoComercialId);
}
