-- Produção 22, M4: prazo de retenção do TEXTO guardado em Pendencia.dados (a triagem do
-- WhatsApp, CO-16, guarda o texto da mensagem para a pessoa decidir). Coluna nula: só as
-- pendências que guardam texto ganham o prazo, e o expurgo do rastro apaga o texto vencido
-- sem apagar a pendência. Aditiva; a tabela já tem isolamento por linha.
ALTER TABLE "Pendencia" ADD COLUMN "textoExpiraEm" TIMESTAMP(3);

CREATE INDEX "Pendencia_textoExpiraEm_idx" ON "Pendencia"("textoExpiraEm");
