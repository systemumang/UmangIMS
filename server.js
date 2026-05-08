import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Hostinger (and many Node hosts) inject PORT.
const port = Number(process.env.PORT || 3000);

const distDir = path.join(__dirname, 'dist');
const uploadsDir = path.join(__dirname, 'uploads');

// Uploads and large payloads (PDF base64) can exceed 2mb.
app.use(express.json({ limit: '25mb' }));

app.use('/uploads', express.static(uploadsDir, { index: false }));

let mysqlPool = null;
function getMysqlPool() {
  if (mysqlPool) return mysqlPool;
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = Number(process.env.DB_PORT || 3306);
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  if (!database || !user || !password) return null;

  mysqlPool = mysql.createPool({
    host,
    port,
    database,
    user,
    password,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
  });
  return mysqlPool;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/uploads', async (req, res) => {
  try {
    const fileName = String(req.body?.fileName ?? '').trim() || 'file';
    const contentType = req.body?.contentType != null ? String(req.body.contentType).trim() : '';
    const base64 = String(req.body?.base64 ?? '').trim();
    if (!base64) return res.status(400).json({ error: 'base64 is required' });

    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) return res.status(400).json({ error: 'Invalid base64 content' });

    const ext = (() => {
      const parsed = path.parse(fileName);
      const raw = String(parsed.ext ?? '').toLowerCase();
      if (raw && raw.length <= 10) return raw.replace(/[^.\w]/g, '');
      if (contentType && contentType.includes('pdf')) return '.pdf';
      if (contentType && contentType.includes('png')) return '.png';
      if (contentType && contentType.includes('jpeg')) return '.jpg';
      return '';
    })();

    const safeBase = String(path.parse(fileName).name || 'file')
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 60);
    const storedName = `${safeBase}_${crypto.randomUUID()}${ext}`;

    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, storedName), buf);

    res.json({ url: `/uploads/${encodeURIComponent(storedName)}`, fileName });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toIsoDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function mapPrStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return 'Approved';
  if (s === 'rejected') return 'Rejected';
  return 'Pending Approval';
}

function normalizeGstType(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower.includes('intra')) return 'Intra-State';
  if (lower.includes('inter')) return 'Inter-State';
  return v;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseDepartmentFromRemarks(remarks) {
  try {
    const obj = typeof remarks === 'string' ? JSON.parse(remarks) : null;
    if (obj && typeof obj === 'object' && typeof obj.department === 'string') return obj.department;
  } catch {}
  return '';
}

function mergeRemarksJson(remarks, patch) {
  try {
    const base = typeof remarks === 'string' && remarks.trim() ? JSON.parse(remarks) : {};
    if (!base || typeof base !== 'object') return JSON.stringify(patch ?? {});
    return JSON.stringify({ ...(base || {}), ...(patch || {}) });
  } catch {
    return JSON.stringify(patch ?? {});
  }
}

async function fetchPrDetail(pool, id) {
  const [[prRow]] = await pool.query(
    `
    SELECT
      pr.id,
      pr.pr_number AS prNumber,
      pr.firm_id AS firmId,
      pr.store_id AS storeId,
      st.name AS store,
      pr.project_id AS projectId,
      proj.name AS projectName,
      pr.requested_by AS requestedBy,
      pr.created_at AS requisitionDate,
      pr.request_type AS requestType,
      pr.status AS status,
      pr.remarks AS remarks,
      MIN(pri.required_date) AS requiredDate
    FROM purchase_requisitions pr
    LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
    LEFT JOIN stores st ON st.id = pr.store_id
    LEFT JOIN projects proj ON proj.id = pr.project_id
    WHERE pr.id = ?
    GROUP BY pr.id
    `,
    [id]
  );
  if (!prRow) return null;

  const [itemRows] = await pool.query(
    `
    SELECT
      pri.id,
      pri.pr_id AS prId,
      pri.item_id AS itemId,
      iname.name AS item,
      pri.requested_qty AS quantity,
      pri.remarks AS specification
    FROM purchase_requisition_items pri
    LEFT JOIN items it ON it.id = pri.item_id
    LEFT JOIN item_names iname ON iname.id = it.item_name_id
    WHERE pri.pr_id = ?
    ORDER BY pri.created_at ASC
    `,
    [id]
  );

  const pr = {
    id: String(prRow.id),
    prNumber: prRow.prNumber ? String(prRow.prNumber) : undefined,
    firmId: String(prRow.firmId),
    store: prRow.store ? String(prRow.store) : null,
    projectId: prRow.projectId ? String(prRow.projectId) : null,
    projectName: prRow.projectName ? String(prRow.projectName) : null,
    department: parseDepartmentFromRemarks(prRow.remarks) || 'N/A',
    requestedBy: String(prRow.requestedBy || ''),
    requiredDate: toIsoDate(prRow.requiredDate) || toIsoDate(prRow.requisitionDate) || toIsoDate(new Date()) || '',
    requisitionDate: toIsoDateTime(prRow.requisitionDate) || new Date().toISOString(),
    requestType: prRow.requestType ? String(prRow.requestType) : 'Stock',
    status: mapPrStatus(prRow.status),
  };

  const items = (itemRows || []).map((r) => ({
    id: String(r.id),
    prId: String(r.prId),
    itemId: String(r.itemId),
    item: String(r.item || ''),
    quantity: Number(r.quantity ?? 0),
    specification: String(r.specification ?? ''),
  }));

  return { pr, items };
}

function fiscalYearLabel(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-12
  // India FY: Apr 1 -> Mar 31
  const fyStartYear = m >= 4 ? y : y - 1;
  const a = String(fyStartYear % 100).padStart(2, '0');
  const b = String((fyStartYear + 1) % 100).padStart(2, '0');
  return `${a}-${b}`;
}

