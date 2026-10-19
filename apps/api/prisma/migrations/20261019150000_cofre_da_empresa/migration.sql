-- Cofre da empresa: senhas, dados e documentos dos sócios, atrás de uma senha
-- própria (não a do login). Campos sensíveis chegam aqui já cifrados pela API.
CREATE TABLE "CofreSenha" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "bloqueadoAte" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CofreSenha_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CofreSenha_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CofreSenha_orgId_userId_key" ON "CofreSenha"("orgId", "userId");

CREATE TABLE "CofreSessao" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CofreSessao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CofreSessao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CofreSessao_tokenHash_key" ON "CofreSessao"("tokenHash");
CREATE INDEX "CofreSessao_orgId_userId_idx" ON "CofreSessao"("orgId", "userId");

CREATE TABLE "CofreItem" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "onde" TEXT,
  "usuarioCifrado" TEXT,
  "segredoCifrado" TEXT,
  "notasCifradas" TEXT,
  "arquivoChave" TEXT,
  "arquivoNome" TEXT,
  "arquivoTipo" TEXT,
  "arquivoTamanho" INTEGER,
  "criadoPor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CofreItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CofreItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CofreItem_tipo_check" CHECK ("tipo" IN ('senha', 'dado', 'documento'))
);
CREATE INDEX "CofreItem_orgId_idx" ON "CofreItem"("orgId");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CofreSenha', 'CofreSessao', 'CofreItem'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    PERFORM public.app_rls_aplicar_policies(t,
      'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
      'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, true, true);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mktos_app', t);
    END IF;
  END LOOP;
END $$;

-- Permissões novas, só no perfil Admin Master (os sócios). Somar aqui, e não
-- pelo db:sync-permissions, que realinha todos os vínculos e revogaria
-- concessões feitas à mão.
INSERT INTO "Permission" ("id", "key")
SELECT gen_random_uuid()::text, k FROM unnest(ARRAY['cofre.ver', 'cofre.editar']) AS k
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "_RolePermissions" ("A", "B")
SELECT p."id", r."id" FROM "Permission" p CROSS JOIN "Role" r
WHERE p."key" IN ('cofre.ver', 'cofre.editar') AND r."key" = 'admin_master'
ON CONFLICT DO NOTHING;
