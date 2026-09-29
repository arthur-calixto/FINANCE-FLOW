import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitInstallments,
  commonInstallmentPlan,
  cardInstallmentPlan,
} from '../dist/resources/installment-plan.js';
const cents = (v) => {
  const [a, b] = v.split('.');
  return BigInt(a) * 100n + BigInt(b);
};
test('divisão em centavos exata e residual final', () => {
  assert.deepEqual(splitInstallments('100', 3), ['33.33', '33.33', '33.34']);
  assert.deepEqual(splitInstallments('10', 6), [
    '1.66',
    '1.66',
    '1.66',
    '1.66',
    '1.66',
    '1.70',
  ]);
  assert.deepEqual(splitInstallments('0.01', 1), ['0.01']);
  for (const [total, n] of [
    ['0.01', 2],
    ['1', 200],
    ['0', 1],
    ['-1', 2],
    ['1', 0],
    ['1', 1.5],
    ['1.001', 2],
  ])
    assert.throws(() => splitInstallments(total, n));
  for (const total of ['1.20', '100.01', '99999999999999999.99'])
    for (let n = 1; n <= 120; n++) {
      const values = splitInstallments(total, n);
      assert.equal(
        values.reduce((s, v) => s + cents(v), 0n),
        cents(total),
      );
      assert.ok(values.every((v) => cents(v) > 0n));
      assert.equal(values.length, n);
    }
});
test('dia-base original, bissexto e mudança de ano', () => {
  assert.deepEqual(
    commonInstallmentPlan('100', 4, '2027-01-31').installments.map(
      (p) => p.dueDate,
    ),
    ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'],
  );
  assert.deepEqual(
    commonInstallmentPlan('100', 3, '2028-01-31').installments.map(
      (p) => p.dueDate,
    ),
    ['2028-01-31', '2028-02-29', '2028-03-31'],
  );
  assert.deepEqual(
    commonInstallmentPlan('100', 3, '2026-11-10').installments.map(
      (p) => p.competenceDate,
    ),
    ['2026-11-01', '2026-12-01', '2027-01-01'],
  );
  assert.throws(() => commonInstallmentPlan('100', 2, '9999-12-01'));
});
test('cartão avança competência sem recalcular compra original', () => {
  for (const day of ['24', '25', '26']) {
    const p = cardInstallmentPlan('100', 2, '2026-09-' + day, 25, 10);
    assert.equal(
      p.installments[0].competenceDate,
      day === '24' ? '2026-10-01' : '2026-11-01',
    );
    assert.equal(
      p.installments[1].competenceDate,
      day === '24' ? '2026-11-01' : '2026-12-01',
    );
  }
  const p = cardInstallmentPlan('1000', 10, '2026-09-29', 25, 10);
  assert.equal(p.installments[0].competenceDate, '2026-11-01');
  assert.equal(p.installments[9].competenceDate, '2027-08-01');
  const year = cardInstallmentPlan('100', 2, '2026-11-25', 25, 31);
  assert.deepEqual(
    year.installments.map((p) => p.competenceDate),
    ['2026-12-01', '2027-01-01'],
  );
  const short = cardInstallmentPlan('120', 12, '2027-01-01', 25, 31);
  assert.deepEqual(
    short.installments.slice(0, 4).map((p) => p.dueDate),
    ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'],
  );
  assert.equal(short.installments.length, 12);
});
