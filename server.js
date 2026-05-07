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

app.use(express.static(distDir, { index: false }));

// SPA fallback (React Router / client-side routes).
app.use((_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  // Keep log simple for Hostinger runtime logs.
  console.log(`Server listening on port ${port}`);
});
