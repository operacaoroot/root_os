import { createHash } from 'node:crypto';

import {
  ETAPAS_DO_QUADRO,
  etapaDoContrato,
  diasAteOFim,
  ehSaida,
  type ComercialEtapa,
  type ContratoNoQuadro,
  type EstadoDoContrato,
  type EtapaDoQuadro,
  type ModalidadeDeContrato,
  type QuadroDeContratos,
  type TipoDeContrato,
} from '@mktos/shared';

import type { AssinaturaNoWebhook, PapelDoSignatario } from '../portas/assinatura.port';
import { lerExternalId } from '../portas/assinatura.port';

/*
 * O MÓDULO DE CONTRATOS, A PARTE PURA (02/11/2026). Sem Nest e sem banco.
 *
 * Aqui mora o que precisa ser medido sem subir nada: os ids (o de verdade, o do
 * contrato importado derivado do fio e o do fantasma), que estado sai de um
 * documento e de uma assinatura, quem assinou entre os signatários gravados, o
 * que recusa cada ato, o que falta para enviar e a montagem do quadro.
 *
 * ARRASTAR NÃO INVENTA REALIDADE (regra dura do roteiro): nenhuma função daqui
 * marca assinatura por gesto. O estado só vira `assinado` pelo que o provedor
 * disse (`estadoDepoisDaAssinatura`, chamado pelo webhook e pela conferência).
 */

// ---------------------------------------------------------------------------
// Os ids
// ---------------------------------------------------------------------------

export const PREFIXO_DO_FANTASMA = 'sem-contrato:';
export const PREFIXO_DO_IMPORTADO = 'importado:';

export type IdDoContrato = { tipo: 'registro'; id: string } | { tipo: 'importado'; leadId: string } | { tipo: 'fantasma'; leadId: string };

export function lerIdDoContrato(id: string): IdDoContrato {
  if (id.startsWith(PREFIXO_DO_FANTASMA)) return { tipo: 'fantasma', leadId: id.slice(PREFIXO_DO_FANTASMA.length) };
  if (id.startsWith(PREFIXO_DO_IMPORTADO)) return { tipo: 'importado', leadId: id.slice(PREFIXO_DO_IMPORTADO.length) };
  return { tipo: 'registro', id };
}

/**
 * O id do contrato de um documento: a MESMA conta do backfill da migration
 * `20261102120000_comercial_contrato` (md5 em formato de uuid), para o efeito e
 * o webhook caírem na linha que o backfill criou.
 */
export function idDoContratoDoDocumento(documentoId: string): string {
  const m = createHash('md5').update(`comercial-contrato:${documentoId}`).digest('hex');
  return `${m.slice(0, 8)}-${m.slice(8, 12)}-${m.slice(12, 16)}-${m.slice(16, 20)}-${m.slice(20)}`;
}

// ---------------------------------------------------------------------------
// O estado
// ---------------------------------------------------------------------------

const VIVOS: readonly EstadoDoContrato[] = ['rascunho', 'a_emitir', 'em_assinatura', 'assinado', 'ativo'];

export function ehEstadoVivo(estado: string): boolean {
  return (VIVOS as readonly string[]).includes(estado);
}

/** O estado do contrato de um documento de assinatura (a mesma regra do backfill). */
export function estadoDoDocumento(estadoDoDoc: string, clienteAtivo: boolean): EstadoDoContrato {
  if (estadoDoDoc !== 'assinado') return 'em_assinatura';
  return clienteAtivo ? 'ativo' : 'assinado';
}

/** O estado depois do que o provedor disse. Nunca desce: encerrado e cancelado ficam; ativo fica ativo. */
export function estadoDepoisDaAssinatura(atual: string, todosAssinaram: boolean, clienteAtivo: boolean): EstadoDoContrato {
  const estado = atual as EstadoDoContrato;
  if (estado === 'encerrado' || estado === 'cancelado' || estado === 'ativo') return estado;
  if (!todosAssinaram) return estado;
  return clienteAtivo ? 'ativo' : 'assinado';
}

