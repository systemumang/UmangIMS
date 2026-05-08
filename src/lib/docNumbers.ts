export type DocKind = 'PR' | 'PO' | 'GRN';

function stripLeadingHash(raw: string) {
  return String(raw ?? '').trim().replace(/^#\s*/, '');
}

export function formatDocNumber(raw: string, kind?: DocKind): string {
  const s = stripLeadingHash(raw);
  if (!s) return '';
  const m = /^(PR|PO|GRN)-(.+)$/i.exec(s);
  if (!m?.[2]) return s;
  const foundKind = String(m[1] ?? '').toUpperCase() as DocKind;
  const rest = String(m[2] ?? '').trim();
  if (!rest) return s;
  if (kind && foundKind !== kind) return rest; // still strip known prefixes
  return rest;
}

export function formatPrNumber(raw: string) {
  const s = formatDocNumber(raw, 'PR');
  // Hide short random suffixes like `20260508-5b69e5`.
  const m = /^(\d{8})-([0-9a-f]{6})$/i.exec(String(s ?? '').trim());
  if (m?.[1]) return m[1];
  return s;
}

export function formatPoNumber(raw: string) {
  return formatDocNumber(raw, 'PO');
}

export function formatGrnNumber(raw: string) {
  return formatDocNumber(raw, 'GRN');
}
