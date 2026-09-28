-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authUserId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");
