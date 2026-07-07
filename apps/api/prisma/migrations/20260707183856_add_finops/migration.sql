-- AlterTable
ALTER TABLE "FinanceTransaction" ADD COLUMN     "chartAccountId" TEXT;

-- CreateTable
CREATE TABLE "ChartAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "parentId" TEXT,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "permiteLancamento" BOOLEAN NOT NULL DEFAULT false,
    "dreLineId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DreLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "operador" TEXT NOT NULL DEFAULT '( )',
    "tipo" TEXT NOT NULL DEFAULT 'origem',
    "formula" TEXT,
    "ordem" INTEGER NOT NULL,
    "visivel" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DreLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChartAccount_orgId_parentId_idx" ON "ChartAccount"("orgId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChartAccount_orgId_codigo_key" ON "ChartAccount"("orgId", "codigo");

-- CreateIndex
CREATE INDEX "DreLine_orgId_ordem_idx" ON "DreLine"("orgId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "DreLine_orgId_codigo_key" ON "DreLine"("orgId", "codigo");

-- CreateIndex
CREATE INDEX "FinanceTransaction_chartAccountId_idx" ON "FinanceTransaction"("chartAccountId");

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_chartAccountId_fkey" FOREIGN KEY ("chartAccountId") REFERENCES "ChartAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartAccount" ADD CONSTRAINT "ChartAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartAccount" ADD CONSTRAINT "ChartAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ChartAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartAccount" ADD CONSTRAINT "ChartAccount_dreLineId_fkey" FOREIGN KEY ("dreLineId") REFERENCES "DreLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DreLine" ADD CONSTRAINT "DreLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
