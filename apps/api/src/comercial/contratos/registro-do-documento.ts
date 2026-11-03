import type { PrismaService } from '../../prisma/prisma.service';
import type { AssinaturaNoWebhook, PapelDoSignatario } from '../portas/assinatura.port';
import { assinaturasDoCartao, casarAssinaturas, estadoDepoisDaAssinatura, estadoDoDocumento, idDoContratoDoDocumento } from './contratos-puro';

/*
 * O REGISTRO DO CONTRATO A PARTIR DO DOCUMENTO (módulo de contratos, 02/11/2026).
 *
 * Os caminhos que já existiam (o efeito de `comercial.contrato.enviar`, o PDF do
 * fechado fora e o webhook da ZapSign) passam a manter o `ComercialContrato`
 * junto. São funções soltas, sem Nest, de propósito: `DinheiroService` e
 * `FechamentoService` chamam daqui sem ganhar dependência nova, e o que eles
 * sempre fizeram continua acontecendo na mesma ordem.
 *
 * IDEMPOTENTE: o id é derivado do documento (a mesma conta do backfill) e
 * `documentoId` é único. Rodar de novo cai na mesma linha.
 */

export interface SignatarioDoDocumento {
  papel: PapelDoSignatario;
  nome: string;
  email: string;
  ordem: number;
  token: string | null;
}

type Banco = Pick<PrismaService, 'comercialContrato' | 'comercialContratoSignatario' | 'comercialDocumento' | 'comercialFicha' | 'leadEvent'>;

async function clienteAtivo(prisma: Banco, leadId: string): Promise<boolean> {
  return !!(await prisma.leadEvent.findFirst({ where: { leadId, type: 'cliente.ativo' }, select: { id: true } }));
}

/**
 * O contrato deste documento: o que já aponta para ele, ou o `contratoId` pedido (F2), ou o registro
 * vivo do lead ainda sem documento, ou um novo. Devolve o id, ou nulo se o documento não é desta empresa.
 */
export async function garantirContratoDoDocumento(
  prisma: Banco,
  entrada: { orgId: string; leadId: string; documentoId: string; contratoId?: string | null; signatarios?: readonly SignatarioDoDocumento[] },
): Promise<string | null> {
  const { orgId, leadId, documentoId } = entrada;
  const doc = await prisma.comercialDocumento.findFirst({ where: { id: documentoId, orgId, leadId }, select: { estado: true, hashConteudo: true, criadoEm: true } });
  if (!doc) return null;
  const ativo = await clienteAtivo(prisma, leadId);
  const estado = estadoDoDocumento(doc.estado, ativo);

  let id = (await prisma.comercialContrato.findUnique({ where: { documentoId }, select: { id: true } }))?.id ?? null;
  if (!id) {
    const aberto = await prisma.comercialContrato.findFirst({
      // Com `contratoId` (F2) o registro pedido pode ser aditivo ou distrato; sem ele, só o contrato do lead ainda aberto e sem minuta: o que tem minuta é de quem o está emitindo.
      where: { orgId, leadId, documentoId: null, ...(entrada.contratoId ? { id: entrada.contratoId } : { tipo: 'contrato', minutaId: null, estado: { in: ['a_emitir', 'rascunho'] } }) },
      orderBy: { criadoEm: 'desc' },
      select: { id: true },
    });
    if (aberto) {
      await prisma.comercialContrato.updateMany({ where: { id: aberto.id, documentoId: null }, data: { documentoId, hashDoConteudo: doc.hashConteudo, estado } });
      id = aberto.id;
    }
  }
  if (!id) {
    id = idDoContratoDoDocumento(documentoId);
    const ficha = await prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { partnerId: true, valorCentavos: true, valorNegociadoCentavos: true } });
    await prisma.comercialContrato.createMany({
      data: [{ id, leadId, partnerId: ficha?.partnerId ?? null, tipo: 'contrato', estado, valorCentavos: ficha?.valorNegociadoCentavos ?? ficha?.valorCentavos ?? null, hashDoConteudo: doc.hashConteudo, documentoId, criadoEm: doc.criadoEm }],
      skipDuplicates: true,
    });
  }

  const vindos = entrada.signatarios;
  if (vindos?.length) {
    const gravados = await prisma.comercialContratoSignatario.findMany({ where: { contratoId: id }, orderBy: { ordem: 'asc' }, select: { id: true, ordem: true } });
    if (!gravados.length) {
      await prisma.comercialContratoSignatario.createMany({
        data: vindos.map((s) => ({ contratoId: id!, ordem: s.ordem, papel: s.papel, nome: s.nome, email: s.email, tokenNoProvedor: s.token })),
        skipDuplicates: true,
      });
    } else {
      // Os escolhidos na tela (F2) ficam; só ganham o token que o provedor devolveu.
      for (const s of vindos) {
        const g = gravados.find((x) => x.ordem === s.ordem);
        if (g && s.token) await prisma.comercialContratoSignatario.updateMany({ where: { id: g.id }, data: { tokenNoProvedor: s.token } });
      }
    }
  }
  return id;
}

export interface ReflexoDaAssinatura {
  contratoId: string | null;
  estado: string | null;
  feitas: number;
  total: number;
  mudou: boolean;
}

/**
 * Reflete no registro o que o provedor disse (webhook ou consulta): data em cada signatário e o estado.
 * Documento sem registro (criado antes da migration e fora do backfill, ou anexado) ganha um aqui.
 */
export async function refletirAssinaturas(
  prisma: Banco,
  entrada: { orgId: string; leadId: string; documentoId: string; assinatura: Pick<AssinaturaNoWebhook, 'todosAssinaram' | 'assinados' | 'assinaturas'>; agora?: Date },
): Promise<ReflexoDaAssinatura> {
  const { orgId, leadId, documentoId, assinatura } = entrada;
  const agora = entrada.agora ?? new Date();
  const id = await garantirContratoDoDocumento(prisma, { orgId, leadId, documentoId });
  if (!id) return { contratoId: null, estado: null, feitas: 0, total: 0, mudou: false };
  const contrato = await prisma.comercialContrato.findUniqueOrThrow({ where: { id }, include: { signatarios: true } });
  const novas = casarAssinaturas(contrato.signatarios, assinatura, agora);
  for (const n of novas) {
    await prisma.comercialContratoSignatario.updateMany({ where: { id: n.id, assinadoEm: null }, data: { assinadoEm: n.em } });
  }
  const estado = estadoDepoisDaAssinatura(contrato.estado, assinatura.todosAssinaram, await clienteAtivo(prisma, leadId));
  if (estado !== contrato.estado) {
    await prisma.comercialContrato.updateMany({ where: { id, estado: contrato.estado }, data: { estado } });
  }
  const assinados = contrato.signatarios.map((s) => ({ assinadoEm: s.assinadoEm ?? novas.find((n) => n.id === s.id)?.em ?? null }));
  const doc = assinados.length ? null : await prisma.comercialDocumento.findFirst({ where: { id: documentoId, orgId }, select: { assinadoClienteEm: true, assinadoRootEm: true } });
  const conta = assinaturasDoCartao(assinados, doc) ?? { feitas: 0, total: 0 };
  return { contratoId: id, estado, ...conta, mudou: novas.length > 0 || estado !== contrato.estado };
}
