export type PrStatus = 'Pending Approval' | 'Approved' | 'Rejected';

export type Firm = {
  id: string;
  name: string;
  address?: string | null;
  termsConditions?: string | null;
};

export type PurchaseRequest = {
  id: string;
  prNumber?: string;
  firmId: string;
  store?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  department: string;
  requestedBy: string;
  requiredDate: string; // YYYY-MM-DD
  requisitionDate: string; // ISO
  requestType?: 'Stock' | 'Project';
  status: PrStatus;
};

export type PurchaseRequestItem = {
  id: string;
  prId: string;
  itemId: string;
  item: string;
  unit?: string | null;
  quantity: number;
  approvedQty?: number;
  priorityId?: string | null;
  priority?: string | null;
  specification: string;
  dimLength?: number | null;
  dimBreadth?: number | null;
  dimPcs?: number | null;
  dimUnit?: 'ft' | 'm' | string | null;
  approvedDimLength?: number | null;
  approvedDimBreadth?: number | null;
  approvedDimPcs?: number | null;
  approvedDimUnit?: 'ft' | 'm' | string | null;
};

export type PurchaseRequestDetail = { pr: PurchaseRequest; items: PurchaseRequestItem[] };

export type Po = {
  id: string;
  poNumber?: string;
  prId: string;
  firmId?: string;
  orderDate?: string;
  createdBy?: string;
  supplierId?: string;
  supplier: string;
  supplierGstNumber?: string | null;
  supplierGstType?: string | null;
  supplierAddress?: string | null;
  supplierPhone?: string | null;
  paymentTerms: string;
  shippingAddress?: string | null;
  termsConditions?: string | null;
  status: 'Open' | 'Partial' | 'Closed';
  createdAt: string;
  checkPo?: boolean;
  checkPoUserId?: string | null;
  checkDate?: string | null;
  sentBy?: string | null;
  sentDate?: string | null;
  sentProof?: string | null;
  advanceAmount?: number;
  advanceDate?: string | null;
  cancelReason?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
};

export type PoItem = {
  poId: string;
  itemId: string;
  item: string;
  unit?: string | null;
  specificationsJson?: string;
  quantity: number;
  rate: number;
  discountPercent?: number;
  taxPercent?: number;
  goodsAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  cancelledQty?: number;
  cancelReason?: string | null;
  dimLength?: number | null;
  dimBreadth?: number | null;
  dimPcs?: number | null;
  dimUnit?: 'ft' | 'm' | string | null;
};

	export type Invoice = {
			  id: string;
			  poId: string;
			  supplierInvoiceNo: string;
			  invoiceDate: string;
			  invoiceAmount?: number;
			  courierCharge?: number;
			  packingCharge?: number;
			  labourCharge?: number;
			  otherCharge?: number;
			  chargesGstAmount?: number;
			  status: 'Recorded' | 'On Hold' | 'Approved' | 'Paid';
		  paymentStatus?: string;
		  paymentDate?: string;
      paymentAmount?: number;
      adjustedAmount?: number;
      paymentMode?: 'Cash' | 'Credit' | string;
      tallyEntryDate?: string;
		  holdReason?: string;
		  documentUrl?: string;
		  cnCopyUrl?: string;
		  ewayBillUrl?: string;
		  ewayBillNumber?: string;
		  cnNumber?: string;
		  courierNumber?: string;
		  transporterName?: string;
		  createdBy?: string;
		  createdAt: string;
		  updatedBy?: string;
		  updatedAt?: string;
		};

export type InvoiceItem = {
  invoiceId: string;
  id: string;
  itemId: string;
  item: string;
  quantity: number;
  rate: number;
  taxPercent?: number;
  dimLength?: number | null;
  dimBreadth?: number | null;
  dimPcs?: number | null;
  dimInputUnit?: 'ft' | 'm' | string | null;
};
export type Logistics = { invoiceId: string; dispatchProof: string; cnOrCourierNo: string; transporterName: string };

export type Grn = {
  id: string;
  grnNumber?: string;
  poId: string;
  invoiceId: string;
  receivedDate: string;
  createdAt: string;
  updatedBy?: string;
  materialReceivedBy?: string | null;
  goodsCollectedBy?: string | null;
};
export type GrnItem = {
  id: string;
  grnId: string;
  itemId: string;
  item: string;
  unit?: string | null;
  specificationsJson?: string;
  quantityReceived: number;
  recvDimLength?: number | null;
  recvDimBreadth?: number | null;
  recvDimPcs?: number | null;
  recvDimInputUnit?: 'ft' | 'm' | string | null;
  recvDimPoUnit?: 'ft' | 'm' | string | null;
};
export type GrnWithItems = { grn: Grn; items: GrnItem[] };

