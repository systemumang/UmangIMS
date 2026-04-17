export function formatDateDDMMYYYY(input: string | Date | null | undefined): string {
  if (input == null) return '';

  if (input instanceof Date) {
    const d = input;
    if (!Number.isFinite(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear()).padStart(4, '0');
    return `${dd}/${mm}/${yyyy}`;
  }

  const s = String(input).trim();
  if (!s) return '';

  // Already dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s.slice(0, 10);

  // yyyy-mm-dd (or ISO starting with that)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;

  // Fallback: try Date parsing
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  return `${dd}/${mm}/${yyyy}`;
}

