-- CreateEnum
CREATE TYPE "FinanceAccountType" AS ENUM ('corrente', 'poupanca', 'caixa', 'cartao', 'investimento');

-- CreateEnum
CREATE TYPE "FinanceTxType" AS ENUM ('entrada', 'saida');

-- CreateEnum
CREATE TYPE "FinanceTxStatus" AS ENUM ('previsto', 'realizado', 'conciliado');

-- CreateEnum
CREATE TYPE "FinanceCategoryKind" AS ENUM ('receita', 'despesa');

-- CreateEnum
CREATE TYPE "BankConnectionStatus" AS ENUM ('pending', 'connected', 'error', 'disconnected');

-- CreateTable
CREATE TABLE "BankConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'pluggy',
    "externalId" TEXT,
    "institutionName" TEXT,
    "status" "BankConnectionStatus" NOT NULL DEFAULT 'pending',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinanceAccountType" NOT NULL DEFAULT 'corrente',
    "institution" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "connectionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceCategory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinanceCategoryKind" NOT NULL DEFAULT 'despesa',
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceTransaction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT,
    "type" "FinanceTxType" NOT NULL,
    "status" "FinanceTxStatus" NOT NULL DEFAULT 'realizado',
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "counterparty" TEXT,
    "documentNumber" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankConnection_orgId_idx" ON "BankConnection"("orgId");

-- CreateIndex
CREATE INDEX "FinanceAccount_orgId_idx" ON "FinanceAccount"("orgId");

-- CreateIndex
CREATE INDEX "FinanceAccount_orgId_provider_idx" ON "FinanceAccount"("orgId", "provider");

-- CreateIndex
CREATE INDEX "FinanceCategory_orgId_idx" ON "FinanceCategory"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCategory_orgId_kind_name_key" ON "FinanceCategory"("orgId", "kind", "name");

-- CreateIndex
CREATE INDEX "FinanceTransaction_orgId_date_idx" ON "FinanceTransaction"("orgId", "date");

-- CreateIndex
CREATE INDEX "FinanceTransaction_orgId_status_idx" ON "FinanceTransaction"("orgId", "status");

-- CreateIndex
CREATE INDEX "FinanceTransaction_accountId_idx" ON "FinanceTransaction"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceTransaction_orgId_accountId_externalId_key" ON "FinanceTransaction"("orgId", "accountId", "externalId");

-- AddForeignKey
ALTER TABLE "BankConnection" ADD CONSTRAINT "BankConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAccount" ADD CONSTRAINT "FinanceAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAccount" ADD CONSTRAINT "FinanceAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCategory" ADD CONSTRAINT "FinanceCategory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
