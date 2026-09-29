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
export function installmentTotal(data: {
  amountMode: 'TOTAL' | 'INSTALLMENT';
  totalAmount?: string;
  installmentAmount?: string;
  installmentCount: number;
}): string {
  if (data.amountMode === 'TOTAL') return data.totalAmount!;
  const amount = splitInstallments(data.installmentAmount!, 1)[0];
  const total = moneyCents(amount) * BigInt(data.installmentCount);
  if (total > 9999999999999999999n)
    throw new BadRequestException('O valor total excede o máximo permitido.');
  return moneyString(total);
}
function moneyCents(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function moneyString(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
function controlledAmounts(total: string, count: number, start: number) {
  if (!Number.isInteger(start) || start < 1 || start > count)
    throw new BadRequestException('Parcela inicial inválida.');
  return splitInstallments(total, count).slice(start - 1);
}
function planSummary(
  total: string,
  count: number,
  start: number,
  amounts: string[],
) {
  return {
    totalAmount: moneyString(moneyCents(total)),
    installmentCount: count,
    startingInstallment: start,
    previousInstallmentCount: start - 1,
    controlledInstallmentCount: amounts.length,
    controlledAmount: moneyString(
      amounts.reduce((sum, amount) => sum + moneyCents(amount), 0n),
    ),
  };
}
export function commonInstallmentPlan(
  totalAmount: string,
  count: number,
  firstDueDate: string,
  startingInstallment = 1,
): InstallmentPlan {
  const amounts = controlledAmounts(totalAmount, count, startingInstallment),
    day = Number(firstDueDate.slice(8, 10));
  return {
    ...planSummary(totalAmount, count, startingInstallment, amounts),
    installments: amounts.map((amount, i) => {
      const month = monthOffset(firstDueDate.slice(0, 7), i);
      return {
        installmentNumber: i + startingInstallment,
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
  transactionDate: string | undefined,
  closingDay: number,
  dueDay: number,
  startingInstallment = 1,
  firstInvoiceMonth?: string,
): InstallmentPlan {
  const first =
    startingInstallment === 1
      ? purchaseCalendar(transactionDate!, closingDay, dueDay)
      : { referenceMonth: firstInvoiceMonth! + '-01', closingDate: undefined };
  const amounts = controlledAmounts(totalAmount, count, startingInstallment);
  const installments: InstallmentPlanRow[] = amounts.map((amount, i) => {
    const month = monthOffset(first.referenceMonth.slice(0, 7), i),
      dueDate = dayInMonth(month, dueDay);
    let closingDate = dayInMonth(month, closingDay);
    if (closingDate > dueDate)
      closingDate = dayInMonth(monthOffset(month, -1), closingDay);
    return {
      installmentNumber: i + startingInstallment,
      amount,
      competenceDate: month + '-01',
      dueDate,
      closingDate:
        i === 0 && first.closingDate ? first.closingDate : closingDate,
    };
  });
  return {
    ...planSummary(totalAmount, count, startingInstallment, amounts),
    installments,
  };
}
