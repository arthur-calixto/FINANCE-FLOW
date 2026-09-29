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

test('valor individual exato e limite Decimal do total original', async () => {
  const { installmentTotal } =
    await import('../dist/resources/installment-plan.js');
  for (const [amount, count, expected] of [
    ['100', 5, '500.00'],
    ['333.33', 3, '999.99'],
    ['0.01', 120, '1.20'],
  ]) {
    const total = installmentTotal({
      amountMode: 'INSTALLMENT',
      installmentAmount: amount,
      installmentCount: count,
    });
    assert.equal(total, expected);
    assert.ok(
      splitInstallments(total, count).every(
        (v) => cents(v) === cents(splitInstallments(amount, 1)[0]),
      ),
    );
  }
  assert.throws(() =>
    installmentTotal({
      amountMode: 'INSTALLMENT',
      installmentAmount: '99999999999999999.99',
      installmentCount: 2,
    }),
  );
});
test('retroativo preserva numeração, dia-base e resíduo original', () => {
  const plan = commonInstallmentPlan('100', 3, '2026-10-10', 3);
  assert.deepEqual(plan.installments, [
    {
      installmentNumber: 3,
      amount: '33.34',
      dueDate: '2026-10-10',
      competenceDate: '2026-10-01',
    },
  ]);
  assert.equal(plan.totalAmount, '100.00');
  assert.equal(plan.controlledAmount, '33.34');
  assert.equal(plan.previousInstallmentCount, 2);
  const ongoing = commonInstallmentPlan('6000', 12, '2027-01-31', 7);
  assert.deepEqual(
    ongoing.installments.map((p) => p.installmentNumber),
    [7, 8, 9, 10, 11, 12],
  );
  assert.deepEqual(
    ongoing.installments.slice(0, 3).map((p) => p.dueDate),
    ['2027-01-31', '2027-02-28', '2027-03-31'],
  );
  for (const start of [0, -1, 4, 1.5])
    assert.throws(() => commonInstallmentPlan('100', 3, '2026-10-10', start));
});
test('cartão retroativo usa fatura explícita, independente de data histórica', () => {
  const plan = cardInstallmentPlan('3000', 10, undefined, 25, 10, 5, '2026-10');
  assert.deepEqual(
    plan.installments.map((p) => p.installmentNumber),
    [5, 6, 7, 8, 9, 10],
  );
  assert.deepEqual(
    plan.installments.map((p) => p.competenceDate),
    [
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
    ],
  );
  assert.equal(plan.controlledAmount, '1800.00');
  assert.equal(plan.installments[0].closingDate, '2026-09-25');
  assert.deepEqual(
    plan,
    cardInstallmentPlan('3000', 10, '2001-01-01', 25, 10, 5, '2026-10'),
  );
  const short = cardInstallmentPlan(
    '3000',
    10,
    undefined,
    25,
    31,
    8,
    '2028-01',
  );
  assert.deepEqual(
    short.installments.map((p) => p.dueDate),
    ['2028-01-31', '2028-02-29', '2028-03-31'],
  );
});
test('contratos rejeitam ambiguidades, campos ausentes e datas incoerentes', async () => {
  const {
    installmentPreviewSchema: common,
    cardInstallmentPreviewSchema: card,
  } = await import('@finance-flow/validation');
  const base = {
    totalAmount: '100',
    installmentCount: 3,
    firstDueDate: '2026-10-10',
  };
  assert.equal(common.parse(base).amountMode, 'TOTAL');
  assert.equal(common.parse(base).startingInstallment, 1);
  for (const patch of [
    { amountMode: 'INSTALLMENT' },
    { installmentAmount: '10' },
    { totalAmount: undefined },
    { amountMode: 'INSTALLMENT', installmentAmount: '10' },
    { amountMode: 'OTHER' },
    { startingInstallment: 0 },
    { startingInstallment: -1 },
    { startingInstallment: 4 },
    { startingInstallment: 1.5 },
    {
      amountMode: 'INSTALLMENT',
      totalAmount: undefined,
      installmentAmount: '0',
    },
  ])
    assert.equal(common.safeParse({ ...base, ...patch }).success, false);
  const valid = {
    amountMode: 'INSTALLMENT',
    installmentAmount: '300',
    installmentCount: 10,
    startingInstallment: 5,
    firstInvoiceMonth: '2026-10',
  };
  assert.equal(card.safeParse(valid).success, true);
  for (const patch of [
    { firstInvoiceMonth: undefined },
    { firstInvoiceMonth: '2026-13' },
    { startingInstallment: 1 },
    { transactionDate: '2026-02-30' },
  ])
    assert.equal(card.safeParse({ ...valid, ...patch }).success, false);
});
