-- ============================================================================
-- O PERFIL DA PESSOA (produção 22B, I6, 22/10/2026)
-- ============================================================================
--
-- ADITIVA: sete colunas novas em "User" (todas anuláveis, ou com padrão) e uma
-- tabela nova. Nenhuma coluna existente é mexida. A imagem anterior não lê nada
-- disto e continua funcionando com o banco migrado (rollback só de imagem serve).
--
-- "User": apelido, cargo, cidade, fuso, data de nascimento (só a data civil),
-- o nome da pessoa como está no vault (a Equipe casa as notas da Governança por
-- ele) e a versão do perfil (o "esperado" do salvar, que não muda a cada login
-- como o "updatedAt").
--
-- "FotoDePerfil": a foto, NO BANCO, porque a homologação não tem armazém de
-- arquivos. O teto de 256 KB é CHECK do banco; a tela reduz a 256 px antes de
-- enviar e o servidor confere o tipo pelos bytes (JPEG, PNG ou WebP) e o lado
-- até 512 px. Trocar ou tirar a foto NÃO apaga: a anterior ganha
-- "substituidaEm", e só pode haver UMA sem ela por pessoa (índice único parcial).
--
-- Raiz da empresa, NÃO filha: o "orgId" vem do insert, e a FK composta
-- ("userId", "orgId") prende a foto à pessoa da mesma empresa.
--
-- Rollback (só se nada depender):
--   DROP TABLE "FotoDePerfil";
--   ALTER TABLE "User" DROP COLUMN "apelido", DROP COLUMN "cargo", DROP COLUMN "cidade",
--     DROP COLUMN "fuso", DROP COLUMN "dataNascimento", DROP COLUMN "nomeNoVault",
--     DROP COLUMN "perfilAtualizadoEm";
-- ============================================================================

ALTER TABLE "User" ADD COLUMN "apelido" TEXT;
ALTER TABLE "User" ADD COLUMN "cargo" TEXT;
ALTER TABLE "User" ADD COLUMN "cidade" TEXT;
ALTER TABLE "User" ADD COLUMN "fuso" TEXT;
ALTER TABLE "User" ADD COLUMN "dataNascimento" DATE;
ALTER TABLE "User" ADD COLUMN "nomeNoVault" TEXT;
ALTER TABLE "User" ADD COLUMN "perfilAtualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "User" ADD CONSTRAINT "User_perfil_tamanhos_check" CHECK (
  ("apelido" IS NULL OR char_length("apelido") <= 40)
  AND ("cargo" IS NULL OR char_length("cargo") <= 80)
  AND ("cidade" IS NULL OR char_length("cidade") <= 80)
  AND ("fuso" IS NULL OR char_length("fuso") <= 64)
  AND ("nomeNoVault" IS NULL OR char_length("nomeNoVault") <= 80)
);

CREATE TABLE "FotoDePerfil" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "largura" INTEGER NOT NULL,
    "altura" INTEGER NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "enviadaPorId" TEXT NOT NULL,
    "enviadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "substituidaEm" TIMESTAMP(3),

    CONSTRAINT "FotoDePerfil_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FotoDePerfil_orgId_userId_idx" ON "FotoDePerfil"("orgId", "userId");
-- Uma foto em uso por pessoa; as substituídas ficam.
CREATE UNIQUE INDEX "FotoDePerfil_em_uso_key" ON "FotoDePerfil"("orgId", "userId") WHERE "substituidaEm" IS NULL;

ALTER TABLE "FotoDePerfil" ADD CONSTRAINT "FotoDePerfil_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FotoDePerfil" ADD CONSTRAINT "FotoDePerfil_userId_orgId_fkey"
  FOREIGN KEY ("userId", "orgId") REFERENCES "User"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "FotoDePerfil" ADD CONSTRAINT "FotoDePerfil_conteudo_check" CHECK (
  "tipo" IN ('jpeg', 'png', 'webp')
  AND octet_length("conteudo") BETWEEN 1 AND 262144
  AND "tamanho" = octet_length("conteudo")
  AND "largura" BETWEEN 16 AND 512
  AND "altura" BETWEEN 16 AND 512
  AND "sha256" ~ '^[0-9a-f]{64}$'
);

SELECT app_rls_aplicar_policies(
  'FotoDePerfil',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "FotoDePerfil" TO mktos_app';
  END IF;
END $$;

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
   WHERE n.nspname = 'public' AND c.relname = 'FotoDePerfil';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'FotoDePerfil ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento.';
  END IF;
END $$;
