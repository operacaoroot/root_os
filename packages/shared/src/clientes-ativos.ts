/*
 * CLIENTES ATIVOS NUMA LISTA SÓ (P-84, pedido do Lucas em 27/10/2026: "Clientes ativos
 * em comercial, clientes ativos em wpp, clientes ativos... tá tudo desconectado").
 *
 * O cliente mora em cinco lugares que não se ligam (catálogo, "Diagnóstico"): o lead
 * fechado no funil, o cadastro do Financeiro (`Partner`), o acordo da Análise, o
 * contrato vivo (fio do lead) e a conversa do WhatsApp; a implantação é um card no
 * Trabalho. Esta lista SÓ LÊ os cinco e junta por cliente: cada linha diz onde ele
 * está e o que falta. A única escrita é "Criar cadastro" para o lead fechado sem
 * cadastro, pela régua do "Iniciar onboarding" (a mesma do WhatsApp, P-83).
 *
 * Quem entra: quem tem acordo na Análise, lead em E9 · Negócio fechado, contrato vivo
 * que não foi concluído nem desativado, ou cadastro de cliente com grupo do WhatsApp.
 */

import type { ComercialTipoDeNegocio, SituacaoDoContrato } from './comercial.js';

/** As partes de um cliente, na ordem da tela. */
export const PARTES_DO_CLIENTE = ['funil', 'cadastro', 'acordo', 'contrato', 'whatsapp', 'implantacao'] as const;
export type ParteDoCliente = (typeof PARTES_DO_CLIENTE)[number];

export const ROTULO_DA_PARTE_DO_CLIENTE: Record<ParteDoCliente, string> = {
  funil: 'Funil',
  cadastro: 'Cadastro',
  acordo: 'Acordo',
  contrato: 'Contrato',
  whatsapp: 'WhatsApp',
  implantacao: 'Implantação',
};

/** O que cada lacuna quer dizer, em uma frase (a dica da célula vazia). */
export const FALTA_DA_PARTE_DO_CLIENTE: Record<ParteDoCliente, string> = {
  funil: 'Não está no funil como negócio fechado. "Registrar cliente já fechado" no Funil põe.',
  cadastro: 'Sem cadastro de cliente: o Financeiro, as tarefas e o WhatsApp não o acham.',
  acordo: 'Sem acordo na Análise do Financeiro (tipo e valor do negócio).',
  contrato: 'Sem contrato vivo: o fechamento ou "Registrar cliente já fechado" cria.',
  whatsapp: 'Nenhuma conversa do WhatsApp ligada a este cliente.',
  implantacao: 'Sem card de implantação em Clientes › Onboarding de cliente.',
};

export interface ClienteAtivo {
  /** `partner:<id>`, `lead:<id>` ou `acordo:<id>`: a linha é do cadastro quando ele existe. */
  chave: string;
  nome: string;
  tipo: ComercialTipoDeNegocio;
  /** Do acordo (soma) ou, sem ele, do valor negociado ou da proposta. */
  valor: number | null;
  funil: { leadId: string; etapa: string; rotulo: string } | null;
  cadastro: { id: string; nome: string; duplicados: number } | null;
  acordos: { id: string; produto: string; tipo: string; valor: number; fechadoEm: string | null }[];
  contrato: { leadId: string; situacao: SituacaoDoContrato } | null;
  whatsapp: { conversaId: string; nome: string }[];
  implantacao: { taskId: string; etapa: string } | null;
  /** As partes que faltam, na ordem de `PARTES_DO_CLIENTE`. */
  faltam: ParteDoCliente[];
  /** Lead fechado sem cadastro: dá para criar ali mesmo. */
  podeCriarCadastro: boolean;
}

export interface ListaDeClientesAtivos {
  clientes: ClienteAtivo[];
  porTipo: { tipo: ComercialTipoDeNegocio; total: number }[];
  /** Quantos têm ao menos uma lacuna. */
  comLacuna: number;
}