export interface SignatarioGravado {
  id: string;
  ordem: number;
  papel: string;
  tokenNoProvedor: string | null;
  assinadoEm: Date | null;
}

/**
 * Quem assinou entre os signatários gravados. Pelo token do provedor, depois pelo `external_id`
 * (`cliente:2` = o segundo do papel, na ordem gravada). Documento antigo só diz o papel: vale para
 * os signatários daquele papel. Quem já tem data não é tocado (reentrega não reescreve).
 */
export function casarAssinaturas(signatarios: readonly SignatarioGravado[], w: Pick<AssinaturaNoWebhook, 'assinados' | 'assinaturas'>, agora: Date): { id: string; em: Date }[] {
  const data = (em: string | null): Date => {
    const d = em ? new Date(em) : agora;
    return Number.isNaN(d.getTime()) ? agora : d;
  };
  const porPapel = (papel: PapelDoSignatario) => [...signatarios].filter((s) => s.papel === papel).sort((a, b) => a.ordem - b.ordem);
  const achados = new Map<string, Date>();
  if (w.assinaturas) {
    for (const a of w.assinaturas) {
      const n = lerExternalId(a.externalId)?.n ?? null;
      const alvo = (a.token ? signatarios.find((s) => s.tokenNoProvedor === a.token) : undefined) ?? (n ? porPapel(a.papel)[n - 1] : undefined);
      if (alvo) achados.set(alvo.id, data(a.em));
    }
  } else {
    for (const a of w.assinados) for (const s of porPapel(a.papel)) achados.set(s.id, data(a.em));
  }
  return signatarios.filter((s) => !s.assinadoEm && achados.has(s.id)).map((s) => ({ id: s.id, em: achados.get(s.id)! }));
}

/** O contador do cartão. Sem signatário gravado (documento anterior ao módulo), conta os dois papéis no documento. */
export function assinaturasDoCartao(
  signatarios: readonly { assinadoEm: Date | null }[],
  doc: { assinadoClienteEm: Date | null; assinadoRootEm: Date | null } | null,
): { feitas: number; total: number } | null {
  if (signatarios.length) return { feitas: signatarios.filter((s) => s.assinadoEm).length, total: signatarios.length };
  if (doc) return { feitas: (doc.assinadoClienteEm ? 1 : 0) + (doc.assinadoRootEm ? 1 : 0), total: 2 };
  return null;
}

// ---------------------------------------------------------------------------
// O fim do contrato, lido do fio
// ---------------------------------------------------------------------------

export interface FatoDoFim {
  type: string;
  payload: unknown;
  occurredAt: Date;
}

/**
 * O encerramento que vale AGORA: o fato mais novo de fim (`contrato.concluido`,
 * `contrato.desativado`), a não ser que um `contrato.reaberto` tenha vindo depois.
 */
export function fimVigente<T extends FatoDoFim>(fatos: readonly T[]): T | null {
  const fins = fatos.filter((f) => f.type === 'contrato.concluido' || f.type === 'contrato.desativado').sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const fim = fins[0];
  if (!fim) return null;
  const reaberto = fatos.some((f) => f.type === 'contrato.reaberto' && f.occurredAt.getTime() >= fim.occurredAt.getTime());
  return reaberto ? null : fim;
}

/** A chave do fato de fim: a primeira é a de sempre; depois de cada reabertura, outra (o id do fato é derivado da chave). */
export function chaveDoEncerramento(reaberturas: number): string {
  return reaberturas > 0 ? `encerramento:${reaberturas}` : 'encerramento';
}

/** O cliente foi desativado: o contrato vivo foi desativado à mão ou o lead saiu do funil. */
export function clienteDesativado(etapa: string | null, fatos: readonly FatoDoFim[]): boolean {
  if (etapa && ehSaida(etapa as ComercialEtapa)) return true;
  return fimVigente(fatos)?.type === 'contrato.desativado';
}