async function ensureDocSequencesTable(pool) {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS doc_sequences (
      kind VARCHAR(10) NOT NULL,
      fy VARCHAR(10) NOT NULL,
      next_no INT NOT NULL,
      PRIMARY KEY (kind, fy)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `
  );
}

async function allocateDocNumber(pool, kind, date = new Date()) {
  const docKind = String(kind || '').trim().toUpperCase();
  if (!docKind) throw new Error('Missing doc kind');
  const fy = fiscalYearLabel(date);
  await ensureDocSequencesTable(pool);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT IGNORE INTO doc_sequences (kind, fy, next_no) VALUES (?, ?, ?)', [docKind, fy, 1]);
    const [rows] = await conn.query('SELECT next_no AS nextNo FROM doc_sequences WHERE kind=? AND fy=? FOR UPDATE', [
      docKind,
      fy,
    ]);
    const row = Array.isArray(rows) ? rows[0] : null;
    const nextNo = Number(row?.nextNo ?? 1);
    const useNo = Number.isFinite(nextNo) && nextNo > 0 ? nextNo : 1;
    await conn.query('UPDATE doc_sequences SET next_no=? WHERE kind=? AND fy=?', [useNo + 1, docKind, fy]);
    await conn.commit();
    return `${docKind}-${fy}/${String(useNo).padStart(5, '0')}`;
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

function mapInvoiceStatus(row) {
  const paymentStatus = String(row?.paymentStatus ?? '').toLowerCase();
  if (row?.paymentDate || paymentStatus.includes('paid')) return 'Paid';
  const s = String(row?.status ?? '').toLowerCase();
  if (s === 'hold') return 'On Hold';
  if (s === 'approved') return 'Approved';
  // pending/verified/etc
  return 'Recorded';
}

app.get('/api/db/ping', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) {
      return res.status(500).json({
        ok: false,
        error: 'Missing DB env vars. Set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD in Hostinger.',
      });
    }
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Minimal API used by the frontend ---
app.get('/api/firms', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      'SELECT id, name, address, terms_conditions AS termsConditions FROM firms ORDER BY name'
    );
    res.json({ firms: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Firms ---
app.get('/api/masters/firms', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      `
      SELECT
        id,
        name,
        sort_name AS sortName,
        cin,
        gst_number AS gstNumber,
        address,
        phone,
        logo_url AS logoUrl,
        terms_conditions AS termsConditions
      FROM firms
      ORDER BY name
      `
    );
    res.json({ firms: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/firms', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const sortName = req.body?.sortName != null ? String(req.body.sortName).trim() : null;
    const cin = req.body?.cin != null ? String(req.body.cin).trim() : null;
    const gstNumber = req.body?.gstNumber != null ? String(req.body.gstNumber).trim() : null;
    const address = req.body?.address != null ? String(req.body.address).trim() : null;
    const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
    const logoUrl = req.body?.logoUrl != null ? String(req.body.logoUrl).trim() : null;
    const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions).trim() : null;
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;

    await pool.query(
      `
      INSERT INTO firms (id, name, sort_name, cin, gst_number, address, phone, logo_url, terms_conditions, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [id, name, sortName, cin, gstNumber, address, phone, logoUrl, termsConditions, createdBy]
    );

    res.status(201).json({
      firm: { id, name, sortName, cin, gstNumber, address, phone, logoUrl, termsConditions },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/masters/firms/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });

    const sortName = req.body?.sortName != null ? String(req.body.sortName).trim() : null;
    const cin = req.body?.cin != null ? String(req.body.cin).trim() : null;
    const gstNumber = req.body?.gstNumber != null ? String(req.body.gstNumber).trim() : null;
    const address = req.body?.address != null ? String(req.body.address).trim() : null;
    const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
    const logoUrl = req.body?.logoUrl != null ? String(req.body.logoUrl).trim() : null;
    const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions).trim() : null;
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;

    await pool.query(
      `
      UPDATE firms
      SET name=?, sort_name=?, cin=?, gst_number=?, address=?, phone=?, logo_url=?, terms_conditions=?, updated_by=?, updated_at=NOW()
      WHERE id=?
      `,
      [name, sortName, cin, gstNumber, address, phone, logoUrl, termsConditions, updatedBy, id]
    );

    const [rows] = await pool.query(
      `
      SELECT id, name, sort_name AS sortName, cin, gst_number AS gstNumber, address, phone, logo_url AS logoUrl, terms_conditions AS termsConditions
      FROM firms WHERE id=?
      `,
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'Firm not found' });
    res.json({ firm: row });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/firms/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM firms WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/requests', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const [rows] = await pool.query(
      `
      SELECT
        pr.id,
        pr.pr_number AS prNumber,
        pr.firm_id AS firmId,
        pr.store_id AS storeId,
        st.name AS store,
        pr.project_id AS projectId,
        proj.name AS projectName,
        pr.requested_by AS requestedBy,
        pr.created_at AS requisitionDate,
        pr.request_type AS requestType,
        pr.status AS status,
        pr.remarks AS remarks,
        MIN(pri.required_date) AS requiredDate
      FROM purchase_requisitions pr
      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
      LEFT JOIN stores st ON st.id = pr.store_id
      LEFT JOIN projects proj ON proj.id = pr.project_id
      GROUP BY pr.id
      ORDER BY pr.created_at DESC
      `
    );

    const requests = (rows || []).map((r) => ({
      id: String(r.id),
      prNumber: r.prNumber ? String(r.prNumber) : undefined,
      firmId: String(r.firmId),
      store: r.store ? String(r.store) : null,
      projectId: r.projectId ? String(r.projectId) : null,
      projectName: r.projectName ? String(r.projectName) : null,
      department: parseDepartmentFromRemarks(r.remarks) || 'N/A',
      requestedBy: String(r.requestedBy || ''),
      requiredDate: toIsoDate(r.requiredDate) || toIsoDate(r.requisitionDate) || toIsoDate(new Date()) || '',
      requisitionDate: toIsoDateTime(r.requisitionDate) || new Date().toISOString(),
      requestType: r.requestType ? String(r.requestType) : 'Stock',
      status: mapPrStatus(r.status),
    }));

    res.json({ requests });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/requests/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });

    const [[prRow]] = await pool.query(
      `
      SELECT
        pr.id,
        pr.pr_number AS prNumber,
        pr.firm_id AS firmId,
        pr.store_id AS storeId,
        st.name AS store,
        pr.project_id AS projectId,
        proj.name AS projectName,
        pr.requested_by AS requestedBy,
        pr.created_at AS requisitionDate,
        pr.request_type AS requestType,
        pr.status AS status,
        pr.remarks AS remarks,
        MIN(pri.required_date) AS requiredDate
      FROM purchase_requisitions pr
      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
      LEFT JOIN stores st ON st.id = pr.store_id
      LEFT JOIN projects proj ON proj.id = pr.project_id
      WHERE pr.id = ?
      GROUP BY pr.id
      `,
      [id]
    );
    if (!prRow) return res.status(404).json({ error: 'PR not found' });

    const [itemRows] = await pool.query(
      `
      SELECT
        pri.id,
        pri.pr_id AS prId,
        pri.item_id AS itemId,
        iname.name AS item,
        pri.requested_qty AS quantity,
        pri.remarks AS specification
      FROM purchase_requisition_items pri
      LEFT JOIN items it ON it.id = pri.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      WHERE pri.pr_id = ?
      ORDER BY pri.created_at ASC
      `,
      [id]
    );

    const pr = {
      id: String(prRow.id),
      prNumber: prRow.prNumber ? String(prRow.prNumber) : undefined,
      firmId: String(prRow.firmId),
      store: prRow.store ? String(prRow.store) : null,
      projectId: prRow.projectId ? String(prRow.projectId) : null,
      projectName: prRow.projectName ? String(prRow.projectName) : null,
      department: parseDepartmentFromRemarks(prRow.remarks) || 'N/A',
      requestedBy: String(prRow.requestedBy || ''),
      requiredDate: toIsoDate(prRow.requiredDate) || toIsoDate(prRow.requisitionDate) || toIsoDate(new Date()) || '',
      requisitionDate: toIsoDateTime(prRow.requisitionDate) || new Date().toISOString(),
      requestType: prRow.requestType ? String(prRow.requestType) : 'Stock',
      status: mapPrStatus(prRow.status),
    };

    const items = (itemRows || []).map((r) => ({
      id: String(r.id),
      prId: String(r.prId),
      itemId: String(r.itemId),
      item: String(r.item || ''),
      quantity: Number(r.quantity ?? 0),
      specification: String(r.specification ?? ''),
    }));

    res.json({ request: { pr, items } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Workflow summary for invoice/grn/qc/payment screens
app.get('/api/workflow/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });
    const poId = req.query?.poId != null ? String(req.query.poId).trim() : '';

    // Reuse PR detail query (include prNumber).
    const [[prRow]] = await pool.query(
      `
      SELECT
        pr.id,
        pr.pr_number AS prNumber,
        pr.firm_id AS firmId,
        pr.store_id AS storeId,
        st.name AS store,
        pr.project_id AS projectId,
        proj.name AS projectName,
        pr.requested_by AS requestedBy,
        pr.created_at AS requisitionDate,
        pr.request_type AS requestType,
        pr.status AS status,
        pr.remarks AS remarks,
        MIN(pri.required_date) AS requiredDate
      FROM purchase_requisitions pr
      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
      LEFT JOIN stores st ON st.id = pr.store_id
      LEFT JOIN projects proj ON proj.id = pr.project_id
      WHERE pr.id = ?
      GROUP BY pr.id
      `,
      [prId]
    );
    if (!prRow) return res.status(404).json({ error: 'PR not found' });

    const [itemRows] = await pool.query(
      `
      SELECT
        pri.id,
        pri.pr_id AS prId,
        pri.item_id AS itemId,
        iname.name AS item,
        pri.requested_qty AS quantity,
        pri.remarks AS specification
      FROM purchase_requisition_items pri
      LEFT JOIN items it ON it.id = pri.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      WHERE pri.pr_id = ?
      ORDER BY pri.created_at ASC
      `,
      [prId]
    );

    const pr = {
      id: String(prRow.id),
      prNumber: prRow.prNumber ? String(prRow.prNumber) : undefined,
      firmId: String(prRow.firmId),
      store: prRow.store ? String(prRow.store) : null,
      projectId: prRow.projectId ? String(prRow.projectId) : null,
      projectName: prRow.projectName ? String(prRow.projectName) : null,
      department: parseDepartmentFromRemarks(prRow.remarks) || 'N/A',
      requestedBy: String(prRow.requestedBy || ''),
      requiredDate: toIsoDate(prRow.requiredDate) || toIsoDate(prRow.requisitionDate) || toIsoDate(new Date()) || '',
      requisitionDate: toIsoDateTime(prRow.requisitionDate) || new Date().toISOString(),
      requestType: prRow.requestType ? String(prRow.requestType) : 'Stock',
      status: mapPrStatus(prRow.status),
    };

    const items = (itemRows || []).map((r) => ({
      id: String(r.id),
      prId: String(r.prId),
      itemId: String(r.itemId),
      item: String(r.item || ''),
      quantity: Number(r.quantity ?? 0),
      specification: String(r.specification ?? ''),
    }));

    const [firmRows] = await pool.query('SELECT id, name, address, terms_conditions AS termsConditions FROM firms WHERE id = ? LIMIT 1', [
      pr.firmId,
    ]);
    const firmRow = Array.isArray(firmRows) ? firmRows[0] : null;
    const firm = firmRow
      ? {
          id: String(firmRow.id),
          name: String(firmRow.name ?? ''),
          address: firmRow.address != null ? String(firmRow.address) : null,
          termsConditions: firmRow.termsConditions != null ? String(firmRow.termsConditions) : null,
        }
      : undefined;

    let po;
    if (poId) {
      const [[poRow]] = await pool.query(
        `
        SELECT
          po.id AS id,
          po.pr_id AS prId,
          po.firm_id AS firmId,
          po.po_number AS poNumber,
          po.order_date AS orderDate,
          po.payment_terms AS paymentTerms,
          po.shipping_address AS shippingAddress,
          po.terms_conditions AS termsConditions,
          po.status AS status,
          po.created_by AS createdBy,
          po.created_at AS createdAt,
          po.check_po AS checkPo,
          po.check_po_user_id AS checkPoUserId,
          po.check_date AS checkDate,
          po.sent_by AS sentBy,
          po.sent_date AS sentDate,
          po.sent_proof AS sentProof,
          po.supplier_id AS supplierId,
          s.name AS supplier
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.id = ?
        LIMIT 1
        `,
        [poId]
      );
      if (!poRow) return res.status(404).json({ error: 'PO not found' });
      if (String(poRow.prId ?? '') !== prId) return res.status(400).json({ error: 'PO does not belong to the given PR' });

      const [poItemRows] = await pool.query(
        `
        SELECT
          poi.po_id AS poId,
          poi.item_id AS itemId,
          iname.name AS item,
          it.specifications_json AS specificationsJson,
          poi.quantity AS quantity,
          poi.rate AS rate,
          poi.discount_percent AS discountPercent,
          poi.tax_percent AS taxPercent,
          poi.goods_amount AS goodsAmount,
          poi.tax_amount AS taxAmount,
          poi.total_amount AS totalAmount
        FROM purchase_order_items poi
        LEFT JOIN items it ON it.id = poi.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        WHERE poi.po_id = ?
        ORDER BY poi.created_at ASC
        `,
        [poId]
      );

      const poHeader = {
        id: String(poRow.id),
        prId: String(poRow.prId ?? ''),
        firmId: String(poRow.firmId ?? ''),
        orderDate: toIsoDate(poRow.orderDate) || '',
        createdBy: poRow.createdBy != null ? String(poRow.createdBy) : undefined,
        supplierId: poRow.supplierId != null ? String(poRow.supplierId) : undefined,
        supplier: String(poRow.supplier ?? ''),
        paymentTerms: String(poRow.paymentTerms ?? ''),
        shippingAddress: poRow.shippingAddress != null ? String(poRow.shippingAddress) : undefined,
        termsConditions: poRow.termsConditions != null ? String(poRow.termsConditions) : undefined,
        status:
          String(poRow.status ?? 'Open').toLowerCase() === 'closed'
            ? 'Closed'
            : String(poRow.status ?? '').toLowerCase() === 'partial'
              ? 'Partial'
              : 'Open',
        createdAt: toIsoDateTime(poRow.createdAt) || new Date().toISOString(),
        poNumber: poRow.poNumber != null ? String(poRow.poNumber) : undefined,
        checkPo: Boolean(poRow.checkPo),
        checkPoUserId: poRow.checkPoUserId != null ? String(poRow.checkPoUserId) : null,
        checkDate: toIsoDate(poRow.checkDate) || null,
        sentBy: poRow.sentBy != null ? String(poRow.sentBy) : null,
        sentDate: toIsoDate(poRow.sentDate) || null,
        sentProof: poRow.sentProof != null ? String(poRow.sentProof) : null,
      };

      const poItems = (Array.isArray(poItemRows) ? poItemRows : []).map((r) => ({
        poId: String(r.poId ?? ''),
        itemId: String(r.itemId ?? ''),
        item: String(r.item ?? ''),
        specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
        quantity: Number(r.quantity ?? 0),
        rate: Number(r.rate ?? 0),
        discountPercent: r.discountPercent != null ? Number(r.discountPercent) : undefined,
        taxPercent: r.taxPercent != null ? Number(r.taxPercent) : undefined,
        goodsAmount: r.goodsAmount != null ? Number(r.goodsAmount) : undefined,
        taxAmount: r.taxAmount != null ? Number(r.taxAmount) : undefined,
        totalAmount: r.totalAmount != null ? Number(r.totalAmount) : undefined,
      }));

      po = { po: poHeader, items: poItems };
    }

    res.json({
      workflow: {
        firm,
        pr: { pr, items },
        ...(po ? { po } : {}),
        flags: { invoiceRateMismatch: false, quantityMismatch: false },
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Queues (Pending Tasks) ---
function readQueueFilters(req) {
  const q = req.query?.q != null ? String(req.query.q).trim() : '';
  const firmId = req.query?.firmId != null ? String(req.query.firmId).trim() : '';
  const department = req.query?.department != null ? String(req.query.department).trim() : '';
  const projectId = req.query?.projectId != null ? String(req.query.projectId).trim() : '';
  const supplierId = req.query?.supplierId != null ? String(req.query.supplierId).trim() : '';
  const from = req.query?.from != null ? String(req.query.from).trim() : '';
  const to = req.query?.to != null ? String(req.query.to).trim() : '';
  return { q, firmId, department, projectId, supplierId, from, to };
}

app.get('/api/queues/approve-pr', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ['pr.status = ?'];
    const params = ['pending'];
    if (f.firmId) {
      where.push('pr.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('pr.project_id = ?');
      params.push(f.projectId);
    }
    if (f.from) {
      where.push('DATE(pr.created_at) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(pr.created_at) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(pr.id LIKE ? OR pr.pr_number LIKE ? OR pr.requested_by LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        pr.id AS prId,
        pr.pr_number AS prNumber,
        pr.firm_id AS firmId,
        f.name AS firmName,
        pr.request_type AS requestType,
        pr.project_id AS projectId,
        proj.name AS projectName,
        pr.requested_by AS requestedBy,
        pr.created_at AS requisitionDate,
        pr.remarks AS remarks,
        MIN(pri.required_date) AS requiredDate
      FROM purchase_requisitions pr
      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
      LEFT JOIN firms f ON f.id = pr.firm_id
      LEFT JOIN projects proj ON proj.id = pr.project_id
      WHERE ${where.join(' AND ')}
      GROUP BY pr.id
      ORDER BY pr.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => ({
      prId: String(r.prId ?? ''),
      prNumber: String(r.prNumber ?? r.prId ?? ''),
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? ''),
      requestType: r.requestType ? String(r.requestType) : 'Stock',
      department: parseDepartmentFromRemarks(r.remarks) || 'N/A',
      projectId: r.projectId ? String(r.projectId) : null,
      projectName: r.projectName ? String(r.projectName) : null,
      requestedBy: String(r.requestedBy ?? ''),
      requisitionDate: toIsoDateTime(r.requisitionDate) || new Date().toISOString(),
      requiredDate: toIsoDate(r.requiredDate) || toIsoDate(r.requisitionDate) || toIsoDate(new Date()) || '',
      status: 'Pending Approval',
      pendingReason: 'Pending approval',
    }));

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);

    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// The rest of the queues are wired so the UI doesn’t error; return empty until implemented fully.
app.get('/api/queues/create-po', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = [`pr.status = 'approved'`];
    const params = [];
    if (f.firmId) {
      where.push('pr.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('pr.project_id = ?');
      params.push(f.projectId);
    }
    if (f.from) {
      where.push('DATE(pr.created_at) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(pr.created_at) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(pr.id LIKE ? OR pr.pr_number LIKE ? OR pr.requested_by LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        pr.id AS prId,
        pr.pr_number AS prNumber,
        pr.firm_id AS firmId,
        f.name AS firmName,
        pr.project_id AS projectId,
        proj.name AS projectName,
        pr.created_at AS requisitionDate,
        pr.remarks AS remarks,
        COALESCE(SUM(COALESCE(pri.approved_qty, pri.requested_qty)), 0) AS approvedTotalQty,
        COUNT(DISTINCT po.id) AS poCount,
        COALESCE(SUM(poi.quantity), 0) AS poTotalQty
      FROM purchase_requisitions pr
      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
      LEFT JOIN firms f ON f.id = pr.firm_id
      LEFT JOIN projects proj ON proj.id = pr.project_id
      LEFT JOIN purchase_orders po ON po.pr_id = pr.id
      LEFT JOIN purchase_order_items poi ON poi.po_id = po.id AND poi.item_id = pri.item_id
      WHERE ${where.join(' AND ')}
      GROUP BY pr.id
      HAVING (approvedTotalQty - poTotalQty) > 1e-9
      ORDER BY pr.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => {
      const approvedTotalQty = Number(r.approvedTotalQty ?? 0);
      const poTotalQty = Number(r.poTotalQty ?? 0);
      const remainingQty = Math.max(0, approvedTotalQty - poTotalQty);
      return {
        prId: String(r.prId ?? ''),
        prNumber: String(r.prNumber ?? r.prId ?? ''),
        firmId: String(r.firmId ?? ''),
        firmName: String(r.firmName ?? ''),
        department: parseDepartmentFromRemarks(r.remarks) || 'N/A',
        projectId: r.projectId ? String(r.projectId) : null,
        projectName: r.projectName ? String(r.projectName) : null,
        requisitionDate: toIsoDateTime(r.requisitionDate) || new Date().toISOString(),
        remainingQty,
        poCount: Number(r.poCount ?? 0),
        pendingReason: remainingQty > 0 ? 'Pending PO' : 'No pending qty',
      };
    });

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);

    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
app.get('/api/queues/check-po', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ["po.check_po = 0"];
    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(po.created_at) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(po.created_at) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(po.po_number LIKE ? OR po.id LIKE ? OR pr.pr_number LIKE ? OR pr.id LIKE ? OR s.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        po.id AS poId,
        po.po_number AS poNumber,
        po.pr_id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        pr.remarks AS prRemarks,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        po.order_date AS orderDate,
        po.created_at AS createdAt
      FROM purchase_orders po
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      ORDER BY po.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => ({
      poId: String(r.poId ?? ''),
      poNumber: String(r.poNumber ?? r.poId ?? ''),
      prId: String(r.prId ?? ''),
      prNumber: String(r.prNumber ?? r.prId ?? ''),
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? ''),
      department: parseDepartmentFromRemarks(r.prRemarks) || 'N/A',
      projectId: r.projectId ? String(r.projectId) : null,
      projectName: r.projectName ? String(r.projectName) : null,
      supplierId: r.supplierId ? String(r.supplierId) : null,
      supplierName: String(r.supplierName ?? ''),
      orderDate: toIsoDate(r.orderDate) || null,
      createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
      pendingReason: 'Pending check',
    }));

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/queues/send-po', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ["po.check_po = 1", "(po.sent_date IS NULL OR po.sent_date = '' OR po.sent_by IS NULL OR po.sent_by = '')"];
    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(po.created_at) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(po.created_at) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(po.po_number LIKE ? OR po.id LIKE ? OR pr.pr_number LIKE ? OR pr.id LIKE ? OR s.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        po.id AS poId,
        po.po_number AS poNumber,
        po.pr_id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        pr.remarks AS prRemarks,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        po.order_date AS orderDate,
        po.created_at AS createdAt
      FROM purchase_orders po
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      ORDER BY po.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => ({
      poId: String(r.poId ?? ''),
      poNumber: String(r.poNumber ?? r.poId ?? ''),
      prId: String(r.prId ?? ''),
      prNumber: String(r.prNumber ?? r.prId ?? ''),
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? ''),
      department: parseDepartmentFromRemarks(r.prRemarks) || 'N/A',
      projectId: r.projectId ? String(r.projectId) : null,
      projectName: r.projectName ? String(r.projectName) : null,
      supplierId: r.supplierId ? String(r.supplierId) : null,
      supplierName: String(r.supplierName ?? ''),
      orderDate: toIsoDate(r.orderDate) || null,
      createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
      pendingReason: 'Pending send',
    }));

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/queues/enter-invoice', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ["po.check_po = 1"];
    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(po.created_at) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(po.created_at) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(po.po_number LIKE ? OR po.id LIKE ? OR pr.pr_number LIKE ? OR pr.id LIKE ? OR s.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        po.id AS poId,
        po.po_number AS poNumber,
        po.pr_id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        pr.remarks AS prRemarks,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        COALESCE(SUM(poi.quantity), 0) AS poQty,
        COALESCE(SUM(ii.quantity), 0) AS invQty
      FROM purchase_orders po
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
      LEFT JOIN invoices inv ON inv.po_id = po.id
      LEFT JOIN invoice_items ii ON ii.invoice_id = inv.id AND ii.item_id = poi.item_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      GROUP BY po.id
      HAVING (poQty - invQty) > 1e-9
      ORDER BY po.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => {
      const pendingQty = Math.max(0, Number(r.poQty ?? 0) - Number(r.invQty ?? 0));
      return {
        poId: String(r.poId ?? ''),
        poNumber: String(r.poNumber ?? r.poId ?? ''),
        prId: String(r.prId ?? ''),
        prNumber: String(r.prNumber ?? r.prId ?? ''),
        firmId: String(r.firmId ?? ''),
        firmName: String(r.firmName ?? ''),
        department: parseDepartmentFromRemarks(r.prRemarks) || 'N/A',
        projectId: r.projectId ? String(r.projectId) : null,
        projectName: r.projectName ? String(r.projectName) : null,
        supplierId: r.supplierId ? String(r.supplierId) : null,
        supplierName: String(r.supplierName ?? ''),
        pendingQty,
        pendingReason: 'Pending invoice',
      };
    });

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/queues/create-grn', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ["po.check_po = 1"];
    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(po.created_at) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(po.created_at) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(po.po_number LIKE ? OR po.id LIKE ? OR pr.pr_number LIKE ? OR pr.id LIKE ? OR s.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        po.id AS poId,
        po.po_number AS poNumber,
        po.pr_id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        pr.remarks AS prRemarks,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        po.created_at AS createdAt,
        COALESCE(SUM(poi.quantity), 0) AS poQty,
        COALESCE(SUM(gi.received_qty), 0) AS grnQty
      FROM purchase_orders po
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
      LEFT JOIN grns g ON g.po_id = po.id
      LEFT JOIN grn_items gi ON gi.grn_id = g.id AND gi.item_id = poi.item_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      GROUP BY po.id
      HAVING (poQty - grnQty) > 1e-9
      ORDER BY po.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => {
      const pendingQty = Math.max(0, Number(r.poQty ?? 0) - Number(r.grnQty ?? 0));
      return {
        poId: String(r.poId ?? ''),
        poNumber: String(r.poNumber ?? r.poId ?? ''),
        prId: String(r.prId ?? ''),
        prNumber: String(r.prNumber ?? r.prId ?? ''),
        firmId: String(r.firmId ?? ''),
        firmName: String(r.firmName ?? ''),
        department: parseDepartmentFromRemarks(r.prRemarks) || 'N/A',
        projectId: r.projectId ? String(r.projectId) : null,
        projectName: r.projectName ? String(r.projectName) : null,
        supplierId: r.supplierId ? String(r.supplierId) : null,
        supplierName: String(r.supplierName ?? ''),
        pendingQty,
        createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
        pendingReason: 'Pending GRN',
      };
    });

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/queues/check-quality', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ['1=1'];
    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(g.received_date) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(g.received_date) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(g.grn_number LIKE ? OR g.id LIKE ? OR po.po_number LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        g.id AS grnId,
        g.grn_number AS grnNumber,
        g.received_date AS receivedDate,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        pr.remarks AS prRemarks,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        SUM(CASE WHEN qc.id IS NULL THEN 1 ELSE 0 END) AS pendingItems
      FROM grns g
      INNER JOIN purchase_orders po ON po.id = g.po_id
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN grn_items gi ON gi.grn_id = g.id
      LEFT JOIN qc_records qc ON qc.grn_id = g.id AND qc.item_id = gi.item_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      GROUP BY g.id
      HAVING pendingItems > 0
      ORDER BY g.received_date DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => ({
      grnId: String(r.grnId ?? ''),
      grnNumber: String(r.grnNumber ?? r.grnId ?? ''),
      poId: String(r.poId ?? ''),
      poNumber: String(r.poNumber ?? r.poId ?? ''),
      prId: String(r.prId ?? ''),
      prNumber: String(r.prNumber ?? r.prId ?? ''),
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? ''),
      department: parseDepartmentFromRemarks(r.prRemarks) || 'N/A',
      projectId: r.projectId ? String(r.projectId) : null,
      projectName: r.projectName ? String(r.projectName) : null,
      supplierId: r.supplierId ? String(r.supplierId) : null,
      supplierName: String(r.supplierName ?? ''),
      receivedDate: toIsoDate(r.receivedDate) || '',
      pendingItems: Number(r.pendingItems ?? 0),
      pendingReason: 'Pending QC',
    }));

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GRNs pending invoice linking (after QC accepted qty > linked qty).
app.get('/api/queues/link-invoice-grn', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ['1=1'];
    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(g.received_date) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(g.received_date) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(g.grn_number LIKE ? OR g.id LIKE ? OR po.po_number LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        g.id AS grnId,
        g.grn_number AS grnNumber,
        g.received_date AS receivedDate,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        pr.remarks AS prRemarks,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        SUM(
          CASE
            WHEN GREATEST(0, COALESCE(qc.accepted_qty, 0) - COALESCE(linkq.linkedQty, 0)) > 1e-9 THEN 1
            ELSE 0
          END
        ) AS pendingItems
      FROM grns g
      INNER JOIN purchase_orders po ON po.id = g.po_id
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      INNER JOIN grn_items gi ON gi.grn_id = g.id
      LEFT JOIN qc_records qc ON qc.grn_id = g.id AND qc.item_id = gi.item_id
      LEFT JOIN (
        SELECT grn_item_id AS grnItemId, SUM(linked_qty) AS linkedQty
        FROM grn_invoice_item_links
        GROUP BY grn_item_id
      ) linkq ON linkq.grnItemId = gi.id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      GROUP BY g.id
      HAVING pendingItems > 0
      ORDER BY g.received_date DESC, g.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => ({
      grnId: String(r.grnId ?? ''),
      grnNumber: r.grnNumber != null ? String(r.grnNumber) : '',
      poId: String(r.poId ?? ''),
      poNumber: r.poNumber != null ? String(r.poNumber) : '',
      prId: String(r.prId ?? ''),
      prNumber: r.prNumber != null ? String(r.prNumber) : '',
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? ''),
      department: parseDepartmentFromRemarks(r.prRemarks) || 'N/A',
      projectId: r.projectId ? String(r.projectId) : null,
      projectName: r.projectName ? String(r.projectName) : null,
      supplierId: r.supplierId ? String(r.supplierId) : null,
      supplierName: String(r.supplierName ?? ''),
      receivedDate: toIsoDate(r.receivedDate) || '',
      pendingItems: Number(r.pendingItems ?? 0),
      pendingReason: 'Pending linking',
    }));

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
app.get('/api/queues/approve-invoice', async (_req, res) => res.json({ rows: [] }));

// Invoices pending payment
app.get('/api/queues/payment', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ['1=1'];
    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(inv.invoice_date) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(inv.invoice_date) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(inv.invoice_number LIKE ? OR inv.id LIKE ? OR po.po_number LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        inv.id AS invoiceId,
        inv.invoice_number AS invoiceNo,
        inv.invoice_date AS invoiceDate,
        inv.total_amount AS invoiceAmount,
        inv.payment_status AS paymentStatus,
        inv.payment_date AS paymentDate,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        pr.remarks AS prRemarks,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName
      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const invoiceAmount = Number(r.invoiceAmount ?? 0);
        const paymentStatus = String(r.paymentStatus ?? '').toLowerCase();
        const isFull = paymentStatus.includes('full');
        const paidAmount = isFull ? invoiceAmount : 0;
        const remainingAmount = Math.max(0, invoiceAmount - paidAmount);
        return {
          invoiceId: String(r.invoiceId ?? ''),
          invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
          invoiceDate: toIsoDate(r.invoiceDate) || '',
          paymentStatus: r.paymentStatus != null ? String(r.paymentStatus) : undefined,
          paymentDate: toIsoDate(r.paymentDate) || undefined,
          poId: String(r.poId ?? ''),
          poNumber: String(r.poNumber ?? r.poId ?? ''),
          prId: String(r.prId ?? ''),
          prNumber: String(r.prNumber ?? r.prId ?? ''),
          firmId: String(r.firmId ?? ''),
          firmName: String(r.firmName ?? ''),
          department: parseDepartmentFromRemarks(r.prRemarks) || 'N/A',
          projectId: r.projectId ? String(r.projectId) : null,
          projectName: r.projectName ? String(r.projectName) : null,
          supplierId: r.supplierId ? String(r.supplierId) : null,
          supplierName: String(r.supplierName ?? ''),
          invoiceAmount,
          paidAmount,
          remainingAmount,
          pendingReason: remainingAmount > 1e-9 ? 'Pending payment' : 'Paid',
        };
      })
      .filter((x) => x.remainingAmount > 1e-9);

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GRN linking summary for an invoice (used by Payment modal)
app.get('/api/invoices/:id/grn-link-summary', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'id is required' });

    const [rows] = await pool.query(
      `
      SELECT
        ii.id AS invoiceItemId,
        ii.item_id AS itemId,
        iname.name AS item,
        it.specifications_json AS specificationsJson,
        ii.quantity AS invoiceQty,
        COALESCE(grnq.receivedQty, 0) AS receivedQty,
        COALESCE(linkq.linkedQty, 0) AS linkedQty
      FROM invoice_items ii
      INNER JOIN invoices inv ON inv.id = ii.invoice_id
      LEFT JOIN items it ON it.id = ii.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      LEFT JOIN (
        SELECT g.po_id AS poId, gi.item_id AS itemId, SUM(gi.received_qty) AS receivedQty
        FROM grns g
        INNER JOIN grn_items gi ON gi.grn_id = g.id
        GROUP BY g.po_id, gi.item_id
      ) grnq ON grnq.poId = inv.po_id AND grnq.itemId = ii.item_id
      LEFT JOIN (
        SELECT invoice_item_id AS invoiceItemId, SUM(linked_qty) AS linkedQty
        FROM grn_invoice_item_links
        GROUP BY invoice_item_id
      ) linkq ON linkq.invoiceItemId = ii.id
      WHERE ii.invoice_id = ?
      ORDER BY iname.name ASC
      `,
      [invoiceId]
    );

    const links = (Array.isArray(rows) ? rows : []).map((r) => ({
      invoiceItemId: String(r.invoiceItemId ?? ''),
      itemId: String(r.itemId ?? ''),
      item: String(r.item ?? ''),
      specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
      invoiceQty: Number(r.invoiceQty ?? 0),
      receivedQty: Number(r.receivedQty ?? 0),
      linkedQty: Number(r.linkedQty ?? 0),
    }));

    res.json({ links });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Pending invoice links for a GRN (used by Link Invoice ↔ GRN queue modal)
app.get('/api/grns/:id/pending-invoice-links', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const grnId = String(req.params.id ?? '').trim();
    if (!grnId) return res.status(400).json({ error: 'id is required' });

    const [[meta]] = await pool.query(
      `
      SELECT
        g.id AS grnId,
        g.grn_number AS grnNumber,
        g.received_date AS receivedDate,
        po.id AS poId,
        po.po_number AS poNumber
      FROM grns g
      INNER JOIN purchase_orders po ON po.id = g.po_id
      WHERE g.id = ?
      LIMIT 1
      `,
      [grnId]
    );
    if (!meta) return res.status(404).json({ error: 'GRN not found' });

    const [grnItemRows] = await pool.query(
      `
      SELECT
        gi.id AS grnItemId,
        gi.item_id AS itemId,
        iname.name AS item,
        it.specifications_json AS specificationsJson,
        gi.received_qty AS grnQty,
        COALESCE(qc.accepted_qty, 0) AS approvedQty,
        COALESCE(linkq.linkedQty, 0) AS alreadyLinkQty
      FROM grn_items gi
      LEFT JOIN qc_records qc ON qc.grn_id = gi.grn_id AND qc.item_id = gi.item_id
      LEFT JOIN (
        SELECT grn_item_id AS grnItemId, SUM(linked_qty) AS linkedQty
        FROM grn_invoice_item_links
        GROUP BY grn_item_id
      ) linkq ON linkq.grnItemId = gi.id
      LEFT JOIN items it ON it.id = gi.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      WHERE gi.grn_id = ?
      ORDER BY iname.name ASC
      `,
      [grnId]
    );

    const itemIds = Array.from(
      new Set((Array.isArray(grnItemRows) ? grnItemRows : []).map((r) => String(r.itemId ?? '')).filter(Boolean))
    );

    let invoiceItemRows = [];
    if (itemIds.length) {
      const placeholders = itemIds.map(() => '?').join(',');
      const [invRows] = await pool.query(
        `
        SELECT
          ii.id AS invoiceItemId,
          ii.invoice_id AS invoiceId,
          ii.item_id AS itemId,
          ii.quantity AS invoiceQty,
          inv.invoice_number AS invoiceNo,
          inv.invoice_date AS invoiceDate,
          COALESCE(linked.linkedQty, 0) AS alreadyLinkedQty
        FROM invoice_items ii
        INNER JOIN invoices inv ON inv.id = ii.invoice_id
        LEFT JOIN (
          SELECT invoice_item_id AS invoiceItemId, SUM(linked_qty) AS linkedQty
          FROM grn_invoice_item_links
          GROUP BY invoice_item_id
        ) linked ON linked.invoiceItemId = ii.id
        WHERE inv.po_id = ? AND ii.item_id IN (${placeholders})
        ORDER BY inv.invoice_date DESC, inv.invoice_number DESC
        `,
        [String(meta.poId ?? ''), ...itemIds]
      );
      invoiceItemRows = Array.isArray(invRows) ? invRows : [];
    }

    const invCandidatesByItemId = new Map();
    for (const r of invoiceItemRows) {
      const itemId = String(r.itemId ?? '').trim();
      if (!itemId) continue;
      const list = invCandidatesByItemId.get(itemId) ?? [];
      const invoiceQty = Number(r.invoiceQty ?? 0);
      const alreadyLinkedQty = Number(r.alreadyLinkedQty ?? 0);
      const pendingLinkingQty = Math.max(0, invoiceQty - alreadyLinkedQty);
      list.push({
        invoiceItemId: String(r.invoiceItemId ?? ''),
        invoiceId: String(r.invoiceId ?? ''),
        invoiceNo: String(r.invoiceNo ?? ''),
        invoiceDate: toIsoDate(r.invoiceDate) || '',
        invoiceQty,
        alreadyLinkedQty,
        pendingLinkingQty,
      });
      invCandidatesByItemId.set(itemId, list);
    }

    const rows = (Array.isArray(grnItemRows) ? grnItemRows : [])
      .map((r) => {
        const approvedQty = Number(r.approvedQty ?? 0);
        const alreadyLinkQty = Number(r.alreadyLinkQty ?? 0);
        const pendingLinkingQty = Math.max(0, approvedQty - alreadyLinkQty);
        return {
          grnItemId: String(r.grnItemId ?? ''),
          grnId: String(meta.grnId ?? ''),
          grnNumber: meta.grnNumber != null ? String(meta.grnNumber) : '',
          receivedDate: toIsoDate(meta.receivedDate) || '',
          poId: String(meta.poId ?? ''),
          poNumber: meta.poNumber != null ? String(meta.poNumber) : '',
          itemId: String(r.itemId ?? ''),
          item: String(r.item ?? ''),
          specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
          grnQty: Number(r.grnQty ?? 0),
          approvedQty,
          alreadyLinkQty,
          pendingLinkingQty,
          candidates: invCandidatesByItemId.get(String(r.itemId ?? '')) ?? [],
        };
      })
      .filter((x) => x.pendingLinkingQty > 1e-9);

    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GRN item ↔ invoice linking (summary for a PR)
app.get('/api/requests/:id/grn-item-invoice-links', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });

    const [rows] = await pool.query(
      `
      SELECT
        gil.grn_item_id AS grnItemId,
        inv.id AS invoiceId,
        inv.invoice_number AS invoiceNo,
        SUM(gil.linked_qty) AS linkedQty
      FROM purchase_orders po
      INNER JOIN grns g ON g.po_id = po.id
      INNER JOIN grn_items gi ON gi.grn_id = g.id
      INNER JOIN grn_invoice_item_links gil ON gil.grn_item_id = gi.id
      INNER JOIN invoice_items ii ON ii.id = gil.invoice_item_id
      INNER JOIN invoices inv ON inv.id = ii.invoice_id
      WHERE po.pr_id = ?
      GROUP BY gil.grn_item_id, inv.id, inv.invoice_number
      ORDER BY inv.invoice_date DESC, inv.invoice_number DESC
      `,
      [prId]
    );

    const links = (Array.isArray(rows) ? rows : []).map((r) => ({
      grnItemId: String(r.grnItemId ?? ''),
      invoiceId: String(r.invoiceId ?? ''),
      invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
      linkedQty: Number(r.linkedQty ?? 0),
    }));

    res.json({ links });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Operations (minimal) ---
app.get('/api/operations/prs', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const q = req.query?.q != null ? String(req.query.q).trim() : '';
    const firmId = req.query?.firmId != null ? String(req.query.firmId).trim() : '';
    const projectId = req.query?.projectId != null ? String(req.query.projectId).trim() : '';
    const from = req.query?.from != null ? String(req.query.from).trim() : '';
    const to = req.query?.to != null ? String(req.query.to).trim() : '';

    const where = ['1=1'];
    const params = [];
    if (firmId) {
      where.push('pr.firm_id = ?');
      params.push(firmId);
    }
    if (projectId) {
      where.push('pr.project_id = ?');
      params.push(projectId);
    }
    if (from) {
      where.push('DATE(pr.created_at) >= ?');
      params.push(from);
    }
    if (to) {
      where.push('DATE(pr.created_at) <= ?');
      params.push(to);
    }
    if (q) {
      where.push('(pr.pr_number LIKE ? OR pr.id LIKE ? OR pr.requested_by LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        pr.id AS prId,
        pr.pr_number AS prNumber,
        pr.firm_id AS firmId,
        f.name AS firmName,
        pr.project_id AS projectId,
        proj.name AS projectName,
        pr.remarks AS remarks,
        pr.requested_by AS requestedBy,
        pr.created_at AS requisitionDate,
        pr.request_type AS requestType,
        pr.status AS status,
        MIN(pri.required_date) AS requiredDate,
        COUNT(pri.id) AS itemCount,
        COALESCE(SUM(pri.requested_qty), 0) AS totalQty
      FROM purchase_requisitions pr
      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
      LEFT JOIN firms f ON f.id = pr.firm_id
      LEFT JOIN projects proj ON proj.id = pr.project_id
      WHERE ${where.join(' AND ')}
      GROUP BY pr.id
      ORDER BY pr.created_at DESC
      `,
      params
    );

    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      prId: String(r.prId ?? ''),
      prNumber: String(r.prNumber ?? r.prId ?? ''),
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? ''),
      department: parseDepartmentFromRemarks(r.remarks) || 'N/A',
      projectId: r.projectId ? String(r.projectId) : null,
      projectName: r.projectName ? String(r.projectName) : null,
      requestedBy: String(r.requestedBy ?? ''),
      requisitionDate: toIsoDateTime(r.requisitionDate) || new Date().toISOString(),
      requiredDate: toIsoDate(r.requiredDate) || toIsoDate(r.requisitionDate) || '',
      requestType: r.requestType ? String(r.requestType) : 'Stock',
      status: mapPrStatus(r.status),
      itemCount: Number(r.itemCount ?? 0),
      totalQty: Number(r.totalQty ?? 0),
    }));

    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/operations/pos', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);
    const status = req.query?.status != null ? String(req.query.status).trim() : '';

    const where = ['1=1'];
    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(po.order_date) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(po.order_date) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(po.po_number LIKE ? OR po.id LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ? OR f.name LIKE ? OR proj.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        pr.remarks AS prRemarks,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        po.order_date AS orderDate,
        po.created_at AS createdAt,
        po.status AS status,
        COUNT(poi.id) AS itemCount,
        COALESCE(SUM(poi.total_amount), 0) AS totalAmount
      FROM purchase_orders po
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      GROUP BY po.id
      ORDER BY po.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => {
      const rawStatus = String(r.status ?? '').toLowerCase();
      const mappedStatus = rawStatus === 'closed' ? 'Closed' : rawStatus === 'partial' ? 'Partial' : 'Open';
      return {
        poId: String(r.poId ?? ''),
        poNumber: String(r.poNumber ?? r.poId ?? ''),
        prId: String(r.prId ?? ''),
        prNumber: String(r.prNumber ?? r.prId ?? ''),
        firmId: String(r.firmId ?? ''),
        firmName: String(r.firmName ?? ''),
        department: parseDepartmentFromRemarks(r.prRemarks) || 'N/A',
        projectId: r.projectId ? String(r.projectId) : null,
        projectName: r.projectName ? String(r.projectName) : null,
        supplierId: String(r.supplierId ?? ''),
        supplierName: String(r.supplierName ?? ''),
        orderDate: toIsoDate(r.orderDate) || null,
        createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
        status: mappedStatus,
        itemCount: Number(r.itemCount ?? 0),
        totalAmount: Number(r.totalAmount ?? 0),
      };
    });
    if (status) out = out.filter((x) => x.status === status);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/operations/grns', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ['1=1'];
    const params = [];
    if (f.firmId) {
      where.push('g.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(g.received_date) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(g.received_date) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(g.grn_number LIKE ? OR g.id LIKE ? OR po.po_number LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ? OR f.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        g.id AS grnId,
        g.grn_number AS grnNumber,
        g.received_date AS receivedDate,
        g.created_at AS createdAt,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        g.firm_id AS firmId,
        f.name AS firmName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        COUNT(gi.id) AS itemCount,
        COALESCE(SUM(gi.received_qty), 0) AS totalQty
      FROM grns g
      INNER JOIN purchase_orders po ON po.id = g.po_id
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN grn_items gi ON gi.grn_id = g.id
      LEFT JOIN firms f ON f.id = g.firm_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      GROUP BY g.id
      ORDER BY g.created_at DESC
      `,
      params
    );

    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      grnId: String(r.grnId ?? ''),
      grnNumber: String(r.grnNumber ?? r.grnId ?? ''),
      receivedDate: toIsoDate(r.receivedDate) || '',
      poId: String(r.poId ?? ''),
      poNumber: String(r.poNumber ?? r.poId ?? ''),
      prId: String(r.prId ?? ''),
      prNumber: String(r.prNumber ?? r.prId ?? ''),
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? ''),
      supplierId: String(r.supplierId ?? ''),
      supplierName: String(r.supplierName ?? ''),
      itemCount: Number(r.itemCount ?? 0),
      totalQty: Number(r.totalQty ?? 0),
      createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
    }));
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/operations/invoices', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);
    const status = req.query?.status != null ? String(req.query.status).trim() : '';

    const where = ['1=1'];
    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(inv.invoice_date) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(inv.invoice_date) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(inv.invoice_number LIKE ? OR inv.id LIKE ? OR po.po_number LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ? OR f.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        inv.id AS invoiceId,
        inv.invoice_number AS invoiceNo,
        inv.invoice_date AS invoiceDate,
        inv.total_amount AS invoiceAmount,
        inv.payment_status AS paymentStatus,
        inv.payment_date AS paymentDate,
        inv.status AS status,
        inv.created_at AS createdAt,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        po.supplier_id AS supplierId,
        s.name AS supplierName
      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      ORDER BY inv.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => ({
      invoiceId: String(r.invoiceId ?? ''),
      invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
      invoiceDate: toIsoDate(r.invoiceDate) || '',
      invoiceAmount: Number(r.invoiceAmount ?? 0),
      poId: String(r.poId ?? ''),
      poNumber: String(r.poNumber ?? r.poId ?? ''),
      prId: String(r.prId ?? ''),
      prNumber: String(r.prNumber ?? r.prId ?? ''),
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? ''),
      supplierId: String(r.supplierId ?? ''),
      supplierName: String(r.supplierName ?? ''),
      status: mapInvoiceStatus(r),
      paymentStatus: r.paymentStatus != null ? String(r.paymentStatus) : undefined,
      paymentDate: toIsoDate(r.paymentDate) || undefined,
      createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
    }));
    if (status) out = out.filter((x) => x.status === status);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/operations/payments', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);
    const status = req.query?.status != null ? String(req.query.status).trim() : '';

    const where = ['inv.payment_status IS NOT NULL', "TRIM(inv.payment_status) <> ''"];
    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
    if (f.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(f.supplierId);
    }
    if (f.from) {
      where.push('DATE(COALESCE(inv.payment_date, inv.updated_at, inv.invoice_date)) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(COALESCE(inv.payment_date, inv.updated_at, inv.invoice_date)) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(inv.invoice_number LIKE ? OR inv.id LIKE ? OR po.po_number LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ? OR f.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }
    if (status) {
      where.push('inv.payment_status = ?');
      params.push(status);
    }

    const [rows] = await pool.query(
      `
      SELECT
        inv.id AS invoiceId,
        inv.invoice_number AS invoiceNo,
        inv.invoice_date AS invoiceDate,
        inv.total_amount AS invoiceAmount,
        inv.payment_status AS paymentStatus,
        inv.payment_date AS paymentDate,
        inv.updated_at AS updatedAt,
        inv.created_at AS createdAt,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        po.supplier_id AS supplierId,
        s.name AS supplierName
      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      INNER JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(inv.payment_date, inv.updated_at, inv.invoice_date) DESC
      `,
      params
    );

    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      paymentId: String(r.invoiceId ?? ''),
      paymentDate: toIsoDate(r.paymentDate) || toIsoDate(r.updatedAt) || toIsoDate(r.invoiceDate) || '',
      amount: Number(r.invoiceAmount ?? 0),
      mode: undefined,
      referenceNo: undefined,
      status: r.paymentStatus != null ? String(r.paymentStatus) : null,
      invoiceId: String(r.invoiceId ?? ''),
      invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
      poId: String(r.poId ?? ''),
      poNumber: String(r.poNumber ?? r.poId ?? ''),
      prId: String(r.prId ?? ''),
      prNumber: String(r.prNumber ?? r.prId ?? ''),
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? ''),
      supplierId: String(r.supplierId ?? ''),
      supplierName: String(r.supplierName ?? ''),
      createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
    }));
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Invoices for a PR
app.get('/api/requests/:id/invoices', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });

    const [invRows] = await pool.query(
      `
      SELECT
        inv.id AS id,
        inv.po_id AS poId,
        inv.invoice_number AS supplierInvoiceNo,
        inv.invoice_date AS invoiceDate,
        inv.total_amount AS invoiceAmount,
        inv.courier_charge AS courierCharge,
        inv.packing_charge AS packingCharge,
        inv.labour_charge AS labourCharge,
        inv.other_charge AS otherCharge,
        inv.charges_gst_amount AS chargesGstAmount,
        inv.payment_status AS paymentStatus,
        inv.payment_date AS paymentDate,
        inv.status AS status,
        inv.document_url AS documentUrl,
        inv.cn_copy_url AS cnCopyUrl,
        inv.eway_bill_number AS ewayBillNumber,
        inv.cn_number AS cnNumber,
        inv.courier_number AS courierNumber,
        inv.transporter_name AS transporterName,
        inv.created_by AS createdBy,
        inv.created_at AS createdAt,
        inv.updated_by AS updatedBy,
        inv.updated_at AS updatedAt
      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      WHERE po.pr_id = ?
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `,
      [prId]
    );

    const invoiceIds = (Array.isArray(invRows) ? invRows : []).map((r) => String(r.id ?? '')).filter(Boolean);
    let itemsByInvoiceId = new Map();
    if (invoiceIds.length) {
      const placeholders = invoiceIds.map(() => '?').join(',');
      const [itemRows] = await pool.query(
        `
        SELECT
          ii.id AS id,
          ii.invoice_id AS invoiceId,
          ii.item_id AS itemId,
          iname.name AS item,
          ii.quantity AS quantity,
          ii.rate AS rate,
          ii.tax_percent AS taxPercent
        FROM invoice_items ii
        LEFT JOIN items it ON it.id = ii.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        WHERE ii.invoice_id IN (${placeholders})
        ORDER BY ii.created_at ASC
        `,
        invoiceIds
      );

      itemsByInvoiceId = new Map();
      for (const r of Array.isArray(itemRows) ? itemRows : []) {
        const invoiceId = String(r.invoiceId ?? '').trim();
        if (!invoiceId) continue;
        if (!itemsByInvoiceId.has(invoiceId)) itemsByInvoiceId.set(invoiceId, []);
        itemsByInvoiceId.get(invoiceId).push({
          invoiceId,
          id: String(r.id ?? ''),
          itemId: String(r.itemId ?? ''),
          item: String(r.item ?? ''),
          quantity: Number(r.quantity ?? 0),
          rate: Number(r.rate ?? 0),
          taxPercent: Number(r.taxPercent ?? 0),
        });
      }
    }

    const invoices = (Array.isArray(invRows) ? invRows : []).map((r) => {
      const invoiceId = String(r.id ?? '');
      return {
        invoice: {
          id: invoiceId,
          poId: String(r.poId ?? ''),
          supplierInvoiceNo: String(r.supplierInvoiceNo ?? invoiceId),
          invoiceDate: toIsoDate(r.invoiceDate) || '',
          invoiceAmount: Number(r.invoiceAmount ?? 0),
          courierCharge: Number(r.courierCharge ?? 0),
          packingCharge: Number(r.packingCharge ?? 0),
          labourCharge: Number(r.labourCharge ?? 0),
          otherCharge: Number(r.otherCharge ?? 0),
          chargesGstAmount: Number(r.chargesGstAmount ?? 0),
          status: mapInvoiceStatus(r),
          paymentStatus: r.paymentStatus != null ? String(r.paymentStatus) : undefined,
          paymentDate: toIsoDate(r.paymentDate) || undefined,
          documentUrl: r.documentUrl != null ? String(r.documentUrl) : undefined,
          cnCopyUrl: r.cnCopyUrl != null ? String(r.cnCopyUrl) : undefined,
          ewayBillNumber: r.ewayBillNumber != null ? String(r.ewayBillNumber) : undefined,
          cnNumber: r.cnNumber != null ? String(r.cnNumber) : undefined,
          courierNumber: r.courierNumber != null ? String(r.courierNumber) : undefined,
          transporterName: r.transporterName != null ? String(r.transporterName) : undefined,
          createdBy: r.createdBy != null ? String(r.createdBy) : undefined,
          createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
          updatedBy: r.updatedBy != null ? String(r.updatedBy) : undefined,
          updatedAt: toIsoDateTime(r.updatedAt) || undefined,
        },
        items: itemsByInvoiceId.get(invoiceId) ?? [],
      };
    });

    res.json({ invoices });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POs for a PR