export type QcRow = {
		  grnId: string;
		  itemId: string;
		  item: string;
		  quantityAccepted: number;
		  quantityRejected: number;
		  remarks: string;
		  inspectedBy: string;
		  inspectedAt: string;
		  location: string;
		};

export type QcRecord = {
  id: string;
  grnId: string;
  poId: string;
  itemId: string;
  item: string;
  acceptedQty: number;
  rejectedQty: number;
  remarks: string;
  qcBy: string;
  qcDate: string;
  createdAt: string;
  updatedBy?: string;
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

export type InvoiceWithItems = { invoice: Invoice; items: InvoiceItem[]; logistics?: Logistics };

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

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit & { signal?: AbortSignal },
  opts?: { retries?: number; baseDelayMs?: number }
): Promise<Response> {
  const retries = Math.max(0, Number(opts?.retries ?? 2));
  const baseDelayMs = Math.max(50, Number(opts?.baseDelayMs ?? 350));

  let last: Response | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(input, init);
    last = res;
    if (res.status !== 503) return res;
    if (attempt >= retries) return res;
    await new Promise<void>((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
  }
  return last ?? fetch(input, init);
}

export type LastSupplierInfo = { supplierName: string; rate: number };
export type LastSupplierInfoWithId = { supplierId: string; supplierName: string; rate: number };

export async function fetchLastSupplierByItemIds(
  itemIds: string[],
  signal?: AbortSignal
): Promise<Record<string, LastSupplierInfoWithId>> {
  const ids = (Array.isArray(itemIds) ? itemIds : []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const res = await fetch('/api/items/last-supplier', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds: ids }),
    signal,
  });
  const data = await requireOk<{ byItemId?: Record<string, LastSupplierInfoWithId> }>(res, 'Failed to load last supplier info');
  return data.byItemId && typeof data.byItemId === 'object' ? data.byItemId : {};
}

export async function fetchFirms(signal?: AbortSignal): Promise<Firm[]> {
  const res = await fetchWithRetry('/api/firms', { signal }, { retries: 3, baseDelayMs: 350 });
  const data = await requireOk<{ firms?: Firm[] }>(res, 'Failed to load firms');
  const rows = Array.isArray(data.firms) ? data.firms : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
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
  store?: string;
  requestType?: 'Stock' | 'Project';
  projectId?: string | null;
  department: string;
  remarks?: string;
  requestedBy: string;
  requiredDate: string;
  items: Array<
    | { itemId: string; item?: string; quantity: number; priorityId?: string | null; specification: string }
    | {
        itemNameId: string;
        quantity: number;
        priorityId?: string | null;
        specs: Record<string, string>;
        length?: number;
        breadth?: number;
        pcs?: number;
      }
  >;
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

export type ApprovePrItemInput = {
  id: string;
  quantity: number;
  length?: number;
  breadth?: number;
  pcs?: number;
  itemId?: string;
  item?: string;
  specification?: string;
};

export async function approvePr(prId: string, approver: string, items?: ApprovePrItemInput[]) {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approver, items }),
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
  input: {
    supplier: string;
    paymentTerms: string;
    paymentType?: string | null;
    paymentMode?: string | null;
    advanceAmount?: number;
    advanceDate?: string | null;
    shippingAddress?: string;
    termsConditions?: string;
    items: Array<{
      itemId: string;
      quantity: number;
      rate: number;
      discountPercent?: number;
      taxPercent?: number;
      length?: number;
      breadth?: number;
      pcs?: number;
    }>;
  }
) {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/po`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ po?: { po: Po; items: PoItem[] }; error?: string }>(res, 'Failed to create PO');
}

export async function createRfq(
  prId: string,
  input: { items: Array<{ itemId: string; supplierId?: string | null; supplierRate?: number | null; quantity: number; specification?: string | null }> }
) {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/rfq`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ rfq?: { id: string; rfqNumber: string; prId: string } }>(res, 'Failed to create RFQ');
}

