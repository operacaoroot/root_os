-- ============================================================================
-- MD10 — O VÍDEO QUE SUBIU NO MODO TESTE (25/09/2026)
--
-- `EnvioAoYoutube.enviadoEmTeste`: a sessão foi aberta com
-- `YOUTUBE_AUDITORIA=teste`, só para o canal de teste. O vídeo enviado por um
-- projeto sem auditoria fica privado para sempre, então o OS nunca oferece o
-- agendamento dele e deixa o arquivo ser declarado de novo para o canal real.
--
-- CAMINHO DE VOLTA
--   ALTER TABLE "EnvioAoYoutube" DROP COLUMN "enviadoEmTeste";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260925042725_envio_ao_youtube_em_teste';
-- ============================================================================

-- AlterTable
ALTER TABLE "EnvioAoYoutube" ADD COLUMN     "enviadoEmTeste" BOOLEAN NOT NULL DEFAULT false;
