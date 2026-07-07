/**
 * @deprecated Usar tabela `template_contas` no banco via RPC `importar_template_pack`.
 * Este arquivo é mantido como referência/fallback offline.
 * Não usar diretamente para importação — a fonte de verdade é a tabela `template_contas`.
 */
export interface PlanoContasTemplate {
    codigo: string
    nome: string
    tipo: 'receita' | 'despesa'
    nivel: number
    permite_lancamento: boolean
    dre_conta?: string
    /** Código da linha DRE no template (FK virtual → dre_linhas.codigo) */
    dre_linha_codigo?: string
}

/**
 * Template FullBPO — Plano de Contas Gerencial
 *
 * Classificações-pai (Nível 1) — padrão contábil:
 *   1. Receita
 *   2. Deduções
 *   3. Custo
 *   4. Despesa
 *   5. Investimentos
 *
 * O usuário pode incluir subcontas em qualquer nível,
 * ou criar novos grupos-pai. O template define o baseline.
 */
export const TEMPLATE_FULLBPO: PlanoContasTemplate[] = [
    // ==========================================
    // 1. RECEITA
    // ==========================================
    { codigo: '1', nome: 'Receita', tipo: 'receita', nivel: 1, permite_lancamento: false },

    // 1.1 Receitas Operacionais (Faturamento Bruto)
    { codigo: '1.1', nome: 'Receitas Operacionais', tipo: 'receita', nivel: 2, permite_lancamento: false },
    { codigo: '1.1.01', nome: 'Venda de Mercadoria Fabricada', tipo: 'receita', nivel: 3, permite_lancamento: true, dre_conta: 'Receita Bruta de Vendas', dre_linha_codigo: 'FB' },
    { codigo: '1.1.02', nome: 'Serviços Prestados', tipo: 'receita', nivel: 3, permite_lancamento: true, dre_conta: 'Receita Bruta de Vendas', dre_linha_codigo: 'FB' },
    { codigo: '1.1.03', nome: 'Revenda de Mercadoria', tipo: 'receita', nivel: 3, permite_lancamento: true, dre_conta: 'Receita Bruta de Vendas', dre_linha_codigo: 'FB' },

    // 1.2 Receitas Financeiras
    { codigo: '1.2', nome: 'Receitas Financeiras', tipo: 'receita', nivel: 2, permite_lancamento: false },
    { codigo: '1.2.01', nome: 'Rendimentos de Aplicações', tipo: 'receita', nivel: 3, permite_lancamento: true, dre_conta: 'Outras Receitas', dre_linha_codigo: 'RFP' },
    { codigo: '1.2.02', nome: 'Dividendos Recebidos', tipo: 'receita', nivel: 3, permite_lancamento: true, dre_conta: 'Outras Receitas', dre_linha_codigo: 'RI' },
    { codigo: '1.2.03', nome: 'Juros Recebidos', tipo: 'receita', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'RFP' },
    { codigo: '1.2.04', nome: 'Descontos Obtidos', tipo: 'receita', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'RFP' },

    // 1.3 Outras Entradas
    { codigo: '1.3', nome: 'Outras Entradas', tipo: 'receita', nivel: 2, permite_lancamento: false },
    { codigo: '1.3.01', nome: 'Adiantamento de Clientes', tipo: 'receita', nivel: 3, permite_lancamento: true },
    { codigo: '1.3.02', nome: 'Reembolso de Despesas', tipo: 'receita', nivel: 3, permite_lancamento: true, dre_conta: 'Recuperação de Despesas Variáveis', dre_linha_codigo: 'DO_DEV' },
    { codigo: '1.3.03', nome: 'Empréstimos Bancários', tipo: 'receita', nivel: 3, permite_lancamento: true },
    { codigo: '1.3.04', nome: 'Venda de Ativos', tipo: 'receita', nivel: 3, permite_lancamento: true },

    // ==========================================
    // 2. DEDUÇÕES
    // ==========================================
    { codigo: '2', nome: 'Deduções', tipo: 'despesa', nivel: 1, permite_lancamento: false },

    // 2.1 Impostos sobre Vendas
    { codigo: '2.1', nome: 'Impostos sobre Vendas', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '2.1.01', nome: 'ICMS', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'ISV' },
    { codigo: '2.1.02', nome: 'IPI', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'ISV' },
    { codigo: '2.1.03', nome: 'PIS', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'ISV' },
    { codigo: '2.1.04', nome: 'COFINS', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'ISV' },
    { codigo: '2.1.05', nome: 'ISS', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'ISV' },
    { codigo: '2.1.06', nome: 'IRPJ', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'ISV' },
    { codigo: '2.1.07', nome: 'Contribuição Social', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'ISV' },
    { codigo: '2.1.08', nome: 'Simples Nacional (DAS)', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'ISV' },

    // 2.2 Devoluções e Abatimentos
    { codigo: '2.2', nome: 'Devoluções e Abatimentos', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '2.2.01', nome: 'Devoluções de Vendas de Mercadoria', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Deduções de Receita', dre_linha_codigo: 'DEV' },
    { codigo: '2.2.02', nome: 'Devoluções de Vendas de Serviços', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Deduções de Receita', dre_linha_codigo: 'DEV' },
    { codigo: '2.2.03', nome: 'Descontos Concedidos', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'DESC' },

    // 2.3 Frete e Comissões sobre Vendas
    { codigo: '2.3', nome: 'Frete e Comissões sobre Vendas', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '2.3.01', nome: 'Frete S/ Vendas', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'FRV' },
    { codigo: '2.3.02', nome: 'Comissões Parceiros S/ Vendas', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'CPV' },

    // ==========================================
    // 3. CUSTO
    // ==========================================
    { codigo: '3', nome: 'Custo', tipo: 'despesa', nivel: 1, permite_lancamento: false },

    // 3.1 Custos Diretos
    { codigo: '3.1', nome: 'Custos Diretos', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '3.1.01', nome: 'Custos Gerais', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'CD_GER' },
    { codigo: '3.1.02', nome: 'Compra de Serviços', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Custo dos Serviços Prestados', dre_linha_codigo: 'CD_SRV' },
    { codigo: '3.1.03', nome: 'Software', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'CD_SW' },
    { codigo: '3.1.04', nome: 'Compra de Matéria Prima', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'CD_GER' },
    { codigo: '3.1.05', nome: 'Compras para Revenda', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'CD_GER' },
    { codigo: '3.1.06', nome: 'Despesa a Identificar', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'CD_NI' },
    { codigo: '3.1.07', nome: 'Almoço com Cliente', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'CD_CLI' },
    { codigo: '3.1.08', nome: 'Outras Despesas ADM Operacional', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'CD_ADM' },

    // 3.2 Custos com Pessoal
    { codigo: '3.2', nome: 'Custos com Pessoal', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '3.2.01', nome: 'Salários', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_SAL' },
    { codigo: '3.2.02', nome: 'Adiantamento Salarial', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_SAL' },
    { codigo: '3.2.03', nome: 'Férias', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_SAL' },
    { codigo: '3.2.04', nome: 'Rescisões', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_SAL' },
    { codigo: '3.2.05', nome: '13º Salário', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_13' },
    { codigo: '3.2.06', nome: 'INSS', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_SAL' },
    { codigo: '3.2.07', nome: 'FGTS', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_SAL' },
    { codigo: '3.2.08', nome: 'IRRF Folha', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_SAL' },
    { codigo: '3.2.09', nome: 'Pensão Alimentícia', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_SAL' },
    { codigo: '3.2.10', nome: 'Assistência Médica', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_AM' },
    { codigo: '3.2.11', nome: 'Vale Transporte', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_VT' },
    { codigo: '3.2.12', nome: 'Vale Refeição', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_VR' },
    { codigo: '3.2.13', nome: 'Ajuda de Custo', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_AC' },
    { codigo: '3.2.14', nome: 'Prestadores de Serviços (PJ)', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_PJ' },
    { codigo: '3.2.15', nome: 'Comissões PJ', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_COM' },
    { codigo: '3.2.16', nome: 'Seguro de Vida', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas com Pessoal', dre_linha_codigo: 'CP_AM' },

    // 3.3 Custos Operacionais Indiretos
    { codigo: '3.3', nome: 'Custos Operacionais Indiretos', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '3.3.01', nome: 'Custos Operacionais Indiretos', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'COI' },

    // ==========================================
    // 4. DESPESA
    // ==========================================
    { codigo: '4', nome: 'Despesa', tipo: 'despesa', nivel: 1, permite_lancamento: false },

    // 4.1 Despesas Administrativas
    { codigo: '4.1', nome: 'Despesas Administrativas', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '4.1.01', nome: 'Aluguel', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.02', nome: 'Condomínio', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.03', nome: 'Água e Esgoto', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.04', nome: 'Energia Elétrica', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.05', nome: 'Telefonia', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.06', nome: 'Material de Escritório', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.07', nome: 'Manutenção de Imobilizado', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.08', nome: 'Seguros', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.09', nome: 'IPTU', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.10', nome: 'Contabilidade', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.11', nome: 'Advogados', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.12', nome: 'Segurança', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },
    { codigo: '4.1.13', nome: 'Limpeza', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Administrativas', dre_linha_codigo: 'DO_ADM' },

    // 4.2 Despesas com Pessoal (Indireto)
    { codigo: '4.2', nome: 'Despesas com Pessoal (Indireto)', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '4.2.01', nome: 'Despesas com Pessoal ADM', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'DO_PES' },

    // 4.3 Despesas de Vendas e Marketing
    { codigo: '4.3', nome: 'Despesas de Vendas e Marketing', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '4.3.01', nome: 'Marketing Digital', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Variáveis', dre_linha_codigo: 'DO_MKT' },
    { codigo: '4.3.02', nome: 'Despesas de Viagens', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'DO_MKT' },
    { codigo: '4.3.03', nome: 'Bonificações', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'DO_OUT' },

    // 4.4 Outras Despesas
    { codigo: '4.4', nome: 'Outras Despesas', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '4.4.01', nome: 'Adiantamento a Fornecedores', tipo: 'despesa', nivel: 3, permite_lancamento: true },
    { codigo: '4.4.02', nome: 'Devoluções de Compra', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'DO_DEV' },

    // 4.5 Despesas Financeiras
    { codigo: '4.5', nome: 'Despesas Financeiras', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '4.5.01', nome: 'Juros sobre Empréstimos', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Financeiras', dre_linha_codigo: 'RFN' },
    { codigo: '4.5.02', nome: 'Multas Financeiras', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Financeiras', dre_linha_codigo: 'RFN' },
    { codigo: '4.5.03', nome: 'Tarifas Bancárias', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_conta: 'Despesas Financeiras', dre_linha_codigo: 'RFN' },
    { codigo: '4.5.04', nome: 'IOF', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'RFN' },
    { codigo: '4.5.05', nome: 'Pagamento de Empréstimos', tipo: 'despesa', nivel: 3, permite_lancamento: true },

    // 4.6 Distribuição de Lucro
    { codigo: '4.6', nome: 'Distribuição de Lucro', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '4.6.01', nome: 'Pró-labore', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'DL' },
    { codigo: '4.6.02', nome: 'Distribuição de Dividendos', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'DL' },

    // ==========================================
    // 5. INVESTIMENTOS
    // ==========================================
    { codigo: '5', nome: 'Investimentos', tipo: 'despesa', nivel: 1, permite_lancamento: false },

    { codigo: '5.1', nome: 'Ativos Imobilizados', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '5.1.01', nome: 'Equipamentos de Informática', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'INV' },
    { codigo: '5.1.02', nome: 'Máquinas e Equipamentos', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'INV' },
    { codigo: '5.1.03', nome: 'Veículos', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'INV' },
    { codigo: '5.1.04', nome: 'Instalações', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'INV' },
    { codigo: '5.1.05', nome: 'Móveis e Utensílios', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'INV' },

    { codigo: '5.2', nome: 'Outros Investimentos', tipo: 'despesa', nivel: 2, permite_lancamento: false },
    { codigo: '5.2.01', nome: 'Financiamento de Veículos', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'INV' },
    { codigo: '5.2.02', nome: 'Consórcio', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'INV' },
    { codigo: '5.2.03', nome: 'Comunicação', tipo: 'despesa', nivel: 3, permite_lancamento: true, dre_linha_codigo: 'INV' },
]
