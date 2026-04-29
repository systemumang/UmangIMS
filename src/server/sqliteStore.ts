import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { getDb, type Db } from '../../server/db';

export type PrStatus = 'Pending Approval' | 'Approved' | 'Rejected';
export type PoStatus = 'Open' | 'Partial' | 'Closed';
export type InvoiceStatus = 'Recorded' | 'On Hold' | 'Approved' | 'Paid';

export type FirmRow = {
  id: string;
  name: string;
  sortName?: string | null;
  cin?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  termsConditions?: string | null;
};
export type DepartmentRow = { id: string; name: string };

export type PrRow = {
  id: string;
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string;
  requisitionDate?: string;
  requestType?: 'Stock' | 'Project';
  projectId?: string | null;
  projectName?: string | null;
  status: PrStatus;
};

export type PrItemRow = {
  id: string;
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
  status: PoStatus;
  createdAt: string;
  checkPo?: boolean;
  checkPoUserId?: string | null;
  checkDate?: string | null;
  sentBy?: string | null;
  sentDate?: string | null;
  sentProof?: string | null;
};

export type PoItemRow = {
  poId: string;
  itemId: string;
  item: string;
  specificationsJson?: string;
  quantity: number;
  rate: number;
  discountPercent?: number;
  taxPercent?: number;
  goodsAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
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
			  invoiceAmount?: number;
				  courierCharge?: number;
				  packingCharge?: number;
				  labourCharge?: number;
				  otherCharge?: number;
				  chargesGstAmount?: number;
				  status: InvoiceStatus;
			  paymentStatus?: string;
			  paymentDate?: string;
			  holdReason?: string;
		  documentUrl?: string;
		  cnCopyUrl?: string;
		  ewayBillNumber?: string;
		  cnNumber?: string;
		  courierNumber?: string;
		  transporterName?: string;
		  createdBy?: string;
		  createdAt: string;
		  updatedBy?: string;
		  updatedAt?: string;
		};

export type InvoiceItemRow = {
		  id: string;
		  invoiceId: string;
		  itemId: string;
		  item: string;
		  quantity: number;
		  rate: number;
		  taxPercent?: number;
		};

export type InvoiceWithItems = { invoice: InvoiceRow; items: InvoiceItemRow[]; logistics?: LogisticsRow };

export type GrnRow = {
  id: string;
  poId: string;
  invoiceId: string;
  receivedDate: string;
  createdAt: string;
  updatedBy?: string;
  materialReceivedBy?: string | null;
  goodsCollectedBy?: string | null;
};

export type GrnItemRow = {
  id: string;
  grnId: string;
  itemId: string;
  item: string;
  specificationsJson?: string;
  quantityReceived: number;
};
export type GrnWithItems = { grn: GrnRow; items: GrnItemRow[] };

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
      const message = e instanceof Error ? e.message : String(e);
      const duplicateColumn =
        message.toLowerCase().includes('duplicate column name') &&
        id === '018_add_firm_sort_name';
      if (duplicateColumn) {
        await db.exec('ROLLBACK');
        await db.run('INSERT INTO migrations (id, name, applied_at) VALUES (?,?,?)', id, file, now);
        continue;
      }
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
  const now = new Date();

  function getIstParts(d: Date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const byType: Record<string, string> = {};
    for (const p of parts) if (p.type !== 'literal') byType[p.type] = p.value;
    const year = Number(byType.year ?? NaN);
    const month = Number(byType.month ?? NaN); // 1-12
    const day = Number(byType.day ?? NaN);
    return { year, month, day };
  }

  const prefix =
    kind === 'PR' || kind === 'PO'
      ? (() => {
          const { year, month } = getIstParts(now);
          if (!Number.isFinite(year) || !Number.isFinite(month)) throw new Error('Failed to compute FY for document number');
          const fyStart = month >= 4 ? year : year - 1;
          const fyEnd = fyStart + 1;
          const start2 = String(fyStart % 100).padStart(2, '0');
          const end2 = String(fyEnd % 100).padStart(2, '0');
          return `#${kind}-${start2}-${end2}/`;
        })()
      : `#${kind}-${now.getFullYear()}-`;
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
	  const rows = await db.all<
	    {
	      id: string;
	      name: string;
	      sort_name?: string | null;
	      cin?: string | null;
	      gst_number?: string | null;
	      address?: string | null;
      phone?: string | null;
      logo_url?: string | null;
      terms_conditions?: string | null;
    }[]
	  >('SELECT id, name, sort_name, cin, gst_number, address, phone, logo_url, terms_conditions FROM firms ORDER BY name ASC');
	  return (rows ?? []).map((r) => ({
	    id: r.id,
	    name: r.name,
	    sortName: r.sort_name ?? null,
	    cin: r.cin ?? null,
    gstNumber: r.gst_number ?? null,
    address: r.address ?? null,
    phone: r.phone ?? null,
    logoUrl: r.logo_url ?? null,
    termsConditions: r.terms_conditions ?? null,
  }));
}

export async function listDepartments(): Promise<DepartmentRow[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<{ id: string; name: string }[]>('SELECT id, name FROM departments ORDER BY name ASC');
  return (rows ?? []).map((r) => ({ id: r.id, name: r.name }));
}

export type PurchaseRequestRow = {
  id: string;
  firmId: string;
  department: string;
  requestedBy: string;
  requiredDate: string;
  requisitionDate: string;
  requestType?: 'Stock' | 'Project';
  projectId?: string | null;
  projectName?: string | null;
  status: PrStatus;
};

export async function readRequests(): Promise<PurchaseRequestRow[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>(
    `SELECT id,
            firm_id as firmId,
            project_id as projectId,
            (SELECT name FROM projects p WHERE p.id = pr.project_id) as projectName,
            requested_by as requestedBy,
            request_type as requestType,
            status,
            remarks,
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
    requisitionDate: String(r.createdAt ?? ''),
    requestType: String(r.requestType ?? '').trim() === 'Project' ? 'Project' : 'Stock',
    projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
    projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
    status: mapPrStatus(String(r.status)),
  }));
}

export async function getPr(id: string): Promise<PrWithItems | null> {
  await initDb();
  const db = await getDb();
  const pr = await db.get<any>(
    `SELECT pr.id as id,
            pr.firm_id as firmId,
            pr.project_id as projectId,
            prj.name as projectName,
            pr.requested_by as requestedBy,
            pr.request_type as requestType,
            pr.status as status,
            pr.remarks as remarks,
            pr.created_at as createdAt
       FROM purchase_requisitions pr
  LEFT JOIN projects prj ON prj.id = pr.project_id
      WHERE pr.id = ?`,
    id
  );
  if (!pr) return null;

  const items = await db.all<any[]>(
    `SELECT pri.id as id,
            pri.item_id as itemId,
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
      id: String(r.id),
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
      requisitionDate: String(pr.createdAt ?? ''),
      requestType: String(pr.requestType ?? '').trim() === 'Project' ? 'Project' : 'Stock',
      projectId: pr.projectId != null && String(pr.projectId).trim() ? String(pr.projectId) : null,
      projectName: pr.projectName != null && String(pr.projectName).trim() ? String(pr.projectName) : null,
      status: mapPrStatus(String(pr.status)),
    },
    items: prItems,
  };
}

