import { BadRequestException } from '@nestjs/common';
import type { InvoicePreview } from '@finance-flow/types';
export function civil(value: Date): string {
  return value.toISOString().slice(0, 10);
}
export function asDate(value: string): Date {
  return new Date(value + 'T00:00:00.000Z');
}
export function monthOffset(month: string, offset: number): string {
  const [year, m] = month.split('-').map(Number);
  const total = year * 12 + m - 1 + offset;
  const y = Math.floor(total / 12);
  if (y < 1 || y > 9999)
    throw new BadRequestException('Data fora do calendário suportado.');
  return `${String(y).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}
export function dayInMonth(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return `${month}-${String(Math.min(day, days[m - 1])).padStart(2, '0')}`;
}
export function purchaseCalendar(
  transactionDate: string,
  closingDay: number,
  dueDay: number,
): InvoicePreview {
  let closingMonth = transactionDate.slice(0, 7);
  if (transactionDate >= dayInMonth(closingMonth, closingDay))
    closingMonth = monthOffset(closingMonth, 1);
  const closingDate = dayInMonth(closingMonth, closingDay);
  let dueMonth = closingMonth;
  if (dayInMonth(dueMonth, dueDay) < closingDate)
    dueMonth = monthOffset(dueMonth, 1);
  return {
    referenceMonth: dueMonth + '-01',
    closingDate,
    dueDate: dayInMonth(dueMonth, dueDay),
  };
}