app.get('/api/requests/:id/pos', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });

    const [poRows] = await pool.query(
      `
      SELECT
        po.id AS id,
        po.pr_id AS prId,
        po.firm_id AS firmId,
        po.supplier_id AS supplierId,
        sup.name AS supplier,
        po.po_number AS poNumber,
        po.status AS status,
        po.order_date AS orderDate,
        po.payment_terms AS paymentTerms,
        po.shipping_address AS shippingAddress,
        po.terms_conditions AS termsConditions,
        po.check_po AS checkPo,
        po.check_po_user_id AS checkPoUserId,
        po.check_date AS checkDate,
        po.sent_by AS sentBy,
        po.sent_date AS sentDate,
        po.sent_proof AS sentProof,
        po.created_by AS createdBy,
        po.created_at AS createdAt
      FROM purchase_orders po
      LEFT JOIN suppliers sup ON sup.id = po.supplier_id
      WHERE po.pr_id = ?
      ORDER BY po.created_at ASC
      `,
      [prId]
    );

    const poIds = (Array.isArray(poRows) ? poRows : []).map((r) => String(r.id ?? '')).filter(Boolean);
    let itemsByPoId = new Map();
    if (poIds.length) {
      const placeholders = poIds.map(() => '?').join(',');
      const [itemRows] = await pool.query(
        `
        SELECT
          poi.po_id AS poId,
          poi.item_id AS itemId,
          iname.name AS item,
          it.specifications_json AS specificationsJson,
          poi.quantity AS quantity,
          poi.rate AS rate,
          poi.discount_percent AS discountPercent,
          poi.tax_percent AS taxPercent,
          poi.goods_amount AS goodsAmount,
          poi.tax_amount AS taxAmount,
          poi.total_amount AS totalAmount
        FROM purchase_order_items poi
        LEFT JOIN items it ON it.id = poi.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        WHERE poi.po_id IN (${placeholders})
        ORDER BY poi.created_at ASC
        `,
        poIds
      );

      itemsByPoId = new Map();
      for (const r of Array.isArray(itemRows) ? itemRows : []) {
        const poId = String(r.poId ?? '').trim();
        if (!poId) continue;
        if (!itemsByPoId.has(poId)) itemsByPoId.set(poId, []);
        itemsByPoId.get(poId).push({
          poId,
          itemId: String(r.itemId ?? ''),
          item: String(r.item ?? ''),
          specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
          quantity: Number(r.quantity ?? 0),
          rate: Number(r.rate ?? 0),
          discountPercent: r.discountPercent != null ? Number(r.discountPercent) : undefined,
          taxPercent: r.taxPercent != null ? Number(r.taxPercent) : undefined,
          goodsAmount: r.goodsAmount != null ? Number(r.goodsAmount) : undefined,
          taxAmount: r.taxAmount != null ? Number(r.taxAmount) : undefined,
          totalAmount: r.totalAmount != null ? Number(r.totalAmount) : undefined,
        });
      }
    }

	    const pos = (Array.isArray(poRows) ? poRows : []).map((r) => {
	      const poId = String(r.id ?? '');
	      return {
	        po: {
	          id: poId,
	          poNumber: r.poNumber != null ? String(r.poNumber) : undefined,
	          prId: String(r.prId ?? ''),
	          firmId: String(r.firmId ?? ''),
	          orderDate: toIsoDate(r.orderDate) || '',
	          createdBy: r.createdBy != null ? String(r.createdBy) : undefined,
	          supplierId: r.supplierId != null ? String(r.supplierId) : undefined,
          supplier: String(r.supplier ?? ''),
          paymentTerms: String(r.paymentTerms ?? ''),
          shippingAddress: r.shippingAddress != null ? String(r.shippingAddress) : undefined,
          termsConditions: r.termsConditions != null ? String(r.termsConditions) : undefined,
          status: String(r.status ?? 'Open').toLowerCase() === 'closed' ? 'Closed' : String(r.status ?? '').toLowerCase() === 'partial' ? 'Partial' : 'Open',
          createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
          checkPo: Boolean(r.checkPo),
          checkPoUserId: r.checkPoUserId != null ? String(r.checkPoUserId) : null,
          checkDate: toIsoDate(r.checkDate) || null,
          sentBy: r.sentBy != null ? String(r.sentBy) : null,
          sentDate: toIsoDate(r.sentDate) || null,
          sentProof: r.sentProof != null ? String(r.sentProof) : null,
        },
        items: itemsByPoId.get(poId) ?? [],
      };
    });

    res.json({ pos });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GRNs/QC helpers for PR detail (wired; implement fully later as needed)
