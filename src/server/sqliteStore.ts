import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { getDb, type Db } from '../../server/db';

export type PrStatus = 'Pending Approval' | 'Approved' | 'Rejected';
export type PoStatus = 'Open' | 'Partial' | 'Closed';
export type InvoiceStatus = 'Recorded' | 'On Hold' | 'Approved' | 'Paid';

export type FirmRow = { id: string; name: string };

export type PrRow = {
  id: string;
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string;
  status: PrStatus;
};

export type PrItemRow = {
  prId: string;
  itemId: string;
  item: string;
  quantity: number;
  specification: string;
};

export type PrWithItems = { pr: PrRow; items: PrItemRow[] };

export type PoRow = {
  id: string;
  prId: string;
  supplier: string;
  paymentTerms: string;
  status: PoStatus;
  createdAt: string;
};

export type PoItemRow = {
  poId: string;
  itemId: string;
  item: string;
  quantity: number;
  rate: number;
};

export type PoWithItems = { po: PoRow; items: PoItemRow[] };

export type LogisticsRow = {
  invoiceId: string;
  dispatchProof: string;
  cnOrCourierNo: string;
  transporterName: string;
};

export type InvoiceRow = {
  id: string;
  poId: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  status: InvoiceStatus;
  holdReason?: string;
  createdAt: string;
};

export type InvoiceItemRow = {
  invoiceId: string;
  item: string;
  quantity: number;
  rate: number;
};

export type InvoiceWithItems = { invoice: InvoiceRow; items: InvoiceItemRow[]; logistics?: LogisticsRow };

export type GrnRow = {
  id: string;
  poId: string;
  invoiceId: string;
  receivedDate: string;
  createdAt: string;
};

export type GrnItemRow = { grnId: string; item: string; quantityReceived: number };
export type GrnWithItems = { grn: GrnRow; items: GrnItemRow[] };

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

export type PaymentRow = {
  id: string;
  invoiceId: string;
  paymentDate: string;
  amount: number;
  mode: string;
  referenceNo: string;
  createdAt: string;
};

export type WorkflowSummary = {
  firm?: FirmRow;
  pr: PrWithItems;
  po?: PoWithItems;
  invoice?: InvoiceWithItems;
  grn?: GrnWithItems;
  qc?: QcRow[];
  payments?: PaymentRow[];
  flags: { invoiceRateMismatch: boolean; quantityMismatch: boolean };
};

let initPromise: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function migrationsDir() {
  return path.resolve(process.cwd(), 'server', 'migrations');
}

async function ensureMigrationsTable(db: Db) {
  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
}

async function applyMigrations(db: Db) {
  await ensureMigrationsTable(db);
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const id = file.replace(/\.sql$/i, '');
    const existing = await db.get<{ id: string }>('SELECT id FROM migrations WHERE id = ?', id);
    if (existing?.id) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const now = nowIso();
    await db.exec('BEGIN');
    try {
      await db.exec(sql);
      await db.run('INSERT INTO migrations (id, name, applied_at) VALUES (?,?,?)', id, file, now);
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }
}

