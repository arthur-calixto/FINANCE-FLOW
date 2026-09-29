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
