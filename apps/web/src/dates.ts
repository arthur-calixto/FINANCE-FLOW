import { brazilToday } from '@finance-flow/types';
export { brazilToday };
export function formatDate(value: string) {
  return value.slice(0, 10).split('-').reverse().join('/');
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + m - 1 + delta;
  return `${Math.floor(total / 12)
    .toString()
    .padStart(4, '0')}-${((total % 12) + 1).toString().padStart(2, '0')}`;
}
export function monthLabel(month: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(month + '-01T12:00:00Z'));
}
export function paymentTimestamp(day: string) {
  return `${day}T12:00:00-03:00`;
}