async function seedIfEmpty(db: Db) {
  const row = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM firms');
  if ((row?.count ?? 0) > 0) return;

  const now = nowIso();
  const seedUser = 'system';

  await db.exec('BEGIN');
  try {
    await db.run(
      `INSERT INTO firms (id, name, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?)`,
      'FIRM-1',
      'Umang (Main)',
      seedUser,
      now,
      seedUser,
      now
    );
    await db.run(
      `INSERT INTO firms (id, name, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?)`,
      'FIRM-2',
      'Umang (Project)',
      seedUser,
      now,
      seedUser,
      now
    );
    await db.run(
      `INSERT INTO stores (id, firm_id, name, location, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      'STORE-1',
      'FIRM-1',
      'Main Store',
      'Head Office',
      seedUser,
      now,
      seedUser,
      now
    );
    await db.run(
      `INSERT INTO stores (id, firm_id, name, location, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      'STORE-2',
      'FIRM-2',
      'Project Store',
      'Site',
      seedUser,
      now,
      seedUser,
      now
    );
    await db.run(
      `INSERT INTO users (id, name, role, email, is_active, created_at) VALUES (?,?,?,?,?,?)`,
      'USER-1',
      'Alex Thompson',
      'employee',
      'alex@example.com',
      1,
      now
    );
    await db.run(
      `INSERT INTO users (id, name, role, email, is_active, created_at) VALUES (?,?,?,?,?,?)`,
      'USER-2',
      'Dept Head',
      'approver',
      'head@example.com',
      1,
      now
    );
    await db.run(
      `INSERT INTO users (id, name, role, email, is_active, created_at) VALUES (?,?,?,?,?,?)`,
      'USER-6',
      'Accounts Team',
      'accounts',
      'accounts@example.com',
      1,
      now
    );
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

async function initDb() {
  if (!initPromise) {
    initPromise = (async () => {
      const db = await getDb();
      await applyMigrations(db);
      await seedIfEmpty(db);
    })();
  }
  return initPromise;
}

function normalizeSpecLines(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((s) => String(s ?? '')).map((s) => s.trim()).filter(Boolean);
  const s = String(input ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!s) return [];
  return s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

function specsToJson(specLines: string[]) {
  const obj: Record<string, string> = {};
  specLines.forEach((line, idx) => {
    const m = line.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (m) {
      const name = m[1]!.trim();
      const value = m[2]!.trim();
      if (name) obj[name] = value;
      return;
    }
    obj[`spec_${idx + 1}`] = line;
  });
  return obj;
}

function computeUniqueKey(itemName: string, specObj: Record<string, string>) {
  const normalizedName = itemName.trim().toLowerCase();
  const parts = Object.keys(specObj)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k.trim().toLowerCase()}=${String(specObj[k] ?? '').trim().toLowerCase()}`);
  const raw = [normalizedName, ...parts].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function ensureStoreForFirm(db: Db, firmId: string) {
  const existing = await db.get<{ id: string }>('SELECT id FROM stores WHERE firm_id = ? ORDER BY created_at ASC LIMIT 1', firmId);
  if (existing?.id) return existing.id;
  const id = `STORE-${crypto.randomUUID()}`;
  const now = nowIso();
  await db.run(
    `INSERT INTO stores (id, firm_id, name, location, created_by, created_at, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id,
    firmId,
    'Default Store',
    null,
    'system',
    now,
    'system',
    now
  );
  return id;
}

async function ensureSupplier(db: Db, name: string) {
  const existing = await db.get<{ id: string }>('SELECT id FROM suppliers WHERE name = ?', name);
  if (existing?.id) return existing.id;
  const id = `SUP-${crypto.randomUUID()}`;
  const now = nowIso();
  await db.run(
    `INSERT INTO suppliers (id, name, created_by, created_at, updated_by, updated_at)
     VALUES (?,?,?,?,?,?)`,
    id,
    name,
    'system',
    now,
    'system',
    now
  );
  return id;
}

async function ensureItem(db: Db, itemName: string, specification: string) {
  const specLines = normalizeSpecLines(specification);
  const specObj = specsToJson(specLines);
  const uniqueKey = computeUniqueKey(itemName, specObj);

  const existing = await db.get<{ id: string }>('SELECT id FROM items WHERE unique_key = ?', uniqueKey);
  if (existing?.id) return { itemId: existing.id, specificationText: specLines.join('\n') };

  const now = nowIso();

  let itemNameId = await db.get<{ id: string }>('SELECT id FROM item_names WHERE name = ?', itemName);
  if (!itemNameId?.id) {
    const id = `INAME-${crypto.randomUUID()}`;
    await db.run(
      `INSERT INTO item_names (id, name, category, created_by, created_at, updated_by, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
      id,
      itemName,
      null,
      'system',
      now,
      'system',
      now
    );
    itemNameId = { id };
  }

  for (const line of specLines) {
    const m = line.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (!m) continue;
    const specName = m[1]!.trim();
    const specValue = m[2]!.trim();
    if (!specName || !specValue) continue;

    let specId = await db.get<{ id: string }>('SELECT id FROM specifications WHERE name = ?', specName);
    if (!specId?.id) {
      const id = `SPEC-${crypto.randomUUID()}`;
      await db.run(
        `INSERT INTO specifications (id, name, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?)`,
        id,
        specName,
        'system',
        now,
        'system',
        now
      );
      specId = { id };
    }

    const existingVal = await db.get<{ id: string }>(
      'SELECT id FROM specification_values WHERE specification_id = ? AND value = ?',
      specId.id,
      specValue
    );
    if (!existingVal?.id) {
      await db.run(
        `INSERT INTO specification_values (id, specification_id, value, is_active, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        `SVAL-${crypto.randomUUID()}`,
        specId.id,
        specValue,
        1,
        'system',
        now,
        'system',
        now
      );
    }
  }

  const itemId = `ITEM-${crypto.randomUUID()}`;
  const itemCode = `ITEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await db.run(
    `INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, is_active, created_by, created_at, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    itemId,
    itemNameId.id,
    itemCode,
    JSON.stringify(specObj),
    uniqueKey,
    null,
    null,
    1,
    'system',
    now,
    'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
     VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'items',
    itemId,
    'create',
    'system',
    now,
    `Created via PR: ${itemName}`
  );

  return { itemId, specificationText: specLines.join('\n') };
}

async function nextDocNumber(db: Db, kind: 'PR' | 'PO' | 'GRN') {
  const year = new Date().getFullYear();
  const prefix = `#${kind}-${year}-`;
  const table = kind === 'PR' ? 'purchase_requisitions' : kind === 'PO' ? 'purchase_orders' : 'grns';
  const col = kind === 'PR' ? 'pr_number' : kind === 'PO' ? 'po_number' : 'grn_number';
  const last = await db.get<{ v: string }>(`SELECT ${col} as v FROM ${table} WHERE ${col} LIKE ? ORDER BY ${col} DESC LIMIT 1`, `${prefix}%`);
  const lastNo = last?.v ? Number(String(last.v).slice(prefix.length)) : 0;
  const next = String(Math.max(0, Number.isFinite(lastNo) ? lastNo : 0) + 1).padStart(4, '0');
  return `${prefix}${next}`;
}

function mapPrStatus(dbStatus: string): PrStatus {
  switch (dbStatus) {
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'pending':
    default:
      return 'Pending Approval';
  }
}

function mapInvoiceStatus(dbStatus: string, isPaid: boolean): InvoiceStatus {
  if (isPaid) return 'Paid';
  switch (dbStatus) {
    case 'hold':
      return 'On Hold';
    case 'approved':
      return 'Approved';
    case 'pending':
    case 'verified':
    default:
      return 'Recorded';
  }
}

export async function listFirms(): Promise<FirmRow[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<{ id: string; name: string }[]>('SELECT id, name FROM firms ORDER BY name ASC');
  return (rows ?? []).map((r) => ({ id: r.id, name: r.name }));
}

export type PurchaseRequestRow = {
  id: string;
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string;
  status: PrStatus;
};

export async function readRequests(): Promise<PurchaseRequestRow[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>(
    `SELECT id, firm_id as firmId, requested_by as requestedBy, status, remarks,
            (SELECT required_date FROM purchase_requisition_items pri2 WHERE pri2.pr_id = pr.id ORDER BY pri2.required_date ASC LIMIT 1) as requiredDate,
            created_at as createdAt
     FROM purchase_requisitions pr
     ORDER BY created_at DESC`
  );

  return (rows ?? []).map((r) => ({
    id: String(r.id),
    firmId: String(r.firmId),
    department: String(r.remarks ?? '').trim() || 'Operations',
    requestedBy: String(r.requestedBy),
    requiredDate: String(r.requiredDate ?? '').slice(0, 10),
    status: mapPrStatus(String(r.status)),
  }));
}

export async function getPr(id: string): Promise<PrWithItems | null> {
  await initDb();
  const db = await getDb();
  const pr = await db.get<any>(
    `SELECT id, firm_id as firmId, requested_by as requestedBy, status, remarks
     FROM purchase_requisitions WHERE id = ?`,
    id
  );
  if (!pr) return null;

  const items = await db.all<any[]>(
    `SELECT pri.item_id as itemId,
            pri.requested_qty as quantity,
            it.specifications_json as specificationsJson,
            inames.name as item,
            pri.required_date as requiredDate
     FROM purchase_requisition_items pri
     JOIN items it ON it.id = pri.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE pri.pr_id = ?
     ORDER BY pri.created_at ASC`,
    id
  );

  const prItems: PrItemRow[] = (items ?? []).map((r) => {
    let specText = '';
    try {
      const obj = JSON.parse(String(r.specificationsJson ?? '{}')) as Record<string, string>;
      const lines = Object.keys(obj)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => `${k}: ${String(obj[k] ?? '')}`.trim());
      specText = lines.join('\n');
    } catch {
      specText = '';
    }
    return {
      prId: id,
      itemId: String(r.itemId),
      item: String(r.item),
      quantity: Number(r.quantity ?? 0),
      specification: specText,
    };
  });

  const requiredDate = prItems.length ? String(items[0]?.requiredDate ?? '').slice(0, 10) : new Date().toISOString().slice(0, 10);

  return {
    pr: {
      id: String(pr.id),
      firmId: String(pr.firmId),
      department: String(pr.remarks ?? '').trim() || 'Operations',
      requestedBy: String(pr.requestedBy),
      requiredDate,
      status: mapPrStatus(String(pr.status)),
    },
    items: prItems,
  };
}

export async function createRequest(input: {
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string;
  items: Array<{ item: string; quantity: number; specification: string }>;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();

  const prNumber = await nextDocNumber(db, 'PR');
  const prId = prNumber;
  const storeId = await ensureStoreForFirm(db, input.firmId);

  await db.exec('BEGIN');
  try {
    await db.run(
      `INSERT INTO purchase_requisitions (id, pr_number, firm_id, store_id, project_id, requested_by, status, remarks, created_by, created_at, updated_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      prId,
      prNumber,
      input.firmId,
      storeId,
      null,
      input.requestedBy,
      'pending',
      input.department,
      input.requestedBy,
      now,
      input.requestedBy,
      now
    );

    for (const it of input.items) {
      const { itemId } = await ensureItem(db, it.item, it.specification);
      const prItemId = `PRI-${crypto.randomUUID()}`;
      await db.run(
        `INSERT INTO purchase_requisition_items
           (id, pr_id, item_id, requested_qty, approved_qty, required_date, remarks, status, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        prItemId,
        prId,
        itemId,
        it.quantity,
        0,
        input.requiredDate,
        null,
        'pending',
        input.requestedBy,
        now,
        input.requestedBy,
        now
      );
    }

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'purchase_requisitions',
      prId,
      'create',
      input.requestedBy,
      now,
      null
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  const created = await getPr(prId);
  if (!created) throw new Error('Failed to create PR');
  return created;
}

export async function decidePr(input: { prId: string; decision: 'approve' | 'reject'; approver: string; rejectReason?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const pr = await db.get<any>('SELECT id FROM purchase_requisitions WHERE id = ?', input.prId);
  if (!pr) throw new Error('PR not found');

  await db.exec('BEGIN');
  try {
    if (input.decision === 'approve') {
      await db.run(
        `UPDATE purchase_requisitions
         SET status='approved', approved_by=?, approved_at=?, updated_by=?, updated_at=?
         WHERE id=?`,
        input.approver,
        now,
        input.approver,
        now,
        input.prId
      );
      await db.run(
        `UPDATE purchase_requisition_items
         SET status='approved', approved_qty=requested_qty, approved_by=?, approved_at=?, updated_by=?, updated_at=?
         WHERE pr_id=?`,
        input.approver,
        now,
        input.approver,
        now,
        input.prId
      );
    } else {
      await db.run(
        `UPDATE purchase_requisitions
         SET status='rejected', approved_by=?, approved_at=?, remarks=COALESCE(remarks,'') || ?, updated_by=?, updated_at=?
         WHERE id=?`,
        input.approver,
        now,
        input.rejectReason ? `\nRejected: ${input.rejectReason}` : '\nRejected',
        input.approver,
        now,
        input.prId
      );
      await db.run(
        `UPDATE purchase_requisition_items
         SET status='rejected', approved_qty=0, approved_by=?, approved_at=?, updated_by=?, updated_at=?
         WHERE pr_id=?`,
        input.approver,
        now,
        input.approver,
        now,
        input.prId
      );
    }

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'purchase_requisitions',
      input.prId,
      input.decision,
      input.approver,
      now,
      input.rejectReason ?? null
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  const updated = await getPr(input.prId);
  if (!updated) throw new Error('PR not found');
  return updated;
}

async function getPoByPrId(db: Db, prId: string) {
  return db.get<any>('SELECT * FROM purchase_orders WHERE pr_id = ? ORDER BY created_at DESC LIMIT 1', prId);
}

async function getPoWithItems(db: Db, poId: string): Promise<PoWithItems | null> {
  const po = await db.get<any>('SELECT * FROM purchase_orders WHERE id = ?', poId);
  if (!po) return null;
  const supplier = await db.get<any>('SELECT name FROM suppliers WHERE id = ?', String(po.supplier_id));
  const items = await db.all<any[]>(
    `SELECT poi.item_id as itemId, poi.quantity, poi.rate, inames.name as item
     FROM purchase_order_items poi
     JOIN items it ON it.id = poi.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE poi.po_id = ?
     ORDER BY poi.created_at ASC`,
    poId
  );
  const status: PoStatus =
    String(po.status) === 'closed' ? 'Closed' : String(po.status) === 'partial' ? 'Partial' : 'Open';
  return {
    po: {
      id: String(po.id),
      prId: String(po.pr_id),
      supplier: String(supplier?.name ?? ''),
      paymentTerms: String(po.payment_terms ?? ''),
      status,
      createdAt: String(po.created_at ?? ''),
    },
    items: (items ?? []).map((r) => ({
      poId,
      itemId: String(r.itemId),
      item: String(r.item),
      quantity: Number(r.quantity ?? 0),
      rate: Number(r.rate ?? 0),
    })),
  };
}

export async function getPo(poId: string): Promise<PoWithItems | null> {
  await initDb();
  const db = await getDb();
  return getPoWithItems(db, poId);
}

export async function getPoMeta(poId: string): Promise<{ firmId: string; orderDate: string } | null> {
  await initDb();
  const db = await getDb();
  const row = await db.get<any>('SELECT firm_id as firmId, order_date as orderDate FROM purchase_orders WHERE id = ?', poId);
  if (!row) return null;
  return { firmId: String(row.firmId ?? ''), orderDate: String(row.orderDate ?? '') };
}

export async function listPosByPrId(prId: string): Promise<PoWithItems[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<{ id: string }[]>('SELECT id FROM purchase_orders WHERE pr_id = ? ORDER BY created_at DESC', prId);
  const out: PoWithItems[] = [];
  for (const r of rows ?? []) {
    const po = await getPoWithItems(db, String(r.id));
    if (po) out.push(po);
  }
  return out;
}

export async function createPoFromPr(input: {
  prId: string;
  supplier: string;
  paymentTerms: string;
  items: Array<{ itemId: string; quantity: number; rate: number }>;
}) {
  await initDb();
  const db = await getDb();
  const pr = await db.get<any>('SELECT id, firm_id as firmId, store_id as storeId, status FROM purchase_requisitions WHERE id = ?', input.prId);
  if (!pr) throw new Error('PR not found');
  if (String(pr.status) !== 'approved') throw new Error('PR must be approved before creating a PO');

  const supplierId = await ensureSupplier(db, input.supplier);
  const now = nowIso();
  const poNumber = await nextDocNumber(db, 'PO');
  const poId = poNumber;

  const prItemRows = await db.all<any[]>(
    `SELECT pri.item_id as itemId, pri.approved_qty as approvedQty
     FROM purchase_requisition_items pri
     WHERE pri.pr_id = ? AND pri.status = 'approved'`,
    input.prId
  );
  const byItemId = new Map<string, { approvedQty: number }>();
  for (const r of prItemRows ?? []) byItemId.set(String(r.itemId), { approvedQty: Number(r.approvedQty ?? 0) });

  const existingPoQtyRows = await db.all<any[]>(
    `SELECT poi.item_id as itemId, SUM(poi.quantity) as orderedQty
     FROM purchase_order_items poi
     JOIN purchase_orders po ON po.id = poi.po_id
     WHERE po.pr_id = ?
     GROUP BY poi.item_id`,
    input.prId
  );
  const orderedQtyByItemId = new Map<string, number>();
  for (const r of existingPoQtyRows ?? []) orderedQtyByItemId.set(String(r.itemId), Number(r.orderedQty ?? 0));

  await db.exec('BEGIN');
  try {
    await db.run(
      `INSERT INTO purchase_orders
        (id, po_number, firm_id, store_id, project_id, supplier_id, pr_id, status, order_date, payment_terms, credit_days, remarks, created_by, created_at, updated_by, updated_at, approved_by, approved_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      poId,
      poNumber,
      pr.firmId,
      pr.storeId,
      null,
      supplierId,
      input.prId,
      'issued',
      now.slice(0, 10),
      input.paymentTerms,
      null,
      null,
      'Purchase Team',
      now,
      'Purchase Team',
      now,
      'Purchase Team',
      now
    );

    for (const line of input.items) {
      const itemId = String(line.itemId ?? '').trim();
      const match = byItemId.get(itemId);
      if (!itemId || !match) throw new Error('Invalid PO line item (not part of approved PR)');
      const prevOrdered = orderedQtyByItemId.get(itemId) ?? 0;
      const remaining = Number(match.approvedQty ?? 0) - Number(prevOrdered ?? 0);
      if (Number(line.quantity) > remaining) throw new Error('PO quantity cannot exceed remaining PR quantity');
      orderedQtyByItemId.set(itemId, prevOrdered + Number(line.quantity));
      const goodsAmount = Number(line.quantity) * Number(line.rate);
      await db.run(
        `INSERT INTO purchase_order_items
          (id, po_id, item_id, quantity, rate, discount_percent, tax_percent, goods_amount, tax_amount, total_amount, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `POI-${crypto.randomUUID()}`,
        poId,
        itemId,
        line.quantity,
        line.rate,
        0,
        0,
        goodsAmount,
        0,
        goodsAmount,
        'Purchase Team',
        now,
        'Purchase Team',
        now
      );
    }

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'purchase_orders',
      poId,
      'create',
      'Purchase Team',
      now,
      `Created from PR ${input.prId}`
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  const po = await getPoWithItems(db, poId);
  if (!po) throw new Error('Failed to create PO');
  return po;
}

async function getInvoiceByPoId(db: Db, poId: string) {
  return db.get<any>('SELECT * FROM invoices WHERE po_id = ? ORDER BY created_at DESC LIMIT 1', poId);
}

async function getInvoiceWithItems(db: Db, invoiceId: string): Promise<InvoiceWithItems | null> {
  const inv = await db.get<any>('SELECT * FROM invoices WHERE id = ?', invoiceId);
  if (!inv) return null;
  const items = await db.all<any[]>(
    `SELECT ii.quantity, ii.rate, inames.name as item
     FROM invoice_items ii
     JOIN items it ON it.id = ii.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE ii.invoice_id = ?
     ORDER BY ii.created_at ASC`,
    invoiceId
  );
  const payments = await db.get<{ paid: number }>('SELECT COALESCE(SUM(amount_paid),0) as paid FROM payments WHERE invoice_id = ?', invoiceId);
  const isPaid = Number(payments?.paid ?? 0) >= Number(inv.total_amount ?? 0) && Number(inv.total_amount ?? 0) > 0;

  const logistics: LogisticsRow | undefined =
    inv.dispatch_date || inv.transporter_name || inv.cn_number || inv.courier_number || inv.vehicle_number || inv.eway_bill_number
      ? {
          invoiceId,
          dispatchProof: inv.document_url ? String(inv.document_url) : 'Recorded',
          cnOrCourierNo: String(inv.cn_number ?? inv.courier_number ?? ''),
          transporterName: String(inv.transporter_name ?? ''),
        }
      : undefined;

  return {
    invoice: {
      id: String(inv.id),
      poId: String(inv.po_id),
      supplierInvoiceNo: String(inv.invoice_number),
      invoiceDate: String(inv.invoice_date),
      status: mapInvoiceStatus(String(inv.status), isPaid),
      holdReason: inv.status === 'hold' ? 'Invoice on hold' : undefined,
      createdAt: String(inv.created_at),
    },
    items: (items ?? []).map((r) => ({
      invoiceId,
      item: String(r.item),
      quantity: Number(r.quantity ?? 0),
      rate: Number(r.rate ?? 0),
    })),
    logistics,
  };
}

export async function createInvoice(input: { poId: string; supplierInvoiceNo: string; invoiceDate: string; items: Array<{ item: string; quantity: number; rate: number }> }) {
  await initDb();
  const db = await getDb();
  const po = await db.get<any>('SELECT * FROM purchase_orders WHERE id = ?', input.poId);
  if (!po) throw new Error('PO not found');

  const now = nowIso();
  const invoiceId = `INV-${crypto.randomUUID()}`;
  const invoiceNumber = input.supplierInvoiceNo.trim();
  if (!invoiceNumber) throw new Error('Invoice number is required');

  const poItems = await db.all<any[]>(
    `SELECT poi.item_id as itemId, poi.quantity as poQty, poi.rate as poRate, inames.name as item
     FROM purchase_order_items poi
     JOIN items it ON it.id = poi.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE poi.po_id = ?`,
    input.poId
  );
  const byItemName = new Map<string, { itemId: string; poQty: number; poRate: number }>();
  for (const r of poItems ?? []) byItemName.set(String(r.item), { itemId: String(r.itemId), poQty: Number(r.poQty ?? 0), poRate: Number(r.poRate ?? 0) });

  let goodsAmount = 0;
  for (const line of input.items) goodsAmount += Number(line.quantity) * Number(line.rate);

  await db.exec('BEGIN');
  try {
    await db.run(
      `INSERT INTO invoices
        (id, po_id, supplier_id, invoice_number, invoice_date, goods_amount, tax_amount, total_amount, status, created_by, created_at, updated_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      invoiceId,
      input.poId,
      po.supplier_id,
      invoiceNumber,
      input.invoiceDate,
      goodsAmount,
      0,
      goodsAmount,
      'pending',
      'Accounts Team',
      now,
      'Accounts Team',
      now
    );

    for (const line of input.items) {
      const match = byItemName.get(line.item);
      if (!match) throw new Error(`Item "${line.item}" is not part of the PO`);
      if (line.quantity > match.poQty) throw new Error(`Invoice quantity for "${line.item}" cannot exceed PO quantity`);
      const amount = Number(line.quantity) * Number(line.rate);
      await db.run(
        `INSERT INTO invoice_items (id, invoice_id, item_id, quantity, rate, amount, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        `INVI-${crypto.randomUUID()}`,
        invoiceId,
        match.itemId,
        line.quantity,
        line.rate,
        amount,
        'Accounts Team',
        now,
        'Accounts Team',
        now
      );
    }

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'invoices',
      invoiceId,
      'create',
      'Accounts Team',
      now,
      `PO ${input.poId}`
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  const created = await getInvoiceWithItems(db, invoiceId);
  if (!created) throw new Error('Failed to create invoice');
  return created;
}

export async function upsertLogistics(input: { invoiceId: string; dispatchProof: string; cnOrCourierNo: string; transporterName: string }) {
  await initDb();
  const db = await getDb();
  const inv = await db.get<any>('SELECT id FROM invoices WHERE id = ?', input.invoiceId);
  if (!inv) throw new Error('Invoice not found');
  const now = nowIso();
  await db.run(
    `UPDATE invoices
     SET transporter_name=?, cn_number=?, courier_number=NULL, document_url=?, dispatch_date=COALESCE(dispatch_date, ?), updated_by=?, updated_at=?
     WHERE id=?`,
    input.transporterName,
    input.cnOrCourierNo,
    input.dispatchProof,
    now.slice(0, 10),
    'Purchase Team',
    now,
    input.invoiceId
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
     VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'invoices',
    input.invoiceId,
    'update_logistics',
    'Purchase Team',
    now,
    null
  );
  return {
    invoiceId: input.invoiceId,
    dispatchProof: input.dispatchProof,
    cnOrCourierNo: input.cnOrCourierNo,
    transporterName: input.transporterName,
  } satisfies LogisticsRow;
}

async function findPoForInvoice(db: Db, invoiceId: string) {
  const inv = await db.get<any>('SELECT po_id as poId FROM invoices WHERE id = ?', invoiceId);
  if (!inv?.poId) throw new Error('Invoice not found');
  return String(inv.poId);
}

async function getGrnByPoId(db: Db, poId: string) {
  return db.get<any>('SELECT * FROM grns WHERE po_id = ? ORDER BY created_at DESC LIMIT 1', poId);
}

async function getGrnWithItems(db: Db, grnId: string): Promise<GrnWithItems | null> {
  const grn = await db.get<any>('SELECT * FROM grns WHERE id = ?', grnId);
  if (!grn) return null;
  const items = await db.all<any[]>(
    `SELECT gi.received_qty as receivedQty, inames.name as item
     FROM grn_items gi
     JOIN items it ON it.id = gi.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE gi.grn_id = ?
     ORDER BY gi.created_at ASC`,
    grnId
  );
  const invoice = await getInvoiceByPoId(db, String(grn.po_id));
  return {
    grn: {
      id: String(grn.id),
      poId: String(grn.po_id),
      invoiceId: String(invoice?.id ?? ''),
      receivedDate: String(grn.received_date),
      createdAt: String(grn.created_at),
    },
    items: (items ?? []).map((r) => ({ grnId, item: String(r.item), quantityReceived: Number(r.receivedQty ?? 0) })),
  };
}

export async function createGrn(input: { invoiceId: string; receivedDate: string; items: Array<{ item: string; quantityReceived: number }> }) {
  await initDb();
  const db = await getDb();
  const poId = await findPoForInvoice(db, input.invoiceId);
  const po = await db.get<any>('SELECT firm_id as firmId, store_id as storeId FROM purchase_orders WHERE id = ?', poId);
  if (!po) throw new Error('PO not found for invoice');

  const poItems = await db.all<any[]>(
    `SELECT poi.item_id as itemId, poi.quantity as poQty, inames.name as item
     FROM purchase_order_items poi
     JOIN items it ON it.id = poi.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE poi.po_id = ?`,
    poId
  );
  const byItemName = new Map<string, { itemId: string; poQty: number }>();
  for (const r of poItems ?? []) byItemName.set(String(r.item), { itemId: String(r.itemId), poQty: Number(r.poQty ?? 0) });

  const now = nowIso();
  const grnNumber = await nextDocNumber(db, 'GRN');
  const grnId = grnNumber;

  await db.exec('BEGIN');
  try {
    await db.run(
      `INSERT INTO grns (id, grn_number, po_id, firm_id, store_id, received_by, received_date, remarks, created_by, created_at, updated_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      grnId,
      grnNumber,
      poId,
      po.firmId,
      po.storeId,
      'Stores Team',
      input.receivedDate,
      null,
      'Stores Team',
      now,
      'Stores Team',
      now
    );

    for (const line of input.items) {
      const match = byItemName.get(line.item);
      if (!match) throw new Error(`Item "${line.item}" is not part of the PO`);
      if (line.quantityReceived > match.poQty) throw new Error(`GRN received qty for "${line.item}" cannot exceed PO quantity`);

      const existingReceived = await db.get<{ received: number }>(
        `SELECT COALESCE(SUM(gi.received_qty),0) as received
         FROM grn_items gi
         JOIN grns g ON g.id = gi.grn_id
         WHERE g.po_id = ? AND gi.item_id = ?`,
        poId,
        match.itemId
      );
      if (Number(existingReceived?.received ?? 0) + Number(line.quantityReceived) > match.poQty) {
        throw new Error(`Total received qty for "${line.item}" cannot exceed PO quantity`);
      }

      const grnItemId = `GRNI-${crypto.randomUUID()}`;
      await db.run(
        `INSERT INTO grn_items (id, grn_id, item_id, ordered_qty, received_qty, short_qty, damaged_qty, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        grnItemId,
        grnId,
        match.itemId,
        match.poQty,
        line.quantityReceived,
        null,
        null,
        'Stores Team',
        now,
        'Stores Team',
        now
      );

      const invItem = await db.get<any>('SELECT id, quantity FROM invoice_items WHERE invoice_id = ? AND item_id = ?', input.invoiceId, match.itemId);
      if (invItem?.id) {
        const linkedQty = Math.min(Number(line.quantityReceived), Number(invItem.quantity ?? 0));
        await db.run(
          `INSERT INTO grn_invoice_item_links (id, grn_item_id, invoice_item_id, linked_qty, created_by, created_at)
           VALUES (?,?,?,?,?,?)`,
          `LINK-${crypto.randomUUID()}`,
          grnItemId,
          String(invItem.id),
          linkedQty,
          'system',
          now
        );
      }
    }

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'grns',
      grnId,
      'create',
      'Stores Team',
      now,
      `Invoice ${input.invoiceId}`
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  const grn = await getGrnWithItems(db, grnId);
  if (!grn) throw new Error('Failed to create GRN');
  return grn;
}

export async function recordQc(input: { grnId: string; inspectedBy: string; location: string; items: Array<{ item: string; quantityAccepted: number; quantityRejected: number; remarks: string }> }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();

  const grn = await db.get<any>('SELECT id, firm_id as firmId, store_id as storeId FROM grns WHERE id = ?', input.grnId);
  if (!grn) throw new Error('GRN not found');

  const grnItems = await db.all<any[]>(
    `SELECT gi.item_id as itemId, gi.received_qty as receivedQty, inames.name as item
     FROM grn_items gi
     JOIN items it ON it.id = gi.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE gi.grn_id = ?`,
    input.grnId
  );
  const byItemName = new Map<string, { itemId: string; receivedQty: number }>();
  for (const r of grnItems ?? []) byItemName.set(String(r.item), { itemId: String(r.itemId), receivedQty: Number(r.receivedQty ?? 0) });

  await db.exec('BEGIN');
  try {
    for (const line of input.items) {
      const match = byItemName.get(line.item);
      if (!match) throw new Error(`Item "${line.item}" is not part of the GRN`);
      if (line.quantityAccepted + line.quantityRejected > match.receivedQty) throw new Error(`QC qty for "${line.item}" cannot exceed received qty`);

      await db.run(
        `INSERT INTO qc_records (id, grn_id, item_id, accepted_qty, rejected_qty, hold_qty, remarks, qc_by, qc_date, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `QC-${crypto.randomUUID()}`,
        input.grnId,
        match.itemId,
        line.quantityAccepted,
        line.quantityRejected,
        0,
        line.remarks ?? null,
        input.inspectedBy,
        now.slice(0, 10),
        input.inspectedBy,
        now,
        input.inspectedBy,
        now
      );

      if (line.quantityAccepted > 0) {
        await db.run(
          `INSERT INTO stock_ledger (id, firm_id, store_id, item_id, transaction_type, quantity, reference_type, reference_id, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          `STK-${crypto.randomUUID()}`,
          grn.firmId,
          grn.storeId,
          match.itemId,
          'IN',
          line.quantityAccepted,
          'GRN',
          input.grnId,
          input.inspectedBy,
          now
        );
      }
    }

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'qc_records',
      input.grnId,
      'record',
      input.inspectedBy,
      now,
      input.location
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  const rows = await db.all<any[]>(
    `SELECT qr.accepted_qty as acceptedQty, qr.rejected_qty as rejectedQty, qr.remarks, qr.qc_by as qcBy, qr.created_at as createdAt, inames.name as item
     FROM qc_records qr
     JOIN items it ON it.id = qr.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE qr.grn_id = ?
     ORDER BY qr.created_at ASC`,
    input.grnId
  );

  return {
    qc: (rows ?? []).map((r) => ({
      grnId: input.grnId,
      item: String(r.item),
      quantityAccepted: Number(r.acceptedQty ?? 0),
      quantityRejected: Number(r.rejectedQty ?? 0),
      remarks: String(r.remarks ?? ''),
      inspectedBy: String(r.qcBy ?? ''),
      inspectedAt: String(r.createdAt ?? ''),
      location: input.location,
    })),
  };
}

export async function approveInvoice(invoiceId: string) {
  await initDb();
  const db = await getDb();
  const inv = await db.get<any>('SELECT * FROM invoices WHERE id = ?', invoiceId);
  if (!inv) throw new Error('Invoice not found');
  const now = nowIso();

  const invoiceItems = await db.all<any[]>(
    `SELECT ii.item_id as itemId, ii.quantity as qty, ii.rate as rate, inames.name as item
     FROM invoice_items ii
     JOIN items it ON it.id = ii.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE ii.invoice_id = ?`,
    invoiceId
  );
  const poItems = await db.all<any[]>(
    `SELECT poi.item_id as itemId, poi.quantity as qty, poi.rate as rate, inames.name as item
     FROM purchase_order_items poi
     JOIN items it ON it.id = poi.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE poi.po_id = ?`,
    String(inv.po_id)
  );

  const poByItemId = new Map<string, { qty: number; rate: number; item: string }>();
  for (const r of poItems ?? []) poByItemId.set(String(r.itemId), { qty: Number(r.qty ?? 0), rate: Number(r.rate ?? 0), item: String(r.item) });

  const mismatches: string[] = [];
  for (const ii of invoiceItems ?? []) {
    const po = poByItemId.get(String(ii.itemId));
    if (!po) {
      mismatches.push(`${ii.item}: not in PO`);
      continue;
    }
    if (Number(ii.rate ?? 0) !== Number(po.rate ?? 0)) mismatches.push(`${ii.item}: rate mismatch`);
    if (Number(ii.qty ?? 0) > Number(po.qty ?? 0)) mismatches.push(`${ii.item}: qty exceeds PO`);
  }

  const poId = String(inv.po_id);
  const grn = await getGrnByPoId(db, poId);
  if (grn?.id) {
    const received = await db.all<any[]>(
      `SELECT gi.item_id as itemId, COALESCE(SUM(gi.received_qty),0) as receivedQty
       FROM grn_items gi
       JOIN grns g ON g.id = gi.grn_id
       WHERE g.po_id = ?
       GROUP BY gi.item_id`,
      poId
    );
    const receivedByItem = new Map<string, number>();
    for (const r of received ?? []) receivedByItem.set(String(r.itemId), Number(r.receivedQty ?? 0));
    for (const ii of invoiceItems ?? []) {
      const rcv = receivedByItem.get(String(ii.itemId)) ?? 0;
      if (rcv < Number(ii.qty ?? 0)) mismatches.push(`${ii.item}: GRN received less than invoice`);
    }
  }

  const nextStatus = mismatches.length ? 'hold' : 'approved';
  await db.run(`UPDATE invoices SET status=?, updated_by=?, updated_at=? WHERE id=?`, nextStatus, 'Accounts Team', now, invoiceId);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
     VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'invoices',
    invoiceId,
    nextStatus === 'approved' ? 'approve' : 'hold',
    'Accounts Team',
    now,
    mismatches.join('; ').slice(0, 500) || null
  );

  return { status: mapInvoiceStatus(nextStatus, false), mismatches };
}

export async function payInvoice(input: { invoiceId: string; paymentDate: string; amount: number; mode: string; referenceNo: string }) {
  await initDb();
  const db = await getDb();
  const inv = await db.get<any>('SELECT * FROM invoices WHERE id = ?', input.invoiceId);
  if (!inv) throw new Error('Invoice not found');
  if (String(inv.status) !== 'approved') throw new Error('Invoice must be approved before payment');

  const invItems = await db.all<any[]>(
    'SELECT id, item_id as itemId, quantity FROM invoice_items WHERE invoice_id = ?',
    input.invoiceId
  );
  for (const it of invItems ?? []) {
    const linked = await db.get<{ linked: number }>(
      `SELECT COALESCE(SUM(l.linked_qty),0) as linked
       FROM grn_invoice_item_links l
       WHERE l.invoice_item_id = ?`,
      String(it.id)
    );
    if (Number(linked?.linked ?? 0) < Number(it.quantity ?? 0)) {
      throw new Error('GRN ↔ Invoice linking is incomplete. Link all quantities before payment.');
    }
  }

  const now = nowIso();
  const id = `PAY-${crypto.randomUUID()}`;
  await db.run(
    `INSERT INTO payments (id, supplier_id, po_id, invoice_id, amount_paid, payment_date, due_date, status, remarks, created_by, created_at, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    String(inv.supplier_id),
    String(inv.po_id),
    input.invoiceId,
    input.amount,
    input.paymentDate,
    null,
    'paid',
    `${input.mode} / ${input.referenceNo}`,
    'Accounts Team',
    now,
    'Accounts Team',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
     VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'payments',
    input.invoiceId,
    'create',
    'Accounts Team',
    now,
    null
  );
  return {
    id,
    invoiceId: input.invoiceId,
    paymentDate: input.paymentDate,
    amount: input.amount,
    mode: input.mode,
    referenceNo: input.referenceNo,
    createdAt: now,
  } satisfies PaymentRow;
}

export async function getWorkflow(prId: string): Promise<WorkflowSummary> {
  await initDb();
  const db = await getDb();
  const pr = await getPr(prId);
  if (!pr) throw new Error('PR not found');
  const firm = await db.get<{ id: string; name: string }>('SELECT id, name FROM firms WHERE id = ?', pr.pr.firmId);

  const po = await getPoByPrId(db, prId);
  const poWithItems = po ? await getPoWithItems(db, String(po.id)) : null;

  const invoice = po ? await getInvoiceByPoId(db, String(po.id)) : null;
  const invoiceWithItems = invoice ? await getInvoiceWithItems(db, String(invoice.id)) : null;

  const grn = po ? await getGrnByPoId(db, String(po.id)) : null;
  const grnWithItems = grn ? await getGrnWithItems(db, String(grn.id)) : null;

  const qcRows = grn
    ? await db.all<any[]>(
        `SELECT qr.accepted_qty as acceptedQty, qr.rejected_qty as rejectedQty, qr.remarks, qr.qc_by as qcBy, qr.created_at as createdAt, inames.name as item
         FROM qc_records qr
         JOIN items it ON it.id = qr.item_id
         JOIN item_names inames ON inames.id = it.item_name_id
         WHERE qr.grn_id = ?
         ORDER BY qr.created_at ASC`,
        String(grn.id)
      )
    : null;

  const payments = invoice
    ? await db.all<any[]>(
        `SELECT id, invoice_id as invoiceId, payment_date as paymentDate, amount_paid as amountPaid, remarks, created_at as createdAt
         FROM payments WHERE invoice_id = ? ORDER BY created_at ASC`,
        String(invoice.id)
      )
    : null;

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
    firm: firm?.id ? { id: firm.id, name: firm.name } : undefined,
    pr,
    po: poWithItems ?? undefined,
    invoice: invoiceWithItems ?? undefined,
    grn: grnWithItems ?? undefined,
    qc: qcRows
      ? qcRows.map((r) => ({
          grnId: String(grn!.id),
          item: String(r.item),
          quantityAccepted: Number(r.acceptedQty ?? 0),
          quantityRejected: Number(r.rejectedQty ?? 0),
          remarks: String(r.remarks ?? ''),
          inspectedBy: String(r.qcBy ?? ''),
          inspectedAt: String(r.createdAt ?? ''),
          location: '',
        }))
      : undefined,
    payments: payments
      ? payments.map((p) => ({
          id: String(p.id),
          invoiceId: String(p.invoiceId),
          paymentDate: String(p.paymentDate),
          amount: Number(p.amountPaid ?? 0),
          mode: String(p.remarks ?? ''),
          referenceNo: '',
          createdAt: String(p.createdAt ?? ''),
        }))
      : undefined,
    flags: { invoiceRateMismatch, quantityMismatch },
  };
}

export async function exportWorkflowWorkbookBuffer(): Promise<Buffer> {
  await initDb();
  const db = await getDb();

  const tables: Array<{ name: string; sql: string }> = [
    { name: 'Firms', sql: 'SELECT * FROM firms' },
    { name: 'Stores', sql: 'SELECT * FROM stores' },
    { name: 'Items', sql: 'SELECT * FROM items' },
    { name: 'PRs', sql: 'SELECT * FROM purchase_requisitions' },
    { name: 'PR_Items', sql: 'SELECT * FROM purchase_requisition_items' },
    { name: 'POs', sql: 'SELECT * FROM purchase_orders' },
    { name: 'PO_Items', sql: 'SELECT * FROM purchase_order_items' },
    { name: 'Invoices', sql: 'SELECT * FROM invoices' },
    { name: 'Invoice_Items', sql: 'SELECT * FROM invoice_items' },
    { name: 'GRNs', sql: 'SELECT * FROM grns' },
    { name: 'GRN_Items', sql: 'SELECT * FROM grn_items' },
    { name: 'QC', sql: 'SELECT * FROM qc_records' },
    { name: 'StockLedger', sql: 'SELECT * FROM stock_ledger' },
    { name: 'Payments', sql: 'SELECT * FROM payments' },
    { name: 'AuditLogs', sql: 'SELECT * FROM audit_logs' },
  ];

  const wb = XLSX.utils.book_new();
  for (const t of tables) {
    const rows = await db.all<any[]>(t.sql);
    const ws = XLSX.utils.json_to_sheet(rows ?? []);
    XLSX.utils.book_append_sheet(wb, ws, t.name);
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

function isBusyFsError(err: unknown) {
  const code = (err as any)?.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

function formatSnapshotStamp(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function saveExcelSnapshotToDisk(): Promise<{ fileName: string }> {
  const buf = await exportWorkflowWorkbookBuffer();
  const dir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const primary = path.join(dir, 'purchase_workflow.xlsx');
  const tmp = path.join(dir, `._tmp_${crypto.randomUUID()}.xlsx`);

  fs.writeFileSync(tmp, buf);
  try {
    fs.copyFileSync(tmp, primary);
    fs.unlinkSync(tmp);
    return { fileName: 'data/purchase_workflow.xlsx' };
  } catch (e) {
    if (isBusyFsError(e)) {
      throw new Error('purchase_workflow.xlsx is locked (open in Excel). Close it to update the snapshot.');
    }
    throw e;
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

export async function exportMastersWorkbookBuffer(): Promise<Buffer> {
  await initDb();
  const db = await getDb();

  const tables: Array<{ name: string; sql: string }> = [
    { name: 'Firms', sql: 'SELECT * FROM firms' },
    { name: 'Stores', sql: 'SELECT * FROM stores' },
    { name: 'Users', sql: 'SELECT * FROM users' },
    { name: 'Suppliers', sql: 'SELECT * FROM suppliers' },
    { name: 'Customers', sql: 'SELECT * FROM customers' },
    { name: 'Projects', sql: 'SELECT * FROM projects' },
    { name: 'IssueTypes', sql: 'SELECT * FROM issue_types' },
    { name: 'ItemNames', sql: 'SELECT * FROM item_names' },
    { name: 'Specifications', sql: 'SELECT * FROM specifications' },
    { name: 'SpecificationValues', sql: 'SELECT * FROM specification_values' },
    { name: 'Items', sql: 'SELECT * FROM items' },
  ];

  const wb = XLSX.utils.book_new();
  for (const t of tables) {
    const rows = await db.all<any[]>(t.sql);
    const ws = XLSX.utils.json_to_sheet(rows ?? []);
    XLSX.utils.book_append_sheet(wb, ws, t.name);
  }

  // Simple data-entry templates (15 rows) for offline entry.
  const itemNamesTemplate = XLSX.utils.aoa_to_sheet([
    ['Name', 'Category'],
    ...Array.from({ length: 15 }, () => ['', '']),
  ]);
  XLSX.utils.book_append_sheet(wb, itemNamesTemplate, 'ItemNames_Template15');

  const itemsTemplate = XLSX.utils.aoa_to_sheet([
    ['Item Name', 'Unit', 'Description', 'Spec 1', 'Value 1', 'Spec 2', 'Value 2', 'Spec 3', 'Value 3'],
    ...Array.from({ length: 15 }, () => ['', '', '', '', '', '', '', '', '']),
  ]);
  XLSX.utils.book_append_sheet(wb, itemsTemplate, 'Items_Template15');

  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

export async function saveMastersExcelSnapshotToDisk(): Promise<{ fileName: string }> {
  const buf = await exportMastersWorkbookBuffer();
  const dir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const primary = path.join(dir, 'master_data.xlsx');
  const tmp = path.join(dir, `._tmp_${crypto.randomUUID()}.xlsx`);

  fs.writeFileSync(tmp, buf);
  try {
    fs.copyFileSync(tmp, primary);
    fs.unlinkSync(tmp);
    return { fileName: 'data/master_data.xlsx' };
  } catch (e) {
    if (isBusyFsError(e)) throw new Error('master_data.xlsx is locked (open in Excel). Close it to update the snapshot.');
    throw e;
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

export async function createFirm(input: { name: string; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `FIRM-${crypto.randomUUID()}`;
  const name = input.name.trim();
  if (!name) throw new Error('Firm name is required');
  await db.run(
    `INSERT INTO firms (id, name, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?)`,
    id,
    name,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'firms',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return { id, name };
}

export async function updateFirm(input: { id: string; name: string; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = input.name.trim();
  if (!id) throw new Error('Firm id is required');
  if (!name) throw new Error('Firm name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM firms WHERE id = ?', id);
  if (!existing?.id) throw new Error('Firm not found');

  await db.run(`UPDATE firms SET name = ?, updated_by = ?, updated_at = ? WHERE id = ?`, name, input.updatedBy ?? 'system', now, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'firms',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );

  return { id, name };
}

export async function deleteFirm(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Firm id is required');

  await db.run(`DELETE FROM firms WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'firms',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    null
  );
  return { ok: true };
}

export async function listStores() {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>('SELECT id, firm_id as firmId, name, location FROM stores ORDER BY created_at DESC');
  return (rows ?? []).map((r) => ({ id: String(r.id), firmId: String(r.firmId), name: String(r.name), location: r.location ?? null }));
}

export type UserRow = {
  id: string;
  name: string;
  email?: string | null;
  designation: string;
  mobile?: string | null;
  hasPassword: boolean;
};

export async function listUsers(): Promise<UserRow[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>(
    `SELECT id,
            name,
            role as designation,
            email,
            phone as mobile,
            password_hash as passwordHash
     FROM users
     ORDER BY name ASC`
  );
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    email: r.email != null ? String(r.email) : null,
    designation: String(r.designation ?? ''),
    mobile: r.mobile != null ? String(r.mobile) : null,
    hasPassword: Boolean(r.passwordHash),
  }));
}

export async function createUser(input: {
  name: string;
  email: string;
  designation: string;
  password: string;
  mobile?: string | null;
  createdBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `USER-${crypto.randomUUID()}`;
  const name = input.name.trim();
  const designation = input.designation.trim();
  const email = input.email.trim();
  const mobile = input.mobile != null ? String(input.mobile).trim() : '';
  const password = String(input.password ?? '');

  if (!name) throw new Error('Name is required');
  if (!email) throw new Error('Email is required');
  if (!designation) throw new Error('Designation is required');
  if (!password.trim()) throw new Error('Password is required');

  const passwordHash = hashPassword(password);

  await db.run(
    `INSERT INTO users (id, name, role, phone, email, password_hash, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id,
    name,
    designation,
    mobile || null,
    email,
    passwordHash,
    1,
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'users',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );

  return { id, name, email, designation, mobile: mobile || null, hasPassword: true } satisfies UserRow;
}

export async function updateUser(input: {
  id: string;
  name: string;
  email: string;
  designation: string;
  password?: string | null;
  mobile?: string | null;
  updatedBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = input.name.trim();
  const designation = input.designation.trim();
  const email = input.email.trim();
  const mobile = input.mobile != null ? String(input.mobile).trim() : '';
  const password = input.password != null ? String(input.password) : '';

  if (!id) throw new Error('User id is required');
  if (!name) throw new Error('Name is required');
  if (!email) throw new Error('Email is required');
  if (!designation) throw new Error('Designation is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ?', id);
  if (!existing?.id) throw new Error('User not found');

  if (password.trim()) {
    const passwordHash = hashPassword(password);
    await db.run(
      `UPDATE users SET name = ?, role = ?, phone = ?, email = ?, password_hash = ? WHERE id = ?`,
      name,
      designation,
      mobile || null,
      email,
      passwordHash,
      id
    );
  } else {
    await db.run(`UPDATE users SET name = ?, role = ?, phone = ?, email = ? WHERE id = ?`, name, designation, mobile || null, email, id);
  }

  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'users',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );

  const row = await db.get<any>(
    `SELECT id,
            name,
            role as designation,
            email,
            phone as mobile,
            password_hash as passwordHash
     FROM users
     WHERE id = ?`,
    id
  );
  if (!row) throw new Error('User not found');
  return {
    id: String(row.id),
    name: String(row.name),
    email: row.email != null ? String(row.email) : null,
    designation: String(row.designation ?? ''),
    mobile: row.mobile != null ? String(row.mobile) : null,
    hasPassword: Boolean(row.passwordHash),
  } satisfies UserRow;
}

export async function deleteUser(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('User id is required');

  await db.run(`DELETE FROM users WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'users',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    null
  );
  return { ok: true };
}

export async function createStore(input: { firmId: string; name: string; location?: string; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `STORE-${crypto.randomUUID()}`;
  const firmId = input.firmId.trim();
  const name = input.name.trim();
  if (!firmId) throw new Error('Firm is required');
  if (!name) throw new Error('Store name is required');
  const firm = await db.get<{ id: string }>('SELECT id FROM firms WHERE id = ?', firmId);
  if (!firm?.id) throw new Error('Firm not found');
  await db.run(
    `INSERT INTO stores (id, firm_id, name, location, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    id,
    firmId,
    name,
    input.location ?? null,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'stores',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return { id, firmId, name, location: input.location ?? null };
}

export async function updateStore(input: {
  id: string;
  firmId: string;
  name: string;
  location?: string | null;
  updatedBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const firmId = input.firmId.trim();
  const name = input.name.trim();
  if (!id) throw new Error('Store id is required');
  if (!firmId) throw new Error('Firm is required');
  if (!name) throw new Error('Store name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM stores WHERE id = ?', id);
  if (!existing?.id) throw new Error('Store not found');
  const firm = await db.get<{ id: string }>('SELECT id FROM firms WHERE id = ?', firmId);
  if (!firm?.id) throw new Error('Firm not found');

  await db.run(
    `UPDATE stores SET firm_id = ?, name = ?, location = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    firmId,
    name,
    input.location ?? null,
    input.updatedBy ?? 'system',
    now,
    id
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'stores',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );

  return { id, firmId, name, location: input.location ?? null };
}

export async function deleteStore(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Store id is required');

  await db.run(`DELETE FROM stores WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'stores',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    null
  );
  return { ok: true };
}

export async function listSuppliers() {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>(
    'SELECT id, name, gst_number as gstNumber, payment_terms as paymentTerms FROM suppliers ORDER BY created_at DESC'
  );
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    gstNumber: r.gstNumber ?? null,
    paymentTerms: r.paymentTerms ?? null,
  }));
}

export async function createSupplier(input: { name: string; gstNumber?: string; paymentTerms?: string; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `SUP-${crypto.randomUUID()}`;
  const name = input.name.trim();
  if (!name) throw new Error('Supplier name is required');
  await db.run(
    `INSERT INTO suppliers (id, name, gst_number, payment_terms, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    id,
    name,
    input.gstNumber ?? null,
    input.paymentTerms ?? null,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'suppliers',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return { id, name, gstNumber: input.gstNumber ?? null, paymentTerms: input.paymentTerms ?? null };
}

export async function updateSupplier(input: { id: string; name: string; gstNumber?: string | null; paymentTerms?: string | null; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = input.name.trim();
  if (!id) throw new Error('Supplier id is required');
  if (!name) throw new Error('Supplier name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM suppliers WHERE id = ?', id);
  if (!existing?.id) throw new Error('Supplier not found');

  await db.run(
    `UPDATE suppliers SET name = ?, gst_number = ?, payment_terms = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    name,
    input.gstNumber ?? null,
    input.paymentTerms ?? null,
    input.updatedBy ?? 'system',
    now,
    id
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'suppliers',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );
  return { id, name, gstNumber: input.gstNumber ?? null, paymentTerms: input.paymentTerms ?? null };
}

export async function deleteSupplier(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Supplier id is required');

  await db.run(`DELETE FROM suppliers WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'suppliers',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    null
  );
  return { ok: true };
}

export async function listItemNames() {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>('SELECT id, name, category FROM item_names ORDER BY created_at DESC');
  return (rows ?? []).map((r) => ({ id: String(r.id), name: String(r.name), category: r.category ?? null }));
}

export async function createItemName(input: { name: string; category?: string; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `INAME-${crypto.randomUUID()}`;
  const name = input.name.trim();
  if (!name) throw new Error('Item name is required');
  await db.run(
    `INSERT INTO item_names (id, name, category, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)`,
    id,
    name,
    input.category ?? null,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'item_names',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return { id, name, category: input.category ?? null };
}

export async function updateItemName(input: { id: string; name: string; category?: string | null; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = input.name.trim();
  if (!id) throw new Error('Item Name id is required');
  if (!name) throw new Error('Item Name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM item_names WHERE id = ?', id);
  if (!existing?.id) throw new Error('Item Name not found');

  await db.run(
    `UPDATE item_names SET name = ?, category = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    name,
    input.category ?? null,
    input.updatedBy ?? 'system',
    now,
    id
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'item_names',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );

  return { id, name, category: input.category ?? null };
}

export async function deleteItemName(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Item Name id is required');

  await db.run(`DELETE FROM item_names WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'item_names',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    null
  );
  return { ok: true };
}

export async function listSpecifications() {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>('SELECT id, name FROM specifications ORDER BY created_at DESC');
  return (rows ?? []).map((r) => ({ id: String(r.id), name: String(r.name) }));
}

export async function createSpecification(input: { name: string; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `SPEC-${crypto.randomUUID()}`;
  const name = input.name.trim();
  if (!name) throw new Error('Specification name is required');
  await db.run(
    `INSERT INTO specifications (id, name, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?)`,
    id,
    name,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'specifications',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return { id, name };
}

export async function updateSpecification(input: { id: string; name: string; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = input.name.trim();
  if (!id) throw new Error('Specification id is required');
  if (!name) throw new Error('Specification name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM specifications WHERE id = ?', id);
  if (!existing?.id) throw new Error('Specification not found');

  await db.run(`UPDATE specifications SET name = ?, updated_by = ?, updated_at = ? WHERE id = ?`, name, input.updatedBy ?? 'system', now, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'specifications',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );

  return { id, name };
}

export async function deleteSpecification(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Specification id is required');

  await db.run(`DELETE FROM specifications WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'specifications',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    null
  );
  return { ok: true };
}

export async function listSpecificationValues(specificationId: string) {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>(
    `SELECT id, specification_id as specificationId, value, is_active as isActive
     FROM specification_values
     WHERE specification_id = ?
       AND is_active = 1
     ORDER BY value ASC`,
    specificationId
  );
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    specificationId: String(r.specificationId),
    value: String(r.value),
    isActive: Boolean(r.isActive),
  }));
}

export async function createSpecificationValue(input: { specificationId: string; value: string; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `SVAL-${crypto.randomUUID()}`;
  const specificationId = input.specificationId.trim();
  const value = input.value.trim();
  if (!specificationId) throw new Error('Specification is required');
  if (!value) throw new Error('Value is required');
  const spec = await db.get<{ id: string }>('SELECT id FROM specifications WHERE id = ?', specificationId);
  if (!spec?.id) throw new Error('Specification not found');
  await db.run(
    `INSERT INTO specification_values (id, specification_id, value, is_active, created_by, created_at, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id,
    specificationId,
    value,
    1,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'specification_values',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return { id, specificationId, value, isActive: true };
}

export async function updateSpecificationValue(input: {
  id: string;
  specificationId: string;
  value: string;
  updatedBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const specificationId = String(input.specificationId ?? '').trim();
  const value = String(input.value ?? '').trim();
  if (!id) throw new Error('Spec Value id is required');
  if (!specificationId) throw new Error('Specification is required');
  if (!value) throw new Error('Value is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM specification_values WHERE id = ?', id);
  if (!existing?.id) throw new Error('Spec Value not found');
  const spec = await db.get<{ id: string }>('SELECT id FROM specifications WHERE id = ?', specificationId);
  if (!spec?.id) throw new Error('Specification not found');

  await db.run(
    `UPDATE specification_values SET specification_id = ?, value = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    specificationId,
    value,
    input.updatedBy ?? 'system',
    now,
    id
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'specification_values',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );

  return { id, specificationId, value };
}

export async function deleteSpecificationValue(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Spec Value id is required');

  await db.run(`UPDATE specification_values SET is_active = 0, updated_by = ?, updated_at = ? WHERE id = ?`, input.deletedBy ?? 'system', now, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'specification_values',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    null
  );
  return { ok: true };
}

export async function listItems() {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>(
    `SELECT it.id, it.item_name_id as itemNameId, it.item_code as itemCode, it.specifications_json as specificationsJson, it.unique_key as uniqueKey,
            it.description as description, it.unit as unit,
            inames.name as itemName
     FROM items it
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE it.is_active = 1
     ORDER BY it.created_at DESC`
  );
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    itemNameId: String(r.itemNameId),
    itemCode: String(r.itemCode),
    itemName: String(r.itemName),
    specificationsJson: String(r.specificationsJson),
    uniqueKey: String(r.uniqueKey),
    description: r.description ?? null,
    unit: r.unit ?? null,
  }));
}

export async function createItemManual(input: {
  itemNameId: string;
  unit?: string;
  description?: string;
  specs: Array<{ specificationId: string; value: string }>;
  createdBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();

  const itemNameId = String(input.itemNameId ?? '').trim();
  if (!itemNameId) throw new Error('Item Name is required');
  if (!Array.isArray(input.specs) || input.specs.length === 0) throw new Error('At least one specification is required');

  const itemNameRow = await db.get<any>('SELECT id, name FROM item_names WHERE id = ?', itemNameId);
  if (!itemNameRow?.id) throw new Error('Item Name not found');

  const normalizedSpecs = input.specs
    .map((s) => ({
      specificationId: String(s.specificationId ?? '').trim(),
      value: String(s.value ?? '').trim(),
    }))
    .filter((s) => s.specificationId && s.value);
  if (normalizedSpecs.length === 0) throw new Error('At least one valid specification/value is required');

  const specObj: Record<string, string> = {};
  for (const s of normalizedSpecs) {
    const specRow = await db.get<any>('SELECT id, name FROM specifications WHERE id = ?', s.specificationId);
    if (!specRow?.id) throw new Error('Specification not found');
    const specName = String(specRow.name);
    specObj[specName] = s.value;

    const existingVal = await db.get<{ id: string }>(
      'SELECT id FROM specification_values WHERE specification_id = ? AND value = ?',
      s.specificationId,
      s.value
    );
    if (!existingVal?.id) {
      await db.run(
        `INSERT INTO specification_values (id, specification_id, value, is_active, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        `SVAL-${crypto.randomUUID()}`,
        s.specificationId,
        s.value,
        1,
        input.createdBy ?? 'system',
        now,
        input.createdBy ?? 'system',
        now
      );
    }
  }

  const uniqueKey = computeUniqueKey(String(itemNameRow.name), specObj);

  const existing = await db.get<{ id: string }>('SELECT id FROM items WHERE unique_key = ?', uniqueKey);
  if (existing?.id) throw new Error('Duplicate item combination (same Item Name + Specifications) already exists');

  const itemId = `ITEM-${crypto.randomUUID()}`;
  const itemCode = `ITEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  await db.run(
    `INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, is_active, created_by, created_at, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    itemId,
    itemNameId,
    itemCode,
    JSON.stringify(specObj),
    uniqueKey,
    input.description?.trim() || null,
    input.unit?.trim() || null,
    1,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
     VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'items',
    itemId,
    'create',
    input.createdBy ?? 'system',
    now,
    'Manual item create'
  );

  return {
    id: itemId,
    itemCode,
    itemName: String(itemNameRow.name),
    specificationsJson: JSON.stringify(specObj),
    uniqueKey,
  };
}

export async function updateItemManual(input: {
  id: string;
  itemNameId: string;
  unit?: string;
  description?: string;
  specs: Array<{ specificationId: string; value: string }>;
  updatedBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();

  const id = String(input.id ?? '').trim();
  const itemNameId = String(input.itemNameId ?? '').trim();
  if (!id) throw new Error('Item id is required');
  if (!itemNameId) throw new Error('Item Name is required');
  if (!Array.isArray(input.specs) || input.specs.length === 0) throw new Error('At least one specification is required');

  const existingItem = await db.get<{ id: string }>('SELECT id FROM items WHERE id = ? AND is_active = 1', id);
  if (!existingItem?.id) throw new Error('Item not found');

  const itemNameRow = await db.get<any>('SELECT id, name FROM item_names WHERE id = ?', itemNameId);
  if (!itemNameRow?.id) throw new Error('Item Name not found');

  const normalizedSpecs = input.specs
    .map((s) => ({ specificationId: String(s.specificationId ?? '').trim(), value: String(s.value ?? '').trim() }))
    .filter((s) => s.specificationId && s.value);
  if (normalizedSpecs.length === 0) throw new Error('At least one valid specification/value is required');

  const specObj: Record<string, string> = {};
  for (const s of normalizedSpecs) {
    const specRow = await db.get<any>('SELECT id, name FROM specifications WHERE id = ?', s.specificationId);
    if (!specRow?.id) throw new Error('Specification not found');
    const specName = String(specRow.name);
    specObj[specName] = s.value;

    const existingVal = await db.get<{ id: string }>(
      'SELECT id FROM specification_values WHERE specification_id = ? AND value = ?',
      s.specificationId,
      s.value
    );
    if (!existingVal?.id) {
      await db.run(
        `INSERT INTO specification_values (id, specification_id, value, is_active, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        `SVAL-${crypto.randomUUID()}`,
        s.specificationId,
        s.value,
        1,
        input.updatedBy ?? 'system',
        now,
        input.updatedBy ?? 'system',
        now
      );
    }
  }

  const uniqueKey = computeUniqueKey(String(itemNameRow.name), specObj);
  const dup = await db.get<{ id: string }>('SELECT id FROM items WHERE unique_key = ? AND id <> ? AND is_active = 1', uniqueKey, id);
  if (dup?.id) throw new Error('Duplicate item combination (same Item Name + Specifications) already exists');

  await db.run(
    `UPDATE items
       SET item_name_id = ?,
           specifications_json = ?,
           unique_key = ?,
           description = ?,
           unit = ?,
           updated_by = ?,
           updated_at = ?
     WHERE id = ?`,
    itemNameId,
    JSON.stringify(specObj),
    uniqueKey,
    input.description?.trim() || null,
    input.unit?.trim() || null,
    input.updatedBy ?? 'system',
    now,
    id
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
     VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'items',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    'Manual item update'
  );

  return {
    id,
    itemNameId,
    itemName: String(itemNameRow.name),
    specificationsJson: JSON.stringify(specObj),
    uniqueKey,
    description: input.description?.trim() || null,
    unit: input.unit?.trim() || null,
  };
}

export async function deleteItem(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Item id is required');

  await db.run(`UPDATE items SET is_active = 0, updated_by = ?, updated_at = ? WHERE id = ?`, input.deletedBy ?? 'system', now, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
     VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'items',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    'Soft delete'
  );
  return { ok: true };
}
