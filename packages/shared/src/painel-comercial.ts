/*
 * PAINEL GERAL DO COMERCIAL (versão final, 19/10/2026).
 *
 * A tela e o desenho são os do Lucas (18/10); os DADOS são os do cockpit: a
 * tabela `Lead` com a `ComercialFicha` (etapa, valor da proposta, produto,
 * canal de entrada, dono) e os fatos do fio (`cliente.ativo`, encerramento do
 * contrato). Nada vem mais da lista "Gestão de Leads" do Trabalho: na versão
 * final o organizador transforma aqueles cartões em leads do funil.
 *
 * O painel só LÊ. Quem move a etapa é o Funil vivo e o painel do lead.
 * Dado que não existe (lead sem canal, sem dono, sem valor) aparece como
 * ausente, nunca como zero inventado.
 */
import type { ComercialEtapa } from './comercial.js';

/**
 * O que a etapa quer dizer para o painel: em negociação (E1 a E8), ganho (E9),
 * perdido (desqualificado, perdido, enviado a parceiro) ou na geladeira
 * (pausa com data de volta: não está em negociação e não é perda).
 */
export type ResultadoDaEtapa = 'aberta' | 'ganho' | 'perdido' | 'pausa';

export interface PainelComercialEtapa {
  /** A etapa do cockpit (`ComercialEtapa`). */
  id: ComercialEtapa;
  nome: string;
  cor: string;
  resultado: ResultadoDaEtapa;
  qtd: number;
  /** Soma do valor da proposta dos negócios com valor; os sem valor não entram na soma. */
  valor: number;
}

export interface PainelComercialMes {
  /** `AAAA-MM` */
  mes: string;
  qtd: number;
  valor: number;
  /** Layout 26/10: a parte do valor que não gera caixa (parceria, permuta, repasse), quando vem dos acordos. */
  valorSemCaixa?: number;
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

/** Um negócio = um lead do cockpit, com tudo o que o painel filtra. */
export interface PainelComercialNegocio {
  /** Id do lead: o painel do lead abre em `/comercial/lead/<id>`. */
  id: string;
  /** A empresa da ficha ou, sem ela, o nome do lead. */
  titulo: string;
  /** O nome do lead (quem fala), para casar com outras telas. */
  nome: string;
  etapaChave: ComercialEtapa;
  etapa: string;
  etapaCor: string;
  resultado: ResultadoDaEtapa;
  /** Valor da proposta (R$). Nulo quando a ficha ainda não tem valor. */
  valor: number | null;
  vendedor: string | null;
  canal: string | null;
  produto: string | null;
  /** O contato do lead (telefone ou e-mail), quando existe. */
  contato: string | null;
  atualizadoEm: string;
  /** `AAAA-MM` em que o lead entrou. */
  mesEntrada: string;
  /** `AAAA-MM` do fechamento (ganho) ou da saída (perdido); nulo enquanto aberto. */
  mesFechado: string | null;
  /** `AAAA-MM` de cada fechamento (hoje, um por lead). */
  mesesFechados: string[];
  /** Dias na etapa atual. */
  diasNaEtapa: number | null;
  /** O cliente está ativo hoje (fechou e o contrato não foi encerrado). */
  clienteAtivo: boolean;
}

export interface PainelComercial {
  ano: number;
  geradoEm: string;
  totais: {
    emNegociacao: number;
    /** Layout 26/10: a parte pagante e a sem caixa (parceria, permuta, repasse) da negociação. */
    emNegociacaoPagante?: number;
    emNegociacaoSemCaixa?: number;
    abertos: number;
    ganhosNoAno: number;
    valorGanhoNoAno: number;
    /** Layout 26/10: o que veio pro bolso no ano (só pagantes). */
    ganhosPagantesNoAno?: number;
    valorGanhoPaganteNoAno?: number;
    perdidosNoAno: number;
    /** Na geladeira agora. */
    naGeladeira: number;
    /** ganhos / (ganhos + perdidos) no ano, 0–100; nulo sem nenhum fechamento. */
    conversao: number | null;
    /** Média do valor dos fechamentos do ano que têm valor; nulo sem nenhum. */
    ticketMedio: number | null;
    /** Fechamentos do ano sem valor na ficha (ficam fora do ticket médio). */
    ganhosSemValor: number;
    /** Clientes que fecharam e não tiveram o contrato encerrado. */
    clientesAtivos: number;
    /** Contratos vivos: `cliente.ativo` sem encerramento (a mesma conta de Contratos vivos). */
    contratosVivos: number;
    /**
     * INTEGRAÇÃO (26/10/2026): os clientes pelos ACORDOS do Financeiro (pagante,
     * parceria, permuta, repasse), um por cliente (o cadastro duplicado conta no
     * principal). É o "clientes ativos" de verdade: o funil só vê quem fechou nele.
     */
    clientesPorAcordo?: { total: number; porTipo: { tipo: string; clientes: string[] }[] };
  };
  etapas: PainelComercialEtapa[];
  fechadosPorMes: PainelComercialMes[];
  entradasPorMes: PainelComercialMes[];
  canais: PainelComercialGrupo[];
  vendedores: PainelComercialGrupo[];
  /** Todos os negócios, do maior valor para o menor. */
  negocios: PainelComercialNegocio[];
  /** Quando a leitura bate no teto de leads, quantos ficaram de fora. */
  foraDoTeto: number;
}

/** O rótulo usado quando o lead não tem canal ou vendedor preenchido. */
export const SEM_INFORMACAO = 'Sem informação';

/** O canal de entrada da ficha (C07) como a tela mostra. */
export const ROTULO_DO_CANAL_DE_ENTRADA: Record<string, string> = {
  conteudo: 'Conteúdo',
  erp_parceiro: 'ERP parceiro',
  indicacao: 'Indicação',
  evento: 'Evento',
  comunidade: 'Comunidade',
  site: 'Site',
};

/** O resultado de cada etapa do cockpit no painel. */
export function resultadoDaEtapaDoCockpit(etapa: ComercialEtapa): ResultadoDaEtapa {
  if (etapa === 'fechado') return 'ganho';
  if (etapa === 'geladeira') return 'pausa';
  if (etapa === 'desqualificado' || etapa === 'perdido' || etapa === 'parceiro') return 'perdido';
  return 'aberta';
}

/*
 * A LISTA DE LEADS (versão final, decisão 2): a tabela `Lead` do cockpit, com a
 * etapa, o canal e o dono da ficha. É a base para a lista de transmissão e de
 * e-mail; daqui nada é enviado, a tela só copia e exporta o recorte.
 */
export interface LinhaDaListaDeLeads {
  id: string;
  /** O nome do lead (quem fala). */
  contato: string;
  empresa: string | null;
  telefone: string | null;
  email: string | null;
  etapaChave: ComercialEtapa;
  etapa: string;
  canal: string | null;
  dono: string | null;
  entrouEm: string;
  /** O último fato do fio do lead ou a última mudança da ficha. */
  ultimaAtividade: string;
  /** Valor da proposta na ficha (R$), o mesmo do Painel; nulo sem proposta. */
  valor?: number | null;
}

export interface ListaDeLeads {
  leads: LinhaDaListaDeLeads[];
  /** Quantos leads ficaram fora do teto de leitura. */
  foraDoTeto: number;
}
