import { moneySchema } from '@finance-flow/validation';
const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
export function formatMoney(decimal: string): string {
  // Intl aceita strings decimais sem conversão intermediária para Number.
  return brl.format(decimal as unknown as number);
}
export function parseMoneyInput(value: string): string {
  const trimmed = value.trim();
  if (!/^-?\d+(?:,\d{1,2})?$/.test(trimmed))
    throw new Error(
      'Use um valor como 1500,00 ou -350,00, sem separador de milhar.',
    );
  return moneySchema.parse(trimmed.replace(',', '.'));
}
export function moneyDifference(actual: string, expected: string) {
  const cents = (v: string) => {
    const [whole, fraction = ''] = v.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  };
  const value = cents(actual) - cents(expected),
    abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
