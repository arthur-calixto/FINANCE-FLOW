import { BadRequestException } from '@nestjs/common';
import type { InstallmentPlan, InstallmentPlanRow } from '@finance-flow/types';
import { dayInMonth, monthOffset, purchaseCalendar } from './card-calendar';
export function splitInstallments(total: string, count: number): string[] {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 120 ||
    !/^\d{1,17}(?:\.\d{1,2})?$/.test(total)
  )
    throw new BadRequestException('Informe total positivo e 1 a 120 parcelas.');
  const [whole, fraction = ''] = total.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents < BigInt(count))
    throw new BadRequestException(
      'O total deve permitir pelo menos R$ 0,01 por parcela.',
    );
  const base = cents / BigInt(count),
    remainder = cents % BigInt(count);
  return Array.from({ length: count }, (_, i) => {
    const value = base + (i === count - 1 ? remainder : 0n);
    return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
  });
}
export function commonInstallmentPlan(
  totalAmount: string,
  count: number,
  firstDueDate: string,
): InstallmentPlan {
  const amounts = splitInstallments(totalAmount, count),
    day = Number(firstDueDate.slice(8, 10));
  return {
    totalAmount,
    installmentCount: count,
    installments: amounts.map((amount, i) => {
      const month = monthOffset(firstDueDate.slice(0, 7), i);
      return {
        installmentNumber: i + 1,
        amount,
        dueDate: dayInMonth(month, day),
        competenceDate: month + '-01',
      };
    }),
  };
}
export function cardInstallmentPlan(
  totalAmount: string,
  count: number,
  transactionDate: string,
  closingDay: number,
  dueDay: number,
): InstallmentPlan {
  const first = purchaseCalendar(transactionDate, closingDay, dueDay),
    amounts = splitInstallments(totalAmount, count);
  const installments: InstallmentPlanRow[] = amounts.map((amount, i) => {
    const month = monthOffset(first.referenceMonth.slice(0, 7), i),
      dueDate = dayInMonth(month, dueDay);
    let closingDate = dayInMonth(month, closingDay);
    if (closingDate > dueDate)
      closingDate = dayInMonth(monthOffset(month, -1), closingDay);
    return {
      installmentNumber: i + 1,
      amount,
      competenceDate: month + '-01',
      dueDate,
      closingDate: i === 0 ? first.closingDate : closingDate,
    };
  });
  return { totalAmount, installmentCount: count, installments };
}
