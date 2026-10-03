import { transactionGroupKey } from '@finance-flow/types';
import type {
  TransactionMonthView,
  TransactionRecord,
} from '@finance-flow/types';
/** Fixture de contrato HTTP; a produção recebe estes totais da API. */
export function monthViewFixture(
  rows: TransactionRecord[],
): TransactionMonthView {
  const sums = (list: TransactionRecord[]) => {
    const cents = (s: string | null) =>
      BigInt((s ?? '0').split('.')[0]) * 100n +
      BigInt(((s ?? '0').split('.')[1] ?? '').padEnd(2, '0'));
    const format = (n: bigint) =>
      `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
    return {
      expected: format(
        list
          .filter((r) => r.status !== 'CANCELLED')
          .reduce((n, r) => n + cents(r.expectedAmount), 0n),
      ),
      realized: format(
        list
          .filter((r) => r.status === 'PAID')
          .reduce((n, r) => n + cents(r.amount), 0n),
      ),
    };
  };
  return {
    rows: structuredClone(rows),
    summary: {
      income: sums(rows.filter((r) => r.type === 'INCOME')),
      expense: sums(rows.filter((r) => r.type === 'EXPENSE')),
    },
    subtotals: Object.fromEntries(
      [...new Set(rows.map(transactionGroupKey)), 'cards'].map((key) => [
        key,
        sums(
          rows.filter((r) =>
            key === 'cards'
              ? r.type === 'EXPENSE' && r.creditCardId
              : transactionGroupKey(r) === key,
          ),
        ),
      ]),
    ),
  };
}