export type PendingSupplierRateRow = {
  rfqItemId: string;
  rfqId: string;
  rfqNumber: string;
  rfqDate: string; // YYYY-MM-DD
  prId?: string | null;
  prNumber?: string | null;
  itemId: string;
  item: string;
  specification: string;
  quantity: number;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierRate?: number | null;
};

export async function fetchPendingSupplierRates(signal?: AbortSignal) {
  const res = await fetch(`/api/rfq-items/pending-supplier-rate`, { signal });
  return requireOk<{ rows?: PendingSupplierRateRow[] }>(res, 'Failed to load pending supplier rates').then((d) => d.rows ?? []);
}

export async function updateRfqItemSupplierRate(rfqItemId: string, supplierRate: number) {
  const res = await fetch(`/api/rfq-items/${encodeURIComponent(rfqItemId)}/supplier-rate`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supplierRate }),
  });
  return requireOk<{ ok?: boolean }>(res, 'Failed to update supplier rate');
}

export async function createDirectPo(input: {
  firmId: string;
  storeId?: string | null;
  projectId?: string | null;
  poType?: 'Goods' | 'Services';
  department?: string;
  remarks?: string;
  requestedBy?: string;
  requiredDate?: string; // YYYY-MM-DD
  supplierId: string;
  paymentTerms: string;
  paymentType?: string | null;
  paymentMode?: string | null;
  advanceAmount?: number;
  advanceDate?: string | null;
  shippingAddress?: string;
  termsConditions?: string;
  items: Array<{
    itemId?: string;
    itemNameId?: string;
    specs?: Record<string, string>;
    quantity: number;
    rate: number;
    discountPercent?: number;
    taxPercent?: number;
    length?: number;
    breadth?: number;
    pcs?: number;
  }>;
}) {
  const res = await fetch('/api/pos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ po?: { po: Po; items: PoItem[] }; error?: string }>(res, 'Failed to create PO');
}

export async function createInvoice(poId: string, input: { 
				  supplierInvoiceNo: string; 
				  invoiceDate: string; 
				  invoiceAmount?: number;
				  courierCharge?: number;
				  packingCharge?: number;
				  labourCharge?: number;
				  otherCharge?: number;
				  chargesGstAmount?: number;
				  updatedBy?: string;
				  documentUrl?: string;
				  cnCopyUrl?: string;
				  ewayBillUrl?: string;
				  ewayBillNumber?: string;
			  cnNumber?: string;
			  courierNumber?: string;
				  transporterName?: string;
          paymentMode?: 'Cash' | 'Credit';
          tallyEntryDate?: string;
				  items: Array<{
            itemId: string;
            item?: string;
            quantity: number;
            rate: number;
            taxPercent?: number;
            length?: number;
            breadth?: number;
            pcs?: number;
            inputUnit?: 'ft' | 'm' | string;
          }> 
			}) {
			  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/invoice`, {
			    method: 'POST',
			    headers: { 'Content-Type': 'application/json' },
		    body: JSON.stringify(input),
		  });
			  return requireOk<{ invoice?: any; error?: string }>(res, 'Failed to create invoice');
			}

export async function createCreditVoucher(
  poId: string,
  input: {
    voucherNumber?: string | null;
    voucherDate: string;
    updatedBy?: string;
    items: Array<{ itemId: string; item?: string; quantity: number; rate: number }>;
  }
) {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/credit-voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ creditVoucher?: any; error?: string }>(res, 'Failed to create credit voucher');
}

export async function updateInvoice(
  invoiceId: string,
  input: {
    supplierInvoiceNo: string;
    invoiceDate: string;
    invoiceAmount?: number;
    courierCharge?: number;
    packingCharge?: number;
    labourCharge?: number;
    otherCharge?: number;
    chargesGstAmount?: number;
    updatedBy?: string;
    documentUrl?: string;
    cnCopyUrl?: string;
    ewayBillUrl?: string;
    ewayBillNumber?: string;
    cnNumber?: string;
    courierNumber?: string;
    transporterName?: string;
    items: Array<{
      itemId: string;
      item?: string;
      quantity: number;
      rate: number;
      taxPercent?: number;
      length?: number;
      breadth?: number;
      pcs?: number;
      inputUnit?: 'ft' | 'm' | string;
    }>;
  }
) {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ invoice?: any; error?: string }>(res, 'Failed to update invoice');
}

export async function updateInvoicePayment(
  invoiceId: string,
  input: {
    paymentDate: string;
    paymentAmount: number;
    adjustedAmount?: number;
    paymentMode?: 'Cash' | 'UPI' | 'Cheque' | 'NEFT' | 'RTGS' | 'IMPS' | 'Card' | string;
    paymentCopy?: string;
    tallyEntryDate?: string;
    updatedBy?: string;
  }
) {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/payment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ invoice?: any; error?: string }>(res, 'Failed to update invoice payment');
}

export async function updateCreditVoucherPayment(
  creditVoucherId: string,
  input: {
    paymentDate: string;
    paymentAmount: number;
    paymentMode?: 'Cash' | 'UPI' | 'Cheque' | 'NEFT' | 'RTGS' | 'IMPS' | 'Card' | string;
    paymentCopy?: string;
    tallyEntryDate?: string;
    updatedBy?: string;
  }
) {
  const res = await fetch(`/api/credit-vouchers/${encodeURIComponent(creditVoucherId)}/payment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ ok?: boolean; error?: string }>(res, 'Failed to update credit voucher payment');
}

