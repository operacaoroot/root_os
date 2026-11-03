import { alcadaDe, atendeAlcada, temPapelDeMaquina } from '../../approvals/alcada';
import { lerAprovador } from '../../auth/aprovador';
import type { PrismaService } from '../../prisma/prisma.service';
import { gerarPdfDoContrato, type PdfGerado } from '../contrato-da-root/pdf-do-contrato';
import { camposEscritos, pedidoDoPdf, textoDaProposta, type AceiteParaEmissao, type CamposEscritos, type EntradaDoPreenchimento, type PaiDoFilho } from './emissao-puro';

/*
 * O DOCUMENTO DE UM REGISTRO (Contratos, F2, 02/11/2026). Funções soltas, sem Nest, como `registro-do-documento.ts`:
 * a prévia, o pedido de envio e o EFEITO (`DinheiroService`) montam o PDF por aqui, e por isso os três dão os mesmos
 * bytes. O PDF sai sempre do que está gravado AGORA. Nada aqui lê o congelado: é o que faz a conferência do hash
 * valer. Mudou a minuta, um signatário, o CNPJ que fatura ou o aceite, o hash muda e nada sai.
 */

type Banco = Pick<PrismaService, 'comercialContrato' | 'comercialDocumento' | 'leadEvent' | 'user'>;
type Linha = NonNullable<Awaited<ReturnType<typeof lerRegistro>>>;

async function lerRegistro(prisma: Banco, orgId: string, contratoId: string) {
  return prisma.comercialContrato.findFirst({ where: { id: contratoId, orgId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } });
}

/** A entrada do preenchimento de um registro, com o que o aditivo e o distrato herdam do contrato pai. */
export async function entradaDoRegistro(prisma: Banco, orgId: string, c: Linha, aceite: AceiteParaEmissao | null): Promise<EntradaDoPreenchimento> {
  let pai: PaiDoFilho | undefined;
  let camposDoPai: CamposEscritos | undefined;
  if (c.paiId) {
    const p = await prisma.comercialContrato.findFirst({ where: { id: c.paiId, orgId }, select: { numero: true, modalidade: true, hashDoConteudo: true, dadosDoContrato: true, documentoId: true } });
    if (p) {
      const doc = p.documentoId ? await prisma.comercialDocumento.findFirst({ where: { id: p.documentoId, orgId }, select: { assinadoClienteEm: true, assinadoRootEm: true } }) : null;
      const datas = [doc?.assinadoClienteEm, doc?.assinadoRootEm].filter((d): d is Date => !!d).map((d) => d.getTime());
      pai = { numero: p.numero, modalidade: p.modalidade, hash: p.hashDoConteudo, assinadoEm: datas.length === 2 ? new Date(Math.max(...datas)) : null };
      camposDoPai = camposEscritos(p.dadosDoContrato);
    }
  }
  return {
    tipo: c.tipo as EntradaDoPreenchimento['tipo'],
    modalidade: c.modalidade,
    faturaPor: c.faturaPor,
    dados: c.dadosDoContrato,
    vigenciaFim: c.vigenciaFim,
    aceite,
    signatarios: c.signatarios,
    ...(pai ? { pai } : {}),
    ...(camposDoPai ? { camposDoPai } : {}),
  };
}

export interface DocumentoMontado {
  pdf: PdfGerado;
  avisos: string[];
  contrato: Linha;
}

export class SemMinutaError extends Error {
  constructor() {
    super('Este contrato ainda não tem minuta: gere a minuta primeiro.');
    this.name = 'SemMinutaError';
  }
}

/** O PDF do registro, de agora. Lança `PdfComLacunaError` (com a lista) ou `SemMinutaError`. */
export async function montarPdfDoRegistro(prisma: Banco, orgId: string, contratoId: string, aceite: AceiteParaEmissao | null): Promise<DocumentoMontado> {
  const c = await lerRegistro(prisma, orgId, contratoId);
  if (!c) throw new Error('Contrato não encontrado.');
  if (!c.minutaId) throw new SemMinutaError();
  const minuta = await prisma.comercialDocumento.findFirst({ where: { id: c.minutaId, orgId, leadId: c.leadId }, select: { conteudo: true } });
  if (!minuta?.conteudo) throw new SemMinutaError();

  const avisos: string[] = [];
  let anexo: string | null = null;
  if (c.tipo === 'contrato' && aceite) {
    const publicadas = await prisma.leadEvent.findMany({ where: { orgId, leadId: c.leadId, type: 'proposta.publicada' }, orderBy: { occurredAt: 'desc' }, select: { payload: true } });
    const daVersao = publicadas.find((p) => Number(((p.payload ?? {}) as { versao?: unknown }).versao) === aceite.versao);
    anexo = textoDaProposta(daVersao?.payload, aceite);
    if (!anexo) avisos.push('A proposta aceita não tem texto guardado no OS: o PDF sai sem o anexo.');
  }
  const pdf = gerarPdfDoContrato(pedidoDoPdf(minuta.conteudo, await entradaDoRegistro(prisma, orgId, c, aceite), anexo));
  return { pdf, avisos: [...avisos, ...pdf.avisos], contrato: c };
}

/** Quem está na lista como signatário da Root e não é, agora, gente ativa e titular desta empresa (D4). */
export async function rootsSemAlcada(prisma: Banco, orgId: string, signatarios: readonly { papel: string; email: string }[]): Promise<string[]> {
  const invalidos: string[] = [];
  for (const s of signatarios.filter((x) => x.papel === 'root')) {
    const u = await prisma.user.findFirst({ where: { orgId, isActive: true, email: { equals: s.email, mode: 'insensitive' } }, select: { id: true } });
    const doBanco = u ? await lerAprovador(prisma as PrismaService, u.id, orgId) : null;
    if (!doBanco?.ativo || temPapelDeMaquina(doBanco.papeis) || !atendeAlcada('titular', alcadaDe(doBanco.papeis))) invalidos.push(s.email);
  }
  return invalidos;
}
