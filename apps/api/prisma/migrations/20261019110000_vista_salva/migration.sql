-- ============================================================================
-- A VISTA SALVA — rodada do trabalho T3 (19/10/2026)
--
-- O Rodrigo decidiu: a ordenação é escolha de quem usa, que depois SALVA a
-- configuração de visualização. Minhas tarefas (e o quadro) guardam vistas com
-- nome, uma marcada como padrão, no servidor e por pessoa, para acompanhar a
-- pessoa em qualquer computador.
--
-- Tabela de tenant (raiz, não filha): `orgId` vem do insert. Isolamento por
-- linha FORCE com leitura e escrita separadas, como toda tabela de empresa; o
-- serviço ainda filtra por `userId` (a vista é de uma pessoa).
--
-- CAMINHO DE VOLTA
--   DROP TABLE "VistaSalva";
-- ============================================================================

CREATE TABLE "VistaSalva" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tela" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VistaSalva_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VistaSalva_orgId_userId_tela_nome_key" ON "VistaSalva"("orgId", "userId", "tela", "nome");
CREATE INDEX "VistaSalva_orgId_userId_tela_idx" ON "VistaSalva"("orgId", "userId", "tela");
-- Uma padrão por pessoa e tela.
CREATE UNIQUE INDEX "VistaSalva_padrao_unica" ON "VistaSalva"("orgId", "userId", "tela") WHERE "padrao";

ALTER TABLE "VistaSalva" ADD CONSTRAINT "VistaSalva_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VistaSalva" ADD CONSTRAINT "VistaSalva_tela_check" CHECK ("tela" IN ('minhas-tarefas', 'quadro'));
ALTER TABLE "VistaSalva" ADD CONSTRAINT "VistaSalva_nome_check" CHECK (char_length("nome") BETWEEN 1 AND 60);

SELECT app_rls_aplicar_policies(
  'VistaSalva',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "VistaSalva" TO mktos_app';
  END IF;
END $$;
