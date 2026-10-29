-- Destino da nota da Memória (29/10/2026, pedido do Lucas): tudo chega na Entrada e a
-- equipe decide se vira Ideia de conteúdo, Referência externa ou as duas. Só acrescenta
-- colunas; as notas que já existem começam em 'entrada'.
ALTER TABLE "MarketingNota" ADD COLUMN "destino" TEXT NOT NULL DEFAULT 'entrada';
ALTER TABLE "MarketingNota" ADD COLUMN "assunto" TEXT;
ALTER TABLE "MarketingNota" ADD COLUMN "decididaEm" TIMESTAMP(3);
ALTER TABLE "MarketingNota" ADD COLUMN "decididaPor" TEXT;
ALTER TABLE "MarketingNota" ADD CONSTRAINT "MarketingNota_destino_check" CHECK ("destino" IN ('entrada', 'conteudo', 'referencia', 'conteudo_e_referencia'));
ALTER TABLE "MarketingNota" ADD CONSTRAINT "MarketingNota_assunto_check" CHECK ("assunto" IS NULL OR "assunto" IN ('ferramenta', 'produto', 'conteudo', 'negocio'));
CREATE INDEX "MarketingNota_orgId_destino_atualizadaEm_idx" ON "MarketingNota"("orgId", "destino", "atualizadaEm");
