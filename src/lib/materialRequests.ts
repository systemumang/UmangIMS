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
  return data.requests;
}

export async function fetchPendingMaterialRequests(signal?: AbortSignal) {
  const res = await fetch('/api/material-requests/pending', { signal });
  const data = await requireOk<{ requests: MaterialRequest[] }>(res, 'Failed to fetch pending material requests');
  return data.requests;
}
