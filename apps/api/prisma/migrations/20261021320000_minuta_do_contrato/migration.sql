-- ============================================================================
-- A MINUTA DO CONTRATO DA ROOT (rodada dos agentes, 21/10/2026, lane A2: CO-13 e CO-14)
-- ============================================================================
--
-- ADITIVA: duas colunas nulas em "ComercialDocumento", que já tem RLS FORCE e a
-- sentinela de "orgId" (filha de "Lead"). A minuta que o construtor redige
-- (CO-13) é um "ComercialDocumento" de provedor 'minuta', estado 'rascunho':
--   · "conteudo": o texto da minuta, com as marcas de inserção e de lacuna;
--   · "laudo": o laudo do revisor (CO-14), ranqueado por gravidade.
-- Os documentos de assinatura (ZapSign, anexo) seguem sem as duas colunas.
--
-- Rollback de imagem: a imagem anterior não lê as colunas e segue igual (as
-- minutas ficam no banco, invisíveis para ela).
-- Rollback do banco (só se nada depender):
--   ALTER TABLE "ComercialDocumento" DROP COLUMN "conteudo", DROP COLUMN "laudo";
-- ============================================================================

ALTER TABLE "ComercialDocumento" ADD COLUMN "conteudo" TEXT;
ALTER TABLE "ComercialDocumento" ADD COLUMN "laudo" JSONB;
