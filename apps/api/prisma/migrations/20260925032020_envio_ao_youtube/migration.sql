-- ============================================================================
-- MD10 — O VÍDEO DO EPISÓDIO A CAMINHO DO YOUTUBE (25/09/2026)
--
-- `EnvioAoYoutube`: uma linha por episódio. O Mac declara o vídeo final
-- (sha256 e tamanho), o OS abre a sessão de envio resumable pela porta (a URI
-- fica aqui, CIFRADA com a chave do cofre, e só sai para o Mac), o Mac manda os
-- bytes direto ao YouTube e devolve o id do vídeo, o OS confere o vídeo privado
-- e define a thumb; com o lote da semana assinado, manda o `publishAt`.
--
-- Filha de `PautaEpisodio`, com a regra de filho de hoje: sentinela `''` e o
-- gatilho `mktos_orgid_do_pai('PautaEpisodio', 'episodioId')`, que deriva a
-- empresa do episódio e RECUSA envio pendurado em episódio de outra empresa.
-- Isolamento por linha com leitura e escrita separadas.
--
-- `PautaEpisodio` ganha a thumb escolhida e o horário do vídeo (o pacote).
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   DROP TABLE "EnvioAoYoutube";
--   DROP TYPE "EnvioAoYoutubeEstado";
--   ALTER TABLE "PautaEpisodio" DROP COLUMN "thumbEscolhida", DROP COLUMN "publicarNoYoutubeEm";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260925032020_envio_ao_youtube';
--
-- A volta perde a sessão aberta e o id do vídeo no OS. O vídeo, se já subiu,
-- continua no canal, privado — nada no YouTube é apagado pela volta.
-- ============================================================================

-- CreateEnum
CREATE TYPE "EnvioAoYoutubeEstado" AS ENUM ('declarado', 'sessao_aberta', 'conferido', 'agendado', 'erro');

-- AlterTable
ALTER TABLE "PautaEpisodio" ADD COLUMN     "publicarNoYoutubeEm" TIMESTAMP(3),
ADD COLUMN     "thumbEscolhida" INTEGER;

-- CreateTable
CREATE TABLE "EnvioAoYoutube" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "episodioId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'video/mp4',
    "estado" "EnvioAoYoutubeEstado" NOT NULL DEFAULT 'declarado',
    "sessaoCifrada" TEXT,
    "sessaoAbertaEm" TIMESTAMP(3),
    "expiraEm" TIMESTAMP(3),
    "sessoes" INTEGER NOT NULL DEFAULT 0,
    "videoId" TEXT,
    "conferidoEm" TIMESTAMP(3),
    "thumbSha" TEXT,
    "thumbDefinidaEm" TIMESTAMP(3),
    "playlistId" TEXT,
    "playlistItemId" TEXT,
    "publicarEm" TIMESTAMP(3),
    "agendadoEm" TIMESTAMP(3),
    "erro" TEXT,
    "loteItemId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvioAoYoutube_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnvioAoYoutube_episodioId_key" ON "EnvioAoYoutube"("episodioId");

-- CreateIndex
CREATE INDEX "EnvioAoYoutube_orgId_estado_idx" ON "EnvioAoYoutube"("orgId", "estado");

-- AddForeignKey
ALTER TABLE "EnvioAoYoutube" ADD CONSTRAINT "EnvioAoYoutube_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioAoYoutube" ADD CONSTRAINT "EnvioAoYoutube_episodioId_fkey" FOREIGN KEY ("episodioId") REFERENCES "PautaEpisodio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A thumb do YouTube é uma das três do pacote.
ALTER TABLE "PautaEpisodio" ADD CONSTRAINT "PautaEpisodio_thumbEscolhida_check"
  CHECK ("thumbEscolhida" IS NULL OR "thumbEscolhida" BETWEEN 1 AND 3);

-- CreateTrigger: a empresa do envio é a do episódio.
CREATE TRIGGER "EnvioAoYoutube_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "EnvioAoYoutube"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('PautaEpisodio', 'episodioId');

-- Isolamento por linha: o grupo padrão, leitura e escrita separadas.
SELECT app_rls_aplicar_policies(
  'EnvioAoYoutube',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "EnvioAoYoutube" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE, as quatro policies e o gatilho. Falha ALTA de
-- propósito — `migrate deploy` roda no arranque do container, e abortar aqui é
-- a API não subir com tabela vazada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  ok boolean;
BEGIN
  SELECT c.relrowsecurity
     AND c.relforcerowsecurity
     AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
    INTO ok
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'EnvioAoYoutube';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'EnvioAoYoutube ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'EnvioAoYoutube_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'EnvioAoYoutube sem o gatilho que confere a empresa do episodio.';
  END IF;
END $$;
