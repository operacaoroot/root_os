-- AlterTable
ALTER TABLE "FinanceTransaction" ADD COLUMN     "matchScore" DOUBLE PRECISION,
ADD COLUMN     "matchType" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3);
