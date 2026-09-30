import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recurrenceDates,
  recurrenceWindow,
} from '../dist/resources/recurrence-calendar.js';
import {
  createRecurrenceSchema,
  updateRecurrenceSchema,
} from '@finance-flow/validation';
test('janela móvel inclui mês atual e onze seguintes, sem preencher passado', () => {
  const w = recurrenceWindow('2026-10-29');
  assert.deepEqual(w, { from: '2026-10-01', until: '2027-10-01' });
  const dates = recurrenceDates('2020-10-10', 'MONTHLY', 1, w.from, w.until);
  assert.equal(dates.length, 12);
  assert.equal(dates[0], '2026-10-10');
  assert.equal(dates[11], '2027-09-10');
  assert.deepEqual(
    recurrenceDates('2026-12-10', 'MONTHLY', 1, w.from, w.until).slice(0, 3),
    ['2026-12-10', '2027-01-10', '2027-02-10'],
  );
  assert.equal(
    recurrenceDates('2030-01-10', 'MONTHLY', 1, w.from, w.until).length,
    0,
  );
});
test('mensal preserva dia 31 e ano bissexto; intervalo mantém âncora', () => {
  assert.deepEqual(
    recurrenceDates('2027-01-31', 'MONTHLY', 1, '2027-01-01', '2027-05-01'),
    ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'],
  );
  assert.deepEqual(
    recurrenceDates('2028-01-31', 'MONTHLY', 1, '2028-01-01', '2028-04-01'),
    ['2028-01-31', '2028-02-29', '2028-03-31'],
  );
  assert.deepEqual(
    recurrenceDates('2026-01-31', 'MONTHLY', 2, '2026-10-01', '2027-04-01'),
    ['2026-11-30', '2027-01-31', '2027-03-31'],
  );
});
test('anual preserva mês/dia; fevereiro 29 ajusta sem perder âncora', () => {
  assert.deepEqual(
    recurrenceDates('2024-02-29', 'YEARLY', 1, '2026-01-01', '2029-01-01'),
    ['2026-02-28', '2027-02-28', '2028-02-29'],
  );
  assert.deepEqual(
    recurrenceDates('2020-03-15', 'YEARLY', 1, '2026-10-01', '2027-10-01'),
    ['2027-03-15'],
  );
});
test('contratos rejeitam campos de cartão, frequências não suportadas e edição estrutural', () => {
  const base = {
    description: 'Internet',
    type: 'EXPENSE',
    expectedAmount: '120',
    frequency: 'MONTHLY',
    firstDueDate: '2026-10-10',
    accountId: '00000000-0000-4000-8000-000000000001',
    categoryId: '00000000-0000-4000-8000-000000000002',
  };
  assert.equal(createRecurrenceSchema.parse(base).interval, 1);
  for (const patch of [
    { expectedAmount: '0' },
    { frequency: 'DAILY' },
    { interval: 0 },
    { firstDueDate: '2026-02-30' },
    { creditCardId: base.accountId },
  ])
    assert.equal(
      createRecurrenceSchema.safeParse({ ...base, ...patch }).success,
      false,
    );
  for (const patch of [
    {},
    { frequency: 'YEARLY' },
    { dueDay: 15 },
    { type: 'INCOME' },
  ])
    assert.equal(
      updateRecurrenceSchema.safeParse({
        fromTransactionId: base.accountId,
        ...patch,
      }).success,
      false,
    );
});
