-- AlterTable
ALTER TABLE "Recurrence" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "recurrenceDate" DATE;

-- CreateTable
CREATE TABLE "RecurrenceRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "recurrenceId" UUID NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "expectedAmount" DECIMAL(19,2) NOT NULL,
    "accountId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RecurrenceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurrenceRevision_workspaceId_accountId_idx" ON "RecurrenceRevision"("workspaceId", "accountId");

-- CreateIndex
CREATE INDEX "RecurrenceRevision_workspaceId_categoryId_idx" ON "RecurrenceRevision"("workspaceId", "categoryId");

-- CreateIndex
CREATE INDEX "RecurrenceRevision_createdBy_idx" ON "RecurrenceRevision"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "RecurrenceRevision_recurrenceId_effectiveDate_key" ON "RecurrenceRevision"("recurrenceId", "effectiveDate");

-- Preserva identidade de eventuais ocorrências legadas; duplicatas fazem a migration falhar, sem apagar dados.
UPDATE "Transaction" SET "recurrenceDate" = "dueDate" WHERE "recurrenceId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_recurrenceId_recurrenceDate_key" ON "Transaction"("recurrenceId", "recurrenceDate");

-- AddForeignKey
ALTER TABLE "RecurrenceRevision" ADD CONSTRAINT "RecurrenceRevision_workspaceId_recurrenceId_fkey" FOREIGN KEY ("workspaceId", "recurrenceId") REFERENCES "Recurrence"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RecurrenceRevision" ADD CONSTRAINT "RecurrenceRevision_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "Account"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RecurrenceRevision" ADD CONSTRAINT "RecurrenceRevision_workspaceId_categoryId_fkey" FOREIGN KEY ("workspaceId", "categoryId") REFERENCES "Category"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RecurrenceRevision" ADD CONSTRAINT "RecurrenceRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "RecurrenceRevision" ADD CONSTRAINT "RecurrenceRevision_expectedAmount_positive" CHECK ("expectedAmount" > 0 AND "expectedAmount" <> 'NaN'::numeric);