export async function deleteInvoice(invoiceId: string) {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, { method: 'DELETE' });
  return requireOk<{ ok?: boolean; error?: string }>(res, 'Failed to delete invoice');
}

export async function saveLogistics(invoiceId: string, input: { dispatchProof: string; cnOrCourierNo: string; transporterName: string }) {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/logistics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ logistics?: Logistics; error?: string }>(res, 'Failed to save logistics');
}

export async function createGrn(
  invoiceId: string,
  input: {
    receivedDate: string;
    updatedBy?: string;
    items: Array<{
      itemId: string;
      item?: string;
      quantityReceived: number;
      length?: number;
      breadth?: number;
      pcs?: number;
      inputUnit?: 'ft' | 'm' | string;
      roundOff?: number;
    }>;
  }
) {
		  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/grn`, {
		    method: 'POST',
		    headers: { 'Content-Type': 'application/json' },
		    body: JSON.stringify(input),
		  });
		  return requireOk<{ grn?: any; error?: string }>(res, 'Failed to create GRN');
		}

export async function createGrnForPo(
  poId: string,
  input: {
    receivedDate: string;
    updatedBy?: string;
    materialReceivedBy?: string | null;
    goodsCollectedBy?: string | null;
    items: Array<{
      itemId: string;
      item?: string;
      quantityReceived: number;
      length?: number;
      breadth?: number;
      pcs?: number;
      inputUnit?: 'ft' | 'm' | string;
      roundOff?: number;
    }>;
  }
) {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/grn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ grn?: any; error?: string }>(res, 'Failed to create GRN');
}

export async function updateGrn(
  grnId: string,
  input: { receivedDate: string; updatedBy?: string; materialReceivedBy?: string | null; goodsCollectedBy?: string | null }
) {
  const res = await fetch(`/api/grns/${encodeURIComponent(grnId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ grn?: any; error?: string }>(res, 'Failed to update GRN');
}

export async function deleteGrn(grnId: string) {
  const res = await fetch(`/api/grns/${encodeURIComponent(grnId)}`, { method: 'DELETE' });
  return requireOk<{ ok?: boolean; error?: string }>(res, 'Failed to delete GRN');
}

export type GrnInvoiceLinkSummaryRow = {
  invoiceItemId: string;
  itemId: string;
  item: string;
  specificationsJson?: string;
  invoiceQty: number;
  receivedQty: number;
  linkedQty: number;
};

export async function fetchGrnInvoiceLinkSummary(invoiceId: string, signal?: AbortSignal): Promise<GrnInvoiceLinkSummaryRow[]> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/grn-link-summary`, { signal });
  const data = await requireOk<{ links?: GrnInvoiceLinkSummaryRow[] }>(res, 'Failed to load GRN link summary');
  return Array.isArray(data.links) ? data.links : [];
}

export async function setGrnInvoiceLinks(
  invoiceId: string,
  input: { updatedBy?: string; links: Array<{ invoiceItemId: string; linkedQty: number }> }
) {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/grn-links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ links?: GrnInvoiceLinkSummaryRow[] }>(res, 'Failed to save GRN linking');
}

export type GrnItemInvoiceLinkSummaryRow = {
  grnItemId: string;
  invoiceId: string;
  invoiceNo: string;
  linkedQty: number;
};

export async function fetchGrnItemInvoiceLinkSummaryByPrId(prId: string, signal?: AbortSignal): Promise<GrnItemInvoiceLinkSummaryRow[]> {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/grn-item-invoice-links`, { signal });
  const data = await requireOk<{ links?: GrnItemInvoiceLinkSummaryRow[] }>(res, 'Failed to load GRN invoice links');
  return Array.isArray(data.links) ? data.links : [];
}

