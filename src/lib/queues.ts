export type QueueFilters = {
  q?: string;
  firmId?: string;
  department?: string;
  projectId?: string;
  supplierId?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
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

function buildQueueQuery(filters?: QueueFilters): string {
  const f = filters ?? {};
  const params = new URLSearchParams();
  if (f.q) params.set('q', String(f.q));
  if (f.firmId) params.set('firmId', String(f.firmId));
  if (f.department) params.set('department', String(f.department));
  if (f.projectId) params.set('projectId', String(f.projectId));
  if (f.supplierId) params.set('supplierId', String(f.supplierId));
  if (f.from) params.set('from', String(f.from));
  if (f.to) params.set('to', String(f.to));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export type ApprovePrQueueRow = {
  prId: string;
  prNumber: string;
  firmId: string;
  firmName: string;
  requestType?: 'Stock' | 'Project';
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  requestedBy: string;
  requisitionDate: string;
  requiredDate: string;
  status: 'Pending Approval';
  pendingReason: string;
  priority?: string | null;
};

export async function fetchQueueApprovePr(filters?: QueueFilters, signal?: AbortSignal): Promise<ApprovePrQueueRow[]> {
  const res = await fetch(`/api/queues/approve-pr${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: ApprovePrQueueRow[] }>(res, 'Failed to load Approve PR queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export type CreatePoQueueRow = {
  prId: string;
  prNumber: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  requisitionDate: string;
  remainingQty: number;
  poCount: number;
  pendingReason: string;
  priority?: string | null;
};

export async function fetchQueueCreatePo(filters?: QueueFilters, signal?: AbortSignal): Promise<CreatePoQueueRow[]> {
  const res = await fetch(`/api/queues/create-po${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: CreatePoQueueRow[] }>(res, 'Failed to load Create PO queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export type CheckPoQueueRow = {
  poId: string;
  poNumber: string;
  prId: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId?: string | null;
  supplierName: string;
  orderDate?: string | null;
  createdAt: string;
  pendingReason: string;
  priority?: string | null;
};

export async function fetchQueueCheckPo(filters?: QueueFilters, signal?: AbortSignal): Promise<CheckPoQueueRow[]> {
  const res = await fetch(`/api/queues/check-po${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: CheckPoQueueRow[] }>(res, 'Failed to load Check PO queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export type SendPoQueueRow = CheckPoQueueRow;

export async function fetchQueueSendPo(filters?: QueueFilters, signal?: AbortSignal): Promise<SendPoQueueRow[]> {
  const res = await fetch(`/api/queues/send-po${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: SendPoQueueRow[] }>(res, 'Failed to load Send PO queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export type CreateGrnQueueRow = {
  poId: string;
  poNumber: string;
  prId: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId?: string | null;
  supplierName: string;
  pendingQty: number;
  createdAt: string;
  pendingReason: string;
  priority?: string | null;
};

export async function fetchQueueCreateGrn(filters?: QueueFilters, signal?: AbortSignal): Promise<CreateGrnQueueRow[]> {
  const res = await fetch(`/api/queues/create-grn${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: CreateGrnQueueRow[] }>(res, 'Failed to load Create GRN queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export type QcQueueRow = {
  grnId: string;
  grnNumber: string;
  poId: string;
  poNumber: string;
  prId: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId?: string | null;
  supplierName: string;
  receivedDate: string;
  pendingItems: number;
  pendingReason: string;
};

export async function fetchQueueQc(filters?: QueueFilters, signal?: AbortSignal): Promise<QcQueueRow[]> {
  const res = await fetch(`/api/queues/check-quality${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: QcQueueRow[] }>(res, 'Failed to load QC queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export type EnterInvoiceQueueRow = {
  poId: string;
  poNumber: string;
  prId: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId?: string | null;
  supplierName: string;
  pendingQty: number;
  pendingReason: string;
};

export async function fetchQueueEnterInvoice(filters?: QueueFilters, signal?: AbortSignal): Promise<EnterInvoiceQueueRow[]> {
  const res = await fetch(`/api/queues/enter-invoice${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: EnterInvoiceQueueRow[] }>(res, 'Failed to load Enter Invoice queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export type EnterCreditVoucherQueueRow = {
  poId: string;
  poNumber: string;
  prId: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId?: string | null;
  supplierName: string;
  pendingReason: string;
};

export async function fetchQueueEnterCreditVoucher(filters?: QueueFilters, signal?: AbortSignal): Promise<EnterCreditVoucherQueueRow[]> {
  const res = await fetch(`/api/queues/enter-credit-voucher${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: EnterCreditVoucherQueueRow[] }>(res, 'Failed to load Enter Credit Voucher queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export type LinkInvoiceGrnQueueRow = {
  grnId: string;
  grnNumber: string;
  receivedDate: string;
  poId: string;
  poNumber: string;
  prId: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId?: string | null;
  supplierName: string;
  pendingQty: number;
  pendingItems: number;
  pendingReason: string;
};

export async function fetchQueueLinkInvoiceGrn(filters?: QueueFilters, signal?: AbortSignal): Promise<LinkInvoiceGrnQueueRow[]> {
  const res = await fetch(`/api/queues/link-invoice-grn${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: LinkInvoiceGrnQueueRow[] }>(res, 'Failed to load Link Invoice ↔ GRN queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export type ApproveInvoiceQueueRow = {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  poId: string;
  poNumber: string;
  prId: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId?: string | null;
  supplierName: string;
  invoiceAmount: number;
  status: 'Recorded' | 'On Hold' | 'Approved' | 'Paid';
  approvedBy?: string;
  approvedAt?: string;
  pendingReason: string;
};

export async function fetchQueueApproveInvoice(filters?: QueueFilters, signal?: AbortSignal): Promise<ApproveInvoiceQueueRow[]> {
  const res = await fetch(`/api/queues/approve-invoice${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: ApproveInvoiceQueueRow[] }>(res, 'Failed to load Approve Invoice queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function updateQueueApproveInvoice(
  invoiceId: string,
  input: { approvedBy: string; approveDate: string }
): Promise<{ ok?: boolean }> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/approve-entry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ ok?: boolean }>(res, 'Failed to approve invoice');
}

export type ApproveCreditVoucherQueueRow = {
  creditVoucherId: string;
  voucherNo: string;
  voucherDate: string;
  poId: string;
  poNumber: string;
  prId: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId?: string | null;
  supplierName: string;
  voucherAmount: number;
  status: 'Recorded' | 'On Hold' | 'Approved' | 'Paid';
  approvedBy?: string;
  approvedAt?: string;
  pendingReason: string;
};

export async function fetchQueueApproveCreditVoucher(
  filters?: QueueFilters,
  signal?: AbortSignal
): Promise<ApproveCreditVoucherQueueRow[]> {
  const res = await fetch(`/api/queues/approve-credit-voucher${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: ApproveCreditVoucherQueueRow[] }>(res, 'Failed to load Approve Credit Voucher queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function updateQueueApproveCreditVoucher(
  creditVoucherId: string,
  input: { approvedBy: string; approveDate: string }
): Promise<{ ok?: boolean }> {
  const res = await fetch(`/api/credit-vouchers/${encodeURIComponent(creditVoucherId)}/approve-entry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ ok?: boolean }>(res, 'Failed to approve credit voucher');
}

export type CreditVoucherPaymentQueueRow = {
  creditVoucherId: string;
  voucherNo: string;
  voucherDate: string;
  paymentStatus?: string;
  paymentDate?: string;
  poId: string;
  poNumber: string;
  prId: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId?: string | null;
  supplierName: string;
  voucherAmount: number;
  paymentMode?: string;
  tallyEntryDate?: string;
  paidAmount: number;
  remainingAmount: number;
  pendingReason: string;
};

export async function fetchQueueCreditVoucherPayment(
  filters?: QueueFilters,
  signal?: AbortSignal
): Promise<CreditVoucherPaymentQueueRow[]> {
  const res = await fetch(`/api/queues/credit-voucher-payment${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: CreditVoucherPaymentQueueRow[] }>(res, 'Failed to load Credit Voucher Payment queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export type PaymentQueueRow = {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  paymentStatus?: string;
  paymentDate?: string;
  poId: string;
  poNumber: string;
  prId: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  supplierId?: string | null;
  supplierName: string;
  invoiceAmount: number;
  paymentMode?: 'Cash' | 'Credit' | string;
  tallyEntryDate?: string;
  paidAmount: number;
  remainingAmount: number;
  totalInvoiceQty?: number;
  totalLinkedQty?: number;
  totalApprovedQty?: number;
  pendingReason: string;
};

export async function fetchQueuePayment(filters?: QueueFilters, signal?: AbortSignal): Promise<PaymentQueueRow[]> {
  const res = await fetch(`/api/queues/payment${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: PaymentQueueRow[] }>(res, 'Failed to load Payment queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function fetchQueueTallyEntry(filters?: QueueFilters, signal?: AbortSignal): Promise<PaymentQueueRow[]> {
  const res = await fetch(`/api/queues/tally-entry${buildQueueQuery(filters)}`, { signal });
  const data = await requireOk<{ rows?: PaymentQueueRow[] }>(res, 'Failed to load Tally Entry queue');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function updateQueueTallyEntry(
  invoiceId: string,
  input: { tallyEntryDate: string; updatedBy?: string }
): Promise<{ ok?: boolean }> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/tally-entry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ ok?: boolean }>(res, 'Failed to update tally entry');
}
