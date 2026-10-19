/*
 * AS PROPOSTAS PUBLICADAS PELA SALA, na tela Propostas do Lucas (versão final,
 * decisão 1 do Rodrigo, 19/10/2026).
 *
 * A tela de Propostas mostra duas origens lado a lado:
 *   · `sala`: a proposta publicada no cockpit (`proposta.publicada`) e lida
 *     pelo cliente em `/s/<token>/proposta`, da empresa da sessão, com
 *     `leads.ver`. A leitura é a soma das batidas por seção (`LeadReacao`
 *     `leitura`) e o `proposta.lida` da sala de antes; as reações são as
 *     linhas "faz sentido", dúvida e ideia; o aceite é o fato `proposta.aceita`;
 *   · `servico`: as propostas antigas do serviço de propostas da ROOT, só na
 *     sessão da plataforma, como antes.
 *
 * Tudo é CONTAGEM do que está gravado. A sala não identifica navegador nem
 * aparelho: "pessoas" e "aparelho" ficam ausentes nas linhas da sala.
 */
import type { AnotacaoDoLead, PropostaSecao } from './comercial.js';

/** 0 publicada · 1 abriu · 2 leu o investimento · 3 aceitou (na sala) ou clicou em pagar (no serviço). */
export type EtapaDaPropostaLida = 0 | 1 | 2 | 3;

export interface PropostaDaSalaNaLista {
  leadId: string;
  /** A empresa da ficha ou o nome do lead. */
  cliente: string;
  /** O produto e a versão ("Imersão · v2"). */
  titulo: string;
  versao: number;
  produto: string | null;
  /** O valor publicado (R$). */
  valor: number | null;
  publicadaEm: string;
  etapa: EtapaDaPropostaLida;
  /** A frase da situação ("Aceita", "Leu o investimento"...). */
  estado: string;
  /** Visitas distintas com leitura da versão vigente. */
  aberturas: number;
  ultimaAtividade: string | null;
  reacoes: { fazSentido: number; duvidas: number; ideias: number };
  aceitaEm: string | null;
  /** A primeira parcela paga (Pix, boleto ou cartão), quando o fato existe. */
  pagaEm: string | null;
  /** A etapa do lead no funil agora. */
  etapaDoLead: string;
}

export interface PropostasDaSala {
  propostas: PropostaDaSalaNaLista[];
  /** Quantas propostas ficaram fora do teto de leitura. */
  foraDoTeto: number;
}

export interface TempoDaSecao {
  secao: PropostaSecao;
  nome: string;
  segundos: number;
  /** Quantas visitas leram esta seção. */
  aberturasQueViram: number;
}

export interface VisitaDaSala {
  /** O número da visita (`SalaDoCliente.acessos` no momento da leitura). */
  acesso: number;
  quando: string;
  segundos: number;
  /** A seção mais adiante que a visita leu. */
  leuAte: string;
}

export interface DetalheDaPropostaDaSala extends PropostaDaSalaNaLista {
  tempoTotalSegundos: number;
  maisVista: string | null;
  tempoPorParte: TempoDaSecao[];
  visitas: VisitaDaSala[];
  /** "faz sentido" por seção (cada visita conta uma vez). */
  fazSentidoPorSecao: { secao: PropostaSecao; nome: string; vezes: number }[];
  /** Dúvidas e ideias deixadas na versão vigente (texto já mascarado na gravação). */
  anotacoes: AnotacaoDoLead[];
}
