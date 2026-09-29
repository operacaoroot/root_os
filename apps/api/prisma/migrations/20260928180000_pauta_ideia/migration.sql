-- CreateEnum
CREATE TYPE "PautaIdeiaStatus" AS ENUM ('ideia', 'em_producao', 'aprovada', 'descartada');

-- CreateEnum
CREATE TYPE "PautaIdeiaPrioridade" AS ENUM ('baixa', 'media', 'alta');

-- AlterTable
ALTER TABLE "PautaPeca" ALTER COLUMN "rodadaId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PautaIdeia" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "pilar" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "ganchoFala" TEXT NOT NULL DEFAULT '',
    "ganchoTela" TEXT NOT NULL DEFAULT '',
    "roteiro" TEXT NOT NULL DEFAULT '',
    "legenda" TEXT NOT NULL DEFAULT '',
    "cta" TEXT NOT NULL DEFAULT '',
    "porque" TEXT NOT NULL DEFAULT '',
    "fontes" JSONB NOT NULL DEFAULT '[]',
    "formato" TEXT NOT NULL,
    "prioridade" "PautaIdeiaPrioridade" NOT NULL DEFAULT 'media',
    "status" "PautaIdeiaStatus" NOT NULL DEFAULT 'ideia',
    "hist" JSONB NOT NULL DEFAULT '[]',
    "pecaId" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'operador',
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadaPor" TEXT,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PautaIdeia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PautaIdeia_pecaId_key" ON "PautaIdeia"("pecaId");

-- CreateIndex
CREATE INDEX "PautaIdeia_orgId_status_idx" ON "PautaIdeia"("orgId", "status");

-- CreateIndex
CREATE INDEX "PautaIdeia_orgId_pilar_idx" ON "PautaIdeia"("orgId", "pilar");

-- AddForeignKey
ALTER TABLE "PautaIdeia" ADD CONSTRAINT "PautaIdeia_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaIdeia" ADD CONSTRAINT "PautaIdeia_pecaId_fkey" FOREIGN KEY ("pecaId") REFERENCES "PautaPeca"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Isolamento por linha: o grupo padrão, leitura e escrita separadas.
--
-- Tabela nova SEM isto é vazamento entre empresas, e a catraca de
-- `tenant-isolation.test.ts` reprova — que é o que se quer. O `orgId` da ideia
-- vem do insert (não há gatilho de pai): ela não pende de rodada nem de
-- episódio, é raiz da própria empresa.
-- ---------------------------------------------------------------------------
SELECT app_rls_aplicar_policies(
  'PautaIdeia',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "PautaIdeia" TO mktos_app';
  END IF;
END $$;
