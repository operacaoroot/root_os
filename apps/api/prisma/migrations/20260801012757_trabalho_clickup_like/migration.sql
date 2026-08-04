-- CreateEnum
CREATE TYPE "WorkStatusType" AS ENUM ('open', 'custom', 'closed');

-- CreateEnum
CREATE TYPE "WorkPriority" AS ENUM ('urgente', 'alta', 'normal', 'baixa');

-- CreateEnum
CREATE TYPE "WorkFieldType" AS ENUM ('drop_down', 'texto', 'numero', 'data', 'checkbox', 'url');

-- CreateTable
CREATE TABLE "WorkFolder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkList" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "folderId" TEXT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkStatus" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WorkStatusType" NOT NULL DEFAULT 'open',
    "color" TEXT NOT NULL DEFAULT '#87909e',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkTag" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#5f55ee',

    CONSTRAINT "WorkTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkField" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "listId" TEXT,
    "name" TEXT NOT NULL,
    "type" "WorkFieldType" NOT NULL DEFAULT 'drop_down',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkFieldOption" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#87909e',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkFieldOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkTask" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "WorkPriority" NOT NULL DEFAULT 'normal',
    "assignee" TEXT,
    "dueDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "parentId" TEXT,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkFieldValue" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "optionId" TEXT,
    "value" TEXT,

    CONSTRAINT "WorkFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_WorkTaskTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_WorkTaskTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkFolder_orgId_name_key" ON "WorkFolder"("orgId", "name");

-- CreateIndex
CREATE INDEX "WorkList_orgId_folderId_idx" ON "WorkList"("orgId", "folderId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkStatus_listId_name_key" ON "WorkStatus"("listId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkTag_orgId_name_key" ON "WorkTag"("orgId", "name");

-- CreateIndex
CREATE INDEX "WorkField_orgId_listId_idx" ON "WorkField"("orgId", "listId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkFieldOption_fieldId_name_key" ON "WorkFieldOption"("fieldId", "name");

-- CreateIndex
CREATE INDEX "WorkTask_orgId_listId_statusId_idx" ON "WorkTask"("orgId", "listId", "statusId");

-- CreateIndex
CREATE INDEX "WorkTask_orgId_archived_dueDate_idx" ON "WorkTask"("orgId", "archived", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "WorkTask_orgId_externalId_key" ON "WorkTask"("orgId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkFieldValue_taskId_fieldId_key" ON "WorkFieldValue"("taskId", "fieldId");

-- CreateIndex
CREATE INDEX "WorkComment_taskId_createdAt_idx" ON "WorkComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "_WorkTaskTags_B_index" ON "_WorkTaskTags"("B");

-- AddForeignKey
ALTER TABLE "WorkFolder" ADD CONSTRAINT "WorkFolder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkList" ADD CONSTRAINT "WorkList_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkList" ADD CONSTRAINT "WorkList_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "WorkFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkStatus" ADD CONSTRAINT "WorkStatus_listId_fkey" FOREIGN KEY ("listId") REFERENCES "WorkList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTag" ADD CONSTRAINT "WorkTag_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkField" ADD CONSTRAINT "WorkField_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkField" ADD CONSTRAINT "WorkField_listId_fkey" FOREIGN KEY ("listId") REFERENCES "WorkList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkFieldOption" ADD CONSTRAINT "WorkFieldOption_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "WorkField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_listId_fkey" FOREIGN KEY ("listId") REFERENCES "WorkList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "WorkStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorkTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkFieldValue" ADD CONSTRAINT "WorkFieldValue_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkFieldValue" ADD CONSTRAINT "WorkFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "WorkField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkFieldValue" ADD CONSTRAINT "WorkFieldValue_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "WorkFieldOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkComment" ADD CONSTRAINT "WorkComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WorkTaskTags" ADD CONSTRAINT "_WorkTaskTags_A_fkey" FOREIGN KEY ("A") REFERENCES "WorkTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WorkTaskTags" ADD CONSTRAINT "_WorkTaskTags_B_fkey" FOREIGN KEY ("B") REFERENCES "WorkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
