export function formatDateDDMMYYYY(input: string | Date | null | undefined): string {
  if (input == null) return '';

  const IST_TZ = 'Asia/Kolkata';
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  function parseToDate(value: string | Date): Date | null {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;

    const s = String(value).trim();
    if (!s) return null;

    // dd/mm/yyyy[ hh:mm[:ss]]
    const dmy = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (dmy) {
      const dd = Number(dmy[1]);
      const mm = Number(dmy[2]);
      const yyyy = Number(dmy[3]);
      const hh = dmy[4] != null ? Number(dmy[4]) : 0;
      const mi = dmy[5] != null ? Number(dmy[5]) : 0;
      const ss = dmy[6] != null ? Number(dmy[6]) : 0;
      const utcMs = Date.UTC(yyyy, mm - 1, dd, hh, mi, ss) - IST_OFFSET_MS;
      const d = new Date(utcMs);
      return Number.isFinite(d.getTime()) ? d : null;
    }

    // yyyy-mm-dd (date-only)
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (ymd) {
      const yyyy = Number(ymd[1]);
      const mm = Number(ymd[2]);
      const dd = Number(ymd[3]);
      const utcMs = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0) - IST_OFFSET_MS;
      const d = new Date(utcMs);
      return Number.isFinite(d.getTime()) ? d : null;
    }

    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const d = parseToDate(input);
  if (!d) return String(input).trim();

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const byType: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') byType[p.type] = p.value;

  const dd = byType.day ?? '';
  const mm = byType.month ?? '';
  const yyyy = byType.year ?? '';
  const hh = byType.hour ?? '00';
  const mi = byType.minute ?? '00';
  const ss = byType.second ?? '00';
  if (!dd || !mm || !yyyy) return '';
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
}

export function formatDateDDMMYYYYOnly(input: string | Date | null | undefined): string {
  if (input == null) return '';
  const s = String(input).trim();
  if (!s) return '';

  // Already dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s.slice(0, 10);

  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const byType: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') byType[p.type] = p.value;
  const dd = byType.day ?? '';
  const mm = byType.month ?? '';
  const yyyy = byType.year ?? '';
  if (!dd || !mm || !yyyy) return '';
  return `${dd}/${mm}/${yyyy}`;
}
