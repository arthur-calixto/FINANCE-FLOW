-- Preserve o início original do controle antes de permitir exclusões de parcelas.
ALTER TABLE "InstallmentGroup" ADD COLUMN "startingInstallment" INTEGER NOT NULL DEFAULT 1;
UPDATE "InstallmentGroup" g SET "startingInstallment" = COALESCE(
  (SELECT MIN(t."installmentNumber") FROM "Transaction" t WHERE t."installmentGroupId" = g.id), 1
);
ALTER TABLE "InstallmentGroup" ADD CONSTRAINT "InstallmentGroup_startingInstallment_check"
  CHECK ("startingInstallment" BETWEEN 1 AND "installmentCount");

-- Exceção técnica, sem descrição/valores/histórico financeiro.
CREATE TABLE "RecurrenceOccurrenceExclusion" (
  "recurrenceId" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "recurrenceDate" DATE NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurrenceOccurrenceExclusion_pkey" PRIMARY KEY ("recurrenceId", "recurrenceDate"),
  CONSTRAINT "RecurrenceOccurrenceExclusion_workspaceId_recurrenceId_fkey"
    FOREIGN KEY ("workspaceId", "recurrenceId") REFERENCES "Recurrence"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "RecurrenceOccurrenceExclusion_workspaceId_recurrenceId_idx"
  ON "RecurrenceOccurrenceExclusion"("workspaceId", "recurrenceId");
