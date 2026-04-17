import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

export type PrStatus = 'Pending Approval' | 'Approved' | 'Rejected';
export type PoStatus = 'Open' | 'Partial' | 'Closed';
export type InvoiceStatus = 'Recorded' | 'On Hold' | 'Approved' | 'Paid';

export type FirmRow = { id: string; name: string };

export type PrRow = {
  id: string;
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string; // YYYY-MM-DD
  status: PrStatus;
  approver?: string;
  decisionAt?: string; // ISO
  rejectReason?: string;
  createdAt: string; // ISO
};

export type PrItemRow = {
  prId: string;
  item: string;
  quantity: number;
  specification: string;
};

export type PoRow = {
  id: string;
  prId: string;
  supplier: string;
  paymentTerms: string;
  status: PoStatus;
  createdAt: string; // ISO
};

export type PoItemRow = {
  poId: string;
  item: string;
  quantity: number;
  rate: number;
};

export type InvoiceRow = {
  id: string;
  poId: string;
  supplierInvoiceNo: string;
  invoiceDate: string; // YYYY-MM-DD
  status: InvoiceStatus;
  holdReason?: string;
  createdAt: string; // ISO
};

export type InvoiceItemRow = {
  invoiceId: string;
  item: string;
  quantity: number;
  rate: number;
};

export type LogisticsRow = {
  invoiceId: string;
  dispatchProof: string;
  cnOrCourierNo: string;
  transporterName: string;
};

export type GrnRow = {
  id: string;
  poId: string;
  invoiceId: string;
  receivedDate: string; // YYYY-MM-DD
  createdAt: string; // ISO
};

export type GrnItemRow = {
  grnId: string;
  item: string;
  quantityReceived: number;
};

export type QcRow = {
  grnId: string;
  item: string;
  quantityAccepted: number;
  quantityRejected: number;
  remarks: string;
  inspectedBy: string;
  inspectedAt: string; // ISO
  location: string;
};

export type StockLedgerRow = {
  id: string;
  firmId: string;
  location: string;
  item: string;
  quantity: number;
  refType: 'GRN';
  refId: string; // grnId
  postedAt: string; // ISO
};

export type PaymentRow = {
  id: string;
  invoiceId: string;
  paymentDate: string; // YYYY-MM-DD
  amount: number;
  mode: string;
  referenceNo: string;
  createdAt: string; // ISO
};

export type PrWithItems = { pr: PrRow; items: PrItemRow[] };
export type PoWithItems = { po: PoRow; items: PoItemRow[] };
export type InvoiceWithItems = { invoice: InvoiceRow; items: InvoiceItemRow[]; logistics?: LogisticsRow };
export type GrnWithItems = { grn: GrnRow; items: GrnItemRow[] };

export type WorkflowSummary = {
  firm?: FirmRow;
  pr: PrWithItems;
  po?: PoWithItems;
  invoice?: InvoiceWithItems;
  grn?: GrnWithItems;
  qc?: QcRow[];
  payments?: PaymentRow[];
  flags: {
    invoiceRateMismatch: boolean;
    quantityMismatch: boolean;
  };
};

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LEGACY_EXCEL_PATH = path.resolve(DATA_DIR, 'purchase_workflow.xlsx');
const EXCEL_DB_PATH = path.resolve(DATA_DIR, 'purchase_workflow_db.xlsx');

export class ExcelFileLockedError extends Error {
  public readonly code = 'EXCEL_FILE_LOCKED';
  public readonly filePath: string;

  constructor(filePath: string, message?: string) {
    super(
      message ??
        `Excel workbook is locked: "${filePath}". Close it in Excel (or any app) and try again.`
    );
    this.name = 'ExcelFileLockedError';
    this.filePath = filePath;
  }
}

export function isExcelFileLockedError(err: unknown): err is ExcelFileLockedError {
  return Boolean(err && typeof err === 'object' && (err as any).code === 'EXCEL_FILE_LOCKED');
}

const SHEETS = {
  firms: 'Firms',
  prs: 'PRs',
  prItems: 'PR_Items',
  pos: 'POs',
  poItems: 'PO_Items',
  invoices: 'Invoices',
  invoiceItems: 'Invoice_Items',
  logistics: 'Logistics',
  grns: 'GRNs',
  grnItems: 'GRN_Items',
  qc: 'QC',
  stock: 'StockLedger',
  payments: 'Payments',
} as const;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function getExcelPath() {
  return EXCEL_DB_PATH;
}

function readSheet<T>(wb: XLSX.WorkBook, sheetName: string): T[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '' }) as T[];
}

