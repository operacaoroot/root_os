-- Fase 3 go-live — DRE (ADR-003)
-- (1) calcular_dre soma com sinal: recebíveis (+) e pagáveis (−) podem cair na mesma linha
--     (estornos); o valor devolvido é a magnitude líquida na natureza da linha.
-- (2) Template default para todas as empresas sem config.
-- (3) Mapeamento plano_contas → dre_linhas por regra de nome; despesa sem regra cai em
--     CD_NI "Despesa a identificar" (honesto por construção); receita sem regra fica NULL.
--     Contas patrimoniais (empréstimos, aportes, CAPEX) ficam fora da DRE de propósito.
-- (4) dre_snapshots para o fechamento mensal do reports-worker.
-- (5) Cron mensal passa de 28 para dia 1 às 06:00 (fecha o mês anterior; sem duplicar 28-31).
-- Aplicada em produção via MCP em 12/06/2026 (fase3_dre_sinal_seed_mapeamento).

-- 1. calcular_dre com sinal
CREATE OR REPLACE FUNCTION calcular_dre(
  p_company_id      UUID,
  p_data_inicio     DATE,
  p_data_fim        DATE,
  p_departamento_id UUID DEFAULT NULL,
  p_projeto_id      UUID DEFAULT NULL
) RETURNS TABLE(
  codigo TEXT, nome TEXT, ordem INTEGER, operador TEXT, tipo TEXT,
  valor NUMERIC, e_calculada BOOLEAN
) AS $$
DECLARE
  v_template_id UUID;
BEGIN
  SELECT template_id INTO v_template_id
  FROM dre_company_config WHERE company_id = p_company_id;

  IF v_template_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH lancamentos AS (
    SELECT
      cp.categoria_id                                  AS conta_id,
      COALESCE(lr.departamento_id, cp.departamento_id) AS departamento_id,
      COALESCE(lr.projeto_id,      cp.projeto_id)      AS projeto_id,
      COALESCE(lr.valor_rateado,   cp.valor)           AS valor,
      -1::NUMERIC                                       AS sinal
    FROM contas_pagar cp
    LEFT JOIN lancamento_rateios lr
      ON lr.lancamento_id = cp.id AND lr.lancamento_tipo = 'pagar'
    WHERE cp.company_id = p_company_id
      AND cp.status     = 'pago'
      AND cp.deleted_at IS NULL
      AND cp.vencimento BETWEEN p_data_inicio AND p_data_fim

    UNION ALL

    SELECT
      cr.categoria_id,
      COALESCE(lr.departamento_id, cr.departamento_id),
      COALESCE(lr.projeto_id,      cr.projeto_id),
      COALESCE(lr.valor_rateado,   cr.valor),
      1::NUMERIC
    FROM contas_receber cr
    LEFT JOIN lancamento_rateios lr
      ON lr.lancamento_id = cr.id AND lr.lancamento_tipo = 'receber'
    WHERE cr.company_id = p_company_id
      AND cr.status     = 'pago'
      AND cr.deleted_at IS NULL
      AND cr.vencimento BETWEEN p_data_inicio AND p_data_fim
  ),
  lancamentos_filtrados AS (
    SELECT l.* FROM lancamentos l
    WHERE (p_departamento_id IS NULL OR l.departamento_id = p_departamento_id)
      AND (p_projeto_id      IS NULL OR l.projeto_id      = p_projeto_id)
  ),
  lancamentos_resolvidos AS (
    SELECT
      resolver_dre_linha(lf.conta_id, lf.departamento_id, p_company_id) AS dre_linha_id,
      lf.valor * lf.sinal AS valor
    FROM lancamentos_filtrados lf
    WHERE lf.conta_id IS NOT NULL
  ),
  somas AS (
    SELECT dre_linha_id, SUM(lr2.valor) AS valor
    FROM lancamentos_resolvidos lr2
    WHERE dre_linha_id IS NOT NULL
    GROUP BY dre_linha_id
  )
  SELECT
    dl.codigo, dl.nome, dl.ordem, dl.operador, dl.tipo,
    CASE WHEN dl.operador = '(-)' THEN -COALESCE(s.valor, 0)
         ELSE COALESCE(s.valor, 0) END::NUMERIC AS valor,
    (dl.tipo IN ('calculado','grupo','indicador')) AS e_calculada
  FROM dre_linhas dl
  LEFT JOIN somas s ON s.dre_linha_id = dl.id
  WHERE dl.template_id = v_template_id
    AND dl.visivel = TRUE
  ORDER BY dl.ordem;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION calcular_dre IS
  'DRE por template. Status=pago, competência por vencimento. Soma com sinal: linhas (-) devolvem magnitude líquida (despesas - estornos); demais devolvem receitas - estornos. ADR-003.';

