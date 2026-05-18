type RfqStatus = string;

export type RfqRow = {
  id: string;
  rfqNumber: string;
  rfqDate: string; // YYYY-MM-DD
  status: RfqStatus;
  prId?: string | null;
  remarks?: string | null;
  firmId?: string | null;
  firmName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  itemCount: number;
  pendingRateCount: number;
};

export type RfqItemRow = {
  rfqItemId: string;
  itemId: string;
  itemName: string;
  specification: string;
  quantity: number;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierRate?: number | null;
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

export type RfqListFilters = {
  q?: string;
  firmId?: string;
  projectId?: string;
  status?: string;
  from?: string;
  to?: string;
};

export async function fetchRfqs(filters?: RfqListFilters, signal?: AbortSignal): Promise<RfqRow[]> {
  const qs = new URLSearchParams();
  if (filters?.q) qs.set('q', String(filters.q));
  if (filters?.firmId) qs.set('firmId', String(filters.firmId));
  if (filters?.projectId) qs.set('projectId', String(filters.projectId));
  if (filters?.status) qs.set('status', String(filters.status));
  if (filters?.from) qs.set('from', String(filters.from));
  if (filters?.to) qs.set('to', String(filters.to));

  const url = `/api/rfqs${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, { signal });
  const data = await requireOk<{ rfqs?: RfqRow[] }>(res, 'Failed to load RFQs');
  return Array.isArray(data.rfqs) ? data.rfqs : [];
}

export async function fetchRfqItems(rfqId: string, signal?: AbortSignal): Promise<RfqItemRow[]> {
  const id = String(rfqId ?? '').trim();
  if (!id) return [];
  const res = await fetch(`/api/rfqs/${encodeURIComponent(id)}/items`, { signal });
  const data = await requireOk<{ items?: RfqItemRow[] }>(res, 'Failed to load RFQ items');
  return Array.isArray(data.items) ? data.items : [];
}

