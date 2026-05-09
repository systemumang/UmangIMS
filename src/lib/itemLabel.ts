function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? '').trim());
}

function isShortHexLike(value: string) {
  return /^[0-9a-f]{6}$/i.test(String(value ?? '').trim());
}

function stripEmbeddedIds(value: string) {
  const raw = String(value ?? '');
  if (!raw) return '';
  const withoutUuids = raw.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '').trim();
  // Cleanup common leftovers from "key: value" and "A - B" chains.
  return withoutUuids
    .replace(/\s*:\s*(?=[:\-]|$)/g, ': ')
    .replace(/\s*-\s*(?=-|$)/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*-\s*$/g, '')
    .replace(/\s*:\s*$/g, '')
    .trim();
}

export function formatSpecsLines(specificationsJson?: string) {
  try {
    const raw = String(specificationsJson ?? '').trim();
    if (!raw || raw === '[]' || raw === '{}') return [];
    const obj = JSON.parse(raw);
    
    if (Array.isArray(obj)) {
      return obj
        .map((s: any) => {
          const name = stripEmbeddedIds(s.specificationName || s.name || '');
          const val = stripEmbeddedIds(s.specificationValue || s.value || '');
          const safeKey = isUuidLike(name) ? '' : name;
          const safeValue = isUuidLike(val) ? '' : val;
          if (!safeKey && !safeValue) return '';
          if (!safeKey) return safeValue;
          if (!safeValue) return safeKey;
          return `${safeKey}: ${safeValue}`;
        })
        .map((s) => String(s ?? '').trim())
        .filter(Boolean);
    }

    if (typeof obj === 'object' && obj !== null) {
      const entries = Object.entries(obj);
      return entries
        .map(([k, v]) => {
          const key = stripEmbeddedIds(String(k ?? '').trim());
          const value = stripEmbeddedIds(String(v ?? '').trim());
          const safeKey = isUuidLike(key) ? '' : key;
          const safeValue = isUuidLike(value) ? '' : value;
          if (!safeKey && !safeValue) return '';
          if (!safeKey) return safeValue;
          if (!safeValue) return safeKey;
          return `${safeKey}: ${safeValue}`;
        })
        .map((s) => String(s ?? '').trim())
        .filter(Boolean);
    }
    return [];
  } catch {
    return stripEmbeddedIds(String(specificationsJson ?? ''))
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !(isUuidLike(s) || isShortHexLike(s)));
  }
}

export function formatItemInline(itemName: string, specificationsJson?: string) {
  const base = String(itemName ?? '').trim();
  const specs = formatSpecsLines(specificationsJson);
  return [base, ...specs]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .filter((s) => !(isUuidLike(s) || isShortHexLike(s)))
    .join(' - ') || '-';
}
