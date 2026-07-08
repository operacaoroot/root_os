-- CreateTable
CREATE TABLE "MetaAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userToken" TEXT NOT NULL,
    "pageId" TEXT,
    "pageName" TEXT,
    "pageToken" TEXT,
    "igUserId" TEXT,
    "igUsername" TEXT,
    "scope" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaAccount_orgId_key" ON "MetaAccount"("orgId");

-- AddForeignKey
ALTER TABLE "MetaAccount" ADD CONSTRAINT "MetaAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
