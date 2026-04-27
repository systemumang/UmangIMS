export function sanitizeDecimalInput(raw: string): string {
  const s = String(raw ?? '');
  let out = '';
  let dotUsed = false;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
      continue;
    }
    if (ch === '.' && !dotUsed) {
      out += ch;
      dotUsed = true;
    }
  }
  return out;
}

export function sanitizePercentInput(raw: string): string {
  return sanitizeDecimalInput(raw);
}

export function clampPercentString(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return '';
  const clamped = Math.max(0, Math.min(100, n));
  // Avoid showing "-0"
  if (Math.abs(clamped) < 1e-12) return '0';
  return String(clamped);
}

export function numberOrZero(raw: string): number {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