app.get('/api/requests/:id/grns', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });

    const [grnRows] = await pool.query(
      `
      SELECT
        g.id AS id,
        g.po_id AS poId,
        g.grn_number AS grnNumber,
        g.received_date AS receivedDate,
        g.created_at AS createdAt,
        g.updated_by AS updatedBy,
        g.material_received_by AS materialReceivedBy,
        g.goods_collected_by AS goodsCollectedBy
      FROM grns g
      INNER JOIN purchase_orders po ON po.id = g.po_id
      WHERE po.pr_id = ?
      ORDER BY g.received_date DESC, g.created_at DESC
      `,
      [prId]
    );

    const grnIds = (Array.isArray(grnRows) ? grnRows : []).map((r) => String(r.id ?? '')).filter(Boolean);
    let itemsByGrnId = new Map();
    if (grnIds.length) {
      const placeholders = grnIds.map(() => '?').join(',');
      const [itemRows] = await pool.query(
        `
        SELECT
          gi.id AS id,
          gi.grn_id AS grnId,
          gi.item_id AS itemId,
          iname.name AS item,
          it.specifications_json AS specificationsJson,
          gi.received_qty AS quantityReceived
        FROM grn_items gi
        LEFT JOIN items it ON it.id = gi.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        WHERE gi.grn_id IN (${placeholders})
        ORDER BY gi.created_at ASC
        `,
        grnIds
      );

      itemsByGrnId = new Map();
      for (const r of Array.isArray(itemRows) ? itemRows : []) {
        const grnId = String(r.grnId ?? '').trim();
        if (!grnId) continue;
        if (!itemsByGrnId.has(grnId)) itemsByGrnId.set(grnId, []);
        itemsByGrnId.get(grnId).push({
          id: String(r.id ?? ''),
          grnId,
          itemId: String(r.itemId ?? ''),
          item: String(r.item ?? ''),
          specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
          quantityReceived: Number(r.quantityReceived ?? 0),
        });
      }
    }

    const grns = (Array.isArray(grnRows) ? grnRows : []).map((r) => {
      const grnId = String(r.id ?? '');
      return {
        grn: {
          id: grnId,
          poId: String(r.poId ?? ''),
          invoiceId: '',
          receivedDate: toIsoDate(r.receivedDate) || '',
          createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
          updatedBy: r.updatedBy != null ? String(r.updatedBy) : undefined,
          materialReceivedBy: r.materialReceivedBy != null ? String(r.materialReceivedBy) : null,
          goodsCollectedBy: r.goodsCollectedBy != null ? String(r.goodsCollectedBy) : null,
          grnNumber: r.grnNumber != null ? String(r.grnNumber) : undefined,
        },
        items: itemsByGrnId.get(grnId) ?? [],
      };
    });

    res.json({ grns });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/requests/:id/pending-grn-pos', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });

    const [rows] = await pool.query(
      `
      SELECT
        po.id AS poId,
        GREATEST(0, COALESCE(poq.poQty, 0) - COALESCE(grnq.grnQty, 0)) AS pendingQty
      FROM purchase_orders po
      LEFT JOIN (
        SELECT poi.po_id AS poId, SUM(poi.quantity) AS poQty
        FROM purchase_order_items poi
        GROUP BY poi.po_id
      ) poq ON poq.poId = po.id
      LEFT JOIN (
        SELECT g.po_id AS poId, SUM(gi.received_qty) AS grnQty
        FROM grns g
        INNER JOIN grn_items gi ON gi.grn_id = g.id
        GROUP BY g.po_id
      ) grnq ON grnq.poId = po.id
      WHERE po.pr_id = ?
      HAVING pendingQty > 1e-9
      ORDER BY po.created_at ASC
      `,
      [prId]
    );

    const pos = (Array.isArray(rows) ? rows : []).map((r) => ({
      poId: String(r.poId ?? ''),
      pendingQty: Number(r.pendingQty ?? 0),
    }));

    res.json({ pos });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
app.get('/api/requests/:id/qc-records', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });

    const [rows] = await pool.query(
      `
      SELECT
        qc.id AS id,
        qc.grn_id AS grnId,
        g.po_id AS poId,
        qc.item_id AS itemId,
        iname.name AS item,
        qc.accepted_qty AS acceptedQty,
        qc.rejected_qty AS rejectedQty,
        qc.hold_qty AS holdQty,
        qc.remarks AS remarks,
        qc.qc_by AS qcBy,
        qc.qc_date AS qcDate,
        qc.created_at AS createdAt,
        qc.updated_by AS updatedBy,
        qc.updated_at AS updatedAt
      FROM qc_records qc
      INNER JOIN grns g ON g.id = qc.grn_id
      INNER JOIN purchase_orders po ON po.id = g.po_id
      LEFT JOIN items it ON it.id = qc.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      WHERE po.pr_id = ?
      ORDER BY qc.created_at DESC
      `,
      [prId]
    );

    const qc = (Array.isArray(rows) ? rows : []).map((r) => ({
      id: String(r.id ?? ''),
      grnId: String(r.grnId ?? ''),
      poId: String(r.poId ?? ''),
      itemId: String(r.itemId ?? ''),
      item: String(r.item ?? ''),
      acceptedQty: Number(r.acceptedQty ?? 0),
      rejectedQty: Number(r.rejectedQty ?? 0),
      remarks: String(r.remarks ?? ''),
      qcBy: String(r.qcBy ?? ''),
      qcDate: toIsoDateTime(r.qcDate) || String(r.qcDate ?? ''),
      createdAt: toIsoDateTime(r.createdAt) || String(r.createdAt ?? ''),
      updatedBy: r.updatedBy != null ? String(r.updatedBy) : undefined,
    }));

    res.json({ qc });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GRN item ↔ invoice linking (links for a GRN item)