-- 2. Template default para todas as empresas sem config
INSERT INTO dre_company_config (company_id, template_id, customizado)
SELECT c.id, '00000000-0000-0000-0000-000000000001', FALSE
FROM companies c
WHERE c.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM dre_company_config d WHERE d.company_id = c.id);

-- 3. Mapeamento por nome (só onde dre_linha_id IS NULL; nunca sobrescreve mapeamento manual)
WITH regras(prioridade, tipo, padrao, codigo) AS (VALUES
  -- receitas
  (10,'receita','receita%','FB'),(11,'receita','faturamento%','FB'),(12,'receita','venda%','FB'),
  (13,'receita','%honorário%','FB'),(14,'receita','%honorario%','FB'),
  (19,'receita','%devolu%despesa%','DO_DEV'),
  (20,'receita','%devolu%','DEV'),
  (30,'receita','%rendiment%','RFP'),(31,'receita','%juros%','RFP'),
  (32,'receita','%dividendo%','RI'),
  (40,'receita','assistência médica%','CP_AM'),(41,'receita','compra de serviço%','CD_SRV'),
  (42,'receita','parcelamento simples%','ISV'),
  (43,'receita','adiantamento de lucro%','DL'),(44,'receita','distribuição de lucro%','DL'),
  (45,'receita','distribuicao de lucro%','DL'),
  -- despesas — pessoal direto (custos com pessoal)
  (100,'despesa','comiss% parceiro%','CPV'),
  (101,'despesa','salário%','CP_SAL'),(102,'despesa','salario%','CP_SAL'),
  (103,'despesa','13º%','CP_13'),(104,'despesa','décimo terceiro%','CP_13'),(105,'despesa','decimo terceiro%','CP_13'),
  (107,'despesa','assistência médica%','CP_AM'),(108,'despesa','assistencia medica%','CP_AM'),
  (109,'despesa','plano de saúde%','CP_AM'),(110,'despesa','plano de saude%','CP_AM'),
  (111,'despesa','vale refeição%','CP_VR'),(112,'despesa','vale refeicao%','CP_VR'),
  (113,'despesa','vale alimentação%','CP_VR'),(114,'despesa','vale alimentacao%','CP_VR'),
  (115,'despesa','vale transporte%','CP_VT'),
  (116,'despesa','prestador%','CP_PJ'),
  (117,'despesa','comiss%','CP_COM'),
  (118,'despesa','ajuda de custo%','CP_AC'),
  -- despesas — pessoal indireto
  (130,'despesa','fgts%','DO_PES'),(131,'despesa','inss%','DO_PES'),
  (132,'despesa','férias%','DO_PES'),(133,'despesa','ferias%','DO_PES'),
  (134,'despesa','rescis%','DO_PES'),
  (135,'despesa','pro labore%','DO_PES'),(136,'despesa','pró-labore%','DO_PES'),
  (137,'despesa','pro-labore%','DO_PES'),(138,'despesa','prolabore%','DO_PES'),
  (139,'despesa','seguro de vida%','DO_PES'),
  (140,'despesa','%benefício%','DO_PES'),(141,'despesa','%beneficio%','DO_PES'),
  (142,'despesa','uniforme%','DO_PES'),(143,'despesa','controle de ponto%','DO_PES'),
  (144,'despesa','curso%','DO_PES'),(145,'despesa','treinament%','DO_PES'),
  (146,'despesa','confraterniza%','DO_PES'),
  -- despesas — impostos sobre venda
  (150,'despesa','simples nacional%','ISV'),(151,'despesa','das','ISV'),(152,'despesa','das %','ISV'),
  (153,'despesa','dae','ISV'),(154,'despesa','parcelamento simples%','ISV'),
  (155,'despesa','iss%','ISV'),(156,'despesa','icms%','ISV'),(157,'despesa','pis%','ISV'),
  (158,'despesa','cofins%','ISV'),(159,'despesa','imposto%','ISV'),(160,'despesa','tributo%','ISV'),
  -- despesas — financeiras
  (170,'despesa','tarifa%','RFN'),(171,'despesa','iof%','RFN'),(172,'despesa','%juros%','RFN'),
  (173,'despesa','encargo% financeiro%','RFN'),(174,'despesa','despesa% financeira%','RFN'),
  -- custos diretos
  (180,'despesa','compra de serviço%','CD_SRV'),(181,'despesa','compra de servico%','CD_SRV'),
  (182,'despesa','%software%','CD_SW'),(183,'despesa','%hardware%','CD_SW'),
  (184,'despesa','custos gerais%','CD_GER'),
  (185,'despesa','frete%','FRV'),
  -- marketing
  (190,'despesa','marketing%','DO_MKT'),(191,'despesa','patrocínio%','DO_MKT'),
  (192,'despesa','patrocinio%','DO_MKT'),(193,'despesa','publicidade%','DO_MKT'),
  (194,'despesa','%evento%','DO_MKT'),(195,'despesa','%anúncio%','DO_MKT'),(196,'despesa','%anuncio%','DO_MKT'),
  -- administrativas
  (200,'despesa','aluguel%','DO_ADM'),(201,'despesa','condomínio%','DO_ADM'),(202,'despesa','condominio%','DO_ADM'),
  (203,'despesa','energia%','DO_ADM'),(204,'despesa','internet%','DO_ADM'),(205,'despesa','telefon%','DO_ADM'),
  (206,'despesa','comunicaç%','DO_ADM'),(207,'despesa','comunicac%','DO_ADM'),
  (208,'despesa','email%','DO_ADM'),(209,'despesa','e-mail%','DO_ADM'),(210,'despesa','limpeza%','DO_ADM'),
  (211,'despesa','material de escritório%','DO_ADM'),(212,'despesa','material de escritorio%','DO_ADM'),
  (213,'despesa','contabilidade%','DO_ADM'),(214,'despesa','advogad%','DO_ADM'),
  (215,'despesa','certificado digital%','DO_ADM'),(216,'despesa','seguro%','DO_ADM'),
  (217,'despesa','instalaç%','DO_ADM'),(218,'despesa','instalac%','DO_ADM'),
  (219,'despesa','manutenç%','DO_ADM'),(220,'despesa','manutenc%','DO_ADM'),
  (221,'despesa','viage%','DO_ADM'),(222,'despesa','%viagem%','DO_ADM'),(223,'despesa','%viagens%','DO_ADM'),
  (224,'despesa','combustí%','DO_ADM'),(225,'despesa','combusti%','DO_ADM'),
  (226,'despesa','reembolso%','DO_ADM'),(227,'despesa','correio%','DO_ADM'),
  (228,'despesa','água%','DO_ADM'),(229,'despesa','agua%','DO_ADM'),
  (230,'despesa','cartório%','DO_ADM'),(231,'despesa','cartorio%','DO_ADM'),
  (232,'despesa','estacionament%','DO_ADM'),(233,'despesa','condução%','DO_ADM'),(234,'despesa','conducao%','DO_ADM'),
  -- distribuição de lucro
  (240,'despesa','distribuição de lucro%','DL'),(241,'despesa','distribuicao de lucro%','DL'),
  (242,'despesa','adiantamento de lucro%','DL'),
  -- outras
  (250,'despesa','multa%','DO_OUT'),(251,'despesa','outras despesas%','DO_OUT'),(252,'despesa','outros%','DO_OUT')
),
alvo AS (
  SELECT pc.id AS conta_id, pc.tipo,
    (SELECT r.codigo FROM regras r
       WHERE r.tipo = pc.tipo AND lower(pc.nome) LIKE r.padrao
       ORDER BY r.prioridade LIMIT 1) AS codigo
  FROM plano_contas pc
  WHERE pc.dre_linha_id IS NULL AND pc.deleted_at IS NULL
    AND lower(pc.nome) NOT LIKE ALL (ARRAY[
      'investimento externo','aumento de capital',
      'empréstimo%','emprestimo%','pagamento de empréstimo%','pagamento de emprestimo%',
      'financiamento%','transferência%','transferencia%','aplicaç%','aplicac%','resgate%',
      'equipamento%','máquina%','maquina%','móveis%','moveis%'])
)
UPDATE plano_contas pc
SET dre_linha_id = dl.id
FROM alvo a
JOIN dre_linhas dl
  ON dl.template_id = '00000000-0000-0000-0000-000000000001'
 AND dl.codigo = COALESCE(a.codigo, CASE WHEN a.tipo = 'despesa' THEN 'CD_NI' END)
WHERE pc.id = a.conta_id;

-- 4. Snapshot mensal de DRE (fechamento)
CREATE TABLE IF NOT EXISTS dre_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  periodo DATE NOT NULL,
  payload JSONB NOT NULL,
  totais JSONB,
  gerado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, periodo)
);
ALTER TABLE dre_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dre_snapshots_select ON dre_snapshots;
CREATE POLICY dre_snapshots_select ON dre_snapshots
  FOR SELECT USING (user_can_access_company(auth.uid(), company_id));

-- 5. Cron mensal no dia 1 (gera DRE do mês anterior; antes rodava dia 28 do próprio mês)
DO $$ BEGIN PERFORM cron.unschedule('fullbpo-dre-mensal'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('fullbpo-dre-mensal', '0 6 1 * *',
  $cmd$SELECT public.call_edge_function('reports-worker', '{"report_type": "dre"}'::jsonb)$cmd$);
