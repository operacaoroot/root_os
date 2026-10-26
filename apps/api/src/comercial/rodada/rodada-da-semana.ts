import {
  COMERCIAL_ROTULO_DA_ETAPA,
  ehSaida,
  instanteNoFuso,
  partesNoFuso,
  segundaDaSemana,
  somarDias,
  type ComercialEtapa,
} from '@mktos/shared';

/*
 * Layout 26/10: A RODADA DA SEMANA, CONTADA PELO OS.
 *
 * Até 26/10/2026 a tela `/comercial/rodada` era a `/operacao`: um texto escrito à
 * mão (`11-operacao/painel-root.md`) importado toda segunda. Decisão do Lucas: os
 * números da rodada saem do próprio sistema. Este arquivo tem só as regras puras
 * (a semana e a montagem da resposta); quem lê o banco é `rodada-da-semana.service.ts`.
 *
 *   · semana = segunda 00:00 a domingo 23:59 em São Paulo (fim exclusivo: a
 *     segunda seguinte 00:00);
 *   · entrou = `Lead.enteredAt` na semana;
 *   · movimento = fato `etapa.mudou` na semana para uma etapa do funil (as
 *     saídas vão para o quadro delas);
 *   · fechado = a mesma regra do Painel geral: o primeiro `cliente.ativo` ou, sem
 *     ele, a ficha em E9 (a data do cliente ativo ou a da entrada na etapa);
 *   · proposta enviada = fato `proposta.publicada` na semana (cada versão conta);
 *   · saída = fato `saida.registrada` na semana, com o motivo;
 *   · tarefas atrasadas e negociação = o estado de agora, não da semana.
 * Nada é estimado: sem valor, o negócio aparece e fica fora da soma.
 */

export const FUSO_DA_RODADA = 'America/Sao_Paulo';
const DIA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

export interface SemanaDaRodada {
  /** Segunda-feira (AAAA-MM-DD). */
  de: string;
  /** Domingo (AAAA-MM-DD). */
  ate: string;
  inicio: Date;
  /** Exclusivo: a segunda seguinte, 00:00 de São Paulo. */
  fim: Date;
  anterior: string;
  /** A segunda da semana seguinte, ou null quando a semana pedida é a atual. */
  proxima: string | null;
  atual: boolean;
}

/** A semana (segunda a domingo, São Paulo) do dia pedido; sem dia válido, a de agora. Semana futura vira a atual. */
export function semanaDaRodada(pedido: unknown, agora: Date = new Date()): SemanaDaRodada {
  const hoje = partesNoFuso(agora, FUSO_DA_RODADA).dia;
  const segundaDeHoje = segundaDaSemana(hoje);
  const texto = typeof pedido === 'string' ? pedido.trim() : '';
  let de = DIA_CIVIL.test(texto) && !Number.isNaN(Date.parse(`${texto}T12:00:00Z`)) ? segundaDaSemana(texto) : segundaDeHoje;
  if (de > segundaDeHoje) de = segundaDeHoje;
  const atual = de === segundaDeHoje;
  return {
    de,
    ate: somarDias(de, 6),
    inicio: instanteNoFuso(de, '00:00', FUSO_DA_RODADA),
    fim: instanteNoFuso(somarDias(de, 7), '00:00', FUSO_DA_RODADA),
    anterior: somarDias(de, -7),
    proxima: atual ? null : somarDias(de, 7),
    atual,
  };
}

export const naSemana = (s: Pick<SemanaDaRodada, 'inicio' | 'fim'>, d: Date | null | undefined): d is Date =>
  !!d && d.getTime() >= s.inicio.getTime() && d.getTime() < s.fim.getTime();

export function rotuloDaEtapa(etapa: string | null | undefined): string {
  if (!etapa) return '—';
  return COMERCIAL_ROTULO_DA_ETAPA[etapa as ComercialEtapa] ?? etapa;
}

const ROTULO_DO_MOTIVO: Record<string, string> = {
  sem_base: 'sem base',
  preco: 'preço',
  sumiu: 'sumiu',
  momento: 'momento',
  nao_e_cliente_root: 'não é cliente Root',
  outro: 'outro',
};

export function rotuloDoMotivo(motivo: string | null | undefined): string {
  if (!motivo) return 'sem motivo';
  return ROTULO_DO_MOTIVO[motivo] ?? motivo;
}

const ROTULO_DA_SAIDA: Record<string, string> = {
  perdido: 'Perdido',
  geladeira: 'Geladeira',
  desqualificado: 'Desqualificado',
  parceiro: 'Enviado a parceiro',
};

// ---------------------------------------------------------------------------
// A resposta
// ---------------------------------------------------------------------------

