-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED', 'DECLINED');

-- CreateTable
CREATE TABLE "WorkspaceInvitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" VARCHAR(64) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "acceptedByUserId" UUID,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_workspaceId_status_idx" ON "WorkspaceInvitation"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_invitedByUserId_idx" ON "WorkspaceInvitation"("invitedByUserId");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_acceptedByUserId_idx" ON "WorkspaceInvitation"("acceptedByUserId");

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Pending duplicates include expired rows until the service lazily expires them.
CREATE UNIQUE INDEX "WorkspaceInvitation_pending_email_key" ON "WorkspaceInvitation" ("workspaceId", "email") WHERE "status" = 'PENDING';
ALTER TABLE "WorkspaceInvitation"
  ADD CONSTRAINT "WorkspaceInvitation_normalized_email_check" CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "WorkspaceInvitation_member_role_check" CHECK ("role" = 'MEMBER'),
  ADD CONSTRAINT "WorkspaceInvitation_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "WorkspaceInvitation_acceptance_check" CHECK (
    ("status" = 'ACCEPTED' AND "acceptedByUserId" IS NOT NULL AND "acceptedAt" IS NOT NULL)
    OR ("status" <> 'ACCEPTED' AND "acceptedByUserId" IS NULL AND "acceptedAt" IS NULL)
  );
