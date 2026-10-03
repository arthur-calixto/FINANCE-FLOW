import { RecurrencesService } from './recurrences.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { transactionTotals } from './transaction-totals';
import { brazilToday, transactionGroupKey } from '@finance-flow/types';
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
  invoice: {
    select: { id: true, referenceMonth: true, dueDate: true, status: true },
  },
  account: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} as const;
const simple = {
  creditCardId: null,
  invoiceId: null,
};
@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recurrences: RecurrencesService,
  ) {}
  private present<
    T extends Transaction & { invoice?: { status: string } | null },
  >(row: T, today = brazilToday()) {
    return {
      ...row,
      permanentDeleteBlockedReason:
        row.invoice?.status === 'PAID'
          ? 'Esta compra pertence a uma fatura já paga e não pode ser excluída diretamente.'
          : row.creditCardId && row.installmentGroupId
            ? 'Parcelas de cartão não podem ser excluídas individualmente. Preserve o compromisso original do parcelamento.'
            : null,
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
      recurrenceDate: row.recurrenceDate ? civil(row.recurrenceDate) : null,
    };
  }
  private where(
    workspaceId: string,
    q: TransactionQuery,
  ): Prisma.TransactionWhereInput {
    const today = date(brazilToday());
    return {
      workspaceId,
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
    await this.recurrences.ensureRecurrenceHorizon(workspaceId);
    return (
      await this.prisma.client.transaction.findMany({
        where: this.where(workspaceId, q),
        include: relations,
        orderBy: [{ dueDate: 'asc' }, { description: 'asc' }, { id: 'asc' }],
      })
    ).map((r) => this.present(r));
  }
  async get(workspaceId: string, id: string) {
    const row = await this.prisma.client.transaction.findFirst({
      where: {
        workspaceId,
        id,
      },
      include: relations,
    });
    if (!row) throw new NotFoundException('Lançamento não encontrado.');
    return this.present(row);
  }
  async summary(workspaceId: string, month: string) {
    await this.recurrences.ensureRecurrenceHorizon(workspaceId);
    const groups = await this.prisma.client.transaction.groupBy({
      by: ['type', 'status'],
      where: {
        ...this.where(workspaceId, { month }),
        status: { not: 'CANCELLED' },
      },
      _sum: { expectedAmount: true, amount: true },
    });
    const rows = groups.map((g) => ({ ...g, ...g._sum }));
    return {
      income: transactionTotals(rows.filter((r) => r.type === 'INCOME')),
      expense: transactionTotals(rows.filter((r) => r.type === 'EXPENSE')),
    };
  }
  async monthView(workspaceId: string, q: TransactionQuery) {
    await this.recurrences.ensureRecurrenceHorizon(workspaceId);
    // Uma leitura inclui todos os relacionamentos; totais vêm do mesmo conjunto.
    const rows = await this.prisma.client.$transaction(
      (tx) =>
        tx.transaction.findMany({
          where: this.where(workspaceId, q),
          include: relations,
          orderBy: [{ dueDate: 'asc' }, { description: 'asc' }, { id: 'asc' }],
        }),
      { isolationLevel: 'RepeatableRead' },
    );
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = transactionGroupKey(row);
      const group = grouped.get(key) ?? [];
      group.push(row);
      grouped.set(key, group);
    }
    return {
      rows: rows.map((r) => this.present(r)),
      summary: {
        income: transactionTotals(rows.filter((r) => r.type === 'INCOME')),
        expense: transactionTotals(rows.filter((r) => r.type === 'EXPENSE')),
      },
      subtotals: {
        ...Object.fromEntries(
          [...grouped].map(([key, group]) => [key, transactionTotals(group)]),
        ),
        cards: transactionTotals(
          rows.filter((r) => r.type === 'EXPENSE' && r.creditCardId),
        ),
      },
    };
  }
  permanentlyDelete(workspaceId: string, id: string) {
    return databaseOperation(() =>
      this.prisma.client.$transaction(async (tx) => {
        // Mesma ordem de locks usada por baixas, materializador e pagamento de fatura.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'categories:' + workspaceId}, 0))::text`;
        const row = await tx.transaction.findFirst({
          where: { workspaceId, id },
          include: { invoice: true },
        });
        if (!row) throw new NotFoundException('Lançamento não encontrado.');
        if (row.creditCardId)
          await tx.$queryRaw`SELECT id FROM "CreditCard" WHERE id=${row.creditCardId}::uuid AND "workspaceId"=${workspaceId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id=${id}::uuid AND "workspaceId"=${workspaceId}::uuid FOR UPDATE`;
        if (row.invoice?.status === 'PAID')
          throw new ConflictException(
            'Esta compra pertence a uma fatura já paga e não pode ser excluída diretamente.',
          );
        if (row.creditCardId && row.installmentGroupId)
          throw new ConflictException(
            'Parcelas de cartão não podem ser excluídas individualmente. Preserve o compromisso original do parcelamento.',
          );
        if (row.recurrenceId) {
          if (!row.recurrenceDate)
            throw new ConflictException(
              'Ocorrência sem identidade original; exclusão bloqueada.',
            );
          await tx.recurrenceOccurrenceExclusion.create({
            data: {
              workspaceId,
              recurrenceId: row.recurrenceId,
              recurrenceDate: row.recurrenceDate,
            },
          });
        }
        await tx.transaction.delete({ where: { id, workspaceId } });
        if (row.invoiceId)
          await tx.creditCardInvoice.deleteMany({
            where: {
              id: row.invoiceId,
              workspaceId,
              status: { not: 'PAID' },
              paidAt: null,
              paidAmount: null,
              paymentAccountId: null,
              transactions: { none: {} },
            },
          });
        if (row.installmentGroupId)
          await tx.installmentGroup.deleteMany({
            where: {
              id: row.installmentGroupId,
              workspaceId,
              transactions: { none: {} },
            },
          });
        return { id, deleted: true };
      }),
    );
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
    const { recurrenceScope, ...fields } = data as UpdateTransaction;
    void recurrenceScope;
    return {
      ...fields,
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
      if (row.recurrenceId) {
        if (data.recurrenceScope !== 'ONE')
          throw new BadRequestException(
            'Escolha como aplicar a alteração da recorrência.',
          );
        if (
          (data.type && data.type !== row.type) ||
          data.expectedAmount === null
        )
          throw new BadRequestException(
            'Preserve o tipo e um valor previsto positivo na ocorrência.',
          );
      } else if (data.recurrenceScope)
        throw new BadRequestException('Este lançamento não é recorrente.');
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
    return this.mutate(workspaceId, id, async (tx, row) => {
      if (row.recurrenceId && row.recurrenceDate) {
        const series = await tx.recurrence.findFirst({
          where: { workspaceId, id: row.recurrenceId },
        });
        if (series?.endDate && row.recurrenceDate >= series.endDate)
          throw new ConflictException(
            'A recorrência está encerrada a partir desta ocorrência.',
          );
      }
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
