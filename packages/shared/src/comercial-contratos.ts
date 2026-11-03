import { z } from 'zod';

import type { LaudoDoContrato } from './comercial-agentes';

/*
 * O MÓDULO DE CONTRATOS DO COMERCIAL (02/11/2026): o contrato como registro próprio.
 *
 * Porta para o OS o que o FinOps tem de contrato (spec do Pedro de 29/10/2026 em
 * `Root/90-sistema/projetos/contratos-para-os/spec.md`), sobre a porta de assinatura
 * que o OS já tem. Aqui mora o que a API e a tela precisam contar igual: os estados,
 * as etapas do quadro, a regra de qual cartão fica em qual coluna e o que um arrasto
 * pode fazer. As regras vêm de `src/lib/boardContratos.ts` do FinOps, sem grupo
 * econômico.
 *
 * ARRASTAR NÃO INVENTA REALIDADE: quem assina é o cliente na ZapSign, então "em
 * assinatura → ativo" não existe como gesto. O arrasto registra decisão da casa ou
 * abre o passo seguinte.
 */

export const TIPOS_DE_CONTRATO = ['contrato', 'aditivo', 'distrato'] as const;
export type TipoDeContrato = (typeof TIPOS_DE_CONTRATO)[number];

export const MODALIDADES_DE_CONTRATO = ['implantacao', 'continuidade'] as const;
export type ModalidadeDeContrato = (typeof MODALIDADES_DE_CONTRATO)[number];

export const ROTULO_DA_MODALIDADE: Record<ModalidadeDeContrato, string> = {
  implantacao: 'Implantação',
  continuidade: 'Continuidade',
};

/** O estado gravado em `ComercialContrato.estado`. */
export const ESTADOS_DO_CONTRATO = ['rascunho', 'a_emitir', 'em_assinatura', 'assinado', 'ativo', 'encerrado', 'cancelado'] as const;
export type EstadoDoContrato = (typeof ESTADOS_DO_CONTRATO)[number];

/** A coluna do quadro. Derivada, nunca gravada. */
export const ETAPAS_DO_QUADRO = ['a_emitir', 'minuta', 'em_assinatura', 'ativo', 'renovar', 'a_encerrar', 'encerrado'] as const;
export type EtapaDoQuadro = (typeof ETAPAS_DO_QUADRO)[number];

export const ROTULO_DA_ETAPA_DO_QUADRO: Record<EtapaDoQuadro, string> = {
  a_emitir: 'A emitir',
  minuta: 'Minuta',
  em_assinatura: 'Em assinatura',
  ativo: 'Ativo',
  renovar: 'Renovar',
  a_encerrar: 'A encerrar',
  encerrado: 'Encerrado',
};

export const DICA_DA_ETAPA: Record<EtapaDoQuadro, string> = {
  a_emitir: 'Cliente fechado sem contrato no sistema',
  minuta: 'Preenchida pelo molde, falta aprovar',
  em_assinatura: 'Na ZapSign, esperando alguém assinar',
  ativo: 'Assinado e vigente',
  renovar: 'Vence em até 60 dias ou já venceu',
  a_encerrar: 'Cliente desativado com contrato vivo',
  encerrado: 'Terminou, distrato ou cancelado',
};

/** Janela em que um contrato vigente passa a pedir renovação. */
export const DIAS_PARA_RENOVAR = 60;

/** De quanto em quanto tempo a rotina confere os contratos em assinatura. */
export const MINUTOS_DA_CONFERENCIA = 30;

const DIA_MS = 86_400_000;

/** Dias de `hoje` até `fim` (AAAA-MM-DD), pelo calendário. Negativo = já passou. */
export function diasAteOFim(fim: string, hoje: string): number {
  return Math.round((Date.parse(`${fim.slice(0, 10)}T00:00:00Z`) - Date.parse(`${hoje.slice(0, 10)}T00:00:00Z`)) / DIA_MS);
}

export interface FatosDaEtapa {
  estado: EstadoDoContrato;
  /** AAAA-MM-DD, ou nulo quando a vigência não foi lançada (contrato importado, por exemplo). */
  vigenciaFim: string | null;
  /** O cliente foi desativado (saiu do funil ou teve o contrato vivo desativado). */
  clienteDesativado: boolean;
  /** AAAA-MM-DD em São Paulo. */
  hoje: string;
}

/**
 * Em que coluna o contrato fica. Sem vigência lançada, o contrato vigente fica em
 * Ativo: a coluna Renovar nunca adivinha uma data.
 */
export function etapaDoContrato(f: FatosDaEtapa): EtapaDoQuadro {
  switch (f.estado) {
    case 'a_emitir':
      return 'a_emitir';
    case 'rascunho':
      return 'minuta';
    case 'em_assinatura':
      return 'em_assinatura';
    case 'encerrado':
    case 'cancelado':
      return 'encerrado';
    case 'assinado':
    case 'ativo':
      if (f.clienteDesativado) return 'a_encerrar';
      if (f.vigenciaFim && diasAteOFim(f.vigenciaFim, f.hoje) <= DIAS_PARA_RENOVAR) return 'renovar';
      return 'ativo';
  }
}

