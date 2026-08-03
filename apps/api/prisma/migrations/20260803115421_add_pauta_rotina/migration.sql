-- CreateEnum
CREATE TYPE "PautaRodadaStatus" AS ENUM ('coletando', 'curada', 'aprovada', 'publicada', 'falhou');

-- CreateEnum
CREATE TYPE "PautaCanal" AS ENUM ('whatsapp', 'instagram', 'newsletter', 'clickup');

-- CreateEnum
CREATE TYPE "PautaPecaStatus" AS ENUM ('rascunho', 'aprovada', 'publicada', 'descartada');

-- CreateTable
CREATE TABLE "PautaRotina" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "tz" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "ultimoRun" TIMESTAMP(3),
    "ultimoStatus" TEXT,
    "proximoRun" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PautaRotina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PautaRodada" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rotinaId" TEXT,
    "status" "PautaRodadaStatus" NOT NULL DEFAULT 'coletando',
    "titulo" TEXT NOT NULL,
    "janelaIni" TIMESTAMP(3) NOT NULL,
    "janelaFim" TIMESTAMP(3) NOT NULL,
    "itens" JSONB NOT NULL DEFAULT '[]',
    "fichasUsadas" TEXT[],
    "corpo" TEXT NOT NULL DEFAULT '',
    "provider" TEXT,
    "model" TEXT,
    "custoUsd" DECIMAL(10,4),
    "erro" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PautaRodada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PautaPeca" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rodadaId" TEXT NOT NULL,
    "canal" "PautaCanal" NOT NULL,
    "formato" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "status" "PautaPecaStatus" NOT NULL DEFAULT 'rascunho',
    "bioLinkId" TEXT,
    "externalId" TEXT,
    "publicadaEm" TIMESTAMP(3),
    "publicadaPor" TEXT,
    "erro" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PautaPeca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PautaRotina_orgId_ativo_idx" ON "PautaRotina"("orgId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "PautaRotina_orgId_slug_key" ON "PautaRotina"("orgId", "slug");

-- CreateIndex
CREATE INDEX "PautaRodada_orgId_status_criadaEm_idx" ON "PautaRodada"("orgId", "status", "criadaEm");

-- CreateIndex
CREATE INDEX "PautaPeca_orgId_status_idx" ON "PautaPeca"("orgId", "status");

-- CreateIndex
CREATE INDEX "PautaPeca_rodadaId_idx" ON "PautaPeca"("rodadaId");

-- AddForeignKey
ALTER TABLE "PautaRotina" ADD CONSTRAINT "PautaRotina_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaRodada" ADD CONSTRAINT "PautaRodada_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaRodada" ADD CONSTRAINT "PautaRodada_rotinaId_fkey" FOREIGN KEY ("rotinaId") REFERENCES "PautaRotina"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaPeca" ADD CONSTRAINT "PautaPeca_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaPeca" ADD CONSTRAINT "PautaPeca_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "PautaRodada"("id") ON DELETE CASCADE ON UPDATE CASCADE;
