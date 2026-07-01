export function sanitizeDecimalInput(raw: string): string {
  const s = String(raw ?? '');
  let whole = '';
  let frac = '';
  let dotUsed = false;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      if (dotUsed) {
        if (frac.length < 3) frac += ch;
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

export function sanitizeSignedDecimalInput(raw: string): string {
  const s = String(raw ?? '');
  let out = '';
  let whole = '';
  let frac = '';
  let dotUsed = false;
  let sign = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (i === 0 && ch === '-') {
      sign = '-';
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      if (dotUsed) {
        if (frac.length < 3) frac += ch;
      } else {
        whole += ch;
      }
      continue;
    }
    if (ch === '.' && !dotUsed) {
      dotUsed = true;
    }
  }
  out = sign + whole;
  if (dotUsed) out += `.${frac}`;
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
