import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Hostinger (and many Node hosts) inject PORT.
const port = Number(process.env.PORT || 3000);

const distDir = path.join(__dirname, 'dist');

app.use(express.json({ limit: '2mb' }));

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
        pr.firm_id AS firmId,
        pr.project_id AS projectId,
        proj.name AS projectName,
        pr.requested_by AS requestedBy,
        pr.created_at AS requisitionDate,
        pr.request_type AS requestType,
        pr.status AS status,
        MIN(pri.required_date) AS requiredDate
      FROM purchase_requisitions pr
      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
      LEFT JOIN projects proj ON proj.id = pr.project_id
      GROUP BY pr.id
      ORDER BY pr.created_at DESC
      `
    );

    const requests = (rows || []).map((r) => ({
      id: String(r.id),
      firmId: String(r.firmId),
      store: null,
      projectId: r.projectId ? String(r.projectId) : null,
      projectName: r.projectName ? String(r.projectName) : null,
      department: 'N/A',
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
      FROM item_names
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

app.use(express.static(distDir, { index: false }));

// SPA fallback (React Router / client-side routes).
app.use((_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  // Keep log simple for Hostinger runtime logs.
  console.log(`Server listening on port ${port}`);
});
