export type PrStatus = 'Pending Approval' | 'Approved' | 'Rejected';

export type Firm = { id: string; name: string };

export type PurchaseRequest = {
  id: string;
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string; // YYYY-MM-DD
  status: PrStatus;
};

export type PurchaseRequestItem = {
  prId: string;
  itemId: string;
  item: string;
  quantity: number;
  specification: string;
};

export type PurchaseRequestDetail = { pr: PurchaseRequest; items: PurchaseRequestItem[] };

export type Po = {
  id: string;
  prId: string;
  supplier: string;
  paymentTerms: string;
  status: 'Open' | 'Partial' | 'Closed';
  createdAt: string;
};

export type PoItem = { poId: string; itemId: string; item: string; quantity: number; rate: number };

export type Invoice = {
  id: string;
  poId: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  status: 'Recorded' | 'On Hold' | 'Approved' | 'Paid';
  holdReason?: string;
  createdAt: string;
};

export type InvoiceItem = { invoiceId: string; item: string; quantity: number; rate: number };
export type Logistics = { invoiceId: string; dispatchProof: string; cnOrCourierNo: string; transporterName: string };

export type Grn = { id: string; poId: string; invoiceId: string; receivedDate: string; createdAt: string };
export type GrnItem = { grnId: string; item: string; quantityReceived: number };

export type QcRow = {
  grnId: string;
  item: string;
  quantityAccepted: number;
  quantityRejected: number;
  remarks: string;
  inspectedBy: string;
  inspectedAt: string;
  location: string;
};

export type Payment = {
  id: string;
  invoiceId: string;
  paymentDate: string;
  amount: number;
  mode: string;
  referenceNo: string;
  createdAt: string;
};

export type WorkflowSummary = {
  firm?: Firm;
  pr: PurchaseRequestDetail;
  po?: { po: Po; items: PoItem[] };
  invoice?: { invoice: Invoice; items: InvoiceItem[]; logistics?: Logistics };
  grn?: { grn: Grn; items: GrnItem[] };
  qc?: QcRow[];
  payments?: Payment[];
  flags: { invoiceRateMismatch: boolean; quantityMismatch: boolean };
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

export async function fetchFirms(signal?: AbortSignal): Promise<Firm[]> {
  const res = await fetch('/api/firms', { signal });
  const data = await requireOk<{ firms?: Firm[] }>(res, 'Failed to load firms');
  return Array.isArray(data.firms) ? data.firms : [];
}

export async function fetchRequests(signal?: AbortSignal): Promise<PurchaseRequest[]> {
  const res = await fetch('/api/requests', { signal });
  const data = await requireOk<{ requests?: PurchaseRequest[] }>(res, 'Failed to load PRs');
  return Array.isArray(data.requests) ? data.requests : [];
}

export async function fetchRequest(id: string, signal?: AbortSignal): Promise<PurchaseRequestDetail> {
  const res = await fetch(`/api/requests/${encodeURIComponent(id)}`, { signal });
  const data = await requireOk<{ request?: PurchaseRequestDetail }>(res, 'Failed to load PR');
  if (!data.request) throw new Error('PR not found');
  return data.request;
}

export async function createPurchaseRequest(input: {
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string;
  items: Array<{ item: string; quantity: number; specification: string }>;
}): Promise<PurchaseRequestDetail> {
  const res = await fetch('/api/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await requireOk<{ request?: PurchaseRequestDetail }>(res, 'Failed to create PR');
  if (!data.request) throw new Error('Invalid server response');
  return data.request;
}

export async function approvePr(prId: string, approver: string) {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approver }),
  });
  return requireOk<{ request?: PurchaseRequestDetail; error?: string }>(res, 'Failed to approve PR');
}

export async function rejectPr(prId: string, approver: string, rejectReason: string) {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approver, rejectReason }),
  });
  return requireOk<{ request?: PurchaseRequestDetail; error?: string }>(res, 'Failed to reject PR');
}

export async function createPo(
  prId: string,
  input: { supplier: string; paymentTerms: string; items: Array<{ itemId: string; quantity: number; rate: number }> }
) {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/po`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ po?: { po: Po; items: PoItem[] }; error?: string }>(res, 'Failed to create PO');
}

export async function createInvoice(poId: string, input: { supplierInvoiceNo: string; invoiceDate: string; items: Array<{ item: string; quantity: number; rate: number }> }) {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ invoice?: any; error?: string }>(res, 'Failed to create invoice');
}

export async function saveLogistics(invoiceId: string, input: { dispatchProof: string; cnOrCourierNo: string; transporterName: string }) {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/logistics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ logistics?: Logistics; error?: string }>(res, 'Failed to save logistics');
}

export async function createGrn(invoiceId: string, input: { receivedDate: string; items: Array<{ item: string; quantityReceived: number }> }) {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/grn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ grn?: any; error?: string }>(res, 'Failed to create GRN');
}

export async function recordQc(grnId: string, input: { inspectedBy: string; location: string; items: Array<{ item: string; quantityAccepted: number; quantityRejected: number; remarks: string }> }) {
  const res = await fetch(`/api/grns/${encodeURIComponent(grnId)}/qc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<any>(res, 'Failed to record QC');
}

export async function approveInvoice(invoiceId: string) {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/approve`, { method: 'POST' });
  return requireOk<{ status: Invoice['status']; mismatches: string[] }>(res, 'Failed to approve invoice');
}

export async function payInvoice(invoiceId: string, input: { paymentDate: string; amount: number; mode: string; referenceNo: string }) {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ payment?: Payment; error?: string }>(res, 'Failed to pay invoice');
}

export async function fetchWorkflow(prId: string, signal?: AbortSignal): Promise<WorkflowSummary> {
  const res = await fetch(`/api/workflow/${encodeURIComponent(prId)}`, { signal });
  const data = await requireOk<{ workflow?: WorkflowSummary }>(res, 'Failed to load workflow');
  if (!data.workflow) throw new Error('Workflow not found');
  return data.workflow;
}

export async function fetchPos(prId: string, signal?: AbortSignal): Promise<Array<{ po: Po; items: PoItem[] }>> {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/pos`, { signal });
  const data = await requireOk<{ pos?: Array<{ po: Po; items: PoItem[] }> }>(res, 'Failed to load POs');
  return Array.isArray(data.pos) ? data.pos : [];
}

export function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : parts[0]?.[1] ?? '';
  return (first + second).toUpperCase();
}

const avatarClasses = [
  'bg-blue-100 text-blue-600',
  'bg-purple-100 text-purple-600',
  'bg-amber-100 text-amber-600',
  'bg-emerald-100 text-emerald-600',
  'bg-surface-container text-on-surface-variant',
];

export function avatarColorClass(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return avatarClasses[hash % avatarClasses.length]!;
}

export function statusPillClass(status: PrStatus) {
  switch (status) {
    case 'Approved':
      return 'bg-tertiary-container text-on-tertiary-container';
    case 'Pending Approval':
      return 'bg-secondary-container text-on-secondary-container';
    case 'Rejected':
    default:
      return 'bg-error-container text-on-error-container';
  }
}
