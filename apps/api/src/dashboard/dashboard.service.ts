import { Injectable } from '@nestjs/common';
import { brazilToday, transactionGroupKey } from '@finance-flow/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { RecurrencesService } from '../resources/recurrences.service';
import { CreditCardsService } from '../resources/credit-cards.service';
import { AccountBalancesService } from '../resources/account-balances.service';
import { transactionTotals } from '../resources/transaction-totals';
import { asDate, civil, monthOffset } from '../resources/card-calendar';
const Money = Prisma.Decimal.clone({ precision: 40 });
interface Aggregate {
  month: Date;
  type: 'INCOME' | 'EXPENSE';
  status: string;
  categoryId: string | null;
  card: boolean;
  recurring: boolean;
  expectedAmount: Prisma.Decimal | null;
  amount: Prisma.Decimal | null;
  pending: Prisma.Decimal;
  count: number;
}
const sum = (values: string[]) =>
  values.reduce((total, value) => total.plus(value), new Money(0)).toFixed(2);
const difference = (a: string, b: string) => new Money(a).minus(b).toFixed(2);
export const percentage = (value: string, total: string) =>
  new Money(total).gt(0)
    ? new Money(value).div(total).times(100).toFixed(1)
    : '0.0';
function summary(rows: Aggregate[]) {
  const totals = (type: 'INCOME' | 'EXPENSE') => {
    const values = rows.filter((r) => r.type === type);
    const existing = transactionTotals(values);
    return {
      planned: existing.expected,
      actual: existing.realized,
      pending: sum(values.map((r) => r.pending.toFixed(2))),
    };
  };
  const income = totals('INCOME'),
    expense = totals('EXPENSE');
  return {
    income,
    expense,
    result: {
      planned: difference(income.planned, expense.planned),
      actual: difference(income.actual, expense.actual),
      pending: difference(income.pending, expense.pending),
    },
  };
}
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recurrences: RecurrencesService,
    private readonly cards: CreditCardsService,
    private readonly balances: AccountBalancesService,
  ) {}
  async get(workspaceId: string, month: string) {
    // Mesma materialização e tombstones usados pela tela de lançamentos.
    await this.recurrences.ensureRecurrenceHorizon(workspaceId);
    const months = Array.from({ length: 6 }, (_, i) =>
      monthOffset(month, i - 5),
    );
    return this.prisma.client.$transaction(
      async (tx) => {
        // Agrupamento no PostgreSQL: somente seis competências; nenhum histórico de linhas no Node.
        const rows = await tx.$queryRaw<Aggregate[]>`
        SELECT "competenceDate" AS month, type, status, "categoryId",
          ("creditCardId" IS NOT NULL) AS card, ("recurrenceId" IS NOT NULL) AS recurring,
          SUM("expectedAmount") AS "expectedAmount", SUM(amount) AS amount,
          SUM(CASE WHEN status IN ('PENDING', 'OVERDUE') THEN COALESCE(amount, "expectedAmount", 0) ELSE 0 END) AS pending,
          COUNT(*)::integer AS count
        FROM "Transaction"
        WHERE "workspaceId" = ${workspaceId}::uuid AND status <> 'CANCELLED'
          AND "competenceDate" >= ${asDate(months[0] + '-01')} AND "competenceDate" <= ${asDate(month + '-01')}
        GROUP BY "competenceDate", type, status, "categoryId", ("creditCardId" IS NOT NULL), ("recurrenceId" IS NOT NULL)`;
        const selected = rows.filter(
          (r) => civil(r.month).slice(0, 7) === month,
        );
        const totals = summary(selected);
        const expenses = selected.filter((r) => r.type === 'EXPENSE');
        const categoryIds = [
          ...new Set(
            expenses.flatMap((r) => (r.categoryId ? [r.categoryId] : [])),
          ),
        ];
        const categories = await tx.category.findMany({
          where: { workspaceId, id: { in: categoryIds } },
          select: { id: true, name: true },
        });
        const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
        const byCategory = new Map<string | null, Aggregate[]>();
        const composition: Record<
          'recurring' | 'creditCards' | 'other',
          Aggregate[]
        > = { recurring: [], creditCards: [], other: [] };
        for (const row of expenses) {
          const key = transactionGroupKey({
            type: row.type,
            creditCardId: row.card ? 'present' : null,
            recurrenceId: row.recurring ? 'present' : null,
          });
          composition[
            key.startsWith('card:')
              ? 'creditCards'
              : key === 'expenseFixed'
                ? 'recurring'
                : 'other'
          ].push(row);
          const group = byCategory.get(row.categoryId) ?? [];
          group.push(row);
          byCategory.set(row.categoryId, group);
        }
        const expensesByCategory = [...byCategory]
          .map(([id, values]) => {
            const amount = transactionTotals(values).expected;
            return {
              id,
              name: id
                ? (categoryNames.get(id) ?? 'Sem categoria')
                : 'Sem categoria',
              amount,
              percentage: percentage(amount, totals.expense.planned),
            };
          })
          .filter((c) => new Money(c.amount).gt(0))
          .sort(
            (a, b) =>
              new Money(b.amount).comparedTo(a.amount) ||
              a.name.localeCompare(b.name),
          );
        const expenseComposition = {
          recurring: transactionTotals(composition.recurring).expected,
          creditCards: transactionTotals(composition.creditCards).expected,
          other: transactionTotals(composition.other).expected,
          total: totals.expense.planned,
          percentages: {
            recurring: percentage(
              transactionTotals(composition.recurring).expected,
              totals.expense.planned,
            ),
            creditCards: percentage(
              transactionTotals(composition.creditCards).expected,
              totals.expense.planned,
            ),
            other: percentage(
              transactionTotals(composition.other).expected,
              totals.expense.planned,
            ),
          },
        };
        const upcoming = await tx.transaction.findMany({
          where: {
            workspaceId,
            competenceDate: asDate(month + '-01'),
            status: { in: ['PENDING', 'OVERDUE'] },
          },
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          take: 10,
          select: {
            id: true,
            description: true,
            type: true,
            dueDate: true,
            amount: true,
            expectedAmount: true,
            creditCardId: true,
            invoiceId: true,
            recurrenceId: true,
            installmentGroupId: true,
          },
        });
        const today = brazilToday();
        const accounts = await this.balances.current(tx, workspaceId);
        const creditCards = await this.cards.listInTransaction(tx, workspaceId);
        const activity = await tx.transaction.findFirst({
          where: { workspaceId, status: { not: 'CANCELLED' } },
          select: { id: true },
        });
        return {
          month,
          hasActivity: !!activity,
          transactionCount: selected.reduce((n, r) => n + r.count, 0),
          summary: totals,
          accounts,
          expensesByCategory,
          expenseComposition,
          upcoming: upcoming.map((r) => ({
            id: r.id,
            description: r.description,
            type: r.type,
            dueDate: civil(r.dueDate),
            amount: (r.amount ?? r.expectedAmount)?.toFixed(2) ?? '0.00',
            origin: r.creditCardId
              ? 'CREDIT_CARD'
              : r.recurrenceId
                ? 'RECURRING'
                : r.installmentGroupId
                  ? 'INSTALLMENT'
                  : 'SINGLE',
            status: civil(r.dueDate) < today ? 'OVERDUE' : 'PENDING',
            creditCardId: r.creditCardId,
            invoiceId: r.invoiceId,
          })),
          creditCards: creditCards.map((c) => ({
            ...c,
            usagePercentage: percentage(c.usedLimit, c.creditLimit),
          })),
          evolution: months.map((value) => ({
            month: value,
            ...summary(
              rows.filter((r) => civil(r.month).slice(0, 7) === value),
            ),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
