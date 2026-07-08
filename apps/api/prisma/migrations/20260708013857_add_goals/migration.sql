-- CreateTable
CREATE TABLE "GoalConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "challengeStart" TIMESTAMP(3) NOT NULL,
    "targetPosts" INTEGER NOT NULL DEFAULT 1000,
    "targetViews" BIGINT NOT NULL DEFAULT 20000000,
    "targetList" INTEGER NOT NULL DEFAULT 30000,
    "targetSales" INTEGER NOT NULL DEFAULT 1000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalWeek" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3),
    "posts" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "profileVisits" INTEGER NOT NULL DEFAULT 0,
    "newFollowers" INTEGER NOT NULL DEFAULT 0,
    "totalFollowers" INTEGER NOT NULL DEFAULT 0,
    "nonFollowerPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "storyViewers" INTEGER NOT NULL DEFAULT 0,
    "storyReplies" INTEGER NOT NULL DEFAULT 0,
    "listEntries" INTEGER NOT NULL DEFAULT 0,
    "bioClicks" INTEGER NOT NULL DEFAULT 0,
    "lives" INTEGER NOT NULL DEFAULT 0,
    "storyDays" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalWeek_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoalConfig_orgId_key" ON "GoalConfig"("orgId");

-- CreateIndex
CREATE INDEX "GoalWeek_orgId_weekNumber_idx" ON "GoalWeek"("orgId", "weekNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GoalWeek_orgId_weekNumber_key" ON "GoalWeek"("orgId", "weekNumber");

-- AddForeignKey
ALTER TABLE "GoalConfig" ADD CONSTRAINT "GoalConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalWeek" ADD CONSTRAINT "GoalWeek_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
