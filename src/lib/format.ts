import type { Lang } from '../routing/describe';

const locale = (lang: Lang) => (lang === 'id' ? 'id-ID' : 'en-US');

/** "820 KB", "2,6 MB", "1,25 GB": decimal units, as storage UIs and OS file managers show them. */
export function formatBytes(bytes: number, lang: Lang): string {
  const n = Math.max(0, bytes);
  const f = (v: number, digits: number) => new Intl.NumberFormat(locale(lang), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
  if (n < 1e3) return `${f(n, 0)} B`;
  if (n < 1e6) return `${f(n / 1e3, 0)} KB`;
  if (n < 1e9) return `${f(n / 1e6, 1)} MB`;
  return `${f(n / 1e9, 2)} GB`;
}

export const formatWhen = (ts: number, lang: Lang): string =>
  new Date(ts).toLocaleString(locale(lang), { dateStyle: 'medium', timeStyle: 'short' });
