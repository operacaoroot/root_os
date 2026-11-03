import { NotFoundException } from '@nestjs/common';
import {
  FATOS_DO_CONTRATO,
  type ContratoNaFicha,
  type ContratoNoQuadro,
  type DocumentoDoContrato,
  type EmissaoNaFicha,
  type LaudoDoContrato,
  type MinutaDaEmissao,
  type ModalidadeDeContrato,
  type EstadoDoContrato,
  type FatoDoContrato,
  type QuadroDeContratos,
  type TipoDeContrato,
} from '@mktos/shared';

import type { PrismaService } from '../../prisma/prisma.service';
import { alcadaDe, atendeAlcada, temPapelDeMaquina } from '../../approvals/alcada';
import { contarMarcas } from '../contrato-da-root/minuta';
import { moldeDoContrato } from '../contrato-da-root/moldes-do-contrato';
import { contratosImportados } from '../contrato-vivo.service';
import { CAP_CONTRATO, hojeEmSP } from '../dinheiro.service';
import { resumoDoEvento } from '../eventos';
import { rootsSemAlcada, entradaDoRegistro } from './documento-do-registro';
import { apontamentosGraves, assinaturaDaEntrada, camposEscritos, camposForaDoPdf, camposParaATela, preencherRegistro, type AceiteParaEmissao } from './emissao-puro';
import { aindaNaoEnviado, PREFIXO_DO_FANTASMA, PREFIXO_DO_IMPORTADO, cartaoDoFantasma, cartaoDoImportado, cartaoDoRegistro, faltaParaEnviar, lerIdDoContrato, montarQuadro, type InsumosDoQuadro, type LeadParaOQuadro, type RegistroParaOQuadro } from './contratos-puro';

/*
 * A LEITURA DO MÓDULO DE CONTRATOS (02/11/2026): o quadro e a ficha. Consultas em lote (sem N+1), e a
 * regra de cada cartão na parte pura. Os contratos importados são lidos do fio: não têm linha até
 * alguém agir neles.
 */

const CAMPOS_DO_REGISTRO = { signatarios: true } as const;

const dia = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

