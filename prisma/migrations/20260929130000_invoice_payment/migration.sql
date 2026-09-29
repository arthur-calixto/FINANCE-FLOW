-- Registro único da liquidação integral na própria fatura, sem nova EXPENSE.
ALTER TABLE "CreditCardInvoice" ADD COLUMN "paymentAccountId" UUID,
  ADD COLUMN "paidAmount" DECIMAL(19,2);
CREATE INDEX "CreditCardInvoice_workspaceId_paymentAccountId_idx" ON "CreditCardInvoice"("workspaceId", "paymentAccountId");
ALTER TABLE "CreditCardInvoice" ADD CONSTRAINT "CreditCardInvoice_workspaceId_paymentAccountId_fkey"
  FOREIGN KEY ("workspaceId", "paymentAccountId") REFERENCES "Account"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CreditCardInvoice" ADD CONSTRAINT "CreditCardInvoice_paidAmount_positive"
  CHECK ("paidAmount" IS NULL OR ("paidAmount" > 0 AND "paidAmount" <> 'NaN'::numeric));
ALTER TABLE "CreditCardInvoice" ADD CONSTRAINT "CreditCardInvoice_payment_complete"
  CHECK (("paymentAccountId" IS NULL AND "paidAmount" IS NULL) OR
    ("paymentAccountId" IS NOT NULL AND "paidAmount" IS NOT NULL AND "paidAt" IS NOT NULL AND status = 'PAID'));
