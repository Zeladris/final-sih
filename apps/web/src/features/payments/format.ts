/**
 * Display formatting for money and quantities.
 *
 * Amounts arrive from the server as exact decimal strings ("21620.00"). They
 * are only ever DISPLAYED here — every calculation happened on the server in
 * integer paise — so formatting through Intl is safe.
 */
export function formatInr(amount: string | null, language: string): string {
  if (amount === null) return '—';
  return new Intl.NumberFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

export function formatKg(quantity: string | number | null, language: string): string {
  if (quantity === null) return '—';
  return new Intl.NumberFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
    maximumFractionDigits: 3,
  }).format(Number(quantity));
}

export function formatDateTime(iso: string | null, language: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}
