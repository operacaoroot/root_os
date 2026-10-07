import { createHash } from 'node:crypto';
import {
  LEAD_CAMPOS_DA_ENTRADA,
  type LeadCampoDaEntrada,
  type LeadDiferencaDaEntrada,
  type LeadEntradaInput,
  type LeadOrigem,
} from '@mktos/shared';

/*
 * A PARTE PURA DA ENTRADA DE LEAD (ROOT-48, C-01): identidade, hash do pedido e
 * diferença. Sem banco e sem Nest, para a suíte medir sem subir nada.
 */

/** UUID determinístico, a mesma construção de `idNativo` (`prisma/import-clickup-work.contract.ts`). */
function uuidDe(partes: string[]): string {
  const bytes = createHash('sha256').update(partes.join('\0')).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** O id do lead é a origem: a chave primária é o que impede a duplicata, sem migration. */
export function leadIdDaEntrada(orgId: string, origem: LeadOrigem): string {
  return uuidDe([orgId, 'lead', origem.tipo, origem.ref]);
}

/** O id do evento de entrada é o conteúdo do pedido: o mesmo pedido cai no mesmo id, um conteúdo novo ganha evento novo. */
export function eventoIdDaEntrada(orgId: string, leadId: string, requestHash: string): string {
  return uuidDe([orgId, 'lead-evento-entrada', leadId, requestHash]);
}

function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`)
    .join(',')}}`;
}

/** Hash do pedido já validado (o schema apara e baixa o e-mail): a ordem das chaves não muda o resultado. */
export function hashDoPedido(input: LeadEntradaInput): string {
  return createHash('sha256').update(canonico(input)).digest('hex');
}

/** O nome do lead quando o pedido não traz (origem da Pauta ou do pixel). */
export function nomeDeReserva(input: LeadEntradaInput, comentario: { usuario: string | null; palavra: string } | null): string {
  if (input.nome) return input.nome;
  if (input.origem.tipo === 'pauta-comentario' && comentario) {
    if (input.incluirUsuario && comentario.usuario) return `@${comentario.usuario.replace(/^@/, '')}`;
    return `Comentário com a palavra ${comentario.palavra}`;
  }
  return 'Visitante do site';
}

export type CamposDoLead = Record<LeadCampoDaEntrada, string | null>;

/** Só o que o pedido TRAZ: campo ausente não é diferença, e o lead nunca perde dado por um pedido mais pobre. */
export type CamposRecebidos = Partial<Record<LeadCampoDaEntrada, string>>;

export function camposRecebidos(
  input: LeadEntradaInput,
  resolvidos: { nome: string; campaignId?: string; sourceId?: string; ownerId?: string },
): CamposRecebidos {
  const bruto: Record<LeadCampoDaEntrada, string | undefined> = {
    name: resolvidos.nome,
    email: input.email,
    phone: input.telefone,
    campaignId: resolvidos.campaignId,
    sourceId: resolvidos.sourceId,
    ownerId: resolvidos.ownerId,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    utmContent: input.utmContent,
    utmTerm: input.utmTerm,
    landingPage: input.landingPage,
  };
  const saida: CamposRecebidos = {};
  for (const campo of LEAD_CAMPOS_DA_ENTRADA) if (bruto[campo] !== undefined) saida[campo] = bruto[campo];
  return saida;
}

/** O que chegou e é diferente do que o lead guarda. Vazio = o mesmo conteúdo (ou um pedido mais pobre). */
export function diferencaDaEntrada(atual: CamposDoLead, recebido: CamposRecebidos): LeadDiferencaDaEntrada {
  const dif: LeadDiferencaDaEntrada = {};
  for (const campo of LEAD_CAMPOS_DA_ENTRADA) {
    const novo = recebido[campo];
    if (novo !== undefined && novo !== atual[campo]) dif[campo] = { atual: atual[campo], recebido: novo };
  }
  return dif;
}
