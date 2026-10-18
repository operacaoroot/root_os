-- Migração aditiva. O texto legado não deduz vínculo com conta.
ALTER TABLE "WorkTask" ADD COLUMN "assigneeUserId" TEXT;
CREATE UNIQUE INDEX "User_id_orgId_key" ON "User"("id", "orgId");
CREATE INDEX "WorkTask_orgId_assigneeUserId_archived_idx" ON "WorkTask"("orgId", "assigneeUserId", "archived");
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_assigneeUserId_orgId_fkey"
  FOREIGN KEY ("assigneeUserId", "orgId") REFERENCES "User"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
