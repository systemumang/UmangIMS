export type CourierStatus = 'In Progress' | 'Received' | 'Cancel';

export type CourierRow = {
  id: string;
  date: string;
  courierNo: string;
  supplierId: string;
  supplierName: string;
  projectId?: string;
  projectName?: string;
  poId?: string;
  poNumber?: string;
  courierCopyUrl?: string;
  expectedDate: string;
  status: CourierStatus;
  lastUpdateDate?: string;
  lastUpdateBy?: string;
  lastUpdateRemarks?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CourierUpdateRow = {
  id: string;
  courierId: string;
  updateDate: string;
  updatedBy: string;
  status: CourierStatus;
  remarks?: string;
  createdAt?: string;
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
  if (!res.ok) throw new Error(String((data as any)?.error ?? `${fallbackMessage} (${res.status})`));
  if (data === null) throw new Error(`${fallbackMessage} (${res.status})`);
  return data as T;
}

export async function fetchCouriers(signal?: AbortSignal): Promise<CourierRow[]> {
  const res = await fetch('/api/couriers', { signal });
  const data = await requireOk<{ couriers?: CourierRow[] }>(res, 'Failed to load couriers');
  return Array.isArray(data.couriers) ? data.couriers : [];
}

export async function fetchPendingReceiptCouriers(signal?: AbortSignal): Promise<CourierRow[]> {
  const res = await fetch('/api/couriers/pending-receipt', { signal });
  const data = await requireOk<{ couriers?: CourierRow[] }>(res, 'Failed to load pending receipt couriers');
  return Array.isArray(data.couriers) ? data.couriers : [];
}

export async function createCourier(input: {
  date: string;
  courierNo: string;
  supplierId: string;
  projectId?: string;
  poId?: string;
  courierCopyUrl?: string;
  expectedDate: string;
  createdBy?: string;
}): Promise<CourierRow> {
  const res = await fetch('/api/couriers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await requireOk<{ courier?: CourierRow }>(res, 'Failed to create courier');
  if (!data.courier) throw new Error('Failed to create courier');
  return data.courier;
}

export async function fetchCourierUpdates(courierId: string, signal?: AbortSignal): Promise<CourierUpdateRow[]> {
  const res = await fetch(`/api/couriers/${encodeURIComponent(courierId)}/updates`, { signal });
  const data = await requireOk<{ updates?: CourierUpdateRow[] }>(res, 'Failed to load courier updates');
  return Array.isArray(data.updates) ? data.updates : [];
}

export async function addCourierUpdate(
  courierId: string,
  input: { updateDate: string; updatedBy: string; status: CourierStatus; remarks?: string }
): Promise<CourierRow> {
  const res = await fetch(`/api/couriers/${encodeURIComponent(courierId)}/updates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await requireOk<{ courier?: CourierRow }>(res, 'Failed to update courier');
  if (!data.courier) throw new Error('Failed to update courier');
  return data.courier;
}
