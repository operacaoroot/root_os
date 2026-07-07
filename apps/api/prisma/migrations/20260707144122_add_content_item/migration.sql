-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'clickup',
    "externalId" TEXT NOT NULL,
    "listId" TEXT,
    "listName" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusType" TEXT,
    "formato" TEXT,
    "eixo" TEXT,
    "tipo" TEXT,
    "fonte" TEXT,
    "assignee" TEXT,
    "url" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentItem_orgId_status_idx" ON "ContentItem"("orgId", "status");

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