// ---------------------------------------------------------------------------
// O que recusa cada ato (nulo = pode)
// ---------------------------------------------------------------------------

const ANTES_DE_ENVIAR: readonly string[] = ['a_emitir', 'rascunho'];

export function motivoParaNaoMexerNosSignatarios(estado: string): string | null {
  return ANTES_DE_ENVIAR.includes(estado) ? null : 'Os signatários só mudam antes de o contrato ir para assinatura.';
}

/** Modalidade e CNPJ que fatura entram no documento: depois de enviar, não mudam. Número e vigência valem até o fim. */
export function motivoParaNaoEditar(estado: string, campos: readonly string[]): string | null {
  if (estado === 'cancelado' || estado === 'encerrado') return 'Este contrato já terminou: reabra antes de editar.';
  if (!ANTES_DE_ENVIAR.includes(estado) && campos.some((c) => c === 'modalidade' || c === 'faturaPor' || c === 'campos')) {
    return 'Modalidade, CNPJ que fatura e os campos do molde fazem parte do documento: depois de enviar para assinatura, não mudam.';
  }
  return null;
}

export function motivoParaNaoEncerrar(estado: string, tipo: string): string | null {
  if (tipo !== 'contrato') return 'Aditivo e distrato não se encerram: cancele o rascunho.';
  if (estado === 'assinado' || estado === 'ativo') return null;
  if (estado === 'encerrado') return 'Este contrato já está encerrado.';
  if (estado === 'cancelado') return 'Este contrato foi cancelado.';
  return 'Só contrato assinado se encerra. Antes disso, cancele.';
}

export function motivoParaNaoReabrir(estado: string): string | null {
  if (estado === 'encerrado') return null;
  if (estado === 'cancelado') return 'Contrato cancelado não reabre: o documento saiu da ZapSign. Crie outro contrato.';
  return 'Só contrato encerrado reabre.';
}

export function motivoParaNaoCancelar(estado: string): string | null {
  if (estado === 'a_emitir' || estado === 'rascunho' || estado === 'em_assinatura') return null;
  if (estado === 'cancelado') return 'Este contrato já foi cancelado.';
  return 'Contrato assinado não se cancela: encerre, ou abra um distrato.';
}

export function motivoParaNaoReenviar(estado: string, documentoId: string | null): string | null {
  if (estado !== 'em_assinatura' || !documentoId) return 'Só contrato em assinatura na ZapSign tem link para reenviar.';
  return null;
}

export function motivoParaNaoAbrirFilho(pai: { tipo: string; estado: string }): string | null {
  if (pai.tipo !== 'contrato') return 'Aditivo e distrato nascem de um contrato, não de outro aditivo ou distrato.';
  if (pai.estado !== 'assinado' && pai.estado !== 'ativo') return 'Aditivo e distrato só nascem de contrato ativo.';
  return null;
}

/** Importado no lote: encerrar e reabrir dele moram na lista antiga, que mexe nos fatos e nas parcelas lançadas à mão. */
export const FRASE_DO_IMPORTADO_NO_LOTE = 'Contrato importado não se encerra nem se reabre em lote: use a lista antiga, em Parcelas e encerramento.';

/** A frase de quem encerra (ou distrata) com parcela em aberto, sem ciência. O encerrar de sempre diz o mesmo. */
export function fraseDasParcelas(emAberto: number, ato: 'encerrar' | 'distratar'): string {
  return `Há ${emAberto} parcela(s) em aberto no Asaas. ${ato === 'encerrar' ? 'Encerrar' : 'O distrato'} não cancela a cobrança (isso é decisão da mesa). Confirme que viu para seguir.`;
}

// ---------------------------------------------------------------------------
// O que falta para enviar
// ---------------------------------------------------------------------------

