import { fiscalYearLabel } from '@/src/lib/date';

export type InventorySheetRow = {
  itemId: string;
  itemCode: string;
  itemName: string;
  store?: string;
  storeName?: string;
  storeId?: string;
  transferIn?: number;
  transferOut?: number;
  specifications: string;
  unit: string;
  opening: number;
  reorderLevel?: number;
  purchase: number;
  issue: number;
  damage: number;
  returns: number;
  balance: number;
};

export type OpeningBalanceRow = {
  itemId: string;
  quantity: number;
  reorderLevel?: number;
};

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function requireOk<T>(res: Response, fallbackMessage: string): Promise<T> {
  const data = await readJsonSafe<T & { error?: string }>(res);
  if (!res.ok) {
    const serverMessage = (data as any)?.error;
    throw new Error(serverMessage ? String(serverMessage) : `${fallbackMessage} (${res.status})`);
  }
  if (data === null) {
    let hint = '';
    try {
      const text = await res.clone().text();
      const t = text.trim().toLowerCase();
      if (t.startsWith('<!doctype') || t.startsWith('<html')) {
        hint = ' (API returned HTML, is the backend running?)';
      } else if (!t) {
        hint = ' (empty response body)';
      } else {
        hint = ' (non-JSON response body)';
      }
    } catch {}
    throw new Error(`${fallbackMessage} (${res.status})${hint}`);
  }
  return data as T;
}

export async function fetchInventorySheet(
  firmId: string,
  year: string = fiscalYearLabel(),
  signal?: AbortSignal,
  opts?: { includeEmpty?: boolean }
): Promise<InventorySheetRow[]> {
  const params = new URLSearchParams();
  params.set('firmId', firmId);
  params.set('year', year);
  if (opts?.includeEmpty) params.set('includeEmpty', '1');
  const res = await fetch(`/api/inventory/sheet?${params.toString()}`, { signal });
  const data = await requireOk<{ rows?: InventorySheetRow[] }>(res, 'Failed to load inventory sheet');
  return data.rows ?? [];
}

export async function fetchOpeningBalances(storeId: string, year: string = fiscalYearLabel(), signal?: AbortSignal): Promise<OpeningBalanceRow[]> {
  const res = await fetch(`/api/inventory/opening-balances?storeId=${encodeURIComponent(storeId)}&year=${encodeURIComponent(year)}`, { signal });
  const data = await requireOk<{ balances?: OpeningBalanceRow[] }>(res, 'Failed to load opening balances');
  return data.balances ?? [];
}

export async function saveOpeningBalances(storeId: string, year: string, balances: OpeningBalanceRow[]) {
  const res = await fetch('/api/inventory/opening-balances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeId, year, balances }),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to save opening balances');
}