function lacunasDe(dados: unknown): number | null {
  const n = ((dados ?? {}) as { lacunas?: unknown }).lacunas;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

type LinhaDoContrato = Awaited<ReturnType<PrismaService['comercialContrato']['findFirstOrThrow']>> & { signatarios: { assinadoEm: Date | null }[] };

function paraOQuadro(r: LinhaDoContrato): RegistroParaOQuadro {
  return {
    id: r.id,
    leadId: r.leadId,
    tipo: r.tipo,
    estado: r.estado,
    modalidade: r.modalidade,
    numero: r.numero,
    valorCentavos: r.valorCentavos,
    vigenciaFim: dia(r.vigenciaFim),
    origemImportada: r.origemImportada,
    documentoId: r.documentoId,
    lacunas: lacunasDe(r.dadosDoContrato),
    signatarios: r.signatarios,
  };
}

/** Tudo o que o quadro lê. `soLead` restringe ao lead da ficha. */
async function carregarInsumos(prisma: PrismaService, orgId: string, opcoes: { assinaturaConfigurada: boolean; hoje: string; soLead?: string }): Promise<InsumosDoQuadro & { linhas: LinhaDoContrato[] }> {
  const filtroDoLead = opcoes.soLead ? { leadId: opcoes.soLead } : {};
  const [linhas, importadosFio, fichasDoFunil] = await Promise.all([
    prisma.comercialContrato.findMany({ where: { orgId, ...filtroDoLead }, include: CAMPOS_DO_REGISTRO }),
    prisma.leadEvent.findMany({ where: { orgId, type: 'contrato.importado', ...filtroDoLead }, select: { leadId: true, payload: true } }),
    prisma.comercialFicha.findMany({ where: { orgId, etapa: { in: ['contrato', 'fechado'] }, ...filtroDoLead }, select: { leadId: true } }),
  ]);
  const ids = [...new Set([...linhas.map((r) => r.leadId), ...importadosFio.map((e) => e.leadId), ...fichasDoFunil.map((f) => f.leadId), ...(opcoes.soLead ? [opcoes.soLead] : [])])];
  const leadsImportados = [...new Set(importadosFio.map((e) => e.leadId))];
  const [leads, fichas, documentos, fatos, doImportado] = await Promise.all([
    prisma.lead.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, owner: { select: { name: true } } } }),
    prisma.comercialFicha.findMany({ where: { orgId, leadId: { in: ids } }, select: { leadId: true, etapa: true, empresa: true, valorCentavos: true, valorNegociadoCentavos: true } }),
    prisma.comercialDocumento.findMany({ where: { orgId, leadId: { in: ids }, provedor: { not: 'minuta' } }, select: { id: true, leadId: true, pdfUrl: true, assinadoClienteEm: true, assinadoRootEm: true } }),
    prisma.leadEvent.findMany({ where: { orgId, leadId: { in: ids }, type: { in: ['contrato.concluido', 'contrato.desativado', 'contrato.reaberto'] } }, select: { leadId: true, type: true, payload: true, occurredAt: true } }),
    leadsImportados.length
      ? prisma.leadEvent.findMany({ where: { orgId, leadId: { in: leadsImportados }, type: { in: ['contrato.anexado'] } }, select: { leadId: true, type: true, payload: true, occurredAt: true } })
      : Promise.resolve([] as { leadId: string; type: string; payload: unknown; occurredAt: Date }[]),
  ]);
  const hoje = opcoes.hoje;
  const mapaFicha = new Map(fichas.map((f) => [f.leadId, f]));
  const leadsDoQuadro = new Map<string, LeadParaOQuadro>(
    leads.map((l) => {
      const ficha = mapaFicha.get(l.id);
      const imp = contratosImportados(importadosFio.filter((e) => e.leadId === l.id), doImportado.filter((e) => e.leadId === l.id), hoje);
      return [
        l.id,
        {
          id: l.id,
          nome: l.name,
          empresa: ficha?.empresa ?? null,
          dono: l.owner?.name ?? null,
          etapa: ficha?.etapa ?? null,
          valorCentavos: ficha?.valorNegociadoCentavos ?? ficha?.valorCentavos ?? null,
          temDocumento: documentos.some((d) => d.leadId === l.id),
          importados: imp.map((x) => ({ origem: x.origem, valorCentavos: x.valorCentavos, temPdf: !x.semDocumento })),
          fatosDoFim: fatos.filter((f) => f.leadId === l.id),
        },
      ];
    }),
  );
  const aditivosPorPai = new Map<string, number>();
  for (const r of linhas) if (r.tipo === 'aditivo' && r.paiId) aditivosPorPai.set(r.paiId, (aditivosPorPai.get(r.paiId) ?? 0) + 1);
  return {
    linhas: linhas as LinhaDoContrato[],
    registros: (linhas as LinhaDoContrato[]).map(paraOQuadro),
    aditivosPorPai,
    documentos: new Map(documentos.map((d) => [d.id, { id: d.id, temPdf: !!d.pdfUrl, assinadoClienteEm: d.assinadoClienteEm, assinadoRootEm: d.assinadoRootEm }])),
    leads: leadsDoQuadro,
    hoje,
    assinaturaConfigurada: opcoes.assinaturaConfigurada,
  };
}

export async function lerQuadro(prisma: PrismaService, orgId: string, assinaturaConfigurada: boolean, agora: Date = new Date()): Promise<QuadroDeContratos> {
  return montarQuadro(await carregarInsumos(prisma, orgId, { assinaturaConfigurada, hoje: hojeEmSP(agora) }));
}

const TIPOS_DO_HISTORICO: string[] = [...FATOS_DO_CONTRATO, 'contrato.gerado', 'contrato.assinado_cliente', 'contrato.assinado_root', 'contrato.assinado', 'contrato.concluido', 'contrato.desativado', 'contrato.importado', 'contrato.anexado'];

