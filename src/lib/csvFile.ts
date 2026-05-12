type CsvRow = Record<string, string>;

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => String(s ?? '').trim());
}

export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const raw = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (!raw.length) return { header: [], rows: [] };

  const header = parseLine(raw[0] ?? '').map((h) => String(h ?? '').trim()).filter(Boolean);
  const rows: CsvRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const cols = parseLine(raw[i] ?? '');
    if (!cols.some((c) => String(c ?? '').trim())) continue;
    const row: CsvRow = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = String(cols[j] ?? '').trim();
    }
    rows.push(row);
  }
  return { header, rows };
}

export function toCsv(header: string[], rows: Array<Record<string, unknown>>): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    const needs = s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s);
    if (!needs) return s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines: string[] = [];
  lines.push(header.map(esc).join(','));
  for (const r of rows) {
    lines.push(header.map((h) => esc((r as any)?.[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function downloadTextFile(filename: string, text: string, mime = 'text/plain; charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

