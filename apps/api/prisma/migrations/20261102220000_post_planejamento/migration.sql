-- Produção (02/11/2026, pedido do Lucas): dia de executar e para quem é o post. Só adiciona colunas.
ALTER TABLE "MarketingPost" ADD COLUMN "dataExecucao" DATE;
ALTER TABLE "MarketingPost" ADD COLUMN "perfis" JSONB NOT NULL DEFAULT '[]';