const TITULO: Record<TipoDeContrato, string> = { contrato: 'Contrato', aditivo: 'Aditivo', distrato: 'Distrato' };

/** O endereço do PDF para a tela. O de provedor anexo guarda uma chave de armazém, nunca um link: vai pela rota do lead. */
function linkDoPdf(leadId: string, doc: { provedor: string; pdfUrl: string | null } | null): string | null {
  if (!doc?.pdfUrl) return null;
  if (doc.provedor === 'anexo') return `/comercial/lead/${encodeURIComponent(leadId)}/contrato-anexado`;
  return /^https?:\/\//.test(doc.pdfUrl) ? doc.pdfUrl : null;
}

/** A ficha de um id do quadro: o registro, o importado derivado do fio ou o fantasma. */
export async function lerFicha(prisma: PrismaService, orgId: string, idBruto: string, assinaturaConfigurada: boolean, lerAceite: (leadId: string) => Promise<AceiteParaEmissao | null>, agora: Date = new Date()): Promise<ContratoNaFicha> {
  const alvo = lerIdDoContrato(idBruto);
  const naoAchou = new NotFoundException('Contrato não encontrado.');
  let leadId: string;
  if (alvo.tipo === 'registro') {
    const linha = await prisma.comercialContrato.findFirst({ where: { id: alvo.id, orgId }, select: { leadId: true } });
    if (!linha) throw naoAchou;
    leadId = linha.leadId;
  } else {
    leadId = alvo.leadId;
  }
  const hoje = hojeEmSP(agora);
  const insumos = await carregarInsumos(prisma, orgId, { assinaturaConfigurada, hoje, soLead: leadId });
  const lead = insumos.leads.get(leadId);
  if (!lead) throw naoAchou;

  const historico = await lerHistorico(prisma, orgId, leadId);
  const base = { tipo: 'contrato' as TipoDeContrato, paiId: null, vigenciaInicio: null, hashDoConteudo: null, minutaId: null, linkPdf: null, faturaPor: null, motivoDoFim: null, signatarios: [], documentos: [] as DocumentoDoContrato[], ultimaConferenciaEm: null, historico, emissao: null };

  if (alvo.tipo === 'importado') {
    if (!lead.importados.length) throw naoAchou;
    const assumido = insumos.registros.find((r) => r.origemImportada !== null);
    if (assumido) return lerFicha(prisma, orgId, assumido.id, assinaturaConfigurada, lerAceite, agora);
    return { ...cartaoDoImportado(lead, hoje), ...base, linkPdf: linkDoImportado(lead), faltaParaEnviar: [] };
  }
  if (alvo.tipo === 'fantasma') {
    const nomes = [...insumos.registros.filter((r) => r.tipo === 'contrato').map((r) => cartaoDoRegistro(r, insumos).cliente)];
    const faltando = faltaParaEnviar({ estado: 'a_emitir', modalidade: null, faturaPor: null, hashDoConteudo: null, minutaId: null, signatarios: [], assinaturaConfigurada });
    return { ...cartaoDoFantasma(lead, nomes), ...base, faltaParaEnviar: faltando };
  }

  const linha = insumos.linhas.find((r) => r.id === alvo.id);
  const registro = insumos.registros.find((r) => r.id === alvo.id);
  if (!linha || !registro) throw naoAchou;
  const cartao: ContratoNoQuadro = cartaoDoRegistro(registro, insumos);
  const raizId = linha.paiId ?? linha.id;
  const daFamilia = insumos.linhas.filter((r) => r.id === raizId || r.paiId === raizId);
  const docsIds = daFamilia.flatMap((r) => (r.documentoId ? [r.documentoId] : []));
  const docs = docsIds.length ? await prisma.comercialDocumento.findMany({ where: { orgId, id: { in: docsIds } }, select: { id: true, provedor: true, pdfUrl: true, assinadoClienteEm: true, assinadoRootEm: true } }) : [];
  const documentoDa = (r: { documentoId: string | null }) => docs.find((d) => d.id === r.documentoId) ?? null;
  const documentos: DocumentoDoContrato[] = daFamilia
    .sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())
    .map((r) => {
      const d = documentoDa(r);
      const assinaturas = [d?.assinadoClienteEm, d?.assinadoRootEm].filter((x): x is Date => !!x);
      return {
        id: r.id,
        tipo: r.tipo as TipoDeContrato,
        titulo: `${TITULO[r.tipo as TipoDeContrato] ?? 'Contrato'}${r.numero ? ` ${r.numero}` : ''}`,
        estado: r.estado as EstadoDoContrato,
        numero: r.numero,
        temPdf: !!d?.pdfUrl,
        assinadoEm: d?.assinadoClienteEm && d.assinadoRootEm ? new Date(Math.max(...assinaturas.map((x) => x.getTime()))).toISOString() : null,
      };
    });
  const comSignatarios = await prisma.comercialContratoSignatario.findMany({ where: { orgId, contratoId: linha.id }, orderBy: { ordem: 'asc' }, select: { id: true, ordem: true, papel: true, nome: true, email: true, assinadoEm: true } });
  const emissao = aindaNaoEnviado(linha.estado) ? await lerEmissao(prisma, orgId, linha.id, await lerAceite(linha.leadId), agora) : null;
  return {
    ...cartao,
    tipo: linha.tipo as TipoDeContrato,
    paiId: linha.paiId,
    vigenciaInicio: dia(linha.vigenciaInicio),
    hashDoConteudo: linha.hashDoConteudo,
    minutaId: linha.minutaId,
    linkPdf: linkDoPdf(linha.leadId, documentoDa(linha)) ?? (linha.origemImportada ? linkDoImportado(lead, linha.origemImportada) : null),
    faturaPor: linha.faturaPor,
    motivoDoFim: linha.motivoDoFim,
    signatarios: comSignatarios.map((s) => ({ id: s.id, ordem: s.ordem, papel: s.papel as 'cliente' | 'root', nome: s.nome, email: s.email, assinadoEm: s.assinadoEm?.toISOString() ?? null })),
    documentos,
    historico,
    ultimaConferenciaEm: linha.ultimaConferenciaEm?.toISOString() ?? null,
    emissao: emissao?.naFicha ?? null,
    faltaParaEnviar: faltaParaEnviar({
      estado: linha.estado,
      tipo: linha.tipo,
      modalidade: linha.modalidade,
      faturaPor: linha.faturaPor,
      hashDoConteudo: linha.hashDoConteudo,
      minutaId: linha.minutaId,
      signatarios: comSignatarios,
      assinaturaConfigurada,
      ...(emissao?.falta ?? {}),
    }),
  };
}

