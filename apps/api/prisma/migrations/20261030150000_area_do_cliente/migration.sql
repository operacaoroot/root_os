-- ============================================================================
-- A ÁREA DO CLIENTE (leva A, 30/10/2026): a sala depois do fechamento
-- ============================================================================
--
-- ADITIVA: uma coluna nula em "SalaVersao", uma tabela nova ("SalaLeitura") e
-- dois índices únicos parciais. Nenhuma linha reescrita: toda versão da sala de
-- hoje fica com "item" nulo e continua valendo exatamente como antes.
--
-- 1. "SalaVersao"."item": a versão passa a poder ser DE UM ITEM da área (os
--    quinze ids de `AREA_ITENS` no shared) em vez de da sala inteira. O número
--    continua único por lead (a aprovação prende `leadId:vN` e o /atendimento o
--    lê assim); a "edição" do item (1ª, 2ª...) é derivada na leitura.
--    O índice "uma aberta por lead" passa a valer só para a sala (item nulo), e
--    nasce o "uma aberta por item": dois cliques em publicar a mesma ata não
--    abrem duas versões, e a sala e um item podem ter rascunho ao mesmo tempo.
--
-- 2. "SalaLeitura": o cliente abriu a versão N do item X. Uma linha por (sala,
--    item, versão), idempotente. Filha de "SalaDoCliente" no desenho das filhas
--    de `20261013000000_cockpit_comercial`: sentinela '' + gatilho
--    `mktos_orgid_do_pai('SalaDoCliente', 'salaId')`, isolamento por linha com
--    leitura e escrita separadas no grupo padrão. A rota anônima acha a empresa
--    pelo hash do token em "SalaDoCliente" (sentinela pública) e só DEPOIS grava
--    aqui, dentro de `comTenantPublico`: esta tabela nunca é lida sob a sentinela.
--
-- CAMINHO DE VOLTA (perde as leituras e as versões por item; exporte antes):
--   DROP TABLE "SalaLeitura";
--   DELETE FROM "SalaVersao" WHERE "item" IS NOT NULL;
--   DROP INDEX "SalaVersao_uma_aberta_por_item";
--   DROP INDEX "SalaVersao_uma_aberta_por_lead";
--   CREATE UNIQUE INDEX "SalaVersao_uma_aberta_por_lead" ON "SalaVersao" ("leadId") WHERE "estado" IN ('rascunho', 'na_porta');
--   DROP INDEX "SalaVersao_leadId_item_numero_idx";
--   ALTER TABLE "SalaVersao" DROP CONSTRAINT "SalaVersao_item_check";
--   ALTER TABLE "SalaVersao" DROP COLUMN "item";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261030150000_area_do_cliente';
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A versão por item
-- ---------------------------------------------------------------------------
ALTER TABLE "SalaVersao" ADD COLUMN "item" TEXT;

ALTER TABLE "SalaVersao" ADD CONSTRAINT "SalaVersao_item_check"
  CHECK ("item" IS NULL OR "item" ~ '^[a-z][a-z0-9-]{1,39}$');

CREATE INDEX "SalaVersao_leadId_item_numero_idx" ON "SalaVersao"("leadId", "item", "numero");

DROP INDEX IF EXISTS "SalaVersao_uma_aberta_por_lead";
CREATE UNIQUE INDEX "SalaVersao_uma_aberta_por_lead"
  ON "SalaVersao" ("leadId") WHERE "estado" IN ('rascunho', 'na_porta') AND "item" IS NULL;
CREATE UNIQUE INDEX "SalaVersao_uma_aberta_por_item"
  ON "SalaVersao" ("leadId", "item") WHERE "estado" IN ('rascunho', 'na_porta') AND "item" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. A leitura do item pelo cliente
-- ---------------------------------------------------------------------------
CREATE TABLE "SalaLeitura" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "salaId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaLeitura_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalaLeitura_salaId_item_versao_key" ON "SalaLeitura"("salaId", "item", "versao");
CREATE INDEX "SalaLeitura_orgId_salaId_idx" ON "SalaLeitura"("orgId", "salaId");

ALTER TABLE "SalaLeitura" ADD CONSTRAINT "SalaLeitura_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalaLeitura" ADD CONSTRAINT "SalaLeitura_salaId_fkey"
  FOREIGN KEY ("salaId") REFERENCES "SalaDoCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalaLeitura" ADD CONSTRAINT "SalaLeitura_item_check"
  CHECK ("item" ~ '^[a-z][a-z0-9-]{1,39}$');
ALTER TABLE "SalaLeitura" ADD CONSTRAINT "SalaLeitura_versao_check"
  CHECK ("versao" >= 1);

-- CreateTrigger: a empresa da leitura é a da sala
CREATE TRIGGER "SalaLeitura_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "SalaLeitura"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('SalaDoCliente', 'salaId');

-- Isolamento por linha: o grupo padrão.
SELECT app_rls_aplicar_policies(
  'SalaLeitura',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "SalaLeitura" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE, as quatro policies e o gatilho. Falha ALTA de
-- propósito — como `migrate deploy` roda no arranque do container, abortar aqui
-- é a API não subir com tabela vazada.
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
   WHERE n.nspname = 'public' AND c.relname = 'SalaLeitura';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'SalaLeitura ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'SalaLeitura_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SalaLeitura sem o gatilho que confere a empresa da sala.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'SalaVersao_uma_aberta_por_item') THEN
    RAISE EXCEPTION 'SalaVersao sem o indice de uma versao aberta por item.';
  END IF;
END $$;
