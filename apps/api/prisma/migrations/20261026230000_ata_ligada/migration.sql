-- ============================================================================
-- A ATA LIGADA A UM LEAD OU A UM CLIENTE (Layout 26/10/2026)
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente, nenhum
-- dado reescrito.
--
-- A ata não mora numa tabela só (vault, memória, Drive, Granola): a ligação é
-- presa à REFERÊNCIA da ata ("ataRef"), como a "AtaSugestao". Uma linha por ata
-- e empresa (índice único). A pessoa liga na tela Atas a um lead e/ou a um
-- cliente; o título, a data e o tipo são copiados ao ligar, para o painel do
-- lead e a ficha do cliente mostrarem a reunião sem reabrir a fonte.
--
-- Ligar NÃO é o fato `ata.chegou` do comercial: nenhuma reação roda.
-- "leadId" e "clienteId" sem chave estrangeira: lead ou cliente apagado só
-- some da leitura.
--
-- Raiz da empresa, NÃO filha: o "orgId" vem do insert. Isolamento por linha com
-- FORCE, o grupo padrão de policies, como a "AtaSugestao".
--
-- Rollback (só se nada depender dela): DROP TABLE "AtaLigacao";
-- ============================================================================

CREATE TABLE "AtaLigacao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ataRef" TEXT NOT NULL,
    "leadId" TEXT,
    "clienteId" TEXT,
    "titulo" TEXT NOT NULL,
    "data" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'ata',
    "ligadaPor" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtaLigacao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AtaLigacao_orgId_ataRef_key" ON "AtaLigacao"("orgId", "ataRef");
CREATE INDEX "AtaLigacao_orgId_leadId_idx" ON "AtaLigacao"("orgId", "leadId");
CREATE INDEX "AtaLigacao_orgId_clienteId_idx" ON "AtaLigacao"("orgId", "clienteId");

ALTER TABLE "AtaLigacao" ADD CONSTRAINT "AtaLigacao_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A referência é uma das quatro formas; o tipo, um dos dois; a data, AAAA-MM-DD.
-- Linha sem lead e sem cliente não existe: desligar os dois apaga a linha.
ALTER TABLE "AtaLigacao" ADD CONSTRAINT "AtaLigacao_ataRef_check"
  CHECK ("ataRef" ~ '^(vault|memoria|drive|granola):[A-Za-z0-9_-]{1,120}$');
ALTER TABLE "AtaLigacao" ADD CONSTRAINT "AtaLigacao_tipo_check"
  CHECK ("tipo" IN ('ata', 'transcricao'));
ALTER TABLE "AtaLigacao" ADD CONSTRAINT "AtaLigacao_data_check"
  CHECK ("data" IS NULL OR "data" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
ALTER TABLE "AtaLigacao" ADD CONSTRAINT "AtaLigacao_algum_alvo_check"
  CHECK ("leadId" IS NOT NULL OR "clienteId" IS NOT NULL);

-- Isolamento por linha: o grupo padrão.
SELECT app_rls_aplicar_policies(
  'AtaLigacao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "AtaLigacao" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE e as quatro policies. Falha ALTA de propósito:
-- como `migrate deploy` roda no arranque do container, abortar aqui é a API não
-- subir com tabela vazada.
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
   WHERE n.nspname = 'public' AND c.relname = 'AtaLigacao';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'AtaLigacao ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