app.get('/api/grn-items/:id/invoice-links', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const grnItemId = String(req.params.id ?? '').trim();
    if (!grnItemId) return res.status(400).json({ error: 'id is required' });

    const [rows] = await pool.query(
      `
      SELECT
        gil.invoice_item_id AS invoiceItemId,
        inv.id AS invoiceId,
        inv.invoice_number AS invoiceNo,
        inv.invoice_date AS invoiceDate,
        gil.linked_qty AS linkedQty
      FROM grn_invoice_item_links gil
      INNER JOIN invoice_items ii ON ii.id = gil.invoice_item_id
      INNER JOIN invoices inv ON inv.id = ii.invoice_id
      WHERE gil.grn_item_id = ?
      ORDER BY inv.invoice_date DESC, inv.invoice_number DESC
      `,
      [grnItemId]
    );

    const links = (Array.isArray(rows) ? rows : []).map((r) => ({
      invoiceItemId: String(r.invoiceItemId ?? ''),
      invoiceId: String(r.invoiceId ?? ''),
      invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
      invoiceDate: toIsoDate(r.invoiceDate) || '',
      linkedQty: Number(r.linkedQty ?? 0),
    }));

    res.json({ links });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GRN item ↔ invoice linking (set links for a GRN item)
app.post('/api/grn-items/:id/invoice-links', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const grnItemId = String(req.params.id ?? '').trim();
    if (!grnItemId) return res.status(400).json({ error: 'id is required' });

    const links = Array.isArray(req.body?.links) ? req.body.links : [];
    for (const l of links) {
      const invoiceItemId = String(l?.invoiceItemId ?? '').trim();
      const linkedQty = Number(l?.linkedQty ?? 0);
      if (!invoiceItemId) return res.status(400).json({ error: 'Each link requires invoiceItemId' });
      if (!Number.isFinite(linkedQty) || linkedQty < 0) return res.status(400).json({ error: 'Each link requires a valid linkedQty (0 or more)' });
    }

    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;

    // Replace links for this grn_item_id.
    await pool.query('DELETE FROM grn_invoice_item_links WHERE grn_item_id = ?', [grnItemId]);

    for (const l of links) {
      const invoiceItemId = String(l?.invoiceItemId ?? '').trim();
      const linkedQty = Number(l?.linkedQty ?? 0);
      if (!invoiceItemId || !Number.isFinite(linkedQty) || linkedQty <= 0) continue; // don't persist zeros
      const id = crypto.randomUUID();
      await pool.query(
        `
        INSERT INTO grn_invoice_item_links (id, grn_item_id, invoice_item_id, linked_qty, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        `,
        [id, grnItemId, invoiceItemId, linkedQty, updatedBy || 'system']
      );
    }

    // Return current links with invoice meta.
    const [rows] = await pool.query(
      `
      SELECT
        gil.invoice_item_id AS invoiceItemId,
        inv.id AS invoiceId,
        inv.invoice_number AS invoiceNo,
        inv.invoice_date AS invoiceDate,
        gil.linked_qty AS linkedQty
      FROM grn_invoice_item_links gil
      INNER JOIN invoice_items ii ON ii.id = gil.invoice_item_id
      INNER JOIN invoices inv ON inv.id = ii.invoice_id
      WHERE gil.grn_item_id = ?
      ORDER BY inv.invoice_date DESC, inv.invoice_number DESC
      `,
      [grnItemId]
    );

    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      invoiceItemId: String(r.invoiceItemId ?? ''),
      invoiceId: String(r.invoiceId ?? ''),
      invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
      invoiceDate: toIsoDate(r.invoiceDate) || '',
      linkedQty: Number(r.linkedQty ?? 0),
    }));

    res.json({ links: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/requests', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const firmId = String(req.body?.firmId ?? '').trim();
    const storeName = String(req.body?.store ?? '').trim();
    const department = String(req.body?.department ?? '').trim();
    const requestedBy = String(req.body?.requestedBy ?? '').trim();
    const requiredDate = String(req.body?.requiredDate ?? '').trim(); // YYYY-MM-DD
    const requestType = (String(req.body?.requestType ?? 'Stock').trim() === 'Project' ? 'Project' : 'Stock');
    const projectId = req.body?.projectId != null ? String(req.body.projectId).trim() : null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!firmId) return res.status(400).json({ error: 'firmId is required' });
    if (!storeName) return res.status(400).json({ error: 'store is required' });
    if (!department) return res.status(400).json({ error: 'department is required' });
    if (!requestedBy) return res.status(400).json({ error: 'requestedBy is required' });
    if (!requiredDate) return res.status(400).json({ error: 'requiredDate is required' });
    if (!items.length) return res.status(400).json({ error: 'items are required' });

    const [storeRows] = await pool.query('SELECT id, name FROM stores WHERE firm_id = ? AND name = ? LIMIT 1', [firmId, storeName]);
    const storeRow = Array.isArray(storeRows) ? storeRows[0] : null;
    if (!storeRow?.id) return res.status(400).json({ error: 'Store not found for selected firm' });
    const storeId = String(storeRow.id);

    const prId = crypto.randomUUID();
    const prNumber = await allocateDocNumber(pool, 'PR', new Date());
    const remarks = JSON.stringify({ department });

    await pool.query(
      `
      INSERT INTO purchase_requisitions
        (id, pr_number, firm_id, store_id, project_id, requested_by, status, remarks, created_by, created_at, updated_at, request_type)
      VALUES
        (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), NOW(), ?)
      `,
      [prId, prNumber, firmId, storeId, projectId || null, requestedBy, remarks, 'system', requestType]
    );

    for (const row of items) {
      const itemId = String(row?.itemId ?? '').trim();
      const quantity = Number(row?.quantity ?? 0);
      const specification = String(row?.specification ?? '').trim();
      if (!itemId) return res.status(400).json({ error: 'Each item requires itemId' });
      if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Each item requires a valid quantity' });
      if (!specification) return res.status(400).json({ error: 'Each item requires specification' });

      const prItemId = crypto.randomUUID();
      await pool.query(
        `
        INSERT INTO purchase_requisition_items
          (id, pr_id, item_id, requested_qty, approved_qty, required_date, remarks, status, created_by, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, NULL, ?, ?, 'pending', ?, NOW(), NOW())
        `,
        [prItemId, prId, itemId, quantity, requiredDate, specification, 'system']
      );
    }

    // Return detail
    const [itemsRows] = await pool.query(
      `
      SELECT
        pri.id,
        pri.pr_id AS prId,
        pri.item_id AS itemId,
        iname.name AS item,
        pri.requested_qty AS quantity,
        pri.remarks AS specification
      FROM purchase_requisition_items pri
      LEFT JOIN items it ON it.id = pri.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      WHERE pri.pr_id = ?
      ORDER BY pri.created_at ASC
      `,
      [prId]
    );

    const pr = {
      id: prId,
      firmId,
      store: storeName,
      projectId: projectId || null,
      projectName: null,
      department,
      requestedBy,
      requiredDate,
      requisitionDate: new Date().toISOString(),
      requestType,
      status: 'Pending Approval',
    };
    const outItems = (itemsRows || []).map((r) => ({
      id: String(r.id),
      prId: String(r.prId),
      itemId: String(r.itemId),
      item: String(r.item || ''),
      quantity: Number(r.quantity ?? 0),
      specification: String(r.specification ?? ''),
    }));

    res.status(201).json({ request: { pr, items: outItems } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/requests/:id/approve', async (req, res) => {
  let conn = null;
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });
    const approver = String(req.body?.approver ?? '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!approver) return res.status(400).json({ error: 'approver is required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[prRow]] = await conn.query('SELECT id, status FROM purchase_requisitions WHERE id=? FOR UPDATE', [prId]);
    if (!prRow) {
      await conn.rollback();
      return res.status(404).json({ error: 'PR not found' });
    }

    // Default approve-all if items not provided.
    let approveItems = items;
    if (!approveItems.length) {
      const [rows] = await conn.query('SELECT id, requested_qty AS quantity FROM purchase_requisition_items WHERE pr_id=?', [prId]);
      approveItems = (Array.isArray(rows) ? rows : []).map((r) => ({ id: String(r.id), quantity: Number(r.quantity ?? 0) }));
    }

    for (const row of approveItems) {
      const prItemId = String(row?.id ?? '').trim();
      const approvedQty = Number(row?.quantity ?? 0);
      if (!prItemId) continue;
      if (!Number.isFinite(approvedQty) || approvedQty < 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Invalid approved quantity' });
      }
      await conn.query(
        `
        UPDATE purchase_requisition_items
        SET approved_qty=?, status='approved', approved_by=?, approved_at=NOW(), updated_at=NOW()
        WHERE id=? AND pr_id=?
        `,
        [approvedQty, approver, prItemId, prId]
      );
    }

    await conn.query(
      `
      UPDATE purchase_requisitions
      SET status='approved', approved_by=?, approved_at=NOW(), updated_by=?, updated_at=NOW()
      WHERE id=?
      `,
      [approver, approver, prId]
    );

    await conn.commit();

    const detail = await fetchPrDetail(pool, prId);
    res.json({ request: detail });
  } catch (e) {
    try {
      if (conn) await conn.rollback();
    } catch {}
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    try {
      if (conn) conn.release();
    } catch {}
  }
});

app.post('/api/requests/:id/reject', async (req, res) => {
  let conn = null;
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });
    const approver = String(req.body?.approver ?? '').trim();
    const rejectReason = String(req.body?.rejectReason ?? '').trim();
    if (!approver) return res.status(400).json({ error: 'approver is required' });
    if (!rejectReason) return res.status(400).json({ error: 'rejectReason is required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[prRow]] = await conn.query('SELECT id, remarks FROM purchase_requisitions WHERE id=? FOR UPDATE', [prId]);
    if (!prRow) {
      await conn.rollback();
      return res.status(404).json({ error: 'PR not found' });
    }

    const nextRemarks = mergeRemarksJson(prRow.remarks, { rejectReason });

    await conn.query(
      `
      UPDATE purchase_requisitions
      SET status='rejected', remarks=?, approved_by=?, approved_at=NOW(), updated_by=?, updated_at=NOW()
      WHERE id=?
      `,
      [nextRemarks, approver, approver, prId]
    );

    await conn.query(
      `
      UPDATE purchase_requisition_items
      SET status='rejected', approved_by=?, approved_at=NOW(), updated_at=NOW()
      WHERE pr_id=?
      `,
      [approver, prId]
    );

    await conn.commit();

    const detail = await fetchPrDetail(pool, prId);
    res.json({ request: detail });
  } catch (e) {
    try {
      if (conn) await conn.rollback();
    } catch {}
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    try {
      if (conn) conn.release();
    } catch {}
  }
});

// Last supplier by item ids (used for PO suggestions)
app.post('/api/items/last-supplier', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
    const ids = itemIds.map((x) => String(x ?? '').trim()).filter(Boolean);
    if (!ids.length) return res.json({ byItemId: {} });

    // Use a single query with window function when available (MySQL 8+).
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
      `
      SELECT itemId, supplierId, supplierName, rate FROM (
        SELECT
          poi.item_id AS itemId,
          po.supplier_id AS supplierId,
          s.name AS supplierName,
          poi.rate AS rate,
          ROW_NUMBER() OVER (PARTITION BY poi.item_id ORDER BY po.order_date DESC, po.created_at DESC) AS rn
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON po.id = poi.po_id
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE poi.item_id IN (${placeholders})
      ) x
      WHERE x.rn = 1
      `,
      ids
    );

    const byItemId = {};
    for (const r of Array.isArray(rows) ? rows : []) {
      const itemId = String(r.itemId ?? '').trim();
      if (!itemId) continue;
      byItemId[itemId] = {
        supplierId: String(r.supplierId ?? ''),
        supplierName: String(r.supplierName ?? ''),
        rate: Number(r.rate ?? 0),
      };
    }

    res.json({ byItemId });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Create PO for a PR
app.post('/api/requests/:id/po', async (req, res) => {
  try {
    const pool = getMysqlPool();
	    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
	    const prId = String(req.params.id ?? '').trim();
	    if (!prId) return res.status(400).json({ error: 'id is required' });

	    const supplierName = String(req.body?.supplier ?? '').trim();
	    const paymentTerms = String(req.body?.paymentTerms ?? '').trim();
	    const shippingAddress = req.body?.shippingAddress != null ? String(req.body.shippingAddress).trim() : null;
	    const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions).trim() : null;
	    const items = Array.isArray(req.body?.items) ? req.body.items : [];
	    if (!supplierName) return res.status(400).json({ error: 'supplier is required' });
	    if (!paymentTerms) return res.status(400).json({ error: 'paymentTerms is required' });
	    if (!items.length) return res.status(400).json({ error: 'items are required' });

	    const [[prRow]] = await pool.query(
	      'SELECT id, firm_id AS firmId, store_id AS storeId, project_id AS projectId FROM purchase_requisitions WHERE id = ? LIMIT 1',
	      [prId]
	    );
	    if (!prRow) return res.status(404).json({ error: 'PR not found' });

	    const [supRows] = await pool.query('SELECT id, name FROM suppliers WHERE name = ? LIMIT 1', [supplierName]);
	    const supRow = Array.isArray(supRows) ? supRows[0] : null;
	    if (!supRow?.id) return res.status(400).json({ error: 'Supplier not found' });
	    const supplierId = String(supRow.id);

	    const poId = crypto.randomUUID();
	    const poNumber = await allocateDocNumber(pool, 'PO', new Date());

	    await pool.query(
	      `
	      INSERT INTO purchase_orders
	        (id, po_number, firm_id, store_id, project_id, supplier_id, pr_id, status, order_date, payment_terms, remarks, created_by, created_at, updated_at, shipping_address, terms_conditions)
	      VALUES
	        (?, ?, ?, ?, ?, ?, ?, 'issued', CURDATE(), ?, NULL, ?, NOW(), NOW(), ?, ?)
	      `,
	      [
	        poId,
	        poNumber,
	        String(prRow.firmId),
	        String(prRow.storeId),
	        prRow.projectId ? String(prRow.projectId) : null,
	        supplierId,
	        prId,
	        paymentTerms,
	        'system',
	        shippingAddress,
	        termsConditions,
	      ]
	    );

	    const outItems = [];
	    for (const row of items) {
	      const itemId = String(row?.itemId ?? '').trim();
	      const quantity = Number(row?.quantity ?? 0);
	      const rate = Number(row?.rate ?? 0);
	      const discountPercent = row?.discountPercent != null ? Number(row.discountPercent) : null;
	      const taxPercent = row?.taxPercent != null ? Number(row.taxPercent) : null;
	      if (!itemId) return res.status(400).json({ error: 'Each item requires itemId' });
	      if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Each item requires valid quantity' });
	      if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ error: 'Each item requires valid rate' });

	      const disc = Number.isFinite(discountPercent) ? Math.max(0, discountPercent) : 0;
	      const tax = Number.isFinite(taxPercent) ? Math.max(0, taxPercent) : 0;
	      const gross = quantity * rate;
	      const goodsAmount = gross * (1 - disc / 100);
	      const taxAmount = goodsAmount * (tax / 100);
	      const totalAmount = goodsAmount + taxAmount;

	      const poItemId = crypto.randomUUID();
	      await pool.query(
	        `
	        INSERT INTO purchase_order_items
	          (id, po_id, item_id, quantity, rate, discount_percent, tax_percent, goods_amount, tax_amount, total_amount, created_by, created_at, updated_at)
	        VALUES
	          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
	        `,
	        [poItemId, poId, itemId, quantity, rate, disc || null, tax || null, goodsAmount, taxAmount, totalAmount, 'system']
	      );

	      outItems.push({
	        poId,
	        itemId,
	        item: '',
	        specificationsJson: undefined,
	        quantity,
	        rate,
	        discountPercent: disc || undefined,
	        taxPercent: tax || undefined,
	        goodsAmount,
	        taxAmount,
	        totalAmount,
	      });
	    }

		    res.status(201).json({
		      po: {
		        po: {
		          id: poId,
		          poNumber,
		          prId,
		          firmId: String(prRow.firmId),
		          orderDate: new Date().toISOString().slice(0, 10),
		          createdBy: 'system',
		          supplierId,
	          supplier: supplierName,
	          paymentTerms,
	          shippingAddress: shippingAddress || undefined,
	          termsConditions: termsConditions || undefined,
	          status: 'Open',
	          createdAt: new Date().toISOString(),
	        },
	        items: outItems,
	      },
	    });
	  } catch (e) {
	    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
	  }
	});

	// Create GRN for a PO