/** Antes de ir para assinatura? Depois disso, o que vale é a conferência e o cancelar. */
export function aindaNaoEnviado(estado: string): boolean {
  return ANTES_DE_ENVIAR.includes(estado);
}

export function faltaParaEnviar(c: {
  estado: string;
  /** Aditivo e distrato herdam do contrato pai e não têm molde: a modalidade não é pedida. */
  tipo?: string;
  modalidade: string | null;
  faturaPor: string | null;
  hashDoConteudo: string | null;
  minutaId: string | null;
  signatarios: readonly { papel: string }[];
  assinaturaConfigurada: boolean;
  /** Os quatro abaixo vêm da ficha (F2). Ausentes, não acusam: quem chama sem eles é só o fantasma, que já não tem minuta. */
  temAceite?: boolean;
  lacunas?: readonly string[];
  /** Os títulos dos apontamentos graves do laudo; nulo = a minuta ainda não foi revisada. */
  graves?: readonly string[] | null;
  rootsSemAlcada?: readonly string[];
  minutaDesatualizada?: boolean;
}): string[] {
  if (!ANTES_DE_ENVIAR.includes(c.estado)) return [];
  const falta: string[] = [];
  if (!c.modalidade && (c.tipo ?? 'contrato') === 'contrato') falta.push('A modalidade do contrato (implantação ou continuidade).');
  if (!c.faturaPor?.trim()) falta.push('O CNPJ que fatura.');
  if (!c.signatarios.some((s) => s.papel === 'cliente')) falta.push('Quem assina pelo cliente.');
  if (!c.signatarios.some((s) => s.papel === 'root')) falta.push('Quem assina pela Root, entre os titulares.');
  for (const email of c.rootsSemAlcada ?? []) falta.push(`${email} não é, agora, gente ativa e titular desta empresa: troque quem assina pela Root.`);
  if (c.temAceite === false) falta.push('A proposta aceita: a aprovação do envio prende a versão aceita, e este contrato não tem nenhuma.');
  if (!c.minutaId || !c.hashDoConteudo) {
    falta.push('A minuta do contrato.');
  } else {
    if (c.minutaDesatualizada) falta.push('Gerar a minuta de novo: os dados mudaram depois que ela foi gerada.');
    for (const l of c.lacunas ?? []) falta.push(`Preencher a lacuna: ${l}.`);
    if (c.graves === null) falta.push('A revisão da minuta: rode o revisor.');
    for (const g of c.graves ?? []) falta.push(`Resolver o apontamento do laudo: ${g}.`);
  }
  if (!c.assinaturaConfigurada) falta.push('O token da ZapSign nesta instância: sem ele, nada sai para assinatura.');
  return falta;
}

// ---------------------------------------------------------------------------
// O aviso do fantasma
// ---------------------------------------------------------------------------

function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cliente fechado sem contrato cujo nome começa com o nome de outro cliente que tem contrato:
 * provavelmente é o mesmo contrato ("Alicerce Filial" e "Alicerce"). Em palavras inteiras, e nome de
 * menos de três letras não conta: é sugestão de conferir, não vínculo.
 */
