/*
 * PAINEL DO COMERCIAL (homologação, 18/10/2026).
 *
 * O CRM da casa é a lista de Trabalho "Gestão de Leads" (etapas Validar →
 * Negócio fechado, campos Canal de aquisição, Vendedor, Valor da proposta e
 * Data de Cadastro do Lead). O painel só LÊ essa lista; mover o cartão no
 * quadro é o que muda os números.
 *
 * Etapa fechada que se chama "fechado", "ganho", "contrato" ou "negócio
 * fechado" conta como venda; as demais fechadas (Perdido, Desqualificado) contam como
 * perda. Etapas abertas são o que está em negociação.
 */
export type ResultadoDaEtapa = 'aberta' | 'ganho' | 'perdido';

export interface PainelComercialEtapa {
  nome: string;
  cor: string;
  resultado: ResultadoDaEtapa;
  qtd: number;
  valor: number;
}

export interface PainelComercialMes {
  /** `AAAA-MM` */
  mes: string;
  qtd: number;
  valor: number;
}

export interface PainelComercialGrupo {
  nome: string;
  cor: string | null;
  leads: number;
  abertos: number;
  emNegociacao: number;
  ganhos: number;
  valorGanho: number;
}

/** Um negócio do CRM, com tudo o que o painel filtra: etapa, mês, canal e vendedor. */
export interface PainelComercialNegocio {
  /** Id do cartão no Trabalho: a ficha do lead abre por ele. */
  id: string;
  titulo: string;
  etapa: string;
  etapaCor: string;
  resultado: ResultadoDaEtapa;
  valor: number | null;
  vendedor: string | null;
  canal: string | null;
  produto: string | null;
  /** `AAAA-MM` em que o lead entrou (Data de Cadastro do Lead, ou a criação do cartão). */
  mesEntrada: string;
  /** `AAAA-MM` em que foi para a etapa fechada; nulo enquanto aberto. */
  mesFechado: string | null;
  /** Dias na etapa atual; nulo quando a data de entrada na etapa não existe. */
  diasNaEtapa: number | null;
}

export interface PainelComercial {
  /** Nulo quando a empresa ainda não tem a lista do CRM. */
  lista: { id: string; nome: string } | null;
  ano: number;
  geradoEm: string;
  totais: {
    emNegociacao: number;
    abertos: number;
    ganhosNoAno: number;
    valorGanhoNoAno: number;
    perdidosNoAno: number;
    /** ganhos / (ganhos + perdidos) no ano, 0–100; nulo sem nenhum fechamento. */
    conversao: number | null;
    ticketMedio: number | null;
  };
  etapas: PainelComercialEtapa[];
  fechadosPorMes: PainelComercialMes[];
  entradasPorMes: PainelComercialMes[];
  canais: PainelComercialGrupo[];
  vendedores: PainelComercialGrupo[];
  /** Todos os negócios da lista, do maior valor para o menor. */
  negocios: PainelComercialNegocio[];
}

/** O rótulo usado quando o lead não tem canal ou vendedor preenchido. */
export const SEM_INFORMACAO = 'Sem informação';