/** O que soltar um cartão numa coluna faz. Nulo = o movimento não existe. */
export type AcaoDoMovimento = 'gerar_minuta' | 'pedir_aprovacao' | 'encerrar' | 'reabrir';

export function acaoDoMovimento(item: { fantasma: boolean; etapa: EtapaDoQuadro }, destino: EtapaDoQuadro): AcaoDoMovimento | null {
  if (destino === item.etapa) return null;
  if (item.fantasma) return item.etapa === 'a_emitir' && destino === 'minuta' ? 'gerar_minuta' : null;
  if (item.etapa === 'a_emitir' && destino === 'minuta') return 'gerar_minuta';
  if (item.etapa === 'minuta' && destino === 'em_assinatura') return 'pedir_aprovacao';
  if ((item.etapa === 'ativo' || item.etapa === 'renovar' || item.etapa === 'a_encerrar') && destino === 'encerrado') return 'encerrar';
  if (item.etapa === 'encerrado' && destino === 'ativo') return 'reabrir';
  return null;
}

// ---------------------------------------------------------------------------
// O que a API devolve
// ---------------------------------------------------------------------------

export interface SignatarioDoContrato {
  id: string;
  ordem: number;
  papel: 'cliente' | 'root';
  nome: string;
  email: string;
  assinadoEm: string | null;
}

/** Um cartão do quadro: um contrato de verdade, ou a ausência dele (`fantasma`). */
export interface ContratoNoQuadro {
  /** O id do contrato, ou `sem-contrato:<leadId>` no fantasma. */
  id: string;
  fantasma: boolean;
  leadId: string;
  cliente: string;
  contato: string | null;
  etapa: EtapaDoQuadro;
  estado: EstadoDoContrato | null;
  modalidade: ModalidadeDeContrato | null;
  numero: string | null;
  valorCentavos: number | null;
  /** O nome do dono do lead. */
  dono: string | null;
  vigenciaFim: string | null;
  temPdf: boolean;
  importado: boolean;
  aditivos: number;
  assinaturas: { feitas: number; total: number } | null;
  lacunas: number | null;
  /** Frase curta de atenção do cartão, ou nula. */
  aviso: string | null;
}

export interface QuadroDeContratos {
  itens: ContratoNoQuadro[];
  totais: { contratadoCentavos: number; porEtapa: Record<EtapaDoQuadro, number> };
  /** A ZapSign tem token nesta instância? Sem ele, nada sai para assinatura e a tela diz isso. */
  assinaturaConfigurada: boolean;
}

export interface DocumentoDoContrato {
  id: string;
  tipo: TipoDeContrato;
  titulo: string;
  estado: EstadoDoContrato;
  numero: string | null;
  temPdf: boolean;
  assinadoEm: string | null;
}

export interface FatoDoContrato {
  em: string;
  texto: string;
}

export interface ContratoNaFicha extends ContratoNoQuadro {
  tipo: TipoDeContrato;
  paiId: string | null;
  vigenciaInicio: string | null;
  hashDoConteudo: string | null;
  minutaId: string | null;
  linkPdf: string | null;
  faturaPor: string | null;
  motivoDoFim: string | null;
  signatarios: SignatarioDoContrato[];
  documentos: DocumentoDoContrato[];
  historico: FatoDoContrato[];
  ultimaConferenciaEm: string | null;
  /** O que falta para pedir aprovação (lista vazia = pode pedir). */
  faltaParaEnviar: string[];
  /** A emissão (F2): antes do envio traz o molde e a minuta; depois dele, ou no fantasma e no importado, nulo. */
  emissao: EmissaoNaFicha | null;
}

/** De onde vem o valor de um campo do molde: da proposta aceita, escrito no contrato, ou de lugar nenhum (lacuna). */
export type FonteDoCampoDoMolde = 'aceite' | 'contrato' | 'falta';

/** Um campo que a tela mostra na seção "Dados que entram no molde". */
export interface CampoDaEmissao {
  nome: string;
  rotulo: string;
  tipo: 'texto' | 'lista' | 'opcional';
  fonte: FonteDoCampoDoMolde;
  valor: string | string[] | null;
}

export interface MinutaDaEmissao {
  documentoId: string;
  hash: string;
  conteudo: string;
  origem: 'modelo' | 'sistema';
  /** Molde versionado, nota do Drive, ou o texto simples de aditivo e distrato. */
  base: 'molde' | 'drive' | 'texto_simples';
  geradaEm: string | null;
  lacunas: string[];
  avisos: string[];
  laudo: LaudoDoContrato | null;
  /** Modalidade, CNPJ que fatura ou campos mudaram depois que a minuta foi gerada. */
  desatualizada: boolean;
}

export interface EmissaoNaFicha {
  temAceite: boolean;
  /** A primeira linha da faixa do timbre e a data do molde. Nulos sem modalidade, e no aditivo e no distrato. */
  molde: { titulo: string; data: string } | null;
  campos: CampoDaEmissao[];
  minuta: MinutaDaEmissao | null;
  /** Quem pode assinar pela Root: gente ativa e titular desta empresa. */
  titulares: { nome: string; email: string }[];
  /** O pedido de envio que está esperando outra pessoa titular, se houver. */
  envioNaFila: string | null;
}

