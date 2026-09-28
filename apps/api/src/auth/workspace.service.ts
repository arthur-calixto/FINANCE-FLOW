import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}
  async list(userId: string) {
    const memberships = await this.prisma.client.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return memberships.map(({ workspace, role }) => ({
      id: workspace.id,
      name: workspace.name,
      type: workspace.type,
      role,
    }));
  }
  async requireMembership(userId: string, workspaceId: string) {
    const member = await this.prisma.client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true },
    });
    if (!member) throw new ForbiddenException('Sem acesso ao workspace');
    return {
      id: member.workspace.id,
      name: member.workspace.name,
      type: member.workspace.type,
      role: member.role,
    };
  }
}