export interface RodadaLeadNaSemana {
  leadId: string;
  nome: string;
  etapa: string;
  canal: string | null;
  em: string;
}
export interface RodadaMovimento {
  leadId: string;
  nome: string;
  de: string;
  para: string;
  /** true quando uma pessoa moveu o cartão (o fato `etapa.movida_a_mao` na mesma mudança). */
  aMao: boolean;
  por: string | null;
  em: string;
}
export interface RodadaFechado {
  leadId: string;
  nome: string;
  valor: number | null;
  produto: string | null;
  em: string;
}
export interface RodadaProposta {
  leadId: string;
  nome: string;
  versao: number | null;
  valor: number | null;
  em: string;
}
export interface RodadaSaida {
  leadId: string;
  nome: string;
  saida: string;
  motivo: string;
  detalhe: string | null;
  voltaEm: string | null;
  por: string | null;
  em: string;
}
export interface RodadaTarefaAtrasada {
  id: string;
  titulo: string;
  prazo: string | null;
  pessoa: string | null;
  lead: { id: string; nome: string } | null;
}
export interface RodadaDaSemanaResposta {
  semana: { de: string; ate: string; anterior: string; proxima: string | null; atual: boolean };
  geradoEm: string;
  entraram: RodadaLeadNaSemana[];
  movimentos: RodadaMovimento[];
  fechados: RodadaFechado[];
  valorFechado: number;
  propostas: RodadaProposta[];
  saidas: RodadaSaida[];
  /** Estado de agora (não da semana). */
  tarefasAtrasadas: RodadaTarefaAtrasada[];
  /** Estado de agora: a soma das propostas em aberto no funil (o mesmo número do Painel geral). */
  negociacao: { total: number; abertos: number; pagante: number | null; semCaixa: number | null };
}

/** O lead como as linhas o mostram: a empresa da ficha ou, sem ela, o nome do contato. */
export interface LeadDaRodada {
  id: string;
  nome: string;
  empresa: string | null;
}
export const nomeDoLead = (l: LeadDaRodada | undefined, id: string) => (l ? l.empresa || l.nome : id);

export interface FatoDaRodada {
  leadId: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const campos = (p: unknown): Record<string, unknown> => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});
const maisNovoPrimeiro = <T extends { em: string }>(a: T, b: T) => b.em.localeCompare(a.em);

/**
 * Os movimentos da semana: um por `etapa.mudou` para etapa do funil. O `etapa.movida_a_mao`
 * da mesma mudança (mesmo lead, mesmo de/para, até 1 s depois) diz que foi uma pessoa, e quem.
 */
export function movimentosDaSemana(fatos: readonly FatoDaRodada[], leads: ReadonlyMap<string, LeadDaRodada>): RodadaMovimento[] {
  const aMao = fatos.filter((f) => f.type === 'etapa.movida_a_mao');
  return fatos
    .filter((f) => f.type === 'etapa.mudou')
    .flatMap((f) => {
      const p = campos(f.payload);
      const para = texto(p.para);
      if (!para || ehSaida(para as ComercialEtapa)) return [];
      const de = texto(p.de);
      const mao = aMao.find((m) => {
        const q = campos(m.payload);
        const dt = m.occurredAt.getTime() - f.occurredAt.getTime();
        return m.leadId === f.leadId && q.de === de && q.para === para && dt >= 0 && dt <= 1000;
      });
      return [{
        leadId: f.leadId,
        nome: nomeDoLead(leads.get(f.leadId), f.leadId),
        de: rotuloDaEtapa(de),
        para: rotuloDaEtapa(para),
        aMao: !!mao,
        por: mao ? texto(campos(mao.payload).por) : null,
        em: f.occurredAt.toISOString(),
      }];
    })
    .sort(maisNovoPrimeiro);
}

/** As saídas da semana (`saida.registrada`), com o motivo em palavras. */
export function saidasDaSemana(fatos: readonly FatoDaRodada[], leads: ReadonlyMap<string, LeadDaRodada>): RodadaSaida[] {
  return fatos
    .filter((f) => f.type === 'saida.registrada')
    .map((f) => {
      const p = campos(f.payload);
      const saida = texto(p.saida) ?? '';
      return {
        leadId: f.leadId,
        nome: nomeDoLead(leads.get(f.leadId), f.leadId),
        saida: ROTULO_DA_SAIDA[saida] ?? (saida || 'Saída'),
        motivo: rotuloDoMotivo(texto(p.motivo)),
        detalhe: texto(p.detalhe),
        voltaEm: texto(p.voltaEm),
        por: texto(p.por),
        em: f.occurredAt.toISOString(),
      };
    })
    .sort(maisNovoPrimeiro);
}

/** As propostas enviadas na semana: cada `proposta.publicada` (versão e valor do fato). */
export function propostasDaSemana(fatos: readonly FatoDaRodada[], leads: ReadonlyMap<string, LeadDaRodada>): RodadaProposta[] {
  return fatos
    .filter((f) => f.type === 'proposta.publicada')
    .map((f) => {
      const p = campos(f.payload);
      const centavos = numero(p.valorCentavos);
      return {
        leadId: f.leadId,
        nome: nomeDoLead(leads.get(f.leadId), f.leadId),
        versao: numero(p.versao),
        valor: centavos == null ? null : centavos / 100,
        em: f.occurredAt.toISOString(),
      };
    })
    .sort(maisNovoPrimeiro);
}

/**
 * Quando cada lead fechou, pela regra do Painel geral: o primeiro `cliente.ativo`; sem
 * ele, a ficha em E9 (a data do cliente ativo da ficha, ou a da entrada na etapa).
 */
export function fechouEm(
  primeiroAtivo: Date | null | undefined,
  ficha: { etapa: string; clienteAtivoEm: Date | null; etapaDesde: Date } | null | undefined,
): Date | null {
  if (primeiroAtivo) return primeiroAtivo;
  if (ficha?.etapa === 'fechado') return ficha.clienteAtivoEm ?? ficha.etapaDesde;
  return null;
}
