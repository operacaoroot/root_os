-- ============================================================================
-- MD11 — A DM AUTOMÁTICA SOB O LOTE DA SEMANA: UM ENVIO POR COMENTÁRIO (25/09/2026)
--
-- Uma linha por comentário da fila (MD9) que a DM automática tentou responder:
-- segurada até a janela de horário abrir, saindo pela porta, enviada, recusada
-- (a regra caiu, a porta ou o efeito disse não antes da Meta), com erro da Meta,
-- ignorada (a mesma pessoa já recebeu a DM desta regra) ou incerta (a Meta não
-- respondeu, ou a passagem caiu no meio: pode ter saído). `comentarioId` é
-- único: um comentário, uma tentativa. `travaDaPessoa`
-- (`<episodioId>:<itemId>:<pessoaHmac>`, a matéria e não o item do lote) é
-- única enquanto a tentativa vale — incerta inclusive — e nula quando ela não
-- saiu: é o "uma DM por pessoa por regra" da MC18 dentro de uma escrita só.
--
-- Guarda só o HMAC da pessoa (a mesma chave da fila, META_WEBHOOK_PESSOA_HMAC_KEY):
-- nem o @, nem o texto do comentário, nem o id do comentário (esse fica na
-- linha da fila, que é a mãe). Vive 90 dias (`expiraEm`, D-MC9.9): a rotina de
-- comentários apaga a linha depois disso.
--
-- Filha de `ComentarioComPalavra`, com a regra de filho de hoje: sentinela `''`
-- e o gatilho `mktos_orgid_do_pai('ComentarioComPalavra', 'comentarioId')`.
-- Isolamento por linha com leitura e escrita separadas.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   DROP TABLE "EnvioDeResposta";
--   DROP TYPE "EnvioDeRespostaEstado";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260925053358_envio_de_resposta';
--
-- A volta perde o histórico das DMs automáticas (o RASTRO de cada envio
-- continua no EventLog, sem o comentário nem a pessoa em claro).
-- ============================================================================

-- CreateEnum
CREATE TYPE "EnvioDeRespostaEstado" AS ENUM ('segurado', 'enviando', 'enviado', 'recusado', 'erro', 'ignorado', 'incerto');

-- CreateTable
CREATE TABLE "EnvioDeResposta" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "comentarioId" TEXT NOT NULL,
    "loteItemId" TEXT NOT NULL,
    "pessoaHmac" TEXT NOT NULL,
    "travaDaPessoa" TEXT,
    "estado" "EnvioDeRespostaEstado" NOT NULL,
    "seguradoAte" TIMESTAMP(3),
    "correlationId" TEXT,
    "mensagemId" TEXT,
    "codigoDoErro" TEXT,
    "motivo" TEXT,
    "enviadoEm" TIMESTAMP(3),
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvioDeResposta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnvioDeResposta_comentarioId_key" ON "EnvioDeResposta"("comentarioId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvioDeResposta_travaDaPessoa_key" ON "EnvioDeResposta"("travaDaPessoa");

-- CreateIndex
CREATE INDEX "EnvioDeResposta_orgId_loteItemId_estado_idx" ON "EnvioDeResposta"("orgId", "loteItemId", "estado");

-- CreateIndex
CREATE INDEX "EnvioDeResposta_orgId_estado_seguradoAte_idx" ON "EnvioDeResposta"("orgId", "estado", "seguradoAte");

-- CreateIndex
CREATE INDEX "EnvioDeResposta_orgId_expiraEm_idx" ON "EnvioDeResposta"("orgId", "expiraEm");

-- AddForeignKey
ALTER TABLE "EnvioDeResposta" ADD CONSTRAINT "EnvioDeResposta_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioDeResposta" ADD CONSTRAINT "EnvioDeResposta_comentarioId_fkey" FOREIGN KEY ("comentarioId") REFERENCES "ComentarioComPalavra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTrigger: a empresa do envio é a do comentário.
CREATE TRIGGER "EnvioDeResposta_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "EnvioDeResposta"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('ComentarioComPalavra', 'comentarioId');

-- Isolamento por linha: o grupo padrão, leitura e escrita separadas.
SELECT app_rls_aplicar_policies(
  'EnvioDeResposta',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "EnvioDeResposta" TO mktos_app';
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
   WHERE n.nspname = 'public' AND c.relname = 'EnvioDeResposta';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'EnvioDeResposta ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'EnvioDeResposta_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'EnvioDeResposta sem o gatilho que confere a empresa do comentario.';
  END IF;
END $$;
