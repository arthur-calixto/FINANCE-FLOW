import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { AuthIdentity } from './jwt-verifier';
@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}
  async bootstrap(identity: AuthIdentity) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        // Serialize first-login requests for the same external identity across API instances.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.authUserId}, 0))::text`;
        const existing = await tx.user.findUnique({
          where: { authUserId: identity.authUserId },
        });
        if (existing)
          return tx.user.update({
            where: { id: existing.id },
            data: { email: identity.email, name: identity.name },
            select: { id: true, email: true, name: true },
          });
        const user = await tx.user.create({
          data: identity,
          select: { id: true, email: true, name: true },
        });
        const workspace = await tx.workspace.create({
          data: { name: 'Pessoal', type: 'PERSONAL', ownerId: user.id },
        });
        await tx.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
        });
        return user;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Identidade não pôde ser vinculada. Contate o suporte.',
        );
      }
      throw error;
    }
  }
}
