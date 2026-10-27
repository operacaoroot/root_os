-- ============================================================================
-- FROTA (27/10/2026): os servidores de cliente que a ROOT opera
-- ============================================================================
--
-- ADITIVA: quatro tabelas novas, nenhuma coluna mexida em tabela existente,
-- nenhum dado reescrito.
--
-- "FrotaCasa" é um servidor preparado pelo kit-instalacao-vps. O relator do kit
-- manda o estado da máquina para a API, autenticado pelo token da casa (só o
-- hash fica aqui). "FrotaAcesso" é quem tem chave SSH na casa; "FrotaOrdem" é a
-- fila que a casa puxa (revogar chave, desligar automação, rodar verificar,
-- pedir backup); "FrotaEvento" é o registro, que só recebe linha nova.
--
-- Raiz da empresa, NÃO filha: o "orgId" vem do insert. Isolamento por linha com
-- FORCE, o grupo padrão de policies, como a "AtaLigacao".
--
-- Rollback (só se nada depender delas):
--   DROP TABLE "FrotaOrdem"; DROP TABLE "FrotaEvento"; DROP TABLE "FrotaAcesso"; DROP TABLE "FrotaCasa";
-- ============================================================================

CREATE TABLE "FrotaCasa" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "casa" TEXT NOT NULL,
    "cliente" TEXT NOT NULL,
    "dono" TEXT,
    "responsavel" TEXT,
    "etapa" TEXT NOT NULL DEFAULT 'preparar',
    "provedor" TEXT,
    "hostname" TEXT,
    "ip" TEXT,
    "vpn" TEXT,
    "sistema" TEXT,
    "maquina" TEXT,
    "kitVersao" TEXT,
    "acesso" TEXT NOT NULL DEFAULT 'publico',
    "estado" TEXT NOT NULL DEFAULT 'ne',
    "estadoTexto" TEXT,
    "tokenHash" TEXT NOT NULL,
    "ultimoRelatoEm" TIMESTAMP(3),
    "relato" JSONB,
    "ficha" JSONB,
    "lgpd" JSONB,
    "observacoes" TEXT,
    "arquivadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrotaCasa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FrotaCasa_tokenHash_key" ON "FrotaCasa"("tokenHash");
CREATE UNIQUE INDEX "FrotaCasa_orgId_casa_key" ON "FrotaCasa"("orgId", "casa");
CREATE INDEX "FrotaCasa_orgId_estado_idx" ON "FrotaCasa"("orgId", "estado");

ALTER TABLE "FrotaCasa" ADD CONSTRAINT "FrotaCasa_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrotaCasa" ADD CONSTRAINT "FrotaCasa_casa_check"
  CHECK ("casa" ~ '^[a-z0-9][a-z0-9-]{0,39}$');
ALTER TABLE "FrotaCasa" ADD CONSTRAINT "FrotaCasa_estado_check"
  CHECK ("estado" IN ('ok', 'at', 'er', 'ne'));
ALTER TABLE "FrotaCasa" ADD CONSTRAINT "FrotaCasa_acesso_check"
  CHECK ("acesso" IN ('publico', 'vpn'));

CREATE TABLE "FrotaAcesso" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "casaId" TEXT NOT NULL,
    "pessoa" TEXT NOT NULL,
    "fingerprint" TEXT,
    "tipo" TEXT,
    "via" TEXT,
    "desde" TIMESTAMP(3),
    "ultimoLogin" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'ativa',
    "revogadoEm" TIMESTAMP(3),
    "revogadoPor" TEXT,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrotaAcesso_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FrotaAcesso_orgId_casaId_estado_idx" ON "FrotaAcesso"("orgId", "casaId", "estado");
CREATE INDEX "FrotaAcesso_orgId_casaId_fingerprint_idx" ON "FrotaAcesso"("orgId", "casaId", "fingerprint");

ALTER TABLE "FrotaAcesso" ADD CONSTRAINT "FrotaAcesso_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrotaAcesso" ADD CONSTRAINT "FrotaAcesso_casaId_fkey"
  FOREIGN KEY ("casaId") REFERENCES "FrotaCasa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrotaAcesso" ADD CONSTRAINT "FrotaAcesso_estado_check"
  CHECK ("estado" IN ('ativa', 'revogando', 'revogada', 'removida', 'pedido'));

CREATE TABLE "FrotaEvento" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "casaId" TEXT,
    "quando" TIMESTAMP(3) NOT NULL,
    "quem" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT,
    "dados" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrotaEvento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FrotaEvento_orgId_chave_key" ON "FrotaEvento"("orgId", "chave");
CREATE INDEX "FrotaEvento_orgId_quando_idx" ON "FrotaEvento"("orgId", "quando");
CREATE INDEX "FrotaEvento_orgId_casaId_quando_idx" ON "FrotaEvento"("orgId", "casaId", "quando");

ALTER TABLE "FrotaEvento" ADD CONSTRAINT "FrotaEvento_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrotaEvento" ADD CONSTRAINT "FrotaEvento_casaId_fkey"
  FOREIGN KEY ("casaId") REFERENCES "FrotaCasa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FrotaEvento" ADD CONSTRAINT "FrotaEvento_tipo_check"
  CHECK ("tipo" IN ('acesso', 'deploy', 'kit', 'sonda', 'painel'));

CREATE TABLE "FrotaOrdem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "casaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "parametros" JSONB,
    "estado" TEXT NOT NULL DEFAULT 'pendente',
    "criadaPor" TEXT NOT NULL,
    "motivo" TEXT,
    "entregueEm" TIMESTAMP(3),
    "concluidaEm" TIMESTAMP(3),
    "resultado" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrotaOrdem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FrotaOrdem_orgId_casaId_estado_idx" ON "FrotaOrdem"("orgId", "casaId", "estado");

ALTER TABLE "FrotaOrdem" ADD CONSTRAINT "FrotaOrdem_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrotaOrdem" ADD CONSTRAINT "FrotaOrdem_casaId_fkey"
  FOREIGN KEY ("casaId") REFERENCES "FrotaCasa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrotaOrdem" ADD CONSTRAINT "FrotaOrdem_tipo_check"
  CHECK ("tipo" IN ('revogar_chave', 'desligar_automacao', 'rodar_verificar', 'pedir_backup'));
ALTER TABLE "FrotaOrdem" ADD CONSTRAINT "FrotaOrdem_estado_check"
  CHECK ("estado" IN ('pendente', 'entregue', 'aplicada', 'falhou', 'cancelada'));

-- "FrotaEvento" só recebe linha nova POR CONTRATO DA API: não há rota que edite ou
-- apague evento, e o painel não oferece isso. Não há gatilho de imutabilidade no
-- banco de propósito: a suíte de isolamento edita e apaga as próprias sementes.

-- Isolamento por linha: o grupo padrão, tabela a tabela.
SELECT app_rls_aplicar_policies(
  'FrotaCasa',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'FrotaAcesso',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'FrotaEvento',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'FrotaOrdem',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "FrotaCasa" TO mktos_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "FrotaAcesso" TO mktos_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "FrotaEvento" TO mktos_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "FrotaOrdem" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE e as quatro policies em cada tabela. Falha ALTA
-- de propósito: tabela de empresa sem policy é vazamento, não pendência.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  ok boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['FrotaCasa', 'FrotaAcesso', 'FrotaEvento', 'FrotaOrdem'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION '% ficou sem isolamento por linha (rls/force/policies).', t;
    END IF;
  END LOOP;
END $$;
