// DTO do exercício F08. A alçada e o snapshot vêm do servidor.
export type Alcada = 'operador' | 'responsavel' | 'titular';
export type TipoFinanceiro = 'entrada' | 'saida';
export interface ContaQA {
  id: string; nome: string; currency: string; provider: 'manual'; ativa: boolean;
}
export interface CondicoesFinanceirasQA {
  descricao: string; tipo: TipoFinanceiro; valorCanonico: string; currency: string;
  competencia: string; vencimento: string; conta: ContaQA;
  contrato: {
    id: string; descricao: string; tipo: TipoFinanceiro; valorCanonico: string;
    diaVencimento: number;
    periodicidade: 'mensal' | 'bimestral' | 'trimestral' | 'semestral' | 'anual';
    dataInicio: string; dataFim: string | null; status: 'ativo' | 'pausado' | 'encerrado';
  };
  contraparte: { id: string; razaoSocial: string; ativo: boolean };
  classificacao: { id: string; codigo: string; nome: string; ativo: boolean; permiteLancamento: boolean };
  projetoFinanceiro: { id: string; nome: string; ativo: boolean } | null;
  departamento: { id: string; nome: string; ativo: boolean } | null;
  temRateio: false;
}
export interface DecisaoFinanceiraQA {
  id: string; requestId: string; versionId: string; contentHash: string;
  ator: { id: string; nome: string }; decididoEm: string; aprovar: boolean; motivo: string;
  alcadaExigida: 'responsavel'; alcadaVerificada: 'responsavel' | 'titular';
}
export interface ResultadoFinanceiroQA {
  status: 'previsto'; approvalStatus: 'aprovado' | 'rejeitado'; paidAt: null; reconciledAt: null;
  pagamentoExecutado: false; cobrancaExecutada: false; conciliacaoExecutada: false;
}
export interface ObrigacaoFinanceiraQA {
  modo: 'exercicio'; fonte: 'financeiro_local_qa'; consultadoEm: string; orgId: string;
  transactionId: string; versionId: string; contentHash: string; expectedUpdatedAt: string;
  valorCanonico: string; currency: string; tipo: TipoFinanceiro;
  status: 'previsto'; approvalStatus: 'aguardando' | 'aprovado' | 'rejeitado';
  paidAt: null; reconciledAt: null; conta: ContaQA;
  origem: { tipo: 'contrato_recorrente_qa'; contractId: string; descricao: string; vencimentoGerado: string; comercial: null };
  condicoes: CondicoesFinanceirasQA;
  decisao: DecisaoFinanceiraQA | null; historico: DecisaoFinanceiraQA[];
  canDecide: boolean; alcadaExigida: 'responsavel'; alcadaAtual: Alcada | null; impedimento: string | null;
}
export interface PedidoDecisaoFinanceiraQA {
  requestId: string; versionId: string; contentHash: string; expectedUpdatedAt: string;
  aprovar: boolean; motivo: string;
}
export interface RespostaDecisaoFinanceiraQA {
  modo: 'exercicio'; orgId: string; transactionId: string; decisionId: string;
  versionId: string; contentHash: string; decisao: DecisaoFinanceiraQA;
  resultado: ResultadoFinanceiroQA; replayed: boolean;
}
