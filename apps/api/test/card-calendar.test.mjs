import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  purchaseCalendar,
  dayInMonth,
} from '../dist/resources/card-calendar.js';
test('virada inclusiva, regra aprovada e meses curtos', async (t) => {
  for (const [day, closing, due, month, deadline] of [
    ['2026-09-24', 25, 10, '2026-10', '2026-10-10'],
    ['2026-09-25', 25, 10, '2026-11', '2026-11-10'],
    ['2026-09-26', 25, 10, '2026-11', '2026-11-10'],
    ['2026-09-30', 1, 10, '2026-10', '2026-10-10'],
    ['2026-10-01', 1, 10, '2026-11', '2026-11-10'],
    ['2027-02-27', 31, 10, '2027-03', '2027-03-10'],
    ['2027-02-28', 31, 10, '2027-04', '2027-04-10'],
    ['2028-02-28', 31, 10, '2028-03', '2028-03-10'],
    ['2028-02-29', 31, 10, '2028-04', '2028-04-10'],
    ['2026-04-29', 31, 10, '2026-05', '2026-05-10'],
    ['2026-04-30', 31, 10, '2026-06', '2026-06-10'],
    ['2026-07-30', 31, 10, '2026-08', '2026-08-10'],
    ['2026-07-31', 31, 10, '2026-09', '2026-09-10'],
    ['2027-02-01', 25, 31, '2027-02', '2027-02-28'],
    ['2028-02-01', 25, 31, '2028-02', '2028-02-29'],
    ['2026-04-01', 25, 31, '2026-04', '2026-04-30'],
    ['2026-12-01', 25, 31, '2026-12', '2026-12-31'],
    ['2026-12-24', 25, 10, '2027-01', '2027-01-10'],
    ['2026-12-25', 25, 10, '2027-02', '2027-02-10'],
    ['2026-12-25', 25, 31, '2027-01', '2027-01-31'],
  ])
    await t.test(`${day} virada ${closing} vence ${due}`, () => {
      const result = purchaseCalendar(day, closing, due);
      assert.equal(result.referenceMonth, month + '-01');
      assert.equal(result.dueDate, deadline);
      assert.ok(result.closingDate > day);
      assert.ok(result.dueDate >= result.closingDate);
    });
  assert.equal(dayInMonth('2100-02', 31), '2100-02-28');
  assert.equal(dayInMonth('2000-02', 31), '2000-02-29');
  assert.throws(() => purchaseCalendar('9999-12-31', 25, 10));
});
