-- ============================================================================
-- O ONBOARDING DO CLIENTE — o trilho da esteira de entrega (23/09/2026)
--
-- Desenho em `docs/ONBOARDING.md`. Cinco tabelas da empresa que ENTREGA (a
-- ROOT, tenant 001): o trilho de cada cliente na esteira de 5 fases com
-- portão, a proposta do agente por tema, o link público, o registro da leitura
-- da ata e a linha do tempo.
--
-- ----------------------------------------------------------------------------
-- 1. OS QUATRO FILHOS TÊM A EMPRESA DO TRILHO, CONFERIDA PELO BANCO
-- ----------------------------------------------------------------------------
-- Mesmo desenho de `WorkApontamento`: `orgId` com a sentinela `''` e o gatilho
-- `mktos_orgid_do_pai('OnboardingTrilho', 'trilhoId')`, que deriva a empresa
-- do trilho e RECUSA filho pendurado em trilho de outra empresa. A função é a
-- de `20260910120000_orgid_em_todo_filho` e não é redefinida aqui.
--
-- ----------------------------------------------------------------------------
-- 2. O LINK PÚBLICO É ACHADO PELA SENTINELA, E SÓ ELE
-- ----------------------------------------------------------------------------
-- A rota anônima `/api/tenants/onboarding/link/:token` não tem empresa até
-- achar o convite pelo hash do token. É o mesmo contrato de `BioPage` com a
-- fatia 1.4: a LEITURA de `OnboardingConvite` aceita `app_resolucao_publica()`,
-- a escrita não. As outras quatro tabelas ficam na policy padrão — o resto do
-- pedido roda já dentro da empresa do trilho (`comTenantPublico`).
--
-- ----------------------------------------------------------------------------
-- 3. O QUE NÃO ESTÁ AQUI, DE PROPÓSITO
-- ----------------------------------------------------------------------------
-- A transcrição da reunião. `OnboardingAta` guarda hash, tamanho e o que a
-- leitura rendeu; o texto bruto não entra na base (regra da nota do Pedro,
-- §10). O token do link também não: só o hash.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   DROP TABLE "OnboardingMarco"; DROP TABLE "OnboardingAta";
--   DROP TABLE "OnboardingConvite"; DROP TABLE "OnboardingItem";
--   DROP TABLE "OnboardingTrilho"; DROP TYPE "OnboardingFase";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260924010000_onboarding_do_cliente';
--
-- A volta PERDE os trilhos. Exporte antes.
-- ============================================================================

-- CreateEnum
CREATE TYPE "OnboardingFase" AS ENUM ('qualificar', 'diagnostico', 'contrato', 'imersao', 'operacao', 'encerrado');

-- CreateTable
CREATE TABLE "OnboardingTrilho" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "cliente" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "fase" "OnboardingFase" NOT NULL DEFAULT 'qualificar',
    "perfil" TEXT,
    "nivel" TEXT,
    "receita" TEXT,
    "cardId" TEXT,
    "empresaId" TEXT,
    "contatoNome" TEXT,
    "contatoWhatsapp" TEXT,
    "contatoEmail" TEXT,
    "conduzidoPor" TEXT,
    "implantadoPor" TEXT,
    "reuniaoEm" TIMESTAMP(3),
    "kickoffEm" TIMESTAMP(3),
    "imersaoEm" TIMESTAMP(3),
    "grupoJid" TEXT,
    "portoes" JSONB NOT NULL DEFAULT '{}',
    "proximoPasso" TEXT,
    "proximoPassoDono" TEXT,
    "proximoPassoEm" TIMESTAMP(3),
    "observacoes" TEXT,
    "criadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTrilho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "trilhoId" TEXT NOT NULL,
    "temaId" TEXT NOT NULL,
    "bloco" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'ata',
    "tipo" TEXT NOT NULL DEFAULT 'em-branco',
    "proposta" TEXT,
    "fonteMinuto" TEXT,
    "fonteTrecho" TEXT,
    "fonteNota" TEXT,
    "status" TEXT NOT NULL DEFAULT 'em-branco',
    "textoFinal" TEXT,
    "aprovadoPor" TEXT,
    "aprovadoEm" TIMESTAMP(3),
    "respondidoPor" TEXT,
    "respondidoEm" TIMESTAMP(3),
    "respondidoVia" TEXT,
    "notaId" TEXT,
    "carregadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingConvite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "trilhoId" TEXT NOT NULL,
    "blocos" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCifrado" TEXT,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),
    "enviadoEm" TIMESTAMP(3),
    "lembradoEm" TIMESTAMP(3),
    "concluidoEm" TIMESTAMP(3),
    "acessos" INTEGER NOT NULL DEFAULT 0,
    "ultimoAcessoEm" TIMESTAMP(3),
    "criadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingConvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingAta" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "trilhoId" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "referencia" TEXT,
    "caracteres" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "segredosRemovidos" INTEGER NOT NULL DEFAULT 0,
    "modelo" TEXT,
    "custoUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "custoEstimado" BOOLEAN NOT NULL DEFAULT false,
    "propostas" INTEGER NOT NULL DEFAULT 0,
    "emBranco" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "lidaPor" TEXT,
    "lidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingAta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingMarco" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "trilhoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "quem" TEXT,
    "eventoId" TEXT,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingMarco_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingTrilho_orgId_fase_idx" ON "OnboardingTrilho"("orgId", "fase");