app.post('/api/pos/:id/grn', async (req, res) => {
  try {
	    const pool = getMysqlPool();
	    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
	    const poId = String(req.params.id ?? '').trim();
	    if (!poId) return res.status(400).json({ error: 'id is required' });

	    const receivedDate = String(req.body?.receivedDate ?? '').trim();
	    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
	    const materialReceivedBy = req.body?.materialReceivedBy != null ? String(req.body.materialReceivedBy).trim() : null;
	    const goodsCollectedBy = req.body?.goodsCollectedBy != null ? String(req.body.goodsCollectedBy).trim() : null;
	    const items = Array.isArray(req.body?.items) ? req.body.items : [];
	    if (!receivedDate) return res.status(400).json({ error: 'receivedDate is required' });
	    if (!items.length) return res.status(400).json({ error: 'items are required' });

	    const [[poRow]] = await pool.query(
	      'SELECT id, pr_id AS prId, firm_id AS firmId, store_id AS storeId FROM purchase_orders WHERE id = ? LIMIT 1',
	      [poId]
	    );
	    if (!poRow) return res.status(404).json({ error: 'PO not found' });

	    const [poItemRows] = await pool.query('SELECT item_id AS itemId, quantity FROM purchase_order_items WHERE po_id = ?', [poId]);
	    const orderedByItemId = new Map(
	      (Array.isArray(poItemRows) ? poItemRows : []).map((r) => [String(r.itemId), Number(r.quantity ?? 0)])
	    );

	    const grnId = crypto.randomUUID();
	    const grnNumber = await allocateDocNumber(pool, 'GRN', new Date(receivedDate));

	    await pool.query(
	      `
	      INSERT INTO grns
	        (id, grn_number, po_id, firm_id, store_id, received_by, received_date, remarks, created_by, created_at, updated_by, updated_at, material_received_by, goods_collected_by)
	      VALUES
	        (?, ?, ?, ?, ?, ?, ?, NULL, ?, NOW(), ?, NOW(), ?, ?)
	      `,
	      [
	        grnId,
	        grnNumber,
	        poId,
	        String(poRow.firmId),
	        String(poRow.storeId),
	        updatedBy || 'system',
	        receivedDate,
	        'system',
	        updatedBy || null,
	        materialReceivedBy,
	        goodsCollectedBy,
	      ]
	    );

	    const outItems = [];
	    for (const row of items) {
	      const itemId = String(row?.itemId ?? '').trim();
	      const qtyReceived = Number(row?.quantityReceived ?? 0);
	      if (!itemId) return res.status(400).json({ error: 'Each item requires itemId' });
	      if (!Number.isFinite(qtyReceived) || qtyReceived <= 0) return res.status(400).json({ error: 'Each item requires valid quantityReceived' });

	      const orderedQty = Number(orderedByItemId.get(itemId) ?? 0);
	      const shortQty = Math.max(0, orderedQty - qtyReceived);
	      const grnItemId = crypto.randomUUID();

	      await pool.query(
	        `
	        INSERT INTO grn_items
	          (id, grn_id, item_id, ordered_qty, received_qty, short_qty, damaged_qty, created_by, created_at, updated_by, updated_at)
	        VALUES
	          (?, ?, ?, ?, ?, ?, 0, ?, NOW(), ?, NOW())
	        `,
	        [grnItemId, grnId, itemId, orderedQty, qtyReceived, shortQty, 'system', updatedBy || null]
	      );

	      outItems.push({ id: grnItemId, grnId, itemId, item: '', specificationsJson: undefined, quantityReceived: qtyReceived });
	    }

	    res.status(201).json({
	      grn: {
	        grn: {
	          id: grnId,
	          poId,
	          invoiceId: '',
	          receivedDate,
	          createdAt: new Date().toISOString(),
	          updatedBy: updatedBy || undefined,
	          materialReceivedBy,
	          goodsCollectedBy,
	        },
	        items: outItems,
	      },
	    });
	  } catch (e) {
	    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Update PO check/sent flags (used by Check PO / Send PO queues)
app.put('/api/pos/:id/check-sent', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'id is required' });

    const checkPo = req.body?.checkPo != null ? Boolean(req.body.checkPo) : null;
    const checkPoUserId = req.body?.checkPoUserId != null ? String(req.body.checkPoUserId).trim() : null;
    const checkDate = req.body?.checkDate != null ? String(req.body.checkDate).trim() : null;
    const sentBy = req.body?.sentBy != null ? String(req.body.sentBy).trim() : null;
    const sentDate = req.body?.sentDate != null ? String(req.body.sentDate).trim() : null;
    const sentProof = req.body?.sentProof != null ? String(req.body.sentProof).trim() : null;
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;

    const sets = [];
    const params = [];
    if (checkPo !== null) {
      sets.push('check_po = ?');
      params.push(checkPo ? 1 : 0);
    }
    if (req.body?.checkPoUserId !== undefined) {
      sets.push('check_po_user_id = ?');
      params.push(checkPoUserId || null);
    }
    if (req.body?.checkDate !== undefined) {
      sets.push('check_date = ?');
      params.push(checkDate || null);
    }
    if (req.body?.sentBy !== undefined) {
      sets.push('sent_by = ?');
      params.push(sentBy || null);
    }
    if (req.body?.sentDate !== undefined) {
      sets.push('sent_date = ?');
      params.push(sentDate || null);
    }
    if (req.body?.sentProof !== undefined) {
      sets.push('sent_proof = ?');
      params.push(sentProof || null);
    }
    sets.push('updated_by = ?');
    params.push(updatedBy || 'system');
    sets.push('updated_at = NOW()');

    params.push(poId);
    await pool.query(`UPDATE purchase_orders SET ${sets.join(', ')} WHERE id = ?`, params);

    // Return updated PO + items (shape expected by frontend)
    const [[poRow]] = await pool.query(
      `
      SELECT
        po.id AS id,
        po.pr_id AS prId,
        po.firm_id AS firmId,
        po.po_number AS poNumber,
        po.order_date AS orderDate,
        po.payment_terms AS paymentTerms,
        po.shipping_address AS shippingAddress,
        po.terms_conditions AS termsConditions,
        po.status AS status,
        po.created_by AS createdBy,
        po.created_at AS createdAt,
        po.check_po AS checkPo,
        po.check_po_user_id AS checkPoUserId,
        po.check_date AS checkDate,
        po.sent_by AS sentBy,
        po.sent_date AS sentDate,
        po.sent_proof AS sentProof,
        po.supplier_id AS supplierId,
        s.name AS supplier
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = ?
      LIMIT 1
      `,
      [poId]
    );
    if (!poRow) return res.status(404).json({ error: 'PO not found' });

    const [itemRows] = await pool.query(
      `
      SELECT
        poi.po_id AS poId,
        poi.item_id AS itemId,
        iname.name AS item,
        it.specifications_json AS specificationsJson,
        poi.quantity AS quantity,
        poi.rate AS rate,
        poi.discount_percent AS discountPercent,
        poi.tax_percent AS taxPercent,
        poi.goods_amount AS goodsAmount,
        poi.tax_amount AS taxAmount,
        poi.total_amount AS totalAmount
      FROM purchase_order_items poi
      LEFT JOIN items it ON it.id = poi.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      WHERE poi.po_id = ?
      ORDER BY poi.created_at ASC
      `,
      [poId]
    );

    const po = {
      id: String(poRow.id),
      prId: String(poRow.prId ?? ''),
      firmId: String(poRow.firmId ?? ''),
      orderDate: toIsoDate(poRow.orderDate) || '',
      createdBy: poRow.createdBy != null ? String(poRow.createdBy) : undefined,
      supplierId: poRow.supplierId != null ? String(poRow.supplierId) : undefined,
      supplier: String(poRow.supplier ?? ''),
      paymentTerms: String(poRow.paymentTerms ?? ''),
      shippingAddress: poRow.shippingAddress != null ? String(poRow.shippingAddress) : undefined,
      termsConditions: poRow.termsConditions != null ? String(poRow.termsConditions) : undefined,
      status: String(poRow.status ?? 'Open').toLowerCase() === 'closed' ? 'Closed' : String(poRow.status ?? '').toLowerCase() === 'partial' ? 'Partial' : 'Open',
      createdAt: toIsoDateTime(poRow.createdAt) || new Date().toISOString(),
      poNumber: poRow.poNumber != null ? String(poRow.poNumber) : undefined,
      checkPo: Boolean(poRow.checkPo),
      checkPoUserId: poRow.checkPoUserId != null ? String(poRow.checkPoUserId) : null,
      checkDate: toIsoDate(poRow.checkDate) || null,
      sentBy: poRow.sentBy != null ? String(poRow.sentBy) : null,
      sentDate: toIsoDate(poRow.sentDate) || null,
      sentProof: poRow.sentProof != null ? String(poRow.sentProof) : null,
    };

    const items = (Array.isArray(itemRows) ? itemRows : []).map((r) => ({
      poId: String(r.poId ?? ''),
      itemId: String(r.itemId ?? ''),
      item: String(r.item ?? ''),
      specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
      quantity: Number(r.quantity ?? 0),
      rate: Number(r.rate ?? 0),
      discountPercent: r.discountPercent != null ? Number(r.discountPercent) : undefined,
      taxPercent: r.taxPercent != null ? Number(r.taxPercent) : undefined,
      goodsAmount: r.goodsAmount != null ? Number(r.goodsAmount) : undefined,
      taxAmount: r.taxAmount != null ? Number(r.taxAmount) : undefined,
      totalAmount: r.totalAmount != null ? Number(r.totalAmount) : undefined,
    }));

    res.json({ po: { po, items } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Pending invoice items for a PO (qty not yet invoiced)
app.get('/api/pos/:id/pending-invoice-items', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'id is required' });

    const [rows] = await pool.query(
      `
      SELECT
        poi.item_id AS itemId,
        iname.name AS item,
        GREATEST(0, COALESCE(poi.quantity, 0) - COALESCE(invq.invQty, 0)) AS pendingQty,
        poi.rate AS rate
      FROM purchase_order_items poi
      LEFT JOIN (
        SELECT inv.po_id AS poId, ii.item_id AS itemId, SUM(ii.quantity) AS invQty
        FROM invoices inv
        INNER JOIN invoice_items ii ON ii.invoice_id = inv.id
        GROUP BY inv.po_id, ii.item_id
      ) invq ON invq.poId = poi.po_id AND invq.itemId = poi.item_id
      LEFT JOIN items it ON it.id = poi.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      WHERE poi.po_id = ?
      HAVING pendingQty > 1e-9
      ORDER BY iname.name ASC
      `,
      [poId]
    );

    const items = (Array.isArray(rows) ? rows : []).map((r) => ({
      itemId: String(r.itemId ?? ''),
      item: String(r.item ?? ''),
      pendingQty: Number(r.pendingQty ?? 0),
      rate: Number(r.rate ?? 0),
    }));

    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Pending GRN items for a PO (qty not yet received)
app.get('/api/pos/:id/pending-grn-items', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'id is required' });

    const [rows] = await pool.query(
      `
      SELECT
        poi.item_id AS itemId,
        iname.name AS item,
        GREATEST(0, COALESCE(poi.quantity, 0) - COALESCE(grnq.grnQty, 0)) AS pendingQty,
        poi.rate AS rate
      FROM purchase_order_items poi
      LEFT JOIN (
        SELECT g.po_id AS poId, gi.item_id AS itemId, SUM(gi.received_qty) AS grnQty
        FROM grns g
        INNER JOIN grn_items gi ON gi.grn_id = g.id
        GROUP BY g.po_id, gi.item_id
      ) grnq ON grnq.poId = poi.po_id AND grnq.itemId = poi.item_id
      LEFT JOIN items it ON it.id = poi.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      WHERE poi.po_id = ?
      HAVING pendingQty > 1e-9
      ORDER BY iname.name ASC
      `,
      [poId]
    );

    const items = (Array.isArray(rows) ? rows : []).map((r) => ({
      itemId: String(r.itemId ?? ''),
      item: String(r.item ?? ''),
      pendingQty: Number(r.pendingQty ?? 0),
      rate: Number(r.rate ?? 0),
    }));

    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GRNs for a PO
app.get('/api/pos/:id/grns', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'id is required' });

    const [grnRows] = await pool.query(
      `
      SELECT
        g.id AS id,
        g.po_id AS poId,
        g.grn_number AS grnNumber,
        g.received_date AS receivedDate,
        g.created_at AS createdAt,
        g.updated_by AS updatedBy,
        g.material_received_by AS materialReceivedBy,
        g.goods_collected_by AS goodsCollectedBy
      FROM grns g
      WHERE g.po_id = ?
      ORDER BY g.received_date DESC, g.created_at DESC
      `,
      [poId]
    );

    const grnIds = (Array.isArray(grnRows) ? grnRows : []).map((r) => String(r.id ?? '')).filter(Boolean);
    let itemsByGrnId = new Map();
    if (grnIds.length) {
      const placeholders = grnIds.map(() => '?').join(',');
      const [itemRows] = await pool.query(
        `
        SELECT
          gi.id AS id,
          gi.grn_id AS grnId,
          gi.item_id AS itemId,
          iname.name AS item,
          it.specifications_json AS specificationsJson,
          gi.received_qty AS quantityReceived
        FROM grn_items gi
        LEFT JOIN items it ON it.id = gi.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        WHERE gi.grn_id IN (${placeholders})
        ORDER BY gi.created_at ASC
        `,
        grnIds
      );

      itemsByGrnId = new Map();
      for (const r of Array.isArray(itemRows) ? itemRows : []) {
        const grnId = String(r.grnId ?? '').trim();
        if (!grnId) continue;
        if (!itemsByGrnId.has(grnId)) itemsByGrnId.set(grnId, []);
        itemsByGrnId.get(grnId).push({
          id: String(r.id ?? ''),
          grnId,
          itemId: String(r.itemId ?? ''),
          item: String(r.item ?? ''),
          specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
          quantityReceived: Number(r.quantityReceived ?? 0),
        });
      }
    }

    const grns = (Array.isArray(grnRows) ? grnRows : []).map((r) => {
      const grnId = String(r.id ?? '');
      return {
        grn: {
          id: grnId,
          poId: String(r.poId ?? ''),
          invoiceId: '',
          receivedDate: toIsoDate(r.receivedDate) || '',
          createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
          updatedBy: r.updatedBy != null ? String(r.updatedBy) : undefined,
          materialReceivedBy: r.materialReceivedBy != null ? String(r.materialReceivedBy) : null,
          goodsCollectedBy: r.goodsCollectedBy != null ? String(r.goodsCollectedBy) : null,
          grnNumber: r.grnNumber != null ? String(r.grnNumber) : undefined,
        },
        items: itemsByGrnId.get(grnId) ?? [],
      };
    });

    res.json({ grns });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// QC for GRN
app.post('/api/grns/:id/qc', async (req, res) => {
  let conn = null;
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const grnId = String(req.params.id ?? '').trim();
    if (!grnId) return res.status(400).json({ error: 'id is required' });

    const inspectedBy = String(req.body?.inspectedBy ?? '').trim();
    const location = String(req.body?.location ?? '').trim();
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!inspectedBy) return res.status(400).json({ error: 'inspectedBy is required' });
    if (!location) return res.status(400).json({ error: 'location is required' });
    if (!items.length) return res.status(400).json({ error: 'items are required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[grnRow]] = await conn.query('SELECT id FROM grns WHERE id=? FOR UPDATE', [grnId]);
    if (!grnRow) {
      await conn.rollback();
      return res.status(404).json({ error: 'GRN not found' });
    }

    for (const row of items) {
      const itemId = String(row?.itemId ?? '').trim();
      const accepted = Number(row?.quantityAccepted ?? 0);
      const rejected = Number(row?.quantityRejected ?? 0);
      const remarks = String(row?.remarks ?? '').trim();
      if (!itemId) continue;
      if (!Number.isFinite(accepted) || accepted < 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Invalid accepted quantity' });
      }
      if (!Number.isFinite(rejected) || rejected < 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Invalid rejected quantity' });
      }

      const fullRemarks = location ? (remarks ? `${remarks} (Location: ${location})` : `Location: ${location}`) : remarks;

      const [existingRows] = await conn.query('SELECT id FROM qc_records WHERE grn_id=? AND item_id=? LIMIT 1', [grnId, itemId]);
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      if (existing?.id) {
        await conn.query(
          `
          UPDATE qc_records
          SET accepted_qty=?, rejected_qty=?, hold_qty=0, remarks=?, qc_by=?, qc_date=NOW(), updated_by=?, updated_at=NOW()
          WHERE id=?
          `,
          [accepted, rejected, fullRemarks, inspectedBy, updatedBy || inspectedBy, String(existing.id)]
        );
      } else {
        const id = crypto.randomUUID();
        await conn.query(
          `
          INSERT INTO qc_records
            (id, grn_id, item_id, accepted_qty, rejected_qty, hold_qty, remarks, qc_by, qc_date, created_by, created_at, updated_by, updated_at)
          VALUES
            (?, ?, ?, ?, ?, 0, ?, ?, NOW(), ?, NOW(), ?, NOW())
          `,
          [id, grnId, itemId, accepted, rejected, fullRemarks, inspectedBy, updatedBy || inspectedBy, updatedBy || inspectedBy]
        );
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    try {
      if (conn) await conn.rollback();
    } catch {}
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    try {
      if (conn) conn.release();
    } catch {}
  }
});

app.put('/api/grns/:id/qc', async (req, res) => {
  let conn = null;
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const grnId = String(req.params.id ?? '').trim();
    if (!grnId) return res.status(400).json({ error: 'id is required' });

    const inspectedBy = String(req.body?.inspectedBy ?? '').trim();
    const location = String(req.body?.location ?? '').trim();
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!inspectedBy) return res.status(400).json({ error: 'inspectedBy is required' });
    if (!location) return res.status(400).json({ error: 'location is required' });
    if (!items.length) return res.status(400).json({ error: 'items are required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[grnRow]] = await conn.query('SELECT id FROM grns WHERE id=? FOR UPDATE', [grnId]);
    if (!grnRow) {
      await conn.rollback();
      return res.status(404).json({ error: 'GRN not found' });
    }

    for (const row of items) {
      const itemId = String(row?.itemId ?? '').trim();
      const accepted = Number(row?.quantityAccepted ?? 0);
      const rejected = Number(row?.quantityRejected ?? 0);
      const remarks = String(row?.remarks ?? '').trim();
      if (!itemId) continue;
      if (!Number.isFinite(accepted) || accepted < 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Invalid accepted quantity' });
      }
      if (!Number.isFinite(rejected) || rejected < 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Invalid rejected quantity' });
      }

      const fullRemarks = location ? (remarks ? `${remarks} (Location: ${location})` : `Location: ${location}`) : remarks;

      const [existingRows] = await conn.query('SELECT id FROM qc_records WHERE grn_id=? AND item_id=? LIMIT 1', [grnId, itemId]);
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      if (existing?.id) {
        await conn.query(
          `
          UPDATE qc_records
          SET accepted_qty=?, rejected_qty=?, hold_qty=0, remarks=?, qc_by=?, qc_date=NOW(), updated_by=?, updated_at=NOW()
          WHERE id=?
          `,
          [accepted, rejected, fullRemarks, inspectedBy, updatedBy || inspectedBy, String(existing.id)]
        );
      } else {
        const id = crypto.randomUUID();
        await conn.query(
          `
          INSERT INTO qc_records
            (id, grn_id, item_id, accepted_qty, rejected_qty, hold_qty, remarks, qc_by, qc_date, created_by, created_at, updated_by, updated_at)
          VALUES
            (?, ?, ?, ?, ?, 0, ?, ?, NOW(), ?, NOW(), ?, NOW())
          `,
          [id, grnId, itemId, accepted, rejected, fullRemarks, inspectedBy, updatedBy || inspectedBy, updatedBy || inspectedBy]
        );
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    try {
      if (conn) await conn.rollback();
    } catch {}
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    try {
      if (conn) conn.release();
    } catch {}
  }
});

app.delete('/api/grns/:id/qc', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const grnId = String(req.params.id ?? '').trim();
    if (!grnId) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM qc_records WHERE grn_id=?', [grnId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Suppliers ---
app.get('/api/masters/suppliers', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      `
      SELECT
        id,
        name,
        gst_number AS gstNumber,
        gst_type AS gstType,
        address,
        phone,
        payment_terms AS paymentTerms
      FROM suppliers
      ORDER BY name
      `
    );
    const suppliers = (rows || []).map((r) => ({
      ...r,
      gstType: normalizeGstType(r.gstType),
    }));
    res.json({ suppliers });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/suppliers', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const supplier = {
      id: crypto.randomUUID(),
      name,
      gstNumber: req.body?.gstNumber != null ? String(req.body.gstNumber).trim() : null,
      gstType: req.body?.gstType != null ? String(req.body.gstType).trim() : null,
      address: req.body?.address != null ? String(req.body.address).trim() : null,
      phone: req.body?.phone != null ? String(req.body.phone).trim() : null,
      paymentTerms: req.body?.paymentTerms != null ? String(req.body.paymentTerms).trim() : null,
      createdBy: req.body?.createdBy != null ? String(req.body.createdBy).trim() : null,
    };

    await pool.query(
      `
      INSERT INTO suppliers (id, name, gst_number, gst_type, address, phone, payment_terms, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        supplier.id,
        supplier.name,
        supplier.gstNumber,
        supplier.gstType,
        supplier.address,
        supplier.phone,
        supplier.paymentTerms,
        supplier.createdBy,
      ]
    );

    res.status(201).json({
      supplier: {
        id: supplier.id,
        name: supplier.name,
        gstNumber: supplier.gstNumber ?? undefined,
        gstType: supplier.gstType ?? undefined,
        address: supplier.address ?? undefined,
        phone: supplier.phone ?? undefined,
        paymentTerms: supplier.paymentTerms ?? undefined,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) {
      return res.status(400).json({ error: 'Supplier name already exists' });
    }
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/suppliers/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });

    const gstNumber = req.body?.gstNumber != null ? String(req.body.gstNumber).trim() : null;
    const gstType = req.body?.gstType != null ? String(req.body.gstType).trim() : null;
    const address = req.body?.address != null ? String(req.body.address).trim() : null;
    const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
    const paymentTerms = req.body?.paymentTerms != null ? String(req.body.paymentTerms).trim() : null;
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;

    await pool.query(
      `
      UPDATE suppliers
      SET name=?, gst_number=?, gst_type=?, address=?, phone=?, payment_terms=?, updated_by=?, updated_at=NOW()
      WHERE id=?
      `,
      [name, gstNumber, gstType, address, phone, paymentTerms, updatedBy, id]
    );

    const [rows] = await pool.query(
      `
      SELECT id, name, gst_number AS gstNumber, gst_type AS gstType, address, phone, payment_terms AS paymentTerms
      FROM suppliers WHERE id=?
      `,
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ supplier: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) {
      return res.status(400).json({ error: 'Supplier name already exists' });
    }
    res.status(500).json({ error: message });
  }
});

app.delete('/api/masters/suppliers/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM suppliers WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Projects ---
app.get('/api/masters/projects', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      `
      SELECT
        id,
        firm_id AS firmId,
        name,
        client_name AS clientName,
        start_date AS startDate,
        end_date AS endDate,
        status
      FROM projects
      ORDER BY name
      `
    );
    res.json({ projects: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/projects', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const firmId = String(req.body?.firmId ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!firmId) return res.status(400).json({ error: 'firmId is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const clientName = req.body?.clientName != null ? String(req.body.clientName).trim() : null;
    const startDate = req.body?.startDate != null ? String(req.body.startDate).trim() : null;
    const endDate = req.body?.endDate != null ? String(req.body.endDate).trim() : null;
    const status = req.body?.status != null ? String(req.body.status).trim() : null;
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;

    await pool.query(
      `
      INSERT INTO projects (id, firm_id, name, client_name, start_date, end_date, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [id, firmId, name, clientName, startDate, endDate, status, createdBy]
    );

    res.status(201).json({ project: { id, firmId, name, clientName, startDate, endDate, status } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) {
      return res.status(400).json({ error: 'Project already exists for this firm' });
    }
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/projects/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const firmId = String(req.body?.firmId ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!firmId) return res.status(400).json({ error: 'firmId is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });

    const clientName = req.body?.clientName != null ? String(req.body.clientName).trim() : null;
    const startDate = req.body?.startDate != null ? String(req.body.startDate).trim() : null;
    const endDate = req.body?.endDate != null ? String(req.body.endDate).trim() : null;
    const status = req.body?.status != null ? String(req.body.status).trim() : null;
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;

    await pool.query(
      `
      UPDATE projects
      SET firm_id=?, name=?, client_name=?, start_date=?, end_date=?, status=?, updated_by=?, updated_at=NOW()
      WHERE id=?
      `,
      [firmId, name, clientName, startDate, endDate, status, updatedBy, id]
    );

    const [rows] = await pool.query(
      `
      SELECT id, firm_id AS firmId, name, client_name AS clientName, start_date AS startDate, end_date AS endDate, status
      FROM projects WHERE id=?
      `,
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'Project not found' });
    res.json({ project: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) {
      return res.status(400).json({ error: 'Project already exists for this firm' });
    }
    res.status(500).json({ error: message });
  }
});

app.delete('/api/masters/projects/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM projects WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Departments ---
app.get('/api/masters/departments', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query('SELECT id, name FROM departments ORDER BY name');
    res.json({ departments: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/departments', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query(
      'INSERT INTO departments (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [id, name, createdBy]
    );
    res.status(201).json({ department: { id, name } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) {
      return res.status(400).json({ error: 'Department already exists' });
    }
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/departments/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query('UPDATE departments SET name=?, updated_by=?, updated_at=NOW() WHERE id=?', [name, updatedBy, id]);
    res.json({ department: { id, name } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/departments/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM departments WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Stores ---
app.get('/api/masters/stores', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      'SELECT id, firm_id AS firmId, name, location FROM stores ORDER BY name'
    );
    res.json({ stores: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/stores', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const firmId = String(req.body?.firmId ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!firmId) return res.status(400).json({ error: 'firmId is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const location = req.body?.location != null ? String(req.body.location).trim() : null;
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query(
      'INSERT INTO stores (id, firm_id, name, location, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [id, firmId, name, location, createdBy]
    );
    res.status(201).json({ store: { id, firmId, name, location } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/masters/stores/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const firmId = String(req.body?.firmId ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!firmId) return res.status(400).json({ error: 'firmId is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const location = req.body?.location != null ? String(req.body.location).trim() : null;
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query(
      'UPDATE stores SET firm_id=?, name=?, location=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [firmId, name, location, updatedBy, id]
    );
    res.json({ store: { id, firmId, name, location } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/stores/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM stores WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Customers ---
app.get('/api/masters/customers', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      'SELECT id, name, phone, address FROM customers ORDER BY name'
    );
    res.json({ customers: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/customers', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
    const address = req.body?.address != null ? String(req.body.address).trim() : null;
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query(
      'INSERT INTO customers (id, name, phone, address, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [id, name, phone, address, createdBy]
    );
    res.status(201).json({ customer: { id, name, phone, address } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) {
      return res.status(400).json({ error: 'Customer already exists' });
    }
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/customers/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
    const address = req.body?.address != null ? String(req.body.address).trim() : null;
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query(
      'UPDATE customers SET name=?, phone=?, address=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [name, phone, address, updatedBy, id]
    );
    res.json({ customer: { id, name, phone, address } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/customers/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM customers WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Transporters ---
app.get('/api/masters/transporters', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query('SELECT id, name, phone FROM transporters ORDER BY name');
    res.json({ transporters: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/transporters', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query(
      'INSERT INTO transporters (id, name, phone, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
      [id, name, phone, createdBy]
    );
    res.status(201).json({ transporter: { id, name, phone } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) {
      return res.status(400).json({ error: 'Transporter already exists' });
    }
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/transporters/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query(
      'UPDATE transporters SET name=?, phone=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [name, phone, updatedBy, id]
    );
    res.json({ transporter: { id, name, phone } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/transporters/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM transporters WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Users ---
app.get('/api/masters/users', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        role AS designation,
        phone AS mobile,
        CASE WHEN password_hash IS NULL OR password_hash='' THEN 0 ELSE 1 END AS hasPassword
      FROM users
      WHERE is_active=1
      ORDER BY name
      `
    );
    // Ensure boolean
    const users = (rows || []).map((r) => ({ ...r, hasPassword: Boolean(r.hasPassword) }));
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/users', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim();
    const designation = String(req.body?.designation ?? '').trim();
    const password = String(req.body?.password ?? '').trim();
    const mobile = req.body?.mobile != null ? String(req.body.mobile).trim() : null;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!designation) return res.status(400).json({ error: 'designation is required' });
    if (!password) return res.status(400).json({ error: 'password is required' });
    const id = crypto.randomUUID();
    const passwordHash = sha256(password);
    await pool.query(
      'INSERT INTO users (id, name, role, phone, email, is_active, created_at, password_hash) VALUES (?, ?, ?, ?, ?, 1, NOW(), ?)',
      [id, name, designation, mobile, email || null, passwordHash]
    );
    res.status(201).json({ user: { id, name, email: email || null, designation, mobile, hasPassword: true } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) {
      return res.status(400).json({ error: 'User email already exists' });
    }
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/users/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim();
    const designation = String(req.body?.designation ?? '').trim();
    const mobile = req.body?.mobile != null ? String(req.body.mobile).trim() : null;
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!designation) return res.status(400).json({ error: 'designation is required' });
    await pool.query(
      'UPDATE users SET name=?, role=?, phone=?, email=? WHERE id=?',
      [name, designation, mobile, email || null, id]
    );
    res.json({ user: { id, name, email: email || null, designation, mobile, hasPassword: true } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/users/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('UPDATE users SET is_active=0 WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Units ---
app.get('/api/masters/units', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query('SELECT id, name FROM units ORDER BY name');
    res.json({ units: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/units', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query('INSERT INTO units (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [
      id,
      name,
      createdBy,
    ]);
    res.status(201).json({ unit: { id, name } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'Unit already exists' });
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/units/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query('UPDATE units SET name=?, updated_by=?, updated_at=NOW() WHERE id=?', [name, updatedBy, id]);
    res.json({ unit: { id, name } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/units/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM units WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Item Categories ---
app.get('/api/masters/item-categories', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query('SELECT id, name FROM item_categories ORDER BY name');
    res.json({ itemCategories: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/item-categories', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query(
      'INSERT INTO item_categories (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [id, name, createdBy]
    );
    res.status(201).json({ itemCategory: { id, name } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'Category already exists' });
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/item-categories/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query('UPDATE item_categories SET name=?, updated_by=?, updated_at=NOW() WHERE id=?', [name, updatedBy, id]);
    res.json({ itemCategory: { id, name } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/item-categories/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM item_categories WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Item Names ---
app.get('/api/masters/item-names', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      `
      SELECT
        n.id,
        n.name,
        n.unit_id AS unitId,
        u.name AS unitName,
        n.item_category_id AS itemCategoryId,
        c.name AS itemCategoryName
      FROM item_names n
      LEFT JOIN units u ON u.id = n.unit_id
      LEFT JOIN item_categories c ON c.id = n.item_category_id
      ORDER BY n.name
      `
    );
    res.json({ itemNames: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/item-names', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const unitId = req.body?.unitId != null ? String(req.body.unitId).trim() : '';
    const itemCategoryId = req.body?.itemCategoryId != null ? String(req.body.itemCategoryId).trim() : '';
    if (!unitId) return res.status(400).json({ error: 'unitId is required' });
    if (!itemCategoryId) return res.status(400).json({ error: 'itemCategoryId is required' });
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query(
      'INSERT INTO item_names (id, name, unit_id, item_category_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [id, name, unitId, itemCategoryId, createdBy]
    );
    const [rows] = await pool.query(
      `
      SELECT
        n.id,
        n.name,
        n.unit_id AS unitId,
        u.name AS unitName,
        n.item_category_id AS itemCategoryId,
        c.name AS itemCategoryName
      FROM item_names n
      LEFT JOIN units u ON u.id = n.unit_id
      LEFT JOIN item_categories c ON c.id = n.item_category_id
      WHERE n.id = ?
      `,
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    res.status(201).json({ itemName: row ?? { id, name, unitId, itemCategoryId } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'Item name already exists' });
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/item-names/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const unitId = req.body?.unitId != null ? String(req.body.unitId).trim() : '';
    const itemCategoryId = req.body?.itemCategoryId != null ? String(req.body.itemCategoryId).trim() : '';
    if (!unitId) return res.status(400).json({ error: 'unitId is required' });
    if (!itemCategoryId) return res.status(400).json({ error: 'itemCategoryId is required' });
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query(
      'UPDATE item_names SET name=?, unit_id=?, item_category_id=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [name, unitId, itemCategoryId, updatedBy, id]
    );
    const [rows] = await pool.query(
      `
      SELECT
        n.id,
        n.name,
        n.unit_id AS unitId,
        u.name AS unitName,
        n.item_category_id AS itemCategoryId,
        c.name AS itemCategoryName
      FROM item_names n
      LEFT JOIN units u ON u.id = n.unit_id
      LEFT JOIN item_categories c ON c.id = n.item_category_id
      WHERE n.id = ?
      `,
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    res.json({ itemName: row ?? { id, name, unitId, itemCategoryId } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/item-names/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM item_names WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Specifications ---
app.get('/api/masters/specifications', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query('SELECT id, name FROM specifications ORDER BY name');
    res.json({ specifications: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/specifications', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query(
      'INSERT INTO specifications (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [id, name, createdBy]
    );
    res.status(201).json({ specification: { id, name } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'Specification already exists' });
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/specifications/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query('UPDATE specifications SET name=?, updated_by=?, updated_at=NOW() WHERE id=?', [name, updatedBy, id]);
    res.json({ specification: { id, name } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/specifications/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM specifications WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Specification Values ---
app.get('/api/masters/specification-values', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const specificationId = String(req.query.specificationId ?? '').trim();
    if (!specificationId) return res.status(400).json({ error: 'specificationId is required' });
    const [rows] = await pool.query(
      'SELECT id, specification_id AS specificationId, value, is_active AS isActive FROM specification_values WHERE specification_id=? ORDER BY value',
      [specificationId]
    );
    const specificationValues = (rows || []).map((r) => ({ ...r, isActive: Boolean(r.isActive) }));
    res.json({ specificationValues });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/specification-values', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const specificationId = String(req.body?.specificationId ?? '').trim();
    const value = String(req.body?.value ?? '').trim();
    if (!specificationId) return res.status(400).json({ error: 'specificationId is required' });
    if (!value) return res.status(400).json({ error: 'value is required' });
    const id = crypto.randomUUID();
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query(
      'INSERT INTO specification_values (id, specification_id, value, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, 1, ?, NOW(), NOW())',
      [id, specificationId, value, createdBy]
    );
    res.status(201).json({ specificationValue: { id, specificationId, value, isActive: true } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'Value already exists' });
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/specification-values/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const specificationId = String(req.body?.specificationId ?? '').trim();
    const value = String(req.body?.value ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!specificationId) return res.status(400).json({ error: 'specificationId is required' });
    if (!value) return res.status(400).json({ error: 'value is required' });
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query(
      'UPDATE specification_values SET specification_id=?, value=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [specificationId, value, updatedBy, id]
    );
    res.json({ specificationValue: { id, specificationId, value, isActive: true } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/specification-values/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM specification_values WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Items ---
app.get('/api/masters/items', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      `
      SELECT
        it.id,
        it.item_name_id AS itemNameId,
        it.item_code AS itemCode,
        n.name AS itemName,
        it.specifications_json AS specificationsJson,
        it.unique_key AS uniqueKey,
        it.description,
        it.unit
      FROM items it
      JOIN item_names n ON n.id = it.item_name_id
      ORDER BY it.item_code
      `
    );
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/items', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const itemNameId = String(req.body?.itemNameId ?? '').trim();
    if (!itemNameId) return res.status(400).json({ error: 'itemNameId is required' });
    const unit = req.body?.unit != null ? String(req.body.unit).trim() : null;
    const description = req.body?.description != null ? String(req.body.description).trim() : null;
    const specs = Array.isArray(req.body?.specs) ? req.body.specs : [];
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;

    // itemCode/uniqueKey are app-specific; generate simple deterministic values.
    const id = crypto.randomUUID();
    const itemCode = `IT-${id.slice(0, 8).toUpperCase()}`;
    const specificationsJson = JSON.stringify(Object.fromEntries(specs.map((s) => [String(s.specificationId), String(s.value)])));
    const uniqueKey = `${itemNameId}:${sha256(specificationsJson).slice(0, 16)}`;

    await pool.query(
      'INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [id, itemNameId, itemCode, specificationsJson, uniqueKey, description, unit, createdBy]
    );

    const [rows] = await pool.query(
      `
      SELECT it.id, it.item_name_id AS itemNameId, it.item_code AS itemCode, n.name AS itemName,
             it.specifications_json AS specificationsJson, it.unique_key AS uniqueKey, it.description, it.unit
      FROM items it JOIN item_names n ON n.id=it.item_name_id WHERE it.id=?
      `,
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    res.status(201).json({ item: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/items/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const itemNameId = String(req.body?.itemNameId ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!itemNameId) return res.status(400).json({ error: 'itemNameId is required' });
    const unit = req.body?.unit != null ? String(req.body.unit).trim() : null;
    const description = req.body?.description != null ? String(req.body.description).trim() : null;
    const specs = Array.isArray(req.body?.specs) ? req.body.specs : [];
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    const specificationsJson = JSON.stringify(Object.fromEntries(specs.map((s) => [String(s.specificationId), String(s.value)])));
    const uniqueKey = `${itemNameId}:${sha256(specificationsJson).slice(0, 16)}`;
    await pool.query(
      'UPDATE items SET item_name_id=?, specifications_json=?, unique_key=?, description=?, unit=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [itemNameId, specificationsJson, uniqueKey, description, unit, updatedBy, id]
    );
    const [rows] = await pool.query(
      `
      SELECT it.id, it.item_name_id AS itemNameId, it.item_code AS itemCode, n.name AS itemName,
             it.specifications_json AS specificationsJson, it.unique_key AS uniqueKey, it.description, it.unit
      FROM items it JOIN item_names n ON n.id=it.item_name_id WHERE it.id=?
      `,
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'Item not found' });
    res.json({ item: row });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/items/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM items WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

function parseFiscalYearRange(label) {
  const raw = String(label ?? '').trim();
  const m = raw.match(/^(\d{4})-(\d{2}|\d{4})$/);
  if (!m) return null;
  const startYear = Number(m[1]);
  const endYear = m[2].length === 2 ? Number(String(startYear).slice(0, 2) + m[2]) : Number(m[2]);
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
  // India FY: Apr 1 -> Mar 31
  const start = `${startYear}-04-01`;
  const end = `${endYear}-03-31`;
  return { start, end };
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// --- Inventory (minimal) ---
app.get('/api/inventory/opening-balances', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const storeId = String(req.query.storeId ?? '').trim();
    const year = String(req.query.year ?? '2024-25').trim() || '2024-25';
    if (!storeId) return res.status(400).json({ error: 'storeId is required' });
    const [rows] = await pool.query(
      `
      SELECT item_id AS itemId, quantity AS quantity, reorder_level AS reorderLevel
      FROM item_opening_balances
      WHERE store_id = ? AND year = ?
      ORDER BY item_id
      `,
      [storeId, year]
    );
    const balances = (Array.isArray(rows) ? rows : []).map((r) => ({
      itemId: String(r.itemId ?? ''),
      quantity: num(r.quantity, 0),
      reorderLevel: num(r.reorderLevel, 0),
    }));
    res.json({ balances });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/inventory/opening-balances', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const storeId = String(req.body?.storeId ?? '').trim();
    const year = String(req.body?.year ?? '2024-25').trim() || '2024-25';
    const balances = Array.isArray(req.body?.balances) ? req.body.balances : [];
    if (!storeId) return res.status(400).json({ error: 'storeId is required' });

    // Upsert each row; keep it simple for now.
    for (const b of balances) {
      const itemId = String(b?.itemId ?? '').trim();
      if (!itemId) continue;
      const quantity = Math.max(0, num(b?.quantity, 0));
      const reorderLevel = Math.max(0, num(b?.reorderLevel, 0));

      // MySQL: insert or update
      await pool.query(
        `
        INSERT INTO item_opening_balances (id, store_id, item_id, quantity, reorder_level, year, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE quantity=VALUES(quantity), reorder_level=VALUES(reorder_level), updated_at=NOW()
        `,
        [crypto.randomUUID(), storeId, itemId, quantity, reorderLevel, year]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/inventory/sheet', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const firmId = String(req.query.firmId ?? '').trim();
    const year = String(req.query.year ?? '2024-25').trim() || '2024-25';
    if (!firmId) return res.status(400).json({ error: 'firmId is required' });

    const range = parseFiscalYearRange(year);
    if (!range) return res.status(400).json({ error: 'Invalid year. Expected format YYYY-YY (e.g. 2024-25).' });

    const [itemRows] = await pool.query(
      `
      SELECT
        it.id AS itemId,
        it.item_code AS itemCode,
        iname.name AS itemName,
        it.specifications_json AS specificationsJson,
        it.unit AS unit
      FROM items it
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      WHERE it.is_active = 1
      `
    );
    const itemById = new Map(
      (Array.isArray(itemRows) ? itemRows : []).map((r) => [
        String(r.itemId ?? ''),
        {
          itemCode: String(r.itemCode ?? ''),
          itemName: String(r.itemName ?? ''),
          specificationsJson: r.specificationsJson,
          unit: String(r.unit ?? ''),
        },
      ])
    );

    // Build per-store rows so the Inventory view can match store filters and transactions correctly.
    const [storeRows] = await pool.query('SELECT id AS storeId, name AS storeName FROM stores WHERE firm_id = ? ORDER BY name', [firmId]);
    const storeById = new Map(
      (Array.isArray(storeRows) ? storeRows : []).map((r) => [String(r.storeId ?? ''), String(r.storeName ?? '')])
    );

    const [aggRows] = await pool.query(
      `
      SELECT
        base.storeId,
        base.itemId,
        COALESCE(opening.opening, 0) AS opening,
        COALESCE(opening.reorderLevel, 0) AS reorderLevel,
        COALESCE(purchase.purchase, 0) AS purchase,
        COALESCE(issue.issueQty, 0) AS issueQty,
        COALESCE(damage.damageQty, 0) AS damageQty,
        COALESCE(tin.transferIn, 0) AS transferIn,
        COALESCE(tout.transferOut, 0) AS transferOut
      FROM (
        SELECT storeId, itemId FROM (
          SELECT iob.store_id AS storeId, iob.item_id AS itemId
          FROM item_opening_balances iob
          INNER JOIN stores st ON st.id = iob.store_id
          WHERE st.firm_id = ? AND iob.year = ?
          UNION
          SELECT g.store_id AS storeId, qc.item_id AS itemId
          FROM qc_records qc
          INNER JOIN grns g ON g.id = qc.grn_id
          WHERE g.firm_id = ? AND DATE(g.received_date) >= ? AND DATE(g.received_date) <= ?
          UNION
          SELECT iss.store_id AS storeId, iii.item_id AS itemId
          FROM item_issues iss
          INNER JOIN item_issue_items iii ON iii.issue_id = iss.id
          WHERE iss.firm_id = ? AND DATE(iss.created_at) >= ? AND DATE(iss.created_at) <= ?
          UNION
          SELECT d.store_id AS storeId, d.item_id AS itemId
          FROM damaged_items d
          WHERE d.firm_id = ? AND DATE(d.created_at) >= ? AND DATE(d.created_at) <= ?
          UNION
          SELECT t.to_store_id AS storeId, ti.item_id AS itemId
          FROM item_transfers t
          INNER JOIN item_transfer_items ti ON ti.transfer_id = t.id
          WHERE t.firm_id = ? AND DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?
          UNION
          SELECT t.from_store_id AS storeId, ti.item_id AS itemId
          FROM item_transfers t
          INNER JOIN item_transfer_items ti ON ti.transfer_id = t.id
          WHERE t.firm_id = ? AND DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?
        ) x
      ) base
      LEFT JOIN (
        SELECT iob.store_id AS storeId, iob.item_id AS itemId, SUM(iob.quantity) AS opening, MAX(iob.reorder_level) AS reorderLevel
        FROM item_opening_balances iob
        INNER JOIN stores st ON st.id = iob.store_id
        WHERE st.firm_id = ? AND iob.year = ?
        GROUP BY iob.store_id, iob.item_id
      ) opening ON opening.storeId = base.storeId AND opening.itemId = base.itemId
      LEFT JOIN (
        SELECT g.store_id AS storeId, qc.item_id AS itemId, SUM(qc.accepted_qty) AS purchase
        FROM qc_records qc
        INNER JOIN grns g ON g.id = qc.grn_id
        WHERE g.firm_id = ? AND DATE(g.received_date) >= ? AND DATE(g.received_date) <= ?
        GROUP BY g.store_id, qc.item_id
      ) purchase ON purchase.storeId = base.storeId AND purchase.itemId = base.itemId
      LEFT JOIN (
        SELECT iss.store_id AS storeId, iii.item_id AS itemId, SUM(iii.quantity) AS issueQty
        FROM item_issues iss
        INNER JOIN item_issue_items iii ON iii.issue_id = iss.id
        WHERE iss.firm_id = ? AND DATE(iss.created_at) >= ? AND DATE(iss.created_at) <= ?
        GROUP BY iss.store_id, iii.item_id
      ) issue ON issue.storeId = base.storeId AND issue.itemId = base.itemId
      LEFT JOIN (
        SELECT d.store_id AS storeId, d.item_id AS itemId, SUM(d.quantity) AS damageQty
        FROM damaged_items d
        WHERE d.firm_id = ? AND DATE(d.created_at) >= ? AND DATE(d.created_at) <= ?
        GROUP BY d.store_id, d.item_id
      ) damage ON damage.storeId = base.storeId AND damage.itemId = base.itemId
      LEFT JOIN (
        SELECT t.to_store_id AS storeId, ti.item_id AS itemId, SUM(ti.quantity) AS transferIn
        FROM item_transfers t
        INNER JOIN item_transfer_items ti ON ti.transfer_id = t.id
        WHERE t.firm_id = ? AND DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?
        GROUP BY t.to_store_id, ti.item_id
      ) tin ON tin.storeId = base.storeId AND tin.itemId = base.itemId
      LEFT JOIN (
        SELECT t.from_store_id AS storeId, ti.item_id AS itemId, SUM(ti.quantity) AS transferOut
        FROM item_transfers t
        INNER JOIN item_transfer_items ti ON ti.transfer_id = t.id
        WHERE t.firm_id = ? AND DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?
        GROUP BY t.from_store_id, ti.item_id
      ) tout ON tout.storeId = base.storeId AND tout.itemId = base.itemId
      `,
      [
        firmId,
        year,
        firmId,
        range.start,
        range.end,
        firmId,
        range.start,
        range.end,
        firmId,
        range.start,
        range.end,
        firmId,
        range.start,
        range.end,
        firmId,
        range.start,
        range.end,
        firmId,
        year,
        firmId,
        range.start,
        range.end,
        firmId,
        range.start,
        range.end,
        firmId,
        range.start,
        range.end,
        firmId,
        range.start,
        range.end,
        firmId,
        range.start,
        range.end,
      ]
    );

    const rows = (Array.isArray(aggRows) ? aggRows : []).map((r) => {
      const storeId = String(r.storeId ?? '');
      const itemId = String(r.itemId ?? '');
      const meta = itemById.get(itemId) ?? { itemCode: '', itemName: '', specificationsJson: '', unit: '' };
      const opening = num(r.opening, 0);
      const reorderLevel = num(r.reorderLevel, 0);
      const purchase = num(r.purchase, 0);
      const issue = num(r.issueQty, 0);
      const damage = num(r.damageQty, 0);
      const returns = 0;
      const transferIn = num(r.transferIn, 0);
      const transferOut = num(r.transferOut, 0);
      const balance = opening + purchase - issue - damage - returns + transferIn - transferOut;
      return {
        itemId,
        itemCode: meta.itemCode,
        itemName: meta.itemName,
        storeId,
        storeName: storeById.get(storeId) ?? '',
        transferIn,
        transferOut,
        specifications: (() => {
          try {
            const obj = typeof meta.specificationsJson === 'string' ? JSON.parse(meta.specificationsJson) : meta.specificationsJson;
            return obj ? JSON.stringify(obj) : '';
          } catch {
            return String(meta.specificationsJson ?? '');
          }
        })(),
        unit: meta.unit,
        opening,
        reorderLevel,
        purchase,
        issue,
        damage,
        returns,
        balance,
      };
    });

    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Invoices ---
async function handleCreateInvoice(req, res) {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'po id is required' });

    const supplierInvoiceNo = String(req.body?.supplierInvoiceNo ?? '').trim();
    const invoiceDate = String(req.body?.invoiceDate ?? '').trim();
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!supplierInvoiceNo) return res.status(400).json({ error: 'supplierInvoiceNo is required' });
    if (!invoiceDate) return res.status(400).json({ error: 'invoiceDate is required' });
    if (!items.length) return res.status(400).json({ error: 'At least one item is required' });

    const [[poRow]] = await pool.query('SELECT id, supplier_id AS supplierId FROM purchase_orders WHERE id = ?', [poId]);
    if (!poRow) return res.status(404).json({ error: 'PO not found' });
    const supplierId = String(poRow.supplierId ?? '').trim();
    if (!supplierId) return res.status(500).json({ error: 'PO is missing supplierId' });

    const courierCharge = Math.max(0, num(req.body?.courierCharge, 0));
    const packingCharge = Math.max(0, num(req.body?.packingCharge, 0));
    const labourCharge = Math.max(0, num(req.body?.labourCharge, 0));
    const otherCharge = Math.max(0, num(req.body?.otherCharge, 0));
    const chargesGstAmount = Math.max(0, num(req.body?.chargesGstAmount, 0));
    const documentUrl = req.body?.documentUrl != null ? String(req.body.documentUrl).trim() : null;
    const cnCopyUrl = req.body?.cnCopyUrl != null ? String(req.body.cnCopyUrl).trim() : null;
    const ewayBillNumber = req.body?.ewayBillNumber != null ? String(req.body.ewayBillNumber).trim() : null;
    const cnNumber = req.body?.cnNumber != null ? String(req.body.cnNumber).trim() : null;
    const courierNumber = req.body?.courierNumber != null ? String(req.body.courierNumber).trim() : null;
    const transporterName = req.body?.transporterName != null ? String(req.body.transporterName).trim() : null;

    const normalizedItems = items
      .map((it) => ({
        itemId: String(it?.itemId ?? '').trim(),
        quantity: Math.max(0, num(it?.quantity, 0)),
        rate: Math.max(0, num(it?.rate, 0)),
        taxPercent: Math.max(0, num(it?.taxPercent, 0)),
      }))
      .filter((it) => it.itemId && it.quantity > 0);
    if (!normalizedItems.length) return res.status(400).json({ error: 'No valid invoice items' });

    const goodsAmount = normalizedItems.reduce((sum, it) => sum + it.quantity * it.rate, 0);
    const taxAmount = normalizedItems.reduce((sum, it) => sum + (it.quantity * it.rate * it.taxPercent) / 100, 0);
    const itemTotal = goodsAmount + taxAmount;
    const extraCharges = courierCharge + packingCharge + labourCharge + otherCharge;
    const computedTotal = itemTotal + extraCharges + chargesGstAmount;
    const invoiceAmountInput = req.body?.invoiceAmount != null ? num(req.body.invoiceAmount, computedTotal) : computedTotal;
    const invoiceAmount = Math.max(0, invoiceAmountInput);

    const invoiceId = crypto.randomUUID();
    await pool.query(
      `
      INSERT INTO invoices (
        id, po_id, supplier_id,
        invoice_number, invoice_date,
        goods_amount, tax_amount, total_amount,
        courier_charge, packing_charge, labour_charge, other_charge, charges_gst_amount,
        payment_status, payment_date,
        status,
        document_url, cn_copy_url,
        eway_bill_number, cn_number, courier_number, transporter_name,
        created_by, created_at, updated_by, updated_at
      ) VALUES (
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        NULL, NULL,
        'pending',
        ?, ?,
        ?, ?, ?, ?,
        ?, NOW(), ?, NOW()
      )
      `,
      [
        invoiceId,
        poId,
        supplierId,
        supplierInvoiceNo,
        invoiceDate,
        goodsAmount,
        taxAmount,
        invoiceAmount,
        courierCharge,
        packingCharge,
        labourCharge,
        otherCharge,
        chargesGstAmount,
        documentUrl,
        cnCopyUrl,
        ewayBillNumber,
        cnNumber,
        courierNumber,
        transporterName,
        updatedBy,
        updatedBy,
      ]
    );

    for (const it of normalizedItems) {
      await pool.query(
        `
        INSERT INTO invoice_items (id, invoice_id, item_id, quantity, rate, tax_percent, created_by, created_at, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW())
        ON DUPLICATE KEY UPDATE quantity=VALUES(quantity), rate=VALUES(rate), tax_percent=VALUES(tax_percent), updated_by=VALUES(updated_by), updated_at=NOW()
        `,
        [
          crypto.randomUUID(),
          invoiceId,
          it.itemId,
          it.quantity,
          it.rate,
          it.taxPercent,
          updatedBy,
          updatedBy,
        ]
      );
    }

    res.json({
      invoice: {
        invoice: {
          id: invoiceId,
          poId,
          supplierInvoiceNo,
          invoiceDate: toIsoDate(invoiceDate) || invoiceDate,
          invoiceAmount,
          courierCharge,
          packingCharge,
          labourCharge,
          otherCharge,
          chargesGstAmount,
          status: 'Recorded',
          documentUrl: documentUrl || undefined,
          cnCopyUrl: cnCopyUrl || undefined,
          ewayBillNumber: ewayBillNumber || undefined,
          cnNumber: cnNumber || undefined,
          courierNumber: courierNumber || undefined,
          transporterName: transporterName || undefined,
          createdBy: updatedBy || undefined,
          createdAt: new Date().toISOString(),
          updatedBy: updatedBy || undefined,
          updatedAt: new Date().toISOString(),
        },
        items: normalizedItems.map((it) => ({
          invoiceId,
          id: '',
          itemId: it.itemId,
          item: it.itemId,
          quantity: it.quantity,
          rate: it.rate,
          taxPercent: it.taxPercent,
        })),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// Support both singular and plural for older cached frontends.
app.post('/api/pos/:id/invoice', handleCreateInvoice);
app.post('/api/pos/:id/invoices', handleCreateInvoice);

app.put('/api/invoices/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'invoice id is required' });

    const supplierInvoiceNo = String(req.body?.supplierInvoiceNo ?? '').trim();
    const invoiceDate = String(req.body?.invoiceDate ?? '').trim();
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!supplierInvoiceNo) return res.status(400).json({ error: 'supplierInvoiceNo is required' });
    if (!invoiceDate) return res.status(400).json({ error: 'invoiceDate is required' });
    if (!items.length) return res.status(400).json({ error: 'At least one item is required' });

    const courierCharge = Math.max(0, num(req.body?.courierCharge, 0));
    const packingCharge = Math.max(0, num(req.body?.packingCharge, 0));
    const labourCharge = Math.max(0, num(req.body?.labourCharge, 0));
    const otherCharge = Math.max(0, num(req.body?.otherCharge, 0));
    const chargesGstAmount = Math.max(0, num(req.body?.chargesGstAmount, 0));

    const normalizedItems = items
      .map((it) => ({
        itemId: String(it?.itemId ?? '').trim(),
        quantity: Math.max(0, num(it?.quantity, 0)),
        rate: Math.max(0, num(it?.rate, 0)),
        taxPercent: Math.max(0, num(it?.taxPercent, 0)),
      }))
      .filter((it) => it.itemId && it.quantity > 0);
    if (!normalizedItems.length) return res.status(400).json({ error: 'No valid invoice items' });

    const goodsAmount = normalizedItems.reduce((sum, it) => sum + it.quantity * it.rate, 0);
    const taxAmount = normalizedItems.reduce((sum, it) => sum + (it.quantity * it.rate * it.taxPercent) / 100, 0);
    const itemTotal = goodsAmount + taxAmount;
    const extraCharges = courierCharge + packingCharge + labourCharge + otherCharge;
    const computedTotal = itemTotal + extraCharges + chargesGstAmount;
    const invoiceAmountInput = req.body?.invoiceAmount != null ? num(req.body.invoiceAmount, computedTotal) : computedTotal;
    const invoiceAmount = Math.max(0, invoiceAmountInput);

    await pool.query(
      `
      UPDATE invoices
      SET invoice_number=?, invoice_date=?, goods_amount=?, tax_amount=?, total_amount=?,
          courier_charge=?, packing_charge=?, labour_charge=?, other_charge=?, charges_gst_amount=?,
          updated_by=?, updated_at=NOW()
      WHERE id=?
      `,
      [
        supplierInvoiceNo,
        invoiceDate,
        goodsAmount,
        taxAmount,
        invoiceAmount,
        courierCharge,
        packingCharge,
        labourCharge,
        otherCharge,
        chargesGstAmount,
        updatedBy,
        invoiceId,
      ]
    );

    for (const it of normalizedItems) {
      await pool.query(
        `
        INSERT INTO invoice_items (id, invoice_id, item_id, quantity, rate, tax_percent, created_by, created_at, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW())
        ON DUPLICATE KEY UPDATE quantity=VALUES(quantity), rate=VALUES(rate), tax_percent=VALUES(tax_percent), updated_by=VALUES(updated_by), updated_at=NOW()
        `,
        [
          crypto.randomUUID(),
          invoiceId,
          it.itemId,
          it.quantity,
          it.rate,
          it.taxPercent,
          updatedBy,
          updatedBy,
        ]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'invoice id is required' });
    await pool.query('DELETE FROM invoices WHERE id=?', [invoiceId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/invoices/:id/payment', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'invoice id is required' });
    const paymentStatus = String(req.body?.paymentStatus ?? '').trim();
    const paymentDate = String(req.body?.paymentDate ?? '').trim();
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || null;
    if (!paymentStatus) return res.status(400).json({ error: 'paymentStatus is required' });
    if (!paymentDate) return res.status(400).json({ error: 'paymentDate is required' });
    await pool.query(
      `UPDATE invoices SET payment_status=?, payment_date=?, updated_by=?, updated_at=NOW() WHERE id=?`,
      [paymentStatus, paymentDate, updatedBy, invoiceId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/invoices/:id/logistics', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'invoice id is required' });
    const dispatchProof = String(req.body?.dispatchProof ?? '').trim();
    const cnOrCourierNo = String(req.body?.cnOrCourierNo ?? '').trim();
    const transporterName = String(req.body?.transporterName ?? '').trim();
    if (!dispatchProof) return res.status(400).json({ error: 'dispatchProof is required' });
    if (!cnOrCourierNo) return res.status(400).json({ error: 'cnOrCourierNo is required' });
    if (!transporterName) return res.status(400).json({ error: 'transporterName is required' });

    await pool.query(
      `
      UPDATE invoices
      SET cn_copy_url=?, transporter_name=?, cn_number=?, courier_number=?, updated_at=NOW()
      WHERE id=?
      `,
      [dispatchProof, transporterName, cnOrCourierNo, cnOrCourierNo, invoiceId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.use(express.static(distDir, { index: false }));

// Ensure missing API routes don't fall back to SPA HTML (which breaks JSON parsing in the client).
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// SPA fallback (React Router / client-side routes).
app.use((_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  // Keep log simple for Hostinger runtime logs.
  console.log(`Server listening on port ${port}`);
});