export type GrnItemInvoiceLinkRow = {
  invoiceItemId: string;
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  linkedQty: number;
};

export async function fetchGrnItemInvoiceLinks(grnItemId: string, signal?: AbortSignal): Promise<GrnItemInvoiceLinkRow[]> {
  const res = await fetch(`/api/grn-items/${encodeURIComponent(grnItemId)}/invoice-links`, { signal });
  const data = await requireOk<{ links?: GrnItemInvoiceLinkRow[] }>(res, 'Failed to load GRN item invoice links');
  return Array.isArray(data.links) ? data.links : [];
}

export async function setGrnItemInvoiceLinks(
  grnItemId: string,
  input: { updatedBy?: string; links: Array<{ invoiceItemId: string; linkedQty: number }> }
) {
  const res = await fetch(`/api/grn-items/${encodeURIComponent(grnItemId)}/invoice-links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ links?: GrnItemInvoiceLinkRow[] }>(res, 'Failed to save GRN item invoice links');
}

export type PendingGrnInvoiceLinkCandidateRow = {
  invoiceItemId: string;
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceQty: number;
  alreadyLinkedQty: number;
  pendingLinkingQty: number;
};

export type PendingGrnInvoiceLinkRow = {
  grnItemId: string;
  grnId: string;
  grnNumber: string;
  receivedDate: string;
  poId: string;
  poNumber: string;
  itemId: string;
  item: string;
  unit?: string | null;
  specificationsJson?: string;
  grnQty: number;
  approvedQty: number;
  alreadyLinkQty: number;
  pendingLinkingQty: number;
  candidates: PendingGrnInvoiceLinkCandidateRow[];
};

export async function fetchPendingGrnInvoiceLinks(grnId: string, signal?: AbortSignal): Promise<PendingGrnInvoiceLinkRow[]> {
  const res = await fetch(`/api/grns/${encodeURIComponent(grnId)}/pending-invoice-links`, { signal });
  const data = await requireOk<{ rows?: PendingGrnInvoiceLinkRow[] }>(res, 'Failed to load pending GRN invoice links');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function recordQc(grnId: string, input: { inspectedBy: string; location: string; updatedBy?: string; items: Array<{ itemId: string; item?: string; quantityAccepted: number; quantityRejected: number; remarks: string }> }) {
				  const res = await fetch(`/api/grns/${encodeURIComponent(grnId)}/qc`, {
				    method: 'POST',
				    headers: { 'Content-Type': 'application/json' },
		    body: JSON.stringify(input),
		  });
		  return requireOk<any>(res, 'Failed to record QC');
		}

export async function updateQcForGrn(
  grnId: string,
  input: { inspectedBy: string; location: string; updatedBy?: string; items: Array<{ itemId: string; item?: string; quantityAccepted: number; quantityRejected: number; remarks: string }> }
) {
  const res = await fetch(`/api/grns/${encodeURIComponent(grnId)}/qc`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<any>(res, 'Failed to update QC');
}

export async function deleteQcForGrn(grnId: string, input: { by: string }) {
  const res = await fetch(`/api/grns/${encodeURIComponent(grnId)}/qc`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete QC');
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

export async function fetchWorkflow(prId: string, signal?: AbortSignal, poId?: string): Promise<WorkflowSummary> {
  const q = poId ? `?poId=${encodeURIComponent(poId)}` : '';
  const res = await fetch(`/api/workflow/${encodeURIComponent(prId)}${q}`, { signal });
  const data = await requireOk<{ workflow?: WorkflowSummary }>(res, 'Failed to load workflow');
  if (!data.workflow) throw new Error('Workflow not found');
  return data.workflow;
}

export async function fetchPos(prId: string, signal?: AbortSignal): Promise<Array<{ po: Po; items: PoItem[] }>> {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/pos`, { signal });
  const data = await requireOk<{ pos?: Array<{ po: Po; items: PoItem[] }> }>(res, 'Failed to load POs');
  return Array.isArray(data.pos) ? data.pos : [];
}

