-- Fixo × variável × eventual: a conta do plano pode dizer de que natureza é o
-- gasto dela (escolha da empresa na Análise). Nula = vale a regra de antes
-- (código do plano e custoFixo). E o lançamento pago de uma vez para vários
-- meses de uso (plano anual) diz quantos meses ele cobre.
-- Só acrescenta colunas nulas: a imagem anterior não as lê e continua funcionando.
ALTER TABLE "ChartAccount" ADD COLUMN "natureza" TEXT;
ALTER TABLE "ChartAccount" ADD CONSTRAINT "ChartAccount_natureza_check"
  CHECK ("natureza" IS NULL OR "natureza" IN ('fixo', 'variavel', 'eventual'));

ALTER TABLE "FinanceTransaction" ADD COLUMN "mesesDeUso" INTEGER;
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_mesesDeUso_check"
  CHECK ("mesesDeUso" IS NULL OR ("mesesDeUso" >= 1 AND "mesesDeUso" <= 36));