interface MarcaDaMinuta {
  base?: MinutaDaEmissao['base'];
  origem?: MinutaDaEmissao['origem'];
  geradaEm?: string;
  avisos?: string[];
  entrada?: string;
}

/** A seção de emissão e o que ela acusa em `faltaParaEnviar`. O texto e o laudo são os da minuta vinculada, nunca os do lead. */
async function lerEmissao(prisma: PrismaService, orgId: string, contratoId: string, aceite: AceiteParaEmissao | null, agora: Date): Promise<{ naFicha: EmissaoNaFicha; falta: { temAceite: boolean; lacunas: string[]; graves: string[] | null; rootsSemAlcada: string[]; minutaDesatualizada: boolean; foraDoPdf: string[] } }> {
  const c = await prisma.comercialContrato.findFirstOrThrow({ where: { id: contratoId, orgId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } });
  const entrada = await entradaDoRegistro(prisma, orgId, c, aceite);
  const semMolde = c.tipo === 'contrato' && !c.modalidade;
  const molde = c.tipo === 'contrato' && c.modalidade ? moldeDoContrato(c.modalidade as ModalidadeDeContrato) : null;
  const campos = semMolde ? [] : camposParaATela(entrada);
  const preenchido = semMolde ? null : preencherRegistro(entrada);
  const doc = c.minutaId ? await prisma.comercialDocumento.findFirst({ where: { id: c.minutaId, orgId, leadId: c.leadId }, select: { id: true, hashConteudo: true, conteudo: true, laudo: true } }) : null;
  const marca = (((c.dadosDoContrato ?? {}) as { minuta?: unknown }).minuta ?? {}) as MarcaDaMinuta;
  const entradaAgora = assinaturaDaEntrada({ modalidade: c.modalidade, faturaPor: c.faturaPor, campos: camposEscritos(c.dadosDoContrato) });
  const desatualizada = !!doc && !!marca.entrada && marca.entrada !== entradaAgora;
  const laudo = (doc?.laudo as LaudoDoContrato | null) ?? null;
  // O rodapé e o bloco de assinatura também pedem dado: a lacuna ali recusa o PDF tanto quanto a do texto.
  const lacunas = doc?.conteudo ? [...new Set([...contarMarcas(doc.conteudo).lacunas, ...(preenchido?.lacunas ?? []).filter((l) => !preenchido?.texto.includes(`⟦lacuna: ${l}⟧`))])] : [];
  const usuarios = await prisma.user.findMany({ where: { orgId, isActive: true }, orderBy: { name: 'asc' }, take: 200, select: { name: true, email: true, roles: { select: { key: true } } } });
  const titulares = usuarios.filter((u) => { const papeis = u.roles.map((r) => r.key); return !temPapelDeMaquina(papeis) && atendeAlcada('titular', alcadaDe(papeis)); }).map((u) => ({ nome: u.name, email: u.email }));
  const viva = await prisma.approval.findFirst({
    where: { orgId, capabilityId: CAP_CONTRATO, resourceId: { startsWith: `${c.id}:` }, OR: [{ status: 'pendente', expiraEm: { gt: agora } }, { status: 'confirmada' }] },
    orderBy: { criadoEm: 'desc' },
    select: { id: true },
  });
  const minuta: MinutaDaEmissao | null = doc?.conteudo
    ? {
        documentoId: doc.id,
        hash: doc.hashConteudo,
        conteudo: doc.conteudo,
        origem: marca.origem === 'modelo' ? 'modelo' : 'sistema',
        base: marca.base ?? 'molde',
        geradaEm: marca.geradaEm ?? null,
        lacunas,
        avisos: marca.avisos ?? [],
        laudo,
        desatualizada,
      }
    : null;
  return {
    naFicha: { temAceite: !!aceite, molde: molde ? { titulo: molde.titulo, data: molde.data } : null, campos, minuta, titulares, envioNaFila: viva?.id ?? null },
    falta: {
      temAceite: !!aceite,
      lacunas,
      graves: laudo && Array.isArray(laudo.apontamentos) ? apontamentosGraves(laudo.apontamentos).map((a) => a.titulo) : null,
      rootsSemAlcada: await rootsSemAlcada(prisma, orgId, c.signatarios),
      minutaDesatualizada: desatualizada,
      foraDoPdf: camposForaDoPdf(entrada),
    },
  };
}

function linkDoImportado(lead: LeadParaOQuadro, preferida?: string): string | null {
  const alvo = lead.importados.find((x) => x.temPdf && (!preferida || x.origem === preferida)) ?? lead.importados.find((x) => x.temPdf);
  return alvo ? `/comercial/contratos/${encodeURIComponent(lead.id)}/importados/anexo?origem=${encodeURIComponent(alvo.origem)}` : null;
}

async function lerHistorico(prisma: PrismaService, orgId: string, leadId: string): Promise<FatoDoContrato[]> {
  const fatos = await prisma.leadEvent.findMany({ where: { orgId, leadId, type: { in: TIPOS_DO_HISTORICO } }, orderBy: { occurredAt: 'desc' }, take: 100, select: { type: true, payload: true, occurredAt: true } });
  return fatos.map((f) => ({ em: f.occurredAt.toISOString(), texto: resumoDoEvento(f.type, f.payload).resumo }));
}

export { PREFIXO_DO_FANTASMA, PREFIXO_DO_IMPORTADO };
