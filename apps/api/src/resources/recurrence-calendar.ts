import { Injectable } from '@nestjs/common';
import { brazilToday } from '@finance-flow/types';
import { dayInMonth, monthOffset } from './card-calendar';
@Injectable()
export class RecurrenceClock {
  today() {
    return brazilToday();
  }
}
export function recurrenceWindow(today: string) {
  const from = today.slice(0, 7) + '-01';
  return { from, until: monthOffset(today.slice(0, 7), 12) + '-01' };
}
export function recurrenceDates(
  start: string,
  frequency: 'MONTHLY' | 'YEARLY',
  interval: number,
  from: string,
  until: string,
  dueDay = Number(start.slice(8, 10)),
): string[] {
  const monthIndex = (v: string) =>
    Number(v.slice(0, 4)) * 12 + Number(v.slice(5, 7)) - 1;
  const step = interval * (frequency === 'YEARLY' ? 12 : 1);
  const dates: string[] = [];
  const firstIndex = Math.max(
    0,
    Math.floor((monthIndex(from) - monthIndex(start)) / step),
  );
  for (let i = firstIndex; ; i++) {
    const index = monthIndex(start) + i * step;
    if (index >= monthIndex(until) + 1) break;
    const month = monthOffset(start.slice(0, 7), i * step);
    const date = dayInMonth(month, dueDay);
    if (date >= until) break;
    if (date >= from && date >= start) dates.push(date);
  }
  return dates;
}
