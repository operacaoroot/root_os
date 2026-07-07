-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "KnowledgeNote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "folder" TEXT,
    "title" TEXT NOT NULL,
    "tags" TEXT[],
    "content" TEXT NOT NULL,
    "links" TEXT[],
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "fileTime" TIMESTAMP(3) NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1536),

    CONSTRAINT "KnowledgeNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeNote_orgId_idx" ON "KnowledgeNote"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeNote_orgId_path_key" ON "KnowledgeNote"("orgId", "path");

-- AddForeignKey
ALTER TABLE "KnowledgeNote" ADD CONSTRAINT "KnowledgeNote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
