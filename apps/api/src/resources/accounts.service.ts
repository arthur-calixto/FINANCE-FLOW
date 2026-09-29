import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateAccount, UpdateAccount } from '@finance-flow/validation';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../generated/prisma/client';
import { databaseOperation } from './database-errors';
@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}
  private present<T extends { initialBalance: Prisma.Decimal }>(record: T) {
    return { ...record, initialBalance: record.initialBalance.toFixed(2) };
  }
  async list(workspaceId: string, includeInactive: boolean) {
    const rows = await this.prisma.client.account.findMany({
      where: { workspaceId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.present(row));
  }
  async get(workspaceId: string, id: string) {
    const row = await this.prisma.client.account.findFirst({
      where: { workspaceId, id },
    });
    if (!row)
      throw new NotFoundException('Conta não encontrada neste workspace.');
    return this.present(row);
  }
  async create(workspaceId: string, data: CreateAccount) {
    return this.save(workspaceId, data);
  }
  async update(workspaceId: string, id: string, data: UpdateAccount) {
    return this.save(workspaceId, data, id);
  }
  async deactivate(workspaceId: string, id: string) {
    return this.update(workspaceId, id, { isActive: false });
  }
  private save(
    workspaceId: string,
    data: CreateAccount | UpdateAccount,
    id?: string,
  ) {
    return databaseOperation(() =>
      this.prisma.client.$transaction(async (tx) => {
        if (id && !(await tx.account.findFirst({ where: { workspaceId, id } })))
          throw new NotFoundException('Conta não encontrada neste workspace.');
        if (
          data.ownerMemberId &&
          !(await tx.workspaceMember.findFirst({
            where: { workspaceId, id: data.ownerMemberId },
          }))
        )
          throw new BadRequestException(
            'O responsável deve pertencer a este workspace.',
          );
        const fields = {
          ...data,
          ...(data.initialBalance !== undefined
            ? { initialBalance: new Prisma.Decimal(data.initialBalance) }
            : {}),
        };
        const row = id
          ? await tx.account.update({
              where: { workspaceId_id: { workspaceId, id } },
              data: fields,
            })
          : await tx.account.create({
              data: {
                ...fields,
                workspaceId,
                name: data.name!,
                type: data.type!,
              },
            });
        return this.present(row);
      }),
    );
  }
}
