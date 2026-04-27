export function formatSpecsLines(specificationsJson?: string) {
  try {
    const obj = JSON.parse(String(specificationsJson ?? '')) as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (!entries.length) return [];
    return entries.map(([k, v]) => `${k}: ${String(v ?? '')}`).filter(Boolean);
  } catch {
    return String(specificationsJson ?? '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

export function formatItemInline(itemName: string, specificationsJson?: string) {
  const base = String(itemName ?? '').trim();
  const specs = formatSpecsLines(specificationsJson);
  return [base, ...specs].filter(Boolean).join(' - ') || '-';
}

