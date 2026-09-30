import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateRecurrence,
  UpdateRecurrence,
  RecurrencePreviewInput,
} from '@finance-flow/validation';
import {
  Prisma,
  type Recurrence,
  type RecurrenceRevision,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { asDate, civil } from './card-calendar';
import {
  RecurrenceClock,
  recurrenceDates,
  recurrenceWindow,
} from './recurrence-calendar';
import { databaseOperation } from './database-errors';
type Series = Recurrence & { revisions: RecurrenceRevision[] };
const include = { revisions: { orderBy: { effectiveDate: 'asc' as const } } };
const pending = ['PENDING', 'OVERDUE'] as const;
@Injectable()
export class RecurrencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: RecurrenceClock,
  ) {}
  private locked<T>(
    ws: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return databaseOperation(() =>
      this.prisma.client.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'categories:' + ws}, 0))::text`;
          return action(tx);
        },
        { timeout: 20000 },
      ),
    );
  }
  private async series(tx: Prisma.TransactionClient, ws: string, id: string) {
    const row = await tx.recurrence.findFirst({
      where: { workspaceId: ws, id },
      include,
    });
    if (!row) throw new NotFoundException('Recorrência não encontrada.');
    return row;
  }
  private rule(row: Series, date: string) {
    const rule =
      [...row.revisions]
        .reverse()
        .find((r) => civil(r.effectiveDate) <= date) ?? row;
    return {
      description: rule.description,
      expectedAmount: rule.expectedAmount,
      accountId: rule.accountId!,
      categoryId: rule.categoryId!,
      notes: rule.notes,
    };
  }
  private async links(
    tx: Prisma.TransactionClient,
    ws: string,
    type: string,
    accountId: string,
    categoryId: string,
    old?: { accountId: string; categoryId: string },
  ) {
    await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${accountId}::uuid AND "workspaceId"=${ws}::uuid FOR SHARE`;
    const account = await tx.account.findFirst({
      where: { workspaceId: ws, id: accountId },
    });
    const category = await tx.category.findFirst({
      where: { workspaceId: ws, id: categoryId },
    });
    if (!account || (!account.isActive && old?.accountId !== accountId))
      throw new BadRequestException(
        'Selecione uma conta ativa deste workspace.',
      );
    if (
      !category ||
      category.type !== type ||
      (!category.isActive && old?.categoryId !== categoryId)
    )
      throw new BadRequestException(
        'Selecione categoria ativa e compatível deste workspace.',
      );
  }
  preview(data: RecurrencePreviewInput) {
    const window = recurrenceWindow(this.clock.today());
    const dates = recurrenceDates(
      data.firstDueDate,
      data.frequency,
      data.interval,
      window.from,
      window.until,
    );
    return {
      ...window,
      occurrences: dates.map((dueDate) => ({
        dueDate,
        competenceDate: dueDate.slice(0, 7) + '-01',
        expectedAmount: new Prisma.Decimal(data.expectedAmount).toFixed(2),
      })),
    };
  }
  private async materialize(tx: Prisma.TransactionClient, row: Series) {
    if (!row.isActive || !row.accountId || !row.categoryId) return;
    const window = recurrenceWindow(this.clock.today());
    const from = [window.from, civil(row.nextGenerationDate)].sort().at(-1)!;
    const until =
      row.endDate && civil(row.endDate) < window.until
        ? civil(row.endDate)
        : window.until;
    if (from < until) {
      const dates = recurrenceDates(
        civil(row.startDate),
        row.frequency,
        row.interval,
        from,
        until,
        row.dueDay,
      );
      await tx.transaction.createMany({
        data: dates.map((dueDate) => ({
          ...this.rule(row, dueDate),
          workspaceId: row.workspaceId,
          createdBy: row.createdBy,
          type: row.type,
          status: 'PENDING' as const,
          recurrenceId: row.id,
          recurrenceDate: asDate(dueDate),
          transactionDate: asDate(dueDate),
          dueDate: asDate(dueDate),
          competenceDate: asDate(dueDate.slice(0, 7) + '-01'),
        })),
        skipDuplicates: true,
      });
      await tx.recurrence.update({
        where: { id: row.id, workspaceId: row.workspaceId },
        data: { nextGenerationDate: asDate(until) },
      });
    }
    if (row.endDate && civil(row.endDate) <= this.clock.today())
      await tx.recurrence.update({
        where: { id: row.id, workspaceId: row.workspaceId },
        data: { isActive: false },
      });
  }
  ensureRecurrenceHorizon(ws: string) {
    return this.locked(ws, async (tx) => {
      const rows = await tx.recurrence.findMany({
        where: { workspaceId: ws, isActive: true },
        include,
      });
      for (const row of rows) await this.materialize(tx, row);
    });
  }
  create(ws: string, user: string, data: CreateRecurrence) {
    return this.locked(ws, async (tx) => {
      await this.links(tx, ws, data.type, data.accountId, data.categoryId);
      const row = await tx.recurrence.create({
        data: {
          workspaceId: ws,
          createdBy: user,
          description: data.description,
          type: data.type,
          expectedAmount: data.expectedAmount,
          frequency: data.frequency,
          interval: data.interval,
          dueDay: Number(data.firstDueDate.slice(8, 10)),
          startDate: asDate(data.firstDueDate),
          nextGenerationDate: asDate(recurrenceWindow(this.clock.today()).from),
          accountId: data.accountId,
          categoryId: data.categoryId,
          notes: data.notes,
        },
        include,
      });
      await this.materialize(tx, row);
      return this.detail(tx, ws, row.id);
    });
  }
  private async detail(tx: Prisma.TransactionClient, ws: string, id: string) {
    const row = await this.series(tx, ws, id);
    const today = this.clock.today();
    const transactions = await tx.transaction.findMany({
      where: { workspaceId: ws, recurrenceId: id },
      orderBy: [{ recurrenceDate: 'asc' }, { id: 'asc' }],
      include: {
        account: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
    });
    const next = transactions
      .filter(
        (t) =>
          pending.includes(t.status as (typeof pending)[number]) &&
          civil(t.dueDate) >= today,
      )
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
    const defaults = this.rule(
      row,
      next?.recurrenceDate ? civil(next.recurrenceDate) : today,
    );
    const account = defaults.accountId
      ? await tx.account.findFirst({
          where: { workspaceId: ws, id: defaults.accountId },
          select: { id: true, name: true },
        })
      : null;
    const category = defaults.categoryId
      ? await tx.category.findFirst({
          where: { workspaceId: ws, id: defaults.categoryId },
          select: { id: true, name: true },
        })
      : null;
    return {
      ...row,
      ...defaults,
      expectedAmount: defaults.expectedAmount.toFixed(2),
      startDate: civil(row.startDate),
      endDate: row.endDate ? civil(row.endDate) : null,
      nextGenerationDate: civil(row.nextGenerationDate),
      nextDueDate: next ? civil(next.dueDate) : null,
      status:
        !row.isActive || (row.endDate && civil(row.endDate) <= today)
          ? 'ENDED'
          : row.endDate
            ? 'ENDING'
            : 'ACTIVE',
      account,
      category,
      revisions: row.revisions.map((r) => ({
        ...r,
        effectiveDate: civil(r.effectiveDate),
        expectedAmount: r.expectedAmount.toFixed(2),
      })),
      occurrences: transactions.map((r) => ({
        ...r,
        expectedAmount: r.expectedAmount?.toFixed(2) ?? null,
        amount: r.amount?.toFixed(2) ?? null,
        dueDate: civil(r.dueDate),
        transactionDate: civil(r.transactionDate),
        competenceDate: civil(r.competenceDate),
        recurrenceDate: r.recurrenceDate ? civil(r.recurrenceDate) : null,
        status: pending.includes(r.status as (typeof pending)[number])
          ? civil(r.dueDate) < today
            ? 'OVERDUE'
            : 'PENDING'
          : r.status,
      })),
    };
  }
  list(ws: string) {
    return this.locked(ws, async (tx) => {
      const rows = await tx.recurrence.findMany({
        where: { workspaceId: ws },
        include,
        orderBy: [{ description: 'asc' }, { id: 'asc' }],
      });
      const results = [];
      for (const row of rows) {
        await this.materialize(tx, row);
        const { occurrences, ...record } = await this.detail(tx, ws, row.id);
        void occurrences;
        results.push(record);
      }
      return results;
    });
  }
  get(ws: string, id: string) {
    return this.locked(ws, async (tx) => {
      const row = await this.series(tx, ws, id);
      await this.materialize(tx, row);
      return this.detail(tx, ws, id);
    });
  }
  update(ws: string, id: string, user: string, data: UpdateRecurrence) {
    return this.locked(ws, async (tx) => {
      const row = await this.series(tx, ws, id);
      const selected = await tx.transaction.findFirst({
        where: {
          workspaceId: ws,
          id: data.fromTransactionId,
          recurrenceId: id,
        },
      });
      if (!selected?.recurrenceDate)
        throw new NotFoundException(
          'Ocorrência não encontrada nesta recorrência.',
        );
      const cut = civil(selected.recurrenceDate);
      if (!row.isActive || (row.endDate && cut >= civil(row.endDate)))
        throw new ConflictException(
          'A recorrência está encerrada a partir desta ocorrência.',
        );
      const old = this.rule(row, cut);
      const { fromTransactionId, ...patch } = data;
      void fromTransactionId;
      const defaults = { ...old, ...patch };
      await this.links(
        tx,
        ws,
        row.type,
        defaults.accountId,
        defaults.categoryId,
        old,
      );
      await tx.recurrenceRevision.upsert({
        where: {
          recurrenceId_effectiveDate: {
            recurrenceId: id,
            effectiveDate: selected.recurrenceDate,
          },
        },
        create: {
          ...defaults,
          workspaceId: ws,
          recurrenceId: id,
          effectiveDate: selected.recurrenceDate,
          createdBy: user,
        },
        update: { ...defaults, createdBy: user },
      });
      const changed = await this.series(tx, ws, id);
      const eligible = await tx.transaction.findMany({
        where: {
          workspaceId: ws,
          recurrenceId: id,
          recurrenceDate: {
            gte: selected.recurrenceDate,
            ...(row.endDate ? { lt: row.endDate } : {}),
          },
          status: { in: [...pending] },
        },
      });
      for (const occurrence of eligible)
        await tx.transaction.update({
          where: { workspaceId: ws, id: occurrence.id },
          data: this.rule(changed, civil(occurrence.recurrenceDate!)),
        });
      await this.materialize(tx, changed);
      return this.detail(tx, ws, id);
    });
  }
  end(ws: string, id: string, fromDate: string) {
    return this.locked(ws, async (tx) => {
      const row = await this.series(tx, ws, id);
      if (fromDate < civil(row.startDate))
        throw new BadRequestException(
          'O encerramento não pode preceder o primeiro vencimento.',
        );
      if (row.endDate && fromDate > civil(row.endDate))
        throw new ConflictException(
          'Não é possível retomar uma recorrência encerrada.',
        );
      const changed = await tx.recurrence.update({
        where: { id, workspaceId: ws },
        data: {
          endDate: asDate(fromDate),
          isActive: fromDate > this.clock.today(),
        },
        include,
      });
      await tx.transaction.updateMany({
        where: {
          workspaceId: ws,
          recurrenceId: id,
          recurrenceDate: { gte: asDate(fromDate) },
          status: { in: [...pending] },
        },
        data: { status: 'CANCELLED' },
      });
      await this.materialize(tx, changed);
      return this.detail(tx, ws, id);
    });
  }
}