-- CreateIndex
CREATE INDEX "OnboardingTrilho_orgId_cardId_idx" ON "OnboardingTrilho"("orgId", "cardId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTrilho_orgId_slug_key" ON "OnboardingTrilho"("orgId", "slug");

-- CreateIndex
CREATE INDEX "OnboardingItem_orgId_trilhoId_idx" ON "OnboardingItem"("orgId", "trilhoId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingItem_trilhoId_temaId_key" ON "OnboardingItem"("trilhoId", "temaId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingConvite_tokenHash_key" ON "OnboardingConvite"("tokenHash");

-- CreateIndex
CREATE INDEX "OnboardingConvite_orgId_trilhoId_idx" ON "OnboardingConvite"("orgId", "trilhoId");

-- CreateIndex
CREATE INDEX "OnboardingAta_orgId_trilhoId_idx" ON "OnboardingAta"("orgId", "trilhoId");

-- CreateIndex
CREATE INDEX "OnboardingMarco_orgId_trilhoId_em_idx" ON "OnboardingMarco"("orgId", "trilhoId", "em");

-- AddForeignKey
ALTER TABLE "OnboardingTrilho" ADD CONSTRAINT "OnboardingTrilho_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTrilho" ADD CONSTRAINT "OnboardingTrilho_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "WorkTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingItem" ADD CONSTRAINT "OnboardingItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingItem" ADD CONSTRAINT "OnboardingItem_trilhoId_fkey" FOREIGN KEY ("trilhoId") REFERENCES "OnboardingTrilho"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingConvite" ADD CONSTRAINT "OnboardingConvite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingConvite" ADD CONSTRAINT "OnboardingConvite_trilhoId_fkey" FOREIGN KEY ("trilhoId") REFERENCES "OnboardingTrilho"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingAta" ADD CONSTRAINT "OnboardingAta_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingAta" ADD CONSTRAINT "OnboardingAta_trilhoId_fkey" FOREIGN KEY ("trilhoId") REFERENCES "OnboardingTrilho"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingMarco" ADD CONSTRAINT "OnboardingMarco_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingMarco" ADD CONSTRAINT "OnboardingMarco_trilhoId_fkey" FOREIGN KEY ("trilhoId") REFERENCES "OnboardingTrilho"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateTrigger: a empresa de cada filho é a do trilho
CREATE TRIGGER "OnboardingItem_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "OnboardingItem"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('OnboardingTrilho', 'trilhoId');

CREATE TRIGGER "OnboardingConvite_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "OnboardingConvite"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('OnboardingTrilho', 'trilhoId');

CREATE TRIGGER "OnboardingAta_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "OnboardingAta"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('OnboardingTrilho', 'trilhoId');

CREATE TRIGGER "OnboardingMarco_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "OnboardingMarco"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('OnboardingTrilho', 'trilhoId');

-- Isolamento por linha: o grupo padrão nas quatro, e a leitura pela sentinela
-- pública no convite (é por ele que o link acha a empresa).
SELECT app_rls_aplicar_policies(
  'OnboardingTrilho',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'OnboardingItem',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'OnboardingConvite',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual() OR public.app_resolucao_publica()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'OnboardingAta',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'OnboardingMarco',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "OnboardingTrilho", "OnboardingItem", "OnboardingConvite", "OnboardingAta", "OnboardingMarco" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: as cinco têm RLS, FORCE e as quatro policies; os quatro
-- gatilhos existem. Falha ALTA de propósito — como `migrate deploy` roda no
-- arranque do container, abortar aqui é a API não subir com tabela vazada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo text;
  ok   boolean;
BEGIN
  FOREACH alvo IN ARRAY ARRAY['OnboardingTrilho', 'OnboardingItem', 'OnboardingConvite', 'OnboardingAta', 'OnboardingMarco'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = alvo;

    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION
        '% ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.', alvo;
    END IF;
  END LOOP;

  FOREACH alvo IN ARRAY ARRAY['OnboardingItem', 'OnboardingConvite', 'OnboardingAta', 'OnboardingMarco'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = alvo || '_orgId_do_pai' AND NOT tgisinternal) THEN
      RAISE EXCEPTION '% sem o gatilho que confere a empresa do trilho.', alvo;
    END IF;
  END LOOP;
END $$;
