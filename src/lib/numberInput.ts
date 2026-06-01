export function sanitizeDecimalInput(raw: string): string {
  const s = String(raw ?? '');
  let whole = '';
  let frac = '';
  let dotUsed = false;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      if (dotUsed) {
        if (frac.length < 2) frac += ch;
      } else {
        whole += ch;
      }
      continue;
    }
    if (ch === '.' && !dotUsed) {
      dotUsed = true;
    }
  }
  if (!dotUsed) return whole;
  return `${whole}.${frac}`;
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
