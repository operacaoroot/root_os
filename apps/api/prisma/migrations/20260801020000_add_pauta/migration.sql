-- CreateEnum
CREATE TYPE "PautaFonteTipo" AS ENUM ('rss', 'perfil', 'busca', 'manual');

-- CreateEnum
CREATE TYPE "PautaCapturaTipo" AS ENUM ('link', 'print', 'texto');

-- CreateEnum
CREATE TYPE "PautaCapturaStatus" AS ENUM ('rascunho', 'processando', 'ficha', 'descartada', 'erro');

-- CreateEnum
CREATE TYPE "PautaFamilia" AS ENUM ('CUR', 'REA', 'STO', 'DEM', 'CON', 'INT', 'TRE', 'ENC', 'outra');

-- CreateEnum
CREATE TYPE "PautaObjetivo" AS ENUM ('ALC', 'AUT', 'VIN', 'VEN', 'ENG', 'PRO', 'LEA');

-- CreateTable
CREATE TABLE "PautaFonte" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tipo" "PautaFonteTipo" NOT NULL,
    "nome" TEXT NOT NULL,
    "url" TEXT,
    "handle" TEXT,
    "plataforma" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "intervaloMin" INTEGER NOT NULL DEFAULT 720,
    "tetoRunsMes" INTEGER NOT NULL DEFAULT 30,
    "runsNoMes" INTEGER NOT NULL DEFAULT 0,
    "mesReferente" TEXT,
    "ultimaLeitura" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PautaFonte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PautaCaptura" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fonteId" TEXT,
    "tipo" "PautaCapturaTipo" NOT NULL,
    "url" TEXT,
    "urlHash" TEXT NOT NULL,
    "titulo" TEXT,
    "nota" TEXT,
    "bruto" JSONB,
    "imagens" TEXT[],
    "status" "PautaCapturaStatus" NOT NULL DEFAULT 'rascunho',
    "erro" TEXT,
    "apifyRunId" TEXT,
    "custoUsd" DECIMAL(10,4),
    "capturadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturadoPor" TEXT,

    CONSTRAINT "PautaCaptura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PautaReferencia" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "capturaId" TEXT,
    "titulo" TEXT NOT NULL,
    "plataforma" TEXT,
    "autor" TEXT,
    "url" TEXT,
    "publicadoEm" TIMESTAMP(3),
    "familia" "PautaFamilia" NOT NULL,
    "objetivo" "PautaObjetivo" NOT NULL,
    "materiaPrima" TEXT NOT NULL,
    "tensaoCentral" TEXT NOT NULL,
    "emocaoAlvo" TEXT NOT NULL,
    "motorPsicologico" TEXT NOT NULL,
    "formulaHeadline" TEXT NOT NULL,
    "estruturaCorpo" TEXT NOT NULL,
    "prova" TEXT NOT NULL,
    "cta" TEXT,
    "preRequisitos" TEXT,
    "antiPadroes" TEXT,
    "teoriaImplicita" TEXT,
    "metricas" JSONB,
    "tags" TEXT[],
    "campea" BOOLEAN NOT NULL DEFAULT false,
    "origem" TEXT DEFAULT 'manual',
    "vaultPath" TEXT,
    "embedding" vector(1536),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PautaReferencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PautaFonte_orgId_ativo_idx" ON "PautaFonte"("orgId", "ativo");

-- CreateIndex
CREATE INDEX "PautaCaptura_orgId_status_capturadoEm_idx" ON "PautaCaptura"("orgId", "status", "capturadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "PautaCaptura_orgId_urlHash_key" ON "PautaCaptura"("orgId", "urlHash");

-- CreateIndex
CREATE UNIQUE INDEX "PautaReferencia_capturaId_key" ON "PautaReferencia"("capturaId");

-- CreateIndex
CREATE INDEX "PautaReferencia_orgId_familia_objetivo_idx" ON "PautaReferencia"("orgId", "familia", "objetivo");

-- CreateIndex
CREATE INDEX "PautaReferencia_orgId_campea_idx" ON "PautaReferencia"("orgId", "campea");

-- AddForeignKey
ALTER TABLE "PautaFonte" ADD CONSTRAINT "PautaFonte_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaCaptura" ADD CONSTRAINT "PautaCaptura_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaCaptura" ADD CONSTRAINT "PautaCaptura_fonteId_fkey" FOREIGN KEY ("fonteId") REFERENCES "PautaFonte"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaReferencia" ADD CONSTRAINT "PautaReferencia_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaReferencia" ADD CONSTRAINT "PautaReferencia_capturaId_fkey" FOREIGN KEY ("capturaId") REFERENCES "PautaCaptura"("id") ON DELETE SET NULL ON UPDATE CASCADE;
