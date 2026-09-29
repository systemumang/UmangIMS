export type PhysicalStockRecord = {
  id: string;
  firmId: string;
  firmName?: string;
  firmSortName?: string;
  storeId: string;
  storeName?: string;
  itemId: string;
  itemCode?: string;
  itemName?: string;
  specificationsJson?: string;
  unit?: string;
  physicalStock: number;
  takenBy: string;
  takenOn: string;
  remarks?: string;
  createdAt?: string;
};

export type CreatePhysicalStockPayload = {
  firmId: string;
  storeId: string;
  itemId: string;
  physicalStock: number;
  takenBy: string;
  takenOn?: string;
  remarks?: string;
};

export async function createPhysicalStockEntry(payload: CreatePhysicalStockPayload): Promise<{ ok: boolean; id: string }> {
  const res = await fetch('/api/physical-stock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to submit physical stock entry.');
  }
  return res.json();
}

export async function fetchPhysicalStockMaster(filters?: {
  firmId?: string;
  storeId?: string;
  itemId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<PhysicalStockRecord[]> {
  const params = new URLSearchParams();
  if (filters?.firmId) params.set('firmId', filters.firmId);
  if (filters?.storeId) params.set('storeId', filters.storeId);
  if (filters?.itemId) params.set('itemId', filters.itemId);
  if (filters?.fromDate) params.set('fromDate', filters.fromDate);
  if (filters?.toDate) params.set('toDate', filters.toDate);

  const res = await fetch(`/api/physical-stock?${params.toString()}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch physical stock master.');
  }
  const data = await res.json();
  return data.records ?? [];
}

export async function deletePhysicalStockEntry(id: string): Promise<void> {
  const res = await fetch(`/api/physical-stock/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete physical stock entry.');
  }
}
