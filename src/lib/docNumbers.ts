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
  return formatDocNumber(raw, 'PR');
}

export function formatPoNumber(raw: string) {
  return formatDocNumber(raw, 'PO');
}

export function formatGrnNumber(raw: string) {
  return formatDocNumber(raw, 'GRN');
}

