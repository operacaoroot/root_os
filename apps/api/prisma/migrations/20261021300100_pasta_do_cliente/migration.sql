-- ============================================================================
-- A PASTA DO CLIENTE NO DRIVE (rodada dos agentes, 21/10/2026, Lane 0)
-- ============================================================================
--
-- ADITIVA: três colunas nulas em "Partner", que já tem RLS FORCE. O ponteiro
-- para a pasta do cliente em <raiz>/10-clientes/<nome> (TR-04), lido pela
-- ficha, pelo card da implantação e pela tela do cliente. "pastaDriveErro"
-- guarda o motivo da última tentativa que falhou, para o "Criar pasta de novo".
-- Nada do Drive além do id, do link e do motivo.
--
-- Rollback de imagem: a imagem anterior não lê as colunas e segue igual.
-- Rollback do banco (só se nada depender): ALTER TABLE "Partner" DROP COLUMN ...
-- ============================================================================

ALTER TABLE "Partner" ADD COLUMN "pastaDriveId" TEXT;
ALTER TABLE "Partner" ADD COLUMN "pastaDriveUrl" TEXT;
ALTER TABLE "Partner" ADD COLUMN "pastaDriveErro" TEXT;