function writeSheet<T>(wb: XLSX.WorkBook, sheetName: string, rows: T[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  wb.Sheets[sheetName] = ws;
  if (!wb.SheetNames.includes(sheetName)) wb.SheetNames.push(sheetName);
}

function loadWorkbook(): XLSX.WorkBook {
  ensureExcelExists();
  return XLSX.readFile(EXCEL_DB_PATH);
}

function isBusyFsError(e: unknown) {
  const code = String((e as any)?.code ?? '');
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

function saveWorkbookToPath(wb: XLSX.WorkBook, targetPath: string) {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp.xlsx`;
  try {
    XLSX.writeFile(wb, tmpPath);
    fs.copyFileSync(tmpPath, targetPath);
  } catch (e) {
    if (isBusyFsError(e)) {
      throw new ExcelFileLockedError(
        targetPath,
        `Excel workbook is busy/locked: "${targetPath}". Close it in Excel and try again.`
      );
    }
    throw e;
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

function saveWorkbook(wb: XLSX.WorkBook) {
  saveWorkbookToPath(wb, EXCEL_DB_PATH);
}

export function ensureExcelExists() {
  ensureDataDir();
  if (fs.existsSync(EXCEL_DB_PATH)) return;

  // Migrate legacy workbook (older path) if present.
  if (fs.existsSync(LEGACY_EXCEL_PATH)) {
    try {
      const legacyWb = XLSX.readFile(LEGACY_EXCEL_PATH);
      saveWorkbookToPath(legacyWb, EXCEL_DB_PATH);
      return;
    } catch (e) {
      if (isBusyFsError(e)) throw new ExcelFileLockedError(LEGACY_EXCEL_PATH);
      // If legacy read fails, fall through and create a fresh workbook.
    }
  }

  const nowIso = new Date().toISOString();
  const firms: FirmRow[] = [
    { id: 'FIRM-1', name: 'Umang (Main)' },
    { id: 'FIRM-2', name: 'Umang (Project)' },
  ];

  const prs: PrRow[] = [
    {
      id: '#PR-2023-0842',
      firmId: 'FIRM-1',
      department: 'Research & Development',
      requestedBy: 'Sarah Jenkins',
      requiredDate: '2023-10-31',
      status: 'Approved',
      approver: 'Dept Head',
      decisionAt: nowIso,
      createdAt: nowIso,
    },
    {
      id: '#PR-2023-0841',
      firmId: 'FIRM-1',
      department: 'Global Logistics',
      requestedBy: 'Michael Kloss',
      requiredDate: '2023-10-29',
      status: 'Pending Approval',
      createdAt: nowIso,
    },
  ];

  const prItems: PrItemRow[] = [
    { prId: '#PR-2023-0842', item: 'Laptop', quantity: 2, specification: '16GB RAM, 512GB SSD' },
    { prId: '#PR-2023-0842', item: 'Monitor', quantity: 2, specification: '27-inch IPS' },
    { prId: '#PR-2023-0841', item: 'Packaging Boxes', quantity: 100, specification: 'Double-wall carton' },
  ];

  const wb = XLSX.utils.book_new();
  writeSheet(wb, SHEETS.firms, firms);
  writeSheet(wb, SHEETS.prs, prs);
  writeSheet(wb, SHEETS.prItems, prItems);
  writeSheet(wb, SHEETS.pos, []);
  writeSheet(wb, SHEETS.poItems, []);
  writeSheet(wb, SHEETS.invoices, []);
  writeSheet(wb, SHEETS.invoiceItems, []);
  writeSheet(wb, SHEETS.logistics, []);
  writeSheet(wb, SHEETS.grns, []);
  writeSheet(wb, SHEETS.grnItems, []);
  writeSheet(wb, SHEETS.qc, []);
  writeSheet(wb, SHEETS.stock, []);
  writeSheet(wb, SHEETS.payments, []);
  saveWorkbook(wb);
}

function nextId(prefix: string, existing: string[], now = new Date(), digits = 4) {
  const year = String(now.getFullYear());
  const regex = new RegExp(`^#${prefix}-(\\d{4})-(\\d{${digits}})$`);
  const maxForYear = existing
    .map((id) => regex.exec(id))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .filter((m) => m[1] === year)
    .map((m) => Number(m[2]))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  const seq = String(maxForYear + 1).padStart(digits, '0');
  return `#${prefix}-${year}-${seq}`;
}

export function listFirms(): FirmRow[] {
  const wb = loadWorkbook();
  return readSheet<FirmRow>(wb, SHEETS.firms).map((f) => ({
    id: String((f as any).id ?? '').trim(),
    name: String((f as any).name ?? '').trim(),
  })).filter((f) => f.id && f.name);
}

export function listPrs(): PrRow[] {
  const wb = loadWorkbook();
  return readSheet<any>(wb, SHEETS.prs).map((r) => ({
    id: String(r.id ?? '').trim(),
    firmId: String(r.firmId ?? '').trim(),
    department: String(r.department ?? '').trim(),
    requestedBy: String(r.requestedBy ?? '').trim(),
    requiredDate: String(r.requiredDate ?? '').trim(),
    status: (String(r.status ?? 'Pending Approval').trim() as PrStatus) || 'Pending Approval',
    approver: r.approver ? String(r.approver).trim() : undefined,
    decisionAt: r.decisionAt ? String(r.decisionAt).trim() : undefined,
    rejectReason: r.rejectReason ? String(r.rejectReason).trim() : undefined,
    createdAt: String(r.createdAt ?? '').trim(),
  })).filter((r) => r.id);
}

export function getPr(id: string): PrWithItems | null {
  const wb = loadWorkbook();
  const prs = readSheet<any>(wb, SHEETS.prs);
  const prRaw = prs.find((r) => String(r.id).trim() === id);
  if (!prRaw) return null;
  const pr = {
    id: String(prRaw.id ?? '').trim(),
    firmId: String(prRaw.firmId ?? '').trim(),
    department: String(prRaw.department ?? '').trim(),
    requestedBy: String(prRaw.requestedBy ?? '').trim(),
    requiredDate: String(prRaw.requiredDate ?? '').trim(),
    status: String(prRaw.status ?? 'Pending Approval').trim() as PrStatus,
    approver: prRaw.approver ? String(prRaw.approver).trim() : undefined,
    decisionAt: prRaw.decisionAt ? String(prRaw.decisionAt).trim() : undefined,
    rejectReason: prRaw.rejectReason ? String(prRaw.rejectReason).trim() : undefined,
    createdAt: String(prRaw.createdAt ?? '').trim(),
  } satisfies PrRow;

  const items = readSheet<any>(wb, SHEETS.prItems)
    .filter((it) => String(it.prId ?? '').trim() === id)
    .map((it) => ({
      prId: id,
      item: String(it.item ?? '').trim(),
      quantity: Number(it.quantity ?? 0),
      specification: String(it.specification ?? '').trim(),
    }))
    .filter((it) => it.item && Number.isFinite(it.quantity));

  return { pr, items };
}

export function createPr(input: {
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string;
  items: Array<{ item: string; quantity: number; specification: string }>;
}): PrWithItems {
  const wb = loadWorkbook();
  const prs = readSheet<any>(wb, SHEETS.prs);
  const prIds = prs.map((r) => String(r.id ?? '').trim()).filter(Boolean);
  const id = nextId('PR', prIds);
  const now = new Date();

  const pr: PrRow = {
    id,
    firmId: input.firmId.trim(),
    department: input.department.trim(),
    requestedBy: input.requestedBy.trim(),
    requiredDate: input.requiredDate.trim(),
    status: 'Pending Approval',
    createdAt: now.toISOString(),
  };

  const items: PrItemRow[] = input.items.map((it) => ({
    prId: id,
    item: it.item.trim(),
    quantity: it.quantity,
    specification: it.specification.trim(),
  }));

  const nextPrs = [...prs, pr];
  const prItems = readSheet<any>(wb, SHEETS.prItems);
  const nextItems = [...prItems, ...items];

  writeSheet(wb, SHEETS.prs, nextPrs);
  writeSheet(wb, SHEETS.prItems, nextItems);
  saveWorkbook(wb);

  return { pr, items };
}

export function decidePr(input: { prId: string; decision: 'approve' | 'reject'; approver: string; rejectReason?: string }) {
  const wb = loadWorkbook();
  const prs = readSheet<any>(wb, SHEETS.prs);
  const idx = prs.findIndex((r) => String(r.id ?? '').trim() === input.prId);
  if (idx < 0) throw new Error('PR not found');
  const currentStatus = String(prs[idx].status ?? 'Pending Approval').trim() as PrStatus;
  if (currentStatus !== 'Pending Approval') throw new Error(`PR already ${currentStatus}`);

  const decisionAt = new Date().toISOString();
  const status: PrStatus = input.decision === 'approve' ? 'Approved' : 'Rejected';
  prs[idx] = {
    ...prs[idx],
    status,
    approver: input.approver,
    decisionAt,
    rejectReason: input.decision === 'reject' ? (input.rejectReason ?? '') : '',
  };

  writeSheet(wb, SHEETS.prs, prs);
  saveWorkbook(wb);
  return getPr(input.prId);
}

function getPoByPrId(wb: XLSX.WorkBook, prId: string): PoRow | null {
  const pos = readSheet<any>(wb, SHEETS.pos);
  const raw = pos.find((p) => String(p.prId ?? '').trim() === prId);
  if (!raw) return null;
  return {
    id: String(raw.id ?? '').trim(),
    prId: String(raw.prId ?? '').trim(),
    supplier: String(raw.supplier ?? '').trim(),
    paymentTerms: String(raw.paymentTerms ?? '').trim(),
    status: String(raw.status ?? 'Open').trim() as PoStatus,
    createdAt: String(raw.createdAt ?? '').trim(),
  };
}

export function createPoFromPr(input: {
  prId: string;
  supplier: string;
  paymentTerms: string;
  items: Array<{ item: string; quantity: number; rate: number }>;
}): PoWithItems {
  const wb = loadWorkbook();
  const pr = getPr(input.prId);
  if (!pr) throw new Error('PR not found');
  if (pr.pr.status !== 'Approved') throw new Error('PR must be Approved to create PO');

  const existingPo = getPoByPrId(wb, input.prId);
  if (existingPo) throw new Error('PO already exists for this PR');

  const pos = readSheet<any>(wb, SHEETS.pos);
  const poIds = pos.map((p) => String(p.id ?? '').trim()).filter(Boolean);
  const id = nextId('PO', poIds);
  const now = new Date().toISOString();

  const po: PoRow = {
    id,
    prId: input.prId,
    supplier: input.supplier.trim(),
    paymentTerms: input.paymentTerms.trim(),
    status: 'Open',
    createdAt: now,
  };

  const poItems: PoItemRow[] = input.items.map((it) => ({
    poId: id,
    item: it.item.trim(),
    quantity: it.quantity,
    rate: it.rate,
  }));

  const allPoItems = readSheet<any>(wb, SHEETS.poItems);
  writeSheet(wb, SHEETS.pos, [...pos, po]);
  writeSheet(wb, SHEETS.poItems, [...allPoItems, ...poItems]);
  saveWorkbook(wb);

  return { po, items: poItems };
}

function getPoWithItems(wb: XLSX.WorkBook, poId: string): PoWithItems | null {
  const pos = readSheet<any>(wb, SHEETS.pos);
  const raw = pos.find((p) => String(p.id ?? '').trim() === poId);
  if (!raw) return null;
  const po: PoRow = {
    id: String(raw.id ?? '').trim(),
    prId: String(raw.prId ?? '').trim(),
    supplier: String(raw.supplier ?? '').trim(),
    paymentTerms: String(raw.paymentTerms ?? '').trim(),
    status: String(raw.status ?? 'Open').trim() as PoStatus,
    createdAt: String(raw.createdAt ?? '').trim(),
  };
  const items = readSheet<any>(wb, SHEETS.poItems)
    .filter((it) => String(it.poId ?? '').trim() === poId)
    .map((it) => ({
      poId,
      item: String(it.item ?? '').trim(),
      quantity: Number(it.quantity ?? 0),
      rate: Number(it.rate ?? 0),
    }))
    .filter((it) => it.item && Number.isFinite(it.quantity) && Number.isFinite(it.rate));
  return { po, items };
}

function getPoRowById(wb: XLSX.WorkBook, poId: string): PoRow | null {
  const pos = readSheet<any>(wb, SHEETS.pos);
  const raw = pos.find((p) => String(p.id ?? '').trim() === poId);
  if (!raw) return null;
  return {
    id: String(raw.id ?? '').trim(),
    prId: String(raw.prId ?? '').trim(),
    supplier: String(raw.supplier ?? '').trim(),
    paymentTerms: String(raw.paymentTerms ?? '').trim(),
    status: String(raw.status ?? 'Open').trim() as PoStatus,
    createdAt: String(raw.createdAt ?? '').trim(),
  };
}

function getInvoiceByPoId(wb: XLSX.WorkBook, poId: string): InvoiceRow | null {
  const invoices = readSheet<any>(wb, SHEETS.invoices);
  const raw = invoices.find((i) => String(i.poId ?? '').trim() === poId);
  if (!raw) return null;
  return {
    id: String(raw.id ?? '').trim(),
    poId: String(raw.poId ?? '').trim(),
    supplierInvoiceNo: String(raw.supplierInvoiceNo ?? '').trim(),
    invoiceDate: String(raw.invoiceDate ?? '').trim(),
    status: String(raw.status ?? 'Recorded').trim() as InvoiceStatus,
    holdReason: raw.holdReason ? String(raw.holdReason).trim() : undefined,
    createdAt: String(raw.createdAt ?? '').trim(),
  };
}

function getInvoiceWithItems(wb: XLSX.WorkBook, invoiceId: string): InvoiceWithItems | null {
  const invoices = readSheet<any>(wb, SHEETS.invoices);
  const raw = invoices.find((i) => String(i.id ?? '').trim() === invoiceId);
  if (!raw) return null;
  const invoice: InvoiceRow = {
    id: String(raw.id ?? '').trim(),
    poId: String(raw.poId ?? '').trim(),
    supplierInvoiceNo: String(raw.supplierInvoiceNo ?? '').trim(),
    invoiceDate: String(raw.invoiceDate ?? '').trim(),
    status: String(raw.status ?? 'Recorded').trim() as InvoiceStatus,
    holdReason: raw.holdReason ? String(raw.holdReason).trim() : undefined,
    createdAt: String(raw.createdAt ?? '').trim(),
  };
  const items = readSheet<any>(wb, SHEETS.invoiceItems)
    .filter((it) => String(it.invoiceId ?? '').trim() === invoiceId)
    .map((it) => ({
      invoiceId,
      item: String(it.item ?? '').trim(),
      quantity: Number(it.quantity ?? 0),
      rate: Number(it.rate ?? 0),
    }))
    .filter((it) => it.item && Number.isFinite(it.quantity) && Number.isFinite(it.rate));
  const logisticsRaw = readSheet<any>(wb, SHEETS.logistics).find((l) => String(l.invoiceId ?? '').trim() === invoiceId);
  const logistics: LogisticsRow | undefined = logisticsRaw
    ? {
        invoiceId,
        dispatchProof: String(logisticsRaw.dispatchProof ?? '').trim(),
        cnOrCourierNo: String(logisticsRaw.cnOrCourierNo ?? '').trim(),
        transporterName: String(logisticsRaw.transporterName ?? '').trim(),
      }
    : undefined;
  return { invoice, items, logistics };
}

export function createInvoice(input: {
  poId: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  items: Array<{ item: string; quantity: number; rate: number }>;
}): InvoiceWithItems {
  const wb = loadWorkbook();
  const po = getPoWithItems(wb, input.poId);
  if (!po) throw new Error('PO not found');

  const existing = getInvoiceByPoId(wb, input.poId);
  if (existing) throw new Error('Invoice already exists for this PO');

  const invoices = readSheet<any>(wb, SHEETS.invoices);
  const invoiceIds = invoices.map((i) => String(i.id ?? '').trim()).filter(Boolean);
  const id = nextId('INV', invoiceIds);
  const now = new Date().toISOString();

  const invoice: InvoiceRow = {
    id,
    poId: input.poId,
    supplierInvoiceNo: input.supplierInvoiceNo.trim(),
    invoiceDate: input.invoiceDate.trim(),
    status: 'Recorded',
    createdAt: now,
  };

  const invItems: InvoiceItemRow[] = input.items.map((it) => ({
    invoiceId: id,
    item: it.item.trim(),
    quantity: it.quantity,
    rate: it.rate,
  }));

  const allInvItems = readSheet<any>(wb, SHEETS.invoiceItems);
  writeSheet(wb, SHEETS.invoices, [...invoices, invoice]);
  writeSheet(wb, SHEETS.invoiceItems, [...allInvItems, ...invItems]);
  saveWorkbook(wb);

  return { invoice, items: invItems };
}

export function upsertLogistics(input: LogisticsRow) {
  const wb = loadWorkbook();
  const logistics = readSheet<any>(wb, SHEETS.logistics);
  const idx = logistics.findIndex((l) => String(l.invoiceId ?? '').trim() === input.invoiceId);
  const row = {
    invoiceId: input.invoiceId,
    dispatchProof: input.dispatchProof.trim(),
    cnOrCourierNo: input.cnOrCourierNo.trim(),
    transporterName: input.transporterName.trim(),
  } satisfies LogisticsRow;
  if (idx >= 0) logistics[idx] = row;
  else logistics.push(row);
  writeSheet(wb, SHEETS.logistics, logistics);
  saveWorkbook(wb);
  return row;
}

function getGrnByInvoiceId(wb: XLSX.WorkBook, invoiceId: string): GrnRow | null {
  const grns = readSheet<any>(wb, SHEETS.grns);
  const raw = grns.find((g) => String(g.invoiceId ?? '').trim() === invoiceId);
  if (!raw) return null;
  return {
    id: String(raw.id ?? '').trim(),
    poId: String(raw.poId ?? '').trim(),
    invoiceId: String(raw.invoiceId ?? '').trim(),
    receivedDate: String(raw.receivedDate ?? '').trim(),
    createdAt: String(raw.createdAt ?? '').trim(),
  };
}

function getGrnWithItems(wb: XLSX.WorkBook, grnId: string): GrnWithItems | null {
  const grns = readSheet<any>(wb, SHEETS.grns);
  const raw = grns.find((g) => String(g.id ?? '').trim() === grnId);
  if (!raw) return null;
  const grn: GrnRow = {
    id: String(raw.id ?? '').trim(),
    poId: String(raw.poId ?? '').trim(),
    invoiceId: String(raw.invoiceId ?? '').trim(),
    receivedDate: String(raw.receivedDate ?? '').trim(),
    createdAt: String(raw.createdAt ?? '').trim(),
  };
  const items = readSheet<any>(wb, SHEETS.grnItems)
    .filter((it) => String(it.grnId ?? '').trim() === grnId)
    .map((it) => ({
      grnId,
      item: String(it.item ?? '').trim(),
      quantityReceived: Number(it.quantityReceived ?? 0),
    }))
    .filter((it) => it.item && Number.isFinite(it.quantityReceived));
  return { grn, items };
}

export function createGrn(input: { invoiceId: string; receivedDate: string; items: Array<{ item: string; quantityReceived: number }> }): GrnWithItems {
  const wb = loadWorkbook();
  const invoice = getInvoiceWithItems(wb, input.invoiceId);
  if (!invoice) throw new Error('Invoice not found');
  const po = getPoWithItems(wb, invoice.invoice.poId);
  if (!po) throw new Error('PO not found');

  const existing = getGrnByInvoiceId(wb, input.invoiceId);
  if (existing) throw new Error('GRN already exists for this Invoice');

  const poQtyByItem = new Map(po.items.map((it) => [it.item, it.quantity]));
  for (const line of input.items) {
    const ordered = poQtyByItem.get(line.item) ?? 0;
    if (line.quantityReceived > ordered) throw new Error(`Received qty exceeds ordered qty for ${line.item}`);
  }

  const grns = readSheet<any>(wb, SHEETS.grns);
  const grnIds = grns.map((g) => String(g.id ?? '').trim()).filter(Boolean);
  const id = nextId('GRN', grnIds);
  const now = new Date().toISOString();

  const grn: GrnRow = {
    id,
    poId: po.po.id,
    invoiceId: input.invoiceId,
    receivedDate: input.receivedDate.trim(),
    createdAt: now,
  };

  const items: GrnItemRow[] = input.items.map((it) => ({
    grnId: id,
    item: it.item.trim(),
    quantityReceived: it.quantityReceived,
  }));

  const allGrnItems = readSheet<any>(wb, SHEETS.grnItems);
  writeSheet(wb, SHEETS.grns, [...grns, grn]);
  writeSheet(wb, SHEETS.grnItems, [...allGrnItems, ...items]);
  saveWorkbook(wb);
  return { grn, items };
}

export function recordQc(input: {
  grnId: string;
  inspectedBy: string;
  location: string;
  items: Array<{ item: string; quantityAccepted: number; quantityRejected: number; remarks: string }>;
}) {
  const wb = loadWorkbook();
  const grn = getGrnWithItems(wb, input.grnId);
  if (!grn) throw new Error('GRN not found');

  const poRow = getPoRowById(wb, grn.grn.poId);
  const pr = poRow ? getPr(poRow.prId) : null;
  const po = getPoWithItems(wb, grn.grn.poId);
  if (!po) throw new Error('PO not found');

  const receivedByItem = new Map(grn.items.map((it) => [it.item, it.quantityReceived]));
  const now = new Date().toISOString();

  const qcRows: QcRow[] = input.items.map((it) => {
    const received = receivedByItem.get(it.item) ?? 0;
    if (it.quantityAccepted + it.quantityRejected > received) throw new Error(`QC qty exceeds received qty for ${it.item}`);
    return {
      grnId: input.grnId,
      item: it.item.trim(),
      quantityAccepted: it.quantityAccepted,
      quantityRejected: it.quantityRejected,
      remarks: it.remarks.trim(),
      inspectedBy: input.inspectedBy.trim(),
      inspectedAt: now,
      location: input.location.trim(),
    };
  });

  const qcs = readSheet<any>(wb, SHEETS.qc).filter((r) => String(r.grnId ?? '').trim() !== input.grnId);
  writeSheet(wb, SHEETS.qc, [...qcs, ...qcRows]);

  const stock = readSheet<any>(wb, SHEETS.stock);
  const stockIds = stock.map((s) => String(s.id ?? '').trim()).filter(Boolean);
  const firmId = pr?.pr.firmId ?? '';
  const newStock: StockLedgerRow[] = [];
  let idPool = stockIds.slice();
  for (const r of qcRows) {
    if (r.quantityAccepted <= 0) continue;
    const id = nextId('STK', idPool, new Date(), 6);
    idPool = idPool.concat([id]);
    newStock.push({
      id,
      firmId,
      location: input.location.trim(),
      item: r.item,
      quantity: r.quantityAccepted,
      refType: 'GRN',
      refId: input.grnId,
      postedAt: now,
    });
  }

  writeSheet(wb, SHEETS.stock, [...stock, ...newStock]);

  // Update PO status based on accepted quantity vs ordered quantity (simple close/partial rule).
  const acceptedByItem = new Map<string, number>();
  const allQc = readSheet<any>(wb, SHEETS.qc).filter((r) => String(r.grnId ?? '').trim() === input.grnId);
  for (const r of allQc) {
    const item = String(r.item ?? '').trim();
    const qty = Number(r.quantityAccepted ?? 0);
    acceptedByItem.set(item, (acceptedByItem.get(item) ?? 0) + (Number.isFinite(qty) ? qty : 0));
  }
  const isClosed = po.items.every((it) => (acceptedByItem.get(it.item) ?? 0) >= it.quantity);
  const nextPoStatus: PoStatus = isClosed ? 'Closed' : 'Partial';
  const pos = readSheet<any>(wb, SHEETS.pos);
  const poIdx = pos.findIndex((p) => String(p.id ?? '').trim() === po.po.id);
  if (poIdx >= 0) {
    pos[poIdx] = { ...pos[poIdx], status: nextPoStatus };
    writeSheet(wb, SHEETS.pos, pos);
  }

  saveWorkbook(wb);
  return { qc: qcRows, stockPosted: newStock };
}

export function approveInvoice(invoiceId: string) {
  const wb = loadWorkbook();
  const invoice = getInvoiceWithItems(wb, invoiceId);
  if (!invoice) throw new Error('Invoice not found');
  const po = getPoWithItems(wb, invoice.invoice.poId);
  if (!po) throw new Error('PO not found');
  const grn = getGrnByInvoiceId(wb, invoiceId);
  const grnWithItems = grn ? getGrnWithItems(wb, grn.id) : null;

  const poByItem = new Map(po.items.map((it) => [it.item, it]));
  const receivedByItem = new Map((grnWithItems?.items ?? []).map((it) => [it.item, it.quantityReceived]));

  const mismatches: string[] = [];
  for (const it of invoice.items) {
    const poIt = poByItem.get(it.item);
    if (!poIt) mismatches.push(`Item not found on PO: ${it.item}`);
    else if (Number(poIt.rate) !== Number(it.rate)) mismatches.push(`Rate mismatch for ${it.item} (PO ${poIt.rate} vs INV ${it.rate})`);
    const received = receivedByItem.get(it.item) ?? 0;
    if (received < it.quantity) mismatches.push(`Received qty less than invoice qty for ${it.item} (GRN ${received} vs INV ${it.quantity})`);
    if (poIt && it.quantity > poIt.quantity) mismatches.push(`Invoice qty exceeds ordered qty for ${it.item} (PO ${poIt.quantity} vs INV ${it.quantity})`);
  }

  const invoices = readSheet<any>(wb, SHEETS.invoices);
  const idx = invoices.findIndex((i) => String(i.id ?? '').trim() === invoiceId);
  if (idx < 0) throw new Error('Invoice not found');

  if (mismatches.length) {
    invoices[idx] = { ...invoices[idx], status: 'On Hold', holdReason: mismatches.join('; ') };
  } else {
    invoices[idx] = { ...invoices[idx], status: 'Approved', holdReason: '' };
  }
  writeSheet(wb, SHEETS.invoices, invoices);
  saveWorkbook(wb);
  return { status: invoices[idx].status as InvoiceStatus, mismatches };
}

export function payInvoice(input: { invoiceId: string; paymentDate: string; amount: number; mode: string; referenceNo: string }) {
  const wb = loadWorkbook();
  const invoices = readSheet<any>(wb, SHEETS.invoices);
  const idx = invoices.findIndex((i) => String(i.id ?? '').trim() === input.invoiceId);
  if (idx < 0) throw new Error('Invoice not found');
  const status = String(invoices[idx].status ?? 'Recorded').trim() as InvoiceStatus;
  if (status !== 'Approved') throw new Error('Invoice must be Approved before payment');

  const payments = readSheet<any>(wb, SHEETS.payments);
  const payIds = payments.map((p) => String(p.id ?? '').trim()).filter(Boolean);
  const id = nextId('PAY', payIds);
  const now = new Date().toISOString();
  const row: PaymentRow = {
    id,
    invoiceId: input.invoiceId,
    paymentDate: input.paymentDate.trim(),
    amount: input.amount,
    mode: input.mode.trim(),
    referenceNo: input.referenceNo.trim(),
    createdAt: now,
  };

  writeSheet(wb, SHEETS.payments, [...payments, row]);
  invoices[idx] = { ...invoices[idx], status: 'Paid' };
  writeSheet(wb, SHEETS.invoices, invoices);
  saveWorkbook(wb);
  return row;
}

export function getWorkflow(prId: string): WorkflowSummary {
  const wb = loadWorkbook();
  const pr = getPr(prId);
  if (!pr) throw new Error('PR not found');
  const firm = listFirms().find((f) => f.id === pr.pr.firmId);

  const po = getPoByPrId(wb, prId);
  const poWithItems = po ? getPoWithItems(wb, po.id) ?? undefined : undefined;

  const invoice = po ? getInvoiceByPoId(wb, po.id) : null;
  const invoiceWithItems = invoice ? getInvoiceWithItems(wb, invoice.id) ?? undefined : undefined;

  const grn = invoice ? getGrnByInvoiceId(wb, invoice.id) : null;
  const grnWithItems = grn ? getGrnWithItems(wb, grn.id) ?? undefined : undefined;

  const qcRows = grn
    ? readSheet<any>(wb, SHEETS.qc)
        .filter((r) => String(r.grnId ?? '').trim() === grn.id)
        .map((r) => ({
          grnId: grn.id,
          item: String(r.item ?? '').trim(),
          quantityAccepted: Number(r.quantityAccepted ?? 0),
          quantityRejected: Number(r.quantityRejected ?? 0),
          remarks: String(r.remarks ?? '').trim(),
          inspectedBy: String(r.inspectedBy ?? '').trim(),
          inspectedAt: String(r.inspectedAt ?? '').trim(),
          location: String(r.location ?? '').trim(),
        }))
    : undefined;

  const payments = invoice
    ? readSheet<any>(wb, SHEETS.payments)
        .filter((p) => String(p.invoiceId ?? '').trim() === invoice.id)
        .map((p) => ({
          id: String(p.id ?? '').trim(),
          invoiceId: String(p.invoiceId ?? '').trim(),
          paymentDate: String(p.paymentDate ?? '').trim(),
          amount: Number(p.amount ?? 0),
          mode: String(p.mode ?? '').trim(),
          referenceNo: String(p.referenceNo ?? '').trim(),
          createdAt: String(p.createdAt ?? '').trim(),
        }))
    : undefined;

  const invoiceRateMismatch = Boolean(
    invoiceWithItems &&
      poWithItems &&
      invoiceWithItems.items.some((it) => {
        const poLine = poWithItems.items.find((p) => p.item === it.item);
        return poLine ? Number(poLine.rate) !== Number(it.rate) : true;
      })
  );

  const quantityMismatch = Boolean(
    invoiceWithItems &&
      poWithItems &&
      grnWithItems &&
      invoiceWithItems.items.some((it) => {
        const poLine = poWithItems.items.find((p) => p.item === it.item);
        const grnLine = grnWithItems.items.find((g) => g.item === it.item);
        if (!poLine) return true;
        if (it.quantity > poLine.quantity) return true;
        return (grnLine?.quantityReceived ?? 0) < it.quantity;
      })
  );

  return {
    firm,
    pr,
    po: poWithItems,
    invoice: invoiceWithItems,
    grn: grnWithItems,
    qc: qcRows,
    payments,
    flags: { invoiceRateMismatch, quantityMismatch },
  };
}

// Backwards compatible helpers for the existing UI naming
export type RequestStatus = PrStatus;
export type PurchaseRequestRow = {
  id: string;
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string;
  status: PrStatus;
};

export function readRequests(): PurchaseRequestRow[] {
  return listPrs().map((p) => ({
    id: p.id,
    firmId: p.firmId,
    department: p.department,
    requestedBy: p.requestedBy,
    requiredDate: p.requiredDate,
    status: p.status,
  }));
}

export function findRequest(id: string) {
  const pr = getPr(id);
  if (!pr) return null;
  return {
    id: pr.pr.id,
    firmId: pr.pr.firmId,
    department: pr.pr.department,
    requestedBy: pr.pr.requestedBy,
    requiredDate: pr.pr.requiredDate,
    status: pr.pr.status,
  } satisfies PurchaseRequestRow;
}

export function createRequest(input: {
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string;
  items: Array<{ item: string; quantity: number; specification: string }>;
}) {
  return createPr(input);
}
