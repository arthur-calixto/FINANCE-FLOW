import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { DomainUser } from '@finance-flow/types';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const invitationSelect = {
  id: true,
  workspaceId: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
} as const;
@Injectable()
export class SharingService {
  constructor(private readonly prisma: PrismaService) {}
  private async lock(tx: Prisma.TransactionClient, workspaceId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sharing:${workspaceId}`}, 0))::text`;
  }
  private async owner(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ) {
    const member = await tx.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true },
    });
    if (member?.role !== 'OWNER')
      throw new ForbiddenException(
        'Somente OWNER pode administrar este workspace.',
      );
    if (member.workspace.type !== 'FAMILY')
      throw new ForbiddenException(
        'Somente workspaces familiares podem ser compartilhados.',
      );
  }
  private expire(tx: Prisma.TransactionClient, workspaceId: string) {
    return tx.workspaceInvitation.updateMany({
      where: { workspaceId, status: 'PENDING', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
  }
  create(userId: string, name: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name,
          type: 'FAMILY',
          ownerId: userId,
          workspaceMembers: { create: { userId, role: 'OWNER' } },
        },
      });
      return { id: ws.id, name: ws.name, type: ws.type, role: 'OWNER' };
    });
  }
  rename(workspaceId: string, userId: string, name: string) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, workspaceId);
      await this.owner(tx, workspaceId, userId);
      const ws = await tx.workspace.update({
        where: { id: workspaceId },
        data: { name },
      });
      return { id: ws.id, name: ws.name, type: ws.type, role: 'OWNER' };
    });
  }
  async members(workspaceId: string) {
    const rows = await this.prisma.client.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((m) => ({
      id: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }
  invitations(workspaceId: string, userId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, workspaceId);
      await this.owner(tx, workspaceId, userId);
      await this.expire(tx, workspaceId);
      return tx.workspaceInvitation.findMany({
        where: { workspaceId },
        select: invitationSelect,
        orderBy: { createdAt: 'desc' },
      });
    });
  }
  invite(workspaceId: string, user: DomainUser, email: string) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, workspaceId);
      await this.owner(tx, workspaceId, user.id);
      await this.expire(tx, workspaceId);
      if (email === user.email.trim().toLowerCase())
        throw new ConflictException('Você não pode convidar a si próprio.');
      if (
        await tx.workspaceMember.findFirst({
          where: {
            workspaceId,
            user: { email: { equals: email, mode: 'insensitive' } },
          },
        })
      )
        throw new ConflictException('Este usuário já faz parte do workspace.');
      const existing = await tx.workspaceInvitation.findFirst({
        where: { workspaceId, email, status: 'PENDING' },
        select: invitationSelect,
      });
      if (existing) return { invitation: existing, token: null, reused: true };
      const token = randomBytes(32).toString('base64url');
      const invitation = await tx.workspaceInvitation.create({
        data: {
          workspaceId,
          email,
          role: 'MEMBER',
          tokenHash: hash(token),
          invitedByUserId: user.id,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
        select: invitationSelect,
      });
      return { invitation, token, reused: false };
    });
  }
  cancel(workspaceId: string, userId: string, id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, workspaceId);
      await this.owner(tx, workspaceId, userId);
      await this.expire(tx, workspaceId);
      const invitation = await tx.workspaceInvitation.findFirst({
        where: { id, workspaceId },
      });
      if (!invitation) throw new NotFoundException('Convite não encontrado.');
      if (invitation.status !== 'PENDING')
        throw new ConflictException('Este convite não está pendente.');
      return tx.workspaceInvitation.update({
        where: { id },
        data: { status: 'CANCELLED' },
        select: invitationSelect,
      });
    });
  }
  async preview(token: string) {
    const invitation = await this.prisma.client.workspaceInvitation.findUnique({
      where: { tokenHash: hash(token) },
      include: { workspace: true, inviter: { select: { name: true } } },
    });
    if (!invitation || invitation.workspace.type !== 'FAMILY')
      throw new NotFoundException('Convite inválido.');
    return {
      workspaceId: invitation.workspaceId,
      workspaceName: invitation.workspace.name,
      inviterName: invitation.inviter.name,
      expiresAt: invitation.expiresAt,
      status:
        invitation.status === 'PENDING' && invitation.expiresAt <= new Date()
          ? 'EXPIRED'
          : invitation.status,
    };
  }
  async respond(token: string, user: DomainUser, accept: boolean) {
    const tokenHash = hash(token);
    const initial = await this.prisma.client.workspaceInvitation.findUnique({
      where: { tokenHash },
      select: { workspaceId: true },
    });
    if (!initial) throw new NotFoundException('Convite inválido.');
    // Commit lazy expiration even when the response subsequently rejects the token.
    const result = await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, initial.workspaceId);
      await this.expire(tx, initial.workspaceId);
      const invite = await tx.workspaceInvitation.findUniqueOrThrow({
        where: { tokenHash },
        include: { workspace: true },
      });
      if (invite.email !== user.email.trim().toLowerCase())
        return {
          error: 'Este convite foi enviado para outro endereço de e-mail.',
        };
      if (invite.workspace.type !== 'FAMILY')
        return { error: 'Convite inválido.' };
      const membership = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: invite.workspaceId,
            userId: user.id,
          },
        },
      });
      if (
        accept &&
        invite.status === 'ACCEPTED' &&
        invite.acceptedByUserId === user.id &&
        membership
      )
        return { workspaceId: invite.workspaceId, status: 'ACCEPTED' };
      if (invite.status !== 'PENDING')
        return { error: 'Este convite não está mais disponível.' };
      if (accept && !membership)
        await tx.workspaceMember.create({
          data: {
            workspaceId: invite.workspaceId,
            userId: user.id,
            role: 'MEMBER',
          },
        });
      const status = accept ? 'ACCEPTED' : 'DECLINED';
      await tx.workspaceInvitation.update({
        where: { id: invite.id },
        data: {
          status,
          ...(accept
            ? { acceptedByUserId: user.id, acceptedAt: new Date() }
            : {}),
        },
      });
      return { workspaceId: invite.workspaceId, status };
    });
    if ('error' in result) throw new ForbiddenException(result.error);
    return result;
  }
  remove(workspaceId: string, userId: string, memberId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, workspaceId);
      await this.owner(tx, workspaceId, userId);
      const member = await tx.workspaceMember.findFirst({
        where: { id: memberId, workspaceId },
      });
      if (!member) throw new NotFoundException('Membro não encontrado.');
      if (member.role !== 'MEMBER' || member.userId === userId)
        throw new ForbiddenException(
          'Somente MEMBER pode ser removido. O OWNER deve permanecer no workspace.',
        );
      const where = { workspaceId, ownerMemberId: memberId };
      await tx.account.updateMany({ where, data: { ownerMemberId: null } });
      await tx.creditCard.updateMany({ where, data: { ownerMemberId: null } });
      await tx.transaction.updateMany({ where, data: { ownerMemberId: null } });
      await tx.workspaceMember.delete({ where: { id: memberId } });
      return { removed: true };
    });
  }
}
