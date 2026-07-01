export function formatMax2(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

