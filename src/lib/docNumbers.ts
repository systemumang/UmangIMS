export type DocKind = 'PR' | 'PO' | 'GRN';

function stripLeadingHash(raw: string) {
  return String(raw ?? '').trim().replace(/^#\s*/, '');
}

export function formatDocNumber(raw: string, kind?: DocKind): string {
  const s = stripLeadingHash(raw);
  if (!s) return '';
  // Keep the `PR-` / `PO-` / `GRN-` prefix in display (business requirement).
  // Still normalize if kind is provided and a different known prefix is used.
  const m = /^(PR|PO|GRN)-(.+)$/i.exec(s);
  if (!m?.[1] || !m?.[2]) return s;
  const foundKind = String(m[1] ?? '').toUpperCase() as DocKind;
  const rest = String(m[2] ?? '').trim();
  if (!rest) return s;
  if (kind && foundKind !== kind) return rest;
  return `${foundKind}-${rest}`;
}

export function formatPrNumber(raw: string) {
  const s = formatDocNumber(raw, 'PR');
  // Hide short random suffixes like `20260508-5b69e5`.
  const t = String(s ?? '').trim();
  const m = /^PR-(\d{8})-([0-9a-f]{6})$/i.exec(t);
  if (m?.[1]) return `PR-${m[1]}`;
  return s;
}

export function formatPoNumber(raw: string) {
  const s = formatDocNumber(raw, 'PO');
  const t = String(s ?? '').trim();
  // Hide UUID-looking values completely.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return '';
  return t;
}

export function formatGrnNumber(raw: string) {
  const s = formatDocNumber(raw, 'GRN');
  const t = String(s ?? '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return '';
  return t;
}
