import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transactionTotals } from '../dist/resources/transaction-totals.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { transactionGroupKey } from '@finance-flow/types';
import { permanentlyDeleteTransactionSchema } from '@finance-flow/validation';
test('Totais reutilizam previsto e realizado sem cancelados ou arredondamento de Number', () => {
  const row = (status, expected, amount) => ({
    status,
    expectedAmount: expected === null ? null : new Prisma.Decimal(expected),
    amount: amount === null ? null : new Prisma.Decimal(amount),
  });
  assert.deepEqual(
    transactionTotals([
      row('PAID', '120', '126.90'),
      row('PENDING', '9007199254740993.01', '999'),
      row('CANCELLED', '100', '100'),
    ]),
    { expected: '9007199254741113.01', realized: '126.90' },
  );
  assert.deepEqual(transactionTotals([row('PAID', null, '10')]), {
    expected: '0.00',
    realized: '10.00',
  });
});
test('Classificação pela origem sem grupo artificial de parcelamento', () => {
  assert.deepEqual(
    [
      { type: 'INCOME', recurrenceId: 'r' },
      { type: 'INCOME' },
      { type: 'EXPENSE', recurrenceId: 'r' },
      { type: 'EXPENSE', creditCardId: 'nubank' },
      { type: 'EXPENSE', installmentGroupId: 'g' },
    ].map(transactionGroupKey),
    [
      'incomeFixed',
      'incomeOther',
      'expenseFixed',
      'card:nubank',
      'expenseOther',
    ],
  );
});
test('Hard delete exige confirmação literal explícita, sem campos protegidos', () => {
  assert.ok(
    permanentlyDeleteTransactionSchema.safeParse({ confirm: true }).success,
  );
  for (const body of [
    undefined,
    {},
    { confirm: false },
    { confirm: 'true' },
    { confirm: true, workspaceId: 'other' },
  ])
    assert.equal(
      permanentlyDeleteTransactionSchema.safeParse(body).success,
      false,
    );
});
