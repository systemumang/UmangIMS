export type OperationsFilters = {
  q?: string;
  firmId?: string;
  projectId?: string;
  supplierId?: string;
  status?: string;
  from?: string;
  to?: string;
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

function buildOpsQuery(filters?: OperationsFilters): string {
  const f = filters ?? {};
  const params = new URLSearchParams();
  if (f.q) params.set('q', String(f.q));
  if (f.firmId) params.set('firmId', String(f.firmId));
  if (f.projectId) params.set('projectId', String(f.projectId));
  if (f.supplierId) params.set('supplierId', String(f.supplierId));
  if (f.status) params.set('status', String(f.status));
  if (f.from) params.set('from', String(f.from));
  if (f.to) params.set('to', String(f.to));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export type OperationsPrListRow = {
  prId: string;
  prNumber: string;
  firmId: string;
  firmName: string;
  department: string;
  store?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  requestedBy: string;
  requisitionDate: string;
  requiredDate: string;
  requestType?: 'Stock' | 'Project';
  status: 'Pending Approval' | 'Approved' | 'Rejected';
  itemCount: number;
  totalQty: number;
};

export type OperationsPoListRow = {
  poId: string;
  poNumber: string;
  prId: string;
  prNumber: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId: string;
  supplierName: string;
  orderDate?: string | null;
  advanceDate?: string | null;
  createdAt: string;
  status: 'Open' | 'Partial' | 'Closed';
  itemCount: number;
  totalAmount: number;
  advanceAmount?: number;
};

export type PoAdvanceRow = {
  id: string;
  poId: string;
  advanceDate: string;
  advanceAmount: number;
};

export type OperationsGrnListRow = {
  grnId: string;
  grnNumber: string;
  receivedDate: string;
  poId: string;
  poNumber: string;
  prId: string;
  prNumber: string;
  firmId: string;
  firmName: string;
  supplierId: string;
  supplierName: string;
  itemCount: number;
  totalQty: number;
  createdAt: string;
};

export type OperationsInvoiceListRow = {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: number;
  grnQty?: number;
  approvedQty?: number;
  poId: string;
  poNumber: string;
  prId: string;
  prNumber: string;
  firmId: string;
  firmName: string;
  supplierId: string;
  supplierName: string;
  approvedBy?: string;
  tallyEntryDate?: string;
  status: 'Recorded' | 'On Hold' | 'Approved' | 'Paid';
  paymentStatus?: string;
  paymentDate?: string;
  createdAt: string;
};

export type OperationsPaymentListRow = {
  paymentId: string;
  paymentDate: string;
  amount: number;
  mode?: string;
  referenceNo?: string;
  status?: string | null;
  invoiceId: string;
  invoiceNo: string;
  poId: string;
  poNumber: string;
  prId: string;
  prNumber: string;
  firmId: string;
  firmName: string;
  supplierId: string;
  supplierName: string;
  createdAt: string;
};

export type OperationsAdvanceListRow = {
  poId: string;
  poNumber: string;
  prId: string;
  prNumber: string;
  firmId: string;
  firmName: string;
  supplierId: string;
  supplierName: string;
  department?: string;
  projectId?: string | null;
  projectName?: string | null;
  orderDate?: string | null;
  status?: string;
  advanceAmount: number;
  advanceDate?: string | null;
  amountAdjusted: number;
  createdAt: string;
};

export type PoAdvanceAdjustmentInvoiceRow = {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: number;
  adjustedAmount: number;
  createdAt: string;
};

export type OperationsPrDetail = {
  pr: any;
  pos: any[];
  grns: any[];
  invoices: any[];
  paymentsByInvoiceId: Record<string, any[]>;
};

export type OperationsPaymentDetail = {
  payment: OperationsPaymentListRow;
  invoice: any;
  po: any;
  pr: any;
};

export async function fetchOperationsPrs(filters?: OperationsFilters, signal?: AbortSignal): Promise<OperationsPrListRow[]> {
  const res = await fetch(`/api/operations/prs${buildOpsQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: OperationsPrListRow[] }>(res, 'Failed to load PRs');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function fetchOperationsPos(filters?: OperationsFilters, signal?: AbortSignal): Promise<OperationsPoListRow[]> {
  const res = await fetch(`/api/operations/pos${buildOpsQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: OperationsPoListRow[] }>(res, 'Failed to load POs');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function fetchOperationsGrns(filters?: OperationsFilters, signal?: AbortSignal): Promise<OperationsGrnListRow[]> {
  const res = await fetch(`/api/operations/grns${buildOpsQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: OperationsGrnListRow[] }>(res, 'Failed to load GRNs');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function fetchOperationsInvoices(filters?: OperationsFilters, signal?: AbortSignal): Promise<OperationsInvoiceListRow[]> {
  const res = await fetch(`/api/operations/invoices${buildOpsQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: OperationsInvoiceListRow[] }>(res, 'Failed to load invoices');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function fetchOperationsPayments(filters?: OperationsFilters, signal?: AbortSignal): Promise<OperationsPaymentListRow[]> {
  const res = await fetch(`/api/operations/payments${buildOpsQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: OperationsPaymentListRow[] }>(res, 'Failed to load payments');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function fetchOperationsAdvances(filters?: OperationsFilters, signal?: AbortSignal): Promise<OperationsAdvanceListRow[]> {
  const res = await fetch(`/api/operations/advances${buildOpsQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: OperationsAdvanceListRow[] }>(res, 'Failed to load advances');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function fetchPoAdvanceAdjustments(poId: string, signal?: AbortSignal): Promise<PoAdvanceAdjustmentInvoiceRow[]> {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/advance-adjustments`, { signal });
  const data = await requireOk<{ invoices?: PoAdvanceAdjustmentInvoiceRow[] }>(res, 'Failed to load advance adjustments');
  return Array.isArray(data.invoices) ? data.invoices : [];
}

export async function updatePoAdvanceAdjustments(
  poId: string,
  rows: Array<{ invoiceId: string; adjustedAmount: number }>,
  updatedBy?: string
): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/advance-adjustments`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, updatedBy }),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to save advance adjustments');
}

export async function fetchOperationsPrDetail(prId: string, signal?: AbortSignal): Promise<OperationsPrDetail> {
  const res = await fetch(`/api/operations/prs/${encodeURIComponent(prId)}`, { signal });
  const data = await requireOk<{ detail?: OperationsPrDetail }>(res, 'Failed to load PR detail');
  if (!data.detail) throw new Error('PR detail not found');
  return data.detail;
}

export async function fetchOperationsPoDetail(poId: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`/api/operations/pos/${encodeURIComponent(poId)}`, { signal });
  const data = await requireOk<{ detail?: any }>(res, 'Failed to load PO detail');
  if (!data.detail) throw new Error('PO detail not found');
  return data.detail;
}

export async function fetchPoAdvances(poId: string, signal?: AbortSignal): Promise<PoAdvanceRow[]> {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/advances`, { signal });
  const data = await requireOk<{ advances?: PoAdvanceRow[] }>(res, 'Failed to load PO advances');
  return Array.isArray(data.advances) ? data.advances : [];
}

export async function updatePoAdvances(
  poId: string,
  advances: Array<{ id?: string; advanceDate: string; advanceAmount: number }>
): Promise<{ ok: boolean; advances: PoAdvanceRow[]; summary: { advanceAmount: number; advanceDate: string | null } }> {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/advances`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ advances }),
  });
  return requireOk<{ ok: boolean; advances: PoAdvanceRow[]; summary: { advanceAmount: number; advanceDate: string | null } }>(
    res,
    'Failed to update PO advances'
  );
}

export async function fetchOperationsGrnDetail(grnId: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`/api/operations/grns/${encodeURIComponent(grnId)}`, { signal });
  const data = await requireOk<{ detail?: any }>(res, 'Failed to load GRN detail');
  if (!data.detail) throw new Error('GRN detail not found');
  return data.detail;
}

export async function fetchOperationsInvoiceDetail(invoiceId: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`/api/operations/invoices/${encodeURIComponent(invoiceId)}`, { signal });
  const data = await requireOk<{ detail?: any }>(res, 'Failed to load invoice detail');
  if (!data.detail) throw new Error('Invoice detail not found');
  return data.detail;
}

export async function fetchOperationsPaymentDetail(paymentId: string, signal?: AbortSignal): Promise<OperationsPaymentDetail> {
  const res = await fetch(`/api/operations/payments/${encodeURIComponent(paymentId)}`, { signal });
  const data = await requireOk<{ detail?: OperationsPaymentDetail }>(res, 'Failed to load payment detail');
  if (!data.detail) throw new Error('Payment detail not found');
  return data.detail;
}

export function operationsExportUrl(kind: 'prs' | 'pos' | 'grns' | 'invoices' | 'payments', filters?: OperationsFilters): string {
  void kind;
  void filters;
  return '';
}
