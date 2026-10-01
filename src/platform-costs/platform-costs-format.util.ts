export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SYMBOLS: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' };

export function formatMoney(
  value: number | null | undefined,
  currency = 'GBP',
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—';
  const sym = SYMBOLS[currency.toUpperCase()];
  const abs = Math.abs(value).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = value < 0 ? '-' : '';
  return sym ? `${sign}${sym}${abs}` : `${sign}${abs} ${currency}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—';
  return `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
