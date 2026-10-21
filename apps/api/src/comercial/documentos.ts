/*
 * OS DOIS TIPOS DE `ComercialDocumento` (rodada dos agentes, 21/10/2026, CO-13).
 *
 * Até esta rodada, todo documento do lead era de ASSINATURA: o contrato que foi à
 * ZapSign (provedor `zapsign`) ou o PDF assinado fora e anexado (provedor
 * `anexo`). A minuta que o construtor do contrato da Root redige (CO-13) também
 * é um `ComercialDocumento`, de provedor `minuta` e estado `rascunho`, com o
 * texto em `conteudo` e o laudo do revisor (CO-14) em `laudo`.
 *
 * QUEM LÊ DOCUMENTO DE ASSINATURA FILTRA A MINUTA, sempre por aqui: a sala do
 * cliente (o rascunho nunca chega ao cliente), o link de assinatura da Root, a
 * prontidão do fechamento e o "ligado a" da ficha. A minuta não tem hash de
 * contrato aceito nem link de assinatura: misturá-la mudaria a frase do que
 * falta e, no link da Root, entregaria o documento errado.
 */

export const PROVEDOR_DA_MINUTA = 'minuta';

/** O filtro do Prisma que deixa só os documentos de assinatura. */
export const SO_DOCUMENTOS_DE_ASSINATURA = { provedor: { not: PROVEDOR_DA_MINUTA } } as const;
