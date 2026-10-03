import { Prisma } from '../generated/prisma/client';
const Money = Prisma.Decimal.clone({ precision: 40 });
/** Uma única regra de previsto/realizado para summary, mês e subtotais. */
export function transactionTotals(
  rows: {
    status: string;
    expectedAmount: Prisma.Decimal | null;
    amount: Prisma.Decimal | null;
  }[],
) {
  let expected = new Money(0),
    realized = new Money(0);
  for (const row of rows) {
    if (row.status === 'CANCELLED') continue;
    expected = expected.plus(row.expectedAmount?.toString() ?? '0');
    if (row.status === 'PAID')
      realized = realized.plus(row.amount?.toString() ?? '0');
  }
  return { expected: expected.toFixed(2), realized: realized.toFixed(2) };
}