export async function createRequest(input: {
  firmId: string;
  requestType?: 'Stock' | 'Project';
  projectId?: string | null;
  department: string;
  requestedBy: string;
  requiredDate: string;
  items: Array<{ item: string; quantity: number; specification: string }>;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();

  const requestType = input.requestType === 'Project' ? 'Project' : 'Stock';
  const projectId = requestType === 'Project' ? String(input.projectId ?? '').trim() : '';
  if (requestType === 'Project' && !projectId) throw new Error('Project is required when request type is Project');

  const prNumber = await nextDocNumber(db, 'PR');
  const prId = prNumber;
  const storeId = await ensureStoreForFirm(db, input.firmId);

  if (requestType === 'Project') {
    const exists = await db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
    if (!exists?.id) throw new Error('Selected project not found');
  }

  await db.exec('BEGIN');
  try {
    await db.run(
      `INSERT INTO purchase_requisitions (id, pr_number, firm_id, store_id, project_id, requested_by, request_type, status, remarks, created_by, created_at, updated_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      prId,
      prNumber,
      input.firmId,
      storeId,
      requestType === 'Project' ? projectId : null,
      input.requestedBy,
      requestType,
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

export type ProjectRow = {
  id: string;
  firmId: string;
  name: string;
  clientName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
};

export async function listProjects(): Promise<ProjectRow[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>(
    `SELECT id,
            firm_id as firmId,
            name,
            client_name as clientName,
            start_date as startDate,
            end_date as endDate,
            status
     FROM projects
     ORDER BY name ASC`
  );
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    firmId: String(r.firmId),
    name: String(r.name),
    clientName: r.clientName != null ? String(r.clientName) : null,
    startDate: r.startDate != null ? String(r.startDate) : null,
    endDate: r.endDate != null ? String(r.endDate) : null,
    status: r.status != null ? String(r.status) : null,
  }));
}

export async function getLastSupplierByItemIds(
  itemIds: string[]
): Promise<Record<string, { supplierId: string; supplierName: string; rate: number }>> {
  await initDb();
  const db = await getDb();

  const ids = (Array.isArray(itemIds) ? itemIds : [])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
  const uniq = Array.from(new Set(ids));
  if (!uniq.length) return {};

  const placeholders = uniq.map(() => '?').join(',');
  const rows = await db.all<any[]>(
    `SELECT itemId, supplierId, supplierName, rate
       FROM (
         SELECT poi.item_id as itemId,
                po.supplier_id as supplierId,
                s.name as supplierName,
                poi.rate as rate,
                ROW_NUMBER() OVER (PARTITION BY poi.item_id ORDER BY po.created_at DESC, poi.created_at DESC) as rn
           FROM purchase_order_items poi
           JOIN purchase_orders po ON po.id = poi.po_id
           JOIN suppliers s ON s.id = po.supplier_id
          WHERE poi.item_id IN (${placeholders})
       )
      WHERE rn = 1`,
    ...uniq
  );

  const out: Record<string, { supplierId: string; supplierName: string; rate: number }> = {};
  for (const r of rows ?? []) {
    const itemId = String(r.itemId ?? '').trim();
    if (!itemId) continue;
    const supplierId = String(r.supplierId ?? '').trim();
    const supplierName = String(r.supplierName ?? '').trim();
    const rate = Number(r.rate ?? 0);
    if (!supplierId || !supplierName) continue;
    out[itemId] = { supplierId, supplierName, rate: Number.isFinite(rate) ? rate : 0 };
  }
  return out;
}

export async function createProject(input: {
  firmId: string;
  name: string;
  clientName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  createdBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();

  const firmId = String(input.firmId ?? '').trim();
  const name = String(input.name ?? '').trim();
  const clientName = input.clientName != null ? String(input.clientName).trim() : null;
  const startDate = input.startDate != null ? String(input.startDate).trim() : null;
  const endDate = input.endDate != null ? String(input.endDate).trim() : null;
  const status = input.status != null ? String(input.status).trim() : null;

  if (!firmId) throw new Error('Firm is required');
  if (!name) throw new Error('Project name is required');

  const firm = await db.get<{ id: string }>('SELECT id FROM firms WHERE id = ?', firmId);
  if (!firm?.id) throw new Error('Firm not found');

  const id = `PROJ-${crypto.randomUUID()}`;
  await db.run(
    `INSERT INTO projects (id, firm_id, name, client_name, start_date, end_date, status, created_by, created_at, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    firmId,
    name,
    clientName,
    startDate,
    endDate,
    status,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'projects',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return { id, firmId, name, clientName, startDate, endDate, status } satisfies ProjectRow;
}

export async function updateProject(input: {
  id: string;
  firmId: string;
  name: string;
  clientName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  updatedBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();

  const id = String(input.id ?? '').trim();
  const firmId = String(input.firmId ?? '').trim();
  const name = String(input.name ?? '').trim();
  const clientName = input.clientName != null ? String(input.clientName).trim() : null;
  const startDate = input.startDate != null ? String(input.startDate).trim() : null;
  const endDate = input.endDate != null ? String(input.endDate).trim() : null;
  const status = input.status != null ? String(input.status).trim() : null;

  if (!id) throw new Error('Project id is required');
  if (!firmId) throw new Error('Firm is required');
  if (!name) throw new Error('Project name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', id);
  if (!existing?.id) throw new Error('Project not found');

  const firm = await db.get<{ id: string }>('SELECT id FROM firms WHERE id = ?', firmId);
  if (!firm?.id) throw new Error('Firm not found');

  await db.run(
    `UPDATE projects
       SET firm_id = ?,
           name = ?,
           client_name = ?,
           start_date = ?,
           end_date = ?,
           status = ?,
           updated_by = ?,
           updated_at = ?
     WHERE id = ?`,
    firmId,
    name,
    clientName,
    startDate,
    endDate,
    status,
    input.updatedBy ?? 'system',
    now,
    id
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'projects',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );
  return { id, firmId, name, clientName, startDate, endDate, status } satisfies ProjectRow;
}

export async function deleteProject(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();

  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Project id is required');

  await db.run(`DELETE FROM projects WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'projects',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    null
  );
  return { ok: true };
}

export async function decidePr(input: {
  prId: string;
  decision: 'approve' | 'reject';
  approver: string;
  rejectReason?: string;
  items?: Array<{ id: string; quantity: number; itemId?: string; item?: string; specification?: string }>;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const pr = await db.get<any>('SELECT id FROM purchase_requisitions WHERE id = ?', input.prId);
  if (!pr) throw new Error('PR not found');

  const normalizedItems =
    input.decision === 'approve' && Array.isArray(input.items)
      ? input.items
          .map((it) => ({
            id: String((it as any)?.id ?? '').trim(),
            quantity: Number((it as any)?.quantity ?? 0),
            itemId: String((it as any)?.itemId ?? '').trim() || null,
            item: String((it as any)?.item ?? '').trim() || null,
            specification: (it as any)?.specification != null ? String((it as any)?.specification) : null,
          }))
          .filter((it) => it.id && Number.isFinite(it.quantity) && it.quantity > 0)
      : null;

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
      if (normalizedItems) {
        if (!normalizedItems.length) throw new Error('At least one valid PR item is required for approval');

        const existingRows = await db.all<{ id: string; required_date?: string | null }[]>(
          'SELECT id, required_date FROM purchase_requisition_items WHERE pr_id = ?',
          input.prId
        );
        const existingIds = new Set((existingRows ?? []).map((r) => String((r as any)?.id ?? '').trim()).filter(Boolean));
        const requiredDate =
          String((existingRows?.[0] as any)?.required_date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);

        const keepExistingIds = new Set(normalizedItems.filter((it) => existingIds.has(it.id)).map((it) => it.id));
        const toDelete = Array.from(existingIds).filter((id) => !keepExistingIds.has(id));
        if (toDelete.length) {
          const placeholders = toDelete.map(() => '?').join(',');
          await db.run(
            `DELETE FROM purchase_requisition_items WHERE pr_id = ? AND id IN (${placeholders})`,
            input.prId,
            ...toDelete
          );
        }

        for (const it of normalizedItems) {
          const isExisting = existingIds.has(it.id);
          const allowNew = String(it.id).startsWith('NEW-');
          if (!isExisting && !allowNew) throw new Error('Invalid PR item id');

          let nextItemId = it.itemId ? String(it.itemId).trim() : '';
          if (it.item) {
            const ensured = await ensureItem(db, it.item, it.specification ?? '');
            nextItemId = ensured.itemId;
          }
          if (!nextItemId) throw new Error('Item is required');

          if (isExisting) {
            await db.run(
              `UPDATE purchase_requisition_items
                 SET item_id=?,
                     requested_qty=?,
                     approved_qty=?,
                     status='approved',
                     approved_by=?,
                     approved_at=?,
                     updated_by=?,
                     updated_at=?
               WHERE pr_id=? AND id=?`,
              nextItemId,
              it.quantity,
              it.quantity,
              input.approver,
              now,
              input.approver,
              now,
              input.prId,
              it.id
            );
          } else {
            const prItemId = `PRI-${crypto.randomUUID()}`;
            await db.run(
              `INSERT INTO purchase_requisition_items
                 (id, pr_id, item_id, requested_qty, approved_qty, required_date, remarks, status, approved_by, approved_at, created_by, created_at, updated_by, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              prItemId,
              input.prId,
              nextItemId,
              it.quantity,
              it.quantity,
              requiredDate,
              null,
              'approved',
              input.approver,
              now,
              input.approver,
              now,
              input.approver,
              now
            );
          }
        }
      } else {
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
      }
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
  const supplier = await db.get<any>(
    'SELECT id, name, gst_number as gstNumber, gst_type as gstType, address, phone FROM suppliers WHERE id = ?',
    String(po.supplier_id)
  );
	  const items = await db.all<any[]>(
	    `SELECT poi.item_id as itemId,
	            poi.quantity,
	            poi.rate,
	            poi.discount_percent as discountPercent,
	            poi.tax_percent as taxPercent,
	            poi.goods_amount as goodsAmount,
	            poi.tax_amount as taxAmount,
	            poi.total_amount as totalAmount,
	            inames.name as item,
	            it.specifications_json as specificationsJson
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
	      firmId: String(po.firm_id ?? ''),
	      orderDate: po.order_date != null ? String(po.order_date) : undefined,
	      createdBy: po.created_by != null ? String(po.created_by) : undefined,
	      supplierId: String(po.supplier_id ?? ''),
	      supplier: String(supplier?.name ?? ''),
	      supplierGstNumber: supplier?.gstNumber != null ? String(supplier.gstNumber) : null,
	      supplierGstType: supplier?.gstType != null ? String(supplier.gstType) : null,
	      supplierAddress: supplier?.address != null ? String(supplier.address) : null,
	      supplierPhone: supplier?.phone != null ? String(supplier.phone) : null,
	      paymentTerms: String(po.payment_terms ?? ''),
	      shippingAddress: po.shipping_address != null ? String(po.shipping_address) : null,
	      termsConditions: po.terms_conditions != null ? String(po.terms_conditions) : null,
	      status,
		      createdAt: String(po.created_at ?? ''),
		      checkPo: Number(po.check_po ?? 0) ? true : false,
		      checkPoUserId: po.check_po_user_id != null ? String(po.check_po_user_id) : null,
		      checkDate: po.check_date != null ? String(po.check_date) : null,
		      sentBy: po.sent_by != null ? String(po.sent_by) : null,
		      sentDate: po.sent_date != null ? String(po.sent_date) : null,
		      sentProof: po.sent_proof != null ? String(po.sent_proof) : null,
		    },
		    items: (items ?? []).map((r) => ({
		      poId,
		      itemId: String(r.itemId),
		      item: String(r.item),
		      specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
		      quantity: Number(r.quantity ?? 0),
		      rate: Number(r.rate ?? 0),
		      discountPercent: Number(r.discountPercent ?? 0),
		      taxPercent: Number(r.taxPercent ?? 0),
	      goodsAmount: Number(r.goodsAmount ?? 0),
	      taxAmount: Number(r.taxAmount ?? 0),
	      totalAmount: Number(r.totalAmount ?? 0),
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
  shippingAddress?: string | null;
  termsConditions?: string | null;
  items: Array<{ itemId: string; quantity: number; rate: number; discountPercent?: number; taxPercent?: number }>;
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

	  const firm = await db.get<any>('SELECT address, terms_conditions as termsConditions FROM firms WHERE id = ?', String(pr.firmId));
	  const firmAddress = firm?.address != null ? String(firm.address) : '';
	  const firmTermsConditions = firm?.termsConditions != null ? String(firm.termsConditions) : '';
	  const shippingAddress = input.shippingAddress != null ? String(input.shippingAddress) : firmAddress || null;
	  const termsConditions = firmTermsConditions || null;

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
		        (id, po_number, firm_id, store_id, project_id, supplier_id, pr_id, status, order_date, payment_terms, shipping_address, terms_conditions, credit_days, remarks, created_by, created_at, updated_by, updated_at, approved_by, approved_at)
		       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
		      shippingAddress,
		      termsConditions,
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
	      const discountPercent = Number(line.discountPercent ?? 0);
	      const taxPercent = Number(line.taxPercent ?? 0);
	      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new Error('Invalid discount percent');
	      if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) throw new Error('Invalid tax percent');

	      const baseAmount = Number(line.quantity) * Number(line.rate);
	      const afterDiscount = baseAmount - (baseAmount * discountPercent) / 100;
	      const taxAmount = (afterDiscount * taxPercent) / 100;
	      const totalAmount = afterDiscount + taxAmount;
	      await db.run(
	        `INSERT INTO purchase_order_items
	          (id, po_id, item_id, quantity, rate, discount_percent, tax_percent, goods_amount, tax_amount, total_amount, created_by, created_at, updated_by, updated_at)
	         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	        `POI-${crypto.randomUUID()}`,
	        poId,
	        itemId,
	        line.quantity,
	        line.rate,
	        discountPercent,
	        taxPercent,
	        afterDiscount,
	        taxAmount,
	        totalAmount,
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
			    `SELECT ii.id as id, ii.item_id as itemId, ii.quantity, ii.rate, ii.tax_percent as taxPercent, inames.name as item
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
				      invoiceAmount: Number(inv.total_amount ?? 0),
				      courierCharge: Number(inv.courier_charge ?? 0),
				      packingCharge: Number(inv.packing_charge ?? 0),
				      labourCharge: Number(inv.labour_charge ?? 0),
				      otherCharge: Number(inv.other_charge ?? 0),
				      chargesGstAmount: Number(inv.charges_gst_amount ?? 0),
				      status: mapInvoiceStatus(String(inv.status), isPaid),
			      paymentStatus: inv.payment_status != null && String(inv.payment_status).trim() ? String(inv.payment_status) : undefined,
			      paymentDate: inv.payment_date != null && String(inv.payment_date).trim() ? String(inv.payment_date) : undefined,
			      holdReason: inv.status === 'hold' ? 'Invoice on hold' : undefined,
		      documentUrl: inv.document_url ? String(inv.document_url) : undefined,
		      cnCopyUrl: inv.cn_copy_url ? String(inv.cn_copy_url) : undefined,
		      ewayBillNumber: inv.eway_bill_number ? String(inv.eway_bill_number) : undefined,
		      cnNumber: inv.cn_number ? String(inv.cn_number) : undefined,
		      courierNumber: inv.courier_number ? String(inv.courier_number) : undefined,
		      transporterName: inv.transporter_name ? String(inv.transporter_name) : undefined,
		      createdBy: inv.created_by ? String(inv.created_by) : undefined,
		      createdAt: String(inv.created_at),
		      updatedBy: inv.updated_by ? String(inv.updated_by) : undefined,
		      updatedAt: inv.updated_at ? String(inv.updated_at) : undefined,
		    },
			    items: (items ?? []).map((r) => ({
			      invoiceId,
			      id: String(r.id),
			      itemId: String(r.itemId),
			      item: String(r.item),
			      quantity: Number(r.quantity ?? 0),
			      rate: Number(r.rate ?? 0),
			      taxPercent: Number(r.taxPercent ?? 0),
			    })),
			    logistics,
			  };
			}

export async function listInvoicesByPrId(prId: string): Promise<InvoiceWithItems[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<{ id: string }[]>(
    `SELECT inv.id as id
     FROM invoices inv
     JOIN purchase_orders po ON po.id = inv.po_id
     WHERE po.pr_id = ?
     ORDER BY inv.created_at DESC`,
    prId
  );
  const out: InvoiceWithItems[] = [];
  for (const r of rows ?? []) {
    const inv = await getInvoiceWithItems(db, String(r.id));
    if (inv) out.push(inv);
  }
  return out;
}

export async function createInvoice(input: { 
				  poId: string; 
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
				  ewayBillNumber?: string;
				  cnNumber?: string;
			  courierNumber?: string;
			  transporterName?: string;
			  items: Array<{ itemId?: string; item?: string; quantity: number; rate: number; taxPercent?: number }> 
			}) {
	  await initDb();
	  const db = await getDb();
	  const po = await db.get<any>('SELECT * FROM purchase_orders WHERE id = ?', input.poId);
	  if (!po) throw new Error('PO not found');

	  const now = nowIso();
	  const by = input.updatedBy?.trim() ? input.updatedBy.trim() : 'Accounts Team';
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
	  const byItemId = new Map<string, { item: string; poQty: number; poRate: number }>();
	  const itemNameCounts = new Map<string, number>();
	  for (const r of poItems ?? []) {
	    const itemId = String(r.itemId);
	    byItemId.set(itemId, { item: String(r.item), poQty: Number(r.poQty ?? 0), poRate: Number(r.poRate ?? 0) });
	    const name = String(r.item);
	    itemNameCounts.set(name, (itemNameCounts.get(name) ?? 0) + 1);
	  }
	  const uniqueNameToItemId = new Map<string, string>();
	  for (const r of poItems ?? []) {
	    const name = String(r.item);
	    if ((itemNameCounts.get(name) ?? 0) === 1) uniqueNameToItemId.set(name, String(r.itemId));
	  }

		  let goodsAmount = 0;
		  let taxAmount = 0;
		  for (const line of input.items) {
		    const amount = Number(line.quantity) * Number(line.rate);
		    goodsAmount += amount;
		    const tp = Number(line.taxPercent ?? 0);
		    if (Number.isFinite(tp) && tp > 0) taxAmount += (amount * tp) / 100;
		  }
				  const courierCharge = Number(input.courierCharge ?? 0);
				  const packingCharge = Number(input.packingCharge ?? 0);
				  const labourCharge = Number(input.labourCharge ?? 0);
				  const otherCharge = Number(input.otherCharge ?? 0);
				  const chargesGstAmount = Number(input.chargesGstAmount ?? 0);
				  if (!Number.isFinite(chargesGstAmount) || chargesGstAmount < 0) throw new Error('Invalid GST on Charges amount');
				  const computedTotalAmount = goodsAmount + taxAmount + courierCharge + packingCharge + labourCharge + otherCharge + chargesGstAmount;
				  const totalAmount = input.invoiceAmount ?? computedTotalAmount;

	  await db.exec('BEGIN');
	  try {
				    await db.run(
				      `INSERT INTO invoices
				        (id, po_id, supplier_id, invoice_number, invoice_date, goods_amount, tax_amount, total_amount, transport_charges, other_charges, courier_charge, packing_charge, labour_charge, other_charge, charges_gst_amount, status, document_url, cn_copy_url, eway_bill_number, cn_number, courier_number, transporter_name, created_by, created_at, updated_by, updated_at)
				       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			      invoiceId,
			      input.poId,
			      po.supplier_id,
			      invoiceNumber,
			      input.invoiceDate,
			      goodsAmount,
			      taxAmount,
			      totalAmount,
			      0,
			      0,
			      courierCharge,
			      packingCharge,
			      labourCharge,
			      otherCharge,
			      chargesGstAmount,
			      'pending',
			      input.documentUrl || null,
			      input.cnCopyUrl || null,
			      input.ewayBillNumber || null,
				      input.cnNumber || null,
			      input.courierNumber || null,
			      input.transporterName || null,
			      by,
			      now,
			      by,
			      now
			    );

	    for (const line of input.items) {
	      const itemIdRaw = String(line.itemId ?? '').trim();
	      const itemNameRaw = String(line.item ?? '').trim();
	      const itemId = itemIdRaw || (itemNameRaw ? uniqueNameToItemId.get(itemNameRaw) ?? '' : '');
	      if (!itemId) {
	        throw new Error(itemNameRaw ? `Item "${itemNameRaw}" is ambiguous. Please select the exact item/spec.` : 'Item id is required');
	      }
	      const match = byItemId.get(itemId);
	      if (!match) throw new Error(itemNameRaw ? `Item "${itemNameRaw}" is not part of the PO` : `Item "${itemId}" is not part of the PO`);

	      const existingInvoiced = await db.get<{ invoiced: number }>(
	        `SELECT COALESCE(SUM(ii.quantity),0) as invoiced
	         FROM invoice_items ii
	         JOIN invoices inv ON inv.id = ii.invoice_id
	         WHERE inv.po_id = ? AND ii.item_id = ?`,
	        input.poId,
	        itemId
	      );
	      if (Number(existingInvoiced?.invoiced ?? 0) + Number(line.quantity) > match.poQty) {
	        throw new Error(`Total invoiced qty for "${match.item}" cannot exceed PO quantity`);
	      }

	      const amount = Number(line.quantity) * Number(line.rate);
			      const taxPercent = Number(line.taxPercent ?? 0);
			      if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) throw new Error('Invalid GST%');
		      await db.run(
		        `INSERT INTO invoice_items (id, invoice_id, item_id, quantity, rate, amount, tax_percent, created_by, created_at, updated_by, updated_at)
		         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		        `INVI-${crypto.randomUUID()}`,
		        invoiceId,
		        itemId,
		        line.quantity,
		        line.rate,
		        amount,
		        taxPercent,
		        by,
		        now,
		        by,
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
	      by,
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
	    items: Array<{ itemId?: string; item?: string; quantity: number; rate: number; taxPercent?: number }>;
	  }
	) {
  await initDb();
  const db = await getDb();
  const inv = await db.get<any>('SELECT * FROM invoices WHERE id = ?', invoiceId);
  if (!inv) throw new Error('Invoice not found');

  const poId = String(inv.po_id);
  const po = await db.get<any>('SELECT * FROM purchase_orders WHERE id = ?', poId);
  if (!po) throw new Error('PO not found for invoice');

  const now = nowIso();
  const by = input.updatedBy?.trim() ? input.updatedBy.trim() : String(inv.updated_by ?? inv.created_by ?? 'Accounts Team');
  const invoiceNumber = input.supplierInvoiceNo.trim();
  if (!invoiceNumber) throw new Error('Invoice number is required');

  const poItems = await db.all<any[]>(
    `SELECT poi.item_id as itemId, poi.quantity as poQty, poi.rate as poRate, inames.name as item
     FROM purchase_order_items poi
     JOIN items it ON it.id = poi.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE poi.po_id = ?`,
    poId
  );
  const byItemId = new Map<string, { item: string; poQty: number; poRate: number }>();
  const itemNameCounts = new Map<string, number>();
  for (const r of poItems ?? []) {
    const itemId = String((r as any).itemId);
    byItemId.set(itemId, { item: String((r as any).item), poQty: Number((r as any).poQty ?? 0), poRate: Number((r as any).poRate ?? 0) });
    const name = String((r as any).item);
    itemNameCounts.set(name, (itemNameCounts.get(name) ?? 0) + 1);
  }
  const uniqueNameToItemId = new Map<string, string>();
  for (const r of poItems ?? []) {
    const name = String((r as any).item);
    if ((itemNameCounts.get(name) ?? 0) === 1) uniqueNameToItemId.set(name, String((r as any).itemId));
  }

  let goodsAmount = 0;
  let taxAmount = 0;
  for (const line of input.items) {
    const amount = Number(line.quantity) * Number(line.rate);
    goodsAmount += amount;
    const tp = Number(line.taxPercent ?? 0);
    if (Number.isFinite(tp) && tp > 0) taxAmount += (amount * tp) / 100;
  }
	  const courierCharge = Number(input.courierCharge ?? 0);
	  const packingCharge = Number(input.packingCharge ?? 0);
	  const labourCharge = Number(input.labourCharge ?? 0);
	  const otherCharge = Number(input.otherCharge ?? 0);
	  const chargesGstAmount = Number(input.chargesGstAmount ?? 0);
	  if (!Number.isFinite(chargesGstAmount) || chargesGstAmount < 0) throw new Error('Invalid GST on Charges amount');
	  const computedTotalAmount = goodsAmount + taxAmount + courierCharge + packingCharge + labourCharge + otherCharge + chargesGstAmount;
	  const totalAmount = input.invoiceAmount ?? computedTotalAmount;

  await db.exec('BEGIN');
  try {
		    await db.run(
		      `UPDATE invoices
		       SET invoice_number=?, invoice_date=?, goods_amount=?, tax_amount=?, total_amount=?, courier_charge=?, packing_charge=?, labour_charge=?, other_charge=?, charges_gst_amount=?, updated_by=?, updated_at=?
		       WHERE id=?`,
		      invoiceNumber,
		      input.invoiceDate,
		      goodsAmount,
		      taxAmount,
		      totalAmount,
		      courierCharge,
		      packingCharge,
		      labourCharge,
		      otherCharge,
		      chargesGstAmount,
		      by,
		      now,
		      invoiceId
		    );

    // Validate all lines before mutating invoice items
    for (const line of input.items) {
      const itemIdRaw = String(line.itemId ?? '').trim();
      const itemNameRaw = String(line.item ?? '').trim();
      const itemId = itemIdRaw || (itemNameRaw ? uniqueNameToItemId.get(itemNameRaw) ?? '' : '');
      if (!itemId) {
        throw new Error(itemNameRaw ? `Item "${itemNameRaw}" is ambiguous. Please select the exact item/spec.` : 'Item id is required');
      }
      const match = byItemId.get(itemId);
      if (!match) throw new Error(itemNameRaw ? `Item "${itemNameRaw}" is not part of the PO` : `Item "${itemId}" is not part of the PO`);

      const otherInvoiced = await db.get<{ invoiced: number }>(
        `SELECT COALESCE(SUM(ii.quantity),0) as invoiced
         FROM invoice_items ii
         JOIN invoices inv ON inv.id = ii.invoice_id
         WHERE inv.po_id = ? AND ii.item_id = ? AND inv.id != ?`,
        poId,
        itemId,
        invoiceId
      );
      if (Number(otherInvoiced?.invoiced ?? 0) + Number(line.quantity) > match.poQty) {
        throw new Error(`Total invoiced qty for "${match.item}" cannot exceed PO quantity`);
      }
    }

	    await db.run('DELETE FROM invoice_items WHERE invoice_id = ?', invoiceId);
	    for (const line of input.items) {
	      const itemIdRaw = String(line.itemId ?? '').trim();
	      const itemNameRaw = String(line.item ?? '').trim();
	      const itemId = itemIdRaw || (itemNameRaw ? uniqueNameToItemId.get(itemNameRaw) ?? '' : '');
	      const amount = Number(line.quantity) * Number(line.rate);
	      const taxPercent = Number(line.taxPercent ?? 0);
	      if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) throw new Error('Invalid GST%');
	      await db.run(
	        `INSERT INTO invoice_items (id, invoice_id, item_id, quantity, rate, amount, tax_percent, created_by, created_at, updated_by, updated_at)
	         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
	        `INVI-${crypto.randomUUID()}`,
	        invoiceId,
	        itemId,
	        line.quantity,
	        line.rate,
	        amount,
	        taxPercent,
	        by,
	        now,
	        by,
	        now
	      );
	    }

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'invoices',
      invoiceId,
      'update',
      by,
      now,
      `PO ${poId}`.slice(0, 500)
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  const updated = await getInvoiceWithItems(db, invoiceId);
  if (!updated) throw new Error('Failed to update invoice');
  return updated;
}

export async function updateInvoicePayment(invoiceId: string, input: { paymentStatus?: string | null; paymentDate?: string | null; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const inv = await db.get<any>('SELECT id, po_id as poId, created_by as createdBy FROM invoices WHERE id = ?', invoiceId);
  if (!inv) throw new Error('Invoice not found');

  const rawStatus = input.paymentStatus != null ? String(input.paymentStatus).trim() : '';
  const paymentStatus = rawStatus ? rawStatus : null;
  if (paymentStatus && paymentStatus !== 'Partly Paid' && paymentStatus !== 'Full Paid') {
    throw new Error('Invalid payment status');
  }

  const rawDate = input.paymentDate != null ? String(input.paymentDate).trim() : '';
  const paymentDate = rawDate ? rawDate : null;

  const now = nowIso();
  const by = input.updatedBy?.trim() ? input.updatedBy.trim() : 'Accounts Team';

  await db.exec('BEGIN');
  try {
    await db.run(
      `UPDATE invoices
       SET payment_status = ?,
           payment_date = ?,
           updated_by = ?,
           updated_at = ?
       WHERE id = ?`,
      paymentStatus,
      paymentDate,
      by,
      now,
      invoiceId
    );

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'invoices',
      invoiceId,
      'payment_update',
      by,
      now,
      `Payment status/date updated`.slice(0, 500)
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  const updated = await getInvoiceWithItems(db, invoiceId);
  if (!updated) throw new Error('Failed to update invoice payment');
  return updated;
}

export async function deleteInvoice(invoiceId: string) {
  await initDb();
  const db = await getDb();
  const inv = await db.get<any>('SELECT id, po_id as poId, created_by as createdBy, updated_by as updatedBy FROM invoices WHERE id = ?', invoiceId);
  if (!inv) throw new Error('Invoice not found');
  const poId = String(inv.poId ?? '').trim();
  if (!poId) throw new Error('PO not found for invoice');

  const hasPayment = await db.get<any>('SELECT 1 as ok FROM payments WHERE invoice_id = ? LIMIT 1', invoiceId);
  if (hasPayment) throw new Error('Cannot delete invoice after payment is recorded.');

  const hasGrn = await getGrnByPoId(db, poId);
  if (hasGrn) throw new Error('Cannot delete invoice after GRN is created.');

  const now = nowIso();
  const by = String(inv.updatedBy ?? inv.createdBy ?? 'system');

  await db.exec('BEGIN');
  try {
    await db.run('DELETE FROM invoice_items WHERE invoice_id = ?', invoiceId);
    await db.run('DELETE FROM payments WHERE invoice_id = ?', invoiceId);
    await db.run('DELETE FROM invoices WHERE id = ?', invoiceId);

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'invoices',
      invoiceId,
      'delete',
      by,
      now,
      `PO ${poId}`.slice(0, 500)
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true as const };
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
		    `SELECT gi.id as id,
		            gi.item_id as itemId,
		            gi.received_qty as receivedQty,
		            inames.name as item,
		            it.specifications_json as specificationsJson
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
			      updatedBy: grn.updated_by != null ? String(grn.updated_by) : undefined,
			      materialReceivedBy: grn.material_received_by != null ? String(grn.material_received_by) : null,
			      goodsCollectedBy: grn.goods_collected_by != null ? String(grn.goods_collected_by) : null,
				    },
				    items: (items ?? []).map((r) => ({
				      id: String((r as any).id ?? ''),
				      grnId,
			      itemId: String((r as any).itemId),
			      item: String((r as any).item),
			      specificationsJson: (r as any).specificationsJson != null ? String((r as any).specificationsJson) : undefined,
			      quantityReceived: Number((r as any).receivedQty ?? 0),
			    })),
			  };
			}

type CreateGrnLine = { itemId?: string; item?: string; quantityReceived: number };

async function createGrnCore(
  db: Db,
  input: {
    poId: string;
    invoiceId?: string;
    receivedDate: string;
    updatedBy?: string;
    materialReceivedBy?: string | null;
    goodsCollectedBy?: string | null;
    items: CreateGrnLine[];
  }
) {
  const poId = String(input.poId ?? '').trim();
  if (!poId) throw new Error('PO id is required');

  const po = await db.get<any>('SELECT firm_id as firmId, store_id as storeId FROM purchase_orders WHERE id = ?', poId);
  if (!po) throw new Error('PO not found');

  const poItems = await db.all<any[]>(
    `SELECT poi.item_id as itemId, poi.quantity as poQty, inames.name as item
     FROM purchase_order_items poi
     JOIN items it ON it.id = poi.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE poi.po_id = ?`,
    poId
  );
  const byItemId = new Map<string, { item: string; poQty: number }>();
  const itemNameCounts = new Map<string, number>();
  for (const r of poItems ?? []) {
    const itemId = String(r.itemId);
    byItemId.set(itemId, { item: String(r.item), poQty: Number(r.poQty ?? 0) });
    const name = String(r.item);
    itemNameCounts.set(name, (itemNameCounts.get(name) ?? 0) + 1);
  }
  const uniqueNameToItemId = new Map<string, string>();
  for (const r of poItems ?? []) {
    const name = String(r.item);
    if ((itemNameCounts.get(name) ?? 0) === 1) uniqueNameToItemId.set(name, String(r.itemId));
  }

	  const now = nowIso();
	  const grnNumber = await nextDocNumber(db, 'GRN');
	  const grnId = grnNumber;

  const materialReceivedBy = String(input.materialReceivedBy ?? '').trim() || null;
  const goodsCollectedBy = String(input.goodsCollectedBy ?? '').trim() || null;
  if (materialReceivedBy) {
    const u = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND is_active = 1', materialReceivedBy);
    if (!u?.id) throw new Error('Invalid Material Received By user');
  }
  if (goodsCollectedBy) {
    const u = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND is_active = 1', goodsCollectedBy);
    if (!u?.id) throw new Error('Invalid Goods Collected By user');
  }

	  await db.exec('BEGIN');
	  try {
	    await db.run(
	      `INSERT INTO grns (
	         id,
	         grn_number,
	         po_id,
	         firm_id,
	         store_id,
	         received_by,
	         received_date,
	         material_received_by,
	         goods_collected_by,
	         remarks,
	         created_by,
	         created_at,
	         updated_by,
	         updated_at
	       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	      grnId,
	      grnNumber,
	      poId,
	      po.firmId,
	      po.storeId,
	      'Stores Team',
	      input.receivedDate,
	      materialReceivedBy,
	      goodsCollectedBy,
	      null,
	      input.updatedBy || 'Stores Team',
	      now,
	      input.updatedBy || 'Stores Team',
	      now
	    );

    for (const line of input.items) {
      const itemIdRaw = String(line.itemId ?? '').trim();
      const itemNameRaw = String(line.item ?? '').trim();
      const itemId = itemIdRaw || (itemNameRaw ? uniqueNameToItemId.get(itemNameRaw) ?? '' : '');
      if (!itemId) {
        throw new Error(itemNameRaw ? `Item "${itemNameRaw}" is ambiguous. Please select the exact item/spec.` : 'Item id is required');
      }
      const match = byItemId.get(itemId);
      if (!match) throw new Error(itemNameRaw ? `Item "${itemNameRaw}" is not part of the PO` : `Item "${itemId}" is not part of the PO`);
      if (line.quantityReceived > match.poQty) throw new Error(`GRN received qty for "${match.item}" cannot exceed PO quantity`);

      const existingReceived = await db.get<{ received: number }>(
        `SELECT COALESCE(SUM(gi.received_qty),0) as received
         FROM grn_items gi
         JOIN grns g ON g.id = gi.grn_id
         WHERE g.po_id = ? AND gi.item_id = ?`,
        poId,
        itemId
      );
      if (Number(existingReceived?.received ?? 0) + Number(line.quantityReceived) > match.poQty) {
        throw new Error(`Total received qty for "${match.item}" cannot exceed PO quantity`);
      }

      const grnItemId = `GRNI-${crypto.randomUUID()}`;
      await db.run(
        `INSERT INTO grn_items (id, grn_id, item_id, ordered_qty, received_qty, short_qty, damaged_qty, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        grnItemId,
        grnId,
        itemId,
        match.poQty,
        line.quantityReceived,
        null,
        null,
        'Stores Team',
        now,
        'Stores Team',
        now
      );

      if (input.invoiceId) {
        const invItem = await db.get<any>('SELECT id, quantity FROM invoice_items WHERE invoice_id = ? AND item_id = ?', input.invoiceId, itemId);
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
      input.invoiceId ? `Invoice ${input.invoiceId}` : `PO ${poId}`
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

export async function createGrnForPo(input: {
  poId: string;
  receivedDate: string;
  updatedBy?: string;
  materialReceivedBy?: string | null;
  goodsCollectedBy?: string | null;
  items: CreateGrnLine[];
}) {
  await initDb();
  const db = await getDb();
  return createGrnCore(db, { ...input, invoiceId: undefined });
}

export async function createGrn(input: {
  invoiceId: string;
  receivedDate: string;
  updatedBy?: string;
  materialReceivedBy?: string | null;
  goodsCollectedBy?: string | null;
  items: CreateGrnLine[];
}) {
  await initDb();
  const db = await getDb();
  const poId = await findPoForInvoice(db, input.invoiceId);
  return createGrnCore(db, { ...input, poId });
}

export async function updateGrn(input: {
  grnId: string;
  receivedDate: string;
  updatedBy?: string;
  materialReceivedBy?: string | null;
  goodsCollectedBy?: string | null;
}) {
  await initDb();
  const db = await getDb();
  const grn = await db.get<any>('SELECT id, updated_by as updatedBy FROM grns WHERE id = ?', input.grnId);
  if (!grn) throw new Error('GRN not found');
  const now = nowIso();
  const by = input.updatedBy?.trim() ? input.updatedBy.trim() : String(grn.updatedBy ?? 'system');

  const materialReceivedBy = String(input.materialReceivedBy ?? '').trim() || null;
  const goodsCollectedBy = String(input.goodsCollectedBy ?? '').trim() || null;
  if (materialReceivedBy) {
    const u = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND is_active = 1', materialReceivedBy);
    if (!u?.id) throw new Error('Invalid Material Received By user');
  }
  if (goodsCollectedBy) {
    const u = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND is_active = 1', goodsCollectedBy);
    if (!u?.id) throw new Error('Invalid Goods Collected By user');
  }

  await db.run(
    'UPDATE grns SET received_date = ?, material_received_by = ?, goods_collected_by = ?, updated_by = ?, updated_at = ? WHERE id = ?',
    input.receivedDate,
    materialReceivedBy,
    goodsCollectedBy,
    by,
    now,
    input.grnId
  );
  const updated = await getGrnWithItems(db, input.grnId);
  if (!updated) throw new Error('Failed to update GRN');
  return updated;
}

export async function deleteGrn(grnId: string) {
  await initDb();
  const db = await getDb();
  const grn = await db.get<any>('SELECT id, po_id as poId, created_by as createdBy, updated_by as updatedBy FROM grns WHERE id = ?', grnId);
  if (!grn) throw new Error('GRN not found');

  const hasQc = await db.get<any>('SELECT 1 as ok FROM qc_records WHERE grn_id = ? LIMIT 1', grnId);
  if (hasQc) throw new Error('Cannot delete GRN after QC is recorded.');

  const now = nowIso();
  const by = String(grn.updatedBy ?? grn.createdBy ?? 'system');
  const poId = String(grn.poId ?? '');

  await db.exec('BEGIN');
  try {
    const itemIds = await db.all<any[]>('SELECT id FROM grn_items WHERE grn_id = ?', grnId);
    const ids = (itemIds ?? []).map((r) => String((r as any).id ?? '').trim()).filter(Boolean);
    for (const id of ids) {
      await db.run('DELETE FROM grn_invoice_item_links WHERE grn_item_id = ?', id);
    }
    await db.run('DELETE FROM qc_records WHERE grn_id = ?', grnId);
    await db.run('DELETE FROM grn_items WHERE grn_id = ?', grnId);
    await db.run('DELETE FROM grns WHERE id = ?', grnId);

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'grns',
      grnId,
      'delete',
      by,
      now,
      poId ? `PO ${poId}` : null
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true as const };
}

export async function listGrnsByPoId(poId: string): Promise<GrnWithItems[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>('SELECT id FROM grns WHERE po_id = ? ORDER BY created_at DESC', poId);
  const out: GrnWithItems[] = [];
  for (const r of rows ?? []) {
    const grnId = String((r as any)?.id ?? '').trim();
    if (!grnId) continue;
    const grn = await getGrnWithItems(db, grnId);
    if (grn) out.push(grn);
  }
  return out;
}

export async function listGrnsByPrId(prId: string): Promise<GrnWithItems[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>(
    `SELECT g.id as id
     FROM grns g
     JOIN purchase_orders po ON po.id = g.po_id
     WHERE po.pr_id = ?
     ORDER BY g.created_at DESC`,
    prId
  );
  const out: GrnWithItems[] = [];
  for (const r of rows ?? []) {
    const grnId = String((r as any)?.id ?? '').trim();
    if (!grnId) continue;
    const grn = await getGrnWithItems(db, grnId);
    if (grn) out.push(grn);
  }
  return out;
}

export async function listPendingGrnPosByPrId(prId: string): Promise<Array<{ poId: string; pendingQty: number }>> {
  await initDb();
  const db = await getDb();

  const rows = await db.all<any[]>(
    `WITH received AS (
       SELECT g.po_id as poId, gi.item_id as itemId, COALESCE(SUM(gi.received_qty),0) as receivedQty
       FROM grns g
       JOIN grn_items gi ON gi.grn_id = g.id
       GROUP BY g.po_id, gi.item_id
     )
     SELECT po.id as poId,
            SUM(CASE
                  WHEN (poi.quantity - COALESCE(r.receivedQty,0)) > 0 THEN (poi.quantity - COALESCE(r.receivedQty,0))
                  ELSE 0
                END) as pendingQty
     FROM purchase_orders po
     JOIN purchase_order_items poi ON poi.po_id = po.id
     LEFT JOIN received r ON r.poId = po.id AND r.itemId = poi.item_id
     WHERE po.pr_id = ?
     GROUP BY po.id
     HAVING pendingQty > 0
     ORDER BY po.created_at DESC`,
    prId
  );

  return (rows ?? []).map((r) => ({ poId: String((r as any).poId), pendingQty: Number((r as any).pendingQty ?? 0) }));
}

export async function listQcRecordsByPrId(prId: string): Promise<
  Array<{
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
  }>
> {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>(
    `SELECT qr.id as id,
            qr.grn_id as grnId,
            g.po_id as poId,
            qr.item_id as itemId,
            qr.accepted_qty as acceptedQty,
            qr.rejected_qty as rejectedQty,
            qr.remarks as remarks,
            qr.qc_by as qcBy,
            qr.qc_date as qcDate,
            qr.created_at as createdAt,
            qr.updated_by as updatedBy,
            inames.name as item
     FROM qc_records qr
     JOIN grns g ON g.id = qr.grn_id
     JOIN purchase_orders po ON po.id = g.po_id
     JOIN items it ON it.id = qr.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE po.pr_id = ?
     ORDER BY qr.created_at DESC`,
    prId
  );
  return (rows ?? []).map((r) => ({
    id: String((r as any).id),
    grnId: String((r as any).grnId),
    poId: String((r as any).poId),
    itemId: String((r as any).itemId),
    item: String((r as any).item),
    acceptedQty: Number((r as any).acceptedQty ?? 0),
    rejectedQty: Number((r as any).rejectedQty ?? 0),
    remarks: String((r as any).remarks ?? ''),
    qcBy: String((r as any).qcBy ?? ''),
    qcDate: String((r as any).qcDate ?? ''),
    createdAt: String((r as any).createdAt ?? ''),
    updatedBy: (r as any).updatedBy != null ? String((r as any).updatedBy) : undefined,
  }));
}

export async function recordQc(input: { grnId: string; inspectedBy: string; location: string; updatedBy?: string; items: Array<{ itemId?: string; item?: string; quantityAccepted: number; quantityRejected: number; remarks: string }> }) {
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
	  const byItemId = new Map<string, { item: string; receivedQty: number }>();
	  const itemNameCounts = new Map<string, number>();
	  for (const r of grnItems ?? []) {
	    const itemId = String(r.itemId);
	    byItemId.set(itemId, { item: String(r.item), receivedQty: Number(r.receivedQty ?? 0) });
	    const name = String(r.item);
	    itemNameCounts.set(name, (itemNameCounts.get(name) ?? 0) + 1);
	  }
	  const uniqueNameToItemId = new Map<string, string>();
	  for (const r of grnItems ?? []) {
	    const name = String(r.item);
	    if ((itemNameCounts.get(name) ?? 0) === 1) uniqueNameToItemId.set(name, String(r.itemId));
	  }

  await db.exec('BEGIN');
  try {
	    for (const line of input.items) {
	      const itemIdRaw = String(line.itemId ?? '').trim();
	      const itemNameRaw = String(line.item ?? '').trim();
	      const itemId = itemIdRaw || (itemNameRaw ? uniqueNameToItemId.get(itemNameRaw) ?? '' : '');
	      if (!itemId) {
	        throw new Error(itemNameRaw ? `Item "${itemNameRaw}" is ambiguous. Please select the exact item/spec.` : 'Item id is required');
	      }
	      const match = byItemId.get(itemId);
	      if (!match) throw new Error(itemNameRaw ? `Item "${itemNameRaw}" is not part of the GRN` : `Item "${itemId}" is not part of the GRN`);
	      if (line.quantityAccepted + line.quantityRejected > match.receivedQty) throw new Error(`QC qty for "${match.item}" cannot exceed received qty`);

	      await db.run(
	        `INSERT INTO qc_records (id, grn_id, item_id, accepted_qty, rejected_qty, hold_qty, remarks, qc_by, qc_date, created_by, created_at, updated_by, updated_at)
	         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	        `QC-${crypto.randomUUID()}`,
	        input.grnId,
	        itemId,
	        line.quantityAccepted,
	        line.quantityRejected,
	        0,
	        line.remarks ?? null,
	        input.inspectedBy,
        now.slice(0, 10),
        input.updatedBy || input.inspectedBy,
        now,
        input.updatedBy || input.inspectedBy,
        now
      );

	      if (line.quantityAccepted > 0) {
	        await db.run(
	          `INSERT INTO stock_ledger (id, firm_id, store_id, item_id, transaction_type, quantity, reference_type, reference_id, created_by, created_at)
	           VALUES (?,?,?,?,?,?,?,?,?,?)`,
	          `STK-${crypto.randomUUID()}`,
	          grn.firmId,
	          grn.storeId,
	          itemId,
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
	    `SELECT qr.item_id as itemId, qr.accepted_qty as acceptedQty, qr.rejected_qty as rejectedQty, qr.remarks, qr.qc_by as qcBy, qr.created_at as createdAt, inames.name as item
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
		      itemId: String(r.itemId),
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

export async function updatePo(input: {
  poId: string;
  supplierId?: string | null;
  supplier?: string | null;
  paymentTerms: string;
  shippingAddress?: string | null;
  termsConditions?: string | null;
  items: Array<{ itemId: string; quantity: number; rate: number; discountPercent?: number; taxPercent?: number }>;
  updatedBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const poId = String(input.poId ?? '').trim();
  if (!poId) throw new Error('PO id is required');

  const po = await db.get<any>('SELECT * FROM purchase_orders WHERE id = ?', poId);
  if (!po) throw new Error('PO not found');

  const prId = String(po.pr_id ?? '').trim();
  if (!prId) throw new Error('PO is missing PR reference');

  const paymentTerms = String(input.paymentTerms ?? '').trim();
  if (!paymentTerms) throw new Error('Payment terms are required');

  const rawItems = Array.isArray(input.items) ? input.items : [];
  const normalizedItems = rawItems
    .map((it) => ({
      itemId: String((it as any)?.itemId ?? '').trim(),
      quantity: Number((it as any)?.quantity ?? 0),
      rate: Number((it as any)?.rate ?? 0),
      discountPercent: Number((it as any)?.discountPercent ?? 0),
      taxPercent: Number((it as any)?.taxPercent ?? 0),
    }))
    .filter((it) => it.itemId && Number.isFinite(it.quantity) && it.quantity > 0 && Number.isFinite(it.rate) && it.rate >= 0);
  if (!normalizedItems.length) throw new Error('At least one PO item is required');

  const invCount = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM invoices WHERE po_id = ?', poId);
  const grnCount = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM grns WHERE po_id = ?', poId);
  if (Number(invCount?.count ?? 0) > 0 || Number(grnCount?.count ?? 0) > 0) {
    throw new Error('Cannot edit this PO because Invoice/GRN already exists.');
  }

  let supplierId = String(input.supplierId ?? '').trim();
  if (supplierId) {
    const s = await db.get<{ id: string }>('SELECT id FROM suppliers WHERE id = ?', supplierId);
    if (!s?.id) throw new Error('Invalid supplier');
  } else {
    const supplierName = String(input.supplier ?? '').trim();
    if (!supplierName) throw new Error('Supplier is required');
    supplierId = await ensureSupplier(db, supplierName);
  }

  const prItemRows = await db.all<any[]>(
    `SELECT pri.item_id as itemId, pri.approved_qty as approvedQty
     FROM purchase_requisition_items pri
     WHERE pri.pr_id = ? AND pri.status = 'approved'`,
    prId
  );
  const approvedByItemId = new Map<string, number>();
  for (const r of prItemRows ?? []) approvedByItemId.set(String(r.itemId), Number(r.approvedQty ?? 0));

  const otherPoQtyRows = await db.all<any[]>(
    `SELECT poi.item_id as itemId, SUM(poi.quantity) as orderedQty
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.po_id
      WHERE po.pr_id = ? AND po.id <> ?
      GROUP BY poi.item_id`,
    prId,
    poId
  );
  const orderedElsewhereByItemId = new Map<string, number>();
  for (const r of otherPoQtyRows ?? []) orderedElsewhereByItemId.set(String(r.itemId), Number(r.orderedQty ?? 0));

  for (const line of normalizedItems) {
    const approvedQty = approvedByItemId.get(line.itemId);
    if (!Number.isFinite(approvedQty as any)) throw new Error('Invalid PO line item (not part of approved PR)');
    const orderedElsewhere = orderedElsewhereByItemId.get(line.itemId) ?? 0;
    const remaining = Number(approvedQty ?? 0) - Number(orderedElsewhere ?? 0);
    if (Number(line.quantity) > remaining) throw new Error('PO quantity cannot exceed remaining PR quantity');
    if (!Number.isFinite(line.discountPercent) || Number(line.discountPercent) < 0 || Number(line.discountPercent) > 100) throw new Error('Invalid discount percent');
    if (!Number.isFinite(line.taxPercent) || Number(line.taxPercent) < 0 || Number(line.taxPercent) > 100) throw new Error('Invalid tax percent');
  }

  const now = nowIso();
  const updatedBy = String(input.updatedBy ?? '').trim() || 'Purchase Team';

  const firm = await db.get<any>('SELECT terms_conditions as termsConditions FROM firms WHERE id = ?', String(po.firm_id ?? ''));
  const firmTermsConditions = firm?.termsConditions != null ? String(firm.termsConditions) : '';
  const termsConditions = firmTermsConditions || null;

  await db.exec('BEGIN');
  try {
	    await db.run(
	      `UPDATE purchase_orders
	          SET supplier_id = ?,
	              payment_terms = ?,
	              shipping_address = ?,
	              terms_conditions = ?,
	              updated_by = ?,
	              updated_at = ?
	        WHERE id = ?`,
	      supplierId,
	      paymentTerms,
	      input.shippingAddress ?? null,
	      termsConditions,
	      updatedBy,
	      now,
	      poId
	    );

    await db.run('DELETE FROM purchase_order_items WHERE po_id = ?', poId);

    for (const line of normalizedItems) {
      const baseAmount = Number(line.quantity) * Number(line.rate);
      const afterDiscount = baseAmount - (baseAmount * Number(line.discountPercent ?? 0)) / 100;
      const taxAmount = (afterDiscount * Number(line.taxPercent ?? 0)) / 100;
      const totalAmount = afterDiscount + taxAmount;
      await db.run(
        `INSERT INTO purchase_order_items
          (id, po_id, item_id, quantity, rate, discount_percent, tax_percent, goods_amount, tax_amount, total_amount, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `POI-${crypto.randomUUID()}`,
        poId,
        line.itemId,
        line.quantity,
        line.rate,
        Number(line.discountPercent ?? 0),
        Number(line.taxPercent ?? 0),
        afterDiscount,
        taxAmount,
        totalAmount,
        updatedBy,
        now,
        updatedBy,
        now
      );
    }

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'purchase_orders',
      poId,
      'update',
      updatedBy,
      now,
      `Updated PO ${poId}`
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  const updated = await getPoWithItems(db, poId);
  if (!updated) throw new Error('PO not found after update');
  return updated;
}

export async function updatePoCheckAndSent(input: {
  poId: string;
  checkPo?: boolean;
  checkPoUserId?: string | null;
  checkDate?: string | null;
  sentBy?: string | null;
  sentDate?: string | null;
  sentProof?: string | null;
  updatedBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const poId = String(input.poId ?? '').trim();
  if (!poId) throw new Error('PO id is required');

  const existing = await db.get<any>(
    'SELECT id, check_po, check_po_user_id, check_date, sent_by, sent_date, sent_proof FROM purchase_orders WHERE id = ?',
    poId
  );
  if (!existing?.id) throw new Error('PO not found');

  const existingCheckPoUserId = existing.check_po_user_id != null ? String(existing.check_po_user_id).trim() || null : null;
  const existingCheckDate = existing.check_date != null ? String(existing.check_date).trim() || null : null;
  const existingSentBy = existing.sent_by != null ? String(existing.sent_by).trim() || null : null;
  const existingSentDate = existing.sent_date != null ? String(existing.sent_date).trim() || null : null;
  const existingSentProof = existing.sent_proof != null ? String(existing.sent_proof).trim() || null : null;

  let checkPoUserId =
    input.checkPoUserId !== undefined ? (input.checkPoUserId != null ? String(input.checkPoUserId).trim() || null : null) : existingCheckPoUserId;
  const checkPo =
    input.checkPo !== undefined
      ? Boolean(input.checkPo)
      : Boolean(checkPoUserId) || (Number(existing.check_po ?? 0) ? true : false);
  let checkDate = input.checkDate !== undefined ? String(input.checkDate ?? '').trim() || null : existingCheckDate;
  let sentBy = input.sentBy !== undefined ? String(input.sentBy ?? '').trim() || null : existingSentBy;
  let sentDate = input.sentDate !== undefined ? String(input.sentDate ?? '').trim() || null : existingSentDate;
  let sentProof =
    input.sentProof !== undefined ? (input.sentProof != null ? String(input.sentProof).trim() || null : null) : existingSentProof;

  if (checkPo) {
    if (!checkDate) throw new Error('Check Date is required when Check PO is selected.');
    if (!checkPoUserId) throw new Error('Checked By user is required.');
    if (checkPoUserId) {
      const u = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND is_active = 1', checkPoUserId);
      if (!u?.id) throw new Error('Invalid Check PO user');
    }
  } else {
    checkPoUserId = null;
    checkDate = null;
    sentBy = null;
    sentDate = null;
    sentProof = null;
  }

  if (!checkDate) {
    sentBy = null;
    sentDate = null;
    sentProof = null;
  }

  if (!sentBy) {
    sentDate = null;
    sentProof = null;
  }

  if (sentBy || sentDate) {
    if (!sentBy) throw new Error('Sent By is required when Sent Date is provided.');
    if (!sentDate) throw new Error('Sent Date is required when Sent By is provided.');
    const u = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND is_active = 1', sentBy);
    if (!u?.id) throw new Error('Invalid Sent By user');
  }

  await db.run(
    `UPDATE purchase_orders
	        SET check_po = ?,
	            check_po_user_id = ?,
	            check_date = ?,
	            sent_by = ?,
	            sent_date = ?,
	            sent_proof = ?,
	            updated_by = ?,
	            updated_at = ?
	      WHERE id = ?`,
    checkPo ? 1 : 0,
    checkPoUserId,
    checkDate,
    sentBy,
    sentDate,
    sentProof,
    input.updatedBy ?? 'system',
    now,
    poId
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
     VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'purchase_orders',
    poId,
    'update',
    input.updatedBy ?? 'system',
    now,
    'Update PO check/sent details'
  );

  const updated = await getPoWithItems(db, poId);
  if (!updated) throw new Error('PO not found after update');
  return updated;
}

export async function deletePo(input: { poId: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const poId = String(input.poId ?? '').trim();
  if (!poId) throw new Error('PO id is required');

  const po = await db.get<any>('SELECT * FROM purchase_orders WHERE id = ?', poId);
  if (!po) throw new Error('PO not found');

  const invCount = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM invoices WHERE po_id = ?', poId);
  const grnCount = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM grns WHERE po_id = ?', poId);
  if (Number(invCount?.count ?? 0) > 0 || Number(grnCount?.count ?? 0) > 0) {
    throw new Error('Cannot delete this PO because Invoice/GRN already exists.');
  }

  const now = nowIso();
  const deletedBy = String(input.deletedBy ?? '').trim() || 'Purchase Team';

  await db.exec('BEGIN');
  try {
    await db.run('DELETE FROM purchase_orders WHERE id = ?', poId);
    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'purchase_orders',
      poId,
      'delete',
      deletedBy,
      now,
      `Deleted PO ${poId}`
    );
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true };
}

export async function replaceQcForGrn(input: {
  grnId: string;
  inspectedBy: string;
  location: string;
  updatedBy?: string;
  items: Array<{ itemId?: string; item?: string; quantityAccepted: number; quantityRejected: number; remarks: string }>;
}) {
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
  const byItemId = new Map<string, { item: string; receivedQty: number }>();
  const itemNameCounts = new Map<string, number>();
  for (const r of grnItems ?? []) {
    const itemId = String(r.itemId);
    byItemId.set(itemId, { item: String(r.item), receivedQty: Number(r.receivedQty ?? 0) });
    const name = String(r.item);
    itemNameCounts.set(name, (itemNameCounts.get(name) ?? 0) + 1);
  }
  const uniqueNameToItemId = new Map<string, string>();
  for (const r of grnItems ?? []) {
    const name = String(r.item);
    if ((itemNameCounts.get(name) ?? 0) === 1) uniqueNameToItemId.set(name, String(r.itemId));
  }

  await db.exec('BEGIN');
  try {
    await db.run(`DELETE FROM stock_ledger WHERE reference_type = 'GRN' AND reference_id = ?`, input.grnId);
    await db.run('DELETE FROM qc_records WHERE grn_id = ?', input.grnId);

    for (const line of input.items) {
      const itemIdRaw = String(line.itemId ?? '').trim();
      const itemNameRaw = String(line.item ?? '').trim();
      const itemId = itemIdRaw || (itemNameRaw ? uniqueNameToItemId.get(itemNameRaw) ?? '' : '');
      if (!itemId) {
        throw new Error(itemNameRaw ? `Item "${itemNameRaw}" is ambiguous. Please select the exact item/spec.` : 'Item id is required');
      }
      const match = byItemId.get(itemId);
      if (!match) throw new Error(itemNameRaw ? `Item "${itemNameRaw}" is not part of the GRN` : `Item "${itemId}" is not part of the GRN`);
      if (line.quantityAccepted + line.quantityRejected > match.receivedQty) throw new Error(`QC qty for "${match.item}" cannot exceed received qty`);

      await db.run(
        `INSERT INTO qc_records (id, grn_id, item_id, accepted_qty, rejected_qty, hold_qty, remarks, qc_by, qc_date, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `QC-${crypto.randomUUID()}`,
        input.grnId,
        itemId,
        line.quantityAccepted,
        line.quantityRejected,
        0,
        line.remarks ?? null,
        input.inspectedBy,
        now.slice(0, 10),
        input.updatedBy || input.inspectedBy,
        now,
        input.updatedBy || input.inspectedBy,
        now
      );

      if (line.quantityAccepted > 0) {
        await db.run(
          `INSERT INTO stock_ledger (id, firm_id, store_id, item_id, transaction_type, quantity, reference_type, reference_id, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          `STK-${crypto.randomUUID()}`,
          grn.firmId,
          grn.storeId,
          itemId,
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
      'update',
      input.updatedBy || input.inspectedBy,
      now,
      input.location
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  const rows = await db.all<any[]>(
    `SELECT qr.item_id as itemId, qr.accepted_qty as acceptedQty, qr.rejected_qty as rejectedQty, qr.remarks, qr.qc_by as qcBy, qr.created_at as createdAt, inames.name as item
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
      itemId: String(r.itemId),
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

export async function deleteQcForGrn(input: { grnId: string; by: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const grnId = String(input.grnId ?? '').trim();
  if (!grnId) throw new Error('GRN id is required');

  await db.exec('BEGIN');
  try {
    await db.run(`DELETE FROM stock_ledger WHERE reference_type = 'GRN' AND reference_id = ?`, grnId);
    await db.run('DELETE FROM qc_records WHERE grn_id = ?', grnId);
    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'qc_records',
      grnId,
      'delete',
      input.by,
      now,
      null
    );
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true };
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

export async function getPendingInvoiceItems(poId: string): Promise<Array<{ itemId: string; item: string; pendingQty: number; rate: number }>> {
  await initDb();
  const db = await getDb();

  const poItems = await db.all<any[]>(
    `SELECT poi.item_id as itemId, poi.quantity as poQty, poi.rate as poRate, inames.name as item
     FROM purchase_order_items poi
     JOIN items it ON it.id = poi.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE poi.po_id = ?`,
    poId
  );

  const invoicedQtys = await db.all<any[]>(
    `SELECT ii.item_id as itemId, SUM(ii.quantity) as invoicedQty
     FROM invoice_items ii
     JOIN invoices inv ON inv.id = ii.invoice_id
     WHERE inv.po_id = ?
     GROUP BY ii.item_id`,
    poId
  );

  const invoicedByItemId = new Map<string, number>();
  for (const r of invoicedQtys ?? []) invoicedByItemId.set(String(r.itemId), Number(r.invoicedQty ?? 0));

  const pending: Array<{ itemId: string; item: string; pendingQty: number; rate: number }> = [];
  for (const pi of poItems ?? []) {
    const itemId = String(pi.itemId);
    const poQty = Number(pi.poQty ?? 0);
    const invoiced = invoicedByItemId.get(itemId) ?? 0;
    const pendingQty = poQty - invoiced;
    if (pendingQty > 0) {
      pending.push({
        itemId,
        item: String(pi.item),
        pendingQty,
        rate: Number(pi.poRate ?? 0),
      });
    }
  }

  return pending;
}

export async function getPendingGrnItems(poId: string): Promise<Array<{ itemId: string; item: string; pendingQty: number; rate: number }>> {
  await initDb();
  const db = await getDb();

  const poItems = await db.all<any[]>(
    `SELECT poi.item_id as itemId, poi.quantity as poQty, poi.rate as poRate, inames.name as item
     FROM purchase_order_items poi
     JOIN items it ON it.id = poi.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE poi.po_id = ?`,
    poId
  );

  const receivedQtys = await db.all<any[]>(
    `SELECT gi.item_id as itemId, COALESCE(SUM(gi.received_qty),0) as receivedQty
     FROM grn_items gi
     JOIN grns g ON g.id = gi.grn_id
     WHERE g.po_id = ?
     GROUP BY gi.item_id`,
    poId
  );
  const receivedByItemId = new Map<string, number>();
  for (const r of receivedQtys ?? []) receivedByItemId.set(String(r.itemId), Number(r.receivedQty ?? 0));

  const pending: Array<{ itemId: string; item: string; pendingQty: number; rate: number }> = [];
  for (const pi of poItems ?? []) {
    const itemId = String(pi.itemId);
    const poQty = Number(pi.poQty ?? 0);
    const received = receivedByItemId.get(itemId) ?? 0;
    const pendingQty = poQty - received;
    if (pendingQty > 0) {
      pending.push({
        itemId,
        item: String(pi.item),
        pendingQty,
        rate: Number(pi.poRate ?? 0),
      });
    }
  }

  return pending;
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

export async function getGrnInvoiceLinkSummary(invoiceId: string): Promise<GrnInvoiceLinkSummaryRow[]> {
  await initDb();
  const db = await getDb();
  const inv = await db.get<any>('SELECT po_id as poId FROM invoices WHERE id = ?', invoiceId);
  if (!inv?.poId) throw new Error('Invoice not found');
  const poId = String(inv.poId);

	const invoiceItems = await db.all<any[]>(
	    `SELECT ii.id as invoiceItemId,
	            ii.item_id as itemId,
	            ii.quantity as invoiceQty,
	            inames.name as item,
	            it.specifications_json as specificationsJson
	     FROM invoice_items ii
	     JOIN items it ON it.id = ii.item_id
	     JOIN item_names inames ON inames.id = it.item_name_id
	     WHERE ii.invoice_id = ?
	     ORDER BY ii.created_at ASC`,
	    invoiceId
	  );

  const receivedRows = await db.all<any[]>(
    `SELECT gi.item_id as itemId, COALESCE(SUM(gi.received_qty),0) as receivedQty
     FROM grn_items gi
     JOIN grns g ON g.id = gi.grn_id
     WHERE g.po_id = ?
     GROUP BY gi.item_id`,
    poId
  );
  const receivedByItemId = new Map<string, number>();
  for (const r of receivedRows ?? []) receivedByItemId.set(String(r.itemId), Number(r.receivedQty ?? 0));

  const linkedRows = await db.all<any[]>(
    `SELECT l.invoice_item_id as invoiceItemId, COALESCE(SUM(l.linked_qty),0) as linkedQty
     FROM grn_invoice_item_links l
     WHERE l.invoice_item_id IN (SELECT id FROM invoice_items WHERE invoice_id = ?)
     GROUP BY l.invoice_item_id`,
    invoiceId
  );
  const linkedByInvoiceItemId = new Map<string, number>();
  for (const r of linkedRows ?? []) linkedByInvoiceItemId.set(String(r.invoiceItemId), Number(r.linkedQty ?? 0));

	  return (invoiceItems ?? []).map((r) => {
	    const itemId = String(r.itemId);
	    const invoiceItemId = String(r.invoiceItemId);
	    return {
	      invoiceItemId,
	      itemId,
	      item: String(r.item),
	      specificationsJson: (r as any).specificationsJson != null ? String((r as any).specificationsJson) : undefined,
	      invoiceQty: Number(r.invoiceQty ?? 0),
	      receivedQty: receivedByItemId.get(itemId) ?? 0,
	      linkedQty: linkedByInvoiceItemId.get(invoiceItemId) ?? 0,
	    };
	  });
}

export async function setGrnInvoiceLinks(input: { invoiceId: string; updatedBy?: string; links: Array<{ invoiceItemId: string; linkedQty: number }> }) {
  await initDb();
  const db = await getDb();

  const invoiceId = String(input.invoiceId ?? '').trim();
  if (!invoiceId) throw new Error('Invoice id is required');

  const inv = await db.get<any>('SELECT po_id as poId FROM invoices WHERE id = ?', invoiceId);
  if (!inv?.poId) throw new Error('Invoice not found');
  const poId = String(inv.poId);

  const invoiceItems = await db.all<any[]>(
    `SELECT ii.id as invoiceItemId, ii.item_id as itemId, ii.quantity as invoiceQty, inames.name as item
     FROM invoice_items ii
     JOIN items it ON it.id = ii.item_id
     JOIN item_names inames ON inames.id = it.item_name_id
     WHERE ii.invoice_id = ?
     ORDER BY ii.created_at ASC`,
    invoiceId
  );
  const invoiceById = new Map<string, { itemId: string; invoiceQty: number; item: string }>();
  for (const r of invoiceItems ?? []) invoiceById.set(String(r.invoiceItemId), { itemId: String(r.itemId), invoiceQty: Number(r.invoiceQty ?? 0), item: String(r.item) });

  const desiredByInvoiceItemId = new Map<string, number>();
  for (const link of input.links ?? []) {
    const invoiceItemId = String((link as any)?.invoiceItemId ?? '').trim();
    if (!invoiceItemId) continue;
    const row = invoiceById.get(invoiceItemId);
    if (!row) throw new Error('Invalid invoice item for this invoice');
    const desired = Number((link as any)?.linkedQty ?? 0);
    if (!Number.isFinite(desired) || desired < 0) throw new Error('Invalid linked qty');
    if (desired > row.invoiceQty) throw new Error(`Linked qty cannot exceed invoice qty for "${row.item}"`);
    desiredByInvoiceItemId.set(invoiceItemId, desired);
  }
  // Default missing invoice items to 0
  for (const id of invoiceById.keys()) if (!desiredByInvoiceItemId.has(id)) desiredByInvoiceItemId.set(id, 0);

  const desiredByItemId = new Map<string, number>();
  for (const [invoiceItemId, qty] of desiredByInvoiceItemId.entries()) {
    const row = invoiceById.get(invoiceItemId)!;
    desiredByItemId.set(row.itemId, (desiredByItemId.get(row.itemId) ?? 0) + qty);
  }

  const receivedRows = await db.all<any[]>(
    `SELECT gi.item_id as itemId, COALESCE(SUM(gi.received_qty),0) as receivedQty
     FROM grn_items gi
     JOIN grns g ON g.id = gi.grn_id
     WHERE g.po_id = ?
     GROUP BY gi.item_id`,
    poId
  );
  const receivedByItemId = new Map<string, number>();
  for (const r of receivedRows ?? []) receivedByItemId.set(String(r.itemId), Number(r.receivedQty ?? 0));

  const otherLinkedRows = await db.all<any[]>(
    `SELECT gi.item_id as itemId, COALESCE(SUM(l.linked_qty),0) as linkedQty
     FROM grn_invoice_item_links l
     JOIN grn_items gi ON gi.id = l.grn_item_id
     JOIN invoice_items ii ON ii.id = l.invoice_item_id
     JOIN invoices inv2 ON inv2.id = ii.invoice_id
     WHERE inv2.po_id = ? AND inv2.id <> ?
     GROUP BY gi.item_id`,
    poId,
    invoiceId
  );
  const otherLinkedByItemId = new Map<string, number>();
  for (const r of otherLinkedRows ?? []) otherLinkedByItemId.set(String(r.itemId), Number(r.linkedQty ?? 0));

  for (const [itemId, desired] of desiredByItemId.entries()) {
    const received = receivedByItemId.get(itemId) ?? 0;
    const already = otherLinkedByItemId.get(itemId) ?? 0;
    const available = received - already;
    if (desired > available + 1e-9) {
      throw new Error('Not enough received qty to link to this invoice');
    }
  }

  const now = nowIso();
  const by = input.updatedBy?.trim() ? input.updatedBy.trim() : 'system';

  await db.exec('BEGIN');
  try {
    await db.run(
      `DELETE FROM grn_invoice_item_links
       WHERE invoice_item_id IN (SELECT id FROM invoice_items WHERE invoice_id = ?)`,
      invoiceId
    );

    const grnItems = await db.all<any[]>(
      `SELECT gi.id as grnItemId, gi.item_id as itemId, gi.received_qty as receivedQty,
              COALESCE(SUM(l.linked_qty),0) as linkedQty, g.created_at as grnCreatedAt, gi.created_at as grnItemCreatedAt
       FROM grn_items gi
       JOIN grns g ON g.id = gi.grn_id
       LEFT JOIN grn_invoice_item_links l ON l.grn_item_id = gi.id
       WHERE g.po_id = ?
       GROUP BY gi.id
       ORDER BY g.created_at ASC, gi.created_at ASC`,
      poId
    );

    const grnByItemId = new Map<string, Array<{ grnItemId: string; available: number }>>();
    for (const r of grnItems ?? []) {
      const itemId = String(r.itemId);
      const available = Number(r.receivedQty ?? 0) - Number(r.linkedQty ?? 0);
      if (available <= 0) continue;
      const arr = grnByItemId.get(itemId) ?? [];
      arr.push({ grnItemId: String(r.grnItemId), available });
      grnByItemId.set(itemId, arr);
    }

    for (const [invoiceItemId, desired] of desiredByInvoiceItemId.entries()) {
      if (desired <= 0) continue;
      const invRow = invoiceById.get(invoiceItemId);
      if (!invRow) continue;
      const itemId = invRow.itemId;
      const grnArr = grnByItemId.get(itemId) ?? [];
      let remaining = desired;
      let idx = 0;
      while (remaining > 0 && idx < grnArr.length) {
        const gi = grnArr[idx]!;
        if (gi.available <= 0) {
          idx++;
          continue;
        }
        const allocate = Math.min(remaining, gi.available);
        await db.run(
          `INSERT INTO grn_invoice_item_links (id, grn_item_id, invoice_item_id, linked_qty, created_by, created_at)
           VALUES (?,?,?,?,?,?)`,
          `LINK-${crypto.randomUUID()}`,
          gi.grnItemId,
          invoiceItemId,
          allocate,
          by,
          now
        );
        gi.available -= allocate;
        remaining -= allocate;
        if (gi.available <= 0) idx++;
      }
      if (remaining > 1e-9) throw new Error('Not enough received qty to link to this invoice');
    }

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'invoices',
      invoiceId,
      'link_grn',
      by,
      now,
      null
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  return { links: await getGrnInvoiceLinkSummary(invoiceId) };
}

export type GrnItemInvoiceLinkSummaryRow = {
  grnItemId: string;
  invoiceId: string;
  invoiceNo: string;
  linkedQty: number;
};

export async function listGrnItemInvoiceLinkSummaryByPrId(prId: string): Promise<GrnItemInvoiceLinkSummaryRow[]> {
  await initDb();
  const db = await getDb();
  const id = String(prId ?? '').trim();
  if (!id) throw new Error('PR id is required');

	  const rows = await db.all<any[]>(
	    `SELECT gi.id as grnItemId,
	            inv.id as invoiceId,
	            COALESCE(inv.invoice_number, inv.id) as invoiceNo,
	            COALESCE(SUM(l.linked_qty),0) as linkedQty
	     FROM purchase_orders po
	     JOIN grns g ON g.po_id = po.id
	     JOIN grn_items gi ON gi.grn_id = g.id
     JOIN grn_invoice_item_links l ON l.grn_item_id = gi.id
     JOIN invoice_items ii ON ii.id = l.invoice_item_id
     JOIN invoices inv ON inv.id = ii.invoice_id
     WHERE po.pr_id = ?
     GROUP BY gi.id, inv.id
     ORDER BY g.created_at DESC, inv.created_at DESC`,
    id
  );

  return (rows ?? []).map((r) => ({
    grnItemId: String((r as any).grnItemId ?? '').trim(),
    invoiceId: String((r as any).invoiceId ?? '').trim(),
    invoiceNo: String((r as any).invoiceNo ?? '').trim(),
    linkedQty: Number((r as any).linkedQty ?? 0),
  }));
}

export type GrnItemInvoiceLinkRow = {
  invoiceItemId: string;
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  linkedQty: number;
};

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
  specificationsJson?: string;
  grnQty: number;
  approvedQty: number;
  alreadyLinkQty: number;
  pendingLinkingQty: number;
  candidates: PendingGrnInvoiceLinkCandidateRow[];
};

export async function getGrnItemInvoiceLinks(grnItemId: string): Promise<GrnItemInvoiceLinkRow[]> {
  await initDb();
  const db = await getDb();
  const id = String(grnItemId ?? '').trim();
  if (!id) throw new Error('GRN item id is required');

	  const rows = await db.all<any[]>(
	    `SELECT l.invoice_item_id as invoiceItemId,
	            inv.id as invoiceId,
	            COALESCE(inv.invoice_number, inv.id) as invoiceNo,
	            inv.invoice_date as invoiceDate,
	            l.linked_qty as linkedQty
	     FROM grn_invoice_item_links l
	     JOIN invoice_items ii ON ii.id = l.invoice_item_id
     JOIN invoices inv ON inv.id = ii.invoice_id
     WHERE l.grn_item_id = ?
     ORDER BY inv.created_at ASC, ii.created_at ASC`,
    id
  );

  return (rows ?? []).map((r) => ({
    invoiceItemId: String((r as any).invoiceItemId ?? '').trim(),
    invoiceId: String((r as any).invoiceId ?? '').trim(),
    invoiceNo: String((r as any).invoiceNo ?? '').trim(),
    invoiceDate: String((r as any).invoiceDate ?? '').trim(),
    linkedQty: Number((r as any).linkedQty ?? 0),
  }));
}

export async function listPendingGrnInvoiceLinksByGrnId(grnIdRaw: string): Promise<PendingGrnInvoiceLinkRow[]> {
  await initDb();
  const db = await getDb();
  const grnId = String(grnIdRaw ?? '').trim();
  if (!grnId) throw new Error('GRN id is required');

  const meta = await db.get<any>(
    `SELECT g.id as grnId,
            g.grn_number as grnNumber,
            g.received_date as receivedDate,
            po.id as poId,
            po.po_number as poNumber
       FROM grns g
       JOIN purchase_orders po ON po.id = g.po_id
      WHERE g.id = ?`,
    grnId
  );
  if (!meta?.grnId) throw new Error('GRN not found');
  const poId = String(meta.poId);

	  const pendingRows = await db.all<any[]>(
	    `WITH gi_linked AS (
        SELECT grn_item_id as grnItemId, COALESCE(SUM(linked_qty),0) as linkedQty
          FROM grn_invoice_item_links
         GROUP BY grn_item_id
      ),
      qc AS (
        SELECT grn_id as grnId, item_id as itemId, COUNT(*) as cnt, COALESCE(SUM(accepted_qty),0) as approvedQty
          FROM qc_records
         GROUP BY grn_id, item_id
	      )
	      SELECT gi.id as grnItemId,
	             gi.item_id as itemId,
	             inames.name as item,
	             it.specifications_json as specificationsJson,
	             gi.received_qty as grnQty,
	             qc.approvedQty as approvedQty,
	             COALESCE(l.linkedQty,0) as alreadyLinkQty
	        FROM grn_items gi
	        JOIN items it ON it.id = gi.item_id
	        JOIN item_names inames ON inames.id = it.item_name_id
        JOIN qc ON qc.grnId = gi.grn_id AND qc.itemId = gi.item_id AND qc.cnt > 0
   LEFT JOIN gi_linked l ON l.grnItemId = gi.id
       WHERE gi.grn_id = ?
         AND (qc.approvedQty - COALESCE(l.linkedQty,0)) > 0
       ORDER BY inames.name ASC, gi.created_at ASC`,
    grnId
  );

  const pendingByGrnItemId = new Map<string, any>();
  const itemIds: string[] = [];
  for (const r of pendingRows ?? []) {
    const grnItemId = String((r as any).grnItemId ?? '').trim();
    if (!grnItemId) continue;
    pendingByGrnItemId.set(grnItemId, r);
    const itemId = String((r as any).itemId ?? '').trim();
    if (itemId) itemIds.push(itemId);
  }
  if (!pendingByGrnItemId.size) return [];

  const placeholders = itemIds.map(() => '?').join(', ');
  const invoiceItemRows = await db.all<any[]>(
    `WITH inv_linked AS (
        SELECT invoice_item_id as invoiceItemId, COALESCE(SUM(linked_qty),0) as linkedQty
          FROM grn_invoice_item_links
         GROUP BY invoice_item_id
      )
      SELECT ii.id as invoiceItemId,
             ii.item_id as itemId,
             ii.quantity as invoiceQty,
             inv.id as invoiceId,
             COALESCE(inv.invoice_number, inv.id) as invoiceNo,
             inv.invoice_date as invoiceDate,
             COALESCE(l.linkedQty,0) as totalLinkedQty
        FROM invoice_items ii
        JOIN invoices inv ON inv.id = ii.invoice_id
   LEFT JOIN inv_linked l ON l.invoiceItemId = ii.id
       WHERE inv.po_id = ?
         AND ii.item_id IN (${placeholders})
       ORDER BY date(inv.invoice_date) DESC, inv.created_at DESC, ii.created_at ASC`,
    poId,
    ...itemIds
  );

  const existingLinks = await db.all<any[]>(
    `SELECT grn_item_id as grnItemId, invoice_item_id as invoiceItemId, linked_qty as linkedQty
       FROM grn_invoice_item_links
      WHERE grn_item_id IN (${Array.from(pendingByGrnItemId.keys()).map(() => '?').join(', ')})`,
    ...Array.from(pendingByGrnItemId.keys())
  );
  const existingByPair = new Map<string, number>();
  for (const r of existingLinks ?? []) {
    const key = `${String((r as any).grnItemId)}::${String((r as any).invoiceItemId)}`;
    existingByPair.set(key, Number((r as any).linkedQty ?? 0));
  }

  const candidatesByItemId = new Map<string, any[]>();
  for (const r of invoiceItemRows ?? []) {
    const itemId = String((r as any).itemId ?? '').trim();
    if (!itemId) continue;
    if (!candidatesByItemId.has(itemId)) candidatesByItemId.set(itemId, []);
    candidatesByItemId.get(itemId)!.push(r);
  }

  const out: PendingGrnInvoiceLinkRow[] = [];
  for (const [grnItemId, r] of pendingByGrnItemId.entries()) {
    const itemId = String((r as any).itemId ?? '').trim();
    const approvedQty = Number((r as any).approvedQty ?? 0);
    const alreadyLinkQty = Number((r as any).alreadyLinkQty ?? 0);
    const pendingLinkingQty = approvedQty - alreadyLinkQty;

    const candidateRows = candidatesByItemId.get(itemId) ?? [];
    const candidates: PendingGrnInvoiceLinkCandidateRow[] = candidateRows.map((c) => {
      const invoiceItemId = String((c as any).invoiceItemId ?? '').trim();
      const invoiceQty = Number((c as any).invoiceQty ?? 0);
      const totalLinkedQty = Number((c as any).totalLinkedQty ?? 0);
      const linkedThis = existingByPair.get(`${grnItemId}::${invoiceItemId}`) ?? 0;
      const alreadyLinkedQty = totalLinkedQty - linkedThis;
      const pendingInvoice = invoiceQty - alreadyLinkedQty;
      return {
        invoiceItemId,
        invoiceId: String((c as any).invoiceId ?? '').trim(),
        invoiceNo: String((c as any).invoiceNo ?? '').trim(),
        invoiceDate: String((c as any).invoiceDate ?? '').slice(0, 10),
        invoiceQty,
        alreadyLinkedQty: alreadyLinkedQty < 0 ? 0 : alreadyLinkedQty,
        pendingLinkingQty: pendingInvoice < 0 ? 0 : pendingInvoice,
      };
    }).filter((c) => Number.isFinite(c.pendingLinkingQty) && c.pendingLinkingQty > 0);

	    out.push({
	      grnItemId,
	      grnId: String(meta.grnId),
	      grnNumber: String(meta.grnNumber ?? meta.grnId),
	      receivedDate: String(meta.receivedDate ?? '').slice(0, 10),
	      poId,
	      poNumber: String(meta.poNumber ?? poId),
	      itemId,
	      item: String((r as any).item ?? ''),
	      specificationsJson: (r as any).specificationsJson != null ? String((r as any).specificationsJson) : undefined,
	      grnQty: Number((r as any).grnQty ?? 0),
	      approvedQty,
	      alreadyLinkQty,
	      pendingLinkingQty: pendingLinkingQty < 0 ? 0 : pendingLinkingQty,
	      candidates,
	    });
	  }

  return out.filter((r) => Number.isFinite(r.pendingLinkingQty) && r.pendingLinkingQty > 0);
}

export async function setGrnItemInvoiceLinks(input: {
  grnItemId: string;
  updatedBy?: string;
  links: Array<{ invoiceItemId: string; linkedQty: number }>;
}): Promise<{ links: GrnItemInvoiceLinkRow[] }> {
  await initDb();
  const db = await getDb();

  const grnItemId = String(input.grnItemId ?? '').trim();
  if (!grnItemId) throw new Error('GRN item id is required');

  const gi = await db.get<any>(
    `SELECT gi.id as id, gi.grn_id as grnId, gi.item_id as itemId, gi.received_qty as receivedQty
     FROM grn_items gi
     WHERE gi.id = ?`,
    grnItemId
  );
  if (!gi?.id) throw new Error('GRN item not found');
  const grnId = String(gi.grnId);
  const itemId = String(gi.itemId);
  const receivedQty = Number(gi.receivedQty ?? 0);

  const grn = await db.get<any>('SELECT po_id as poId FROM grns WHERE id = ?', grnId);
  if (!grn?.poId) throw new Error('GRN not found');
  const poId = String(grn.poId);

  const desiredByInvoiceItemId = new Map<string, number>();
  for (const l of input.links ?? []) {
    const invoiceItemId = String((l as any)?.invoiceItemId ?? '').trim();
    if (!invoiceItemId) continue;
    const linkedQty = Number((l as any)?.linkedQty ?? 0);
    if (!Number.isFinite(linkedQty) || linkedQty < 0) throw new Error('Invalid linked qty');
    desiredByInvoiceItemId.set(invoiceItemId, linkedQty);
  }

	  let totalDesired = 0;
	  for (const v of desiredByInvoiceItemId.values()) totalDesired += v;
	  if (totalDesired > receivedQty + 1e-9) throw new Error('Linked qty exceeds GRN received qty');

	  const qcMeta = await db.get<any>(
	    `SELECT COUNT(*) as cnt, COALESCE(SUM(accepted_qty),0) as acceptedQty
	     FROM qc_records
	     WHERE grn_id = ? AND item_id = ?`,
	    grnId,
	    itemId
	  );
	  const qcCount = Number(qcMeta?.cnt ?? 0);
	  const qcAcceptedQty = Number(qcMeta?.acceptedQty ?? 0);
	  if (!Number.isFinite(qcCount) || qcCount <= 0) throw new Error('Record QC before linking invoices');
	  if (!Number.isFinite(qcAcceptedQty)) throw new Error('Invalid QC data');
	  if (totalDesired > qcAcceptedQty + 1e-9) throw new Error('Linked qty exceeds QC accepted qty');

  const invoiceItemIds = Array.from(desiredByInvoiceItemId.keys());
  const invoiceItemMeta = new Map<string, { invoiceQty: number }>();

  if (invoiceItemIds.length) {
    const placeholders = invoiceItemIds.map(() => '?').join(', ');
    const invoiceItems = await db.all<any[]>(
      `SELECT ii.id as invoiceItemId,
              ii.item_id as itemId,
              ii.quantity as invoiceQty,
              inv.po_id as poId
       FROM invoice_items ii
       JOIN invoices inv ON inv.id = ii.invoice_id
       WHERE ii.id IN (${placeholders})`,
      ...invoiceItemIds
    );
    const byId = new Map<string, any>();
    for (const r of invoiceItems ?? []) byId.set(String((r as any).invoiceItemId), r);
    for (const id of invoiceItemIds) {
      const row = byId.get(id);
      if (!row) throw new Error('Invalid invoice item');
      if (String((row as any).poId) !== poId) throw new Error('Invoice item does not belong to this PO');
      if (String((row as any).itemId) !== itemId) throw new Error('Invoice item does not match GRN item');
      invoiceItemMeta.set(id, { invoiceQty: Number((row as any).invoiceQty ?? 0) });
    }

    for (const [invoiceItemId, desired] of desiredByInvoiceItemId.entries()) {
      const meta = invoiceItemMeta.get(invoiceItemId);
      if (!meta) throw new Error('Invalid invoice item');
      const already = await db.get<any>(
        `SELECT COALESCE(SUM(linked_qty),0) as linkedQty
         FROM grn_invoice_item_links
         WHERE invoice_item_id = ? AND grn_item_id <> ?`,
        invoiceItemId,
        grnItemId
      );
      const alreadyLinked = Number(already?.linkedQty ?? 0);
      const available = meta.invoiceQty - alreadyLinked;
      if (desired > available + 1e-9) throw new Error('Invoice qty is already linked to other GRNs');
    }
  }

  const now = nowIso();
  const by = input.updatedBy?.trim() ? input.updatedBy.trim() : 'system';

  await db.exec('BEGIN');
  try {
    await db.run(`DELETE FROM grn_invoice_item_links WHERE grn_item_id = ?`, grnItemId);

    for (const [invoiceItemId, desired] of desiredByInvoiceItemId.entries()) {
      if (desired <= 0) continue;
      await db.run(
        `INSERT INTO grn_invoice_item_links (id, grn_item_id, invoice_item_id, linked_qty, created_by, created_at)
         VALUES (?,?,?,?,?,?)`,
        `LINK-${crypto.randomUUID()}`,
        grnItemId,
        invoiceItemId,
        desired,
        by,
        now
      );
    }

    await db.run(
      `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      `AUD-${crypto.randomUUID()}`,
      'grn_items',
      grnItemId,
      'link_invoice',
      by,
      now,
      null
    );

    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  return { links: await getGrnItemInvoiceLinks(grnItemId) };
}

export async function getWorkflow(prId: string, poId?: string): Promise<WorkflowSummary> {
  await initDb();
  const db = await getDb();
  const pr = await getPr(prId);
  if (!pr) throw new Error('PR not found');
  const firm = await db.get<{ id: string; name: string }>('SELECT id, name FROM firms WHERE id = ?', pr.pr.firmId);

  const targetPoId = String(poId ?? '').trim();
  const po = targetPoId
    ? await db.get<any>('SELECT * FROM purchase_orders WHERE id = ? AND pr_id = ? ORDER BY created_at DESC LIMIT 1', targetPoId, prId)
    : await getPoByPrId(db, prId);
  const poWithItems = po ? await getPoWithItems(db, String(po.id)) : null;

  const invoice = po ? await getInvoiceByPoId(db, String(po.id)) : null;
  const invoiceWithItems = invoice ? await getInvoiceWithItems(db, String(invoice.id)) : null;

  const grn = po ? await getGrnByPoId(db, String(po.id)) : null;
  const grnWithItems = grn ? await getGrnWithItems(db, String(grn.id)) : null;

	  const qcRows = grn
	    ? await db.all<any[]>(
	        `SELECT qr.item_id as itemId, qr.accepted_qty as acceptedQty, qr.rejected_qty as rejectedQty, qr.remarks, qr.qc_by as qcBy, qr.created_at as createdAt, inames.name as item
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
	        const poLine = poWithItems.items.find((p) => p.itemId === it.itemId);
	        return poLine ? Number(poLine.rate) !== Number(it.rate) : true;
	      })
	  );

	  const quantityMismatch = Boolean(
	    invoiceWithItems &&
	      poWithItems &&
	      grnWithItems &&
	      invoiceWithItems.items.some((it) => {
	        const poLine = poWithItems.items.find((p) => p.itemId === it.itemId);
	        const grnLine = grnWithItems.items.find((g) => g.itemId === it.itemId);
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
	          itemId: String(r.itemId),
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

  const tables: Array<{ name: string; sql: string; tableName?: string }> = [
    { name: 'Firms', sql: 'SELECT * FROM firms', tableName: 'firms' },
    { name: 'Stores', sql: 'SELECT * FROM stores', tableName: 'stores' },
    { name: 'Items', sql: 'SELECT * FROM items', tableName: 'items' },
    { name: 'PRs', sql: 'SELECT * FROM purchase_requisitions', tableName: 'purchase_requisitions' },
    { name: 'PR_Items', sql: 'SELECT * FROM purchase_requisition_items', tableName: 'purchase_requisition_items' },
    { name: 'POs', sql: 'SELECT * FROM purchase_orders', tableName: 'purchase_orders' },
    { name: 'PO_Items', sql: 'SELECT * FROM purchase_order_items', tableName: 'purchase_order_items' },
    { name: 'Invoices', sql: 'SELECT * FROM invoices', tableName: 'invoices' },
    { name: 'Invoice_Items', sql: 'SELECT * FROM invoice_items', tableName: 'invoice_items' },
    { name: 'GRNs', sql: 'SELECT * FROM grns', tableName: 'grns' },
    { name: 'GRN_Items', sql: 'SELECT * FROM grn_items', tableName: 'grn_items' },
    { name: 'QC', sql: 'SELECT * FROM qc_records', tableName: 'qc_records' },
    { name: 'StockLedger', sql: 'SELECT * FROM stock_ledger', tableName: 'stock_ledger' },
    { name: 'Payments', sql: 'SELECT * FROM payments', tableName: 'payments' },
    { name: 'AuditLogs', sql: 'SELECT * FROM audit_logs', tableName: 'audit_logs' },
  ];

  const wb = XLSX.utils.book_new();
  for (const t of tables) {
    const rows = await db.all<any[]>(t.sql);
    let ws: XLSX.WorkSheet;
    if (!rows?.length && t.tableName) {
      const cols = await db.all<any[]>(`PRAGMA table_info(${t.tableName})`);
      const header = (cols ?? []).map((c) => String(c?.name ?? '').trim()).filter(Boolean);
      ws = header.length ? XLSX.utils.aoa_to_sheet([header]) : XLSX.utils.json_to_sheet([]);
    } else {
      ws = XLSX.utils.json_to_sheet(rows ?? []);
    }
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

		  const tables: Array<{ name: string; sql: string; tableName?: string }> = [
		    { name: 'Firms', sql: 'SELECT * FROM firms', tableName: 'firms' },
		    { name: 'Stores', sql: 'SELECT * FROM stores', tableName: 'stores' },
		    { name: 'Users', sql: 'SELECT * FROM users', tableName: 'users' },
		    { name: 'Suppliers', sql: 'SELECT * FROM suppliers', tableName: 'suppliers' },
		    { name: 'Transporters', sql: 'SELECT * FROM transporters', tableName: 'transporters' },
		    { name: 'Customers', sql: 'SELECT * FROM customers', tableName: 'customers' },
		    { name: 'Projects', sql: 'SELECT * FROM projects', tableName: 'projects' },
		    { name: 'IssueTypes', sql: 'SELECT * FROM issue_types', tableName: 'issue_types' },
		    { name: 'Units', sql: 'SELECT * FROM units', tableName: 'units' },
		    { name: 'ItemCategories', sql: 'SELECT * FROM item_categories', tableName: 'item_categories' },
		    { name: 'ItemNames', sql: 'SELECT * FROM item_names', tableName: 'item_names' },
	    { name: 'Specifications', sql: 'SELECT * FROM specifications', tableName: 'specifications' },
	    { name: 'SpecificationValues', sql: 'SELECT * FROM specification_values', tableName: 'specification_values' },
	    { name: 'Items', sql: 'SELECT * FROM items', tableName: 'items' },
	  ];

	  const wb = XLSX.utils.book_new();
	  for (const t of tables) {
	    const rows = await db.all<any[]>(t.sql);
	    let ws: XLSX.WorkSheet;
	    if (!rows?.length && t.tableName) {
	      const cols = await db.all<any[]>(`PRAGMA table_info(${t.tableName})`);
	      const header = (cols ?? []).map((c) => String(c?.name ?? '').trim()).filter(Boolean);
	      ws = header.length ? XLSX.utils.aoa_to_sheet([header]) : XLSX.utils.json_to_sheet([]);
	    } else {
	      ws = XLSX.utils.json_to_sheet(rows ?? []);
	    }
	    XLSX.utils.book_append_sheet(wb, ws, t.name);
	  }

  // Simple data-entry templates (15 rows) for offline entry.
  const itemNamesTemplate = XLSX.utils.aoa_to_sheet([
    ['Name', 'Unit', 'Category'],
    ...Array.from({ length: 15 }, () => ['', '', '']),
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

export async function createFirm(input: {
  name: string;
  sortName?: string | null;
  cin?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  termsConditions?: string | null;
  createdBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `FIRM-${crypto.randomUUID()}`;
  const name = input.name.trim();
  const sortName = input.sortName != null ? String(input.sortName).trim() : '';
  if (!name) throw new Error('Firm name is required');
  const cin = input.cin != null ? String(input.cin).trim() : '';
  const gstNumber = input.gstNumber != null ? String(input.gstNumber).trim() : '';
  const address = input.address != null ? String(input.address).trim() : '';
  const phone = input.phone != null ? String(input.phone).trim() : '';
  const logoUrl = input.logoUrl != null ? String(input.logoUrl).trim() : '';
  const termsConditions = input.termsConditions != null ? String(input.termsConditions).trim() : '';
	  await db.run(
	    `INSERT INTO firms (id, name, sort_name, cin, gst_number, address, phone, logo_url, created_by, created_at, updated_by, updated_at)
	     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
	    id,
	    name,
	    sortName || null,
	    cin || null,
    gstNumber || null,
    address || null,
    phone || null,
    logoUrl || null,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  if (termsConditions) {
    await db.run(`UPDATE firms SET terms_conditions = ?, updated_by = ?, updated_at = ? WHERE id = ?`, termsConditions, input.createdBy ?? 'system', now, id);
  }
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
	  return {
	    id,
	    name,
	    sortName: sortName || null,
	    cin: cin || null,
    gstNumber: gstNumber || null,
    address: address || null,
    phone: phone || null,
    logoUrl: logoUrl || null,
    termsConditions: termsConditions || null,
  };
}

export async function updateFirm(input: {
  id: string;
  name: string;
  sortName?: string | null;
  cin?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  termsConditions?: string | null;
  updatedBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = input.name.trim();
  const sortName = input.sortName != null ? String(input.sortName).trim() : '';
  if (!id) throw new Error('Firm id is required');
  if (!name) throw new Error('Firm name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM firms WHERE id = ?', id);
  if (!existing?.id) throw new Error('Firm not found');

  const cin = input.cin != null ? String(input.cin).trim() : '';
  const gstNumber = input.gstNumber != null ? String(input.gstNumber).trim() : '';
  const address = input.address != null ? String(input.address).trim() : '';
  const phone = input.phone != null ? String(input.phone).trim() : '';
  const logoUrl = input.logoUrl != null ? String(input.logoUrl).trim() : '';
  const termsConditions = input.termsConditions != null ? String(input.termsConditions).trim() : '';

	  await db.run(
	    `UPDATE firms
	        SET name = ?,
	            sort_name = ?,
	            cin = ?,
            gst_number = ?,
            address = ?,
            phone = ?,
            logo_url = ?,
            terms_conditions = ?,
            updated_by = ?,
            updated_at = ?
      WHERE id = ?`,
	    name,
	    sortName || null,
	    cin || null,
    gstNumber || null,
    address || null,
    phone || null,
    logoUrl || null,
    termsConditions || null,
    input.updatedBy ?? 'system',
    now,
    id
  );
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

	  return {
	    id,
	    name,
	    sortName: sortName || null,
	    cin: cin || null,
    gstNumber: gstNumber || null,
    address: address || null,
    phone: phone || null,
    logoUrl: logoUrl || null,
    termsConditions: termsConditions || null,
  };
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

export async function createDepartment(input: { name: string; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `DEPT-${crypto.randomUUID()}`;
  const name = input.name.trim();
  if (!name) throw new Error('Department name is required');

  await db.run(
    `INSERT INTO departments (id, name, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?)`,
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
    'departments',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );

  return { id, name };
}

export async function updateDepartment(input: { id: string; name: string; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = input.name.trim();
  if (!id) throw new Error('Department id is required');
  if (!name) throw new Error('Department name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM departments WHERE id = ?', id);
  if (!existing?.id) throw new Error('Department not found');

  await db.run(`UPDATE departments SET name = ?, updated_by = ?, updated_at = ? WHERE id = ?`, name, input.updatedBy ?? 'system', now, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'departments',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );

  return { id, name };
}

export async function deleteDepartment(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Department id is required');

  await db.run(`DELETE FROM departments WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'departments',
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

export async function listCustomers() {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>('SELECT id, name, phone, address FROM customers ORDER BY created_at DESC');
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    phone: r.phone ?? null,
    address: r.address ?? null,
  }));
}

export async function createCustomer(input: { name: string; phone?: string | null; address?: string | null; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `CUS-${crypto.randomUUID()}`;
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Customer name is required');

  await db.run(
    `INSERT INTO customers (id, name, phone, address, created_by, created_at, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id,
    name,
    input.phone != null && String(input.phone).trim() ? String(input.phone).trim() : null,
    input.address != null && String(input.address).trim() ? String(input.address).trim() : null,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'customers',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return {
    id,
    name,
    phone: input.phone != null && String(input.phone).trim() ? String(input.phone).trim() : null,
    address: input.address != null && String(input.address).trim() ? String(input.address).trim() : null,
  };
}

export async function updateCustomer(input: { id: string; name: string; phone?: string | null; address?: string | null; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = String(input.name ?? '').trim();
  if (!id) throw new Error('Customer id is required');
  if (!name) throw new Error('Customer name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM customers WHERE id = ?', id);
  if (!existing?.id) throw new Error('Customer not found');

  await db.run(
    `UPDATE customers
        SET name = ?,
            phone = ?,
            address = ?,
            updated_by = ?,
            updated_at = ?
      WHERE id = ?`,
    name,
    input.phone != null && String(input.phone).trim() ? String(input.phone).trim() : null,
    input.address != null && String(input.address).trim() ? String(input.address).trim() : null,
    input.updatedBy ?? 'system',
    now,
    id
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'customers',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );
  return {
    id,
    name,
    phone: input.phone != null && String(input.phone).trim() ? String(input.phone).trim() : null,
    address: input.address != null && String(input.address).trim() ? String(input.address).trim() : null,
  };
}

export async function deleteCustomer(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Customer id is required');

  await db.run(`DELETE FROM customers WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'customers',
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
    'SELECT id, name, gst_number as gstNumber, payment_terms as paymentTerms, address, phone, gst_type as gstType FROM suppliers ORDER BY created_at DESC'
  );
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    gstNumber: r.gstNumber ?? null,
    paymentTerms: r.paymentTerms ?? null,
    address: r.address ?? null,
    phone: r.phone ?? null,
    gstType: r.gstType ?? null,
  }));
}

export async function createSupplier(input: {
  name: string;
  gstNumber?: string;
  paymentTerms?: string;
  address?: string;
  phone?: string;
  gstType?: string;
  createdBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `SUP-${crypto.randomUUID()}`;
  const name = input.name.trim();
  if (!name) throw new Error('Supplier name is required');
  const gstType = input.gstType != null ? String(input.gstType).trim() : '';
  if (gstType && gstType !== 'Intra-State' && gstType !== 'Inter-State') throw new Error('Invalid GST Type');
  await db.run(
    `INSERT INTO suppliers (id, name, gst_number, payment_terms, address, phone, gst_type, created_by, created_at, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    name,
    input.gstNumber ?? null,
    input.paymentTerms ?? null,
    input.address ?? null,
    input.phone ?? null,
    gstType || null,
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
  return {
    id,
    name,
    gstNumber: input.gstNumber ?? null,
    paymentTerms: input.paymentTerms ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    gstType: gstType || null,
  };
}

export async function updateSupplier(input: {
  id: string;
  name: string;
  gstNumber?: string | null;
  paymentTerms?: string | null;
  address?: string | null;
  phone?: string | null;
  gstType?: string | null;
  updatedBy?: string;
}) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = input.name.trim();
  if (!id) throw new Error('Supplier id is required');
  if (!name) throw new Error('Supplier name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM suppliers WHERE id = ?', id);
  if (!existing?.id) throw new Error('Supplier not found');

  const gstType = input.gstType != null ? String(input.gstType).trim() : '';
  if (gstType && gstType !== 'Intra-State' && gstType !== 'Inter-State') throw new Error('Invalid GST Type');

  await db.run(
    `UPDATE suppliers
        SET name = ?,
            gst_number = ?,
            payment_terms = ?,
            address = ?,
            phone = ?,
            gst_type = ?,
            updated_by = ?,
            updated_at = ?
      WHERE id = ?`,
    name,
    input.gstNumber ?? null,
    input.paymentTerms ?? null,
    input.address ?? null,
    input.phone ?? null,
    gstType || null,
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
  return {
    id,
    name,
    gstNumber: input.gstNumber ?? null,
    paymentTerms: input.paymentTerms ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    gstType: gstType || null,
  };
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

export async function listTransporters() {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>('SELECT id, name, phone FROM transporters ORDER BY created_at DESC');
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    phone: r.phone ?? null,
  }));
}

export async function createTransporter(input: { name: string; phone?: string; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `TRN-${crypto.randomUUID()}`;
  const name = input.name.trim();
  if (!name) throw new Error('Transporter name is required');
  await db.run(
    `INSERT INTO transporters (id, name, phone, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)`,
    id,
    name,
    input.phone ?? null,
    input.createdBy ?? 'system',
    now,
    input.createdBy ?? 'system',
    now
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'transporters',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return { id, name, phone: input.phone ?? null };
}

export async function updateTransporter(input: { id: string; name: string; phone?: string | null; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = input.name.trim();
  if (!id) throw new Error('Transporter id is required');
  if (!name) throw new Error('Transporter name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM transporters WHERE id = ?', id);
  if (!existing?.id) throw new Error('Transporter not found');

  await db.run(
    `UPDATE transporters SET name = ?, phone = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    name,
    input.phone ?? null,
    input.updatedBy ?? 'system',
    now,
    id
  );
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'transporters',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );
  return { id, name, phone: input.phone ?? null };
}

export async function deleteTransporter(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Transporter id is required');

  await db.run(`DELETE FROM transporters WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'transporters',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    null
  );
  return { ok: true };
}

export async function listUnits() {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>('SELECT id, name FROM units ORDER BY created_at DESC');
  return (rows ?? []).map((r) => ({ id: String(r.id), name: String(r.name) }));
}

export async function createUnit(input: { name: string; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `UNIT-${crypto.randomUUID()}`;
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Unit name is required');

  await db.run(
    `INSERT INTO units (id, name, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?)`,
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
    'units',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return { id, name };
}

export async function updateUnit(input: { id: string; name: string; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = String(input.name ?? '').trim();
  if (!id) throw new Error('Unit id is required');
  if (!name) throw new Error('Unit name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM units WHERE id = ?', id);
  if (!existing?.id) throw new Error('Unit not found');

  await db.run(`UPDATE units SET name = ?, updated_by = ?, updated_at = ? WHERE id = ?`, name, input.updatedBy ?? 'system', now, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'units',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );
  return { id, name };
}

export async function deleteUnit(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Unit id is required');

  const inUse = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM item_names WHERE unit_id = ?', id);
  if (Number(inUse?.count ?? 0) > 0) throw new Error('Cannot delete Unit: it is linked to Item Names.');

  await db.run(`DELETE FROM units WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'units',
    id,
    'delete',
    input.deletedBy ?? 'system',
    now,
    null
  );
  return { ok: true };
}

export async function listItemCategories() {
  await initDb();
  const db = await getDb();
  const rows = await db.all<any[]>('SELECT id, name FROM item_categories ORDER BY created_at DESC');
  return (rows ?? []).map((r) => ({ id: String(r.id), name: String(r.name) }));
}

export async function createItemCategory(input: { name: string; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `ICAT-${crypto.randomUUID()}`;
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Item Category name is required');

  await db.run(
    `INSERT INTO item_categories (id, name, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?)`,
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
    'item_categories',
    id,
    'create',
    input.createdBy ?? 'system',
    now,
    null
  );
  return { id, name };
}

export async function updateItemCategory(input: { id: string; name: string; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = String(input.name ?? '').trim();
  if (!id) throw new Error('Item Category id is required');
  if (!name) throw new Error('Item Category name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM item_categories WHERE id = ?', id);
  if (!existing?.id) throw new Error('Item Category not found');

  await db.run(`UPDATE item_categories SET name = ?, updated_by = ?, updated_at = ? WHERE id = ?`, name, input.updatedBy ?? 'system', now, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'item_categories',
    id,
    'update',
    input.updatedBy ?? 'system',
    now,
    null
  );
  return { id, name };
}

export async function deleteItemCategory(input: { id: string; deletedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('Item Category id is required');

  const inUse = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM item_names WHERE item_category_id = ?', id);
  if (Number(inUse?.count ?? 0) > 0) throw new Error('Cannot delete Item Category: it is linked to Item Names.');

  await db.run(`DELETE FROM item_categories WHERE id = ?`, id);
  await db.run(
    `INSERT INTO audit_logs (id, module, record_id, action, performed_by, timestamp, remarks) VALUES (?,?,?,?,?,?,?)`,
    `AUD-${crypto.randomUUID()}`,
    'item_categories',
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
		  const rows = await db.all<any[]>(
    `SELECT n.id,
            n.name,
            n.unit_id as unitId,
            u.name as unitName,
            n.item_category_id as itemCategoryId,
            c.name as itemCategoryName
       FROM item_names n
       LEFT JOIN units u ON u.id = n.unit_id
       LEFT JOIN item_categories c ON c.id = n.item_category_id
   ORDER BY n.created_at DESC`
  );
	  return (rows ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    unitId: r.unitId != null ? String(r.unitId) : null,
    unitName: r.unitName != null ? String(r.unitName) : null,
    itemCategoryId: r.itemCategoryId != null ? String(r.itemCategoryId) : null,
    itemCategoryName: r.itemCategoryName != null ? String(r.itemCategoryName) : null,
  }));
}

export async function createItemName(input: { name: string; unitId?: string | null; itemCategoryId?: string | null; createdBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = `INAME-${crypto.randomUUID()}`;
  const name = input.name.trim();
  if (!name) throw new Error('Item name is required');

  const unitId = String(input.unitId ?? '').trim() || null;
  if (unitId) {
    const u = await db.get<{ id: string; name: string }>('SELECT id, name FROM units WHERE id = ?', unitId);
    if (!u?.id) throw new Error('Invalid Unit');
  }

  const itemCategoryId = String(input.itemCategoryId ?? '').trim() || null;
  let categoryText: string | null = null;
  if (itemCategoryId) {
    const c = await db.get<{ id: string; name: string }>('SELECT id, name FROM item_categories WHERE id = ?', itemCategoryId);
    if (!c?.id) throw new Error('Invalid Item Category');
    categoryText = String(c.name);
  }

  await db.run(
    `INSERT INTO item_names (id, name, category, unit_id, item_category_id, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    id,
    name,
    categoryText,
    unitId,
    itemCategoryId,
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
  const unitRow = unitId ? await db.get<{ id: string; name: string }>('SELECT id, name FROM units WHERE id = ?', unitId) : null;
  return {
    id,
    name,
    unitId,
    unitName: unitRow?.name != null ? String(unitRow.name) : null,
    itemCategoryId,
    itemCategoryName: categoryText,
  };
}

export async function updateItemName(input: { id: string; name: string; unitId?: string | null; itemCategoryId?: string | null; updatedBy?: string }) {
  await initDb();
  const db = await getDb();
  const now = nowIso();
  const id = String(input.id ?? '').trim();
  const name = input.name.trim();
  if (!id) throw new Error('Item Name id is required');
  if (!name) throw new Error('Item Name is required');

  const existing = await db.get<{ id: string }>('SELECT id FROM item_names WHERE id = ?', id);
  if (!existing?.id) throw new Error('Item Name not found');

  const unitId = String(input.unitId ?? '').trim() || null;
  if (unitId) {
    const u = await db.get<{ id: string; name: string }>('SELECT id, name FROM units WHERE id = ?', unitId);
    if (!u?.id) throw new Error('Invalid Unit');
  }

  const itemCategoryId = String(input.itemCategoryId ?? '').trim() || null;
  let categoryText: string | null = null;
  if (itemCategoryId) {
    const c = await db.get<{ id: string; name: string }>('SELECT id, name FROM item_categories WHERE id = ?', itemCategoryId);
    if (!c?.id) throw new Error('Invalid Item Category');
    categoryText = String(c.name);
  }

  await db.run(
    `UPDATE item_names
        SET name = ?,
            category = ?,
            unit_id = ?,
            item_category_id = ?,
            updated_by = ?,
            updated_at = ?
      WHERE id = ?`,
    name,
    categoryText,
    unitId,
    itemCategoryId,
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

  const unitRow = unitId ? await db.get<{ id: string; name: string }>('SELECT id, name FROM units WHERE id = ?', unitId) : null;
  return {
    id,
    name,
    unitId,
    unitName: unitRow?.name != null ? String(unitRow.name) : null,
    itemCategoryId,
    itemCategoryName: categoryText,
  };
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

export type QueueFilters = {
  q?: string;
  firmId?: string;
  department?: string;
  projectId?: string;
  supplierId?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
};

function normalizeQueueFilters(input?: QueueFilters): Required<QueueFilters> {
  const q = String(input?.q ?? '').trim();
  const firmId = String(input?.firmId ?? '').trim();
  const department = String(input?.department ?? '').trim();
  const projectId = String(input?.projectId ?? '').trim();
  const supplierId = String(input?.supplierId ?? '').trim();
  const from = String(input?.from ?? '').trim();
  const to = String(input?.to ?? '').trim();
  return {
    q,
    firmId,
    department,
    projectId,
    supplierId,
    from,
    to,
  };
}

function pushDateRange(where: string[], params: any[], columnExpr: string, from: string, to: string) {
  const f = String(from ?? '').trim();
  const t = String(to ?? '').trim();
  if (f) {
    where.push(`date(${columnExpr}) >= date(?)`);
    params.push(f);
  }
  if (t) {
    where.push(`date(${columnExpr}) <= date(?)`);
    params.push(t);
  }
}

function pushSearch(where: string[], params: any[], q: string, columns: string[]) {
  const needle = String(q ?? '').trim();
  if (!needle) return;
  const like = `%${needle}%`;
  const clauses: string[] = [];
  for (const c of columns) {
    clauses.push(`${c} LIKE ?`);
    params.push(like);
  }
  if (clauses.length) where.push(`(${clauses.join(' OR ')})`);
}

export type OperationsFilters = {
  q?: string;
  firmId?: string;
  projectId?: string;
  supplierId?: string;
  status?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
};

function normalizeOperationsFilters(input?: OperationsFilters): Required<OperationsFilters> {
  const q = String(input?.q ?? '').trim();
  const firmId = String(input?.firmId ?? '').trim();
  const projectId = String(input?.projectId ?? '').trim();
  const supplierId = String(input?.supplierId ?? '').trim();
  const status = String(input?.status ?? '').trim();
  const from = String(input?.from ?? '').trim();
  const to = String(input?.to ?? '').trim();
  return { q, firmId, projectId, supplierId, status, from, to };
}

export type OperationsPrListRow = {
  prId: string;
  prNumber: string;
  firmId: string;
  firmName: string;
  department: string;
  projectId?: string | null;
  projectName?: string | null;
  requestedBy: string;
  requisitionDate: string;
  requiredDate: string;
  requestType?: 'Stock' | 'Project';
  status: PrStatus;
  itemCount: number;
  totalQty: number;
};

export async function listOperationsPr(filters?: OperationsFilters): Promise<OperationsPrListRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeOperationsFilters(filters);

  const where: string[] = ['1=1'];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push(`EXISTS (SELECT 1 FROM purchase_orders po WHERE po.pr_id = pr.id AND po.supplier_id = ?)`);
    params.push(f.supplierId);
  }
  if (f.status) {
    // Stored in DB as pending/approved/rejected.
    if (f.status === 'Approved') where.push(`pr.status = 'approved'`);
    else if (f.status === 'Rejected') where.push(`pr.status = 'rejected'`);
    else if (f.status === 'Pending Approval') where.push(`pr.status = 'pending'`);
  }
  pushDateRange(where, params, 'pr.created_at', f.from, f.to);
  if (f.q) {
    const q = f.q;
    // Include supplier search via linked POs.
    where.push(
      `(
        pr.id LIKE ? OR pr.pr_number LIKE ? OR f.name LIKE ? OR pr.requested_by LIKE ? OR prj.name LIKE ? OR COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') LIKE ?
        OR EXISTS (SELECT 1 FROM purchase_orders po WHERE po.pr_id = pr.id AND (po.supplier_id LIKE ? OR po.supplier LIKE ? OR po.po_number LIKE ? OR po.id LIKE ?))
      )`
    );
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like, like, like);
  }

  const sql = `
    SELECT pr.id as prId,
           pr.pr_number as prNumber,
           pr.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           pr.request_type as requestType,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           pr.requested_by as requestedBy,
           pr.created_at as requisitionDate,
           (SELECT MIN(required_date) FROM purchase_requisition_items pri WHERE pri.pr_id = pr.id) as requiredDate,
           (SELECT COUNT(1) FROM purchase_requisition_items pri WHERE pri.pr_id = pr.id) as itemCount,
           (SELECT COALESCE(SUM(requested_qty),0) FROM purchase_requisition_items pri WHERE pri.pr_id = pr.id) as totalQty,
           pr.status as dbStatus
      FROM purchase_requisitions pr
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
     WHERE ${where.join(' AND ')}
     ORDER BY pr.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => ({
    prId: String(r.prId),
    prNumber: String(r.prNumber ?? r.prId),
    firmId: String(r.firmId),
    firmName: String(r.firmName ?? r.firmId),
    requestType: String(r.requestType ?? '').trim() === 'Project' ? 'Project' : 'Stock',
    department: String(r.department ?? 'Operations'),
    projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
    projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
    requestedBy: String(r.requestedBy ?? ''),
    requisitionDate: String(r.requisitionDate ?? ''),
    requiredDate: String(r.requiredDate ?? '').slice(0, 10),
    status: mapPrStatus(String(r.dbStatus ?? 'pending')),
    itemCount: Number(r.itemCount ?? 0),
    totalQty: Number(r.totalQty ?? 0),
  }));
}

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
  createdAt: string;
  status: PoStatus;
  itemCount: number;
  totalAmount: number;
};

export async function listOperationsPo(filters?: OperationsFilters): Promise<OperationsPoListRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeOperationsFilters(filters);

  const where: string[] = ['1=1'];
  const params: any[] = [];

  if (f.firmId) {
    where.push('po.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('po.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.status) {
    // Stored in DB as draft/issued/partial/closed
    if (f.status === 'Closed') where.push(`po.status = 'closed'`);
    else if (f.status === 'Partial') where.push(`po.status = 'partial'`);
    else if (f.status === 'Open') where.push(`po.status NOT IN ('closed','partial')`);
  }
  pushDateRange(where, params, 'po.created_at', f.from, f.to);
  if (f.q) {
    const like = `%${f.q}%`;
    pushSearch(where, params, f.q, ['po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 'f.name', 's.name', 'prj.name', "COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations')"]);
    // pushSearch already added params; just rely.
  }

  const sql = `
    SELECT po.id as poId,
           po.po_number as poNumber,
           po.pr_id as prId,
           pr.pr_number as prNumber,
           po.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           po.supplier_id as supplierId,
           s.name as supplierName,
           po.order_date as orderDate,
           po.created_at as createdAt,
           po.status as dbStatus,
           (SELECT COUNT(1) FROM purchase_order_items poi WHERE poi.po_id = po.id) as itemCount,
           (SELECT COALESCE(SUM(total_amount),0) FROM purchase_order_items poi WHERE poi.po_id = po.id) as totalAmount
      FROM purchase_orders po
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN firms f ON f.id = po.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
 LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY po.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => ({
    poId: String(r.poId),
    poNumber: String(r.poNumber ?? r.poId),
    prId: String(r.prId),
    prNumber: String(r.prNumber ?? r.prId),
    firmId: String(r.firmId ?? ''),
    firmName: String(r.firmName ?? r.firmId ?? ''),
    department: String(r.department ?? 'Operations'),
    projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
    projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
    supplierId: String(r.supplierId ?? ''),
    supplierName: String(r.supplierName ?? ''),
    orderDate: r.orderDate != null ? String(r.orderDate) : null,
    createdAt: String(r.createdAt ?? ''),
    status: String(r.dbStatus) === 'closed' ? 'Closed' : String(r.dbStatus) === 'partial' ? 'Partial' : 'Open',
    itemCount: Number(r.itemCount ?? 0),
    totalAmount: Number(r.totalAmount ?? 0),
  }));
}

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

export async function listOperationsGrns(filters?: OperationsFilters): Promise<OperationsGrnListRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeOperationsFilters(filters);

  const where: string[] = ['1=1'];
  const params: any[] = [];

  if (f.firmId) {
    where.push('po.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('po.supplier_id = ?');
    params.push(f.supplierId);
  }
  pushDateRange(where, params, 'g.received_date', f.from, f.to);
  if (f.q) pushSearch(where, params, f.q, ['g.id', 'g.grn_number', 'po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 'f.name', 's.name']);

  const sql = `
    SELECT g.id as grnId,
           g.grn_number as grnNumber,
           g.received_date as receivedDate,
           g.created_at as createdAt,
           po.id as poId,
           po.po_number as poNumber,
           po.pr_id as prId,
           pr.pr_number as prNumber,
           po.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           po.supplier_id as supplierId,
           s.name as supplierName,
           (SELECT COUNT(1) FROM grn_items gi WHERE gi.grn_id = g.id) as itemCount,
           (SELECT COALESCE(SUM(received_qty),0) FROM grn_items gi WHERE gi.grn_id = g.id) as totalQty
      FROM grns g
      JOIN purchase_orders po ON po.id = g.po_id
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN firms f ON f.id = po.firm_id
 LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY g.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => ({
    grnId: String(r.grnId),
    grnNumber: String(r.grnNumber ?? r.grnId),
    receivedDate: String(r.receivedDate ?? '').slice(0, 10),
    poId: String(r.poId),
    poNumber: String(r.poNumber ?? r.poId),
    prId: String(r.prId),
    prNumber: String(r.prNumber ?? r.prId),
    firmId: String(r.firmId ?? ''),
    firmName: String(r.firmName ?? r.firmId ?? ''),
    supplierId: String(r.supplierId ?? ''),
    supplierName: String(r.supplierName ?? ''),
    itemCount: Number(r.itemCount ?? 0),
    totalQty: Number(r.totalQty ?? 0),
    createdAt: String(r.createdAt ?? ''),
  }));
}

export type OperationsInvoiceListRow = {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: number;
  poId: string;
  poNumber: string;
  prId: string;
  prNumber: string;
  firmId: string;
  firmName: string;
  supplierId: string;
  supplierName: string;
  status: InvoiceStatus;
  paymentStatus?: string;
  paymentDate?: string;
  createdAt: string;
};

export async function listOperationsInvoices(filters?: OperationsFilters): Promise<OperationsInvoiceListRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeOperationsFilters(filters);

  const where: string[] = ['1=1'];
  const params: any[] = [];

  if (f.firmId) {
    where.push('po.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('inv.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.status) {
    // db status is pending/verified/hold/approved and we compute Paid from payments sum; filter on computed only for non-Paid.
    if (f.status === 'On Hold') where.push(`inv.status = 'hold'`);
    else if (f.status === 'Approved') where.push(`inv.status = 'approved'`);
    else if (f.status === 'Recorded') where.push(`inv.status IN ('pending','verified')`);
    else if (f.status === 'Paid')
      where.push(`(SELECT COALESCE(SUM(amount_paid),0) FROM payments p WHERE p.invoice_id = inv.id) >= COALESCE(inv.total_amount,0) AND COALESCE(inv.total_amount,0) > 0`);
  }
  pushDateRange(where, params, 'inv.invoice_date', f.from, f.to);
  if (f.q) pushSearch(where, params, f.q, ['inv.id', 'inv.invoice_number', 'po.po_number', 'po.id', 'pr.pr_number', 'pr.id', 'f.name', 's.name', 'prj.name']);

  const sql = `
    SELECT inv.id as invoiceId,
           inv.invoice_number as invoiceNo,
           inv.invoice_date as invoiceDate,
           inv.total_amount as invoiceAmount,
           inv.status as dbStatus,
           inv.payment_status as paymentStatus,
           inv.payment_date as paymentDate,
           inv.created_at as createdAt,
           inv.po_id as poId,
           po.po_number as poNumber,
           po.pr_id as prId,
           pr.pr_number as prNumber,
           po.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           inv.supplier_id as supplierId,
           s.name as supplierName,
           (SELECT COALESCE(SUM(amount_paid),0) FROM payments p WHERE p.invoice_id = inv.id) as paidAmount
      FROM invoices inv
      JOIN purchase_orders po ON po.id = inv.po_id
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN firms f ON f.id = po.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
 LEFT JOIN suppliers s ON s.id = inv.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY inv.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => {
    const amount = Number(r.invoiceAmount ?? 0);
    const paid = Number(r.paidAmount ?? 0);
    const isPaid = paid >= amount && amount > 0;
    return {
      invoiceId: String(r.invoiceId),
      invoiceNo: String(r.invoiceNo ?? r.invoiceId),
      invoiceDate: String(r.invoiceDate ?? '').slice(0, 10),
      invoiceAmount: amount,
      poId: String(r.poId),
      poNumber: String(r.poNumber ?? r.poId),
      prId: String(r.prId),
      prNumber: String(r.prNumber ?? r.prId),
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? r.firmId ?? ''),
      supplierId: String(r.supplierId ?? ''),
      supplierName: String(r.supplierName ?? ''),
      status: mapInvoiceStatus(String(r.dbStatus ?? 'pending'), isPaid),
      paymentStatus: r.paymentStatus != null && String(r.paymentStatus).trim() ? String(r.paymentStatus) : undefined,
      paymentDate: r.paymentDate != null && String(r.paymentDate).trim() ? String(r.paymentDate).slice(0, 10) : undefined,
      createdAt: String(r.createdAt ?? ''),
    } satisfies OperationsInvoiceListRow;
  });
}

export type OperationsPaymentListRow = {
  // Operations "Payments" tab is based on invoice.payment_status/payment_date
  // (the UI updates those fields without inserting into the payments table).
  paymentId: string; // unique row id (we use invoiceId)
  paymentDate: string; // invoice.payment_date
  amount: number; // invoice.total_amount
  status?: string | null; // invoice.payment_status (e.g., "Full Paid")
  // Optional fields still used by payment-detail view (when payments table has rows).
  mode?: string;
  referenceNo?: string;
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

function splitPaymentRemarks(remarks: unknown): { mode?: string; referenceNo?: string } {
  const s = String(remarks ?? '').trim();
  if (!s) return {};
  const parts = s.split(' / ');
  if (parts.length >= 2) return { mode: parts[0]!.trim(), referenceNo: parts.slice(1).join(' / ').trim() };
  return { mode: s };
}

export async function listOperationsPayments(filters?: OperationsFilters): Promise<OperationsPaymentListRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeOperationsFilters(filters);

  const where: string[] = ['1=1'];
  const params: any[] = [];

  // Payments tab should only show invoices with a payment status set.
  where.push("COALESCE(TRIM(inv.payment_status),'') <> ''");

  if (f.firmId) {
    where.push('po.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('inv.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.status) {
    // Payment status is tracked on invoices as "Partly Paid" / "Full Paid"
    if (f.status === 'Full Paid' || f.status === 'Partly Paid') {
      where.push('inv.payment_status = ?');
      params.push(f.status);
    }
  }
  pushDateRange(where, params, 'inv.payment_date', f.from, f.to);
  if (f.q) pushSearch(where, params, f.q, ['inv.id', 'inv.invoice_number', 'po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 'f.name', 's.name']);

  const sql = `
    SELECT inv.id as paymentId,
           inv.payment_date as paymentDate,
           inv.total_amount as amountPaid,
           inv.payment_status as status,
           inv.created_at as createdAt,
           inv.id as invoiceId,
           inv.invoice_number as invoiceNo,
           po.id as poId,
           po.po_number as poNumber,
           pr.id as prId,
           pr.pr_number as prNumber,
           po.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           inv.supplier_id as supplierId,
           s.name as supplierName
      FROM invoices inv
      JOIN purchase_orders po ON po.id = inv.po_id
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN firms f ON f.id = po.firm_id
 LEFT JOIN suppliers s ON s.id = inv.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY inv.payment_date DESC, inv.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => ({
    paymentId: String(r.paymentId),
    paymentDate: String(r.paymentDate ?? '').slice(0, 10),
    amount: Number(r.amountPaid ?? 0),
    status: r.status != null && String(r.status).trim() ? String(r.status) : null,
    invoiceId: String(r.invoiceId),
    invoiceNo: String(r.invoiceNo ?? r.invoiceId),
    poId: String(r.poId),
    poNumber: String(r.poNumber ?? r.poId),
    prId: String(r.prId),
    prNumber: String(r.prNumber ?? r.prId),
    firmId: String(r.firmId ?? ''),
    firmName: String(r.firmName ?? r.firmId ?? ''),
    supplierId: String(r.supplierId ?? ''),
    supplierName: String(r.supplierName ?? ''),
    createdAt: String(r.createdAt ?? ''),
  }));
}

export type OperationsPrDetail = {
  pr: PrWithItems;
  pos: PoWithItems[];
  grns: GrnWithItems[];
  invoices: InvoiceWithItems[];
  paymentsByInvoiceId: Record<string, PaymentRow[]>;
};

export async function getOperationsPrDetail(prId: string): Promise<OperationsPrDetail> {
  await initDb();
  const db = await getDb();
  const pr = await getPr(prId);
  if (!pr) throw new Error('PR not found');

  const pos = await listPosByPrId(prId);
  const grns = await listGrnsByPrId(prId);
  const invoices = await listInvoicesByPrId(prId);

  const paymentsByInvoiceId: Record<string, PaymentRow[]> = {};
  for (const inv of invoices) {
    const invoiceId = inv.invoice.id;
    const rows = await db.all<any[]>(
      `SELECT id, invoice_id as invoiceId, payment_date as paymentDate, amount_paid as amountPaid, status, remarks, created_at as createdAt
       FROM payments WHERE invoice_id = ? ORDER BY created_at ASC`,
      invoiceId
    );
    paymentsByInvoiceId[invoiceId] = (rows ?? []).map((r) => {
      const extra = splitPaymentRemarks(r.remarks);
      return {
        id: String(r.id),
        invoiceId,
        paymentDate: String(r.paymentDate ?? '').slice(0, 10),
        amount: Number(r.amountPaid ?? 0),
        mode: extra.mode ?? '',
        referenceNo: extra.referenceNo ?? '',
        createdAt: String(r.createdAt ?? ''),
      } satisfies PaymentRow;
    });
  }

  return { pr, pos, grns, invoices, paymentsByInvoiceId };
}

export async function getOperationsPoDetail(poId: string): Promise<{ po: PoWithItems; grns: GrnWithItems[]; invoice?: InvoiceWithItems; payments: PaymentRow[] }> {
  await initDb();
  const db = await getDb();
  const po = await getPo(poId);
  if (!po) throw new Error('PO not found');
  const grns = await listGrnsByPoId(poId);
  const inv = await db.get<any>('SELECT id FROM invoices WHERE po_id = ? ORDER BY created_at DESC LIMIT 1', poId);
  const invoice = inv?.id ? await (async () => {
    const x = await getInvoiceWithItems(db, String(inv.id));
    return x ?? undefined;
  })() : undefined;
  const payments = invoice
    ? ((await db.all<any[]>(
        `SELECT id, invoice_id as invoiceId, payment_date as paymentDate, amount_paid as amountPaid, remarks, created_at as createdAt
         FROM payments WHERE invoice_id = ? ORDER BY created_at ASC`,
        invoice.invoice.id
      )) ?? []).map((r) => {
        const extra = splitPaymentRemarks(r.remarks);
        return {
          id: String(r.id),
          invoiceId: String(r.invoiceId),
          paymentDate: String(r.paymentDate ?? '').slice(0, 10),
          amount: Number(r.amountPaid ?? 0),
          mode: extra.mode ?? '',
          referenceNo: extra.referenceNo ?? '',
          createdAt: String(r.createdAt ?? ''),
        } satisfies PaymentRow;
      })
    : [];
  return { po, grns, invoice, payments };
}

export async function getOperationsGrnDetail(grnId: string): Promise<{ grn: GrnWithItems; po: PoWithItems; invoice?: InvoiceWithItems }> {
  await initDb();
  const db = await getDb();
  const grn = await getGrnWithItems(db, grnId);
  if (!grn) throw new Error('GRN not found');
  const po = await getPo(String(grn.grn.poId));
  if (!po) throw new Error('PO not found for GRN');
  const inv = await db.get<any>('SELECT id FROM invoices WHERE po_id = ? ORDER BY created_at DESC LIMIT 1', po.po.id);
  const invoice = inv?.id ? (await getInvoiceWithItems(db, String(inv.id))) ?? undefined : undefined;
  return { grn, po, invoice };
}

export async function getOperationsInvoiceDetail(invoiceId: string): Promise<{ invoice: InvoiceWithItems; payments: PaymentRow[] }> {
  await initDb();
  const db = await getDb();
  const invoice = await getInvoiceWithItems(db, invoiceId);
  if (!invoice) throw new Error('Invoice not found');
  const rows = await db.all<any[]>(
    `SELECT id, invoice_id as invoiceId, payment_date as paymentDate, amount_paid as amountPaid, remarks, created_at as createdAt
     FROM payments WHERE invoice_id = ? ORDER BY created_at ASC`,
    invoiceId
  );
  const payments = (rows ?? []).map((r) => {
    const extra = splitPaymentRemarks(r.remarks);
    return {
      id: String(r.id),
      invoiceId,
      paymentDate: String(r.paymentDate ?? '').slice(0, 10),
      amount: Number(r.amountPaid ?? 0),
      mode: extra.mode ?? '',
      referenceNo: extra.referenceNo ?? '',
      createdAt: String(r.createdAt ?? ''),
    } satisfies PaymentRow;
  });
  return { invoice, payments };
}

export async function getOperationsPaymentDetail(
  paymentId: string
): Promise<{ payment: OperationsPaymentListRow; invoice: InvoiceWithItems; po: PoWithItems; pr: PrWithItems }> {
  await initDb();
  const db = await getDb();

  const row = await db.get<any>(
    `
    SELECT p.id as paymentId,
           p.payment_date as paymentDate,
           p.amount_paid as amountPaid,
           p.status as status,
           p.remarks as remarks,
           p.created_at as createdAt,
           inv.id as invoiceId,
           inv.invoice_number as invoiceNo,
           po.id as poId,
           po.po_number as poNumber,
           pr.id as prId,
           pr.pr_number as prNumber,
           po.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           p.supplier_id as supplierId,
           s.name as supplierName
      FROM payments p
      JOIN invoices inv ON inv.id = p.invoice_id
      JOIN purchase_orders po ON po.id = p.po_id
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN firms f ON f.id = po.firm_id
 LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.id = ?
     LIMIT 1
    `,
    paymentId
  );
  if (!row) throw new Error('Payment not found');

  const extra = splitPaymentRemarks(row.remarks);
  const payment: OperationsPaymentListRow = {
    paymentId: String(row.paymentId),
    paymentDate: String(row.paymentDate ?? '').slice(0, 10),
    amount: Number(row.amountPaid ?? 0),
    mode: extra.mode,
    referenceNo: extra.referenceNo,
    status: row.status != null ? String(row.status) : null,
    invoiceId: String(row.invoiceId),
    invoiceNo: String(row.invoiceNo ?? row.invoiceId),
    poId: String(row.poId),
    poNumber: String(row.poNumber ?? row.poId),
    prId: String(row.prId),
    prNumber: String(row.prNumber ?? row.prId),
    firmId: String(row.firmId ?? ''),
    firmName: String(row.firmName ?? row.firmId ?? ''),
    supplierId: String(row.supplierId ?? ''),
    supplierName: String(row.supplierName ?? ''),
    createdAt: String(row.createdAt ?? ''),
  };

  const invoice = await getInvoiceWithItems(db, payment.invoiceId);
  if (!invoice) throw new Error('Invoice not found for payment');
  const po = await getPoWithItems(db, payment.poId);
  if (!po) throw new Error('PO not found for payment');
  const pr = await getPr(payment.prId);
  if (!pr) throw new Error('PR not found for payment');

  return { payment, invoice, po, pr };
}

export async function exportOperationsSheetBuffer(
  sheetName: string,
  rows: any[],
  header?: string[]
): Promise<Buffer> {
  const wb = XLSX.utils.book_new();
  const ws = header && header.length ? XLSX.utils.aoa_to_sheet([header]) : XLSX.utils.json_to_sheet([]);
  if (!header || !header.length) {
    // when using json_to_sheet directly, it creates headers automatically
    const jsonWs = XLSX.utils.json_to_sheet(rows ?? []);
    XLSX.utils.book_append_sheet(wb, jsonWs, sheetName);
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  }
  XLSX.utils.sheet_add_json(ws, rows ?? [], { origin: 'A2', skipHeader: true });
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
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
  status: PrStatus;
  pendingReason: string;
};

export async function listQueueApprovePr(filters?: QueueFilters): Promise<ApprovePrQueueRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeQueueFilters(filters);

  const where: string[] = [`pr.status = 'pending'`];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.department) {
    where.push(`COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') = ?`);
    params.push(f.department);
  }
  pushDateRange(where, params, 'pr.created_at', f.from, f.to);
  pushSearch(where, params, f.q, ['pr.id', 'pr.pr_number', 'f.name', 'pr.requested_by', 'prj.name', "COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations')"]);

	  const sql = `
	    SELECT pr.id as prId,
	           pr.pr_number as prNumber,
	           pr.firm_id as firmId,
	           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
	           pr.request_type as requestType,
	           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
	           pr.project_id as projectId,
	           prj.name as projectName,
	           pr.requested_by as requestedBy,
	           pr.created_at as requisitionDate,
           (SELECT MIN(required_date) FROM purchase_requisition_items pri WHERE pri.pr_id = pr.id) as requiredDate
      FROM purchase_requisitions pr
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
     WHERE ${where.join(' AND ')}
     ORDER BY pr.created_at DESC
  `;
	  const rows = await db.all<any[]>(sql, ...params);
	  return (rows ?? []).map((r) => ({
	    prId: String(r.prId),
	    prNumber: String(r.prNumber ?? r.prId),
	    firmId: String(r.firmId),
	    firmName: String(r.firmName ?? r.firmId),
	    requestType: String(r.requestType ?? '').trim() === 'Project' ? 'Project' : 'Stock',
	    department: String(r.department ?? 'Operations'),
	    projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
	    projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
	    requestedBy: String(r.requestedBy ?? ''),
    requisitionDate: String(r.requisitionDate ?? ''),
    requiredDate: String(r.requiredDate ?? '').slice(0, 10),
    status: 'Pending Approval',
    pendingReason: 'Awaiting PR approval',
  }));
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
};

export async function listQueueCreatePo(filters?: QueueFilters): Promise<CreatePoQueueRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeQueueFilters(filters);

  const where: string[] = [`pr.status = 'approved'`, `rem.remainingQty > 0`];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.department) {
    where.push(`COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') = ?`);
    params.push(f.department);
  }
  pushDateRange(where, params, 'pr.created_at', f.from, f.to);
  pushSearch(where, params, f.q, ['pr.id', 'pr.pr_number', 'f.name', 'prj.name', "COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations')"]);

  const sql = `
    WITH approved AS (
      SELECT pri.pr_id as prId, pri.item_id as itemId, COALESCE(SUM(pri.approved_qty),0) as approvedQty
        FROM purchase_requisition_items pri
       WHERE pri.status = 'approved'
       GROUP BY pri.pr_id, pri.item_id
    ),
    ordered AS (
      SELECT po.pr_id as prId, poi.item_id as itemId, COALESCE(SUM(poi.quantity),0) as orderedQty
        FROM purchase_orders po
        JOIN purchase_order_items poi ON poi.po_id = po.id
       GROUP BY po.pr_id, poi.item_id
    ),
    rem AS (
      SELECT a.prId as prId,
             SUM(CASE
                   WHEN (a.approvedQty - COALESCE(o.orderedQty,0)) > 0 THEN (a.approvedQty - COALESCE(o.orderedQty,0))
                   ELSE 0
                 END) as remainingQty
        FROM approved a
   LEFT JOIN ordered o ON o.prId = a.prId AND o.itemId = a.itemId
       GROUP BY a.prId
    ),
    po_counts AS (
      SELECT pr_id as prId, COUNT(*) as poCount
        FROM purchase_orders
       GROUP BY pr_id
    )
    SELECT pr.id as prId,
           pr.pr_number as prNumber,
           pr.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           pr.created_at as requisitionDate,
           rem.remainingQty as remainingQty,
           COALESCE(pc.poCount,0) as poCount
      FROM purchase_requisitions pr
      JOIN rem ON rem.prId = pr.id
 LEFT JOIN po_counts pc ON pc.prId = pr.id
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
     WHERE ${where.join(' AND ')}
     ORDER BY pr.created_at DESC
  `;

  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => {
    const poCount = Number(r.poCount ?? 0);
    return {
      prId: String(r.prId),
      prNumber: String(r.prNumber ?? r.prId),
      firmId: String(r.firmId),
      firmName: String(r.firmName ?? r.firmId),
      department: String(r.department ?? 'Operations'),
      projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
      projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
      requisitionDate: String(r.requisitionDate ?? ''),
      remainingQty: Number(r.remainingQty ?? 0),
      poCount,
      pendingReason: poCount > 0 ? 'Additional PO lines needed for remaining qty' : 'No PO created yet',
    };
  });
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
};

export async function listQueueCheckPo(filters?: QueueFilters): Promise<CheckPoQueueRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeQueueFilters(filters);

  const where: string[] = [
    `(po.check_po IS NULL OR po.check_po = 0 OR po.check_po_user_id IS NULL OR TRIM(po.check_po_user_id) = '' OR po.check_date IS NULL OR TRIM(po.check_date) = '')`,
  ];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('po.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.department) {
    where.push(`COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') = ?`);
    params.push(f.department);
  }
  pushDateRange(where, params, "COALESCE(NULLIF(TRIM(po.order_date),''), substr(po.created_at,1,10))", f.from, f.to);
  pushSearch(where, params, f.q, ['po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 's.name', 'f.name', 'prj.name']);

  const sql = `
    SELECT po.id as poId,
           po.po_number as poNumber,
           pr.id as prId,
           pr.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           po.supplier_id as supplierId,
           COALESCE(s.name, '') as supplierName,
           po.order_date as orderDate,
           po.created_at as createdAt
      FROM purchase_orders po
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
 LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY po.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => ({
    poId: String(r.poId),
    poNumber: String(r.poNumber ?? r.poId),
    prId: String(r.prId),
    firmId: String(r.firmId),
    firmName: String(r.firmName ?? r.firmId),
    department: String(r.department ?? 'Operations'),
    projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
    projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
    supplierId: r.supplierId != null && String(r.supplierId).trim() ? String(r.supplierId) : null,
    supplierName: String(r.supplierName ?? ''),
    orderDate: r.orderDate != null && String(r.orderDate).trim() ? String(r.orderDate).slice(0, 10) : null,
    createdAt: String(r.createdAt ?? ''),
    pendingReason: 'PO is not checked yet',
  }));
}

export type SendPoQueueRow = CheckPoQueueRow;

export async function listQueueSendPo(filters?: QueueFilters): Promise<SendPoQueueRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeQueueFilters(filters);

  const where: string[] = [
    `(po.check_po = 1 OR po.check_po = '1')`,
    `(po.sent_by IS NULL OR TRIM(po.sent_by) = '')`,
    `(po.sent_date IS NULL OR TRIM(po.sent_date) = '')`,
  ];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('po.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.department) {
    where.push(`COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') = ?`);
    params.push(f.department);
  }
  pushDateRange(where, params, "COALESCE(NULLIF(TRIM(po.order_date),''), substr(po.created_at,1,10))", f.from, f.to);
  pushSearch(where, params, f.q, ['po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 's.name', 'f.name', 'prj.name']);

  const sql = `
    SELECT po.id as poId,
           po.po_number as poNumber,
           pr.id as prId,
           pr.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           po.supplier_id as supplierId,
           COALESCE(s.name, '') as supplierName,
           po.order_date as orderDate,
           po.created_at as createdAt
      FROM purchase_orders po
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
 LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY po.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => ({
    poId: String(r.poId),
    poNumber: String(r.poNumber ?? r.poId),
    prId: String(r.prId),
    firmId: String(r.firmId),
    firmName: String(r.firmName ?? r.firmId),
    department: String(r.department ?? 'Operations'),
    projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
    projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
    supplierId: r.supplierId != null && String(r.supplierId).trim() ? String(r.supplierId) : null,
    supplierName: String(r.supplierName ?? ''),
    orderDate: r.orderDate != null && String(r.orderDate).trim() ? String(r.orderDate).slice(0, 10) : null,
    createdAt: String(r.createdAt ?? ''),
    pendingReason: 'PO checked; pending sending',
  }));
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
};

export async function listQueueCreateGrn(filters?: QueueFilters): Promise<CreateGrnQueueRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeQueueFilters(filters);

  const where: string[] = [
    `(po.sent_by IS NOT NULL AND TRIM(po.sent_by) <> '')`,
    `(po.sent_date IS NOT NULL AND TRIM(po.sent_date) <> '')`,
  ];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('po.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.department) {
    where.push(`COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') = ?`);
    params.push(f.department);
  }
  pushDateRange(where, params, 'po.created_at', f.from, f.to);
  pushSearch(where, params, f.q, ['po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 's.name', 'f.name', 'prj.name']);

  const pendingQtyExpr = `SUM(CASE
    WHEN (poi.quantity - COALESCE(r.receivedQty,0)) > 0 THEN (poi.quantity - COALESCE(r.receivedQty,0))
    ELSE 0
  END)`;

  const sql = `
    WITH received AS (
      SELECT g.po_id as poId, gi.item_id as itemId, COALESCE(SUM(gi.received_qty),0) as receivedQty
        FROM grns g
        JOIN grn_items gi ON gi.grn_id = g.id
       GROUP BY g.po_id, gi.item_id
    )
    SELECT po.id as poId,
           po.po_number as poNumber,
           pr.id as prId,
           pr.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           po.supplier_id as supplierId,
           COALESCE(s.name, '') as supplierName,
           po.created_at as createdAt,
           ${pendingQtyExpr} as pendingQty
      FROM purchase_orders po
      JOIN purchase_order_items poi ON poi.po_id = po.id
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
 LEFT JOIN suppliers s ON s.id = po.supplier_id
 LEFT JOIN received r ON r.poId = po.id AND r.itemId = poi.item_id
     WHERE ${where.length ? where.join(' AND ') : '1=1'}
     GROUP BY po.id
     HAVING ${pendingQtyExpr} > 0
     ORDER BY po.created_at DESC
  `;

  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => ({
    poId: String(r.poId),
    poNumber: String(r.poNumber ?? r.poId),
    prId: String(r.prId),
    firmId: String(r.firmId),
    firmName: String(r.firmName ?? r.firmId),
    department: String(r.department ?? 'Operations'),
    projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
    projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
    supplierId: r.supplierId != null && String(r.supplierId).trim() ? String(r.supplierId) : null,
    supplierName: String(r.supplierName ?? ''),
    pendingQty: Number(r.pendingQty ?? 0),
    createdAt: String(r.createdAt ?? ''),
    pendingReason: 'Pending material receipt (GRN)',
  }));
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

export async function listQueueQc(filters?: QueueFilters): Promise<QcQueueRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeQueueFilters(filters);

  const where: string[] = ['pendingItems > 0'];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('po.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.department) {
    where.push(`COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') = ?`);
    params.push(f.department);
  }
  pushDateRange(where, params, 'g.received_date', f.from, f.to);
  pushSearch(where, params, f.q, ['g.id', 'g.grn_number', 'po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 's.name', 'f.name', 'prj.name']);

  const sql = `
    WITH missing_qc AS (
      SELECT gi.grn_id as grnId, COUNT(*) as missingCount
        FROM grn_items gi
   LEFT JOIN qc_records qr ON qr.grn_id = gi.grn_id AND qr.item_id = gi.item_id
       WHERE qr.id IS NULL
       GROUP BY gi.grn_id
    )
    SELECT g.id as grnId,
           g.grn_number as grnNumber,
           g.po_id as poId,
           po.po_number as poNumber,
           pr.id as prId,
           pr.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           po.supplier_id as supplierId,
           COALESCE(s.name, '') as supplierName,
           g.received_date as receivedDate,
           COALESCE(mq.missingCount,0) as pendingItems
      FROM grns g
      JOIN purchase_orders po ON po.id = g.po_id
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
      JOIN missing_qc mq ON mq.grnId = g.id
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
 LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY date(g.received_date) DESC, g.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => {
    const pendingItems = Number(r.pendingItems ?? 0);
    return {
      grnId: String(r.grnId),
      grnNumber: String(r.grnNumber ?? r.grnId),
      poId: String(r.poId),
      poNumber: String(r.poNumber ?? r.poId),
      prId: String(r.prId),
      firmId: String(r.firmId),
      firmName: String(r.firmName ?? r.firmId),
      department: String(r.department ?? 'Operations'),
      projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
      projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
      supplierId: r.supplierId != null && String(r.supplierId).trim() ? String(r.supplierId) : null,
      supplierName: String(r.supplierName ?? ''),
      receivedDate: String(r.receivedDate ?? '').slice(0, 10),
      pendingItems,
      pendingReason: pendingItems === 1 ? 'QC pending for 1 item' : `QC pending for ${pendingItems} items`,
    };
  });
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

export async function listQueueEnterInvoice(filters?: QueueFilters): Promise<EnterInvoiceQueueRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeQueueFilters(filters);

  const where: string[] = ['pendingQty > 0'];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('po.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.department) {
    where.push(`COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') = ?`);
    params.push(f.department);
  }
  pushDateRange(where, params, 'po.created_at', f.from, f.to);
  pushSearch(where, params, f.q, ['po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 's.name', 'f.name', 'prj.name']);

  const sql = `
    WITH invoiced AS (
      SELECT inv.po_id as poId, ii.item_id as itemId, COALESCE(SUM(ii.quantity),0) as invoicedQty
        FROM invoices inv
        JOIN invoice_items ii ON ii.invoice_id = inv.id
       GROUP BY inv.po_id, ii.item_id
    )
    SELECT po.id as poId,
           po.po_number as poNumber,
           pr.id as prId,
           pr.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           po.supplier_id as supplierId,
           COALESCE(s.name, '') as supplierName,
           SUM(CASE
                 WHEN (poi.quantity - COALESCE(i.invoicedQty,0)) > 0 THEN (poi.quantity - COALESCE(i.invoicedQty,0))
                 ELSE 0
               END) as pendingQty
      FROM purchase_orders po
      JOIN purchase_order_items poi ON poi.po_id = po.id
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
 LEFT JOIN suppliers s ON s.id = po.supplier_id
 LEFT JOIN invoiced i ON i.poId = po.id AND i.itemId = poi.item_id
     GROUP BY po.id
     HAVING pendingQty > 0
  `;
  const rows = await db.all<any[]>(`SELECT * FROM (${sql}) WHERE ${where.join(' AND ')} ORDER BY pendingQty DESC`, ...params);
  return (rows ?? []).map((r) => ({
    poId: String(r.poId),
    poNumber: String(r.poNumber ?? r.poId),
    prId: String(r.prId),
    firmId: String(r.firmId),
    firmName: String(r.firmName ?? r.firmId),
    department: String(r.department ?? 'Operations'),
    projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
    projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
    supplierId: r.supplierId != null && String(r.supplierId).trim() ? String(r.supplierId) : null,
    supplierName: String(r.supplierName ?? ''),
    pendingQty: Number(r.pendingQty ?? 0),
    pendingReason: 'Pending invoice entry',
  }));
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

export async function listQueueLinkInvoiceGrn(filters?: QueueFilters): Promise<LinkInvoiceGrnQueueRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeQueueFilters(filters);

  const where: string[] = ['p.pendingQty > 0'];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('po.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.department) {
    where.push(`COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') = ?`);
    params.push(f.department);
  }
  pushDateRange(where, params, 'g.received_date', f.from, f.to);
  pushSearch(where, params, f.q, ['g.id', 'g.grn_number', 'po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 's.name', 'f.name', 'prj.name']);

  const sql = `
    WITH gi_linked AS (
      SELECT grn_item_id as grnItemId, COALESCE(SUM(linked_qty),0) as linkedQty
        FROM grn_invoice_item_links
       GROUP BY grn_item_id
    ),
    qc AS (
      SELECT grn_id as grnId, item_id as itemId, COUNT(*) as cnt, COALESCE(SUM(accepted_qty),0) as acceptedQty
        FROM qc_records
       GROUP BY grn_id, item_id
    ),
    p AS (
      SELECT g.id as grnId,
             SUM(CASE
                   WHEN (qc.acceptedQty - COALESCE(l.linkedQty,0)) > 0 THEN (qc.acceptedQty - COALESCE(l.linkedQty,0))
                   ELSE 0
                 END) as pendingQty,
             SUM(CASE WHEN (qc.acceptedQty - COALESCE(l.linkedQty,0)) > 0 THEN 1 ELSE 0 END) as pendingItems
        FROM grns g
        JOIN grn_items gi ON gi.grn_id = g.id
        JOIN qc ON qc.grnId = g.id AND qc.itemId = gi.item_id AND qc.cnt > 0
   LEFT JOIN gi_linked l ON l.grnItemId = gi.id
       GROUP BY g.id
      HAVING pendingQty > 0
    )
    SELECT g.id as grnId,
           g.grn_number as grnNumber,
           g.received_date as receivedDate,
           po.id as poId,
           po.po_number as poNumber,
           pr.id as prId,
           pr.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           po.supplier_id as supplierId,
           COALESCE(s.name, '') as supplierName,
           p.pendingQty as pendingQty,
           p.pendingItems as pendingItems
      FROM grns g
      JOIN p ON p.grnId = g.id
      JOIN purchase_orders po ON po.id = g.po_id
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
 LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY date(g.received_date) DESC, g.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => ({
    grnId: String(r.grnId),
    grnNumber: String(r.grnNumber ?? r.grnId),
    receivedDate: String(r.receivedDate ?? '').slice(0, 10),
    poId: String(r.poId),
    poNumber: String(r.poNumber ?? r.poId),
    prId: String(r.prId),
    firmId: String(r.firmId),
    firmName: String(r.firmName ?? r.firmId),
    department: String(r.department ?? 'Operations'),
    projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
    projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
    supplierId: r.supplierId != null && String(r.supplierId).trim() ? String(r.supplierId) : null,
    supplierName: String(r.supplierName ?? ''),
    pendingQty: Number(r.pendingQty ?? 0),
    pendingItems: Number(r.pendingItems ?? 0),
    pendingReason: 'Invoice ↔ GRN linking incomplete',
  }));
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
  status: InvoiceStatus;
  pendingReason: string;
};

export async function listQueueApproveInvoice(filters?: QueueFilters): Promise<ApproveInvoiceQueueRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeQueueFilters(filters);

  const where: string[] = [`inv.status IN ('pending','verified','hold')`];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('po.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.department) {
    where.push(`COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') = ?`);
    params.push(f.department);
  }
  pushDateRange(where, params, 'inv.invoice_date', f.from, f.to);
  pushSearch(where, params, f.q, ['inv.id', 'inv.invoice_number', 'po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 's.name', 'f.name', 'prj.name']);

  const sql = `
    WITH paid AS (
      SELECT invoice_id as invoiceId, COALESCE(SUM(amount_paid),0) as paidAmount
        FROM payments
       GROUP BY invoice_id
    )
    SELECT inv.id as invoiceId,
           inv.invoice_number as invoiceNo,
           inv.invoice_date as invoiceDate,
           inv.total_amount as invoiceAmount,
           inv.status as dbStatus,
           po.id as poId,
           po.po_number as poNumber,
           pr.id as prId,
           pr.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           po.supplier_id as supplierId,
           COALESCE(s.name, '') as supplierName,
           CASE WHEN COALESCE(p.paidAmount,0) >= COALESCE(inv.total_amount,0) AND COALESCE(inv.total_amount,0) > 0 THEN 1 ELSE 0 END as isPaid
      FROM invoices inv
      JOIN purchase_orders po ON po.id = inv.po_id
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
 LEFT JOIN paid p ON p.invoiceId = inv.id
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
 LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE ${where.join(' AND ')} AND isPaid = 0
     ORDER BY date(inv.invoice_date) DESC, inv.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => {
    const status = mapInvoiceStatus(String(r.dbStatus ?? 'pending'), false);
    return {
      invoiceId: String(r.invoiceId),
      invoiceNo: String(r.invoiceNo ?? r.invoiceId),
      invoiceDate: String(r.invoiceDate ?? '').slice(0, 10),
      poId: String(r.poId),
      poNumber: String(r.poNumber ?? r.poId),
      prId: String(r.prId),
      firmId: String(r.firmId),
      firmName: String(r.firmName ?? r.firmId),
      department: String(r.department ?? 'Operations'),
      projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
      projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
      supplierId: r.supplierId != null && String(r.supplierId).trim() ? String(r.supplierId) : null,
      supplierName: String(r.supplierName ?? ''),
      invoiceAmount: Number(r.invoiceAmount ?? 0),
      status,
      pendingReason: status === 'On Hold' ? 'Invoice is On Hold' : 'Awaiting invoice approval',
    };
  });
}

export type PaymentQueueRow = {
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
  paidAmount: number;
  remainingAmount: number;
  pendingReason: string;
};

export async function listQueuePayment(filters?: QueueFilters): Promise<PaymentQueueRow[]> {
  await initDb();
  const db = await getDb();
  const f = normalizeQueueFilters(filters);

  // Approve Invoice queue was removed; allow recorded invoices too (pending/verified/approved), but exclude On Hold.
  const where: string[] = [`inv.status IN ('pending','verified','approved')`, 'remainingAmount > 0', 'allLinked = 1'];
  const params: any[] = [];

  if (f.firmId) {
    where.push('pr.firm_id = ?');
    params.push(f.firmId);
  }
  if (f.projectId) {
    where.push('pr.project_id = ?');
    params.push(f.projectId);
  }
  if (f.supplierId) {
    where.push('po.supplier_id = ?');
    params.push(f.supplierId);
  }
  if (f.department) {
    where.push(`COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') = ?`);
    params.push(f.department);
  }
  pushDateRange(where, params, 'inv.invoice_date', f.from, f.to);
  pushSearch(where, params, f.q, ['inv.id', 'inv.invoice_number', 'po.id', 'po.po_number', 'pr.id', 'pr.pr_number', 's.name', 'f.name', 'prj.name']);

  const sql = `
    WITH paid AS (
      SELECT invoice_id as invoiceId, COALESCE(SUM(amount_paid),0) as paidAmount
        FROM payments
       GROUP BY invoice_id
    ),
    linked AS (
      SELECT invoice_item_id as invoiceItemId, COALESCE(SUM(linked_qty),0) as linkedQty
        FROM grn_invoice_item_links
       GROUP BY invoice_item_id
    ),
    link_check AS (
      SELECT ii.invoice_id as invoiceId,
             MIN(CASE WHEN COALESCE(l.linkedQty,0) >= COALESCE(ii.quantity,0) THEN 1 ELSE 0 END) as allLinked
        FROM invoice_items ii
   LEFT JOIN linked l ON l.invoiceItemId = ii.id
       GROUP BY ii.invoice_id
    )
    SELECT inv.id as invoiceId,
           inv.invoice_number as invoiceNo,
           inv.invoice_date as invoiceDate,
           inv.total_amount as invoiceAmount,
           COALESCE(p.paidAmount,0) as paidAmount,
           (COALESCE(inv.total_amount,0) - COALESCE(p.paidAmount,0)) as remainingAmount,
           lc.allLinked as allLinked,
           po.id as poId,
           po.po_number as poNumber,
           pr.id as prId,
           pr.firm_id as firmId,
           COALESCE(NULLIF(TRIM(f.sort_name), ''), f.name) as firmName,
           COALESCE(NULLIF(TRIM(pr.remarks),''),'Operations') as department,
           pr.project_id as projectId,
           prj.name as projectName,
           po.supplier_id as supplierId,
           COALESCE(s.name, '') as supplierName
      FROM invoices inv
      JOIN purchase_orders po ON po.id = inv.po_id
      JOIN purchase_requisitions pr ON pr.id = po.pr_id
      JOIN link_check lc ON lc.invoiceId = inv.id
 LEFT JOIN paid p ON p.invoiceId = inv.id
 LEFT JOIN firms f ON f.id = pr.firm_id
 LEFT JOIN projects prj ON prj.id = pr.project_id
 LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY date(inv.invoice_date) DESC, inv.created_at DESC
  `;
  const rows = await db.all<any[]>(sql, ...params);
  return (rows ?? []).map((r) => ({
    invoiceId: String(r.invoiceId),
    invoiceNo: String(r.invoiceNo ?? r.invoiceId),
    invoiceDate: String(r.invoiceDate ?? '').slice(0, 10),
    poId: String(r.poId),
    poNumber: String(r.poNumber ?? r.poId),
    prId: String(r.prId),
    firmId: String(r.firmId),
    firmName: String(r.firmName ?? r.firmId),
    department: String(r.department ?? 'Operations'),
    projectId: r.projectId != null && String(r.projectId).trim() ? String(r.projectId) : null,
    projectName: r.projectName != null && String(r.projectName).trim() ? String(r.projectName) : null,
    supplierId: r.supplierId != null && String(r.supplierId).trim() ? String(r.supplierId) : null,
    supplierName: String(r.supplierName ?? ''),
    invoiceAmount: Number(r.invoiceAmount ?? 0),
    paidAmount: Number(r.paidAmount ?? 0),
    remainingAmount: Math.max(0, Number(r.remainingAmount ?? 0)),
    pendingReason: 'Approved invoice pending payment',
  }));
}

export async function upsertOpeningBalance(input: { storeId: string; itemId: string; quantity: number; reorderLevel?: number; year: string }) {
  await initDb();
  const db = await getDb();
  const id = `IOB-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO item_opening_balances (id, store_id, item_id, quantity, reorder_level, year, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(store_id, item_id, year) DO UPDATE SET
       quantity = excluded.quantity,
       reorder_level = excluded.reorder_level,
       updated_at = excluded.updated_at`,
    id,
    input.storeId,
    input.itemId,
    input.quantity,
    Number(input.reorderLevel ?? 0),
    input.year,
    now,
    now
  );
  return { ok: true };
}

export async function listOpeningBalances(storeId: string, year: string) {
  await initDb();
  const db = await getDb();
  return db.all<any[]>(
    'SELECT item_id as itemId, quantity, reorder_level as reorderLevel FROM item_opening_balances WHERE store_id = ? AND year = ?',
    storeId,
    year
  );
}

export async function getFirmInventorySheet(firmId: string, year: string) {
  await initDb();
  const db = await getDb();

  const items = await db.all<any[]>(`
    SELECT 
      i.id as itemId, 
      i.item_code as itemCode,
      inames.name as itemName,
      i.specifications_json as specificationsJson,
      i.unit
    FROM items i
    JOIN item_names inames ON inames.id = i.item_name_id
    WHERE i.is_active = 1
  `);

  const openingSql = `
    SELECT iob.item_id as itemId, iob.store_id as storeId, SUM(iob.quantity) as openingQty, MAX(iob.reorder_level) as reorderLevel
    FROM item_opening_balances iob
    JOIN stores s ON s.id = iob.store_id
    WHERE s.firm_id = ? AND iob.year = ?
    GROUP BY iob.item_id, iob.store_id
  `;
  const openingRows = await db.all<any[]>(openingSql, firmId, year);
  const openingMap = new Map<string, number>();
  const reorderMap = new Map<string, number>();
  for (const row of openingRows) {
    const key = `${String(row.itemId)}::${String(row.storeId)}`;
    openingMap.set(key, Number(row.openingQty ?? 0));
    reorderMap.set(key, Number(row.reorderLevel ?? 0));
  }

  const ledgerSql = `
    SELECT 
      item_id as itemId,
      store_id as storeId,
      transaction_type as type, 
      SUM(quantity) as total
    FROM stock_ledger
    WHERE firm_id = ?
    GROUP BY item_id, store_id, transaction_type
  `;
  const ledgerRows = await db.all<any[]>(ledgerSql, firmId);
  const ledgerMap = new Map<string, Record<string, number>>();
  for (const r of ledgerRows) {
    const key = `${String(r.itemId)}::${String(r.storeId)}`;
    if (!ledgerMap.has(key)) ledgerMap.set(key, {});
    ledgerMap.get(key)![r.type] = Number(r.total ?? 0);
  }

  const storeRows = await db.all<any[]>('SELECT id as storeId, name as storeName FROM stores WHERE firm_id = ?', firmId);
  const storeNameById = new Map<string, string>(
    (storeRows ?? []).map((r) => [String(r.storeId), String(r.storeName ?? '').trim()])
  );

  const output: any[] = [];
  for (const it of items) {
    const storeIdsForItem = new Set<string>();
    for (const key of openingMap.keys()) {
      const [itemId, storeId] = key.split('::');
      if (itemId === String(it.itemId)) storeIdsForItem.add(String(storeId));
    }
    for (const key of ledgerMap.keys()) {
      const [itemId, storeId] = key.split('::');
      if (itemId === String(it.itemId)) storeIdsForItem.add(String(storeId));
    }

    if (storeIdsForItem.size === 0) {
      output.push({
        itemId: it.itemId,
        itemCode: it.itemCode,
        itemName: it.itemName,
        storeId: null,
        store: '',
        specifications: it.specificationsJson,
        unit: it.unit,
        opening: 0,
        reorderLevel: 0,
        purchase: 0,
        issue: 0,
        damage: 0,
        returns: 0,
        balance: 0,
      });
      continue;
    }

    for (const storeId of storeIdsForItem) {
      const key = `${String(it.itemId)}::${String(storeId)}`;
      const opening = openingMap.get(key) ?? 0;
      const reorderLevel = reorderMap.get(key) ?? 0;
      const stats = ledgerMap.get(key) ?? {};
      const purchase = stats['IN'] ?? 0;
      const issue = stats['OUT'] ?? 0;
      const damage = stats['DAMAGE'] ?? 0;
      const returns = stats['RETURN'] ?? 0;
      output.push({
        itemId: it.itemId,
        itemCode: it.itemCode,
        itemName: it.itemName,
        storeId,
        store: storeNameById.get(String(storeId)) ?? '',
        specifications: it.specificationsJson,
        unit: it.unit,
        opening,
        reorderLevel,
        purchase,
        issue,
        damage,
        returns,
        balance: opening + purchase + returns - issue - damage,
      });
    }
  }

  return output;
}
