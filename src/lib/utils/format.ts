/**
 * Presentation helpers. All timestamps are stored in UTC; anything shown to a
 * hotel is rendered in that hotel's own timezone.
 */

export function formatCurrency(
  amount: number | null | undefined,
  currency = 'INR',
  options: { compact?: boolean } = {},
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    notation: options.compact && Math.abs(amount) >= 100_000 ? 'compact' : 'standard',
  });
  return formatter.format(amount);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN').format(value);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatDateTime(iso: string | null | undefined, timezone = 'Asia/Kolkata'): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatDate(iso: string | null | undefined, timezone = 'Asia/Kolkata'): string {
  if (!iso) return '—';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatTime(iso: string | null | undefined, timezone = 'Asia/Kolkata'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** Compact relative time used in list views ("3h ago", "in 2d"). */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = date.getTime() - now.getTime();
  const future = diffMs > 0;
  const minutes = Math.round(Math.abs(diffMs) / 60_000);

  const value =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes}m`
        : minutes < 60 * 24
          ? `${Math.round(minutes / 60)}h`
          : minutes < 60 * 24 * 30
            ? `${Math.round(minutes / (60 * 24))}d`
            : `${Math.round(minutes / (60 * 24 * 30))}mo`;

  if (value === 'just now') return value;
  return future ? `in ${value}` : `${value} ago`;
}

export function initialsOf(name: string | null | undefined, fallback = '?'): string {
  if (!name?.trim()) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('');
}

/** Masks a phone number for list views where the full number is not needed. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}