export async function updatePo(
  poId: string,
  input: {
    supplierId?: string | null;
    supplier?: string | null;
    paymentTerms: string;
    shippingAddress?: string;
    termsConditions?: string;
    status?: 'Open' | 'Partial' | 'Closed';
    advanceAmount?: number;
    advanceDate?: string | null;
    cancelReason?: string;
    items: Array<{ itemId: string; quantity: number; rate: number; discountPercent?: number; taxPercent?: number }>;
    lineCancels?: Array<{ itemId: string; cancelledQty: number; cancelReason?: string }>;
    updatedBy?: string;
  }
) {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ po?: { po: Po; items: PoItem[] } }>(res, 'Failed to update PO');
}

export async function updatePoCheckAndSent(
  poId: string,
  input: {
    checkPo?: boolean;
    checkPoUserId?: string | null;
    checkDate?: string | null;
    sentBy?: string | null;
    sentDate?: string | null;
    sentProof?: string | null;
    updatedBy?: string;
  }
) {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/check-sent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ po?: { po: Po; items: PoItem[] } }>(res, 'Failed to update PO check/sent');
}

export async function deletePo(poId: string, input?: { deletedBy?: string; cancelReason?: string }) {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete PO');
}

export async function fetchPendingInvoiceItems(poId: string, signal?: AbortSignal): Promise<Array<{ itemId: string; item: string; unit?: string; pendingQty: number; rate: number; dimLength?: number; dimBreadth?: number; dimPcs?: number; dimUnit?: string }>> {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/pending-invoice-items`, { signal });
  const data = await requireOk<{ items?: Array<{ itemId: string; item: string; unit?: string; pendingQty: number; rate: number; dimLength?: number; dimBreadth?: number; dimPcs?: number; dimUnit?: string }> }>(res, 'Failed to load pending invoice items');
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchPendingGrnItems(poId: string, signal?: AbortSignal): Promise<Array<{ itemId: string; item: string; unit?: string; pendingQty: number; rate: number; dimLength?: number; dimBreadth?: number; dimPcs?: number; dimUnit?: string }>> {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/pending-grn-items`, { signal });
  const data = await requireOk<{ items?: Array<{ itemId: string; item: string; unit?: string; pendingQty: number; rate: number; dimLength?: number; dimBreadth?: number; dimPcs?: number; dimUnit?: string }> }>(res, 'Failed to load pending GRN items');
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchGrnsByPoId(poId: string, signal?: AbortSignal): Promise<GrnWithItems[]> {
  const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/grns`, { signal });
  const data = await requireOk<{ grns?: GrnWithItems[] }>(res, 'Failed to load GRNs');
  return Array.isArray(data.grns) ? data.grns : [];
}

export async function fetchGrnsByPrId(prId: string, signal?: AbortSignal): Promise<GrnWithItems[]> {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/grns`, { signal });
  const data = await requireOk<{ grns?: GrnWithItems[] }>(res, 'Failed to load GRNs');
  return Array.isArray(data.grns) ? data.grns : [];
}

export async function fetchPendingGrnPosByPrId(prId: string, signal?: AbortSignal): Promise<Array<{ poId: string; pendingQty: number }>> {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/pending-grn-pos`, { signal });
  const data = await requireOk<{ pos?: Array<{ poId: string; pendingQty: number }> }>(res, 'Failed to load pending GRN POs');
  return Array.isArray(data.pos) ? data.pos : [];
}

export async function fetchQcRecordsByPrId(prId: string, signal?: AbortSignal): Promise<QcRecord[]> {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/qc-records`, { signal });
  const data = await requireOk<{ qc?: QcRecord[] }>(res, 'Failed to load QC records');
  return Array.isArray(data.qc) ? data.qc : [];
}

export async function fetchInvoicesByPrId(prId: string, signal?: AbortSignal): Promise<InvoiceWithItems[]> {
  const res = await fetch(`/api/requests/${encodeURIComponent(prId)}/invoices`, { signal });
  const data = await requireOk<{ invoices?: InvoiceWithItems[] }>(res, 'Failed to load invoices');
  return Array.isArray(data.invoices) ? data.invoices : [];
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