export function avisoDoFantasma(nome: string, comContrato: readonly string[]): string | null {
  const este = normalizarNome(nome);
  for (const outro of comContrato) {
    const alvo = normalizarNome(outro);
    if (alvo.length >= 3 && (este === alvo || este.startsWith(`${alvo} `))) return `conferir: pode ser o mesmo contrato de ${outro}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// O quadro
// ---------------------------------------------------------------------------

export interface RegistroParaOQuadro {
  id: string;
  leadId: string;
  tipo: string;
  estado: string;
  modalidade: string | null;
  numero: string | null;
  valorCentavos: number | null;
  vigenciaFim: string | null;
  origemImportada: string | null;
  documentoId: string | null;
  lacunas: number | null;
  signatarios: readonly { assinadoEm: Date | null }[];
}

export interface DocumentoParaOQuadro {
  id: string;
  temPdf: boolean;
  assinadoClienteEm: Date | null;
  assinadoRootEm: Date | null;
}

export interface ImportadoParaOQuadro {
  origem: string;
  valorCentavos: number | null;
  temPdf: boolean;
}

export interface LeadParaOQuadro {
  id: string;
  nome: string;
  empresa: string | null;
  dono: string | null;
  etapa: string | null;
  valorCentavos: number | null;
  temDocumento: boolean;
  importados: readonly ImportadoParaOQuadro[];
  fatosDoFim: readonly FatoDoFim[];
}

export interface InsumosDoQuadro {
  registros: readonly RegistroParaOQuadro[];
  aditivosPorPai: ReadonlyMap<string, number>;
  documentos: ReadonlyMap<string, DocumentoParaOQuadro>;
  leads: ReadonlyMap<string, LeadParaOQuadro>;
  hoje: string;
  assinaturaConfigurada: boolean;
}

const ETAPAS_CONTRATADAS: readonly EtapaDoQuadro[] = ['ativo', 'renovar', 'a_encerrar'];

const dataBr = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function avisoDaEtapa(etapa: EtapaDoQuadro, vigenciaFim: string | null, hoje: string): string | null {
  if (etapa === 'a_encerrar') return 'Cliente desativado com contrato vivo';
  if (etapa === 'renovar' && vigenciaFim) return `${diasAteOFim(vigenciaFim, hoje) < 0 ? 'Venceu em' : 'Vence em'} ${dataBr(vigenciaFim)}`;
  return null;
}

/** Um cartão de um registro de verdade (contrato, aditivo ou distrato). */
export function cartaoDoRegistro(r: RegistroParaOQuadro, i: Pick<InsumosDoQuadro, 'documentos' | 'leads' | 'aditivosPorPai' | 'hoje'>): ContratoNoQuadro {
  const lead = i.leads.get(r.leadId);
  const doc = r.documentoId ? i.documentos.get(r.documentoId) ?? null : null;
  const etapa = etapaDoContrato({
    estado: r.estado as EstadoDoContrato,
    vigenciaFim: r.vigenciaFim,
    clienteDesativado: clienteDesativado(lead?.etapa ?? null, lead?.fatosDoFim ?? []),
    hoje: i.hoje,
  });
  const temPdfImportado = r.origemImportada !== null && (lead?.importados ?? []).some((x) => x.temPdf);
  return {
    id: r.id,
    fantasma: false,
    leadId: r.leadId,
    cliente: lead?.empresa ?? lead?.nome ?? 'Cliente',
    contato: lead?.nome ?? null,
    etapa,
    estado: r.estado as EstadoDoContrato,
    modalidade: r.modalidade as ModalidadeDeContrato | null,
    numero: r.numero,
    valorCentavos: r.valorCentavos ?? lead?.valorCentavos ?? null,
    dono: lead?.dono ?? null,
    vigenciaFim: r.vigenciaFim,
    temPdf: Boolean(doc?.temPdf) || temPdfImportado,
    importado: r.origemImportada !== null,
    aditivos: i.aditivosPorPai.get(r.id) ?? 0,
    assinaturas: r.origemImportada !== null ? null : assinaturasDoCartao(r.signatarios, doc),
    lacunas: r.lacunas,
    aviso: avisoDaEtapa(etapa, r.vigenciaFim, i.hoje),
  };
}

/**
 * O contrato importado que ainda não virou registro: UM cartão por lead, com a soma quando todos têm
 * valor (a mesma conta da lista de contratos vivos), sem cobrança nem assinatura. Só leitura do fio.
 */
export function cartaoDoImportado(lead: LeadParaOQuadro, hoje: string): ContratoNoQuadro {
  const fim = fimVigente(lead.fatosDoFim);
  const estado: EstadoDoContrato = fim?.type === 'contrato.concluido' ? 'encerrado' : 'ativo';
  const etapa = etapaDoContrato({ estado, vigenciaFim: null, clienteDesativado: clienteDesativado(lead.etapa, lead.fatosDoFim), hoje });
  const soma = lead.importados.every((x) => x.valorCentavos !== null) ? lead.importados.reduce((s, x) => s + (x.valorCentavos ?? 0), 0) : null;
  const temPdf = lead.importados.some((x) => x.temPdf);
  return {
    id: `${PREFIXO_DO_IMPORTADO}${lead.id}`,
    fantasma: false,
    leadId: lead.id,
    cliente: lead.empresa ?? lead.nome,
    contato: lead.nome,
    etapa,
    estado,
    modalidade: null,
    numero: null,
    valorCentavos: soma ?? lead.valorCentavos,
    dono: lead.dono,
    vigenciaFim: null,
    temPdf,
    importado: true,
    aditivos: 0,
    assinaturas: null,
    lacunas: null,
    aviso: avisoDaEtapa(etapa, null, hoje) ?? (temPdf ? null : 'Contrato importado do CRM antigo · anexar o PDF'),
  };
}

/** A ausência de contrato: lead em `contrato` ou `fechado` sem nada no sistema. */
export function cartaoDoFantasma(lead: LeadParaOQuadro, nomesComContrato: readonly string[]): ContratoNoQuadro {
  const cliente = lead.empresa ?? lead.nome;
  return {
    id: `${PREFIXO_DO_FANTASMA}${lead.id}`,
    fantasma: true,
    leadId: lead.id,
    cliente,
    contato: lead.nome,
    etapa: 'a_emitir',
    estado: null,
    modalidade: null,
    numero: null,
    valorCentavos: lead.valorCentavos,
    dono: lead.dono,
    vigenciaFim: null,
    temPdf: false,
    importado: false,
    aditivos: 0,
    assinaturas: null,
    lacunas: null,
    aviso: avisoDoFantasma(cliente, nomesComContrato),
  };
}

const ETAPAS_QUE_PEDEM_CONTRATO: readonly string[] = ['contrato', 'fechado'];

export function montarQuadro(i: InsumosDoQuadro): QuadroDeContratos {
  const contratos = i.registros.filter((r) => r.tipo === ('contrato' satisfies TipoDeContrato));
  const comRegistro = new Set(contratos.map((r) => r.leadId));
  const importadoAssumido = new Set(contratos.filter((r) => r.origemImportada !== null).map((r) => r.leadId));
  const itens: ContratoNoQuadro[] = contratos.map((r) => cartaoDoRegistro(r, i));

  const leads = [...i.leads.values()];
  for (const lead of leads) {
    if (lead.importados.length && !importadoAssumido.has(lead.id)) itens.push(cartaoDoImportado(lead, i.hoje));
  }
  const nomesComContrato = [...new Set(itens.map((c) => c.cliente))];
  for (const lead of leads) {
    if (!lead.etapa || !ETAPAS_QUE_PEDEM_CONTRATO.includes(lead.etapa)) continue;
    if (comRegistro.has(lead.id) || lead.importados.length || lead.temDocumento) continue;
    itens.push(cartaoDoFantasma(lead, nomesComContrato));
  }

  const ordem = (e: EtapaDoQuadro) => ETAPAS_DO_QUADRO.indexOf(e);
  itens.sort((a, b) => ordem(a.etapa) - ordem(b.etapa) || a.cliente.localeCompare(b.cliente, 'pt-BR'));

  const porEtapa = Object.fromEntries(ETAPAS_DO_QUADRO.map((e) => [e, 0])) as Record<EtapaDoQuadro, number>;
  let contratadoCentavos = 0;
  for (const c of itens) {
    porEtapa[c.etapa] += 1;
    if (ETAPAS_CONTRATADAS.includes(c.etapa)) contratadoCentavos += c.valorCentavos ?? 0;
  }
  return { itens, totais: { contratadoCentavos, porEtapa }, assinaturaConfigurada: i.assinaturaConfigurada };
}
