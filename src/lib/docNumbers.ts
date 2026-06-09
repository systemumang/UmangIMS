export type DocKind = 'PR' | 'PO' | 'GRN';

function stripLeadingHash(raw: string) {
  return String(raw ?? '').trim().replace(/^#\s*/, '');
}

export function formatDocNumber(raw: string, kind?: DocKind): string {
  const s = stripLeadingHash(raw);
  if (!s) return '';
  
  // Handle new format: UM/PR/26-27/00001
  const parts = s.split('/');
  if (parts.length >= 3) {
    // If it looks like [FIRM]/[KIND]/...
    const k = parts[1]?.toUpperCase();
    if (['PR', 'PO', 'GRN', 'MR', 'RFQ', 'CV'].includes(k)) {
      if (kind && k !== kind) return s;
      return s;
    }
  }

  // Handle old format: PR-26-27/00001
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
  // Hide UUID-looking values completely.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return '';
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
