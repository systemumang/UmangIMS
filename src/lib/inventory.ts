export type InventorySheetRow = {
  itemId: string;
  itemCode: string;
  itemName: string;
  specifications: string;
  unit: string;
  opening: number;
  purchase: number;
  issue: number;
  damage: number;
  returns: number;
  balance: number;
};

export type OpeningBalanceRow = {
  itemId: string;
  quantity: number;
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
  if (data === null) throw new Error(`${fallbackMessage} (${res.status})`);
  return data as T;
}

export async function fetchInventorySheet(firmId: string, year: string = '2024-25', signal?: AbortSignal): Promise<InventorySheetRow[]> {
  const res = await fetch(`/api/inventory/sheet?firmId=${encodeURIComponent(firmId)}&year=${encodeURIComponent(year)}`, { signal });
  const data = await requireOk<{ rows?: InventorySheetRow[] }>(res, 'Failed to load inventory sheet');
  return data.rows ?? [];
}

export async function fetchOpeningBalances(storeId: string, year: string = '2024-25', signal?: AbortSignal): Promise<OpeningBalanceRow[]> {
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
