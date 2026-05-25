import { requireOk } from './utils';

export type MaterialRequestItem = {
  id: string;
  requestId: string;
  itemId: string;
  specification?: string;
  quantity: number;
  issuedQuantity: number;
  itemName?: string;
};

export type MaterialRequest = {
  id: string;
  requestNo: string;
  date: string;
  customerId?: string | null;
  projectId?: string | null;
  requestByType: 'Inhouse' | 'Vendor';
  requestByUserId?: string | null;
  requestBySupplierId?: string | null;
  remarks?: string | null;
  status: string;
  customerName?: string;
  projectName?: string;
  userName?: string;
  supplierName?: string;
  items?: MaterialRequestItem[];
};

function normalizeMaterialRequest(raw: any): MaterialRequest {
  return {
    id: String(raw?.id ?? ''),
    requestNo: String(raw?.requestNo ?? raw?.request_no ?? ''),
    date: String(raw?.date ?? raw?.request_date ?? ''),
    customerId: raw?.customerId ?? raw?.customer_id ?? null,
    projectId: raw?.projectId ?? raw?.project_id ?? null,
    requestByType: String(raw?.requestByType ?? raw?.request_by_type ?? 'Inhouse') === 'Vendor' ? 'Vendor' : 'Inhouse',
    requestByUserId: raw?.requestByUserId ?? raw?.request_by_user_id ?? null,
    requestBySupplierId: raw?.requestBySupplierId ?? raw?.request_by_supplier_id ?? null,
    remarks: raw?.remarks ?? null,
    status: String(raw?.status ?? ''),
    customerName: raw?.customerName ?? raw?.customer_name ?? undefined,
    projectName: raw?.projectName ?? raw?.project_name ?? undefined,
    userName: raw?.userName ?? raw?.user_name ?? undefined,
    supplierName: raw?.supplierName ?? raw?.supplier_name ?? undefined,
    items: Array.isArray(raw?.items)
      ? raw.items.map((item: any) => ({
          id: String(item?.id ?? ''),
          requestId: String(item?.requestId ?? item?.request_id ?? ''),
          itemId: String(item?.itemId ?? item?.item_id ?? ''),
          specification: item?.specification ?? undefined,
          quantity: Number(item?.quantity ?? 0),
          issuedQuantity: Number(item?.issuedQuantity ?? item?.issued_quantity ?? 0),
          itemName: item?.itemName ?? item?.item_name ?? undefined,
        }))
      : [],
  };
}

export async function createMaterialRequest(input: {
  date: string;
  customerId?: string | null;
  projectId?: string | null;
  requestByType: 'Inhouse' | 'Vendor';
  requestByUserId?: string | null;
  requestBySupplierId?: string | null;
  remarks?: string | null;
  items: Array<{ itemId: string; specification?: string; quantity: number }>;
  createdBy?: string;
}) {
  const res = await fetch('/api/material-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ request: MaterialRequest }>(res, 'Failed to create material request');
}

export async function fetchMaterialRequests(signal?: AbortSignal) {
  const res = await fetch('/api/material-requests', { signal });
  const data = await requireOk<{ requests: MaterialRequest[] }>(res, 'Failed to fetch material requests');
  return Array.isArray(data.requests) ? data.requests.map(normalizeMaterialRequest) : [];
}

export async function fetchPendingMaterialRequests(signal?: AbortSignal) {
  const res = await fetch('/api/material-requests/pending', { signal });
  const data = await requireOk<{ requests: MaterialRequest[] }>(res, 'Failed to fetch pending material requests');
  return Array.isArray(data.requests) ? data.requests.map(normalizeMaterialRequest) : [];
}
