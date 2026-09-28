-- CreateEnum
CREATE TYPE "WorkspaceType" AS ENUM ('PERSONAL', 'FAMILY', 'BUSINESS');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'SAVINGS', 'CASH', 'INVESTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'CLOSED', 'PAID', 'OVERDUE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" "WorkspaceType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "initialBalance" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "ownerMemberId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "expectedAmount" DECIMAL(19,2),
    "amount" DECIMAL(19,2),
    "transactionDate" DATE NOT NULL,
    "competenceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "accountId" UUID,
    "categoryId" UUID,
    "creditCardId" UUID,
    "invoiceId" UUID,
    "installmentGroupId" UUID,
    "recurrenceId" UUID,
    "ownerMemberId" UUID,
    "installmentNumber" INTEGER,
    "createdBy" UUID NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentGroup" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "totalAmount" DECIMAL(19,2) NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "purchaseDate" DATE NOT NULL,
    "categoryId" UUID,
    "accountId" UUID,
    "creditCardId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InstallmentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recurrence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "expectedAmount" DECIMAL(19,2) NOT NULL,
    "categoryId" UUID,
    "accountId" UUID,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "dueDay" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "nextGenerationDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Recurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditCard" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "lastFourDigits" VARCHAR(4),
    "creditLimit" DECIMAL(19,2) NOT NULL,
    "closingDay" INTEGER NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "ownerMemberId" UUID,
    "paymentAccountId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CreditCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditCardInvoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "creditCardId" UUID NOT NULL,
    "referenceMonth" DATE NOT NULL,
    "closingDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CreditCardInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "sourceAccountId" UUID NOT NULL,
    "destinationAccountId" UUID NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "transferDate" DATE NOT NULL,
    "description" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_id_key" ON "WorkspaceMember"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "Account_workspaceId_ownerMemberId_idx" ON "Account"("workspaceId", "ownerMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_workspaceId_id_key" ON "Account"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "Category_workspaceId_parentId_idx" ON "Category"("workspaceId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_workspaceId_id_key" ON "Category"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_competenceDate_idx" ON "Transaction"("workspaceId", "competenceDate");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_dueDate_idx" ON "Transaction"("workspaceId", "dueDate");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_status_dueDate_idx" ON "Transaction"("workspaceId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_accountId_idx" ON "Transaction"("workspaceId", "accountId");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_categoryId_idx" ON "Transaction"("workspaceId", "categoryId");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_creditCardId_idx" ON "Transaction"("workspaceId", "creditCardId");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_invoiceId_idx" ON "Transaction"("workspaceId", "invoiceId");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_recurrenceId_idx" ON "Transaction"("workspaceId", "recurrenceId");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_installmentGroupId_idx" ON "Transaction"("workspaceId", "installmentGroupId");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_ownerMemberId_idx" ON "Transaction"("workspaceId", "ownerMemberId");

-- CreateIndex
CREATE INDEX "Transaction_createdBy_idx" ON "Transaction"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_installmentGroupId_installmentNumber_key" ON "Transaction"("installmentGroupId", "installmentNumber");

-- CreateIndex
CREATE INDEX "InstallmentGroup_workspaceId_categoryId_idx" ON "InstallmentGroup"("workspaceId", "categoryId");

-- CreateIndex
CREATE INDEX "InstallmentGroup_workspaceId_accountId_idx" ON "InstallmentGroup"("workspaceId", "accountId");

-- CreateIndex
CREATE INDEX "InstallmentGroup_workspaceId_creditCardId_idx" ON "InstallmentGroup"("workspaceId", "creditCardId");

-- CreateIndex
CREATE INDEX "InstallmentGroup_createdBy_idx" ON "InstallmentGroup"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentGroup_workspaceId_id_key" ON "InstallmentGroup"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "Recurrence_workspaceId_categoryId_idx" ON "Recurrence"("workspaceId", "categoryId");

-- CreateIndex
CREATE INDEX "Recurrence_workspaceId_accountId_idx" ON "Recurrence"("workspaceId", "accountId");

-- CreateIndex
CREATE INDEX "Recurrence_workspaceId_isActive_nextGenerationDate_idx" ON "Recurrence"("workspaceId", "isActive", "nextGenerationDate");

-- CreateIndex
CREATE INDEX "Recurrence_createdBy_idx" ON "Recurrence"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "Recurrence_workspaceId_id_key" ON "Recurrence"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "CreditCard_workspaceId_ownerMemberId_idx" ON "CreditCard"("workspaceId", "ownerMemberId");

-- CreateIndex
CREATE INDEX "CreditCard_workspaceId_paymentAccountId_idx" ON "CreditCard"("workspaceId", "paymentAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditCard_workspaceId_id_key" ON "CreditCard"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "CreditCardInvoice_workspaceId_status_dueDate_idx" ON "CreditCardInvoice"("workspaceId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "CreditCardInvoice_workspaceId_creditCardId_idx" ON "CreditCardInvoice"("workspaceId", "creditCardId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditCardInvoice_workspaceId_id_key" ON "CreditCardInvoice"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CreditCardInvoice_creditCardId_referenceMonth_key" ON "CreditCardInvoice"("creditCardId", "referenceMonth");

-- CreateIndex
CREATE INDEX "Transfer_workspaceId_transferDate_idx" ON "Transfer"("workspaceId", "transferDate");

-- CreateIndex
CREATE INDEX "Transfer_workspaceId_sourceAccountId_idx" ON "Transfer"("workspaceId", "sourceAccountId");

-- CreateIndex
CREATE INDEX "Transfer_workspaceId_destinationAccountId_idx" ON "Transfer"("workspaceId", "destinationAccountId");

-- CreateIndex
CREATE INDEX "Transfer_createdBy_idx" ON "Transfer"("createdBy");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "WorkspaceMember"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_workspaceId_parentId_fkey" FOREIGN KEY ("workspaceId", "parentId") REFERENCES "Category"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "WorkspaceMember"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "Account"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_categoryId_fkey" FOREIGN KEY ("workspaceId", "categoryId") REFERENCES "Category"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_creditCardId_fkey" FOREIGN KEY ("workspaceId", "creditCardId") REFERENCES "CreditCard"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_invoiceId_fkey" FOREIGN KEY ("workspaceId", "invoiceId") REFERENCES "CreditCardInvoice"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_installmentGroupId_fkey" FOREIGN KEY ("workspaceId", "installmentGroupId") REFERENCES "InstallmentGroup"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_recurrenceId_fkey" FOREIGN KEY ("workspaceId", "recurrenceId") REFERENCES "Recurrence"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InstallmentGroup" ADD CONSTRAINT "InstallmentGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InstallmentGroup" ADD CONSTRAINT "InstallmentGroup_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InstallmentGroup" ADD CONSTRAINT "InstallmentGroup_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "Account"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InstallmentGroup" ADD CONSTRAINT "InstallmentGroup_workspaceId_categoryId_fkey" FOREIGN KEY ("workspaceId", "categoryId") REFERENCES "Category"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InstallmentGroup" ADD CONSTRAINT "InstallmentGroup_workspaceId_creditCardId_fkey" FOREIGN KEY ("workspaceId", "creditCardId") REFERENCES "CreditCard"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "Account"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_workspaceId_categoryId_fkey" FOREIGN KEY ("workspaceId", "categoryId") REFERENCES "Category"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "WorkspaceMember"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_workspaceId_paymentAccountId_fkey" FOREIGN KEY ("workspaceId", "paymentAccountId") REFERENCES "Account"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CreditCardInvoice" ADD CONSTRAINT "CreditCardInvoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CreditCardInvoice" ADD CONSTRAINT "CreditCardInvoice_workspaceId_creditCardId_fkey" FOREIGN KEY ("workspaceId", "creditCardId") REFERENCES "CreditCard"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_workspaceId_sourceAccountId_fkey" FOREIGN KEY ("workspaceId", "sourceAccountId") REFERENCES "Account"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_workspaceId_destinationAccountId_fkey" FOREIGN KEY ("workspaceId", "destinationAccountId") REFERENCES "Account"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CHECKs de domínio mantidos em SQL (não representáveis no schema Prisma 7).
-- NULL continua permitido nos montantes opcionais de Transaction.
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_closingDay_range_check" CHECK ("closingDay" BETWEEN 1 AND 31);
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_dueDay_range_check" CHECK ("dueDay" BETWEEN 1 AND 31);
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_dueDay_range_check" CHECK ("dueDay" BETWEEN 1 AND 31);
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_interval_positive_check" CHECK ("interval" > 0);
ALTER TABLE "InstallmentGroup" ADD CONSTRAINT "InstallmentGroup_installmentCount_positive_check" CHECK ("installmentCount" > 0);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_expectedAmount_positive_check" CHECK ("expectedAmount" > 0 AND "expectedAmount" <> 'NaN'::numeric);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amount_positive_check" CHECK ("amount" > 0 AND "amount" <> 'NaN'::numeric);
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_expectedAmount_positive_check" CHECK ("expectedAmount" > 0 AND "expectedAmount" <> 'NaN'::numeric);
ALTER TABLE "InstallmentGroup" ADD CONSTRAINT "InstallmentGroup_totalAmount_positive_check" CHECK ("totalAmount" > 0 AND "totalAmount" <> 'NaN'::numeric);
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_amount_positive_check" CHECK ("amount" > 0 AND "amount" <> 'NaN'::numeric);
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_different_accounts_check" CHECK ("sourceAccountId" <> "destinationAccountId");
