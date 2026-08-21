export type SupplierAdvanceFilters = {
  q?: string;
  firmId?: string;
  supplierId?: string;
  from?: string;
  to?: string;
};

export type SupplierAdvanceRow = {
  id: string;
  firmId: string;
  firmName: string;
  firmShortName?: string;
  supplierId: string;
  supplierName: string;
  advanceDate: string;
  advanceAmount: number;
  paymentMode: string;
  paymentCopy?: string;
  remarks?: string;
  createdBy?: string;
  createdAt: string;
};

async function requireOk<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(data?.error ? String(data.error) : `${fallbackMessage} (${response.status})`);
  }
  if (!data) throw new Error(`${fallbackMessage}: invalid server response`);
  return data;
}

function buildQuery(filters?: SupplierAdvanceFilters): string {
  const params = new URLSearchParams();
  if (filters?.q) params.set('q', filters.q);
  if (filters?.firmId) params.set('firmId', filters.firmId);
  if (filters?.supplierId) params.set('supplierId', filters.supplierId);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  const value = params.toString();
  return value ? `?${value}` : '';
}

export async function fetchPendingSupplierAdvances(
  filters?: SupplierAdvanceFilters,
  signal?: AbortSignal
): Promise<SupplierAdvanceRow[]> {
  const response = await fetch(`/api/operations/supplier-advances${buildQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: SupplierAdvanceRow[] }>(response, 'Failed to load pending supplier advances');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function createSupplierAdvance(input: {
  firmId: string;
  supplierId: string;
  advanceDate: string;
  advanceAmount: number;
  paymentMode: string;
  paymentCopy?: string;
  remarks?: string;
  createdBy?: string;
}): Promise<{ ok: boolean; id: string }> {
  const response = await fetch('/api/supplier-advances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ ok: boolean; id: string }>(response, 'Failed to save supplier advance');
}

export async function deleteSupplierAdvance(id: string): Promise<{ ok: boolean }> {
  const response = await fetch(`/api/supplier-advances/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return requireOk<{ ok: boolean }>(response, 'Failed to delete supplier advance');
}
