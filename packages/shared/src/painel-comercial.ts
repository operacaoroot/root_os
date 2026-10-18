/*
 * PAINEL DO COMERCIAL (homologação, 18/10/2026).
 *
 * O CRM da casa é a lista de Trabalho "Gestão de Leads" (a mesma forma do
 * ClickUp: etapas, campos Canal de aquisição, Vendedor, Valor em negociação e
 * Data de Cadastro do Lead). O painel só LÊ essa lista; mover o cartão no
 * quadro é o que muda os números.
 *
 * Etapa fechada que se chama "fechado", "ganho", "contrato" ou "negócio
 * fechado" conta como venda; as demais fechadas (perdido, geladeira) contam como
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

export interface PainelComercialLead {
  id: string;
  titulo: string;
  etapa: string;
  valor: number | null;
  vendedor: string | null;
  canal: string | null;
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
  abertos: PainelComercialLead[];
}