export interface ResultadoDaConferencia {
  contratoId: string;
  estado: EstadoDoContrato;
  mudou: boolean;
  assinaturas: { feitas: number; total: number };
  frase: string;
}

// ---------------------------------------------------------------------------
// O que a API recebe
// ---------------------------------------------------------------------------

export const SignatarioNovoSchema = z.object({
  papel: z.enum(['cliente', 'root']),
  nome: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(254),
});
export type SignatarioNovoDoContrato = z.infer<typeof SignatarioNovoSchema>;

const dataAAAAMMDD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ContratoCriarSchema = z.object({
  leadId: z.string().min(1),
  modalidade: z.enum(MODALIDADES_DE_CONTRATO),
});
export type ContratoCriarInput = z.infer<typeof ContratoCriarSchema>;

export const ContratoEditarSchema = z.object({
  modalidade: z.enum(MODALIDADES_DE_CONTRATO).optional(),
  numero: z.string().trim().max(60).nullable().optional(),
  vigenciaInicio: dataAAAAMMDD.nullable().optional(),
  vigenciaFim: dataAAAAMMDD.nullable().optional(),
  faturaPor: z.string().trim().max(200).nullable().optional(),
  /** Os campos do molde escritos à mão. Junta com o que já há; nulo apaga aquele campo. */
  campos: z
    .record(
      z.string().regex(/^[a-z0-9_]{1,60}$/),
      z.union([z.string().trim().max(4000), z.array(z.string().trim().min(1).max(2000)).max(40), z.null()]),
    )
    .refine((v) => Object.keys(v).length <= 60, { message: 'Campos demais de uma vez.' })
    .optional(),
});
export type ContratoEditarInput = z.infer<typeof ContratoEditarSchema>;

/** A lista inteira de signatários: tem de haver ao menos um de cada lado. O contrato da Root não leva testemunha. */
export const SignatariosSchema = z
  .object({ signatarios: z.array(SignatarioNovoSchema).min(2).max(10) })
  .refine((v) => v.signatarios.some((s) => s.papel === 'cliente') && v.signatarios.some((s) => s.papel === 'root'), {
    message: 'O contrato precisa de ao menos um signatário do cliente e um da Root.',
  })
  .refine((v) => new Set(v.signatarios.map((s) => s.email.toLowerCase())).size === v.signatarios.length, {
    message: 'O mesmo e-mail aparece em dois signatários.',
  });
export type SignatariosInput = z.infer<typeof SignatariosSchema>;

export const ContratoFilhoSchema = z.object({
  tipo: z.enum(['aditivo', 'distrato']),
  motivo: z.string().trim().min(5).max(1000),
  /** O que muda, em uma linha por item (aditivo), ou a última data de vigência (distrato). */
  mudancas: z.string().trim().max(4000).optional(),
  vigenciaFim: dataAAAAMMDD.optional(),
  valorCentavos: z.number().int().min(0).optional(),
  /** Distrato com parcela em aberto: a pessoa viu que a cobrança NÃO é cancelada. */
  cienteDasParcelas: z.boolean().optional(),
});
export type ContratoFilhoInput = z.infer<typeof ContratoFilhoSchema>;

export const ContratoFimSchema = z.object({
  motivo: z.string().trim().min(5).max(500),
  cienteDasParcelas: z.boolean().optional(),
});
export type ContratoFimInput = z.infer<typeof ContratoFimSchema>;

/** Reabrir: o motivo é opcional, na ficha e no lote. O fim já tem o motivo dele no fio. */
export const ContratoReabrirSchema = z.object({ motivo: z.string().trim().min(5).max(500).optional() });
export type ContratoReabrirInput = z.infer<typeof ContratoReabrirSchema>;

export const ContratoCancelarSchema = z.object({ motivo: z.string().trim().min(5).max(500) });
export type ContratoCancelarInput = z.infer<typeof ContratoCancelarSchema>;

export const ContratoLoteSchema = z.object({
  acao: z.enum(['conferir', 'encerrar', 'reabrir']),
  ids: z.array(z.string().min(1)).min(1).max(100),
  motivo: z.string().trim().min(5).max(500).optional(),
});
export type ContratoLoteInput = z.infer<typeof ContratoLoteSchema>;

export interface ResultadoDoLote {
  ok: string[];
  recusados: { id: string; motivo: string }[];
  /** O que a política reteve, à espera de aprovação: nem feito, nem recusado. */
  retidos?: { id: string; approvalId: string | null }[];
}

/** Os fatos do fio deste módulo (o histórico continua sendo gravado: a entidade não o substitui). */
export const FATOS_DO_CONTRATO = [
  'contrato.registrado',
  'contrato.minuta_aprovada',
  'contrato.conferido',
  'contrato.cancelado',
  'contrato.reenviado',
  'contrato.aditivo',
  'contrato.distrato',
  'contrato.reaberto',
] as const;
