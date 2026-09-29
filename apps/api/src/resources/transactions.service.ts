import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { brazilToday } from '@finance-flow/types';
import type {
  CreateTransaction,
  UpdateTransaction,
  PayTransaction,
  TransactionQuery,
} from '@finance-flow/validation';
import { Prisma, type Transaction } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { databaseOperation } from './database-errors';
const date = (v: string) => new Date(`${v}T00:00:00.000Z`);
const civil = (v: Date) => v.toISOString().slice(0, 10);
const relations = {
  installmentGroup: { select: { id: true, installmentCount: true } },
  creditCard: { select: { id: true, name: true } },
  invoice: { select: { id: true, referenceMonth: true } },
  account: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} as const;
const simple = {
  creditCardId: null,
  invoiceId: null,
  recurrenceId: null,
};
@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}
  private present<T extends Transaction>(row: T, today = brazilToday()) {
    return {
      ...row,
      status:
        row.status === 'PENDING' || row.status === 'OVERDUE'
          ? civil(row.dueDate) < today
            ? 'OVERDUE'
            : 'PENDING'
          : row.status,
      expectedAmount: row.expectedAmount?.toFixed(2) ?? null,
      amount: row.amount?.toFixed(2) ?? null,
      transactionDate: civil(row.transactionDate),
      dueDate: civil(row.dueDate),
      competenceDate: civil(row.competenceDate),
    };
  }
  private where(
    workspaceId: string,
    q: TransactionQuery,
  ): Prisma.TransactionWhereInput {
    const today = date(brazilToday());
    return {
      workspaceId,
      recurrenceId: null,
      ...(q.month ? { competenceDate: date(`${q.month}-01`) } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.search
        ? { description: { contains: q.search, mode: 'insensitive' } }
        : {}),
      ...(q.status === 'OVERDUE'
        ? { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { lt: today } }
        : q.status === 'PENDING'
          ? { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { gte: today } }
          : q.status
            ? { status: q.status }
            : {}),
    };
  }
  async list(workspaceId: string, q: TransactionQuery) {
    return (
      await this.prisma.client.transaction.findMany({
        where: this.where(workspaceId, q),
        include: relations,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      })
    ).map((r) => this.present(r));
  }
  async get(workspaceId: string, id: string) {
    const row = await this.prisma.client.transaction.findFirst({
      where: {
        workspaceId,
        id,
        recurrenceId: null,
      },
      include: relations,
    });
    if (!row) throw new NotFoundException('Lançamento não encontrado.');
    return this.present(row);
  }
  async summary(workspaceId: string, month: string) {
    const groups = await this.prisma.client.transaction.groupBy({
      by: ['type', 'status'],
      where: {
        ...this.where(workspaceId, { month }),
        status: { not: 'CANCELLED' },
      },
      _sum: { expectedAmount: true, amount: true },
    });
    const sums = {
      income: {
        expected: new Prisma.Decimal(0),
        realized: new Prisma.Decimal(0),
      },
      expense: {
        expected: new Prisma.Decimal(0),
        realized: new Prisma.Decimal(0),
      },
    };
    for (const g of groups) {
      const s = sums[g.type === 'INCOME' ? 'income' : 'expense'];
      s.expected = s.expected.plus(g._sum.expectedAmount ?? 0);
      if (g.status === 'PAID') s.realized = s.realized.plus(g._sum.amount ?? 0);
    }
    return {
      income: {
        expected: sums.income.expected.toFixed(2),
        realized: sums.income.realized.toFixed(2),
      },
      expense: {
        expected: sums.expense.expected.toFixed(2),
        realized: sums.expense.realized.toFixed(2),
      },
    };
  }
  private async validateLinks(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    data: CreateTransaction | UpdateTransaction,
    old?: Transaction,
  ) {
    if (data.accountId)
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${data.accountId}::uuid AND "workspaceId" = ${workspaceId}::uuid FOR SHARE`;
    if (
      data.accountId &&
      data.accountId !== old?.accountId &&
      !(await tx.account.findFirst({
        where: { workspaceId, id: data.accountId, isActive: true },
      }))
    )
      throw new BadRequestException(
        'Selecione uma conta ativa deste workspace.',
      );
    const categoryId = data.categoryId ?? old?.categoryId;
    if (categoryId) {
      const category = await tx.category.findFirst({
        where: { workspaceId, id: categoryId },
      });
      if (
        !category ||
        category.type !== (data.type ?? old?.type) ||
        (categoryId !== old?.categoryId && !category.isActive)
      )
        throw new BadRequestException(
          'Selecione categoria ativa e compatível deste workspace.',
        );
    }
    if (
      data.ownerMemberId &&
      !(await tx.workspaceMember.findFirst({
        where: { workspaceId, id: data.ownerMemberId },
      }))
    )
      throw new BadRequestException('Responsável inválido neste workspace.');
  }
  private fields(data: CreateTransaction | UpdateTransaction) {
    return {
      ...data,
      ...(data.transactionDate
        ? { transactionDate: date(data.transactionDate) }
        : {}),
      ...(data.dueDate
        ? {
            dueDate: date(data.dueDate),
            competenceDate: date(data.dueDate.slice(0, 7) + '-01'),
          }
        : {}),
    };
  }
  create(workspaceId: string, createdBy: string, data: CreateTransaction) {
    return databaseOperation(() =>
      this.prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'categories:' + workspaceId}, 0))::text`;
        await this.validateLinks(tx, workspaceId, data);
        return this.present(
          await tx.transaction.create({
            data: {
              ...this.fields(data),
              workspaceId,
              createdBy,
              description: data.description,
              type: data.type,
              transactionDate: date(data.transactionDate),
              dueDate: date(data.dueDate),
              competenceDate: date(data.dueDate.slice(0, 7) + '-01'),
              status: 'PENDING',
            },
            include: relations,
          }),
        );
      }),
    );
  }
  private mutate(
    workspaceId: string,
    id: string,
    action: (
      tx: Prisma.TransactionClient,
      row: Transaction,
    ) => Promise<Prisma.TransactionUncheckedUpdateInput>,
  ) {
    return databaseOperation(() =>
      this.prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'categories:' + workspaceId}, 0))::text`;
        await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${id}::uuid AND "workspaceId" = ${workspaceId}::uuid FOR UPDATE`;
        const row = await tx.transaction.findFirst({
          where: { workspaceId, id, ...simple },
        });
        if (!row) throw new NotFoundException('Lançamento não encontrado.');
        const data = await action(tx, row);
        return this.present(
          await tx.transaction.update({
            where: { id, workspaceId },
            data,
            include: relations,
          }),
        );
      }),
    );
  }
  update(workspaceId: string, id: string, data: UpdateTransaction) {
    return this.mutate(workspaceId, id, async (tx, row) => {
      if (row.installmentGroupId)
        throw new ConflictException(
          'Parcelas não podem ser editadas após a geração.',
        );
      if (row.status === 'PAID' || row.status === 'CANCELLED')
        throw new ConflictException(
          'Reabra o lançamento pago antes de editar. Cancelados não podem ser editados.',
        );
      if (
        (data.expectedAmount === undefined
          ? row.expectedAmount
          : data.expectedAmount) == null &&
        (data.amount === undefined ? row.amount : data.amount) == null
      )
        throw new BadRequestException('Informe valor previsto ou realizado.');
      await this.validateLinks(tx, workspaceId, data, row);
      return this.fields(data);
    });
  }
  pay(workspaceId: string, id: string, data: PayTransaction) {
    return this.mutate(workspaceId, id, async (_tx, row) => {
      if (row.status === 'PAID' || row.status === 'CANCELLED')
        throw new ConflictException(
          'Somente lançamentos pendentes podem receber baixa.',
        );
      const amount = data.amount ?? row.amount ?? row.expectedAmount;
      if (amount == null)
        throw new BadRequestException('Informe o valor realizado.');
      return { status: 'PAID', amount, paidAt: new Date(data.paidAt) };
    });
  }
  reopen(workspaceId: string, id: string) {
    return this.mutate(workspaceId, id, async (_tx, row) => {
      if (row.status !== 'PAID')
        throw new ConflictException(
          'Somente lançamentos pagos podem ser reabertos.',
        );
      return { status: 'PENDING', paidAt: null };
    });
  }
  cancel(workspaceId: string, id: string) {
    return this.mutate(workspaceId, id, async (_tx, row) => {
      if (row.status === 'PAID')
        throw new ConflictException('Reabra antes de cancelar.');
      return { status: 'CANCELLED' };
    });
  }
}
