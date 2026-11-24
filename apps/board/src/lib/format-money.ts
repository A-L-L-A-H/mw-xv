import { readPreferences } from './preferences';

export function formatMinorAmount(value: number | null | undefined, currency?: string): string {
  const { language } = readPreferences();
  const amount = new Intl.NumberFormat(language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((value ?? 0) / 100);
  return currency === undefined ? amount : `${currency} ${amount}`;
}
