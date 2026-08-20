import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Hostinger (and many Node hosts) inject PORT.
const port = Number(process.env.PORT || 3000);

// Hostinger runs server.js from a `nodejs` subdirectory while preserving the
// Vite build output one directory above it. Locally, dist is beside server.js.
const distCandidates = [
  path.join(__dirname, 'dist'),
  path.resolve(__dirname, '..', 'dist'),
  path.resolve(process.cwd(), 'dist'),
  path.resolve(process.cwd(), '..', 'dist'),
  // Hostinger's managed web-app runtime can publish declared output under
  // the domain's public_html directory instead of the nodejs directory.
  path.resolve(__dirname, '..', '..', '..', '..', 'public_html', 'dist'),
  path.resolve(__dirname, '..', '..', '..', '..', 'public_html'),
];
const distDir = distCandidates.find((candidate) => existsSync(path.join(candidate, 'index.html'))) ?? distCandidates[0];
const uploadsDir = path.join(__dirname, 'uploads');

// Uploads and large payloads (PDF base64) can exceed 2mb.
app.use(express.json({ limit: '25mb' }));

app.use('/uploads', express.static(uploadsDir, { index: false }));

app.get('/api/uploads/:fileName', async (req, res) => {
  try {
    const fileName = decodeURIComponent(String(req.params.fileName ?? '')).replace(/[\\/]/g, '');
    if (!fileName) return res.status(400).send('fileName is required');
    const filePath = path.join(uploadsDir, fileName);
    const resolved = path.resolve(filePath);
    const uploadsRoot = path.resolve(uploadsDir);
    if (!resolved.startsWith(`${uploadsRoot}${path.sep}`)) return res.status(400).send('Invalid fileName');
    await fs.access(resolved);
    res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`);
    res.sendFile(resolved);
  } catch {
    res.status(404).send('File not found');
  }
});

// Lightweight process-level health check (no DB dependency).
app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'ims-umang',
    timestamp: new Date().toISOString(),
  });
});

let mysqlPool = null;
const SPEC_VALUE_REPAIR_INTERVAL_MS = 30 * 60 * 1000;
let specValueRepairRunning = false;

async function repairMissingItemSpecificationValues(pool, { itemId = '' } = {}) {
  if (!pool) return { specificationValuesCreated: 0, mappingsCreated: 0 };
  const params = [];
  let itemFilter = '';
  if (itemId) {
    itemFilter = 'AND it.id = ?';
    params.push(itemId);
  }
  const [rows] = await pool.query(
    `SELECT it.id, it.item_name_id AS itemNameId, it.specifications_json AS specificationsJson
     FROM items it
     WHERE it.item_name_id IS NOT NULL AND JSON_VALID(it.specifications_json) ${itemFilter}`,
    params
  );
  let specificationValuesCreated = 0;
  let mappingsCreated = 0;
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const itemNameId = String(row.itemNameId ?? '').trim();
    if (!itemNameId) continue;
    let specifications = row.specificationsJson;
    if (typeof specifications === 'string') {
      try { specifications = JSON.parse(specifications); } catch { continue; }
    }
    if (!specifications || Array.isArray(specifications) || typeof specifications !== 'object') continue;
    for (const [rawSpecificationId, rawValue] of Object.entries(specifications)) {
      const specificationId = String(rawSpecificationId ?? '').trim();
      const value = String(rawValue ?? '').trim();
      const normalizedValue = value.toLowerCase();
      if (!specificationId || !value) continue;
      const key = `${itemNameId}\u0000${specificationId}\u0000${normalizedValue}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [mappingResult] = await pool.query(
        'INSERT IGNORE INTO item_name_specifications (item_name_id, specification_id, created_at) VALUES (?, ?, NOW())',
        [itemNameId, specificationId]
      );
      mappingsCreated += Number(mappingResult?.affectedRows ?? 0);
      const [existingRows] = await pool.query(
        `SELECT id
         FROM specification_values
         WHERE specification_id = ?
           AND COALESCE(NULLIF(TRIM(item_name_id), ''), '') = COALESCE(NULLIF(TRIM(?), ''), '')
           AND LOWER(TRIM(value)) = ?
         LIMIT 1`,
        [specificationId, itemNameId, normalizedValue]
      );
      if (Array.isArray(existingRows) && existingRows.length > 0) continue;
      const [valueResult] = await pool.query(
        `INSERT INTO specification_values
           (id, specification_id, item_name_id, value, is_active, created_by, created_at, updated_at)
         SELECT ?, ?, ?, ?, 1, 'system-item-repair', NOW(), NOW()
         FROM DUAL
         WHERE NOT EXISTS (
           SELECT 1
           FROM specification_values
           WHERE specification_id = ?
             AND COALESCE(NULLIF(TRIM(item_name_id), ''), '') = COALESCE(NULLIF(TRIM(?), ''), '')
             AND LOWER(TRIM(value)) = ?
         )`,
        [crypto.randomUUID(), specificationId, itemNameId, value, specificationId, itemNameId, normalizedValue]
      );
      specificationValuesCreated += Number(valueResult?.affectedRows ?? 0);
    }
  }
  return { specificationValuesCreated, mappingsCreated };
}

async function runScheduledSpecValueRepair() {
  if (specValueRepairRunning) return;
  const pool = getMysqlPool();
  if (!pool) return;
  specValueRepairRunning = true;
  try {
    const result = await repairMissingItemSpecificationValues(pool);
    if (result.specificationValuesCreated || result.mappingsCreated) {
      console.log('Repaired missing item specification data:', result);
    }
  } catch (e) {
    console.error('Unable to repair missing item specification data:', e);
  } finally {
    specValueRepairRunning = false;
  }
}
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

  // Ensure stock transaction tables and columns exist
  (async () => {
    try {
      const pool = mysqlPool;
      const tables = ['item_issues', 'item_returns', 'item_damages', 'item_transfers'];
      for (const t of tables) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ${t} (
            id VARCHAR(255) PRIMARY KEY,
            transaction_no VARCHAR(255),
            firm_id VARCHAR(255),
            store VARCHAR(255),
            store_id VARCHAR(255),
            department VARCHAR(255),
            person VARCHAR(255),
            return_by VARCHAR(255),
            date DATE,
            issue_type VARCHAR(255),
            issued_to VARCHAR(255),
            return_type VARCHAR(255),
            customer_name VARCHAR(255),
            approved_by VARCHAR(255),
            to_firm_id VARCHAR(255),
            to_store VARCHAR(255),
            to_store_id VARCHAR(255),
            to_department VARCHAR(255),
            project_id VARCHAR(255),
            created_at DATETIME,
            updated_at DATETIME
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        const itemsTable = t.endsWith('s') ? t.slice(0, -1) + '_items' : t + '_items';
        const kind = t.includes('issue') ? 'issue' : t.includes('return') ? 'return' : t.includes('damage') ? 'damage' : 'transfer';

        await pool.query(`
          CREATE TABLE IF NOT EXISTS ${itemsTable} (
            id VARCHAR(255) PRIMARY KEY,
            ${kind}_id VARCHAR(255),
            item_id VARCHAR(255),
            item_name VARCHAR(255),
            quantity DOUBLE,
            specification TEXT,
            remark TEXT,
            created_at DATETIME,
            FOREIGN KEY (${kind}_id) REFERENCES ${t}(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Add missing columns to existing tables if needed
        const [cols] = await pool.query(`SHOW COLUMNS FROM ${t}`);
        const colNames = cols.map(c => c.Field);
        const needed = [
          ['transaction_no', 'VARCHAR(255)'],
          ['store', 'VARCHAR(255)'],
          ['store_id', 'VARCHAR(255)'],
          ['department', 'VARCHAR(255)'],
          ['person', 'VARCHAR(255)'],
          ['return_by', 'VARCHAR(255)'],
          ['date', 'DATE'],
          ['issue_type', 'VARCHAR(255)'],
          ['issued_to', 'VARCHAR(255)'],
          ['return_type', 'VARCHAR(255)'],
          ['customer_name', 'VARCHAR(255)'],
          ['approved_by', 'VARCHAR(255)'],
          ['to_firm_id', 'VARCHAR(255)'],
          ['to_store', 'VARCHAR(255)'],
          ['to_store_id', 'VARCHAR(255)'],
          ['to_department', 'VARCHAR(255)'],
          ['project_id', 'VARCHAR(255)'],
        ];
        for (const [name, def] of needed) {
          if (!colNames.includes(name)) {
            await pool.query(`ALTER TABLE ${t} ADD COLUMN ${name} ${def}`);
          }
        }

        const [itemCols] = await pool.query(`SHOW COLUMNS FROM ${itemsTable}`);
        const itemColNames = new Set(itemCols.map((c) => c.Field));
        if (!itemColNames.has('item_id')) {
          await pool.query(`ALTER TABLE ${itemsTable} ADD COLUMN item_id VARCHAR(255) AFTER ${kind}_id`);
          itemColNames.add('item_id');
        }
        if (!itemColNames.has('item_name')) {
          await pool.query(`ALTER TABLE ${itemsTable} ADD COLUMN item_name VARCHAR(255) AFTER item_id`);
          itemColNames.add('item_name');
        }

        // Special fix for item_issues.issue_type_id foreign key constraint
        if (t === 'item_issues' && colNames.includes('issue_type_id')) {
          try {
            await pool.query(`ALTER TABLE item_issues MODIFY COLUMN issue_type_id VARCHAR(255) NULL`);
          } catch (e) {
            console.error('Failed to make issue_type_id nullable:', e);
          }
        }

        if (!itemColNames.has('specification')) {
          await pool.query(`ALTER TABLE ${itemsTable} ADD COLUMN specification TEXT`);
          itemColNames.add('specification');
        }
        if (!itemColNames.has('remark')) {
          await pool.query(`ALTER TABLE ${itemsTable} ADD COLUMN remark TEXT`);
          itemColNames.add('remark');
        }
      }
    } catch (err) {
      console.error('Failed to ensure stock tables:', err);
    }
  })();

  (async () => {
    try {
      const pool = mysqlPool;
	      const ensureColumn = async (table, name, def) => {
	        const [rows] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [name]);
	        if (!Array.isArray(rows) || !rows.length) {
	          await pool.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
	        }
	      };
      const ensureNonUniqueIndex = async (table, indexName, columns) => {
	        try {
	          const [rows] = await pool.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
	          if (!Array.isArray(rows) || !rows.length) {
	            await pool.query(`ALTER TABLE ${table} ADD INDEX ${indexName} (${columns.join(', ')})`);
	          }
	        } catch (e) {
	          const msg = e instanceof Error ? e.message : String(e);
	          if (!msg.toLowerCase().includes('duplicate')) throw e;
	        }
	      };

      await pool.query(`
        CREATE TABLE IF NOT EXISTS couriers (
          id VARCHAR(255) PRIMARY KEY,
          courier_date DATE NOT NULL,
          courier_no VARCHAR(255) NOT NULL,
          courier_company VARCHAR(255) NULL,
          supplier_id VARCHAR(255) NOT NULL,
          project_id VARCHAR(255) NULL,
          po_id VARCHAR(255) NULL,
          courier_copy_url LONGTEXT NULL,
          expected_date DATE NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'In Progress',
          last_update_date DATE NULL,
          last_update_by VARCHAR(255) NULL,
          last_update_remarks TEXT NULL,
          created_by VARCHAR(255) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_couriers_status (status),
          KEY idx_couriers_supplier_id (supplier_id),
          KEY idx_couriers_project_id (project_id),
          KEY idx_couriers_po_id (po_id)
        )
      `);
      await ensureColumn('couriers', 'courier_company', 'VARCHAR(255) NULL');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS courier_updates (
          id VARCHAR(255) PRIMARY KEY,
          courier_id VARCHAR(255) NOT NULL,
          update_date DATE NOT NULL,
          updated_by VARCHAR(255) NOT NULL,
          status VARCHAR(32) NOT NULL,
          remarks TEXT NULL,
          update_photo_url LONGTEXT NULL,
          received_by VARCHAR(255) NULL,
          received_date DATE NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_courier_updates_courier_id (courier_id),
          KEY idx_courier_updates_update_date (update_date)
        )
      `);
      await ensureColumn('courier_updates', 'update_photo_url', 'LONGTEXT NULL');
      await ensureColumn('courier_updates', 'received_by', 'VARCHAR(255) NULL');
      await ensureColumn('courier_updates', 'received_date', 'DATE NULL');
      const dropUniqueIndexesForExactColumns = async (table, columnSets) => {
	        const [rows] = await pool.query(`SHOW INDEX FROM ${table}`);
	        const byName = new Map();
	        for (const r of Array.isArray(rows) ? rows : []) {
	          const keyName = String(r.Key_name ?? '').trim();
	          if (!keyName || keyName === 'PRIMARY') continue;
	          const nonUnique = Number(r.Non_unique ?? 1);
	          if (nonUnique !== 0) continue;
	          if (!byName.has(keyName)) byName.set(keyName, []);
	          byName.get(keyName).push({
	            seq: Number(r.Seq_in_index ?? 0),
	            column: String(r.Column_name ?? '').trim(),
	          });
	        }
	        for (const [keyName, parts] of byName.entries()) {
	          const cols = parts
	            .slice()
	            .sort((a, b) => a.seq - b.seq)
	            .map((p) => p.column)
	            .filter(Boolean);
	          const shouldDrop = columnSets.some((set) => set.length === cols.length && set.every((col, idx) => cols[idx] === col));
	          if (!shouldDrop) continue;
	          try {
	            await pool.query(`ALTER TABLE ${table} DROP INDEX ${keyName}`);
	          } catch (e) {
	            console.error(`Unable to drop unique index ${table}.${keyName}:`, e);
	          }
	        }
	      };

      await pool.query(`
        CREATE TABLE IF NOT EXISTS gst_rates (
          id VARCHAR(255) PRIMARY KEY,
          rate DOUBLE UNIQUE NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          created_by VARCHAR(255)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await ensureColumn('purchase_orders', 'advance_amount', 'DOUBLE NOT NULL DEFAULT 0');
      await ensureColumn('purchase_orders', 'advance_date', 'DATE NULL');
      await ensureColumn('purchase_orders', 'firm_gst_number', 'VARCHAR(255) NULL');
      await ensureColumn('purchase_orders', 'payment_type', 'VARCHAR(32) NULL');
      await ensureColumn('purchase_orders', 'payment_mode', 'VARCHAR(32) NULL');
	      await ensureColumn('purchase_orders', 'cancel_reason', 'TEXT NULL');
	      await ensureColumn('purchase_orders', 'cancelled_by', 'VARCHAR(255) NULL');
	      await ensureColumn('purchase_orders', 'cancelled_at', 'DATETIME NULL');
	      await ensureColumn('purchase_orders', 'draft_payload', 'LONGTEXT NULL');
	      await ensureColumn('purchase_orders', 'po_source', "VARCHAR(16) NULL");
	      await ensureColumn('purchase_orders', 'requested_by', 'VARCHAR(255) NULL');
	      await ensureColumn('purchase_orders', 'required_date', 'DATE NULL');
	      await ensureColumn('purchase_orders', 'remarks', 'TEXT NULL');

	      const tryAlterNullable = async (table, column, def) => {
	        try {
	          await pool.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${def}`);
	        } catch (e) {
	          console.error(`Unable to alter ${table}.${column}:`, e);
	        }
	      };
	      await tryAlterNullable('purchase_orders', 'firm_id', 'VARCHAR(255) NULL');
	      await tryAlterNullable('purchase_orders', 'store_id', 'VARCHAR(255) NULL');
	      await tryAlterNullable('purchase_orders', 'project_id', 'VARCHAR(255) NULL');
	      await tryAlterNullable('purchase_orders', 'supplier_id', 'VARCHAR(255) NULL');
	      await tryAlterNullable('purchase_orders', 'pr_id', 'VARCHAR(255) NULL');
	      await tryAlterNullable('purchase_orders', 'order_date', 'DATE NULL');

	      await ensureColumn('purchase_order_items', 'cancelled_qty', 'DOUBLE NOT NULL DEFAULT 0');
	      await ensureColumn('purchase_order_items', 'cancel_reason', 'TEXT NULL');
	      await ensureNonUniqueIndex('purchase_order_items', 'idx_poi_po_id', ['po_id']);
	      await ensureNonUniqueIndex('purchase_order_items', 'idx_poi_item_id', ['item_id']);
	      await dropUniqueIndexesForExactColumns('purchase_order_items', [
	        ['po_id'],
	        ['po_id', 'item_id'],
	      ]);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS po_advances (
          id VARCHAR(255) PRIMARY KEY,
          po_id VARCHAR(255) NOT NULL,
          advance_date DATE NOT NULL,
          advance_amount DOUBLE NOT NULL DEFAULT 0,
          payment_mode VARCHAR(32) NULL,
          payment_copy TEXT NULL,
          remarks TEXT NULL,
          created_by VARCHAR(255) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS po_advance_invoice_adjustments (
          id VARCHAR(255) PRIMARY KEY,
          po_id VARCHAR(255) NOT NULL,
          invoice_id VARCHAR(255) NOT NULL,
          adjusted_amount DOUBLE NOT NULL DEFAULT 0,
          entry_key VARCHAR(64) NULL,
          payment_mode VARCHAR(32) NULL,
          payment_copy TEXT NULL,
          created_by VARCHAR(255) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_by VARCHAR(255) NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_po (po_id),
          KEY idx_invoice_id (invoice_id),
          FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await ensureColumn('po_advances', 'payment_mode', 'VARCHAR(32) NULL');
      await ensureColumn('po_advances', 'payment_copy', 'TEXT NULL');
      await ensureColumn('po_advances', 'remarks', 'TEXT NULL');
      await ensureColumn('po_advance_invoice_adjustments', 'payment_mode', 'VARCHAR(32) NULL');
      await ensureColumn('po_advance_invoice_adjustments', 'payment_copy', 'TEXT NULL');
      await ensureColumn('po_advance_invoice_adjustments', 'receipt_type', "VARCHAR(32) NOT NULL DEFAULT 'ADVANCE_ADJUSTMENT'");
      await ensureColumn('po_advance_invoice_adjustments', 'reference_type', "VARCHAR(32) NULL");
      await ensureColumn('po_advance_invoice_adjustments', 'entry_key', 'VARCHAR(64) NULL');
      try {
        await pool.query('ALTER TABLE po_advance_invoice_adjustments MODIFY COLUMN invoice_id VARCHAR(255) NULL');
      } catch (e) {
        console.error('Unable to modify po_advance_invoice_adjustments.invoice_id:', e);
      }
      try {
        const [idxRows] = await pool.query('SHOW INDEX FROM po_advance_invoice_adjustments');
        const indexNames = new Set((Array.isArray(idxRows) ? idxRows : []).map((r) => String(r.Key_name ?? '')));
        // Some MySQL installs require a supporting index for the invoice_id foreign key.
        // If uniq_invoice exists and is used for that FK, drop FK first, then replace with a non-unique index.
        if (indexNames.has('uniq_invoice')) {
          try {
            const [fkRows] = await pool.query(
              `
              SELECT CONSTRAINT_NAME AS name
              FROM information_schema.KEY_COLUMN_USAGE
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'po_advance_invoice_adjustments'
                AND COLUMN_NAME = 'invoice_id'
                AND REFERENCED_TABLE_NAME IS NOT NULL
              `,
            );
            const fkName = Array.isArray(fkRows) && fkRows.length ? String(fkRows[0].name ?? '') : '';
            if (fkName) {
              await pool.query(`ALTER TABLE po_advance_invoice_adjustments DROP FOREIGN KEY ${fkName}`);
            }
          } catch (e) {
            console.error('Unable to drop invoice_id FK before dropping uniq_invoice:', e);
          }

          try {
            await pool.query('ALTER TABLE po_advance_invoice_adjustments DROP INDEX uniq_invoice');
          } catch (e) {
            console.error('Unable to drop uniq_invoice index:', e);
          }

          // Ensure a non-unique index exists for the FK.
          try {
            await pool.query('ALTER TABLE po_advance_invoice_adjustments ADD KEY idx_invoice_id (invoice_id)');
          } catch {}

          // Re-add the invoice_id foreign key with a stable name.
          try {
            await pool.query(
              `
              ALTER TABLE po_advance_invoice_adjustments
              ADD CONSTRAINT fk_pai_invoice_id
              FOREIGN KEY (invoice_id) REFERENCES invoices(id)
              ON DELETE CASCADE
              `,
            );
          } catch (e) {
            // If it already exists (or host disallows FK DDL), ignore.
            const msg = e instanceof Error ? e.message : String(e);
            if (!msg.toLowerCase().includes('duplicate') && !msg.toLowerCase().includes('already exists')) {
              console.error('Unable to re-add invoice_id FK:', e);
            }
          }
        }
        if (indexNames.has('uniq_invoice_receipt_type')) {
          await pool.query('ALTER TABLE po_advance_invoice_adjustments DROP INDEX uniq_invoice_receipt_type');
        }
        if (!indexNames.has('idx_invoice_id')) {
          await pool.query('ALTER TABLE po_advance_invoice_adjustments ADD KEY idx_invoice_id (invoice_id)');
        }
        if (!indexNames.has('idx_invoice_receipt_type')) {
          await pool.query('ALTER TABLE po_advance_invoice_adjustments ADD KEY idx_invoice_receipt_type (invoice_id, receipt_type)');
        }
      } catch (e) {
        console.error('Unable to update po_advance_invoice_adjustments indexes:', e);
      }
      try {
        await pool.query(`
          UPDATE po_advance_invoice_adjustments a
          INNER JOIN purchase_orders po ON po.id = a.po_id
          SET a.receipt_type = 'DIRECT_PAYMENT'
          WHERE a.receipt_type = 'ADVANCE_ADJUSTMENT'
            AND COALESCE(a.adjusted_amount, 0) > COALESCE(po.advance_amount, 0)
        `);
      } catch (e) {
        console.error('Unable to normalize oversized advance adjustments:', e);
      }

      await ensureColumn('invoices', 'payment_mode', "VARCHAR(16) NOT NULL DEFAULT 'Credit'");
      await ensureColumn('invoices', 'payment_amount', 'DOUBLE NOT NULL DEFAULT 0');
      await ensureColumn('invoices', 'tally_entry_date', 'DATE NULL');
      await ensureColumn('invoices', 'approved_by', 'VARCHAR(255) NULL');
      await ensureColumn('invoices', 'approved_at', 'DATETIME NULL');
      await ensureColumn('invoices', 'eway_bill_url', 'TEXT NULL');
      await ensureColumn('invoices', 'debit_note_qty', 'DOUBLE NOT NULL DEFAULT 0');
      await ensureColumn('invoices', 'debit_note_amount', 'DOUBLE NOT NULL DEFAULT 0');
      await ensureColumn('invoices', 'debit_note_reason', 'TEXT NULL');

      await ensureColumn('users', 'login_id', 'VARCHAR(255) NULL');
      await ensureColumn('users', 'menu_access', 'TEXT NULL');
      await ensureColumn('users', 'is_deleted', 'TINYINT NOT NULL DEFAULT 0');
      await ensureColumn('users', 'deleted_at', 'DATETIME NULL');
      await ensureColumn('users', 'deleted_by', 'VARCHAR(255) NULL');
      await ensureColumn('purchase_requisition_items', 'priority_id', 'VARCHAR(255) NULL');

      // Area-unit dimensions (Sq Ft / Sq Mtr) for PR → Approval → PO → GRN → Invoice workflows.
      await ensureColumn('purchase_requisition_items', 'dim_length', 'DOUBLE NULL');
      await ensureColumn('purchase_requisition_items', 'dim_breadth', 'DOUBLE NULL');
      await ensureColumn('purchase_requisition_items', 'dim_pcs', 'INT NULL');
      await ensureColumn('purchase_requisition_items', 'dim_unit', 'VARCHAR(8) NULL');
      await ensureColumn('purchase_requisition_items', 'approved_dim_length', 'DOUBLE NULL');
	      await ensureColumn('purchase_requisition_items', 'approved_dim_breadth', 'DOUBLE NULL');
	      await ensureColumn('purchase_requisition_items', 'approved_dim_pcs', 'INT NULL');
	      await ensureColumn('purchase_requisition_items', 'approved_dim_unit', 'VARCHAR(8) NULL');
	      await ensureNonUniqueIndex('purchase_requisition_items', 'idx_pri_pr_id', ['pr_id']);
	      await ensureNonUniqueIndex('purchase_requisition_items', 'idx_pri_item_id', ['item_id']);
	      await dropUniqueIndexesForExactColumns('purchase_requisition_items', [
	        ['pr_id'],
	        ['pr_id', 'item_id'],
	      ]);

	      await ensureColumn('purchase_order_items', 'dim_length', 'DOUBLE NULL');
	      await ensureColumn('purchase_order_items', 'dim_breadth', 'DOUBLE NULL');
	      await ensureColumn('purchase_order_items', 'dim_pcs', 'INT NULL');
	      await ensureColumn('purchase_order_items', 'dim_unit', 'VARCHAR(8) NULL');
	      await ensureColumn('purchase_order_items', 'remarks', 'TEXT NULL');
	      await ensureColumn('purchase_order_items', 'description', 'TEXT NULL');
	      await ensureColumn('purchase_order_items', 'line_order', 'INT NULL');
	      await ensureNonUniqueIndex('purchase_order_items', 'idx_poi_po_line_order', ['po_id', 'line_order']);
	      await pool.query(`
	        UPDATE purchase_order_items poi
	        INNER JOIN (
	          SELECT id, ROW_NUMBER() OVER (PARTITION BY po_id ORDER BY created_at ASC, id ASC) AS rn
	          FROM purchase_order_items
	          WHERE line_order IS NULL
	        ) ranked ON ranked.id = poi.id
	        SET poi.line_order = ranked.rn
	      `).catch((e) => console.error('Unable to backfill purchase_order_items line order:', e));

      await ensureColumn('grn_items', 'recv_dim_length', 'DOUBLE NULL');
      await ensureColumn('grn_items', 'recv_dim_breadth', 'DOUBLE NULL');
      await ensureColumn('grn_items', 'recv_dim_pcs', 'INT NULL');
	      await ensureColumn('grn_items', 'recv_dim_input_unit', 'VARCHAR(8) NULL');
	      await ensureColumn('grn_items', 'recv_dim_po_unit', 'VARCHAR(8) NULL');
	      await ensureColumn('grn_items', 'weight', 'DOUBLE NULL');
	      await ensureColumn('grn_items', 'round_off', 'DOUBLE NULL');
	      await ensureColumn('grn_items', 'po_item_id', 'VARCHAR(255) NULL');
	      await ensureNonUniqueIndex('grn_items', 'idx_grn_items_grn_id', ['grn_id']);
	      await ensureNonUniqueIndex('grn_items', 'idx_grn_items_po_item_id', ['po_item_id']);
	      await dropUniqueIndexesForExactColumns('grn_items', [
	        ['grn_id'],
	        ['grn_id', 'item_id'],
	        ['grn_id', 'po_item_id'],
	      ]);

      await ensureColumn('invoice_items', 'dim_length', 'DOUBLE NULL');
      await ensureColumn('invoice_items', 'dim_breadth', 'DOUBLE NULL');
      await ensureColumn('invoice_items', 'dim_pcs', 'INT NULL');
      await ensureColumn('invoice_items', 'dim_input_unit', 'VARCHAR(8) NULL');

	      // Spec values are now scoped by Item Name + Specification (item_name_id may be NULL for legacy/global values).
	      await ensureColumn('specification_values', 'item_name_id', 'VARCHAR(255) NULL');
	      // Add helper generated columns and a durable uniqueness guard.
	      // We cannot safely rely on a raw TEXT unique index for `value`, so we
	      // normalize the scope into generated columns and index the hash.
	      try {
	        const [helperRows] = await pool.query(
	          `
	          SELECT COLUMN_NAME AS columnName
	          FROM information_schema.COLUMNS
	          WHERE table_schema = DATABASE()
	            AND table_name = 'specification_values'
	            AND COLUMN_NAME IN ('item_name_scope', 'value_norm_hash')
	          `
	        );
	        const helperCols = new Set((helperRows || []).map((r) => String(r.columnName ?? '').trim()));
	        if (!helperCols.has('item_name_scope')) {
	          await pool.query(
	            `ALTER TABLE specification_values
	               ADD COLUMN item_name_scope VARCHAR(255)
	               GENERATED ALWAYS AS (COALESCE(NULLIF(TRIM(item_name_id), ''), '')) STORED`
	          );
	        }
	        if (!helperCols.has('value_norm_hash')) {
	          await pool.query(
	            `ALTER TABLE specification_values
	               ADD COLUMN value_norm_hash CHAR(64)
	               GENERATED ALWAYS AS (SHA2(LOWER(TRIM(value)), 256)) STORED`
	          );
	        }

        const [existingTargetIndexRows] = await pool.query(
          `
          SELECT 1
          FROM information_schema.statistics
          WHERE table_schema = DATABASE()
            AND table_name = 'specification_values'
            AND index_name = 'uq_spec_values_scope_hash'
          LIMIT 1
          `
        );
        const targetIndexExists = Array.isArray(existingTargetIndexRows) && existingTargetIndexRows.length > 0;
        if (!targetIndexExists) {
          const [duplicateRows] = await pool.query(
            `
            SELECT COUNT(*) AS duplicateGroups
            FROM (
              SELECT 1
              FROM specification_values
              GROUP BY specification_id, COALESCE(NULLIF(TRIM(item_name_id), ''), ''), LOWER(TRIM(value))
              HAVING COUNT(*) > 1
            ) d
            `
          );
          const duplicateGroups = Number(duplicateRows?.[0]?.duplicateGroups ?? 0);
          if (duplicateGroups > 0) {
            console.warn(
              `specification_values unique index not created because ${duplicateGroups} duplicate groups still exist`
            );
          } else {
            const [uniqRows] = await pool.query(
              `
              SELECT DISTINCT INDEX_NAME AS indexName
              FROM information_schema.statistics
              WHERE table_schema = DATABASE()
                AND table_name = 'specification_values'
                AND non_unique = 0
                AND INDEX_NAME <> 'PRIMARY'
              `
            );
            for (const r of uniqRows || []) {
              const idx = String(r.indexName ?? '').trim();
              if (!idx) continue;
              if (idx === 'uq_spec_values_scope_hash') continue;
              try {
                await pool.query(`ALTER TABLE specification_values DROP INDEX \`${idx}\``);
              } catch {}
            }
            await pool.query(
              'ALTER TABLE specification_values ADD UNIQUE INDEX uq_spec_values_scope_hash (specification_id, item_name_scope, value_norm_hash)'
            );
          }
        }
      } catch (e) {
        console.error('Unable to migrate specification_values unique index:', e);
      }

      // Mapping: which specifications apply to an Item Name.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS item_name_specifications (
          item_name_id VARCHAR(255) NOT NULL,
          specification_id VARCHAR(255) NOT NULL,
          created_at DATETIME NULL,
          PRIMARY KEY (item_name_id, specification_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS priorities (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) UNIQUE,
          created_by VARCHAR(255),
          created_at DATETIME,
          updated_by VARCHAR(255),
          updated_at DATETIME
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await pool.query(`
	        CREATE TABLE IF NOT EXISTS material_requests (
	          id VARCHAR(255) PRIMARY KEY,
	          request_no VARCHAR(255) NOT NULL UNIQUE,
	          date DATE NOT NULL,
	          firm_id VARCHAR(255),
	          store_id VARCHAR(255),
	          department VARCHAR(255),
	          customer_id VARCHAR(255),
	          project_id VARCHAR(255),
	          request_by_type VARCHAR(255) NOT NULL,
          request_by_user_id VARCHAR(255),
          request_by_supplier_id VARCHAR(255),
          remarks TEXT,
          status VARCHAR(255) DEFAULT 'Pending',
          created_by VARCHAR(255),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS material_request_items (
          id VARCHAR(255) PRIMARY KEY,
          request_id VARCHAR(255) NOT NULL,
          item_id VARCHAR(255) NOT NULL,
          specification TEXT,
          quantity DOUBLE NOT NULL,
          issued_quantity DOUBLE DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (request_id) REFERENCES material_requests(id) ON DELETE CASCADE,
          FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS settings_catalogue (
          id VARCHAR(64) PRIMARY KEY,
          link TEXT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS settings_links (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          link TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rfqs (
          id VARCHAR(255) PRIMARY KEY,
          rfq_number VARCHAR(255) NOT NULL UNIQUE,
          pr_id VARCHAR(255) NULL,
          firm_id VARCHAR(255) NULL,
          project_id VARCHAR(255) NULL,
          status VARCHAR(255) NOT NULL DEFAULT 'created',
          rfq_date DATE NOT NULL,
          remarks TEXT NULL,
          created_by VARCHAR(255) NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
	      await pool.query(`
	        CREATE TABLE IF NOT EXISTS rfq_items (
	          id VARCHAR(255) PRIMARY KEY,
	          rfq_id VARCHAR(255) NOT NULL,
	          item_id VARCHAR(255) NOT NULL,
	          supplier_id VARCHAR(255) NULL,
	          supplier_rate DOUBLE NULL,
	          specification TEXT NULL,
	          quantity DOUBLE NOT NULL,
	          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	          FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE
	        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	      `);
	      await pool.query(`
	        CREATE TABLE IF NOT EXISTS states (
	          id VARCHAR(64) PRIMARY KEY,
	          name VARCHAR(255) NOT NULL UNIQUE,
	          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	      `);
	      await pool.query(`
	        CREATE TABLE IF NOT EXISTS cities (
	          id VARCHAR(64) PRIMARY KEY,
	          state_name VARCHAR(255) NOT NULL,
	          name VARCHAR(255) NOT NULL,
	          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	          UNIQUE KEY uniq_state_city (state_name, name)
	        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	      `);
	      const indiaStates = [
	        'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
	        'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
	        'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
	        'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
	        'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
	      ];
	      const indiaCitiesByState = {
	        'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Tirupati'],
	        'Arunachal Pradesh': ['Itanagar', 'Naharlagun', 'Pasighat'],
	        'Assam': ['Guwahati', 'Dibrugarh', 'Silchar', 'Jorhat'],
	        'Bihar': ['Patna', 'Gaya', 'Muzaffarpur', 'Bhagalpur'],
	        'Chhattisgarh': ['Raipur', 'Bhilai', 'Bilaspur', 'Korba'],
	        Goa: ['Panaji', 'Margao', 'Vasco da Gama'],
	        Gujarat: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot'],
	        Haryana: ['Gurugram', 'Faridabad', 'Panipat', 'Ambala'],
	        'Himachal Pradesh': ['Shimla', 'Dharamshala', 'Solan'],
	        Jharkhand: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro'],
	        Karnataka: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi'],
	        Kerala: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur'],
	        'Madhya Pradesh': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior'],
	        Maharashtra: ['Mumbai', 'Pune', 'Nagpur', 'Nashik'],
	        Manipur: ['Imphal', 'Thoubal'],
	        Meghalaya: ['Shillong', 'Tura'],
	        Mizoram: ['Aizawl', 'Lunglei'],
	        Nagaland: ['Kohima', 'Dimapur'],
	        Odisha: ['Bhubaneswar', 'Cuttack', 'Rourkela'],
	        Punjab: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala'],
	        Rajasthan: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota'],
	        Sikkim: ['Gangtok', 'Namchi'],
	        'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli'],
	        Telangana: ['Hyderabad', 'Warangal', 'Nizamabad'],
	        Tripura: ['Agartala', 'Dharmanagar'],
	        'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Varanasi', 'Agra'],
	        Uttarakhand: ['Dehradun', 'Haridwar', 'Haldwani'],
	        'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Siliguri'],
	        'Andaman and Nicobar Islands': ['Port Blair'],
	        Chandigarh: ['Chandigarh'],
	        'Dadra and Nagar Haveli and Daman and Diu': ['Daman', 'Diu', 'Silvassa'],
	        Delhi: ['New Delhi', 'Delhi'],
	        'Jammu and Kashmir': ['Srinagar', 'Jammu'],
	        Ladakh: ['Leh', 'Kargil'],
	        Lakshadweep: ['Kavaratti'],
	        Puducherry: ['Puducherry', 'Karaikal'],
	      };
	      for (const stateName of indiaStates) {
	        await pool.query('INSERT IGNORE INTO states (id, name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [crypto.randomUUID(), stateName]);
	      }
	      for (const [stateName, cities] of Object.entries(indiaCitiesByState)) {
	        for (const cityName of cities) {
	          await pool.query('INSERT IGNORE INTO cities (id, state_name, name, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [
	            crypto.randomUUID(),
	            stateName,
	            cityName,
	          ]);
	        }
	      }
		      await ensureColumn('suppliers', 'is_vendor', 'TINYINT NOT NULL DEFAULT 0');
          await ensureColumn('suppliers', 'credit_voucher_applicable', 'TINYINT NOT NULL DEFAULT 0');
		      await ensureColumn('suppliers', 'catalogue_link', 'TEXT NULL');
	        await ensureColumn('suppliers', 'contact_person', 'VARCHAR(255) NULL');
	        await ensureColumn('suppliers', 'contact_person_mobile', 'VARCHAR(32) NULL');
	        await ensureColumn('suppliers', 'city', 'VARCHAR(255) NULL');
	        await ensureColumn('suppliers', 'state', 'VARCHAR(255) NULL');
		      await ensureColumn('suppliers', 'bank', 'VARCHAR(255) NULL');
		      await ensureColumn('suppliers', 'account_number', 'VARCHAR(255) NULL');
		      await ensureColumn('suppliers', 'ifsc_code', 'VARCHAR(64) NULL');
		      await ensureColumn('suppliers', 'mobile_2', 'VARCHAR(32) NULL');
          await ensureColumn('suppliers', 'msme_applicable', 'TINYINT NOT NULL DEFAULT 0');
          await ensureColumn('suppliers', 'msme_certificate_url', 'LONGTEXT NULL');
          // Ensure existing column is also LONGTEXT
          await pool.query('ALTER TABLE suppliers MODIFY COLUMN msme_certificate_url LONGTEXT NULL').catch(() => {});
	      await ensureColumn('customers', 'category_name', 'VARCHAR(255) NULL');
	      await ensureColumn('customers', 'sub_category_name', 'VARCHAR(255) NULL');
	      await ensureColumn('customers', 'city', 'VARCHAR(255) NULL');
	      await ensureColumn('customers', 'state', 'VARCHAR(255) NULL');
	      await ensureColumn('customers', 'contact_person', 'VARCHAR(255) NULL');
	      await ensureColumn('customers', 'contact_number', 'VARCHAR(32) NULL');
	      await ensureColumn('customers', 'email_id', 'VARCHAR(255) NULL');
	      await ensureColumn('rfq_items', 'supplier_id', 'VARCHAR(255) NULL');
	      await ensureColumn('rfq_items', 'supplier_rate', 'DOUBLE NULL');
	      await ensureColumn('item_issues', 'material_request_id', 'VARCHAR(255) NULL');
		      await ensureColumn('users', 'po_approval_amount', 'DOUBLE NULL');
		      await ensureColumn('item_names', 'catalogue_link', 'TEXT NULL');
          await ensureColumn('item_names', 'type', "VARCHAR(16) NOT NULL DEFAULT 'Goods'");
		      await ensureColumn('items', 'opening_stock', 'DOUBLE NOT NULL DEFAULT 0');
          await ensureColumn('items', 'rate', 'DOUBLE NOT NULL DEFAULT 0');
          await ensureColumn('purchase_orders', 'po_type', "VARCHAR(16) NOT NULL DEFAULT 'Goods'");
          await ensureColumn('payments', 'credit_voucher_id', 'VARCHAR(255) NULL');
		      await ensureColumn('material_requests', 'firm_id', 'VARCHAR(255) NULL');
		      await ensureColumn('material_requests', 'store_id', 'VARCHAR(255) NULL');
		      await ensureColumn('material_requests', 'department', 'VARCHAR(255) NULL');

          await pool.query(`
            CREATE TABLE IF NOT EXISTS credit_vouchers (
              id VARCHAR(255) PRIMARY KEY,
              po_id VARCHAR(255) NOT NULL,
              supplier_id VARCHAR(255) NOT NULL,
              voucher_number VARCHAR(255) NULL,
              voucher_date DATE NOT NULL,
              status VARCHAR(32) NOT NULL DEFAULT 'Recorded',
              total_amount DOUBLE NOT NULL DEFAULT 0,
              payment_status VARCHAR(32) NULL,
              payment_date DATE NULL,
              payment_amount DOUBLE NOT NULL DEFAULT 0,
              payment_mode VARCHAR(16) NULL,
              tally_entry_date DATE NULL,
              approved_by VARCHAR(255) NULL,
              approved_at DATETIME NULL,
              created_by VARCHAR(255) NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_by VARCHAR(255) NULL,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              KEY idx_cv_po (po_id),
              KEY idx_cv_supplier (supplier_id),
              KEY idx_cv_status (status),
              CONSTRAINT fk_credit_vouchers_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
              CONSTRAINT fk_credit_vouchers_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
          `);

          await pool.query(`
            CREATE TABLE IF NOT EXISTS credit_voucher_items (
              id VARCHAR(255) PRIMARY KEY,
              credit_voucher_id VARCHAR(255) NOT NULL,
              item_id VARCHAR(255) NOT NULL,
              quantity DOUBLE NOT NULL DEFAULT 0,
              rate DOUBLE NOT NULL DEFAULT 0,
              amount DOUBLE NOT NULL DEFAULT 0,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              KEY idx_cvi_voucher (credit_voucher_id),
              KEY idx_cvi_item (item_id),
              CONSTRAINT fk_credit_voucher_items_voucher FOREIGN KEY (credit_voucher_id) REFERENCES credit_vouchers(id) ON DELETE CASCADE,
              CONSTRAINT fk_credit_voucher_items_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
          `);

          await pool.query(`
            CREATE TABLE IF NOT EXISTS credit_voucher_grns (
              credit_voucher_id VARCHAR(255) NOT NULL,
              grn_id VARCHAR(255) NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (credit_voucher_id, grn_id),
              CONSTRAINT fk_credit_voucher_grns_voucher FOREIGN KEY (credit_voucher_id) REFERENCES credit_vouchers(id) ON DELETE CASCADE,
              CONSTRAINT fk_credit_voucher_grns_grn FOREIGN KEY (grn_id) REFERENCES grns(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
          `);
		    } catch (err) {
		      console.error('Failed to ensure PO/Invoice enhancement columns:', err);
		    }
	  })();

  return mysqlPool;
}

let geoMastersInitPromise = null;
async function ensureGeoMastersTables(pool) {
  if (geoMastersInitPromise) return geoMastersInitPromise;
  geoMastersInitPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS states (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cities (
        id VARCHAR(64) PRIMARY KEY,
        state_name VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_state_city (state_name, name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const indiaStates = [
      'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
      'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
      'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
      'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
      'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
    ];
    const indiaCitiesByState = {
      'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Tirupati'],
      'Arunachal Pradesh': ['Itanagar', 'Naharlagun', 'Pasighat'],
      'Assam': ['Guwahati', 'Dibrugarh', 'Silchar', 'Jorhat'],
      'Bihar': ['Patna', 'Gaya', 'Muzaffarpur', 'Bhagalpur'],
      'Chhattisgarh': ['Raipur', 'Bhilai', 'Bilaspur', 'Korba'],
      Goa: ['Panaji', 'Margao', 'Vasco da Gama'],
      Gujarat: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot'],
      Haryana: ['Gurugram', 'Faridabad', 'Panipat', 'Ambala'],
      'Himachal Pradesh': ['Shimla', 'Dharamshala', 'Solan'],
      Jharkhand: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro'],
      Karnataka: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi'],
      Kerala: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur'],
      'Madhya Pradesh': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior'],
      Maharashtra: ['Mumbai', 'Pune', 'Nagpur', 'Nashik'],
      Manipur: ['Imphal', 'Thoubal'],
      Meghalaya: ['Shillong', 'Tura'],
      Mizoram: ['Aizawl', 'Lunglei'],
      Nagaland: ['Kohima', 'Dimapur'],
      Odisha: ['Bhubaneswar', 'Cuttack', 'Rourkela'],
      Punjab: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala'],
      Rajasthan: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota'],
      Sikkim: ['Gangtok', 'Namchi'],
      'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli'],
      Telangana: ['Hyderabad', 'Warangal', 'Nizamabad'],
      Tripura: ['Agartala', 'Dharmanagar'],
      'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Varanasi', 'Agra'],
      Uttarakhand: ['Dehradun', 'Haridwar', 'Haldwani'],
      'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Siliguri'],
      'Andaman and Nicobar Islands': ['Port Blair'],
      Chandigarh: ['Chandigarh'],
      'Dadra and Nagar Haveli and Daman and Diu': ['Daman', 'Diu', 'Silvassa'],
      Delhi: ['New Delhi', 'Delhi'],
      'Jammu and Kashmir': ['Srinagar', 'Jammu'],
      Ladakh: ['Leh', 'Kargil'],
      Lakshadweep: ['Kavaratti'],
      Puducherry: ['Puducherry', 'Karaikal'],
    };

    for (const stateName of indiaStates) {
      await pool.query('INSERT IGNORE INTO states (id, name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [crypto.randomUUID(), stateName]);
    }
    for (const [stateName, cities] of Object.entries(indiaCitiesByState)) {
      for (const cityName of cities) {
        await pool.query('INSERT IGNORE INTO cities (id, state_name, name, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [
          crypto.randomUUID(),
          stateName,
          cityName,
        ]);
      }
    }
  })();
  return geoMastersInitPromise;
}

// Readiness check (includes DB connectivity when configured).
app.get('/ready', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) {
      return res.status(503).json({
        ok: false,
        ready: false,
        reason: 'database_not_configured',
      });
    }
    await pool.query('SELECT 1');
    return res.status(200).json({
      ok: true,
      ready: true,
      db: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(503).json({
      ok: false,
      ready: false,
      reason: e instanceof Error ? e.message : String(e),
    });
  }
});

function getSqlErrorMessage(error) {
  if (!error) return '';
  return String(error.sqlMessage || error.message || error);
}

function isForeignKeyInUseError(error) {
  const message = getSqlErrorMessage(error);
  return error?.errno === 1451 || error?.code === 'ER_ROW_IS_REFERENCED_2' || /foreign key constraint fails/i.test(message);
}

function formatReferencedTable(error) {
  const message = getSqlErrorMessage(error);
  const match = message.match(/FOREIGN KEY constraint fails \(`[^`]+`\.`([^`]+)`/i) || message.match(/\(`[^`]+`\.`([^`]+)`/);
  const table = String(match?.[1] ?? '').trim();
  if (!table) return '';
  return table
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getReferencedRawTable(error) {
  const message = getSqlErrorMessage(error);
  const match = message.match(/FOREIGN KEY constraint fails \(`[^`]+`\.`([^`]+)`/i) || message.match(/\(`[^`]+`\.`([^`]+)`/);
  return String(match?.[1] ?? '').trim();
}

function getReferencedColumn(error) {
  const message = getSqlErrorMessage(error);
  const match = message.match(/FOREIGN KEY \(`([^`]+)`\) REFERENCES/i);
  return String(match?.[1] ?? '').trim();
}

async function columnExists(pool, tableName, columnName) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  return Array.isArray(rows) && rows.length > 0;
}

const deleteUsageLookups = {
  projects: { label: 'Projects', nameColumn: 'name' },
  stores: { label: 'Stores', nameColumn: 'name' },
  suppliers: { label: 'Suppliers', nameColumn: 'name' },
  customers: { label: 'Customers', nameColumn: 'name' },
  transporters: { label: 'Transporters', nameColumn: 'name' },
  departments: { label: 'Departments', nameColumn: 'name' },
  units: { label: 'Units', nameColumn: 'name' },
  item_categories: { label: 'Item Categories', nameColumn: 'name' },
  item_names: { label: 'Item Names', nameColumn: 'name' },
  specifications: { label: 'Specifications', nameColumn: 'name' },
  specification_values: { label: 'Specification Values', nameColumn: 'value' },
  items: { label: 'Items', nameColumn: 'item_code' },
  purchase_requisitions: { label: 'Purchase Requisitions', nameColumn: 'pr_number' },
  purchase_orders: { label: 'Purchase Orders', nameColumn: 'po_number' },
  grns: { label: 'GRN', nameColumn: 'grn_number' },
  invoices: { label: 'Invoices', nameColumn: 'invoice_number' },
  payments: { label: 'Payments', nameColumn: 'payment_status' },
  item_issues: { label: 'Issue Master', nameColumn: 'transaction_no' },
  item_returns: { label: 'Return Master', nameColumn: 'transaction_no' },
  item_damages: { label: 'Damage Master', nameColumn: 'transaction_no' },
  item_transfers: { label: 'Transfer Master', nameColumn: 'transaction_no' },
  gst_rates: { label: 'GST Rates', nameColumn: 'rate' },
};

async function getDeleteUsageDetails(pool, error, parentId) {
  const table = getReferencedRawTable(error);
  const fkColumn = getReferencedColumn(error);
  const lookup = deleteUsageLookups[table];
  if (!lookup || !fkColumn || !/^[a-zA-Z0-9_]+$/.test(table) || !/^[a-zA-Z0-9_]+$/.test(fkColumn)) return [];
  const [rows] = await pool.query(
    `SELECT ${lookup.nameColumn} AS name FROM ${table} WHERE ${fkColumn} = ? LIMIT 10`,
    [parentId]
  );
  return (Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.name ?? '').trim())
    .filter(Boolean)
    .map((name) => ({ usedIn: lookup.label, name }));
}

async function sendDeleteInUseError(res, pool, parentId, error, label) {
  if (!isForeignKeyInUseError(error)) return false;
  const usedIn = formatReferencedTable(error);
  const suffix = usedIn ? ` It is already used in ${usedIn}.` : ' It is already used in another record.';
  const usageDetails = await getDeleteUsageDetails(pool, error, parentId);
  res.status(409).json({ error: `Cannot delete ${label}.${suffix}`, usageDetails });
  return true;
}

// --- Masters: GST Rates ---
app.get('/api/masters/gst-rates', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query('SELECT id, rate FROM gst_rates ORDER BY rate');
    res.json({ gstRates: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/gst-rates', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rate = req.body?.rate != null ? Number(req.body.rate) : NaN;
    if (!Number.isFinite(rate)) return res.status(400).json({ error: 'Rate is required and must be a number' });
    const id = crypto.randomUUID();
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;

    await pool.query(
      'INSERT INTO gst_rates (id, rate, created_by, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [id, rate, createdBy]
    );

    res.status(201).json({ gstRate: { id, rate } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'GST Rate already exists' });
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/gst-rates/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = req.params.id;
    const rate = req.body?.rate != null ? Number(req.body.rate) : NaN;
    if (!Number.isFinite(rate)) return res.status(400).json({ error: 'Rate is required and must be a number' });

    await pool.query(
      'UPDATE gst_rates SET rate=?, updated_at=NOW() WHERE id=?',
      [rate, id]
    );

    res.json({ gstRate: { id, rate } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/gst-rates/:id', async (req, res) => {
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = req.params.id;
    await pool.query('DELETE FROM gst_rates WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'GST rate')) return;
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// --- Auth ---
// Simple login using the existing `users` table (login_id + password_hash).
// Only active users can login.
app.post('/api/auth/login', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const loginId = String(req.body?.loginId ?? '').trim();
    const password = String(req.body?.password ?? '').trim();
    if (!loginId) return res.status(400).json({ error: 'loginId is required' });
    if (!password) return res.status(400).json({ error: 'password is required' });

    const passwordHash = sha256(password);
    const [[row]] = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        role,
        login_id AS loginId,
        menu_access AS menuAccess,
        is_active AS isActive,
        is_deleted AS isDeleted,
        password_hash AS passwordHash
      FROM users
      WHERE LOWER(TRIM(login_id))=LOWER(TRIM(?))
      LIMIT 1
      `,
      [loginId]
    );

    if (!row?.id) return res.status(401).json({ error: 'Invalid Login ID or Password.' });
    if (row?.isDeleted) return res.status(403).json({ error: 'User is Deleted. Please contact Admin.' });
    if (!row?.isActive) return res.status(403).json({ error: 'User is Inactive. Please contact Admin.' });

    const stored = String(row?.passwordHash ?? '').trim();
    if (!stored || stored !== passwordHash) return res.status(401).json({ error: 'Invalid Login ID or Password.' });
    const [passwordPlainCols] = await pool.query('SHOW COLUMNS FROM users LIKE ?', ['password_plain']);
    if (!Array.isArray(passwordPlainCols) || passwordPlainCols.length === 0) {
      await pool.query('ALTER TABLE users ADD COLUMN password_plain TEXT NULL');
    }
    await pool.query('UPDATE users SET password_plain=? WHERE id=?', [password, row.id]);

    let menuAccess = [];
    try {
      const raw = row?.menuAccess;
      if (raw != null && String(raw).trim()) {
        const parsed = JSON.parse(String(raw));
        if (Array.isArray(parsed)) menuAccess = parsed.map((x) => String(x));
      }
    } catch {}

    res.json({
      user: {
        id: String(row.id),
        name: String(row.name ?? ''),
        email: row.email != null ? String(row.email) : null,
        role: row.role != null ? String(row.role) : '',
        loginId: row.loginId != null ? String(row.loginId) : '',
        isActive: true,
        menuAccess,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const parseUploadBody = express.raw({ type: () => true, limit: '6mb' });

function detectUploadContentType(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const brand = buf.length >= 12 ? buf.subarray(4, 12).toString('ascii') : '';
  if (/^ftyp(?:heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return 'image/heic';
  return '';
}

function extensionForUploadType(contentType) {
  return {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/heic': '.heic',
  }[contentType] || '';
}

app.post('/api/uploads', (req, res, next) => {
  parseUploadBody(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.type === 'entity.too.large';
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge ? 'File is too large. Maximum upload size is 5 MB.' : 'Unable to read upload content.',
    });
  });
}, async (req, res) => {
  try {
    const isBinary = Buffer.isBuffer(req.body);
    const encodedName = isBinary ? String(req.get('x-file-name') ?? '').trim() : '';
    const fileName = isBinary
      ? (() => {
          try {
            return decodeURIComponent(encodedName) || 'file';
          } catch {
            return encodedName || 'file';
          }
        })()
      : String(req.body?.fileName ?? '').trim() || 'file';
    const base64 = isBinary ? '' : String(req.body?.base64 ?? '').trim();
    if (!isBinary && !base64) return res.status(400).json({ error: 'Upload content is required.' });

    const buf = isBinary ? req.body : Buffer.from(base64, 'base64');
    if (!buf.length) return res.status(400).json({ error: 'Invalid upload content.' });
    if (buf.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'File is too large. Maximum upload size is 5 MB.' });

    const contentType = detectUploadContentType(buf);
    const ext = extensionForUploadType(contentType);
    if (!contentType || !ext) {
      return res.status(415).json({ error: 'Unsupported file type. Upload a PDF, JPG, PNG, WEBP, GIF, or HEIC file.' });
    }

    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const storedName = `${hash}${ext}`;

    await fs.mkdir(uploadsDir, { recursive: true });
    let deduplicated = false;
    try {
      await fs.writeFile(path.join(uploadsDir, storedName), buf, { flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      deduplicated = true;
    }

    const suppliedOriginalSize = Number(req.get('x-original-size'));
    const originalSize = Number.isFinite(suppliedOriginalSize) && suppliedOriginalSize >= buf.length
      ? suppliedOriginalSize
      : buf.length;
    res.json({
      url: `/api/uploads/${encodeURIComponent(storedName)}`,
      fileName,
      contentType,
      originalSize,
      storedSize: buf.length,
      optimized: originalSize > buf.length,
      deduplicated,
    });
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

async function syncPoAdvanceSummary(db, poId) {
  const [sumRows] = await db.query(
    `
    SELECT
      COALESCE(SUM(advance_amount), 0) AS totalAdvanceAmount,
      MAX(advance_date) AS lastAdvanceDate
    FROM po_advances
    WHERE po_id = ?
    `,
    [poId]
  );
  const row = Array.isArray(sumRows) && sumRows.length ? sumRows[0] : null;
  const totalAdvanceAmount = Number(row?.totalAdvanceAmount ?? 0);
  const lastAdvanceDate = toIsoDate(row?.lastAdvanceDate) || null;
  await db.query('UPDATE purchase_orders SET advance_amount = ?, advance_date = ?, updated_at = NOW() WHERE id = ?', [
    totalAdvanceAmount,
    lastAdvanceDate,
    poId,
  ]);
  return { advanceAmount: totalAdvanceAmount, advanceDate: lastAdvanceDate };
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
      it.unit AS unit,
      pri.requested_qty AS quantity,
      COALESCE(pri.approved_qty, pri.requested_qty) AS approvedQty,
      pri.priority_id AS priorityId,
      p.name AS priority,
      pri.remarks AS specification,
      pri.dim_length AS dimLength,
      pri.dim_breadth AS dimBreadth,
      pri.dim_pcs AS dimPcs,
      pri.dim_unit AS dimUnit,
      pri.approved_dim_length AS approvedDimLength,
      pri.approved_dim_breadth AS approvedDimBreadth,
      pri.approved_dim_pcs AS approvedDimPcs,
      pri.approved_dim_unit AS approvedDimUnit
    FROM purchase_requisition_items pri
    LEFT JOIN items it ON it.id = pri.item_id
    LEFT JOIN item_names iname ON iname.id = it.item_name_id
    LEFT JOIN priorities p ON p.id = pri.priority_id
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
    unit: r.unit != null ? String(r.unit) : null,
    quantity: Number(r.quantity ?? 0),
    approvedQty: Number(r.approvedQty ?? r.quantity ?? 0),
    priorityId: r.priorityId ? String(r.priorityId) : null,
    priority: r.priority ? String(r.priority) : null,
    specification: String(r.specification ?? ''),
    dimLength: r.dimLength != null ? Number(r.dimLength) : null,
    dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : null,
    dimPcs: r.dimPcs != null ? Number(r.dimPcs) : null,
    dimUnit: r.dimUnit != null ? String(r.dimUnit) : null,
    approvedDimLength: r.approvedDimLength != null ? Number(r.approvedDimLength) : null,
    approvedDimBreadth: r.approvedDimBreadth != null ? Number(r.approvedDimBreadth) : null,
    approvedDimPcs: r.approvedDimPcs != null ? Number(r.approvedDimPcs) : null,
    approvedDimUnit: r.approvedDimUnit != null ? String(r.approvedDimUnit) : null,
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

function parseJsonObject(raw, fallback = {}) {
  const text = String(raw ?? '').trim();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizePoMode(raw) {
  return String(raw ?? '').trim().toLowerCase() === 'draft' ? 'draft' : 'issue';
}

function normalizePoSource(raw) {
  const source = String(raw ?? '').trim().toUpperCase();
  return source === 'DIRECT' ? 'DIRECT' : 'PR';
}

function mapPoStatus(raw) {
  const status = String(raw ?? '').trim().toLowerCase();
  if (status === 'draft') return 'Draft';
  if (status === 'closed') return 'Closed';
  if (status === 'partial') return 'Partial';
  return 'Open';
}

function validIdOrNull(value) {
  const s = String(value ?? '').trim();
  return s || null;
}

function validTextOrNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function normalizePoDraftLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((row, idx) => ({
    id: validTextOrNull(row?.id) || `draft-line-${idx + 1}`,
    itemId: validTextOrNull(row?.itemId),
    itemNameId: validTextOrNull(row?.itemNameId),
    item: validTextOrNull(row?.item),
    itemLabel: validTextOrNull(row?.itemLabel) || validTextOrNull(row?.item) || '',
    description: validTextOrNull(row?.description),
    specificationsJson: row?.specificationsJson != null ? String(row.specificationsJson) : undefined,
    specs: row?.specs && typeof row.specs === 'object' ? row.specs : {},
    quantity: Number.isFinite(Number(row?.quantity)) ? Number(row.quantity) : 0,
    rate: Number.isFinite(Number(row?.rate)) ? Number(row.rate) : 0,
    discountPercent: Number.isFinite(Number(row?.discountPercent)) ? Number(row.discountPercent) : 0,
    taxPercent: Number.isFinite(Number(row?.taxPercent)) ? Number(row.taxPercent) : 0,
    unit: validTextOrNull(row?.unit),
    dimLength: Number.isFinite(Number(row?.length ?? row?.dimLength)) ? Number(row?.length ?? row?.dimLength) : null,
    dimBreadth: Number.isFinite(Number(row?.breadth ?? row?.dimBreadth)) ? Number(row?.breadth ?? row?.dimBreadth) : null,
    dimPcs: Number.isFinite(Number(row?.pcs ?? row?.dimPcs)) ? Number(row?.pcs ?? row?.dimPcs) : null,
    dimUnit: validTextOrNull(row?.inputUnit ?? row?.dimUnit),
    remarks: validTextOrNull(row?.remarks),
  }));
}

function buildPoDraftPayload(input = {}) {
  return {
    firmId: validIdOrNull(input.firmId),
    storeId: validIdOrNull(input.storeId),
    projectId: validIdOrNull(input.projectId),
    supplierId: validIdOrNull(input.supplierId),
    supplier: validTextOrNull(input.supplier),
    poType: validTextOrNull(input.poType) || 'Goods',
    paymentTerms: validTextOrNull(input.paymentTerms),
    paymentType: validTextOrNull(input.paymentType),
    paymentMode: validTextOrNull(input.paymentMode),
    shippingAddress: validTextOrNull(input.shippingAddress),
    termsConditions: validTextOrNull(input.termsConditions),
    department: validTextOrNull(input.department),
    requestedBy: validTextOrNull(input.requestedBy),
    requiredDate: toIsoDate(validTextOrNull(input.requiredDate)) || validTextOrNull(input.requiredDate),
    remarks: validTextOrNull(input.remarks),
    advanceAmount: Math.max(0, num(input.advanceAmount, 0)),
    advanceDate:
      input.advanceDate === null ? null : toIsoDate(validTextOrNull(input.advanceDate)) || validTextOrNull(input.advanceDate),
    lines: normalizePoDraftLines(input.items ?? input.lines),
  };
}

function poDraftHeaderValue(poRow, payload, key) {
  const payloadValue = payload?.[key];
  if (payloadValue != null && payloadValue !== '') return payloadValue;
  return null;
}

function normalizeSpecsMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const sid = String(k ?? '').trim();
    const sval = String(v ?? '').trim();
    if (!sid || !sval) continue;
    out[sid] = sval;
  }
  return out;
}

function stableJsonStringifySorted(obj) {
  const entries = Object.entries(obj || {}).sort(([a], [b]) => String(a).localeCompare(String(b)));
  return JSON.stringify(Object.fromEntries(entries));
}

async function ensureDocSequencesTable(pool) {
  // Check if firm_id column exists, if not migrate
  try {
    const [cols] = await pool.query('SHOW COLUMNS FROM doc_sequences LIKE "firm_id"');
    if (cols.length === 0) {
      await pool.query('ALTER TABLE doc_sequences ADD COLUMN firm_id VARCHAR(255) NOT NULL DEFAULT "DEFAULT" FIRST');
      await pool.query('ALTER TABLE doc_sequences DROP PRIMARY KEY');
      await pool.query('ALTER TABLE doc_sequences ADD PRIMARY KEY (firm_id, kind, fy)');
    }
  } catch (e) {
    // If table doesn't exist, create it
    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS doc_sequences (
        firm_id VARCHAR(255) NOT NULL,
        kind VARCHAR(10) NOT NULL,
        fy VARCHAR(10) NOT NULL,
        next_no INT NOT NULL DEFAULT 1,
        PRIMARY KEY (firm_id, kind, fy)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `
    );
  }
}

async function allocateDocNumber(pool, firmId, kind, date = new Date()) {
  const docKind = String(kind || '').trim().toUpperCase();
  if (!docKind) throw new Error('Missing doc kind');
  const fy = fiscalYearLabel(date);
  const fId = String(firmId || 'DEFAULT').trim();
  await ensureDocSequencesTable(pool);

  // Fetch firm sort_name
  let sortName = 'GEN';
  if (fId !== 'DEFAULT') {
    const [fRows] = await pool.query('SELECT sort_name FROM firms WHERE id = ? LIMIT 1', [fId]);
    const fRow = Array.isArray(fRows) ? fRows[0] : null;
    if (fRow?.sort_name) {
      sortName = String(fRow.sort_name).trim().toUpperCase();
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT IGNORE INTO doc_sequences (firm_id, kind, fy, next_no) VALUES (?, ?, ?, ?)', [fId, docKind, fy, 1]);
    const [rows] = await conn.query('SELECT next_no AS nextNo FROM doc_sequences WHERE firm_id=? AND kind=? AND fy=? FOR UPDATE', [
      fId,
      docKind,
      fy,
    ]);
    const row = Array.isArray(rows) ? rows[0] : null;
    const nextNo = Number(row?.nextNo ?? 1);
    const useNo = Number.isFinite(nextNo) && nextNo > 0 ? nextNo : 1;
    await conn.query('UPDATE doc_sequences SET next_no=? WHERE firm_id=? AND kind=? AND fy=?', [useNo + 1, fId, docKind, fy]);
    await conn.commit();
    return `${sortName}/${docKind}/${fy}/${String(useNo).padStart(5, '0')}`;
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
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM firms WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'firm')) return;
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

function csvEscape(value) {
  const s = String(value ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

app.get('/api/requests.xlsx', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const [rows] = await pool.query(
      `
      SELECT
        pr.id,
        pr.pr_number AS prNumber,
        pr.firm_id AS firmId,
        f.name AS firmName,
        pr.project_id AS projectId,
        proj.name AS projectName,
        pr.store_id AS storeId,
        st.name AS store,
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
      LEFT JOIN firms f ON f.id = pr.firm_id
      GROUP BY pr.id
      ORDER BY pr.created_at DESC
      `
    );

    const header = [
      'PR ID',
      'PR Number',
      'Firm',
      'Department',
      'Requested By',
      'Requisition Date',
      'Required Date',
      'Type',
      'Status',
      'Project',
      'Store',
    ];

    const lines = [header.map(csvEscape).join(',')];
    for (const r of rows || []) {
      const department = parseDepartmentFromRemarks(r.remarks) || 'N/A';
      lines.push(
        [
          r.id,
          r.prNumber || '',
          r.firmName || r.firmId || '',
          department,
          r.requestedBy || '',
          toIsoDateTime(r.requisitionDate) || '',
          toIsoDate(r.requiredDate) || toIsoDate(r.requisitionDate) || '',
          r.requestType || '',
          mapPrStatus(r.status),
          r.projectName || r.projectId || '',
          r.store || r.storeId || '',
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    const csv = `${lines.join('\n')}\n`;
    const today = toIsoDate(new Date()) || new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="purchase-requests-${today}.csv"`);
    res.send(csv);
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
        u.name AS unit,
	        pri.requested_qty AS quantity,
	        COALESCE(pri.approved_qty, pri.requested_qty) AS approvedQty,
          pri.priority_id AS priorityId,
          p.name AS priority,
        pri.remarks AS specification,
        pri.dim_length AS dimLength,
        pri.dim_breadth AS dimBreadth,
        pri.dim_pcs AS dimPcs,
        pri.dim_unit AS dimUnit,
        pri.approved_dim_length AS approvedDimLength,
        pri.approved_dim_breadth AS approvedDimBreadth,
        pri.approved_dim_pcs AS approvedDimPcs,
        pri.approved_dim_unit AS approvedDimUnit
      FROM purchase_requisition_items pri
      LEFT JOIN items it ON it.id = pri.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      LEFT JOIN units u ON u.id = iname.unit_id
      LEFT JOIN priorities p ON p.id = pri.priority_id
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
        unit: r.unit != null ? String(r.unit) : null,
		      quantity: Number(r.quantity ?? 0),
		      approvedQty: Number(r.approvedQty ?? r.quantity ?? 0),
          priorityId: r.priorityId ? String(r.priorityId) : null,
          priority: r.priority ? String(r.priority) : null,
	      specification: String(r.specification ?? ''),
        dimLength: r.dimLength != null ? Number(r.dimLength) : null,
        dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : null,
        dimPcs: r.dimPcs != null ? Number(r.dimPcs) : null,
        dimUnit: r.dimUnit != null ? String(r.dimUnit) : null,
        approvedDimLength: r.approvedDimLength != null ? Number(r.approvedDimLength) : null,
        approvedDimBreadth: r.approvedDimBreadth != null ? Number(r.approvedDimBreadth) : null,
        approvedDimPcs: r.approvedDimPcs != null ? Number(r.approvedDimPcs) : null,
        approvedDimUnit: r.approvedDimUnit != null ? String(r.approvedDimUnit) : null,
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
        it.unit AS unit,
	        pri.requested_qty AS quantity,
	        COALESCE(pri.approved_qty, pri.requested_qty) AS approvedQty,
          pri.priority_id AS priorityId,
          p.name AS priority,
        pri.remarks AS specification,
        pri.dim_length AS dimLength,
        pri.dim_breadth AS dimBreadth,
        pri.dim_pcs AS dimPcs,
        pri.dim_unit AS dimUnit,
        pri.approved_dim_length AS approvedDimLength,
        pri.approved_dim_breadth AS approvedDimBreadth,
        pri.approved_dim_pcs AS approvedDimPcs,
        pri.approved_dim_unit AS approvedDimUnit
      FROM purchase_requisition_items pri
      LEFT JOIN items it ON it.id = pri.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      LEFT JOIN priorities p ON p.id = pri.priority_id
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
        unit: r.unit != null ? String(r.unit) : null,
		      quantity: Number(r.quantity ?? 0),
		      approvedQty: Number(r.approvedQty ?? r.quantity ?? 0),
          priorityId: r.priorityId ? String(r.priorityId) : null,
          priority: r.priority ? String(r.priority) : null,
	      specification: String(r.specification ?? ''),
        dimLength: r.dimLength != null ? Number(r.dimLength) : null,
        dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : null,
        dimPcs: r.dimPcs != null ? Number(r.dimPcs) : null,
        dimUnit: r.dimUnit != null ? String(r.dimUnit) : null,
        approvedDimLength: r.approvedDimLength != null ? Number(r.approvedDimLength) : null,
        approvedDimBreadth: r.approvedDimBreadth != null ? Number(r.approvedDimBreadth) : null,
        approvedDimPcs: r.approvedDimPcs != null ? Number(r.approvedDimPcs) : null,
        approvedDimUnit: r.approvedDimUnit != null ? String(r.approvedDimUnit) : null,
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
          it.unit AS unit,
          it.specifications_json AS specificationsJson,
          poi.quantity AS quantity,
          poi.rate AS rate,
          poi.discount_percent AS discountPercent,
          poi.tax_percent AS taxPercent,
          poi.goods_amount AS goodsAmount,
          poi.tax_amount AS taxAmount,
          poi.total_amount AS totalAmount,
          poi.dim_length AS dimLength,
          poi.dim_breadth AS dimBreadth,
          poi.dim_pcs AS dimPcs,
          poi.dim_unit AS dimUnit
        FROM purchase_order_items poi
        LEFT JOIN items it ON it.id = poi.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        WHERE poi.po_id = ?
        ORDER BY COALESCE(poi.line_order, 999999) ASC, poi.created_at ASC, poi.id ASC
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
        unit: r.unit != null ? String(r.unit) : null,
        specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
        quantity: Number(r.quantity ?? 0),
        rate: Number(r.rate ?? 0),
        discountPercent: r.discountPercent != null ? Number(r.discountPercent) : undefined,
        taxPercent: r.taxPercent != null ? Number(r.taxPercent) : undefined,
        goodsAmount: r.goodsAmount != null ? Number(r.goodsAmount) : undefined,
        taxAmount: r.taxAmount != null ? Number(r.taxAmount) : undefined,
        totalAmount: r.totalAmount != null ? Number(r.totalAmount) : undefined,
        dimLength: r.dimLength != null ? Number(r.dimLength) : null,
        dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : null,
        dimPcs: r.dimPcs != null ? Number(r.dimPcs) : null,
        dimUnit: r.dimUnit != null ? String(r.dimUnit) : null,
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
  const storeId = req.query?.storeId != null ? String(req.query.storeId).trim() : '';
  const department = req.query?.department != null ? String(req.query.department).trim() : '';
  const projectId = req.query?.projectId != null ? String(req.query.projectId).trim() : '';
  const supplierId = req.query?.supplierId != null ? String(req.query.supplierId).trim() : '';
  const poTypeRaw = req.query?.poType != null ? String(req.query.poType).trim() : '';
  const poType = poTypeRaw.toLowerCase() === 'services' ? 'Services' : poTypeRaw.toLowerCase() === 'goods' ? 'Goods' : '';
  const from = req.query?.from != null ? String(req.query.from).trim() : '';
  const to = req.query?.to != null ? String(req.query.to).trim() : '';
  return { q, firmId, storeId, department, projectId, supplierId, poType, from, to };
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
	        GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS priority,
	        MIN(pri.required_date) AS requiredDate
	      FROM purchase_requisitions pr
	      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
	      LEFT JOIN priorities p ON p.id = pri.priority_id
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
	      priority: r.priority ? String(r.priority) : null,
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
	        GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS priority,
	        COUNT(DISTINCT po.id) AS poCount,
        COALESCE(
          SUM(
            GREATEST(
              0,
              COALESCE(pri.approved_qty, pri.requested_qty) - COALESCE(poAgg.orderedQty, 0)
            )
          ),
          0
        ) AS remainingQty
      FROM purchase_requisitions pr
	      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
	      LEFT JOIN priorities p ON p.id = pri.priority_id
      LEFT JOIN firms f ON f.id = pr.firm_id
      LEFT JOIN projects proj ON proj.id = pr.project_id
      LEFT JOIN purchase_orders po ON po.pr_id = pr.id
      LEFT JOIN (
        SELECT
          po2.pr_id AS prId,
          poi2.item_id AS itemId,
          SUM(COALESCE(poi2.quantity, 0)) AS orderedQty
        FROM purchase_orders po2
        INNER JOIN purchase_order_items poi2 ON poi2.po_id = po2.id
        GROUP BY po2.pr_id, poi2.item_id
      ) poAgg ON poAgg.prId = pr.id AND poAgg.itemId = pri.item_id
      WHERE ${where.join(' AND ')}
      GROUP BY pr.id
      HAVING remainingQty > 1e-9
      ORDER BY pr.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => {
      const remainingQty = Math.max(0, Number(r.remainingQty ?? 0));
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
	        priority: r.priority ? String(r.priority) : null,
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

	    const where = ["po.check_po = 0", "LOWER(COALESCE(po.status, '')) <> 'draft'"];
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
	        po.created_at AS createdAt,
	        GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS priority
	      FROM purchase_orders po
	      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
	      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
	      LEFT JOIN priorities p ON p.id = pri.priority_id
	      LEFT JOIN firms f ON f.id = po.firm_id
	      LEFT JOIN projects proj ON proj.id = po.project_id
		      LEFT JOIN suppliers s ON s.id = po.supplier_id
	      WHERE ${where.join(' AND ')}
	      GROUP BY po.id
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
	      priority: r.priority ? String(r.priority) : null,
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
	        po.created_at AS createdAt,
	        GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS priority
	      FROM purchase_orders po
	      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
	      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
	      LEFT JOIN priorities p ON p.id = pri.priority_id
      LEFT JOIN firms f ON f.id = po.firm_id
	      LEFT JOIN projects proj ON proj.id = po.project_id
		      LEFT JOIN suppliers s ON s.id = po.supplier_id
	      WHERE ${where.join(' AND ')}
	      GROUP BY po.id
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
	      priority: r.priority ? String(r.priority) : null,
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

	    const where = [
	      "po.check_po = 1",
	      "po.cancel_reason IS NULL",
	      "po.sent_date IS NOT NULL",
	      "po.sent_date <> ''",
	      "po.sent_by IS NOT NULL",
	      "po.sent_by <> ''",
        "COALESCE(s.credit_voucher_applicable, 0) = 0",
	    ];
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
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
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

app.get('/api/queues/enter-credit-voucher', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = [
      "po.check_po = 1",
      "po.cancel_reason IS NULL",
      "po.sent_date IS NOT NULL",
      "po.sent_date <> ''",
      "po.sent_by IS NOT NULL",
      "po.sent_by <> ''",
      "COALESCE(s.credit_voucher_applicable, 0) = 1",
      "NOT EXISTS (SELECT 1 FROM invoices inv WHERE inv.po_id = po.id)",
    ];
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
        COALESCE(SUM(gi.received_qty), 0) AS grnQty
      FROM purchase_orders po
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
      LEFT JOIN grns g ON g.po_id = po.id
      LEFT JOIN grn_items gi ON gi.grn_id = g.id AND gi.item_id = poi.item_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN credit_vouchers cv ON cv.po_id = po.id
      WHERE ${where.join(' AND ')} AND cv.id IS NULL
      GROUP BY po.id
      HAVING poQty > 1e-9 AND (poQty - grnQty) <= 1e-9
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
      pendingReason: 'Pending credit voucher',
    }));

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

    const where = [
      "po.check_po = 1",
      "po.cancel_reason IS NULL",
      "po.sent_date IS NOT NULL",
      "po.sent_date <> ''",
      "po.sent_by IS NOT NULL",
      "po.sent_by <> ''",
    ];
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
    if (f.poType) {
      where.push('po.po_type = ?');
      params.push(f.poType);
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
		        GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS priority,
		        COALESCE(SUM(COALESCE(poi.quantity, 0)), 0) AS poQty,
			        COALESCE(MAX(grnt.grnQty), 0) AS grnQty,
			        COALESCE(SUM(GREATEST(0, COALESCE(poi.quantity, 0) - COALESCE(grnq.grnQty, 0))), 0) AS pendingQty
	      FROM purchase_orders po
	      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
	      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
	      LEFT JOIN priorities p ON p.id = pri.priority_id
	      LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
	      LEFT JOIN (
	        SELECT g.po_id AS poId, SUM(gi.received_qty) AS grnQty
	        FROM grns g
	        INNER JOIN grn_items gi ON gi.grn_id = g.id
	        GROUP BY g.po_id
	      ) grnt ON grnt.poId = po.id
	      LEFT JOIN (
	        SELECT g.po_id AS poId, gi.po_item_id AS poItemId, gi.item_id AS itemId, SUM(gi.received_qty) AS grnQty
	        FROM grns g
	        INNER JOIN grn_items gi ON gi.grn_id = g.id
	        GROUP BY g.po_id, gi.po_item_id, gi.item_id
	      ) grnq ON grnq.poId = poi.po_id AND (
	        (grnq.poItemId IS NOT NULL AND grnq.poItemId = poi.id)
	        OR (grnq.poItemId IS NULL AND grnq.itemId = poi.item_id)
	      )
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      GROUP BY po.id
      HAVING pendingQty > 1e-9
      ORDER BY po.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => {
	      const pendingQty = Math.max(0, Number(r.pendingQty ?? 0));
	      const poQty = Math.max(0, Number(r.poQty ?? 0));
	      const grnQty = Math.max(0, Number(r.grnQty ?? 0));
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
	        poQty,
	        grnQty,
	        pendingQty,
        createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
	        pendingReason: 'Pending GRN',
	        priority: r.priority ? String(r.priority) : null,
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
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
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
	    // If supplier is configured for Credit Voucher (invoice not required), do not show invoice↔GRN linking queue.
	    where.push('COALESCE(s.credit_voucher_applicable, 0) = 0');

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
	        COALESCE(s.credit_voucher_applicable, 0) AS creditVoucherApplicable,
	        SUM(
	          CASE
	            WHEN GREATEST(0, COALESCE(qc.accepted_qty, 0) - COALESCE(linkq.linkedQty, 0)) > 1e-9 THEN 1
	            ELSE 0
	          END
        ) AS pendingItems
      FROM grns g
      INNER JOIN purchase_orders po ON po.id = g.po_id
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
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
app.get('/api/queues/approve-invoice', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = [
      "COALESCE(TRIM(inv.approved_by), '') = ''",
      'inv.approved_at IS NULL',
    ];
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
        inv.status AS status,
        inv.approved_by AS approvedBy,
        inv.approved_at AS approvedAt,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        pr.remarks AS prRemarks
      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.join(' AND ')}
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => ({
      invoiceId: String(r.invoiceId ?? ''),
      invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
      invoiceDate: toIsoDate(r.invoiceDate) || '',
      poId: String(r.poId ?? ''),
      poNumber: String(r.poNumber ?? r.poId ?? ''),
      prId: String(r.prId ?? ''),
      prNumber: String(r.prNumber ?? r.prId ?? ''),
      firmId: String(r.firmId ?? ''),
      firmName: String(r.firmName ?? ''),
      department: parseDepartmentFromRemarks(r.prRemarks) || 'N/A',
      supplierId: String(r.supplierId ?? ''),
      supplierName: String(r.supplierName ?? ''),
      invoiceAmount: Number(r.invoiceAmount ?? 0),
      status: mapInvoiceStatus(r),
      approvedBy: r.approvedBy != null ? String(r.approvedBy) : undefined,
      approvedAt: toIsoDateTime(r.approvedAt) || undefined,
      pendingReason: 'Pending invoice approval',
    }));
    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
	});

// Credit Vouchers pending approval
app.get('/api/queues/approve-credit-voucher', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ["cv.status IN ('Recorded','On Hold')"];
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
      where.push('DATE(cv.voucher_date) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(cv.voucher_date) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(cv.voucher_number LIKE ? OR cv.id LIKE ? OR po.po_number LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        cv.id AS creditVoucherId,
        cv.voucher_number AS voucherNo,
        cv.voucher_date AS voucherDate,
        cv.total_amount AS voucherAmount,
        cv.status AS status,
        cv.approved_by AS approvedBy,
        cv.approved_at AS approvedAt,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        pr.remarks AS prRemarks
	      FROM credit_vouchers cv
	      INNER JOIN purchase_orders po ON po.id = cv.po_id
	      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
	      LEFT JOIN firms f ON f.id = po.firm_id
	      LEFT JOIN projects proj ON proj.id = po.project_id
	      LEFT JOIN suppliers s ON s.id = po.supplier_id
	      LEFT JOIN (
	      SELECT entry_key AS creditVoucherId, SUM(adjusted_amount) AS adjustedAmount
	        FROM po_advance_invoice_adjustments
	        WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
	          AND reference_type = 'CREDIT_VOUCHER'
	        GROUP BY entry_key
	      ) adj ON adj.creditVoucherId = cv.id
	      WHERE ${where.join(' AND ')}
      ORDER BY cv.voucher_date DESC, cv.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : []).map((r) => ({
      creditVoucherId: String(r.creditVoucherId ?? ''),
      voucherNo: String(r.voucherNo ?? r.creditVoucherId ?? ''),
      voucherDate: toIsoDate(r.voucherDate) || '',
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
      voucherAmount: Number(r.voucherAmount ?? 0),
      status: String(r.status ?? 'Recorded') || 'Recorded',
      approvedBy: r.approvedBy != null ? String(r.approvedBy) : undefined,
      approvedAt: toIsoDateTime(r.approvedAt) || undefined,
      pendingReason: 'Pending credit voucher approval',
    }));

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Invoices pending tally entry
app.get('/api/queues/tally-entry', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);
    const hasPaymentMode = await columnExists(pool, 'invoices', 'payment_mode');
    const hasTallyEntryDate = await columnExists(pool, 'invoices', 'tally_entry_date');

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
        inv.approved_by AS approvedBy,
        inv.approved_at AS approvedAt,
        ${hasPaymentMode ? 'inv.payment_mode' : "'Credit'"} AS paymentMode,
        ${hasTallyEntryDate ? 'inv.tally_entry_date' : 'NULL'} AS tallyEntryDate,
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
        COALESCE(invq.totalInvoiceQty, 0) AS totalInvoiceQty,
        COALESCE(linkq.totalLinkedQty, 0) AS totalLinkedQty,
        COALESCE(qcq.totalApprovedQty, 0) AS totalApprovedQty
      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN (
        SELECT ii.invoice_id AS invoiceId, SUM(COALESCE(ii.quantity, 0)) AS totalInvoiceQty
        FROM invoice_items ii
        GROUP BY ii.invoice_id
      ) invq ON invq.invoiceId = inv.id
      LEFT JOIN (
        SELECT ii.invoice_id AS invoiceId, SUM(COALESCE(gil.linked_qty, 0)) AS totalLinkedQty
        FROM invoice_items ii
        LEFT JOIN grn_invoice_item_links gil ON gil.invoice_item_id = ii.id
        GROUP BY ii.invoice_id
      ) linkq ON linkq.invoiceId = inv.id
      LEFT JOIN (
        SELECT
          ii.invoice_id AS invoiceId,
          SUM(LEAST(COALESCE(ii.quantity, 0), COALESCE(qct.approvedQty, 0))) AS totalApprovedQty
        FROM invoice_items ii
        INNER JOIN invoices inv2 ON inv2.id = ii.invoice_id
        LEFT JOIN (
          SELECT
            g.po_id AS poId,
            qc.item_id AS itemId,
            SUM(COALESCE(qc.accepted_qty, 0)) AS approvedQty
          FROM grns g
          INNER JOIN qc_records qc ON qc.grn_id = g.id
          GROUP BY g.po_id, qc.item_id
        ) qct ON qct.poId = inv2.po_id AND qct.itemId = ii.item_id
        GROUP BY ii.invoice_id
      ) qcq ON qcq.invoiceId = inv.id
      WHERE ${where.join(' AND ')}
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const invoiceAmount = Number(r.invoiceAmount ?? 0);
        const paymentStatus = String(r.paymentStatus ?? '').toLowerCase();
        const paymentMode = r.paymentMode != null ? String(r.paymentMode) : 'Credit';
        const paymentModeLower = paymentMode.trim().toLowerCase();
        const tallyEntryDate = toIsoDate(r.tallyEntryDate) || undefined;
        const isCash = paymentModeLower === 'cash';
        const isFull = paymentStatus.includes('full') || isCash;
        const paidAmount = isFull ? invoiceAmount : 0;
        const remainingAmount = Math.max(0, invoiceAmount - paidAmount);
        return {
          invoiceId: String(r.invoiceId ?? ''),
          invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
          invoiceDate: toIsoDate(r.invoiceDate) || '',
          paymentStatus: r.paymentStatus != null ? String(r.paymentStatus) : undefined,
          paymentDate: toIsoDate(r.paymentDate) || undefined,
          approvedBy: r.approvedBy != null ? String(r.approvedBy) : undefined,
          approvedAt: toIsoDateTime(r.approvedAt) || undefined,
          paymentMode,
          tallyEntryDate,
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
          pendingReason: 'Pending tally entry',
        };
      })
      .filter((x) => x.remainingAmount > 1e-9)
      .filter((x) => String(x.paymentMode ?? '').trim().toLowerCase() !== 'cash')
      .filter((x) => {
        const approvedBy = String(x?.approvedBy ?? '').trim();
        const approvedAt = String(x?.approvedAt ?? '').trim();
        return Boolean(approvedBy) && Boolean(approvedAt);
      })
      .filter((x) => !x.tallyEntryDate);

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Invoices pending payment
app.get('/api/queues/payment', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);
    const hasPaymentMode = await columnExists(pool, 'invoices', 'payment_mode');
    const hasTallyEntryDate = await columnExists(pool, 'invoices', 'tally_entry_date');

    const where = ['1=1'];
    // IMPORTANT: do not reference optional columns in SQL WHERE.
    // Some environments may not have these columns yet; filtering is done in JS below.
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
	        inv.payment_amount AS paymentAmount,
	        inv.debit_note_qty AS debitNoteQty,
	        inv.debit_note_amount AS debitNoteAmount,
	        ${hasPaymentMode ? 'inv.payment_mode' : "'Credit'"} AS paymentMode,
	        ${hasTallyEntryDate ? 'inv.tally_entry_date' : 'NULL'} AS tallyEntryDate,
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
	        COALESCE(invq.totalInvoiceQty, 0) AS totalInvoiceQty,
	        COALESCE(linkq.totalLinkedQty, 0) AS totalLinkedQty,
	        COALESCE(qcq.totalApprovedQty, 0) AS totalApprovedQty,
	        COALESCE(adj.adjustedAmount, 0) AS adjustedAmount,
	        COALESCE(recq.actualReceiptAmount, 0) AS actualReceiptAmount
	      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN (
        SELECT ii.invoice_id AS invoiceId, SUM(COALESCE(ii.quantity, 0)) AS totalInvoiceQty
        FROM invoice_items ii
        GROUP BY ii.invoice_id
      ) invq ON invq.invoiceId = inv.id
      LEFT JOIN (
        SELECT ii.invoice_id AS invoiceId, SUM(COALESCE(gil.linked_qty, 0)) AS totalLinkedQty
        FROM invoice_items ii
        LEFT JOIN grn_invoice_item_links gil ON gil.invoice_item_id = ii.id
        GROUP BY ii.invoice_id
      ) linkq ON linkq.invoiceId = inv.id
      LEFT JOIN (
        SELECT
          ii.invoice_id AS invoiceId,
          SUM(LEAST(COALESCE(ii.quantity, 0), COALESCE(qct.approvedQty, 0))) AS totalApprovedQty
        FROM invoice_items ii
        INNER JOIN invoices inv2 ON inv2.id = ii.invoice_id
        LEFT JOIN (
          SELECT
            g.po_id AS poId,
            qc.item_id AS itemId,
            SUM(COALESCE(qc.accepted_qty, 0)) AS approvedQty
          FROM grns g
          INNER JOIN qc_records qc ON qc.grn_id = g.id
          GROUP BY g.po_id, qc.item_id
        ) qct ON qct.poId = inv2.po_id AND qct.itemId = ii.item_id
        GROUP BY ii.invoice_id
      ) qcq ON qcq.invoiceId = inv.id
	      LEFT JOIN (
	        SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS adjustedAmount
	        FROM po_advance_invoice_adjustments
	        WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
	        GROUP BY invoice_id
	      ) adj ON adj.invoiceId = inv.id
	      LEFT JOIN (
	        SELECT
	          invoice_id AS invoiceId,
	          SUM(adjusted_amount) AS actualReceiptAmount
	        FROM po_advance_invoice_adjustments
	        WHERE receipt_type = 'DIRECT_PAYMENT'
	        GROUP BY invoice_id
	      ) recq ON recq.invoiceId = inv.id
	      WHERE ${where.join(' AND ')}
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `,
      params
    );

	    let out = (Array.isArray(rows) ? rows : [])
	      .map((r) => {
			        const invoiceAmount = Number(r.invoiceAmount ?? 0);
			        const adjustedAmount = Number(r.adjustedAmount ?? 0);
			        const actualReceiptAmount = Number(r.actualReceiptAmount ?? 0);
		        const paymentStatus = String(r.paymentStatus ?? '').toLowerCase();
		        const paymentMode = r.paymentMode != null ? String(r.paymentMode) : 'Credit';
		        const paymentModeLower = paymentMode.trim().toLowerCase();
		        const tallyEntryDate = toIsoDate(r.tallyEntryDate) || undefined;

	        const paidAmount = Math.max(0, adjustedAmount) + Math.max(0, actualReceiptAmount);
	        const remainingAmount = invoiceAmount - paidAmount;
		        return {
	          invoiceId: String(r.invoiceId ?? ''),
          invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
          invoiceDate: toIsoDate(r.invoiceDate) || '',
          paymentStatus: r.paymentStatus != null ? String(r.paymentStatus) : undefined,
          paymentDate: toIsoDate(r.paymentDate) || undefined,
          paymentMode,
          tallyEntryDate,
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
	          totalInvoiceQty: Number(r.totalInvoiceQty ?? 0),
	          totalLinkedQty: Number(r.totalLinkedQty ?? 0),
	          totalApprovedQty: Number(r.totalApprovedQty ?? 0),
		          invoiceAmount,
		          adjustedAmount,
		          paidAmount,
		          remainingAmount,
		          pendingReason: remainingAmount > 1e-9 ? 'Pending payment' : 'Paid',
		        };
	      })
	      .filter((x) => x.remainingAmount > 1e-9)
	      // Relaxed rule: allow partial linking/QC. At least some invoice qty must be linked.
	      .filter((x) => Number(x.totalLinkedQty ?? 0) > 1e-9)
	      // Only "accounted" invoices become due for payment.
	      // If tally_entry_date column exists, require it to be set.
	      .filter((x) => (hasTallyEntryDate ? Boolean(x.tallyEntryDate) : true));

	    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
	    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
	});

// Credit Vouchers pending payment (PO-linked)
app.get('/api/queues/credit-voucher-payment', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);

    const where = ["cv.status = 'Approved'"];
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
      where.push('DATE(cv.voucher_date) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(cv.voucher_date) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(cv.voucher_number LIKE ? OR cv.id LIKE ? OR po.po_number LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        cv.id AS creditVoucherId,
        cv.voucher_number AS voucherNo,
        cv.voucher_date AS voucherDate,
        cv.total_amount AS voucherAmount,
        cv.payment_status AS paymentStatus,
        cv.payment_date AS paymentDate,
	        cv.payment_amount AS paymentAmount,
	        COALESCE(adj.adjustedAmount, 0) AS adjustedAmount,
	        cv.payment_mode AS paymentMode,
        cv.tally_entry_date AS tallyEntryDate,
        cv.approved_by AS approvedBy,
        cv.approved_at AS approvedAt,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        pr.remarks AS prRemarks
      FROM credit_vouchers cv
      INNER JOIN purchase_orders po ON po.id = cv.po_id
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
	      LEFT JOIN projects proj ON proj.id = po.project_id
	      LEFT JOIN suppliers s ON s.id = po.supplier_id
	      LEFT JOIN (
	        SELECT entry_key AS creditVoucherId, SUM(adjusted_amount) AS adjustedAmount
	        FROM po_advance_invoice_adjustments
	        WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
	          AND reference_type = 'CREDIT_VOUCHER'
	        GROUP BY entry_key
	      ) adj ON adj.creditVoucherId = cv.id
	      WHERE ${where.join(' AND ')}
	      ORDER BY cv.voucher_date DESC, cv.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const voucherAmount = Number(r.voucherAmount ?? 0);
        const paymentStatus = String(r.paymentStatus ?? '').toLowerCase();
        const paymentMode = r.paymentMode != null ? String(r.paymentMode) : 'Credit';
        const paymentModeLower = paymentMode.trim().toLowerCase();
        const isCash = paymentModeLower === 'cash';
        const isFull = paymentStatus.includes('full') || isCash;
	        const paidAmount = isFull ? voucherAmount : Math.max(0, Number(r.paymentAmount ?? 0) + Number(r.adjustedAmount ?? 0));
        const remainingAmount = Math.max(0, voucherAmount - paidAmount);
        return {
          creditVoucherId: String(r.creditVoucherId ?? ''),
          voucherNo: String(r.voucherNo ?? r.creditVoucherId ?? ''),
          voucherDate: toIsoDate(r.voucherDate) || '',
          paymentStatus: r.paymentStatus != null ? String(r.paymentStatus) : undefined,
          paymentDate: toIsoDate(r.paymentDate) || undefined,
          approvedBy: r.approvedBy != null ? String(r.approvedBy) : undefined,
          approvedAt: toIsoDateTime(r.approvedAt) || undefined,
          paymentMode,
          tallyEntryDate: toIsoDate(r.tallyEntryDate) || undefined,
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
          voucherAmount,
          paidAmount,
          remainingAmount,
          pendingReason: 'Pending credit voucher payment',
        };
      })
      .filter((x) => x.remainingAmount > 1e-9)
      .filter((x) => String(x.paymentMode ?? '').trim().toLowerCase() !== 'cash')
      .filter((x) => {
        const approvedBy = String(x?.approvedBy ?? '').trim();
        const approvedAt = String(x?.approvedAt ?? '').trim();
        return Boolean(approvedBy) && Boolean(approvedAt);
      });

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Invoices excess paid (negative balance)
app.get('/api/queues/excess-paid-invoices', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const f = readQueueFilters(req);
    const hasPaymentMode = await columnExists(pool, 'invoices', 'payment_mode');
    const hasTallyEntryDate = await columnExists(pool, 'invoices', 'tally_entry_date');

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
        ${hasPaymentMode ? 'inv.payment_mode' : "'Credit'"} AS paymentMode,
        ${hasTallyEntryDate ? 'inv.tally_entry_date' : 'NULL'} AS tallyEntryDate,
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
        COALESCE(invq.totalInvoiceQty, 0) AS totalInvoiceQty,
        COALESCE(linkq.totalLinkedQty, 0) AS totalLinkedQty,
        COALESCE(qcq.totalApprovedQty, 0) AS totalApprovedQty,
        COALESCE(adj.adjustedAmount, 0) AS adjustedAmount,
        COALESCE(recq.actualReceiptAmount, 0) AS actualReceiptAmount
      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN (
        SELECT ii.invoice_id AS invoiceId, SUM(COALESCE(ii.quantity, 0)) AS totalInvoiceQty
        FROM invoice_items ii
        GROUP BY ii.invoice_id
      ) invq ON invq.invoiceId = inv.id
      LEFT JOIN (
        SELECT ii.invoice_id AS invoiceId, SUM(COALESCE(gil.linked_qty, 0)) AS totalLinkedQty
        FROM invoice_items ii
        LEFT JOIN grn_invoice_item_links gil ON gil.invoice_item_id = ii.id
        GROUP BY ii.invoice_id
      ) linkq ON linkq.invoiceId = inv.id
      LEFT JOIN (
        SELECT
          ii.invoice_id AS invoiceId,
          SUM(LEAST(COALESCE(ii.quantity, 0), COALESCE(qct.approvedQty, 0))) AS totalApprovedQty
        FROM invoice_items ii
        INNER JOIN invoices inv2 ON inv2.id = ii.invoice_id
        LEFT JOIN (
          SELECT
            g.po_id AS poId,
            qc.item_id AS itemId,
            SUM(COALESCE(qc.accepted_qty, 0)) AS approvedQty
          FROM grns g
          INNER JOIN qc_records qc ON qc.grn_id = g.id
          GROUP BY g.po_id, qc.item_id
        ) qct ON qct.poId = inv2.po_id AND qct.itemId = ii.item_id
        GROUP BY ii.invoice_id
      ) qcq ON qcq.invoiceId = inv.id
      LEFT JOIN (
        SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS adjustedAmount
        FROM po_advance_invoice_adjustments
        WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
        GROUP BY invoice_id
      ) adj ON adj.invoiceId = inv.id
      LEFT JOIN (
        SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS actualReceiptAmount
        FROM po_advance_invoice_adjustments
        WHERE receipt_type = 'DIRECT_PAYMENT'
        GROUP BY invoice_id
      ) recq ON recq.invoiceId = inv.id
      WHERE ${where.join(' AND ')}
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const invoiceAmount = Number(r.invoiceAmount ?? 0);
        const adjustedAmount = Number(r.adjustedAmount ?? 0);
        const actualReceiptAmount = Number(r.actualReceiptAmount ?? 0);
        const paymentMode = r.paymentMode != null ? String(r.paymentMode) : 'Credit';
        const tallyEntryDate = toIsoDate(r.tallyEntryDate) || undefined;

        const paidAmount = Math.max(0, adjustedAmount) + Math.max(0, actualReceiptAmount);
        const remainingAmount = invoiceAmount - paidAmount;
        return {
          invoiceId: String(r.invoiceId ?? ''),
          invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
          invoiceDate: toIsoDate(r.invoiceDate) || '',
          paymentStatus: r.paymentStatus != null ? String(r.paymentStatus) : undefined,
          paymentDate: toIsoDate(r.paymentDate) || undefined,
          paymentMode,
          tallyEntryDate,
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
          totalInvoiceQty: Number(r.totalInvoiceQty ?? 0),
          totalLinkedQty: Number(r.totalLinkedQty ?? 0),
          totalApprovedQty: Number(r.totalApprovedQty ?? 0),
          invoiceAmount,
          adjustedAmount,
          paidAmount,
          remainingAmount,
          pendingReason: remainingAmount < -1e-9 ? 'Excess paid' : 'Paid',
        };
      })
      .filter((x) => x.remainingAmount < -1e-9)
      .filter((x) => Number(x.totalLinkedQty ?? 0) > 1e-9)
      .filter((x) => (hasTallyEntryDate ? Boolean(x.tallyEntryDate) : true));

    if (f.department) out = out.filter((x) => String(x.department ?? '').trim() === f.department);
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

	// Debug helper: why an invoice is/isn't in Pending Payment.
	// Mirrors the filters used by `/api/queues/payment` for a single invoice id.
	app.get('/api/debug/payment-eligibility/:id', async (req, res) => {
	  try {
	    const pool = getMysqlPool();
	    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
	    const invoiceId = String(req.params.id ?? '').trim();
	    if (!invoiceId) return res.status(400).json({ error: 'invoice id is required' });

	    const hasPaymentMode = await columnExists(pool, 'invoices', 'payment_mode');
	    const hasTallyEntryDate = await columnExists(pool, 'invoices', 'tally_entry_date');

	    const [rows] = await pool.query(
	      `
		      SELECT
		        inv.id AS invoiceId,
		        inv.invoice_number AS invoiceNo,
		        inv.invoice_date AS invoiceDate,
		        inv.total_amount AS invoiceAmount,
		        inv.payment_status AS paymentStatus,
		        inv.payment_date AS paymentDate,
		        ${hasPaymentMode ? 'inv.payment_mode' : "'Credit'"} AS paymentMode,
		        ${hasTallyEntryDate ? 'inv.tally_entry_date' : 'NULL'} AS tallyEntryDate,
		        inv.payment_amount AS paymentAmount,
		        inv.debit_note_qty AS debitNoteQty,
		        inv.debit_note_amount AS debitNoteAmount,
		        po.po_number AS poNumber,
		        f.name AS firmName,
		        s.name AS supplierName,
			        COALESCE(invq.totalInvoiceQty, 0) AS totalInvoiceQty,
			        COALESCE(linkq.totalLinkedQty, 0) AS totalLinkedQty,
			        COALESCE(qcq.totalApprovedQty, 0) AS totalApprovedQty,
			        COALESCE(adj.adjustedAmount, 0) AS adjustedAmount,
			        COALESCE(recq.actualReceiptAmount, 0) AS actualReceiptAmount
			      FROM invoices inv
		      INNER JOIN purchase_orders po ON po.id = inv.po_id
		      LEFT JOIN firms f ON f.id = po.firm_id
		      LEFT JOIN suppliers s ON s.id = po.supplier_id
	      LEFT JOIN (
	        SELECT ii.invoice_id AS invoiceId, SUM(COALESCE(ii.quantity, 0)) AS totalInvoiceQty
	        FROM invoice_items ii
	        GROUP BY ii.invoice_id
	      ) invq ON invq.invoiceId = inv.id
	      LEFT JOIN (
	        SELECT ii.invoice_id AS invoiceId, SUM(COALESCE(gil.linked_qty, 0)) AS totalLinkedQty
	        FROM invoice_items ii
	        LEFT JOIN grn_invoice_item_links gil ON gil.invoice_item_id = ii.id
	        GROUP BY ii.invoice_id
	      ) linkq ON linkq.invoiceId = inv.id
	      LEFT JOIN (
	        SELECT
	          ii.invoice_id AS invoiceId,
	          SUM(LEAST(COALESCE(ii.quantity, 0), COALESCE(qct.approvedQty, 0))) AS totalApprovedQty
	        FROM invoice_items ii
	        INNER JOIN invoices inv2 ON inv2.id = ii.invoice_id
	        LEFT JOIN (
	          SELECT
	            g.po_id AS poId,
	            qc.item_id AS itemId,
	            SUM(COALESCE(qc.accepted_qty, 0)) AS approvedQty
	          FROM grns g
	          INNER JOIN qc_records qc ON qc.grn_id = g.id
	          GROUP BY g.po_id, qc.item_id
	        ) qct ON qct.poId = inv2.po_id AND qct.itemId = ii.item_id
	        GROUP BY ii.invoice_id
		      ) qcq ON qcq.invoiceId = inv.id
		      LEFT JOIN (
		        SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS adjustedAmount
		        FROM po_advance_invoice_adjustments
		        WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
		           OR (receipt_type IS NULL AND (payment_mode IS NULL OR TRIM(payment_mode) = ''))
		        GROUP BY invoice_id
			      ) adj ON adj.invoiceId = inv.id
			      LEFT JOIN (
			        SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS actualReceiptAmount
			        FROM po_advance_invoice_adjustments
			        WHERE receipt_type = 'DIRECT_PAYMENT'
			        GROUP BY invoice_id
			      ) recq ON recq.invoiceId = inv.id
			      WHERE inv.id = ?
		      LIMIT 1
		      `,
		      [invoiceId]
		    );

    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r) return res.status(404).json({ error: 'Invoice not found' });

	    const invoiceAmount = Number(r.invoiceAmount ?? 0);
	    const adjustedAmount = Number(r.adjustedAmount ?? 0);
	    const paymentStatusLower = String(r.paymentStatus ?? '').toLowerCase();
	    const paymentMode = r.paymentMode != null ? String(r.paymentMode) : 'Credit';
	    const paymentModeLower = paymentMode.trim().toLowerCase();
		    const isCash = paymentModeLower === 'cash';
		    const isFull = paymentStatusLower.includes('full');
			    const actualReceiptAmount = Math.max(0, Number(r.actualReceiptAmount ?? 0));
			    const paidAmount = Math.max(0, adjustedAmount) + actualReceiptAmount;
				    const remainingAmount = isFull ? 0 : invoiceAmount - paidAmount;

	    const totalInvoiceQty = Number(r.totalInvoiceQty ?? 0);
	    const totalLinkedQty = Number(r.totalLinkedQty ?? 0);
	    const totalApprovedQty = Number(r.totalApprovedQty ?? 0);
	    const tallyEntryDate = toIsoDate(r.tallyEntryDate) || '';

	    const failures = [];
	    if (!(remainingAmount > 1e-9)) failures.push('Fully paid (remainingAmount is 0)');
	    if (isCash) failures.push('Payment mode is Cash (verify partial cash payments are entered correctly)');
	    if (!(totalLinkedQty > 1e-9)) failures.push('No GRN link qty yet (totalLinkedQty is 0)');
	    if (hasTallyEntryDate && !tallyEntryDate) failures.push('Tally entry date is empty');

	    const eligible =
	      remainingAmount > 1e-9 &&
	      totalLinkedQty > 1e-9 &&
	      (hasTallyEntryDate ? Boolean(tallyEntryDate) : true);

	    res.json({
	      eligible,
	      failures,
		      computed: {
        invoiceId: String(r.invoiceId ?? ''),
        invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
        invoiceDate: toIsoDate(r.invoiceDate) || '',
        poNumber: String(r.poNumber ?? ''),
        firmName: String(r.firmName ?? ''),
        supplierName: String(r.supplierName ?? ''),
        invoiceAmount,
        paymentStatus: r.paymentStatus != null ? String(r.paymentStatus) : null,
		        paymentDate: toIsoDate(r.paymentDate) || null,
		        paymentMode,
		        tallyEntryDate: tallyEntryDate || null,
		        totalInvoiceQty,
		        totalLinkedQty,
		        totalApprovedQty,
		        debitNoteQty: Number(r.debitNoteQty ?? 0),
		        debitNoteAmount,
		        remainingAmount,
		      },
	      notes: { hasTallyEntryDate },
	    });
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
        u.name AS unit,
        it.specifications_json AS specificationsJson,
        ii.quantity AS invoiceQty,
        COALESCE(grnq.receivedQty, 0) AS receivedQty,
        COALESCE(linkq.linkedQty, 0) AS linkedQty
      FROM invoice_items ii
      INNER JOIN invoices inv ON inv.id = ii.invoice_id
      LEFT JOIN items it ON it.id = ii.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      LEFT JOIN units u ON u.id = iname.unit_id
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
      unit: r.unit != null ? String(r.unit) : null,
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
        COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(it.unit), ''), '') AS unit,
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
      LEFT JOIN units u ON u.id = iname.unit_id
      WHERE gi.grn_id = ?
      ORDER BY iname.name ASC
      `,
      [grnId]
    );

    const grnItemIds = Array.from(
      new Set((Array.isArray(grnItemRows) ? grnItemRows : []).map((r) => String(r.grnItemId ?? '')).filter(Boolean))
    );
    const itemIds = Array.from(
      new Set((Array.isArray(grnItemRows) ? grnItemRows : []).map((r) => String(r.itemId ?? '')).filter(Boolean))
    );
    const usedInvoiceItemIdsByGrnItemId = new Map();
    if (grnItemIds.length) {
      const placeholders = grnItemIds.map(() => '?').join(',');
      const [usedRows] = await pool.query(
        `
        SELECT grn_item_id AS grnItemId, invoice_item_id AS invoiceItemId
        FROM grn_invoice_item_links
        WHERE grn_item_id IN (${placeholders})
        `,
        grnItemIds
      );
      for (const row of Array.isArray(usedRows) ? usedRows : []) {
        const grnItemId = String(row.grnItemId ?? '').trim();
        const invoiceItemId = String(row.invoiceItemId ?? '').trim();
        if (!grnItemId || !invoiceItemId) continue;
        const bucket = usedInvoiceItemIdsByGrnItemId.get(grnItemId) ?? new Set();
        bucket.add(invoiceItemId);
        usedInvoiceItemIdsByGrnItemId.set(grnItemId, bucket);
      }
    }

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
          unit: String(r.unit ?? '').trim(),
          specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
          grnQty: Number(r.grnQty ?? 0),
          approvedQty,
          alreadyLinkQty,
          pendingLinkingQty,
          candidates: (invCandidatesByItemId.get(String(r.itemId ?? '')) ?? []).filter((candidate) => {
            const used = usedInvoiceItemIdsByGrnItemId.get(String(r.grnItemId ?? '').trim());
            return !used || !used.has(String(candidate.invoiceItemId ?? '').trim());
          }),
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
        pr.store_id AS storeId,
        st.name AS store,
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
      LEFT JOIN stores st ON st.id = pr.store_id
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
      store: r.store ? String(r.store) : null,
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

async function fetchPrHeaderAndItems(pool, prId) {
  const [[prRow]] = await pool.query(
    `
    SELECT
      pr.id,
      pr.pr_number AS prNumber,
      pr.firm_id AS firmId,
      f.name AS firmName,
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
    LEFT JOIN firms f ON f.id = pr.firm_id
    WHERE pr.id = ?
    GROUP BY pr.id
    `,
    [prId]
  );
  if (!prRow) return null;

  const [itemRows] = await pool.query(
    `
    SELECT
      pri.id,
      pri.pr_id AS prId,
      pri.item_id AS itemId,
      iname.name AS item,
      u.name AS unit,
      pri.requested_qty AS quantity,
      pri.priority_id AS priorityId,
      p.name AS priority,
      pri.remarks AS specification
    FROM purchase_requisition_items pri
    LEFT JOIN items it ON it.id = pri.item_id
    LEFT JOIN item_names iname ON iname.id = it.item_name_id
    LEFT JOIN units u ON u.id = iname.unit_id
    LEFT JOIN priorities p ON p.id = pri.priority_id
    WHERE pri.pr_id = ?
    ORDER BY pri.created_at ASC
    `,
    [prId]
  );

  const pr = {
    id: String(prRow.id),
    prNumber: prRow.prNumber ? String(prRow.prNumber) : undefined,
    firmId: String(prRow.firmId ?? ''),
    firmName: prRow.firmName != null ? String(prRow.firmName) : '',
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

  const items = (Array.isArray(itemRows) ? itemRows : []).map((r) => ({
    id: String(r.id),
    prId: String(r.prId),
    itemId: String(r.itemId),
    item: String(r.item || ''),
    quantity: Number(r.quantity ?? 0),
    priorityId: r.priorityId ? String(r.priorityId) : null,
    priority: r.priority ? String(r.priority) : null,
    specification: String(r.specification ?? ''),
  }));

  return { pr, items };
}

async function fetchPoHeaderAndItems(pool, poId) {
  const [[poRow]] = await pool.query(
    `
    SELECT
      po.id AS id,
      po.pr_id AS prId,
      po.firm_id AS firmId,
      po.store_id AS storeId,
      po.project_id AS projectId,
      po.po_number AS poNumber,
      po.order_date AS orderDate,
      po.payment_terms AS paymentTerms,
      po.payment_type AS paymentType,
      po.payment_mode AS paymentMode,
      po.shipping_address AS shippingAddress,
      po.terms_conditions AS termsConditions,
      po.advance_amount AS advanceAmount,
      po.advance_date AS advanceDate,
      po.cancel_reason AS cancelReason,
      po.cancelled_by AS cancelledBy,
      po.cancelled_at AS cancelledAt,
      po.remarks AS remarks,
      po.draft_payload AS draftPayload,
      po.po_source AS poSource,
      po.requested_by AS requestedBy,
      po.required_date AS requiredDate,
      po.po_type AS poType,
      po.status AS status,
      po.created_by AS createdBy,
      po.created_at AS createdAt,
      po.updated_at AS updatedAt,
      po.supplier_id AS supplierId,
      s.name AS supplier
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
    LIMIT 1
    `,
    [poId]
  );
  if (!poRow) return null;
  const draftPayload = parseJsonObject(poRow.draftPayload, {});
  const isDraft = String(poRow.status ?? '').trim().toLowerCase() === 'draft';

  const [poItemRows] = await pool.query(
    `
    SELECT
      poi.id AS id,
      poi.po_id AS poId,
      poi.item_id AS itemId,
      iname.name AS item,
      u.name AS unit,
      it.item_name_id AS itemNameId,
      it.specifications_json AS specificationsJson,
      COALESCE(poi.description, it.description) AS description,
      poi.quantity AS quantity,
      poi.rate AS rate,
      poi.discount_percent AS discountPercent,
      poi.tax_percent AS taxPercent,
      poi.cancelled_qty AS cancelledQty,
      poi.cancel_reason AS cancelReason,
      poi.goods_amount AS goodsAmount,
      poi.tax_amount AS taxAmount,
      poi.total_amount AS totalAmount,
      poi.dim_length AS dimLength,
      poi.dim_breadth AS dimBreadth,
      poi.dim_pcs AS dimPcs,
      poi.dim_unit AS dimUnit,
      poi.remarks AS remarks
    FROM purchase_order_items poi
    LEFT JOIN items it ON it.id = poi.item_id
    LEFT JOIN item_names iname ON iname.id = it.item_name_id
    LEFT JOIN units u ON u.id = iname.unit_id
    WHERE poi.po_id = ?
    ORDER BY COALESCE(poi.line_order, 999999) ASC, poi.created_at ASC, poi.id ASC
    `,
    [poId]
  );

  const po = {
    id: String(poRow.id ?? ''),
    poNumber: poRow.poNumber != null ? String(poRow.poNumber) : undefined,
    prId: poRow.prId != null ? String(poRow.prId) : '',
    firmId: poRow.firmId != null ? String(poRow.firmId) : undefined,
    storeId: poRow.storeId != null ? String(poRow.storeId) : undefined,
    projectId: poRow.projectId != null ? String(poRow.projectId) : undefined,
    orderDate: toIsoDate(poRow.orderDate) || '',
    paymentTerms: poRow.paymentTerms != null ? String(poRow.paymentTerms) : poDraftHeaderValue(poRow, draftPayload, 'paymentTerms') ?? undefined,
    paymentType: poRow.paymentType != null ? String(poRow.paymentType) : poDraftHeaderValue(poRow, draftPayload, 'paymentType') ?? undefined,
    paymentMode: poRow.paymentMode != null ? String(poRow.paymentMode) : poDraftHeaderValue(poRow, draftPayload, 'paymentMode') ?? undefined,
    shippingAddress:
      poRow.shippingAddress != null ? String(poRow.shippingAddress) : poDraftHeaderValue(poRow, draftPayload, 'shippingAddress') ?? undefined,
    termsConditions:
      poRow.termsConditions != null ? String(poRow.termsConditions) : poDraftHeaderValue(poRow, draftPayload, 'termsConditions') ?? undefined,
    advanceAmount: Number(poRow.advanceAmount ?? 0),
    advanceDate: toIsoDate(poRow.advanceDate) || null,
    cancelReason: poRow.cancelReason != null ? String(poRow.cancelReason) : null,
    cancelledBy: poRow.cancelledBy != null ? String(poRow.cancelledBy) : null,
    cancelledAt: toIsoDateTime(poRow.cancelledAt) || null,
    createdBy: poRow.createdBy != null ? String(poRow.createdBy) : undefined,
    supplierId: poRow.supplierId != null ? String(poRow.supplierId) : poDraftHeaderValue(poRow, draftPayload, 'supplierId') ?? undefined,
    supplier: String(poRow.supplier ?? poDraftHeaderValue(poRow, draftPayload, 'supplier') ?? ''),
    requestedBy: poRow.requestedBy != null ? String(poRow.requestedBy) : poDraftHeaderValue(poRow, draftPayload, 'requestedBy') ?? undefined,
    requiredDate: toIsoDate(poRow.requiredDate) || poDraftHeaderValue(poRow, draftPayload, 'requiredDate') || null,
    remarks: poRow.remarks != null ? String(poRow.remarks) : poDraftHeaderValue(poRow, draftPayload, 'remarks') ?? undefined,
    poType: poRow.poType != null ? String(poRow.poType) : poDraftHeaderValue(poRow, draftPayload, 'poType') ?? 'Goods',
    sourceType: normalizePoSource(poRow.poSource || draftPayload?.sourceType),
    status: mapPoStatus(poRow.status),
    createdAt: toIsoDateTime(poRow.createdAt) || new Date().toISOString(),
    updatedAt: toIsoDateTime(poRow.updatedAt) || toIsoDateTime(poRow.createdAt) || new Date().toISOString(),
    draftPayload: isDraft ? draftPayload : undefined,
  };

  const [specRows] = await pool.query('SELECT id, name FROM specifications ORDER BY name');
  const specNameById = new Map((Array.isArray(specRows) ? specRows : []).map((r) => [String(r.id ?? '').trim(), String(r.name ?? '').trim()]));
  const formatSpecParts = (specificationsJson) => {
    const raw = String(specificationsJson ?? '').trim();
    if (!raw) return [];
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return [];
      const out = [];
      for (const [k, v] of Object.entries(obj)) {
        const val = String(v ?? '').trim();
        if (!val) continue;
        const name = specNameById.get(String(k ?? '').trim()) || '';
        out.push(name ? `${name}: ${val}` : val);
      }
      return out;
    } catch {
      return raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  };

  const items = (Array.isArray(poItemRows) ? poItemRows : []).map((r) => ({
    id: String(r.id ?? ''),
    poId: String(r.poId ?? ''),
    itemId: String(r.itemId ?? ''),
    item: String(r.item ?? ''),
    description: r.description != null ? String(r.description) : undefined,
    itemNameId: r.itemNameId != null ? String(r.itemNameId) : null,
    itemLabel: [String(r.item ?? '').trim(), ...formatSpecParts(r.specificationsJson)].filter(Boolean).join(' - ') || String(r.item ?? ''),
    specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
    unit: String(r.unit ?? '').trim(),
    quantity: Number(r.quantity ?? 0),
    rate: Number(r.rate ?? 0),
    discountPercent: r.discountPercent != null ? Number(r.discountPercent) : undefined,
    taxPercent: r.taxPercent != null ? Number(r.taxPercent) : undefined,
    goodsAmount: r.goodsAmount != null ? Number(r.goodsAmount) : undefined,
    taxAmount: r.taxAmount != null ? Number(r.taxAmount) : undefined,
    totalAmount: r.totalAmount != null ? Number(r.totalAmount) : undefined,
    remarks: r.remarks != null ? String(r.remarks) : undefined,
  }));

  const draftItems =
    isDraft && !items.length
      ? normalizePoDraftLines(draftPayload?.lines).map((r) => ({
          id: String(r.id ?? ''),
          poId: String(poRow.id ?? ''),
          itemId: String(r.itemId ?? ''),
          item: String(r.item ?? ''),
	          description: r.description != null ? String(r.description) : undefined,
          itemLabel: String(r.itemLabel ?? r.item ?? ''),
          specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
          unit: String(r.unit ?? '').trim(),
          quantity: Number(r.quantity ?? 0),
          rate: Number(r.rate ?? 0),
          discountPercent: Number(r.discountPercent ?? 0),
          taxPercent: Number(r.taxPercent ?? 0),
          goodsAmount: Number(r.quantity ?? 0) * Number(r.rate ?? 0),
          taxAmount: 0,
          totalAmount: Number(r.quantity ?? 0) * Number(r.rate ?? 0),
          specs: r.specs ?? {},
          itemNameId: r.itemNameId ?? null,
          dimLength: r.dimLength != null ? Number(r.dimLength) : null,
          dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : null,
          dimPcs: r.dimPcs != null ? Number(r.dimPcs) : null,
          dimUnit: r.dimUnit != null ? String(r.dimUnit) : null,
        }))
      : [];

  return { po, items: items.length ? items : draftItems };
}

async function resolveSupplierInput(pool, supplierIdRaw, supplierNameRaw) {
  const supplierId = String(supplierIdRaw ?? '').trim();
  const supplierName = String(supplierNameRaw ?? '').trim();
  if (supplierId) {
    const [[row]] = await pool.query('SELECT id, name FROM suppliers WHERE id = ? LIMIT 1', [supplierId]);
    if (!row?.id) return { supplierId: null, supplierName: supplierName || null };
    return { supplierId: String(row.id), supplierName: String(row.name ?? supplierName) };
  }
  if (supplierName) {
    const [rows] = await pool.query('SELECT id, name FROM suppliers WHERE name = ? LIMIT 1', [supplierName]);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.id) return { supplierId: null, supplierName };
    return { supplierId: String(row.id), supplierName: String(row.name ?? supplierName) };
  }
  return { supplierId: null, supplierName: null };
}

async function insertPoDraft(pool, input) {
  const payload = {
    ...buildPoDraftPayload(input),
    sourceType: normalizePoSource(input.sourceType),
  };
  const poId = crypto.randomUUID();
  const poNumber = await allocateDocNumber(pool, input.firmId, 'PO', new Date());
  await pool.query(
    `
    INSERT INTO purchase_orders
      (id, po_number, firm_id, store_id, project_id, supplier_id, pr_id, po_type, po_source, status, order_date, payment_terms, payment_type, payment_mode, advance_amount, advance_date, remarks, requested_by, required_date, draft_payload, created_by, created_at, updated_at, shipping_address, terms_conditions)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)
    `,
    [
      poId,
      poNumber,
      validIdOrNull(input.firmId),
      validIdOrNull(input.storeId),
      validIdOrNull(input.projectId),
      validIdOrNull(input.supplierId),
      validIdOrNull(input.prId),
      validTextOrNull(input.poType) || 'Goods',
      normalizePoSource(input.sourceType),
      validTextOrNull(input.paymentTerms),
      validTextOrNull(input.paymentType),
      validTextOrNull(input.paymentMode),
      Math.max(0, num(input.advanceAmount, 0)),
      input.advanceDate === null ? null : toIsoDate(validTextOrNull(input.advanceDate)),
      validTextOrNull(input.remarks),
      validTextOrNull(input.requestedBy),
      toIsoDate(validTextOrNull(input.requiredDate)),
      JSON.stringify(payload),
      'system',
      validTextOrNull(input.shippingAddress),
      validTextOrNull(input.termsConditions),
    ]
  );
  return fetchPoHeaderAndItems(pool, poId);
}

async function updatePoDraft(pool, poId, input) {
  const payload = {
    ...buildPoDraftPayload(input),
    sourceType: normalizePoSource(input.sourceType),
  };
  await pool.query(
    `
    UPDATE purchase_orders
    SET firm_id = ?,
        store_id = ?,
        project_id = ?,
        supplier_id = ?,
        pr_id = ?,
        po_type = ?,
        po_source = ?,
        payment_terms = ?,
        payment_type = ?,
        payment_mode = ?,
        advance_amount = ?,
        advance_date = ?,
        remarks = ?,
        requested_by = ?,
        required_date = ?,
        shipping_address = ?,
        terms_conditions = ?,
        draft_payload = ?,
        updated_by = ?,
        updated_at = NOW()
    WHERE id = ?
    `,
    [
      validIdOrNull(input.firmId),
      validIdOrNull(input.storeId),
      validIdOrNull(input.projectId),
      validIdOrNull(input.supplierId),
      validIdOrNull(input.prId),
      validTextOrNull(input.poType) || 'Goods',
      normalizePoSource(input.sourceType),
      validTextOrNull(input.paymentTerms),
      validTextOrNull(input.paymentType),
      validTextOrNull(input.paymentMode),
      Math.max(0, num(input.advanceAmount, 0)),
      input.advanceDate === null ? null : toIsoDate(validTextOrNull(input.advanceDate)),
      validTextOrNull(input.remarks),
      validTextOrNull(input.requestedBy),
      toIsoDate(validTextOrNull(input.requiredDate)),
      validTextOrNull(input.shippingAddress),
      validTextOrNull(input.termsConditions),
      JSON.stringify(payload),
      'system',
      poId,
    ]
  );
  return fetchPoHeaderAndItems(pool, poId);
}

async function resolveDraftPoItemId(pool, row, poType) {
  let itemId = String(row?.itemId ?? '').trim();
  if (!itemId) {
    const itemNameId = String(row?.itemNameId ?? '').trim();
    const specsObj = normalizeSpecsMap(row?.specs);
    if (!itemNameId) return null;
    const specificationsJson = stableJsonStringifySorted(specsObj);
    const uniqueKey = `${itemNameId}:${sha256(specificationsJson).slice(0, 16)}`;
    const [[found]] = await pool.query('SELECT id FROM items WHERE unique_key=? LIMIT 1', [uniqueKey]);
    if (found?.id) {
      itemId = String(found.id);
    } else {
      const newId = crypto.randomUUID();
      const itemCode = `IT-${newId.slice(0, 8).toUpperCase()}`;
      const [[meta]] = await pool.query(
        `
        SELECT n.type AS type, u.name AS unitName
        FROM item_names n
        LEFT JOIN units u ON u.id = n.unit_id
        WHERE n.id = ?
        LIMIT 1
        `,
        [itemNameId]
      );
      const unitName = meta?.unitName != null ? String(meta.unitName) : null;
      await pool.query(
        `
        INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, reorder_level, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, NOW(), NOW())
        `,
        [newId, itemNameId, itemCode, specificationsJson, uniqueKey, unitName, 'system']
      );
      itemId = newId;
    }
  }
  if (!itemId) return null;
  const [[typeRow]] = await pool.query(
    `
    SELECT n.type AS type
    FROM items it
    JOIN item_names n ON n.id = it.item_name_id
    WHERE it.id = ?
    LIMIT 1
    `,
    [itemId]
  );
  const itemType = String(typeRow?.type ?? '').trim() || 'Goods';
  if (poType === 'Goods' && itemType === 'Services') throw new Error('PO Type is Goods. Service item is not allowed.');
  if (poType === 'Services' && itemType === 'Goods') throw new Error('PO Type is Services. Goods item is not allowed.');
  return itemId;
}

async function replacePoItemsForIssue(pool, poId, items, poType) {
  await pool.query('DELETE FROM purchase_order_items WHERE po_id = ?', [poId]);
  for (const [lineIndex, row] of items.entries()) {
    const itemId = await resolveDraftPoItemId(pool, row, poType);
    if (!itemId) throw new Error('Each item requires item selection.');
    const quantityInput = Number(row?.quantity ?? 0);
    const rate = Number(row?.rate ?? 0);
    const discountPercent = row?.discountPercent != null ? Number(row.discountPercent) : null;
    const taxPercent = row?.taxPercent != null ? Number(row.taxPercent) : null;
    const [[unitRow]] = await pool.query('SELECT unit FROM items WHERE id = ? LIMIT 1', [itemId]);
    const unitNameForRow = unitRow?.unit != null ? String(unitRow.unit) : null;
    const areaUnit = normalizeAreaUnitName(unitNameForRow);
    const dimUnit = baseDimUnitForAreaUnit(areaUnit);
    const dimLengthInput = row?.length ?? row?.dimLength ?? row?.dim_length;
    const dimBreadthInput = row?.breadth ?? row?.dimBreadth ?? row?.dim_breadth;
    const dimPcsInput = row?.pcs ?? row?.dimPcs ?? row?.dim_pcs;
    const dimLength = dimLengthInput != null && String(dimLengthInput).trim() !== '' ? num(dimLengthInput, NaN) : NaN;
    const dimBreadth = dimBreadthInput != null && String(dimBreadthInput).trim() !== '' ? num(dimBreadthInput, NaN) : NaN;
    const dimPcs = dimPcsInput != null && String(dimPcsInput).trim() !== '' ? num(dimPcsInput, NaN) : 1;
    const quantityRaw = areaUnit ? computeAreaQty(dimLength, dimBreadth, dimPcs) : quantityInput;
    const quantity = round2(quantityRaw);
    if (areaUnit) {
      if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) throw new Error('Each area-unit PO item requires valid length, breadth and PCs');
    } else if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) {
      throw new Error('Each item requires valid quantity');
    }
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Each item requires valid rate');
    const disc = Number.isFinite(discountPercent) ? Math.max(0, discountPercent) : 0;
    const tax = Number.isFinite(taxPercent) ? Math.max(0, taxPercent) : 0;
    const gross = quantity * rate;
    const goodsAmount = gross * (1 - disc / 100);
    const taxAmount = goodsAmount * (tax / 100);
    const totalAmount = goodsAmount + taxAmount;
    await pool.query(
      `
      INSERT INTO purchase_order_items
        (id, po_id, item_id, description, quantity, rate, discount_percent, tax_percent, goods_amount, tax_amount, total_amount, created_by, created_at, updated_at, dim_length, dim_breadth, dim_pcs, dim_unit, remarks, line_order)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?)
      `,
      [
        crypto.randomUUID(),
        poId,
        itemId,
        validTextOrNull(row?.description),
        quantity,
        rate,
        disc,
        tax,
        goodsAmount,
        taxAmount,
        totalAmount,
        'system',
        areaUnit ? round2(dimLength) : null,
        areaUnit ? round2(dimBreadth) : null,
        areaUnit ? Math.trunc(dimPcs) : null,
        areaUnit ? dimUnit : null,
        validTextOrNull(row?.remarks),
        lineIndex,
      ]
    );
  }
}

async function fetchGrnDetail(pool, grnId) {
  const [[grnRow]] = await pool.query(
    `
    SELECT
      g.id AS id,
      g.po_id AS poId,
      g.grn_number AS grnNumber,
      g.received_date AS receivedDate,
      g.created_at AS createdAt,
      po.supplier_id AS supplierId,
      sup.name AS supplier,
      po.status AS poStatus
    FROM grns g
    INNER JOIN purchase_orders po ON po.id = g.po_id
    LEFT JOIN suppliers sup ON sup.id = po.supplier_id
    WHERE g.id = ?
    LIMIT 1
    `,
    [grnId]
  );
  if (!grnRow) return null;

  const [itemRows] = await pool.query(
    `
    SELECT
      gi.id AS id,
	      gi.grn_id AS grnId,
	      gi.item_id AS itemId,
	      iname.name AS item,
	      u.name AS unit,
	      gi.received_qty AS quantityReceived,
	      COALESCE(qc.approvedQty, gi.received_qty, 0) AS approvedQty,
	      COALESCE(linkq.invoiceLinkQty, 0) AS invoiceLinkQty,
	      COALESCE(qc.rejectedQty, 0) AS rejectedQty,
        gi.recv_dim_length AS dimLength,
	        gi.recv_dim_breadth AS dimBreadth,
	        gi.recv_dim_pcs AS dimPcs,
	        gi.recv_dim_input_unit AS dimUnit,
	        gi.weight AS weight,
	        it.specifications_json AS specificationsJson
	    FROM grn_items gi
	    LEFT JOIN items it ON it.id = gi.item_id
	    LEFT JOIN item_names iname ON iname.id = it.item_name_id
	    LEFT JOIN units u ON u.id = iname.unit_id
	    LEFT JOIN (
	      SELECT grn_id AS grnId, item_id AS itemId, SUM(COALESCE(accepted_qty, 0)) AS approvedQty, SUM(COALESCE(rejected_qty, 0)) AS rejectedQty
	      FROM qc_records
	      GROUP BY grn_id, item_id
	    ) qc ON qc.grnId = gi.grn_id AND qc.itemId = gi.item_id
	    LEFT JOIN (
	      SELECT grn_item_id AS grnItemId, SUM(COALESCE(linked_qty, 0)) AS invoiceLinkQty
	      FROM grn_invoice_item_links
	      GROUP BY grn_item_id
	    ) linkq ON linkq.grnItemId = gi.id
	    WHERE gi.grn_id = ?
	    ORDER BY gi.created_at ASC
    `,
    [grnId]
  );

  const grn = {
    id: String(grnRow.id ?? ''),
    poId: String(grnRow.poId ?? ''),
    invoiceId: '',
    receivedDate: toIsoDate(grnRow.receivedDate) || '',
    createdAt: toIsoDateTime(grnRow.createdAt) || new Date().toISOString(),
    grnNumber: grnRow.grnNumber != null ? String(grnRow.grnNumber) : undefined,
  };

  const items = (Array.isArray(itemRows) ? itemRows : []).map((r) => ({
    id: String(r.id ?? ''),
	    grnId: String(r.grnId ?? ''),
	    itemId: String(r.itemId ?? ''),
	    item: String(r.item ?? ''),
      specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
	    unit: String(r.unit ?? '').trim(),
	    quantityReceived: Number(r.quantityReceived ?? 0),
	    approvedQty: Number(r.approvedQty ?? 0),
	    invoiceLinkQty: Number(r.invoiceLinkQty ?? 0),
	    rejectedQty: Number(r.rejectedQty ?? 0),
	    dimLength: r.dimLength != null ? Number(r.dimLength) : null,
	    dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : null,
	    dimPcs: r.dimPcs != null ? Number(r.dimPcs) : null,
	    dimUnit: r.dimUnit != null ? String(r.dimUnit) : undefined,
	    weight: r.weight != null ? Number(r.weight) : null,
	  }));

  const po = {
    id: String(grnRow.poId ?? ''),
    supplierId: grnRow.supplierId != null ? String(grnRow.supplierId) : undefined,
    supplier: String(grnRow.supplier ?? ''),
    status: mapPoStatus(grnRow.poStatus),
  };

  return { grn: { grn, items }, po: { po, items: [] } };
}

async function fetchInvoiceHeaderAndItems(pool, invoiceId) {
  const [[invRow]] = await pool.query(
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
      inv.payment_mode AS paymentMode,
      inv.payment_amount AS paymentAmount,
      inv.debit_note_qty AS debitNoteQty,
      inv.debit_note_amount AS debitNoteAmount,
      inv.debit_note_reason AS debitNoteReason,
      inv.tally_entry_date AS tallyEntryDate,
      COALESCE(adj.adjustedAmount, 0) AS adjustedAmount,
      inv.document_url AS documentUrl,
      inv.cn_copy_url AS cnCopyUrl,
      inv.eway_bill_url AS ewayBillUrl,
      inv.eway_bill_number AS ewayBillNumber,
      inv.cn_number AS cnNumber,
      inv.courier_number AS courierNumber,
      inv.transporter_name AS transporterName,
      inv.status AS status,
      inv.created_by AS createdBy,
      inv.created_at AS createdAt,
      inv.updated_by AS updatedBy,
      inv.updated_at AS updatedAt
    FROM invoices inv
    LEFT JOIN (
      SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS adjustedAmount
      FROM po_advance_invoice_adjustments
      WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
         OR (receipt_type IS NULL AND (payment_mode IS NULL OR TRIM(payment_mode) = ''))
      GROUP BY invoice_id
    ) adj ON adj.invoiceId = inv.id
    WHERE inv.id = ?
    LIMIT 1
    `,
    [invoiceId]
  );
  if (!invRow) return null;

  const [itemRows] = await pool.query(
    `
    SELECT
      ii.id AS id,
      ii.invoice_id AS invoiceId,
      ii.item_id AS itemId,
      iname.name AS item,
      u.name AS unit,
      (
        SELECT poi.dim_unit
        FROM purchase_order_items poi
        WHERE poi.po_id = ? AND poi.item_id = ii.item_id
        LIMIT 1
      ) AS poDimUnit,
      ii.quantity AS quantity,
      ii.rate AS rate,
      ii.tax_percent AS taxPercent,
      (ii.quantity * ii.rate) AS totalAmount,
      ii.dim_length AS dimLength,
      ii.dim_breadth AS dimBreadth,
      ii.dim_pcs AS dimPcs,
      ii.dim_input_unit AS dimUnit,
      it.specifications_json AS specificationsJson
    FROM invoice_items ii
    LEFT JOIN items it ON it.id = ii.item_id
    LEFT JOIN item_names iname ON iname.id = it.item_name_id
    LEFT JOIN units u ON u.id = iname.unit_id
    WHERE ii.invoice_id = ?
    ORDER BY ii.created_at ASC
    `,
    [String(invRow.poId), invoiceId]
  );

  const invoice = {
    id: String(invRow.id ?? ''),
    poId: String(invRow.poId ?? ''),
    supplierInvoiceNo: String(invRow.supplierInvoiceNo ?? invRow.id ?? ''),
    invoiceDate: toIsoDate(invRow.invoiceDate) || '',
    invoiceAmount: Number(invRow.invoiceAmount ?? 0),
    courierCharge: Number(invRow.courierCharge ?? 0),
    packingCharge: Number(invRow.packingCharge ?? 0),
    labourCharge: Number(invRow.labourCharge ?? 0),
    otherCharge: Number(invRow.otherCharge ?? 0),
    chargesGstAmount: Number(invRow.chargesGstAmount ?? 0),
    status: mapInvoiceStatus(invRow),
    paymentStatus: invRow.paymentStatus != null ? String(invRow.paymentStatus) : undefined,
    paymentDate: toIsoDate(invRow.paymentDate) || undefined,
    paymentMode: invRow.paymentMode != null ? String(invRow.paymentMode) : 'Credit',
    paymentAmount: Number(invRow.paymentAmount ?? 0),
    debitNoteQty: Number(invRow.debitNoteQty ?? 0),
    debitNoteAmount: Number(invRow.debitNoteAmount ?? 0),
    debitNoteReason: invRow.debitNoteReason != null ? String(invRow.debitNoteReason) : undefined,
    adjustedAmount: Number(invRow.adjustedAmount ?? 0),
    tallyEntryDate: toIsoDate(invRow.tallyEntryDate) || undefined,
    documentUrl: invRow.documentUrl != null ? String(invRow.documentUrl) : undefined,
    cnCopyUrl: invRow.cnCopyUrl != null ? String(invRow.cnCopyUrl) : undefined,
    ewayBillUrl: invRow.ewayBillUrl != null ? String(invRow.ewayBillUrl) : undefined,
    ewayBillNumber: invRow.ewayBillNumber != null ? String(invRow.ewayBillNumber) : undefined,
    cnNumber: invRow.cnNumber != null ? String(invRow.cnNumber) : undefined,
    courierNumber: invRow.courierNumber != null ? String(invRow.courierNumber) : undefined,
    transporterName: invRow.transporterName != null ? String(invRow.transporterName) : undefined,
    createdBy: invRow.createdBy != null ? String(invRow.createdBy) : undefined,
    createdAt: toIsoDateTime(invRow.createdAt) || new Date().toISOString(),
    updatedBy: invRow.updatedBy != null ? String(invRow.updatedBy) : undefined,
    updatedAt: toIsoDateTime(invRow.updatedAt) || undefined,
  };

  const items = (Array.isArray(itemRows) ? itemRows : []).map((r) => ({
    id: String(r.id ?? ''),
    invoiceId: String(r.invoiceId ?? ''),
    itemId: String(r.itemId ?? ''),
    item: String(r.item ?? ''),
    unit: r.unit != null ? String(r.unit) : undefined,
    poDimUnit: r.poDimUnit != null ? String(r.poDimUnit) : undefined,
    specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
    quantity: Number(r.quantity ?? 0),
    rate: Number(r.rate ?? 0),
    taxPercent: Number(r.taxPercent ?? 0),
    totalAmount: Number(r.totalAmount ?? 0),
    dimLength: r.dimLength != null ? Number(r.dimLength) : null,
    dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : null,
    dimPcs: r.dimPcs != null ? Number(r.dimPcs) : null,
    dimUnit: r.dimUnit != null ? String(r.dimUnit) : null,
  }));

  return { invoice, items };
}

function toPaymentRowFromInvoice(inv) {
  if (!inv) return null;
  const status = inv.paymentStatus != null ? String(inv.paymentStatus) : null;
  if (!status) return null;
  return {
    id: String(inv.id ?? ''),
    paymentDate: toIsoDate(inv.paymentDate) || toIsoDate(inv.updatedAt) || toIsoDate(inv.invoiceDate) || '',
    amount: Number(inv.invoiceAmount ?? 0),
    mode: undefined,
    referenceNo: undefined,
    status,
  };
}

app.get('/api/operations/prs/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });

    const pr = await fetchPrHeaderAndItems(pool, prId);
    if (!pr) return res.status(404).json({ error: 'PR not found' });

    // Linked POs (with items)
    const [poRows] = await pool.query(
      `
      SELECT
        po.id AS id
      FROM purchase_orders po
      WHERE po.pr_id = ?
      ORDER BY po.created_at ASC
      `,
      [prId]
    );
    const poIds = (Array.isArray(poRows) ? poRows : []).map((r) => String(r.id ?? '')).filter(Boolean);
    const pos = [];
    for (const poId of poIds) {
      const poDetail = await fetchPoHeaderAndItems(pool, poId);
      if (poDetail) pos.push(poDetail);
    }

    // Linked GRNs (with items)
    const [grnRows] = await pool.query(
      `
      SELECT g.id AS id
      FROM grns g
      INNER JOIN purchase_orders po ON po.id = g.po_id
      WHERE po.pr_id = ?
      ORDER BY g.received_date DESC, g.created_at DESC
      `,
      [prId]
    );
    const grnIds = (Array.isArray(grnRows) ? grnRows : []).map((r) => String(r.id ?? '')).filter(Boolean);
    const grns = [];
    for (const grnId of grnIds) {
      const g = await fetchGrnDetail(pool, grnId);
      if (g) grns.push(g.grn);
    }

    // Linked Invoices (with items)
    const [invRows] = await pool.query(
      `
      SELECT inv.id AS id
      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      WHERE po.pr_id = ?
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `,
      [prId]
    );
    const invIds = (Array.isArray(invRows) ? invRows : []).map((r) => String(r.id ?? '')).filter(Boolean);
    const invoices = [];
    for (const invId of invIds) {
      const inv = await fetchInvoiceHeaderAndItems(pool, invId);
      if (inv) invoices.push({ invoice: inv.invoice, items: inv.items });
    }

    const invoice = invoices.length ? invoices[0] : null;

    // Payments are stored on invoices; treat each paid invoice as a payment row.
    const payments = [];
    for (const inv of invoices) {
      const p = toPaymentRowFromInvoice(inv?.invoice);
      if (p) payments.push(p);
    }

    const paymentsByInvoiceId = {};
    for (const p of payments) {
      const invoiceId = String(p.id ?? '').trim();
      if (!invoiceId) continue;
      paymentsByInvoiceId[invoiceId] = [p];
    }

    res.json({
      detail: {
        pr,
        pos,
        grns,
        invoices,
        invoice,
        payments,
        paymentsByInvoiceId,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/operations/pos/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'id is required' });

    const po = await fetchPoHeaderAndItems(pool, poId);
    if (!po) return res.status(404).json({ error: 'PO not found' });

    const [grnRows] = await pool.query(
      `
      SELECT g.id AS id
      FROM grns g
      WHERE g.po_id = ?
      ORDER BY g.received_date DESC, g.created_at DESC
      `,
      [poId]
    );
    const grnIds = (Array.isArray(grnRows) ? grnRows : []).map((r) => String(r.id ?? '')).filter(Boolean);
    const grns = [];
    for (const grnId of grnIds) {
      const g = await fetchGrnDetail(pool, grnId);
      if (g) grns.push(g.grn);
    }

    const [qtyRows] = await pool.query(
      `
      SELECT
        gi.item_id AS itemId,
        COALESCE(SUM(gi.received_qty), 0) AS grnQty,
        COALESCE(SUM(qc.accepted_qty), 0) AS acceptedQty,
        COALESCE(SUM(qc.rejected_qty), 0) AS rejectedQty
      FROM grns g
      INNER JOIN grn_items gi ON gi.grn_id = g.id
      LEFT JOIN qc_records qc ON qc.grn_id = g.id AND qc.item_id = gi.item_id
      WHERE g.po_id = ?
      GROUP BY gi.item_id
      `,
      [poId]
    );
    const qtyByItemId = new Map();
    for (const r of Array.isArray(qtyRows) ? qtyRows : []) {
      qtyByItemId.set(String(r.itemId ?? ''), {
        grnQty: Number(r.grnQty ?? 0),
        acceptedQty: Number(r.acceptedQty ?? 0),
        rejectedQty: Number(r.rejectedQty ?? 0),
      });
    }
    if (Array.isArray(po?.items)) {
      po.items = po.items.map((it) => {
        const q = qtyByItemId.get(String(it?.itemId ?? '')) ?? { grnQty: 0, acceptedQty: 0, rejectedQty: 0 };
        return { ...it, ...q };
      });
    }

    const [invRows] = await pool.query(
      `
      SELECT inv.id AS id
      FROM invoices inv
      WHERE inv.po_id = ?
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `,
      [poId]
    );
    const invIds = (Array.isArray(invRows) ? invRows : []).map((r) => String(r.id ?? '')).filter(Boolean);
    const invoices = [];
    for (const invId of invIds) {
      const inv = await fetchInvoiceHeaderAndItems(pool, invId);
      if (inv) invoices.push({ invoice: inv.invoice, items: inv.items });
    }
    const invoice = invoices.length ? invoices[0] : null;

    const payments = [];
    for (const inv of invoices) {
      const p = toPaymentRowFromInvoice(inv?.invoice);
      if (p) payments.push(p);
    }

    res.json({
      detail: {
        po,
        grns,
        invoice,
        payments,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/operations/grns/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const grnId = String(req.params.id ?? '').trim();
    if (!grnId) return res.status(400).json({ error: 'id is required' });

    const g = await fetchGrnDetail(pool, grnId);
    if (!g) return res.status(404).json({ error: 'GRN not found' });

    res.json({ detail: g });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/operations/invoices/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'id is required' });

    const inv = await fetchInvoiceHeaderAndItems(pool, invoiceId);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const payment = toPaymentRowFromInvoice(inv.invoice);
    const payments = payment ? [payment] : [];

    res.json({ detail: { invoice: { invoice: inv.invoice, items: inv.items }, payments } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/operations/payments/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'id is required' });

    const inv = await fetchInvoiceHeaderAndItems(pool, invoiceId);
    if (!inv) return res.status(404).json({ error: 'Payment not found' });

    const [[linkRow]] = await pool.query(
      `
      SELECT
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        inv.created_at AS createdAt,
        inv.updated_at AS updatedAt
      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE inv.id = ?
      LIMIT 1
      `,
      [invoiceId]
    );
    if (!linkRow) return res.status(404).json({ error: 'Payment not found' });

    const paymentStatus = inv.invoice.paymentStatus != null ? String(inv.invoice.paymentStatus) : null;
    const paymentDate = toIsoDate(inv.invoice.paymentDate) || toIsoDate(linkRow.updatedAt) || toIsoDate(inv.invoice.invoiceDate) || '';

    const payment = {
      paymentId: String(invoiceId),
      paymentDate,
      amount: Number(inv.invoice.invoiceAmount ?? 0),
      mode: undefined,
      referenceNo: undefined,
      status: paymentStatus,
      invoiceId: String(invoiceId),
      invoiceNo: String(inv.invoice.supplierInvoiceNo ?? invoiceId),
      poId: String(linkRow.poId ?? ''),
      poNumber: String(linkRow.poNumber ?? linkRow.poId ?? ''),
      prId: String(linkRow.prId ?? ''),
      prNumber: String(linkRow.prNumber ?? linkRow.prId ?? ''),
      firmId: String(linkRow.firmId ?? ''),
      firmName: String(linkRow.firmName ?? ''),
      supplierId: String(linkRow.supplierId ?? ''),
      supplierName: String(linkRow.supplierName ?? ''),
      createdAt: toIsoDateTime(linkRow.createdAt) || new Date().toISOString(),
    };

    const po = await fetchPoHeaderAndItems(pool, String(linkRow.poId ?? ''));
    const pr = await fetchPrHeaderAndItems(pool, String(linkRow.prId ?? ''));

    res.json({
      detail: {
        payment,
        invoice: { invoice: inv.invoice, items: inv.items },
        po: po ? po : undefined,
        pr: pr ? pr : undefined,
      },
    });
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
	    const normalizedStatus = status.toLowerCase();

	    const where = ['1=1'];
	    const params = [];
    if (f.firmId) {
      where.push('po.firm_id = ?');
      params.push(f.firmId);
    }
    if (f.storeId) {
      where.push('po.store_id = ?');
      params.push(f.storeId);
    }
    if (f.projectId) {
      where.push('po.project_id = ?');
      params.push(f.projectId);
    }
	    if (f.supplierId) {
	      where.push('po.supplier_id = ?');
	      params.push(f.supplierId);
	    }
    if (normalizedStatus === 'draft') {
      where.push(`LOWER(COALESCE(po.status, '')) = 'draft'`);
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
      where.push('(po.po_number LIKE ? OR po.id LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ? OR f.name LIKE ? OR st.name LIKE ? OR proj.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
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
        po.store_id AS storeId,
        st.name AS storeName,
        po.project_id AS projectId,
        proj.name AS projectName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
	        po.order_date AS orderDate,
	        po.advance_date AS advanceDate,
	        po.created_at AS createdAt,
	        po.updated_at AS updatedAt,
	        po.status AS status,
	        po.advance_amount AS advanceAmount,
	        po.requested_by AS requestedBy,
	        po.required_date AS requiredDate,
	        po.po_source AS poSource,
	        po.draft_payload AS draftPayload,
	        COUNT(poi.id) AS itemCount,
	        COALESCE(SUM(poi.total_amount), 0) AS totalAmount,
	        COALESCE(MAX(grnq.grnCount), 0) AS grnCount
      FROM purchase_orders po
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
      LEFT JOIN (
        SELECT po_id AS poId, COUNT(*) AS grnCount
        FROM grns
        GROUP BY po_id
      ) grnq ON grnq.poId = po.id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN stores st ON st.id = po.store_id
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
	      const mappedStatus = mapPoStatus(rawStatus);
	      const draftPayload = parseJsonObject(r.draftPayload, {});
	      const draftLines = normalizePoDraftLines(draftPayload?.lines);
	      return {
	        poId: String(r.poId ?? ''),
	        poNumber: String(r.poNumber ?? r.poId ?? ''),
	        prId: String(r.prId ?? ''),
	        prNumber: String(r.prNumber ?? r.prId ?? ''),
        firmId: String(r.firmId ?? ''),
        firmName: String(r.firmName ?? ''),
	        department: parseDepartmentFromRemarks(r.prRemarks) || validTextOrNull(draftPayload?.department) || 'N/A',
	        storeId: r.storeId ? String(r.storeId) : null,
	        storeName: r.storeName ? String(r.storeName) : null,
	        projectId: r.projectId ? String(r.projectId) : null,
	        projectName: r.projectName ? String(r.projectName) : null,
	        supplierId: String(r.supplierId ?? ''),
	        supplierName: String(r.supplierName ?? draftPayload?.supplier ?? ''),
	        orderDate: toIsoDate(r.orderDate) || null,
	        createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
	        updatedAt: toIsoDateTime(r.updatedAt) || toIsoDateTime(r.createdAt) || new Date().toISOString(),
	        status: mappedStatus,
	        itemCount: Number(r.itemCount ?? 0) || draftLines.length,
	        totalAmount:
	          Number(r.totalAmount ?? 0) ||
	          draftLines.reduce((sum, line) => sum + Number(line.quantity ?? 0) * Number(line.rate ?? 0), 0),
	        advanceAmount: Number(r.advanceAmount ?? 0),
        grnCount: Number(r.grnCount ?? 0),
	        advanceDate: toIsoDate(r.advanceDate) || null,
	        requestedBy: r.requestedBy != null ? String(r.requestedBy) : validTextOrNull(draftPayload?.requestedBy),
	        requiredDate: toIsoDate(r.requiredDate) || toIsoDate(draftPayload?.requiredDate) || null,
	        sourceType: normalizePoSource(r.poSource || draftPayload?.sourceType),
	      };
	    });
	    if (status && normalizedStatus !== 'draft') out = out.filter((x) => String(x.status).toLowerCase() === normalizedStatus);
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
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
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
        inv.approved_by AS approvedBy,
        inv.tally_entry_date AS tallyEntryDate,
        inv.status AS status,
        inv.created_at AS createdAt,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        po.supplier_id AS supplierId,
        s.name AS supplierName,
        COALESCE(qtyq.grnQty, 0) AS grnQty,
        COALESCE(qtyq.approvedQty, 0) AS approvedQty,
        COALESCE(adjq.adjustedAmount, 0) AS adjustedAmount,
        COALESCE(recq.actualReceiptAmount, 0) AS actualReceiptAmount
      FROM invoices inv
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN (
        SELECT
          ii.invoice_id AS invoiceId,
          SUM(LEAST(COALESCE(ii.quantity, 0), COALESCE(grnt.receivedQty, 0))) AS grnQty,
          SUM(LEAST(COALESCE(ii.quantity, 0), COALESCE(qct.approvedQty, 0))) AS approvedQty
        FROM invoice_items ii
        INNER JOIN invoices inv2 ON inv2.id = ii.invoice_id
        LEFT JOIN (
          SELECT g.po_id AS poId, gi.item_id AS itemId, SUM(COALESCE(gi.received_qty, 0)) AS receivedQty
          FROM grns g
          INNER JOIN grn_items gi ON gi.grn_id = g.id
          GROUP BY g.po_id, gi.item_id
        ) grnt ON grnt.poId = inv2.po_id AND grnt.itemId = ii.item_id
        LEFT JOIN (
          SELECT g.po_id AS poId, qc.item_id AS itemId, SUM(COALESCE(qc.accepted_qty, 0)) AS approvedQty
          FROM grns g
          INNER JOIN qc_records qc ON qc.grn_id = g.id
          GROUP BY g.po_id, qc.item_id
        ) qct ON qct.poId = inv2.po_id AND qct.itemId = ii.item_id
        GROUP BY ii.invoice_id
      ) qtyq ON qtyq.invoiceId = inv.id
      LEFT JOIN (
        SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS adjustedAmount
        FROM po_advance_invoice_adjustments
        WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
           OR (receipt_type IS NULL AND (payment_mode IS NULL OR TRIM(payment_mode) = ''))
        GROUP BY invoice_id
      ) adjq ON adjq.invoiceId = inv.id
      LEFT JOIN (
        SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS actualReceiptAmount
        FROM po_advance_invoice_adjustments
        WHERE receipt_type = 'DIRECT_PAYMENT'
           OR (receipt_type IS NULL AND payment_mode IS NOT NULL AND TRIM(payment_mode) <> '')
        GROUP BY invoice_id
      ) recq ON recq.invoiceId = inv.id
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
      grnQty: Number(r.grnQty ?? 0),
      approvedQty: Number(r.approvedQty ?? 0),
      adjustedAmount: Number(r.adjustedAmount ?? 0),
      actualReceiptAmount: Number(r.actualReceiptAmount ?? 0),
      approvedBy: r.approvedBy != null ? String(r.approvedBy) : undefined,
      tallyEntryDate: toIsoDate(r.tallyEntryDate) || undefined,
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

app.get('/api/operations/credit-vouchers', async (req, res) => {
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
      where.push('DATE(cv.voucher_date) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(cv.voucher_date) <= ?');
      params.push(f.to);
    }
    if (status) {
      where.push('(cv.status = ? OR cv.payment_status = ?)');
      params.push(status, status);
    }
    if (f.q) {
      where.push('(cv.voucher_number LIKE ? OR cv.id LIKE ? OR po.po_number LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ? OR f.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        cv.id AS creditVoucherId,
        cv.voucher_number AS voucherNo,
        cv.voucher_date AS voucherDate,
        cv.total_amount AS totalAmount,
        cv.status AS status,
        cv.payment_status AS paymentStatus,
	        cv.payment_amount AS paidAmount,
	        COALESCE(adj.adjustedAmount, 0) AS adjustedAmount,
        cv.created_at AS createdAt,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        f.sort_name AS firmShortName,
        po.supplier_id AS supplierId,
        s.name AS supplierName
      FROM credit_vouchers cv
      INNER JOIN purchase_orders po ON po.id = cv.po_id
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
	      LEFT JOIN suppliers s ON s.id = po.supplier_id
	      LEFT JOIN (
	        SELECT entry_key AS creditVoucherId, SUM(adjusted_amount) AS adjustedAmount
	        FROM po_advance_invoice_adjustments
	        WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
	          AND reference_type = 'CREDIT_VOUCHER'
	        GROUP BY entry_key
	      ) adj ON adj.creditVoucherId = cv.id
	      WHERE ${where.join(' AND ')}
      ORDER BY cv.created_at DESC
      `,
      params
    );

    const out = (Array.isArray(rows) ? rows : []).map((r) => {
      const totalAmount = Number(r.totalAmount ?? 0);
	      const paidAmount = Number(r.paidAmount ?? 0) + Number(r.adjustedAmount ?? 0);
      return {
        creditVoucherId: String(r.creditVoucherId ?? ''),
        voucherNo: String(r.voucherNo ?? r.creditVoucherId ?? ''),
        voucherDate: toIsoDate(r.voucherDate) || '',
        poId: String(r.poId ?? ''),
        poNumber: String(r.poNumber ?? r.poId ?? ''),
        prId: String(r.prId ?? ''),
        prNumber: String(r.prNumber ?? r.prId ?? ''),
        firmId: String(r.firmId ?? ''),
        firmName: String(r.firmName ?? ''),
        supplierId: String(r.supplierId ?? ''),
        supplierName: String(r.supplierName ?? ''),
        status: String(r.status ?? ''),
        paymentStatus: r.paymentStatus != null ? String(r.paymentStatus) : undefined,
        totalAmount,
        paidAmount,
        balanceAmount: Math.max(0, totalAmount - paidAmount),
        createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
      };
    });
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

    const where = [];
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
      where.push('DATE(COALESCE(adj.created_at, inv.invoice_date)) >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('DATE(COALESCE(adj.created_at, inv.invoice_date)) <= ?');
      params.push(f.to);
    }
    if (f.q) {
      where.push('(inv.invoice_number LIKE ? OR inv.id LIKE ? OR po.po_number LIKE ? OR pr.pr_number LIKE ? OR s.name LIKE ? OR f.name LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }
    if (status) {
      where.push('adj.receipt_type = ?');
      params.push(status);
    }

    const [rows] = await pool.query(
      `
      SELECT
        adj.id AS paymentId,
        adj.created_at AS paymentDate,
        adj.adjusted_amount AS amount,
        adj.payment_mode AS paymentMode,
        adj.payment_copy AS paymentCopy,
        adj.receipt_type AS receiptType,
        adj.reference_type AS referenceType,
        adj.created_at AS createdAt,
        inv.id AS invoiceId,
        inv.invoice_number AS invoiceNo,
        po.id AS poId,
        po.po_number AS poNumber,
        pr.id AS prId,
        pr.pr_number AS prNumber,
        po.firm_id AS firmId,
        f.name AS firmName,
        po.supplier_id AS supplierId,
        s.name AS supplierName
      FROM po_advance_invoice_adjustments adj
      LEFT JOIN invoices inv ON inv.id = adj.invoice_id
      INNER JOIN purchase_orders po ON po.id = inv.po_id
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where.length ? where.join(' AND ') : '1=1'}
      ORDER BY COALESCE(adj.created_at, inv.invoice_date) DESC
      `,
      params
    );

    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      paymentId: String(r.paymentId ?? ''),
      paymentDate: toIsoDate(r.paymentDate) || '',
      amount: Number(r.amount ?? 0),
      mode: r.paymentMode != null ? String(r.paymentMode) : '',
      referenceNo: r.referenceType != null ? String(r.referenceType) : '',
      paymentCopy: r.paymentCopy != null ? String(r.paymentCopy) : '',
      status: r.receiptType != null ? String(r.receiptType) : null,
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

app.get('/api/operations/advances', async (req, res) => {
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
	        COALESCE(s.credit_voucher_applicable, 0) AS creditVoucherApplicable,
	        po.order_date AS orderDate,
	        po.advance_date AS advanceDate,
	        po.created_at AS createdAt,
	        po.status AS status,
	        po.advance_amount AS advanceAmount,
	        COALESCE(adj.amountAdjusted, 0) AS amountAdjusted
      FROM purchase_orders po
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN (
        SELECT po_id AS poId, SUM(adjusted_amount) AS amountAdjusted
        FROM po_advance_invoice_adjustments
        WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
           OR (receipt_type IS NULL AND (payment_mode IS NULL OR TRIM(payment_mode) = ''))
        GROUP BY po_id
      ) adj ON adj.poId = po.id
      WHERE ${where.join(' AND ')}
      ORDER BY po.created_at DESC
      `,
      params
    );

    const out = (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const rawStatus = String(r.status ?? '').toLowerCase();
        const mappedStatus = rawStatus === 'closed' ? 'Closed' : rawStatus === 'partial' ? 'Partial' : 'Open';
        const advanceAmount = Number(r.advanceAmount ?? 0);
        const amountAdjusted = Number(r.amountAdjusted ?? 0);
        const advanceRemaining = Math.max(0, advanceAmount - amountAdjusted);
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
	          creditVoucherApplicable: Boolean(r.creditVoucherApplicable),
	          orderDate: toIsoDate(r.orderDate) || null,
	          createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
          status: mappedStatus,
          advanceAmount,
          advanceDate: toIsoDate(r.advanceDate) || null,
          amountAdjusted,
          advanceRemaining,
        };
      })
      .filter((x) => x.advanceRemaining > 1e-9);

    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/pos/:id/advance-adjustments', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'po id is required' });

    const [[poMeta]] = await pool.query(
      `
      SELECT po.id, COALESCE(s.credit_voucher_applicable, 0) AS creditVoucherApplicable
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = ?
      LIMIT 1
      `,
      [poId]
    );
    if (!poMeta) return res.status(404).json({ error: 'PO not found' });
    const useCreditVoucher = Boolean(Number(poMeta.creditVoucherApplicable ?? 0));

    const targetSql = useCreditVoucher
      ? `
      SELECT
        cv.id AS invoiceId,
        cv.voucher_number AS invoiceNo,
        cv.voucher_date AS invoiceDate,
        cv.total_amount AS invoiceAmount,
        COALESCE(cv.payment_mode, 'Credit') AS paymentMode,
        cv.created_at AS createdAt,
        'CREDIT_VOUCHER' AS referenceType
      FROM credit_vouchers cv
      WHERE cv.po_id = ?
      ORDER BY cv.voucher_date DESC, cv.created_at DESC
      `
      : `
      SELECT
        inv.id AS invoiceId,
        inv.invoice_number AS invoiceNo,
        inv.invoice_date AS invoiceDate,
        inv.total_amount AS invoiceAmount,
        (
          SELECT pa.payment_mode
          FROM po_advances pa
          WHERE pa.po_id = inv.po_id
            AND pa.payment_mode IS NOT NULL
            AND TRIM(pa.payment_mode) <> ''
          ORDER BY pa.advance_date DESC, pa.created_at DESC
          LIMIT 1
        ) AS paymentMode,
        inv.created_at AS createdAt,
        'INVOICE' AS referenceType
      FROM invoices inv
      WHERE inv.po_id = ?
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `;
    const [invoiceRows] = await pool.query(targetSql, [poId]);

	    const [adjRows] = await pool.query(
	      `
	      SELECT ${useCreditVoucher ? 'entry_key' : 'invoice_id'} AS invoiceId, adjusted_amount AS adjustedAmount
	      FROM po_advance_invoice_adjustments
	      WHERE po_id = ?
	        AND (
	          receipt_type = 'ADVANCE_ADJUSTMENT'
	          OR (receipt_type IS NULL AND (payment_mode IS NULL OR TRIM(payment_mode) = ''))
	        )
	        ${useCreditVoucher ? "AND reference_type = 'CREDIT_VOUCHER'" : ''}
	      `,
	      [poId]
	    );

    const adjustedByInvoiceId = (Array.isArray(adjRows) ? adjRows : []).reduce((acc, r) => {
      const id = String(r.invoiceId ?? '');
      if (!id) return acc;
      acc[id] = Number(acc[id] ?? 0) + Number(r.adjustedAmount ?? 0);
      return acc;
    }, {});

    const invoices = (Array.isArray(invoiceRows) ? invoiceRows : []).map((r) => {
      const invoiceId = String(r.invoiceId ?? '');
      return {
        invoiceId,
        invoiceNo: String(r.invoiceNo ?? invoiceId),
        invoiceDate: toIsoDate(r.invoiceDate) || '',
        invoiceAmount: Number(r.invoiceAmount ?? 0),
        adjustedAmount: Number(adjustedByInvoiceId[invoiceId] ?? 0),
        paymentMode: r.paymentMode != null ? String(r.paymentMode) : 'Credit',
        referenceType: r.referenceType != null ? String(r.referenceType) : useCreditVoucher ? 'CREDIT_VOUCHER' : 'INVOICE',
        createdAt: toIsoDateTime(r.createdAt) || new Date().toISOString(),
      };
    });

    res.json({ invoices });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/pos/:id/advance-adjustments', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    try {
      await pool.query('ALTER TABLE po_advance_invoice_adjustments DROP INDEX uniq_invoice');
    } catch {}
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'po id is required' });

    const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || null;

    const rows = input
      .map((r) => ({
        invoiceId: String(r?.invoiceId ?? '').trim(),
        adjustedAmount: Number(r?.adjustedAmount ?? 0),
        paymentMode: String(r?.paymentMode ?? '').trim() || 'Credit',
      }))
      .filter((r) => r.invoiceId)
      .map((r) => ({ ...r, adjustedAmount: Number.isFinite(r.adjustedAmount) ? Math.max(0, r.adjustedAmount) : 0 }));

    const invoiceIds = Array.from(new Set(rows.map((r) => r.invoiceId)));
    if (!invoiceIds.length) return res.json({ ok: true });

    const [[poMeta]] = await pool.query(
      `
      SELECT po.id, COALESCE(s.credit_voucher_applicable, 0) AS creditVoucherApplicable
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = ?
      LIMIT 1
      `,
      [poId]
    );
    if (!poMeta) return res.status(404).json({ error: 'PO not found' });
    const useCreditVoucher = Boolean(Number(poMeta.creditVoucherApplicable ?? 0));
    const referenceType = useCreditVoucher ? 'CREDIT_VOUCHER' : 'INVOICE';

    const placeholders = invoiceIds.map(() => '?').join(',');
    const [invRows] = await pool.query(
      useCreditVoucher
        ? `SELECT id, po_id AS poId FROM credit_vouchers WHERE id IN (${placeholders})`
        : `SELECT id, po_id AS poId FROM invoices WHERE id IN (${placeholders})`,
      invoiceIds
    );
    const invalid = invoiceIds.filter(
      (id) => !((Array.isArray(invRows) ? invRows : []).some((r) => String(r.id) === id && String(r.poId) === poId))
    );
    if (invalid.length) return res.status(400).json({ error: `Some ${useCreditVoucher ? 'credit vouchers' : 'invoices'} do not belong to this PO.` });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
	      const [currentRows] = await conn.query(
	        `
	        SELECT ${useCreditVoucher ? 'entry_key' : 'invoice_id'} AS invoiceId, COALESCE(SUM(adjusted_amount), 0) AS adjustedAmount
	        FROM po_advance_invoice_adjustments
	        WHERE po_id = ?
	          AND (
	            receipt_type = 'ADVANCE_ADJUSTMENT'
	            OR (receipt_type IS NULL AND (payment_mode IS NULL OR TRIM(payment_mode) = ''))
	          )
	          ${useCreditVoucher ? "AND reference_type = 'CREDIT_VOUCHER'" : ''}
	        GROUP BY ${useCreditVoucher ? 'entry_key' : 'invoice_id'}
	        `,
	        [poId]
	      );
      const currentByInvoiceId = Object.fromEntries(
        (Array.isArray(currentRows) ? currentRows : []).map((r) => [String(r.invoiceId ?? ''), Number(r.adjustedAmount ?? 0)])
      );
      for (const r of rows) {
        const current = Number(currentByInvoiceId[r.invoiceId] ?? 0);
        if (r.adjustedAmount + 1e-9 < current) {
	          throw new Error(`Adjusted amount cannot be reduced for ${useCreditVoucher ? 'credit voucher' : 'invoice'} ${r.invoiceId}. Historical receipt rows are append-only.`);
        }
        const delta = Math.max(0, r.adjustedAmount - current);
        if (!(delta > 1e-9)) continue;
        try {
          await conn.query(
            `INSERT INTO po_advance_invoice_adjustments
	             (id, po_id, invoice_id, adjusted_amount, payment_mode, receipt_type, reference_type, entry_key, created_by, updated_by)
		             VALUES (?, ?, ?, ?, ?, 'ADVANCE_ADJUSTMENT', ?, ?, ?, ?)`,
		            [
		              crypto.randomUUID(),
		              poId,
		              useCreditVoucher ? null : r.invoiceId,
		              delta,
		              r.paymentMode || null,
		              referenceType,
		              useCreditVoucher ? r.invoiceId : crypto.randomUUID(),
		              updatedBy,
		              updatedBy,
		            ]
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Fallback for legacy DBs that still have UNIQUE(invoice_id).
          if (msg.toLowerCase().includes('uniq_invoice') || msg.toLowerCase().includes('duplicate entry')) {
            await conn.query(
              `
              UPDATE po_advance_invoice_adjustments
              SET adjusted_amount = COALESCE(adjusted_amount, 0) + ?,
                  payment_mode = COALESCE(?, payment_mode),
                  receipt_type = 'ADVANCE_ADJUSTMENT',
	                  reference_type = ?,
	                  updated_by = ?,
                  updated_at = NOW()
	              WHERE po_id = ? AND ${useCreditVoucher ? 'entry_key' : 'invoice_id'} = ?
	              LIMIT 1
              `,
	              [delta, r.paymentMode || null, referenceType, updatedBy, poId, r.invoiceId]
            );
          } else {
            throw e;
          }
        }
      }
      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch {}
      throw e;
    } finally {
      conn.release();
    }

    res.json({ ok: true });
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
        inv.payment_mode AS paymentMode,
        inv.tally_entry_date AS tallyEntryDate,
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
	          u.name AS unit,
	          ii.quantity AS quantity,
	          ii.rate AS rate,
	          ii.tax_percent AS taxPercent,
	          ii.dim_length AS dimLength,
	          ii.dim_breadth AS dimBreadth,
	          ii.dim_pcs AS dimPcs,
	          ii.dim_input_unit AS dimInputUnit,
	          it.specifications_json AS specificationsJson
        FROM invoice_items ii
        LEFT JOIN items it ON it.id = ii.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        LEFT JOIN units u ON u.id = iname.unit_id
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
	          specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
	          unit: r.unit != null ? String(r.unit) : null,
	          quantity: Number(r.quantity ?? 0),
	          rate: Number(r.rate ?? 0),
	          taxPercent: Number(r.taxPercent ?? 0),
	          dimLength: r.dimLength != null ? Number(r.dimLength) : null,
	          dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : null,
	          dimPcs: r.dimPcs != null ? Number(r.dimPcs) : null,
	          dimInputUnit: r.dimInputUnit != null ? String(r.dimInputUnit) : null,
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
          paymentMode: r.paymentMode != null ? String(r.paymentMode) : 'Credit',
          tallyEntryDate: toIsoDate(r.tallyEntryDate) || undefined,
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
	        po.advance_amount AS advanceAmount,
	        po.advance_date AS advanceDate,
	        po.cancel_reason AS cancelReason,
	        po.cancelled_by AS cancelledBy,
	        po.cancelled_at AS cancelledAt,
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
	        poi.id AS id,
	        poi.po_id AS poId,
          poi.item_id AS itemId,
          iname.name AS item,
          it.unit AS unit,
          it.specifications_json AS specificationsJson,
          poi.quantity AS quantity,
          poi.rate AS rate,
          poi.discount_percent AS discountPercent,
          poi.tax_percent AS taxPercent,
          poi.cancelled_qty AS cancelledQty,
          poi.cancel_reason AS cancelReason,
          poi.goods_amount AS goodsAmount,
          poi.tax_amount AS taxAmount,
          poi.total_amount AS totalAmount,
          poi.dim_length AS dimLength,
          poi.dim_breadth AS dimBreadth,
          poi.dim_pcs AS dimPcs,
          poi.dim_unit AS dimUnit,
          poi.remarks AS remarks
        FROM purchase_order_items poi
        LEFT JOIN items it ON it.id = poi.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        WHERE poi.po_id IN (${placeholders})
        ORDER BY COALESCE(poi.line_order, 999999) ASC, poi.created_at ASC, poi.id ASC
        `,
        poIds
      );

      itemsByPoId = new Map();
      for (const r of Array.isArray(itemRows) ? itemRows : []) {
        const poId = String(r.poId ?? '').trim();
        if (!poId) continue;
        if (!itemsByPoId.has(poId)) itemsByPoId.set(poId, []);
	        itemsByPoId.get(poId).push({
	          id: String(r.id ?? ''),
	          poId,
          itemId: String(r.itemId ?? ''),
          item: String(r.item ?? ''),
          unit: r.unit != null ? String(r.unit) : null,
          specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
          quantity: Number(r.quantity ?? 0),
          rate: Number(r.rate ?? 0),
          discountPercent: r.discountPercent != null ? Number(r.discountPercent) : undefined,
          taxPercent: r.taxPercent != null ? Number(r.taxPercent) : undefined,
          cancelledQty: Number(r.cancelledQty ?? 0),
          cancelReason: r.cancelReason != null ? String(r.cancelReason) : null,
          goodsAmount: r.goodsAmount != null ? Number(r.goodsAmount) : undefined,
          taxAmount: r.taxAmount != null ? Number(r.taxAmount) : undefined,
          totalAmount: r.totalAmount != null ? Number(r.totalAmount) : undefined,
          dimLength: r.dimLength != null ? Number(r.dimLength) : null,
          dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : null,
          dimPcs: r.dimPcs != null ? Number(r.dimPcs) : null,
          dimUnit: r.dimUnit != null ? String(r.dimUnit) : null,
          remarks: r.remarks != null ? String(r.remarks) : null,
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
	            advanceAmount: Number(r.advanceAmount ?? 0),
	            advanceDate: toIsoDate(r.advanceDate) || null,
	            cancelReason: r.cancelReason != null ? String(r.cancelReason) : null,
	            cancelledBy: r.cancelledBy != null ? String(r.cancelledBy) : null,
	            cancelledAt: toIsoDateTime(r.cancelledAt) || null,
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
          u.name AS unit,
	          it.specifications_json AS specificationsJson,
	          gi.received_qty AS quantityReceived,
	          gi.weight AS weight
        FROM grn_items gi
        LEFT JOIN items it ON it.id = gi.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        LEFT JOIN units u ON u.id = iname.unit_id
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
          unit: String(r.unit ?? '').trim(),
	          specificationsJson: r.specificationsJson != null ? String(r.specificationsJson) : undefined,
	          quantityReceived: Number(r.quantityReceived ?? 0),
	          weight: r.weight != null ? Number(r.weight) : null,
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

app.post('/api/material-requests', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

	    const date = String(req.body?.date ?? '').trim();
	    const firmId = req.body?.firmId ? String(req.body.firmId).trim() : null;
	    const storeId = req.body?.storeId ? String(req.body.storeId).trim() : null;
	    const department = req.body?.department ? String(req.body.department).trim() : null;
	    const customerId = req.body?.customerId ? String(req.body.customerId).trim() : null;
    const projectId = req.body?.projectId ? String(req.body.projectId).trim() : null;
    const requestByType = String(req.body?.requestByType ?? 'Inhouse').trim();
    const requestByUserId = req.body?.requestByUserId ? String(req.body.requestByUserId).trim() : null;
    const requestBySupplierId = req.body?.requestBySupplierId ? String(req.body.requestBySupplierId).trim() : null;
    const remarks = req.body?.remarks ? String(req.body.remarks).trim() : null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

	    if (!date) return res.status(400).json({ error: 'date is required' });
	    if (!firmId) return res.status(400).json({ error: 'firmId is required' });
	    if (!storeId) return res.status(400).json({ error: 'storeId is required' });
	    if (!department) return res.status(400).json({ error: 'department is required' });
	    if (!items.length) return res.status(400).json({ error: 'items are required' });
    if (requestByType !== 'Inhouse' && requestByType !== 'Vendor') {
      return res.status(400).json({ error: 'requestByType must be Inhouse or Vendor' });
    }
    if (requestByType === 'Inhouse' && !requestByUserId) {
      return res.status(400).json({ error: 'requestByUserId is required for Inhouse' });
    }
    if (requestByType === 'Vendor' && !requestBySupplierId) {
      return res.status(400).json({ error: 'requestBySupplierId is required for Vendor' });
    }

    const requestId = crypto.randomUUID();
    const requestNo = await allocateDocNumber(pool, firmId, 'MR', new Date());

    await pool.query(
	      `INSERT INTO material_requests
	        (id, request_no, date, firm_id, store_id, department, customer_id, project_id, request_by_type, request_by_user_id, request_by_supplier_id, remarks, created_by)
	       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	      [requestId, requestNo, date, firmId, storeId, department, customerId, projectId, requestByType, requestByUserId, requestBySupplierId, remarks, 'system']
	    );

    for (const item of items) {
      const itemId = String(item.itemId ?? '').trim();
      const quantity = Number(item.quantity);
      const specification = String(item.specification ?? '').trim() || null;
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0) continue;

      await pool.query(
        `INSERT INTO material_request_items (id, request_id, item_id, specification, quantity)
         VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), requestId, itemId, specification, quantity]
      );
    }

    res.json({ request: { id: requestId, requestNo } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/material-requests', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

	    const [rows] = await pool.query(`
	      SELECT
	        mr.*,
	        f.name AS firmName,
	        st.name AS storeName,
	        c.name AS customerName,
	        p.name AS projectName,
	        u.name AS userName,
	        s.name AS supplierName
	      FROM material_requests mr
	      LEFT JOIN firms f ON f.id = mr.firm_id
	      LEFT JOIN stores st ON st.id = mr.store_id
	      LEFT JOIN customers c ON c.id = mr.customer_id
	      LEFT JOIN projects p ON p.id = mr.project_id
	      LEFT JOIN users u ON u.id = mr.request_by_user_id
      LEFT JOIN suppliers s ON s.id = mr.request_by_supplier_id
      ORDER BY mr.created_at DESC
    `);
    res.json({ requests: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/material-requests/pending', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

	    const [rows] = await pool.query(`
	      SELECT
	        mr.*,
	        f.name AS firmName,
	        st.name AS storeName,
	        c.name AS customerName,
	        p.name AS projectName,
	        u.name AS userName,
	        s.name AS supplierName
	      FROM material_requests mr
	      LEFT JOIN firms f ON f.id = mr.firm_id
	      LEFT JOIN stores st ON st.id = mr.store_id
	      LEFT JOIN customers c ON c.id = mr.customer_id
	      LEFT JOIN projects p ON p.id = mr.project_id
	      LEFT JOIN users u ON u.id = mr.request_by_user_id
      LEFT JOIN suppliers s ON s.id = mr.request_by_supplier_id
      WHERE mr.status = 'Pending'
      ORDER BY mr.created_at DESC
    `);

    const requests = [];
    for (const row of rows) {
      const [items] = await pool.query(`
        SELECT
          mri.*,
          COALESCE(iname.name, i.item_code, i.id) AS itemName
        FROM material_request_items mri
        JOIN items i ON i.id = mri.item_id
        LEFT JOIN item_names iname ON iname.id = i.item_name_id
        WHERE mri.request_id = ?
      `, [row.id]);
      requests.push({ ...row, items });
    }

    res.json({ requests });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/requests', async (req, res) => {
		  try {
		    const pool = getMysqlPool();
		    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
        const mode = normalizePoMode(req.body?.mode);

		    const firmId = String(req.body?.firmId ?? '').trim();
    const storeName = String(req.body?.store ?? '').trim();
    const department = String(req.body?.department ?? '').trim();
    const remarksInput = String(req.body?.remarks ?? '').trim();
    const requestedBy = String(req.body?.requestedBy ?? '').trim();
    const requiredDate = String(req.body?.requiredDate ?? '').trim(); // YYYY-MM-DD
    const requestType = (String(req.body?.requestType ?? 'Stock').trim() === 'Project' ? 'Project' : 'Stock');
    const projectId = req.body?.projectId != null ? String(req.body.projectId).trim() : null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!firmId) return res.status(400).json({ error: 'firmId is required' });
    if (!storeName) return res.status(400).json({ error: 'store is required' });
    if (!requestedBy) return res.status(400).json({ error: 'requestedBy is required' });
    if (!requiredDate) return res.status(400).json({ error: 'requiredDate is required' });
    if (!items.length) return res.status(400).json({ error: 'items are required' });

    const [storeRows] = await pool.query('SELECT id, name FROM stores WHERE firm_id = ? AND name = ? LIMIT 1', [firmId, storeName]);
    const storeRow = Array.isArray(storeRows) ? storeRows[0] : null;
    if (!storeRow?.id) return res.status(400).json({ error: 'Store not found for selected firm' });
    const storeId = String(storeRow.id);

    const prId = crypto.randomUUID();
    const prNumber = await allocateDocNumber(pool, firmId, 'PR', new Date());
    const remarks = JSON.stringify({ ...(department ? { department } : {}), ...(remarksInput ? { remarks: remarksInput } : {}) });

	    await pool.query(
	      `
	      INSERT INTO purchase_requisitions
	        (id, pr_number, firm_id, store_id, project_id, requested_by, status, remarks, created_by, created_at, updated_at, request_type)
      VALUES
        (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), NOW(), ?)
      `,
	      [prId, prNumber, firmId, storeId, projectId || null, requestedBy, remarks, 'system', requestType]
	    );

	    const normalizeSpecsObject = (raw) => {
	      if (!raw || typeof raw !== 'object') return {};
	      const out = {};
	      for (const [k, v] of Object.entries(raw)) {
	        const sid = String(k ?? '').trim();
	        const sval = String(v ?? '').trim();
	        if (!sid || !sval) continue;
	        out[sid] = sval;
	      }
	      return out;
	    };

	    const stableJsonStringify = (obj) => {
	      const entries = Object.entries(obj || {}).sort(([a], [b]) => String(a).localeCompare(String(b)));
	      return JSON.stringify(Object.fromEntries(entries));
	    };

		    for (const [lineIndex, row] of items.entries()) {
	      let itemId = String(row?.itemId ?? '').trim();
	      const itemNameId = String(row?.itemNameId ?? '').trim();
	      const quantityInput = Number(row?.quantity ?? 0);
        const priorityId = row?.priorityId != null ? String(row.priorityId).trim() : '';
	      let specification = String(row?.specification ?? '').trim();
        const dimLengthInput = row?.length ?? row?.dimLength ?? row?.dim_length;
        const dimBreadthInput = row?.breadth ?? row?.dimBreadth ?? row?.dim_breadth;
        const dimPcsInput = row?.pcs ?? row?.dimPcs ?? row?.dim_pcs;
        let unitNameForRow = null;

	      // New format: Item Name + spec selections (server resolves/creates the item id).
	      if (!itemId && itemNameId) {
	        const specsObj = normalizeSpecsObject(row?.specs);
	        const specificationsJson = stableJsonStringify(specsObj);
	        const uniqueKey = `${itemNameId}:${sha256(specificationsJson).slice(0, 16)}`;

	        const [[found]] = await pool.query('SELECT id FROM items WHERE unique_key=? LIMIT 1', [uniqueKey]);
	        if (found?.id) {
	          itemId = String(found.id);
	        } else {
	          const newId = crypto.randomUUID();
	          const itemCode = `IT-${newId.slice(0, 8).toUpperCase()}`;
	          const [[meta]] = await pool.query(
	            `
	            SELECT u.name AS unitName
	            FROM item_names n
	            LEFT JOIN units u ON u.id = n.unit_id
	            WHERE n.id = ?
	            LIMIT 1
	            `,
	            [itemNameId]
	          );
	          const unitName = meta?.unitName != null ? String(meta.unitName) : null;
            unitNameForRow = unitName;
	          await pool.query(
	            `
	            INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, reorder_level, created_by, created_at, updated_at)
	            VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, NOW(), NOW())
	            `,
	            [newId, itemNameId, itemCode, specificationsJson, uniqueKey, unitName, 'system']
	          );
	          itemId = newId;
	        }

	        // Store specs JSON in remarks for traceability.
	        specification = JSON.stringify(specsObj);
	      }

	      if (!itemId) return res.status(400).json({ error: 'Each item requires itemId (or itemNameId+specs)' });
	      if (!specification) return res.status(400).json({ error: 'Each item requires specification' });

        if (unitNameForRow == null) {
          const [[urow]] = await pool.query('SELECT unit FROM items WHERE id = ? LIMIT 1', [itemId]);
          unitNameForRow = urow?.unit != null ? String(urow.unit) : null;
        }

        const areaUnit = normalizeAreaUnitName(unitNameForRow);
        const dimUnit = baseDimUnitForAreaUnit(areaUnit);
        const dimLength = dimLengthInput != null && String(dimLengthInput).trim() !== '' ? num(dimLengthInput, NaN) : NaN;
        const dimBreadth = dimBreadthInput != null && String(dimBreadthInput).trim() !== '' ? num(dimBreadthInput, NaN) : NaN;
        const dimPcs = dimPcsInput != null && String(dimPcsInput).trim() !== '' ? num(dimPcsInput, NaN) : 1;

        const quantity = areaUnit ? computeAreaQty(dimLength, dimBreadth, dimPcs) : quantityInput;
        if (areaUnit) {
          if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Each area-unit item requires valid length, breadth and PCs' });
        } else {
          if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Each item requires a valid quantity' });
        }

      const prItemId = crypto.randomUUID();
      await pool.query(
	        `
	        INSERT INTO purchase_requisition_items
	          (id, pr_id, item_id, requested_qty, approved_qty, required_date, priority_id, remarks, status, created_by, created_at, updated_at, dim_length, dim_breadth, dim_pcs, dim_unit)
	        VALUES
	          (?, ?, ?, ?, NULL, ?, ?, ?, 'pending', ?, NOW(), NOW(), ?, ?, ?, ?)
	        `,
	        [
            prItemId,
            prId,
            itemId,
            quantity,
            requiredDate,
            priorityId || null,
            specification,
            'system',
            areaUnit ? round2(dimLength) : null,
            areaUnit ? round2(dimBreadth) : null,
            areaUnit ? Math.trunc(Number(dimPcs)) : null,
            areaUnit ? dimUnit : null,
          ]
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
          it.unit AS unit,
	        pri.requested_qty AS quantity,
          pri.priority_id AS priorityId,
          p.name AS priority,
	        pri.remarks AS specification,
          pri.dim_length AS dimLength,
          pri.dim_breadth AS dimBreadth,
          pri.dim_pcs AS dimPcs,
          pri.dim_unit AS dimUnit,
          pri.approved_dim_length AS approvedDimLength,
          pri.approved_dim_breadth AS approvedDimBreadth,
          pri.approved_dim_pcs AS approvedDimPcs,
          pri.approved_dim_unit AS approvedDimUnit
	      FROM purchase_requisition_items pri
	      LEFT JOIN items it ON it.id = pri.item_id
	      LEFT JOIN item_names iname ON iname.id = it.item_name_id
          LEFT JOIN priorities p ON p.id = pri.priority_id
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
        unit: r.unit != null ? String(r.unit) : null,
	      quantity: Number(r.quantity ?? 0),
          priorityId: r.priorityId ? String(r.priorityId) : null,
          priority: r.priority ? String(r.priority) : null,
	      specification: String(r.specification ?? ''),
        dimLength: r.dimLength != null ? Number(r.dimLength) : null,
        dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : null,
        dimPcs: r.dimPcs != null ? Number(r.dimPcs) : null,
        dimUnit: r.dimUnit != null ? String(r.dimUnit) : null,
        approvedDimLength: r.approvedDimLength != null ? Number(r.approvedDimLength) : null,
        approvedDimBreadth: r.approvedDimBreadth != null ? Number(r.approvedDimBreadth) : null,
        approvedDimPcs: r.approvedDimPcs != null ? Number(r.approvedDimPcs) : null,
        approvedDimUnit: r.approvedDimUnit != null ? String(r.approvedDimUnit) : null,
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
      if (!prItemId) continue;

      const [[meta]] = await conn.query(
        `
        SELECT
          it.unit AS unit,
          pri.dim_length AS dimLength,
          pri.dim_breadth AS dimBreadth,
          pri.dim_pcs AS dimPcs,
          pri.dim_unit AS dimUnit
        FROM purchase_requisition_items pri
        LEFT JOIN items it ON it.id = pri.item_id
        WHERE pri.id = ? AND pri.pr_id = ?
        LIMIT 1
        `,
        [prItemId, prId]
      );
      const unitNameForRow = meta?.unit != null ? String(meta.unit) : null;
      const areaUnit = normalizeAreaUnitName(unitNameForRow);
      const dimUnit = baseDimUnitForAreaUnit(areaUnit);

      const approvedLengthInput = row?.length ?? row?.dimLength ?? row?.approvedDimLength ?? row?.approved_dim_length;
      const approvedBreadthInput = row?.breadth ?? row?.dimBreadth ?? row?.approvedDimBreadth ?? row?.approved_dim_breadth;
      const approvedPcsInput = row?.pcs ?? row?.dimPcs ?? row?.approvedDimPcs ?? row?.approved_dim_pcs;

      const approvedLength = approvedLengthInput != null && String(approvedLengthInput).trim() !== '' ? num(approvedLengthInput, NaN) : NaN;
      const approvedBreadth =
        approvedBreadthInput != null && String(approvedBreadthInput).trim() !== '' ? num(approvedBreadthInput, NaN) : NaN;
      const approvedPcs = approvedPcsInput != null && String(approvedPcsInput).trim() !== '' ? num(approvedPcsInput, NaN) : 1;

      const approvedQty = areaUnit ? computeAreaQty(approvedLength, approvedBreadth, approvedPcs) : Number(row?.quantity ?? 0);
      if (areaUnit) {
        if (!Number.isFinite(approvedQty) || approvedQty <= 0) {
          await conn.rollback();
          return res.status(400).json({ error: 'Invalid approved dimensions for area-unit item' });
        }
      } else {
        if (!Number.isFinite(approvedQty) || approvedQty < 0) {
          await conn.rollback();
          return res.status(400).json({ error: 'Invalid approved quantity' });
        }
      }
      await conn.query(
        `
        UPDATE purchase_requisition_items
        SET approved_qty=?, approved_dim_length=?, approved_dim_breadth=?, approved_dim_pcs=?, approved_dim_unit=?, status='approved', approved_by=?, approved_at=NOW(), updated_at=NOW()
        WHERE id=? AND pr_id=?
        `,
        [
          approvedQty,
          areaUnit ? round2(approvedLength) : null,
          areaUnit ? round2(approvedBreadth) : null,
          areaUnit ? Math.trunc(Number(approvedPcs)) : null,
          areaUnit ? dimUnit : null,
          approver,
          prItemId,
          prId,
        ]
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
        const mode = normalizePoMode(req.body?.mode);

		    const supplierName = String(req.body?.supplier ?? '').trim();
	    const paymentTerms = String(req.body?.paymentTerms ?? '').trim();
      const paymentType = req.body?.paymentType != null ? String(req.body.paymentType).trim() || null : null;
      const paymentMode = req.body?.paymentMode != null ? String(req.body.paymentMode).trim() || null : null;
      const advanceAmount = Math.max(0, num(req.body?.advanceAmount, 0));
      const advanceDateInput = req.body?.advanceDate;
      const normalizedAdvanceDateInput =
        advanceDateInput === null ? null : advanceDateInput != null ? toIsoDate(String(advanceDateInput).trim()) : undefined;
      const autoAdvanceDate = new Date().toISOString().slice(0, 10);
      const advanceDate = advanceAmount > 0 ? (normalizedAdvanceDateInput ?? autoAdvanceDate) : null;
		    const shippingAddress = req.body?.shippingAddress != null ? String(req.body.shippingAddress).trim() : null;
		    const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions).trim() : null;
		    const items = Array.isArray(req.body?.items) ? req.body.items : [];

		    const [[prRow]] = await pool.query(
		      'SELECT id, firm_id AS firmId, store_id AS storeId, project_id AS projectId FROM purchase_requisitions WHERE id = ? LIMIT 1',
		      [prId]
		    );
		    if (!prRow) return res.status(404).json({ error: 'PR not found' });

        if (mode === 'draft') {
          const resolvedSupplier = await resolveSupplierInput(pool, req.body?.supplierId, supplierName);
          const detail = await insertPoDraft(pool, {
            sourceType: 'PR',
            prId,
            firmId: prRow.firmId ? String(prRow.firmId) : null,
            storeId: prRow.storeId ? String(prRow.storeId) : null,
            projectId: prRow.projectId ? String(prRow.projectId) : null,
            supplierId: resolvedSupplier.supplierId,
            supplier: resolvedSupplier.supplierName || supplierName || null,
            paymentTerms,
            paymentType,
            paymentMode,
            advanceAmount,
            advanceDate,
            shippingAddress,
            termsConditions,
            items,
          });
          return res.json({ po: detail });
        }

		    if (!supplierName) return res.status(400).json({ error: 'supplier is required' });
		    if (!paymentTerms) return res.status(400).json({ error: 'paymentTerms is required' });
		    if (!items.length) return res.status(400).json({ error: 'items are required' });

	    const [supRows] = await pool.query('SELECT id, name FROM suppliers WHERE name = ? LIMIT 1', [supplierName]);
	    const supRow = Array.isArray(supRows) ? supRows[0] : null;
	    if (!supRow?.id) return res.status(400).json({ error: 'Supplier not found' });
	    const supplierId = String(supRow.id);

	    const poId = crypto.randomUUID();
	    const poNumber = await allocateDocNumber(pool, prRow.firmId, 'PO', new Date());

	    await pool.query(
	      `
		      INSERT INTO purchase_orders
		        (id, po_number, firm_id, store_id, project_id, supplier_id, pr_id, po_source, status, order_date, payment_terms, payment_type, payment_mode, advance_amount, advance_date, remarks, created_by, created_at, updated_at, shipping_address, terms_conditions)
		      VALUES
		        (?, ?, ?, ?, ?, ?, ?, 'PR', 'issued', CURDATE(), ?, ?, ?, ?, ?, NULL, ?, NOW(), NOW(), ?, ?)
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
          paymentType,
          paymentMode,
	        advanceAmount,
          advanceDate,
	        'system',
	        shippingAddress,
	        termsConditions,
	      ]
	    );
	    if (advanceAmount > 0 && advanceDate) {
	      await pool.query(
	        `
	        INSERT INTO po_advances (id, po_id, advance_date, advance_amount, created_by, created_at, updated_at)
	        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
	        `,
	        [crypto.randomUUID(), poId, advanceDate, advanceAmount, 'system']
	      );
	    }

	    const outItems = [];
      const itemIds = items.map((x) => String(x?.itemId ?? '').trim()).filter(Boolean);
      const itemMetaById = new Map();
      if (itemIds.length) {
        const [metaRows] = await pool.query(`SELECT id, unit FROM items WHERE id IN (${itemIds.map(() => '?').join(',')})`, itemIds);
        for (const r of Array.isArray(metaRows) ? metaRows : []) {
          const id = String(r.id ?? '').trim();
          if (!id) continue;
          itemMetaById.set(id, { unit: r.unit != null ? String(r.unit) : null });
        }
      }

		    for (const [lineIndex, row] of items.entries()) {
	      const itemId = String(row?.itemId ?? '').trim();
	      const quantityInput = Number(row?.quantity ?? 0);
	      const rate = Number(row?.rate ?? 0);
	      const discountPercent = row?.discountPercent != null ? Number(row.discountPercent) : null;
	      const taxPercent = row?.taxPercent != null ? Number(row.taxPercent) : null;
	      if (!itemId) return res.status(400).json({ error: 'Each item requires itemId' });
	      if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ error: 'Each item requires valid rate' });

        const unitNameForRow = itemMetaById.get(itemId)?.unit ?? null;
        const areaUnit = normalizeAreaUnitName(unitNameForRow);
        const dimUnit = baseDimUnitForAreaUnit(areaUnit);
        const dimLengthInput = row?.length ?? row?.dimLength ?? row?.dim_length;
        const dimBreadthInput = row?.breadth ?? row?.dimBreadth ?? row?.dim_breadth;
        const dimPcsInput = row?.pcs ?? row?.dimPcs ?? row?.dim_pcs;
        const dimLength = dimLengthInput != null && String(dimLengthInput).trim() !== '' ? num(dimLengthInput, NaN) : NaN;
        const dimBreadth = dimBreadthInput != null && String(dimBreadthInput).trim() !== '' ? num(dimBreadthInput, NaN) : NaN;
        const dimPcs = dimPcsInput != null && String(dimPcsInput).trim() !== '' ? num(dimPcsInput, NaN) : 1;

        const quantityRaw = areaUnit ? computeAreaQty(dimLength, dimBreadth, dimPcs) : quantityInput;
        const quantity = round2(quantityRaw);
        if (areaUnit) {
          if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) return res.status(400).json({ error: 'Each area-unit PO item requires valid length, breadth and PCs' });
        } else {
          if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) return res.status(400).json({ error: 'Each item requires valid quantity' });
        }

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
		          (id, po_id, item_id, quantity, rate, discount_percent, tax_percent, goods_amount, tax_amount, total_amount, created_by, created_at, updated_at, dim_length, dim_breadth, dim_pcs, dim_unit, remarks, line_order)
		        VALUES
		          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?)
	        `,
	        [
            poItemId,
            poId,
            itemId,
            quantity,
            rate,
            disc || null,
            tax || null,
            goodsAmount,
            taxAmount,
            totalAmount,
            'system',
	            areaUnit ? round2(dimLength) : null,
	            areaUnit ? round2(dimBreadth) : null,
	            areaUnit ? Math.trunc(Number(dimPcs)) : null,
	            areaUnit ? dimUnit : null,
              validTextOrNull(row?.remarks),
	            lineIndex + 1,
	          ]
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
          dimLength: areaUnit ? round2(dimLength) : null,
          dimBreadth: areaUnit ? round2(dimBreadth) : null,
          dimPcs: areaUnit ? Math.trunc(Number(dimPcs)) : null,
          dimUnit: areaUnit ? dimUnit : null,
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
              advanceAmount,
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
	      'SELECT id, pr_id AS prId, firm_id AS firmId, store_id AS storeId, status FROM purchase_orders WHERE id = ? LIMIT 1',
	      [poId]
	    );
	    if (!poRow) return res.status(404).json({ error: 'PO not found' });
      if (String(poRow.status ?? '').trim().toLowerCase() === 'draft') {
        return res.status(400).json({ error: 'Draft PO cannot be used for GRN.' });
      }

	    const [poItemRows] = await pool.query(
        `
	        SELECT
	          poi.id AS poItemId,
	          poi.item_id AS itemId,
	          poi.quantity AS quantity,
          poi.dim_unit AS poDimUnit,
          it.unit AS unit
        FROM purchase_order_items poi
        LEFT JOIN items it ON it.id = poi.item_id
        WHERE poi.po_id = ?
        `,
        [poId]
      );
		    const orderedMetaByPoItemId = new Map();
		    const orderedMetaByItemId = new Map();
		    for (const r of Array.isArray(poItemRows) ? poItemRows : []) {
		      const meta = {
		        poItemId: String(r.poItemId ?? ''),
		        itemId: String(r.itemId ?? ''),
		        orderedQty: Number(r.quantity ?? 0),
		        poDimUnit: r.poDimUnit != null ? String(r.poDimUnit) : null,
		        unit: r.unit != null ? String(r.unit) : null,
		      };
		      if (meta.poItemId) orderedMetaByPoItemId.set(meta.poItemId, meta);
		      if (meta.itemId && !orderedMetaByItemId.has(meta.itemId)) orderedMetaByItemId.set(meta.itemId, meta);
		    }

	    const grnId = crypto.randomUUID();
	    const grnNumber = await allocateDocNumber(pool, poRow.firmId, 'GRN', new Date(receivedDate));

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
			    for (const [lineIndex, row] of items.entries()) {
		      const itemId = String(row?.itemId ?? '').trim();
		      if (!itemId) return res.status(400).json({ error: 'Each item requires itemId' });
		      const poItemIdInput = String(row?.poItemId ?? row?.purchaseOrderItemId ?? '').trim();

	        const meta = poItemIdInput ? orderedMetaByPoItemId.get(poItemIdInput) : orderedMetaByItemId.get(itemId);
	        if (!meta) return res.status(400).json({ error: `PO item not found for GRN line ${lineIndex + 1}` });
	        if (String(meta.itemId ?? '').trim() !== itemId) return res.status(400).json({ error: `PO item mismatch for GRN line ${lineIndex + 1}` });
	        const poItemId = String(meta.poItemId ?? '').trim() || null;
	        const orderedQty = Number(meta?.orderedQty ?? 0);
        const poDimUnitFromRow = meta?.poDimUnit != null ? String(meta.poDimUnit) : null;
        const areaUnit = normalizeAreaUnitName(meta?.unit);
        const poDimUnit = poDimUnitFromRow || baseDimUnitForAreaUnit(areaUnit);
        const isArea = !!poDimUnit;

        const dimLengthInput = row?.length ?? row?.dimLength ?? row?.dim_length;
        const dimBreadthInput = row?.breadth ?? row?.dimBreadth ?? row?.dim_breadth;
        const dimPcsInput = row?.pcs ?? row?.dimPcs ?? row?.dim_pcs;
        const inputUnitRaw = row?.inputUnit ?? row?.dimInputUnit ?? row?.dim_input_unit ?? row?.recvDimInputUnit;
        const inputUnit = String(inputUnitRaw ?? '').trim().toLowerCase() || (poDimUnit ? String(poDimUnit).trim().toLowerCase() : '');

        const dimLength = dimLengthInput != null && String(dimLengthInput).trim() !== '' ? num(dimLengthInput, NaN) : NaN;
        const dimBreadth = dimBreadthInput != null && String(dimBreadthInput).trim() !== '' ? num(dimBreadthInput, NaN) : NaN;
        const dimPcs = dimPcsInput != null && String(dimPcsInput).trim() !== '' ? num(dimPcsInput, NaN) : 1;

	        const qtyReceivedInput = Number(row?.quantityReceived ?? 0);
	        const weightInput = Number(row?.weight ?? row?.grnWeight ?? 0);
	        const weightValue = Number.isFinite(weightInput) && weightInput > 0 ? round2(weightInput) : null;
	        const roundOffInput = Number(row?.roundOff ?? 0);
        const roundOffValue = Number.isFinite(roundOffInput) ? round2(roundOffInput) : 0;
        const qtyInputUnit = isArea ? computeAreaQty(dimLength, dimBreadth, dimPcs) : NaN;
        const qtyConverted = isArea ? convertAreaQty(qtyInputUnit, inputUnit, poDimUnit) : qtyReceivedInput;
        const qtyReceivedRaw = isArea ? (qtyConverted + roundOffValue) : qtyReceivedInput;
        const qtyReceived = round2(qtyReceivedRaw);

        if (isArea) {
          if (!poDimUnit || (inputUnit !== 'ft' && inputUnit !== 'm')) return res.status(400).json({ error: 'Invalid GRN input unit for area-unit item' });
          if (!Number.isFinite(qtyInputUnit) || qtyInputUnit <= 0) return res.status(400).json({ error: 'Each area-unit GRN item requires valid length, breadth and PCs' });
          if (!Number.isFinite(qtyReceived) || qtyReceived <= 0) return res.status(400).json({ error: 'Invalid converted GRN quantity for area-unit item' });
        } else {
          if (!Number.isFinite(qtyReceived) || qtyReceived <= 0) return res.status(400).json({ error: 'Each item requires valid quantityReceived' });
        }

	      const shortQty = Math.max(0, orderedQty - qtyReceived);
	      const grnItemId = crypto.randomUUID();

	      await pool.query(
			        `
			        INSERT INTO grn_items
			          (id, grn_id, po_item_id, item_id, ordered_qty, received_qty, short_qty, damaged_qty, created_by, created_at, updated_by, updated_at, recv_dim_length, recv_dim_breadth, recv_dim_pcs, recv_dim_input_unit, recv_dim_po_unit, weight, round_off)
			        VALUES
			          (?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(), ?, NOW(), ?, ?, ?, ?, ?, ?, ?)
		        `,
		        [
	            grnItemId,
	            grnId,
	            poItemId,
	            itemId,
	            orderedQty,
            qtyReceived,
            shortQty,
            'system',
            updatedBy || null,
            isArea ? round2(dimLength) : null,
            isArea ? round2(dimBreadth) : null,
	            isArea ? Math.trunc(Number(dimPcs)) : null,
	            isArea ? inputUnit : null,
	            isArea ? String(poDimUnit).trim().toLowerCase() : null,
	            weightValue,
	            isArea ? roundOffValue : null,
	          ]
	      );

	      outItems.push({
	          id: grnItemId,
	          grnId,
	          poItemId,
	          itemId,
          item: '',
          specificationsJson: undefined,
          quantityReceived: qtyReceived,
          recvDimLength: isArea ? round2(dimLength) : null,
          recvDimBreadth: isArea ? round2(dimBreadth) : null,
          recvDimPcs: isArea ? Math.trunc(Number(dimPcs)) : null,
	          recvDimInputUnit: isArea ? inputUnit : null,
	          recvDimPoUnit: isArea ? String(poDimUnit).trim().toLowerCase() : null,
	          weight: weightValue,
	          roundOff: isArea ? roundOffValue : null,
	        });
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

// Create Direct PO (not linked to any PR)
		app.post('/api/pos', async (req, res) => {
		  try {
		    const pool = getMysqlPool();
		    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
        const mode = normalizePoMode(req.body?.mode);

		    const firmId = String(req.body?.firmId ?? '').trim();
	    const storeId = String(req.body?.storeId ?? '').trim();
		    const projectId = req.body?.projectId != null ? String(req.body.projectId ?? '').trim() : '';
		    const supplierIdRaw = String(req.body?.supplierId ?? '').trim();
		    const supplierNameRaw = String(req.body?.supplier ?? '').trim();
        const department = String(req.body?.department ?? '').trim();
        const requestedBy = String(req.body?.requestedBy ?? '').trim();
        const remarksInput = String(req.body?.remarks ?? '').trim();
        const requiredDateInput = String(req.body?.requiredDate ?? '').trim();
	        const requiredDate = toIsoDate(requiredDateInput);
			    const paymentTerms = String(req.body?.paymentTerms ?? '').trim();
		      const poTypeRaw = String(req.body?.poType ?? '').trim();
		      const poType = poTypeRaw.toLowerCase() === 'services' ? 'Services' : 'Goods';
		      const paymentType = req.body?.paymentType != null ? String(req.body.paymentType).trim() || null : null;
		      const paymentMode = req.body?.paymentMode != null ? String(req.body.paymentMode).trim() || null : null;
		    const advanceAmount = Math.max(0, num(req.body?.advanceAmount, 0));
		    const advanceDateInput = req.body?.advanceDate;
	    const normalizedAdvanceDateInput =
	      advanceDateInput === null ? null : advanceDateInput != null ? toIsoDate(String(advanceDateInput).trim()) : undefined;
		    const autoAdvanceDate = new Date().toISOString().slice(0, 10);
		    const advanceDate = advanceAmount > 0 ? (normalizedAdvanceDateInput ?? autoAdvanceDate) : null;
		    const shippingAddress = req.body?.shippingAddress != null ? String(req.body.shippingAddress).trim() : null;
			    const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions).trim() : null;
			    const items = Array.isArray(req.body?.items) ? req.body.items : [];

        if (mode === 'draft') {
          const resolvedSupplier = await resolveSupplierInput(pool, supplierIdRaw, supplierNameRaw);
          const detail = await insertPoDraft(pool, {
            sourceType: 'DIRECT',
            firmId: firmId || null,
            storeId: storeId || null,
            projectId: projectId || null,
            supplierId: resolvedSupplier.supplierId,
            supplier: resolvedSupplier.supplierName || supplierNameRaw || null,
            poType,
            department,
            requestedBy,
            requiredDate,
            remarks: remarksInput,
            paymentTerms,
            paymentType,
            paymentMode,
            advanceAmount,
            advanceDate,
            shippingAddress,
            termsConditions,
            items,
          });
          return res.json({ po: detail });
        }

	        const normalizeSpecsObject = (raw) => {
          if (!raw || typeof raw !== 'object') return {};
          const out = {};
          for (const [k, v] of Object.entries(raw)) {
            const sid = String(k ?? '').trim();
            const sval = String(v ?? '').trim();
            if (!sid || !sval) continue;
            out[sid] = sval;
          }
          return out;
        };

        const stableJsonStringify = (obj) => {
          const entries = Object.entries(obj || {}).sort(([a], [b]) => String(a).localeCompare(String(b)));
          return JSON.stringify(Object.fromEntries(entries));
        };

    if (!firmId) return res.status(400).json({ error: 'firmId is required' });
        if (!department) return res.status(400).json({ error: 'department is required' });
        if (!requestedBy) return res.status(400).json({ error: 'requestedBy is required' });
        if (!requiredDate) return res.status(400).json({ error: 'requiredDate is required' });
	    if (!paymentTerms) return res.status(400).json({ error: 'paymentTerms is required' });
	    if (!items.length) return res.status(400).json({ error: 'items are required' });

    // Some DB schemas require store_id and pr_id to be non-null + FK-constrained.
    // For "Direct PO", we create an internal placeholder PR and link the PO to it.
    const [[fallbackStoreRow]] = await pool.query(
      'SELECT id FROM stores WHERE firm_id = ? ORDER BY name LIMIT 1',
      [firmId]
    );
    const effectiveStoreId = storeId || (fallbackStoreRow?.id ? String(fallbackStoreRow.id) : '');
    if (!effectiveStoreId) return res.status(400).json({ error: 'Store not found for selected firm' });

    const [specRows] = await pool.query('SELECT id, name FROM specifications');
    const specNameById = new Map(
      (Array.isArray(specRows) ? specRows : []).map((r) => [String(r.id ?? '').trim(), String(r.name ?? '').trim()])
    );

    let supplierId = supplierIdRaw;
    let supplierName = supplierNameRaw;
    if (!supplierId) {
      if (!supplierName) return res.status(400).json({ error: 'supplierId is required' });
      const [supRows] = await pool.query('SELECT id, name FROM suppliers WHERE name = ? LIMIT 1', [supplierName]);
      const supRow = Array.isArray(supRows) ? supRows[0] : null;
      if (!supRow?.id) return res.status(400).json({ error: 'Supplier not found' });
      supplierId = String(supRow.id);
      supplierName = String(supRow.name ?? supplierName);
    } else {
      const [[sRow]] = await pool.query('SELECT id, name FROM suppliers WHERE id = ? LIMIT 1', [supplierId]);
      if (!sRow?.id) return res.status(400).json({ error: 'Supplier not found' });
      supplierName = String(sRow.name ?? supplierName);
    }

	    const poId = crypto.randomUUID();
	    const poNumber = await allocateDocNumber(pool, firmId, 'PO', new Date());

	    const directPrId = crypto.randomUUID();
	    const directPrNumber = await allocateDocNumber(pool, firmId, 'PR', new Date());
	    const directRemarks = JSON.stringify({
        department,
        directPo: true,
        requiredDate,
        ...(remarksInput ? { remarks: remarksInput } : {}),
      });
	    const directRequestType = projectId ? 'Project' : 'Stock';

	    await pool.query(
	      `
	      INSERT INTO purchase_requisitions
	        (id, pr_number, firm_id, store_id, project_id, requested_by, status, remarks, created_by, created_at, updated_at, request_type)
	      VALUES
	        (?, ?, ?, ?, ?, ?, 'approved', ?, ?, NOW(), NOW(), ?)
	      `,
	      [
	        directPrId,
	        directPrNumber,
	        firmId,
	        effectiveStoreId,
	        projectId ? projectId : null,
	        requestedBy,
	        directRemarks,
	        'system',
	        directRequestType,
	      ]
	    );

			    await pool.query(
				      `
					      INSERT INTO purchase_orders
					        (id, po_number, firm_id, store_id, project_id, supplier_id, pr_id, po_type, po_source, status, order_date, payment_terms, payment_type, payment_mode, advance_amount, advance_date, remarks, requested_by, required_date, created_by, created_at, updated_at, shipping_address, terms_conditions)
					      VALUES
						        (?, ?, ?, ?, ?, ?, ?, ?, 'DIRECT', 'issued', CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)
				      `,
				      [
			        poId,
		        poNumber,
		        firmId,
		        effectiveStoreId,
		        projectId ? projectId : null,
			        supplierId,
				        directPrId,
				        poType,
				        paymentTerms,
	              paymentType,
	              paymentMode,
			          advanceAmount,
		          advanceDate,
	              remarksInput || null,
                requestedBy,
                requiredDate,
				        'system',
	        shippingAddress,
	        termsConditions,
	      ]
	    );
	    if (advanceAmount > 0 && advanceDate) {
	      await pool.query(
	        `
	        INSERT INTO po_advances (id, po_id, advance_date, advance_amount, created_by, created_at, updated_at)
	        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
	        `,
	        [crypto.randomUUID(), poId, advanceDate, advanceAmount, 'system']
	      );
	    }

	    const outItems = [];
	    for (const [lineIndex, row] of items.entries()) {
	      let itemId = String(row?.itemId ?? '').trim();
        if (!itemId) {
		        const itemNameId = String(row?.itemNameId ?? '').trim();
		          const specsObj = normalizeSpecsObject(row?.specs);
		          const specIds = Object.keys(specsObj);
		          if (!itemNameId) return res.status(400).json({ error: 'Each item requires itemId (or itemNameId+specs)' });

		          const [[iname]] = await pool.query('SELECT type FROM item_names WHERE id=? LIMIT 1', [itemNameId]);
		          const specificationsJson = stableJsonStringify(specsObj);
		          const uniqueKey = `${itemNameId}:${sha256(specificationsJson).slice(0, 16)}`;

          const [[found]] = await pool.query('SELECT id FROM items WHERE unique_key=? LIMIT 1', [uniqueKey]);
          if (found?.id) {
            itemId = String(found.id);
          } else {
            const newId = crypto.randomUUID();
            const itemCode = `IT-${newId.slice(0, 8).toUpperCase()}`;
            const [[meta]] = await pool.query(
              `
              SELECT u.name AS unitName
              FROM item_names n
              LEFT JOIN units u ON u.id = n.unit_id
              WHERE n.id = ?
              LIMIT 1
              `,
              [itemNameId]
            );
            const unitName = meta?.unitName != null ? String(meta.unitName) : null;
            await pool.query(
              `
              INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, reorder_level, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, NOW(), NOW())
              `,
              [newId, itemNameId, itemCode, specificationsJson, uniqueKey, unitName, 'system']
            );
            itemId = newId;
          }
	        }

		      if (itemId) {
		        const [[typeRow]] = await pool.query(
		          `
		          SELECT n.type AS type
		          FROM items it
		          JOIN item_names n ON n.id = it.item_name_id
		          WHERE it.id = ?
		          LIMIT 1
		          `,
		          [itemId]
		        );
		        const itemType = String(typeRow?.type ?? '').trim() || 'Goods';
		        if (poType === 'Goods' && itemType === 'Services') return res.status(400).json({ error: 'PO Type is Goods. Service item is not allowed.' });
		        if (poType === 'Services' && itemType === 'Goods') return res.status(400).json({ error: 'PO Type is Services. Goods item is not allowed.' });
		      }

		      const quantityInput = Number(row?.quantity ?? 0);
		      const rate = Number(row?.rate ?? 0);
		      const discountPercent = row?.discountPercent != null ? Number(row.discountPercent) : null;
		      const taxPercent = row?.taxPercent != null ? Number(row.taxPercent) : null;
		      if (!itemId) return res.status(400).json({ error: 'Each item requires itemId' });

		      // Fetch unit for dimension logic
		      const [[unitRow]] = await pool.query('SELECT unit FROM items WHERE id = ? LIMIT 1', [itemId]);
		      const unitNameForRow = unitRow?.unit != null ? String(unitRow.unit) : null;
			      const areaUnit = normalizeAreaUnitName(unitNameForRow);
		      const dimUnit = baseDimUnitForAreaUnit(areaUnit);
		      const dimLengthInput = row?.length ?? row?.dimLength ?? row?.dim_length;
		      const dimBreadthInput = row?.breadth ?? row?.dimBreadth ?? row?.dim_breadth;
		      const dimPcsInput = row?.pcs ?? row?.dimPcs ?? row?.dim_pcs;
		      const dimLength = dimLengthInput != null && String(dimLengthInput).trim() !== '' ? num(dimLengthInput, NaN) : NaN;
		      const dimBreadth = dimBreadthInput != null && String(dimBreadthInput).trim() !== '' ? num(dimBreadthInput, NaN) : NaN;
		      const dimPcs = dimPcsInput != null && String(dimPcsInput).trim() !== '' ? num(dimPcsInput, NaN) : 1;

		      const quantityRaw = areaUnit ? computeAreaQty(dimLength, dimBreadth, dimPcs) : quantityInput;
		      const quantity = round2(quantityRaw);
		      if (areaUnit) {
		        if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) return res.status(400).json({ error: 'Each area-unit PO item requires valid length, breadth and PCs' });
		      } else {
		        if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) return res.status(400).json({ error: 'Each item requires valid quantity' });
		      }

		      if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ error: 'Each item requires valid rate' });

		      const disc = Number.isFinite(discountPercent) ? Math.max(0, discountPercent) : 0;
		      const tax = Number.isFinite(taxPercent) ? Math.max(0, taxPercent) : 0;
		      const gross = quantity * rate;
		      const goodsAmount = gross * (1 - disc / 100);
		      const taxAmount = goodsAmount * (tax / 100);
		      const totalAmount = goodsAmount + taxAmount;

		      // Create a placeholder PR item so PR-based screens can still show item/spec details.
		      let prSpecText = '';
		      try {
		        const [[itRow]] = await pool.query('SELECT specifications_json AS specificationsJson FROM items WHERE id = ? LIMIT 1', [itemId]);
		        const rawSpecs = itRow?.specificationsJson != null ? String(itRow.specificationsJson) : '';
		        if (rawSpecs.trim()) {
		          try {
		            const obj = JSON.parse(rawSpecs) || {};
		            if (obj && typeof obj === 'object') {
		              const lines = [];
		              for (const [specId, v] of Object.entries(obj)) {
		                const k = String(specId ?? '').trim();
		                const val = String(v ?? '').trim();
		                if (!k || !val) continue;
		                const specName = specNameById.get(k) || k;
		                lines.push(`${specName}: ${val}`);
		              }
		              prSpecText = lines.join('\n');
		            }
		          } catch {
		            // Fallback: treat as newline-separated specification text.
		            prSpecText = rawSpecs
		              .split(/\r?\n/)
		              .map((s) => s.trim())
		              .filter(Boolean)
		              .join('\n');
		          }
		        }
		      } catch {}

		      const prItemId = crypto.randomUUID();
		      await pool.query(
		        `
		        INSERT INTO purchase_requisition_items
		          (id, pr_id, item_id, requested_qty, approved_qty, required_date, remarks, status, created_by, created_at, updated_at, dim_length, dim_breadth, dim_pcs, dim_unit, approved_dim_length, approved_dim_breadth, approved_dim_pcs, approved_dim_unit)
		        VALUES
		          (?, ?, ?, ?, ?, ?, ?, 'approved', ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?)
		        `,
		        [
		          prItemId,
		          directPrId,
		          itemId,
		          quantity,
		          quantity,
		          requiredDate,
		          prSpecText,
		          'system',
		          areaUnit ? round2(dimLength) : null,
		          areaUnit ? round2(dimBreadth) : null,
		          areaUnit ? Math.trunc(Number(dimPcs)) : null,
		          areaUnit ? dimUnit : null,
		          areaUnit ? round2(dimLength) : null,
		          areaUnit ? round2(dimBreadth) : null,
		          areaUnit ? Math.trunc(Number(dimPcs)) : null,
		          areaUnit ? dimUnit : null,
		        ]
		      );

		      const poItemId = crypto.randomUUID();
		      await pool.query(
		        `
		        INSERT INTO purchase_order_items
		          (id, po_id, item_id, description, quantity, rate, discount_percent, tax_percent, goods_amount, tax_amount, total_amount, created_by, created_at, updated_at, dim_length, dim_breadth, dim_pcs, dim_unit, remarks, line_order)
		        VALUES
		          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?)
		        `,
		        [
		          poItemId,
		          poId,
		          itemId,
		          validTextOrNull(row?.description),
		          quantity,
		          rate,
		          disc || null,
		          tax || null,
		          goodsAmount,
		          taxAmount,
		          totalAmount,
		          'system',
	            areaUnit ? round2(dimLength) : null,
	            areaUnit ? round2(dimBreadth) : null,
	            areaUnit ? Math.trunc(Number(dimPcs)) : null,
	            areaUnit ? dimUnit : null,
              validTextOrNull(row?.remarks),
	            lineIndex + 1,
	          ]
		      );

      outItems.push({
        poId,
        itemId,
        description: validTextOrNull(row?.description) || undefined,
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
	          prId: directPrId,
	          firmId,
	          orderDate: new Date().toISOString().slice(0, 10),
	          createdBy: 'system',
	          supplierId,
	          supplier: supplierName,
		          paymentTerms,
	            advanceAmount,
            advanceDate,
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

app.get('/api/pos/:id/advances', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'id is required' });

    const [[poRow]] = await pool.query(
      'SELECT id, advance_amount AS advanceAmount, advance_date AS advanceDate, order_date AS orderDate FROM purchase_orders WHERE id = ? LIMIT 1',
      [poId]
    );
    if (!poRow) return res.status(404).json({ error: 'PO not found' });

	    const [rows] = await pool.query(
	      `
	      SELECT
	        id,
	        po_id AS poId,
	        advance_date AS advanceDate,
	        advance_amount AS advanceAmount,
	        payment_mode AS paymentMode,
	        payment_copy AS paymentCopy,
        remarks
	      FROM po_advances
	      WHERE po_id = ?
	      ORDER BY advance_date ASC, created_at ASC
	      `,
	      [poId]
	    );

	    let advances = (Array.isArray(rows) ? rows : []).map((r) => ({
	      id: String(r.id ?? ''),
	      poId: String(r.poId ?? poId),
	      advanceDate: toIsoDate(r.advanceDate) || '',
	      advanceAmount: Number(r.advanceAmount ?? 0),
	      paymentMode: r.paymentMode != null ? String(r.paymentMode) : '',
	      paymentCopy: r.paymentCopy != null ? String(r.paymentCopy) : '',
      remarks: r.remarks != null ? String(r.remarks) : '',
	    }));

    if (!advances.length && Number(poRow.advanceAmount ?? 0) > 0) {
	      advances = [
	        {
	          id: `legacy-${poId}`,
	          poId,
	          advanceDate: toIsoDate(poRow.advanceDate) || toIsoDate(poRow.orderDate) || new Date().toISOString().slice(0, 10),
	          advanceAmount: Number(poRow.advanceAmount ?? 0),
	          paymentMode: '',
	          paymentCopy: '',
          remarks: '',
	        },
	      ];
	    }

    res.json({ advances });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/pos/:id/advances', async (req, res) => {
  let conn;
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'id is required' });

	    const input = Array.isArray(req.body?.advances) ? req.body.advances : [];
	    const normalized = [];
	    for (const raw of input) {
	      const advanceDate = toIsoDate(String(raw?.advanceDate ?? '').trim());
	      const advanceAmount = Math.max(0, num(raw?.advanceAmount, 0));
	      const paymentMode = raw?.paymentMode != null ? String(raw.paymentMode).trim() : '';
	      const paymentCopy = raw?.paymentCopy != null ? String(raw.paymentCopy).trim() : '';
      const remarks = raw?.remarks != null ? String(raw.remarks).trim() : '';
	      if (!advanceDate) continue;
	      if (!Number.isFinite(advanceAmount) || advanceAmount <= 0) continue;
	      normalized.push({
	        id: String(raw?.id ?? '').trim(),
	        advanceDate,
	        advanceAmount,
	        paymentMode,
	        paymentCopy,
        remarks,
	      });
	    }
      for (const row of normalized) {
        if (!String(row.paymentMode ?? '').trim()) {
          return res.status(400).json({ error: 'paymentMode is required for each advance row' });
        }
      }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[poRow]] = await conn.query('SELECT id FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
    if (!poRow) {
      await conn.rollback();
      return res.status(404).json({ error: 'PO not found' });
    }

	    await conn.query('DELETE FROM po_advances WHERE po_id = ?', [poId]);
	    for (const row of normalized) {
	      await conn.query(
	        `
	        INSERT INTO po_advances (id, po_id, advance_date, advance_amount, payment_mode, payment_copy, remarks, created_by, created_at, updated_at)
	        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
	        `,
	        [row.id || crypto.randomUUID(), poId, row.advanceDate, row.advanceAmount, row.paymentMode || null, row.paymentCopy || null, row.remarks || null, 'Purchase Team']
	      );
	    }

    const summary = await syncPoAdvanceSummary(conn, poId);
    await conn.commit();

	    const [savedRows] = await pool.query(
	      `
	      SELECT
	        id,
	        po_id AS poId,
	        advance_date AS advanceDate,
	        advance_amount AS advanceAmount,
	        payment_mode AS paymentMode,
	        payment_copy AS paymentCopy,
        remarks
	      FROM po_advances
	      WHERE po_id = ?
	      ORDER BY advance_date ASC, created_at ASC
	      `,
	      [poId]
	    );
	    const advances = (Array.isArray(savedRows) ? savedRows : []).map((r) => ({
	      id: String(r.id ?? ''),
	      poId: String(r.poId ?? poId),
	      advanceDate: toIsoDate(r.advanceDate) || '',
	      advanceAmount: Number(r.advanceAmount ?? 0),
	      paymentMode: r.paymentMode != null ? String(r.paymentMode) : '',
	      paymentCopy: r.paymentCopy != null ? String(r.paymentCopy) : '',
      remarks: r.remarks != null ? String(r.remarks) : '',
	    }));

    res.json({ ok: true, advances, summary });
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

app.put('/api/pos/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'id is required' });

	    const [[poRow]] = await pool.query(
	      'SELECT id, status, po_type AS poType, advance_amount AS advanceAmount, advance_date AS advanceDate FROM purchase_orders WHERE id = ? LIMIT 1',
	      [poId]
	    );
	    if (!poRow) return res.status(404).json({ error: 'PO not found' });
      const currentStatus = String(poRow.status ?? '').trim().toLowerCase();
      const mode = normalizePoMode(req.body?.mode);
      const updatedBy = String(req.body?.updatedBy ?? '').trim() || 'system';

      if (currentStatus === 'draft') {
        const current = await fetchPoHeaderAndItems(pool, poId);
        if (!current) return res.status(404).json({ error: 'PO not found' });
        const payload = current.po?.draftPayload ?? {};
        const mergedItems = Array.isArray(req.body?.items) ? req.body.items : current.items ?? payload.lines ?? [];
        const sourceType = normalizePoSource(req.body?.sourceType ?? current.po?.sourceType ?? payload.sourceType);
        const requestedBy = validTextOrNull(req.body?.requestedBy) ?? validTextOrNull(current.po?.requestedBy) ?? validTextOrNull(payload.requestedBy);
        const requiredDate =
          toIsoDate(validTextOrNull(req.body?.requiredDate)) ||
          toIsoDate(validTextOrNull(current.po?.requiredDate)) ||
          toIsoDate(validTextOrNull(payload.requiredDate));
        const firmId = validIdOrNull(req.body?.firmId) ?? validIdOrNull(current.po?.firmId) ?? validIdOrNull(payload.firmId);
        const storeId = validIdOrNull(req.body?.storeId) ?? validIdOrNull(current.po?.storeId) ?? validIdOrNull(payload.storeId);
        const projectId = validIdOrNull(req.body?.projectId) ?? validIdOrNull(current.po?.projectId) ?? validIdOrNull(payload.projectId);
        const supplierResolved = await resolveSupplierInput(
          pool,
          req.body?.supplierId ?? current.po?.supplierId ?? payload.supplierId,
          req.body?.supplier ?? current.po?.supplier ?? payload.supplier
        );
        const paymentTerms = validTextOrNull(req.body?.paymentTerms) ?? validTextOrNull(current.po?.paymentTerms) ?? validTextOrNull(payload.paymentTerms);
        const paymentType = validTextOrNull(req.body?.paymentType) ?? validTextOrNull(current.po?.paymentType) ?? validTextOrNull(payload.paymentType);
        const paymentMode = validTextOrNull(req.body?.paymentMode) ?? validTextOrNull(current.po?.paymentMode) ?? validTextOrNull(payload.paymentMode);
        const shippingAddress =
          validTextOrNull(req.body?.shippingAddress) ?? validTextOrNull(current.po?.shippingAddress) ?? validTextOrNull(payload.shippingAddress);
        const termsConditions =
          validTextOrNull(req.body?.termsConditions) ?? validTextOrNull(current.po?.termsConditions) ?? validTextOrNull(payload.termsConditions);
        const remarks = validTextOrNull(req.body?.remarks) ?? validTextOrNull(current.po?.remarks) ?? validTextOrNull(payload.remarks);
        const poType = validTextOrNull(req.body?.poType) ?? validTextOrNull(current.po?.poType) ?? validTextOrNull(payload.poType) ?? 'Goods';
        const advanceAmount = Math.max(
          0,
          num(req.body?.advanceAmount, Number(current.po?.advanceAmount ?? payload.advanceAmount ?? poRow.advanceAmount ?? 0))
        );
        const advanceDateInput =
          req.body?.advanceDate !== undefined ? req.body?.advanceDate : current.po?.advanceDate ?? payload.advanceDate ?? poRow.advanceDate;
        const advanceDate = advanceAmount > 0 ? toIsoDate(validTextOrNull(advanceDateInput)) || new Date().toISOString().slice(0, 10) : null;
        const prId = validIdOrNull(req.body?.prId) ?? validIdOrNull(current.po?.prId) ?? validIdOrNull(payload.prId);

        if (mode === 'draft') {
          const detail = await updatePoDraft(pool, poId, {
            sourceType,
            prId,
            firmId,
            storeId,
            projectId,
            supplierId: supplierResolved.supplierId,
            supplier: supplierResolved.supplierName || current.po?.supplier || payload.supplier || null,
            poType,
            requestedBy,
            requiredDate,
            remarks,
            paymentTerms,
            paymentType,
            paymentMode,
            advanceAmount,
            advanceDate,
            shippingAddress,
            termsConditions,
            items: mergedItems,
          });
          return res.json({ po: detail });
        }

        if (!paymentTerms) return res.status(400).json({ error: 'paymentTerms is required' });
        if (!supplierResolved.supplierId) return res.status(400).json({ error: 'Supplier is required' });
        const issueItems = Array.isArray(mergedItems) ? mergedItems : [];
        if (!issueItems.length) return res.status(400).json({ error: 'items are required' });

        let finalPrId = prId;
        let finalStoreId = storeId;
        if (sourceType === 'DIRECT') {
          if (!firmId) return res.status(400).json({ error: 'firmId is required' });
          if (!requestedBy) return res.status(400).json({ error: 'requestedBy is required' });
          if (!requiredDate) return res.status(400).json({ error: 'requiredDate is required' });
          const [[fallbackStoreRow]] = await pool.query('SELECT id FROM stores WHERE firm_id = ? ORDER BY name LIMIT 1', [firmId]);
          finalStoreId = finalStoreId || (fallbackStoreRow?.id ? String(fallbackStoreRow.id) : null);
          if (!finalStoreId) return res.status(400).json({ error: 'Store not found for selected firm' });
          if (!finalPrId) {
            const directPrId = crypto.randomUUID();
            const directPrNumber = await allocateDocNumber(pool, firmId, 'PR', new Date());
            const directRemarks = JSON.stringify({
              department: validTextOrNull(payload.department) ?? 'N/A',
              directPo: true,
              requiredDate,
              ...(remarks ? { remarks } : {}),
            });
            const directRequestType = projectId ? 'Project' : 'Stock';
            await pool.query(
              `
              INSERT INTO purchase_requisitions
                (id, pr_number, firm_id, store_id, project_id, requested_by, status, remarks, created_by, created_at, updated_at, request_type)
              VALUES
                (?, ?, ?, ?, ?, ?, 'approved', ?, ?, NOW(), NOW(), ?)
              `,
              [directPrId, directPrNumber, firmId, finalStoreId, projectId || null, requestedBy, directRemarks, 'system', directRequestType]
            );
            finalPrId = directPrId;
          }
        } else if (!finalPrId) {
          return res.status(400).json({ error: 'PR is required' });
        }

        await pool.query('DELETE FROM po_advances WHERE po_id = ?', [poId]);
        await replacePoItemsForIssue(pool, poId, issueItems, poType);
        await pool.query(
          `
          UPDATE purchase_orders
          SET firm_id = ?,
              store_id = ?,
              project_id = ?,
              supplier_id = ?,
              pr_id = ?,
              po_type = ?,
              po_source = ?,
              status = 'issued',
              payment_terms = ?,
              payment_type = ?,
              payment_mode = ?,
              advance_amount = ?,
              advance_date = ?,
              remarks = ?,
              requested_by = ?,
              required_date = ?,
              shipping_address = ?,
              terms_conditions = ?,
              draft_payload = ?,
              updated_by = ?,
              updated_at = NOW()
          WHERE id = ?
          `,
          [
            firmId,
            finalStoreId,
            projectId,
            supplierResolved.supplierId,
            finalPrId,
            poType,
            sourceType,
            paymentTerms,
            paymentType,
            paymentMode,
            advanceAmount,
            advanceDate,
            remarks,
            requestedBy,
            requiredDate,
            shippingAddress,
            termsConditions,
            JSON.stringify({
              ...buildPoDraftPayload({
                firmId,
                storeId: finalStoreId,
                projectId,
                supplierId: supplierResolved.supplierId,
                supplier: supplierResolved.supplierName,
                poType,
                requestedBy,
                requiredDate,
                remarks,
                paymentTerms,
                paymentType,
                paymentMode,
                advanceAmount,
                advanceDate,
                shippingAddress,
                termsConditions,
                items: issueItems,
              }),
              sourceType,
            }),
            updatedBy,
            poId,
          ]
        );
        if (advanceAmount > 0 && advanceDate) {
          await pool.query(
            `
            INSERT INTO po_advances (id, po_id, advance_date, advance_amount, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
            `,
            [crypto.randomUUID(), poId, advanceDate, advanceAmount, updatedBy]
          );
        }
        const detail = await fetchPoHeaderAndItems(pool, poId);
        return res.json({ po: detail });
      }

	    const supplierId = req.body?.supplierId != null ? String(req.body.supplierId).trim() : '';
    const paymentTerms = String(req.body?.paymentTerms ?? '').trim();
    const shippingAddress = req.body?.shippingAddress != null ? String(req.body.shippingAddress).trim() : null;
    const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions).trim() : null;
    const statusInput = String(req.body?.status ?? '').trim().toLowerCase();
    const cancelReason = req.body?.cancelReason != null ? String(req.body.cancelReason).trim() : '';
    const advanceAmount = Math.max(0, num(req.body?.advanceAmount, Number(poRow.advanceAmount ?? 0)));
    const advanceDateInput = req.body?.advanceDate;
    const normalizedAdvanceDateInput =
      advanceDateInput === null ? null : advanceDateInput != null ? toIsoDate(String(advanceDateInput).trim()) : undefined;
    const existingAdvanceDate = toIsoDate(poRow.advanceDate) || null;
    const autoAdvanceDate = new Date().toISOString().slice(0, 10);
    const advanceDate =
      advanceAmount > 0 ? (normalizedAdvanceDateInput ?? existingAdvanceDate ?? autoAdvanceDate) : null;
    const lineCancels = Array.isArray(req.body?.lineCancels) ? req.body.lineCancels : [];
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const poType = String(req.body?.poType ?? poRow.poType ?? 'Goods').trim() === 'Services' ? 'Services' : 'Goods';

    if (!paymentTerms) return res.status(400).json({ error: 'paymentTerms is required' });
    if (!items.length) return res.status(400).json({ error: 'items are required' });

    const mappedStatus = statusInput === 'closed' ? 'closed' : statusInput === 'partial' ? 'partial' : 'issued';
    const finalStatus = cancelReason ? 'closed' : mappedStatus;

    if (supplierId) {
      const [[s]] = await pool.query('SELECT id FROM suppliers WHERE id = ? LIMIT 1', [supplierId]);
      if (!s) return res.status(400).json({ error: 'Supplier not found' });
    }

    await pool.query(
      `
      UPDATE purchase_orders
      SET supplier_id = COALESCE(NULLIF(?, ''), supplier_id),
          payment_terms = ?,
          shipping_address = ?,
          terms_conditions = ?,
          status = ?,
          advance_amount = ?,
          advance_date = ?,
          cancel_reason = ?,
          cancelled_by = ?,
          cancelled_at = ?,
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [
        supplierId,
        paymentTerms,
        shippingAddress,
        termsConditions,
        finalStatus,
        advanceAmount,
        advanceDate,
        cancelReason || null,
        cancelReason ? updatedBy : null,
        cancelReason ? new Date() : null,
        updatedBy,
        poId,
      ]
    );

    const cancelByItemId = new Map();
    for (const lc of lineCancels) {
      const itemId = String(lc?.itemId ?? '').trim();
      const cancelledQty = Math.max(0, num(lc?.cancelledQty, 0));
      const reason = String(lc?.cancelReason ?? '').trim();
      if (itemId && cancelledQty > 0) cancelByItemId.set(itemId, { cancelledQty, reason });
    }

    for (const [lineIndex, row] of items.entries()) {
      const itemId = await resolveDraftPoItemId(pool, row, poType);
      if (!itemId) return res.status(400).json({ error: 'Each item requires item selection.' });

      const quantity = num(row?.quantity, NaN);
      const rate = num(row?.rate, NaN);
      const discountPercent = Math.max(0, num(row?.discountPercent, 0));
      const taxPercent = Math.max(0, num(row?.taxPercent, 0));
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0) {
        return res.status(400).json({ error: `Invalid Qty or Rate for PO line ${lineIndex + 1}` });
      }

      const [[unitRow]] = await pool.query('SELECT unit FROM items WHERE id = ? LIMIT 1', [itemId]);
      const areaUnit = normalizeAreaUnitName(unitRow?.unit != null ? String(unitRow.unit) : null);
      const dimUnit = baseDimUnitForAreaUnit(areaUnit);
      const dimLengthInput = row?.length ?? row?.dimLength ?? row?.dim_length;
      const dimBreadthInput = row?.breadth ?? row?.dimBreadth ?? row?.dim_breadth;
      const dimPcsInput = row?.pcs ?? row?.dimPcs ?? row?.dim_pcs;
      const dimLength = dimLengthInput != null && String(dimLengthInput).trim() !== '' ? num(dimLengthInput, NaN) : NaN;
      const dimBreadth = dimBreadthInput != null && String(dimBreadthInput).trim() !== '' ? num(dimBreadthInput, NaN) : NaN;
      const dimPcs = dimPcsInput != null && String(dimPcsInput).trim() !== '' ? num(dimPcsInput, NaN) : 1;

      const lineCancel = cancelByItemId.get(itemId) || { cancelledQty: 0, reason: '' };
      const cancelledQty = Math.max(0, Math.min(quantity, num(lineCancel.cancelledQty, 0)));
      const effectiveQty = Math.max(0, quantity - cancelledQty);
      const goodsAmount = effectiveQty * rate * (1 - discountPercent / 100);
      const taxAmount = goodsAmount * (taxPercent / 100);
      const totalAmount = goodsAmount + taxAmount;
      const poItemId = String(row?.poItemId ?? row?.purchaseOrderItemId ?? row?.id ?? '').trim();
      const updateWithItemId = [
        itemId,
        validTextOrNull(row?.description),
        quantity,
        rate,
        discountPercent || null,
        taxPercent || null,
        cancelledQty,
        lineCancel.reason || null,
        goodsAmount,
        taxAmount,
        totalAmount,
        areaUnit ? round2(dimLength) : null,
        areaUnit ? round2(dimBreadth) : null,
        areaUnit ? Math.trunc(dimPcs) : null,
        areaUnit ? dimUnit : null,
        validTextOrNull(row?.remarks),
        lineIndex,
        updatedBy,
      ];

      let result;
      if (poItemId) {
        [result] = await pool.query(
          `
          UPDATE purchase_order_items
          SET item_id = ?,
              description = ?,
              quantity = ?,
              rate = ?,
              discount_percent = ?,
              tax_percent = ?,
              cancelled_qty = ?,
              cancel_reason = ?,
              goods_amount = ?,
              tax_amount = ?,
              total_amount = ?,
              dim_length = ?,
              dim_breadth = ?,
              dim_pcs = ?,
              dim_unit = ?,
              remarks = ?,
              line_order = ?,
              updated_by = ?,
              updated_at = NOW()
          WHERE po_id = ? AND id = ?
          `,
          [...updateWithItemId, poId, poItemId]
        );
      } else {
        [result] = await pool.query(
          `
          UPDATE purchase_order_items
          SET description = ?,
              quantity = ?,
              rate = ?,
              discount_percent = ?,
              tax_percent = ?,
              cancelled_qty = ?,
              cancel_reason = ?,
              goods_amount = ?,
              tax_amount = ?,
              total_amount = ?,
              dim_length = ?,
              dim_breadth = ?,
              dim_pcs = ?,
              dim_unit = ?,
              remarks = ?,
              line_order = ?,
              updated_by = ?,
              updated_at = NOW()
          WHERE po_id = ? AND item_id = ?
          `,
          updateWithItemId.slice(1).concat([poId, itemId])
        );
      }

      if (!Number(result?.affectedRows ?? 0)) {
        await pool.query(
          `
          INSERT INTO purchase_order_items
            (id, po_id, item_id, description, quantity, rate, discount_percent, tax_percent, cancelled_qty, cancel_reason, goods_amount, tax_amount, total_amount, dim_length, dim_breadth, dim_pcs, dim_unit, remarks, line_order, created_by, created_at, updated_by, updated_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW())
          `,
          [crypto.randomUUID(), poId, ...updateWithItemId, updatedBy]
        );
      }
    }
    const detail = await fetchPoHeaderAndItems(pool, poId);
    if (!detail) return res.status(404).json({ error: 'PO not found' });
    res.json({ po: detail });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/pos/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'id is required' });
    const cancelledBy = String(req.body?.deletedBy ?? '').trim() || 'system';
    const cancelReason = String(req.body?.cancelReason ?? '').trim() || 'Cancelled by user';
    await pool.query(
      `UPDATE purchase_orders SET status='closed', cancel_reason=?, cancelled_by=?, cancelled_at=NOW(), updated_by=?, updated_at=NOW() WHERE id=?`,
      [cancelReason, cancelledBy, cancelledBy, poId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Download PO PDF
app.get('/api/pos/:id.pdf', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).send('Database is not configured.');

	    const poId = String(req.params.id ?? '').trim();
	    if (!poId) return res.status(400).send('id is required');
      const [[statusRow]] = await pool.query('SELECT status FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!statusRow) return res.status(404).send('PO not found');
      if (String(statusRow.status ?? '').trim().toLowerCase() === 'draft') return res.status(400).send('Draft PO cannot be downloaded as PDF.');

	    const [[poRow]] = await pool.query(
      `
      SELECT
        po.id AS id,
        po.po_number AS poNumber,
        po.order_date AS orderDate,
        po.payment_terms AS paymentTerms,
        po.shipping_address AS shippingAddress,
        po.terms_conditions AS termsConditions,
        f.name AS firmName,
        f.address AS firmAddress,
        f.terms_conditions AS firmTermsConditions,
        f.gst_number AS firmGstNumber,
        f.logo_url AS firmLogoUrl,
        st.name AS storeName,
        proj.name AS projectName,
        s.name AS supplierName,
        s.address AS supplierAddress,
        s.gst_number AS supplierGstNumber,
        s.gst_type AS supplierGstType
      FROM purchase_orders po
      LEFT JOIN firms f ON f.id = po.firm_id
      LEFT JOIN stores st ON st.id = po.store_id
      LEFT JOIN projects proj ON proj.id = po.project_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = ?
      LIMIT 1
      `,
      [poId]
    );
    if (!poRow) return res.status(404).send('PO not found');

	    const [itemRows] = await pool.query(
	      `
	      SELECT
	        iname.name AS itemName,
	        it.specifications_json AS specificationsJson,
	        u.name AS unitName,
	        poi.quantity AS quantity,
	        poi.rate AS rate,
	        poi.discount_percent AS discountPercent,
	        poi.tax_percent AS taxPercent,
	        poi.goods_amount AS goodsAmount,
	        poi.tax_amount AS taxAmount,
	        poi.total_amount AS totalAmount,
	        poi.dim_length AS dimLength,
	        poi.dim_breadth AS dimBreadth,
	        poi.dim_pcs AS dimPcs,
	        poi.dim_unit AS dimUnit,
	        poi.remarks AS remarks
	      FROM purchase_order_items poi
	      LEFT JOIN items it ON it.id = poi.item_id
	      LEFT JOIN item_names iname ON iname.id = it.item_name_id
	      LEFT JOIN units u ON u.id = iname.unit_id
	      WHERE poi.po_id = ?
	      ORDER BY COALESCE(poi.line_order, 999999) ASC, poi.created_at ASC, poi.id ASC
	      `,
	      [poId]
	    );

    const [specRows] = await pool.query('SELECT id, name FROM specifications ORDER BY name');
    const specNameById = new Map(
      (Array.isArray(specRows) ? specRows : []).map((r) => [String(r.id ?? '').trim(), String(r.name ?? '').trim()])
    );

    const formatSpecParts = (specificationsJson) => {
      const raw = String(specificationsJson ?? '').trim();
      if (!raw) return [];
      try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return [];
        const out = [];
        for (const [k, v] of Object.entries(obj)) {
          const val = String(v ?? '').trim();
          if (!val) continue;
          const name = specNameById.get(String(k ?? '').trim()) || '';
          out.push(name ? `${name}: ${val}` : val);
        }
        return out;
      } catch {
        return raw
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    };

	    const stripBracketText = (s) => {
	      const raw = String(s ?? '');
	      return raw
	        .replace(/\[[^\]]*\]/g, ' ')
	        .replace(/\([^)]*\)/g, ' ')
	        .replace(/\s+/g, ' ')
	        .trim();
	    };
	    const normalizeAreaUnit = (u) => {
	      const v = String(u ?? '').trim().toLowerCase();
	      if (!v) return '';
	      if (['sq ft', 'sqft', 'sq.ft', 'sq.ft.', 'square feet', 'square foot'].includes(v)) return 'sqft';
	      if (['sq m', 'sqm', 'sq.m', 'sq.m.', 'sq mtr', 'sq mtr.', 'sq meter', 'square meter'].includes(v)) return 'sqm';
	      return v;
	    };

		    const items = (Array.isArray(itemRows) ? itemRows : []).map((r) => {
		      const itemNameOnly = stripBracketText(String(r.itemName ?? '').trim()) || '-';
		      const specs = formatSpecParts(r.specificationsJson);
		      const unitName = String(r.unitName ?? '').trim();
		      const qty = Number(r.quantity ?? 0);
		      const rate = Number(r.rate ?? 0);
		      const discPct = Number(r.discountPercent ?? 0);
		      const taxAmt = Number(r.taxAmount ?? 0);
		      const discAmt = (qty * rate * discPct) / 100;
		      return {
		        label: itemNameOnly,
		        specs,
		        unitName,
		        quantity: qty,
		        rate: rate,
		        discountPercent: discPct,
		        discountAmount: discAmt,
		        taxPercent: Number(r.taxPercent ?? 0),
		        goodsAmount: Number(r.goodsAmount ?? 0),
		        taxAmount: taxAmt,
		        totalAmount: Number(r.totalAmount ?? 0),
		        dimLength: r.dimLength != null ? Number(r.dimLength) : 0,
		        dimBreadth: r.dimBreadth != null ? Number(r.dimBreadth) : 0,
		        dimPcs: r.dimPcs != null ? Number(r.dimPcs) : 0,
	        dimUnit: String(r.dimUnit ?? '').trim(),
	        areaUnit: normalizeAreaUnit(unitName),
	        remarks: String(r.remarks ?? '').trim(),
	      };
	    });
		    const showDimColumns = items.some((it) => it.areaUnit === 'sqft' || it.areaUnit === 'sqm');
		    const showDiscColumn = items.some((it) => Number(it.discountPercent ?? 0) > 0);
		    const showGstColumn = items.some((it) => Number(it.taxPercent ?? 0) > 0);
		    const showDiscAmountColumn = items.some((it) => Number(it.discountAmount ?? 0) > 0);
		    const showGstAmountColumn = items.some((it) => Number(it.taxAmount ?? 0) > 0);

    const doc = await PDFDocument.create();
    let page = doc.addPage([595.28, 841.89]); // A4
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const margin = 36;
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    let y = 841.89 - margin;

    const toPdfText = (value) => String(value ?? '')
      .replace(/\u20b9/g, 'Rs.')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2022\u00b7]/g, '-')
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
      .replace(/[ \t]+/g, ' ');

    const safePdfFileName = (value) => {
      const name = toPdfText(value).replace(/[\\/:*?"<>|]+/g, '_').trim();
      return name || 'purchase-order';
    };

    const wrapLines = (text, f, size, maxWidth) => {
      const raw = toPdfText(text).replace(/\r?\n/g, ' ').trim();
      if (!raw) return [''];
      const words = raw.split(/\s+/).filter(Boolean);
      const lines = [];
      let current = '';
      for (const w of words) {
        const candidate = current ? `${current} ${w}` : w;
        const width = f.widthOfTextAtSize(candidate, size);
        if (width <= maxWidth || !current) {
          current = candidate;
          continue;
        }
        lines.push(current);
        current = w;
      }
      if (current) lines.push(current);
      return lines.length ? lines : [''];
    };

	    const drawText = (text, opts = {}) => {
      const size = opts.size ?? 10;
      const f = opts.bold ? fontBold : font;
      const x = opts.x ?? margin;
        const maxWidth = Math.max(10, opts.maxWidth ?? (pageWidth - margin * 2));
      const lineHeight = opts.lineHeight ?? size + 4;
      const color = opts.color ?? rgb(0, 0, 0);

      const lines = opts.wrap === false ? [toPdfText(text)] : wrapLines(text, f, size, maxWidth);
      for (const line of lines) {
        page.drawText(String(line ?? ''), { x, y, size, font: f, color });
        y -= lineHeight;
      }
	    };
    const drawTextPreserveNewlines = (text, opts = {}) => {
      const parts = String(text ?? '').split(/\r?\n/);
      for (const part of parts) {
        const line = toPdfText(part);
        if (line.trim()) {
          drawText(line, opts);
        } else {
          y -= (opts.lineHeight ?? (opts.size ?? 10) + 4);
        }
      }
    };

    const formatMoney = (value) => Number(value || 0).toFixed(3);
	    const formatNumber = (value) => {
	      const n = Number(value ?? 0);
	      return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
	    };
    const formatDate = (value) => {
      const iso = toIsoDate(value);
      if (!iso) return '-';
      const [year, month, day] = iso.split('-');
      return `${day}/${month}/${year}`;
    };
    const resolveUploadPath = (url) => {
      const value = String(url ?? '').trim();
      if (!value || !value.startsWith('/uploads/')) return null;
      const file = decodeURIComponent(value.replace(/^\/uploads\//, '')).replace(/[\\/]/g, '');
      return path.join(uploadsDir, file);
    };
	    const loadLogoImage = async (logoUrl) => {
      const value = String(logoUrl ?? '').trim();
      if (!value) return null;
      try {
        let bytes = null;
        if (value.startsWith('data:image/')) {
          const base64 = value.split(',')[1] ?? '';
          bytes = Buffer.from(base64, 'base64');
        } else if (/^https?:\/\//i.test(value)) {
          const response = await fetch(value);
          if (!response.ok) return null;
          bytes = Buffer.from(await response.arrayBuffer());
        } else {
          const localPath = resolveUploadPath(value) || path.resolve(__dirname, value.replace(/^[\\/]+/, ''));
          try {
            bytes = await fs.readFile(localPath);
          } catch {
            if (value.startsWith('/')) {
              const baseUrl = `${req.protocol}://${req.get('host')}`;
              const response = await fetch(`${baseUrl}${value}`);
              if (!response.ok) return null;
              bytes = Buffer.from(await response.arrayBuffer());
            } else {
              return null;
            }
          }
        }
        if (!bytes?.length) return null;
        try {
          return await doc.embedPng(bytes);
        } catch {
          return await doc.embedJpg(bytes);
        }
      } catch {
        return null;
      }
    };
    const drawBox = (x, boxY, width, height) => {
      page.drawRectangle({ x, y: boxY, width, height, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
    };
    const drawLine = (x1, y1, x2, y2, thickness = 0.8) => {
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: rgb(0, 0, 0) });
    };
    const drawAt = (text, x, textY, opts = {}) => {
      page.drawText(toPdfText(text), {
        x,
        y: textY,
        size: opts.size ?? 8,
        font: opts.bold ? fontBold : font,
        color: rgb(0, 0, 0),
      });
    };
    const drawRight = (text, rightX, textY, opts = {}) => {
      const size = opts.size ?? 8;
      const f = opts.bold ? fontBold : font;
      const value = toPdfText(text);
      page.drawText(value, {
        x: rightX - f.widthOfTextAtSize(value, size),
        y: textY,
        size,
        font: f,
        color: rgb(0, 0, 0),
      });
    };
    const addPageIfNeeded = (requiredHeight = 80) => {
      if (y >= margin + requiredHeight) return;
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    };

	    const logoImage = await loadLogoImage(poRow.firmLogoUrl);
	    const poNumber = String(poRow.poNumber ?? poRow.id ?? '').trim();
	    const centerXFor = (text, size, bold = false) => {
	      const f = bold ? fontBold : font;
	      const t = toPdfText(text);
	      return Math.max(margin, (pageWidth - f.widthOfTextAtSize(t, size)) / 2);
	    };
	    drawText('PURCHASE ORDER', { bold: true, size: 16, x: centerXFor('PURCHASE ORDER', 16, true), wrap: false });
	    drawText(`${poNumber || '-'}`, { bold: true, size: 11, x: margin, wrap: false });
	    drawText(`Date: ${formatDate(poRow.orderDate)}`, { size: 9, x: margin, wrap: false });
    if (logoImage) {
      const maxLogoWidth = 110;
      const maxLogoHeight = 45;
      const scale = Math.min(maxLogoWidth / logoImage.width, maxLogoHeight / logoImage.height, 1);
      const width = logoImage.width * scale;
      const height = logoImage.height * scale;
      page.drawImage(logoImage, { x: pageWidth - margin - width, y: pageHeight - margin - height, width, height });
    }
    y -= 4;

		    const topY = y;
		    const halfWidth = (pageWidth - margin * 2 - 10) / 2;
		    const partyBoxHeight = 90;
		    const partyBoxBottom = topY - partyBoxHeight + 4;
		    drawBox(margin, partyBoxBottom, halfWidth, partyBoxHeight);
		    drawBox(margin + halfWidth + 10, partyBoxBottom, halfWidth, partyBoxHeight);
	    drawAt('Supplier', margin + 8, topY - 12, { bold: true, size: 9 });
	    drawAt(String(poRow.supplierName ?? '').trim() || '-', margin + 8, topY - 26, { bold: true, size: 9 });
	    drawAt(`GST: ${String(poRow.supplierGstNumber ?? '').trim() || '-'}`, margin + 8, topY - 40, { size: 8 });
	    {
	      const addr = String(poRow.supplierAddress ?? '').trim() || '-';
	      const addrLines = wrapLines(addr, font, 8, halfWidth - 16);
	      let ay = topY - 54;
	      const shown = addrLines.slice(0, 2);
	      for (const line of shown) {
	        drawAt(line, margin + 8, ay, { size: 8 });
	        ay -= 10;
	      }
		      const payY = Math.max(partyBoxBottom + 10, topY - 68 - Math.max(0, (shown.length - 1) * 10));
		      drawAt(`Payment Terms: ${String(poRow.paymentTerms ?? '').trim() || '-'}`, margin + 8, payY, { bold: true, size: 8 });
		    }

	    const firmX = margin + halfWidth + 10;
		    drawAt('Buyer', firmX + 8, topY - 12, { bold: true, size: 9 });
		    drawAt(String(poRow.firmName ?? '').trim() || '-', firmX + 8, topY - 26, { bold: true, size: 9 });
		    drawAt(`GST: ${String(poRow.firmGstNumber ?? '').trim() || '-'}`, firmX + 8, topY - 40, { size: 8 });
		    {
		      const addr = String(poRow.firmAddress ?? '').trim() || '-';
		      const addrLines = wrapLines(addr, font, 8, halfWidth - 16);
		      let ay = topY - 54;
		      const shown = (addrLines.length ? addrLines : ['-']).slice(0, 2);
		      for (const line of shown) {
		        drawAt(line, firmX + 8, ay, { size: 8 });
		        ay -= 10;
		      }
		      // Keep a little padding from the bottom border of the box.
			      const storeY = Math.max(partyBoxBottom + 10, topY - 68 - Math.max(0, (shown.length - 1) * 10) + 4);
			      drawAt(`Store: ${String(poRow.storeName ?? '').trim() || '-'}`, firmX + 8, storeY, { size: 8 });
			    }
		    // Add a bit more breathing room below the header boxes before the table starts.
		    y = partyBoxBottom - 20;

    const ship = String(poRow.shippingAddress ?? '').trim();
    if (ship) {
      drawText('Shipping Address:', { bold: true, size: 9 });
      drawText(ship, { size: 8, maxWidth: pageWidth - margin * 2 });
      y -= 4;
    }

	    const isInterState = String(poRow.supplierGstType ?? '').trim().toLowerCase() === 'inter-state';
	    const tableLeft = margin;
	    const tableRight = pageWidth - margin;
	    const tableWidth = tableRight - tableLeft;
		    // Columns tuned for A4 width so headers don't overflow.
		    // Sl No | Item | (L | B | Pcs | Dim Unit) | Qty | Unit | Rate | Taxable Amt | Disc % | Disc Amt | GST % | GST Amt | Total Amt
			    const colBounds = (() => {
			      const serialW = 22;
			      const dimW = 22;
			      const pcsW = 24;
			      const dimUnitW = 28;
			      const qtyW = 34;
			      const qtyUnitW = 32;
			      const rateW = 38;
			      const amtBeforeW = 56;
			      const discW = 34;
			      const discAmtW = 44;
			      const gstW = 34;
			      const gstAmtW = 52;
			      const totalAmtW = 58;
			      const remarksW = 60;
			      const showAmtBeforeColumn = Boolean(showGstAmountColumn);

			      const fixedExceptItem =
			        serialW +
			        (showDimColumns ? dimW + dimW + pcsW + dimUnitW : 0) +
			        qtyW +
			        qtyUnitW +
			        rateW +
			        (showAmtBeforeColumn ? amtBeforeW : 0) +
			        (showDiscColumn ? discW : 0) +
			        (showDiscAmountColumn ? discAmtW : 0) +
			        (showGstColumn ? gstW : 0) +
			        (showGstAmountColumn ? gstAmtW : 0) +
			        totalAmtW +
			        remarksW;

			      // Item column takes the remaining space. When many numeric columns are visible,
			      // allow item width to shrink so right-side amounts don't overlap.
			      const itemW = Math.max(70, tableWidth - fixedExceptItem);

			      const widths = [
			        serialW,
			        itemW,
			        ...(showDimColumns ? [dimW, dimW, pcsW, dimUnitW] : []),
			        qtyW,
			        qtyUnitW,
			        rateW,
			        ...(showAmtBeforeColumn ? [amtBeforeW] : []),
			        ...(showDiscColumn ? [discW] : []),
			        ...(showDiscAmountColumn ? [discAmtW] : []),
			        ...(showGstColumn ? [gstW] : []),
			        ...(showGstAmountColumn ? [gstAmtW] : []),
			        totalAmtW,
			        remarksW,
			      ];

			      const b = [tableLeft];
			      for (const w of widths) b.push(b[b.length - 1] + w);

			      // Force the last bound to exactly tableRight to avoid drift.
			      b[b.length - 1] = tableRight;
			      return b;
			    })();

		    const col = {
	      serialLeft: colBounds[0],
	      serialRight: colBounds[1],
	      itemLeft: colBounds[1],
	      itemRight: colBounds[2],
	      lengthRight: null,
	      breadthRight: null,
	      pcsRight: null,
	      dimUnitRight: null,
		      qtyRight: null,
		      qtyUnitRight: null,
		      rateRight: null,
		      amtBeforeRight: null,
		      discRight: null,
		      discAmtRight: null,
		      gstRight: null,
		      gstAmtRight: null,
		      totalAmtRight: null,
		      remarksRight: null,
		    };
		    // Compute rights based on which optional columns are present.
		    {
		      let i = 2; // itemRight index
	      if (showDimColumns) {
	        col.lengthRight = colBounds[++i];
	        col.breadthRight = colBounds[++i];
	        col.pcsRight = colBounds[++i];
	        col.dimUnitRight = colBounds[++i];
	      }
		      col.qtyRight = colBounds[++i];
		      col.qtyUnitRight = colBounds[++i];
		      col.rateRight = colBounds[++i];
		      if (showGstAmountColumn) col.amtBeforeRight = colBounds[++i];
		      if (showDiscColumn) col.discRight = colBounds[++i];
		      if (showDiscAmountColumn) col.discAmtRight = colBounds[++i];
		      if (showGstColumn) col.gstRight = colBounds[++i];
		      if (showGstAmountColumn) col.gstAmtRight = colBounds[++i];
		      col.totalAmtRight = colBounds[++i];
		      col.remarksRight = colBounds[++i];
		    }

	    const loadAnyImage = async (imageUrl) => {
	      const value = String(imageUrl ?? '').trim();
	      if (!value) return null;
	      return loadLogoImage(value);
	    };
    const headerY = y;
    // Slightly taller header so 2-line column labels don't clip.
    const headerHeight = 26;
    const headerBottom = headerY - (headerHeight - 4);
    page.drawRectangle({
      x: tableLeft,
      y: headerBottom,
      width: tableWidth,
      height: headerHeight,
      color: rgb(0.88, 0.9, 0.93),
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    for (const x of colBounds) drawLine(x, headerBottom, x, headerBottom + headerHeight, 1);
    drawLine(tableLeft, headerBottom + headerHeight, tableRight, headerBottom + headerHeight, 1);
    drawLine(tableLeft, headerBottom, tableRight, headerBottom, 1);
	    const drawHeaderCell = (lines, left, right, opts = {}) => {
	      const values = Array.isArray(lines) ? lines : [lines];
	      const size = opts.size ?? 7;
	      const f = fontBold;
	      const usableW = Math.max(8, right - left - 6);
	      const lineH = opts.lineHeight ?? 8;
	      const blockH = values.length * lineH;
	      let textY = headerBottom + (headerHeight + blockH) / 2 - lineH + 1;
	      for (const raw of values) {
	        const value = toPdfText(raw);
	        const textW = f.widthOfTextAtSize(value, size);
	        const x =
	          opts.align === 'left'
	            ? left + 4
	            : opts.align === 'right'
	              ? right - 4 - Math.min(textW, usableW)
	              : left + (right - left - Math.min(textW, usableW)) / 2;
	        page.drawText(value, { x, y: textY, size, font: f, color: rgb(0, 0, 0) });
	        textY -= lineH;
	      }
	    };
	    // Keep header labels inside their cells (pdf-lib doesn't clip text).
	    drawHeaderCell(['Sl', 'No'], col.serialLeft, col.serialRight, { size: 7 });
	    drawHeaderCell('Item', col.itemLeft, col.itemRight, { align: 'left', size: 8 });
	    if (showDimColumns) {
	      drawHeaderCell('L', col.itemRight, col.lengthRight, { size: 8 });
	      drawHeaderCell('B', col.lengthRight, col.breadthRight, { size: 8 });
	      drawHeaderCell('Pcs', col.breadthRight, col.pcsRight, { size: 7 });
	      drawHeaderCell(['Dim', 'Unit'], col.pcsRight, col.dimUnitRight, { size: 7 });
	    }
		    drawHeaderCell('Qty', showDimColumns ? col.dimUnitRight : col.itemRight, col.qtyRight, { align: 'right', size: 8 });
		    drawHeaderCell('Unit', col.qtyRight, col.qtyUnitRight, { align: 'left', size: 8 });
		    drawHeaderCell('Rate', col.qtyUnitRight, col.rateRight, { align: 'right', size: 8 });
		    if (showGstAmountColumn) {
		      drawHeaderCell(['Taxable', 'Amt'], col.rateRight, col.amtBeforeRight, { align: 'right', size: 7 });
		    }
		    if (showDiscAmountColumn) {
		      drawHeaderCell(['Disc', 'Amt'], showDiscColumn ? col.discRight : showGstAmountColumn ? col.amtBeforeRight : col.rateRight, col.discAmtRight, { align: 'right', size: 7 });
		    }
		    if (showGstColumn) drawHeaderCell(['GST', '%'], showDiscAmountColumn ? col.discAmtRight : showDiscColumn ? col.discRight : showGstAmountColumn ? col.amtBeforeRight : col.rateRight, col.gstRight, { align: 'right', size: 7 });
		    if (showGstAmountColumn) {
		      drawHeaderCell(['GST', 'Amt'], showGstColumn ? col.gstRight : showDiscAmountColumn ? col.discAmtRight : showDiscColumn ? col.discRight : col.amtBeforeRight, col.gstAmtRight, { align: 'right', size: 7 });
		    }
		    drawHeaderCell(['Total', 'Amt'], showGstAmountColumn ? col.gstAmtRight : showGstColumn ? col.gstRight : showDiscAmountColumn ? col.discAmtRight : showDiscColumn ? col.discRight : col.rateRight, col.totalAmtRight, { align: 'right', size: 7 });
		    drawHeaderCell('Remarks', col.totalAmtRight, col.remarksRight, { align: 'left', size: 8 });
    y -= headerHeight;

    let grandGoods = 0;
    let grandTax = 0;
    let grandCgst = 0;
    let grandSgst = 0;
    let grandIgst = 0;
    let grandDisc = 0;
    let grandTotal = 0;
	    for (const [itemIndex, it] of items.entries()) {
	      addPageIfNeeded(80);
	      const rowTop = y;
	      const itemText = String(it.label ?? '').trim() || '-';
	      const labelLines = wrapLines(itemText, font, 8, col.itemRight - col.itemLeft - 8);
	      const specText = (Array.isArray(it.specs) ? it.specs : [])
	        .map((s) => String(s ?? '').trim())
	        .filter(Boolean)
	        .join(', ');
	      const specLines = specText ? wrapLines(`- ${specText}`, font, 7, col.itemRight - col.itemLeft - 8) : [];
	      const remarkLines = it.remarks ? wrapLines(it.remarks, font, 7, col.remarksRight - col.totalAmtRight - 8) : [];
	      const rowHeight = Math.max(18, labelLines.length * 11 + (specLines.length ? specLines.length * 10 + 2 : 0) + 8, remarkLines.length * 10 + 8);
      const taxAmount = Number(it.taxAmount ?? 0);
      const cgstAmount = isInterState ? 0 : taxAmount / 2;
      const sgstAmount = isInterState ? 0 : taxAmount / 2;
      const igstAmount = isInterState ? taxAmount : 0;
      const rowBottom = rowTop - rowHeight + 6;
      drawBox(tableLeft, rowBottom, tableRight - tableLeft, rowHeight);
      for (const x of colBounds) drawLine(x, rowBottom, x, rowBottom + rowHeight, 1);
      drawRight(String(itemIndex + 1), col.serialRight - 4, rowTop - 6, { size: 8 });
		      let labelY = rowTop - 6;
		      for (const line of labelLines) {
		        drawAt(line, col.itemLeft + 4, labelY, { size: 8, bold: labelY === rowTop - 6 });
		        labelY -= 11;
		      }
		      if (specLines.length) {
		        labelY -= 1;
		        for (const line of specLines) {
		          drawAt(line, col.itemLeft + 4, labelY, { size: 7, bold: false });
		          labelY -= 10;
		        }
		      }
	      if (showDimColumns) {
	        drawRight(it.dimLength > 0 ? formatNumber(it.dimLength) : '-', col.lengthRight - 4, rowTop - 6, { size: 8 });
	        drawRight(it.dimBreadth > 0 ? formatNumber(it.dimBreadth) : '-', col.breadthRight - 4, rowTop - 6, { size: 8 });
	        drawRight(it.dimPcs > 0 ? formatNumber(it.dimPcs) : '-', col.pcsRight - 4, rowTop - 6, { size: 8 });
		        drawRight(String(it.dimUnit ?? '').trim() || '-', col.dimUnitRight - 4, rowTop - 6, { size: 8 });
		      }
		      drawRight(formatNumber(it.quantity), col.qtyRight - 4, rowTop - 6, { size: 8 });
		      drawAt(String(it.unitName ?? '').trim() || '-', col.qtyRight + 4, rowTop - 6, { size: 8 });
		      drawRight(formatMoney(it.rate), col.rateRight - 4, rowTop - 6, { size: 8 });
	      if (showGstAmountColumn) {
	        drawRight(formatMoney(it.goodsAmount), col.amtBeforeRight - 4, rowTop - 6, { size: 8 });
	      }
	      if (showDiscColumn) {
	        drawRight(Number(it.discountPercent ?? 0) > 0 ? formatNumber(it.discountPercent) : '', col.discRight - 4, rowTop - 6, { size: 8 });
	      }
	      if (showDiscAmountColumn) {
	        drawRight(Number(it.discountAmount ?? 0) > 0 ? formatMoney(it.discountAmount) : '', col.discAmtRight - 4, rowTop - 6, { size: 8 });
	      }
	      if (showGstColumn) {
	        drawRight(Number(it.taxPercent ?? 0) > 0 ? formatNumber(it.taxPercent) : '', col.gstRight - 4, rowTop - 6, { size: 8 });
	      }
	      if (showGstAmountColumn) {
	        drawRight(Number(it.taxAmount ?? 0) > 0 ? formatMoney(it.taxAmount) : '', col.gstAmtRight - 4, rowTop - 6, { size: 8 });
	      }
	      drawRight(formatMoney(it.totalAmount), col.totalAmtRight - 8, rowTop - 6, { size: 8 });
	      if (remarkLines.length) {
	        let ry = rowTop - 6;
	        for (const line of remarkLines) {
	          drawAt(line, col.totalAmtRight + 4, ry, { size: 7 });
	          ry -= 10;
	        }
	      }
      y -= rowHeight;
      grandGoods += Number(it.goodsAmount ?? 0);
      grandTax += taxAmount;
      grandCgst += cgstAmount;
      grandSgst += sgstAmount;
      grandIgst += igstAmount;
      grandDisc += (Number(it.quantity ?? 0) * Number(it.rate ?? 0) * Number(it.discountPercent ?? 0)) / 100;
      grandTotal += Number(it.totalAmount ?? 0);
    }

    addPageIfNeeded(160);

    addPageIfNeeded(190);
    y -= 18;
    const summaryWidth = 200;
    const summaryLeft = tableRight - summaryWidth;
	    const rowH = 26;
	    // Summary should not show GST/Discount percentages (items may have different rates).
	    // Show GST split based on supplier GST type (inter-state => IGST, else CGST+SGST).
	    const amtBeforeLabel = grandTax > 0 ? 'Amt Before GST' : 'Amount';
	    const summaryRows = [
	      [amtBeforeLabel, formatMoney(grandGoods)],
	      ...(grandTax > 0
	        ? isInterState
	          ? [['IGST', formatMoney(grandIgst)]]
	          : [
	              ['CGST', formatMoney(grandCgst)],
	              ['SGST', formatMoney(grandSgst)],
	            ]
	        : []),
	      ['Grand Total', formatMoney(grandTotal)],
	    ];
    const summaryTop = y;
    const summaryHeight = summaryRows.length * rowH;
    drawBox(summaryLeft, summaryTop - summaryHeight, summaryWidth, summaryHeight);
    for (let i = 1; i < summaryRows.length; i += 1) {
      drawLine(summaryLeft, summaryTop - i * rowH, summaryLeft + summaryWidth, summaryTop - i * rowH, 0.5);
    }
    page.drawRectangle({
      x: summaryLeft,
      y: summaryTop - summaryHeight,
      width: summaryWidth,
      height: rowH,
      color: rgb(0.12, 0.18, 0.28),
    });
    for (let i = 0; i < summaryRows.length; i += 1) {
      const [label, amount] = summaryRows[i];
      const textY = summaryTop - (i + 1) * rowH + 9;
      const isGrand = i === summaryRows.length - 1;
      const color = isGrand ? rgb(1, 1, 1) : rgb(0.15, 0.2, 0.28);
      page.drawText(label, {
        x: summaryLeft + 10,
        y: textY,
        size: 8,
        font: isGrand ? fontBold : font,
        color,
      });
      const amt = String(amount ?? '');
      const amtFont = isGrand ? fontBold : fontBold;
      page.drawText(amt, {
        x: summaryLeft + summaryWidth - 10 - amtFont.widthOfTextAtSize(amt, 9),
        y: textY - 1,
        size: 9,
        font: amtFont,
        color: isGrand ? rgb(1, 1, 1) : rgb(0, 0, 0),
      });
    }
    y = summaryTop - summaryHeight - 12;

		    const terms = String(poRow.firmTermsConditions ?? poRow.termsConditions ?? '').trim();
		    if (terms) {
		      drawText('Terms & Conditions:', { bold: true, size: 9, x: margin, wrap: false });
		      drawTextPreserveNewlines(terms, { size: 8, x: margin, maxWidth: 320 });
		    }

	    // Signature block (always show a manual signature line; optionally show an image above it).
	    // Pass signature image as `?signatureUrl=...` (data:image/*, http(s), or /uploads/...).
	    addPageIfNeeded(120);
	    const signatureUrl = req.query?.signatureUrl != null ? String(req.query.signatureUrl).trim() : '';
	    const sigBlockW = 180;
	    const sigLineY = Math.max(margin + 60, y - 70);
	    const sigRight = tableRight;
	    const sigLeft = sigRight - sigBlockW;

	    if (signatureUrl) {
	      const sigImg = await loadAnyImage(signatureUrl);
	      if (sigImg) {
	        const maxSigW = sigBlockW;
	        const maxSigH = 55;
	        const scale = Math.min(maxSigW / sigImg.width, maxSigH / sigImg.height, 1);
	        const w = sigImg.width * scale;
	        const h = sigImg.height * scale;
	        page.drawImage(sigImg, { x: sigRight - w, y: sigLineY + 10, width: w, height: h });
	      }
	    }
	    // Manual signature line
	    drawLine(sigLeft, sigLineY, sigRight, sigLineY, 1);
	    page.drawText('Authorized Signatory', { x: sigLeft, y: sigLineY - 12, size: 8, font: fontBold, color: rgb(0, 0, 0) });
	    y = sigLineY - 24;

    const pdfBytes = await doc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Disposition', `attachment; filename=\"${safePdfFileName(poNumber || poId)}.pdf\"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    res.status(500).send(e instanceof Error ? e.message : String(e));
  }
});

app.post('/api/pos/:id/return-draft', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'id is required' });

    const remarks = String(req.body?.remarks ?? '').trim();
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || 'system';
    if (!remarks) return res.status(400).json({ error: 'Remarks are required to return PO to Draft.' });

    const [[poRow]] = await pool.query(
      `
      SELECT id, status
      FROM purchase_orders
      WHERE id = ?
      LIMIT 1
      `,
      [poId]
    );
    if (!poRow) return res.status(404).json({ error: 'PO not found' });

    const [[grnRow]] = await pool.query('SELECT id FROM grns WHERE po_id = ? LIMIT 1', [poId]);
    if (grnRow?.id) return res.status(400).json({ error: 'PO with GRN cannot be returned to Draft.' });
    const [[invoiceRow]] = await pool.query('SELECT id FROM invoices WHERE po_id = ? LIMIT 1', [poId]);
    if (invoiceRow?.id) return res.status(400).json({ error: 'PO with Invoice cannot be returned to Draft.' });

    const current = await fetchPoHeaderAndItems(pool, poId);
    if (!current) return res.status(404).json({ error: 'PO not found' });
    const payload = buildPoDraftPayload({
      sourceType: current.po?.sourceType,
      prId: current.po?.prId,
      firmId: current.po?.firmId,
      storeId: current.po?.storeId,
      projectId: current.po?.projectId,
      supplierId: current.po?.supplierId,
      supplier: current.po?.supplier,
      poType: current.po?.poType,
      requestedBy: current.po?.requestedBy,
      requiredDate: current.po?.requiredDate,
      remarks,
      paymentTerms: current.po?.paymentTerms,
      paymentType: current.po?.paymentType,
      paymentMode: current.po?.paymentMode,
      advanceAmount: current.po?.advanceAmount,
      advanceDate: current.po?.advanceDate,
      shippingAddress: current.po?.shippingAddress,
      termsConditions: current.po?.termsConditions,
      items: current.items,
    });

    await pool.query(
      `
      UPDATE purchase_orders
      SET status = 'draft',
          remarks = ?,
          draft_payload = ?,
          check_po = 0,
          check_po_user_id = NULL,
          check_date = NULL,
          sent_by = NULL,
          sent_date = NULL,
          sent_proof = NULL,
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [remarks, JSON.stringify({ ...payload, sourceType: current.po?.sourceType ?? payload.sourceType }), updatedBy, poId]
    );

    const detail = await fetchPoHeaderAndItems(pool, poId);
    res.json({ po: detail });
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
      const [[statusRow]] = await pool.query('SELECT status FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!statusRow) return res.status(404).json({ error: 'PO not found' });
      if (String(statusRow.status ?? '').trim().toLowerCase() === 'draft') {
        return res.status(400).json({ error: 'Draft PO cannot be used in Check/Send workflow.' });
      }

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
      ORDER BY COALESCE(poi.line_order, 999999) ASC, poi.created_at ASC, poi.id ASC
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
      cancelledQty: Number(r.cancelledQty ?? 0),
      cancelReason: r.cancelReason != null ? String(r.cancelReason) : null,
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
	        poi.id AS poItemId,
	        poi.item_id AS itemId,
        iname.name AS item,
        u.name AS unit,
        GREATEST(0, COALESCE(poi.quantity, 0) - COALESCE(linkq.linkQty, 0)) AS pendingQty,
        poi.rate AS rate,
        poi.dim_length AS dimLength,
        poi.dim_breadth AS dimBreadth,
        poi.dim_pcs AS dimPcs,
        poi.dim_unit AS dimUnit
      FROM purchase_order_items poi
      LEFT JOIN (
        SELECT inv.po_id AS poId, ii.item_id AS itemId, SUM(COALESCE(gil.linked_qty, 0)) AS linkQty
        FROM invoices inv
        INNER JOIN invoice_items ii ON ii.invoice_id = inv.id
        LEFT JOIN grn_invoice_item_links gil ON gil.invoice_item_id = ii.id
        GROUP BY inv.po_id, ii.item_id
      ) linkq ON linkq.poId = poi.po_id AND linkq.itemId = poi.item_id
      LEFT JOIN items it ON it.id = poi.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      LEFT JOIN units u ON u.id = iname.unit_id
      WHERE poi.po_id = ?
      HAVING pendingQty > 1e-9
      ORDER BY iname.name ASC
      `,
      [poId]
    );

    const items = (Array.isArray(rows) ? rows : []).map((r) => ({
      poItemId: String(r.poItemId ?? ''),
      itemId: String(r.itemId ?? ''),
      item: String(r.item ?? ''),
      unit: r.unit != null ? String(r.unit) : null,
      pendingQty: Number(r.pendingQty ?? 0),
      rate: Number(r.rate ?? 0),
      dimLength: r.dimLength,
      dimBreadth: r.dimBreadth,
      dimPcs: r.dimPcs,
      dimUnit: r.dimUnit,
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
        poi.id AS poItemId,
        poi.item_id AS itemId,
        iname.name AS item,
        u.name AS unit,
        GREATEST(0, COALESCE(poi.quantity, 0) - COALESCE(grnq.grnQty, 0)) AS pendingQty,
        poi.rate AS rate,
        poi.dim_length AS dimLength,
        poi.dim_breadth AS dimBreadth,
        poi.dim_pcs AS dimPcs,
        poi.dim_unit AS dimUnit
      FROM purchase_order_items poi
	      LEFT JOIN (
	        SELECT g.po_id AS poId, gi.po_item_id AS poItemId, gi.item_id AS itemId, SUM(gi.received_qty) AS grnQty
	        FROM grns g
	        INNER JOIN grn_items gi ON gi.grn_id = g.id
	        GROUP BY g.po_id, gi.po_item_id, gi.item_id
	      ) grnq ON grnq.poId = poi.po_id AND (
	        (grnq.poItemId IS NOT NULL AND grnq.poItemId = poi.id)
	        OR (grnq.poItemId IS NULL AND grnq.itemId = poi.item_id)
	      )
      LEFT JOIN items it ON it.id = poi.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      LEFT JOIN units u ON u.id = iname.unit_id
      WHERE poi.po_id = ?
      HAVING pendingQty > 1e-9
      ORDER BY iname.name ASC
      `,
      [poId]
    );

	    const items = (Array.isArray(rows) ? rows : []).map((r) => ({
	      poItemId: String(r.poItemId ?? ''),
	      itemId: String(r.itemId ?? ''),
      item: String(r.item ?? ''),
      unit: r.unit != null ? String(r.unit) : null,
      pendingQty: Number(r.pendingQty ?? 0),
      rate: Number(r.rate ?? 0),
      dimLength: r.dimLength,
      dimBreadth: r.dimBreadth,
      dimPcs: r.dimPcs,
      dimUnit: r.dimUnit,
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
          u.name AS unit,
          it.specifications_json AS specificationsJson,
          gi.received_qty AS quantityReceived
        FROM grn_items gi
        LEFT JOIN items it ON it.id = gi.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        LEFT JOIN units u ON u.id = iname.unit_id
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
          unit: String(r.unit ?? '').trim(),
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
	        credit_voucher_applicable AS creditVoucherApplicable,
	        address,
		        phone,
            bank,
            account_number AS accountNumber,
            ifsc_code AS ifscCode,
		      email,
	        contact_person AS contactPerson,
	        contact_person_mobile AS contactPersonMobile,
	        city,
	      state,
	      mobile_2 AS mobile2,
	      payment_terms AS paymentTerms,
	      default_credit_days AS defaultCreditDays,
	      is_vendor AS isVendor,
	      catalogue_link AS catalogueLink,
          msme_applicable AS msmeApplicable,
          msme_certificate_url AS msmeCertificateUrl
	      FROM suppliers
	      ORDER BY name
      `
    );
	    const suppliers = (rows || []).map((r) => ({
	      ...r,
	      gstType: normalizeGstType(r.gstType),
	      creditVoucherApplicable: Boolean(r.creditVoucherApplicable),
          msmeApplicable: Boolean(r.msmeApplicable),
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
	      creditVoucherApplicable: req.body?.creditVoucherApplicable ? 1 : 0,
	      address: req.body?.address != null ? String(req.body.address).trim() : null,
		      phone: req.body?.phone != null ? String(req.body.phone).trim() : null,
          bank: req.body?.bank != null ? String(req.body.bank).trim() : null,
          accountNumber: req.body?.accountNumber != null ? String(req.body.accountNumber).trim() : null,
          ifscCode: req.body?.ifscCode != null ? String(req.body.ifscCode).trim().toUpperCase() : null,
	        email: req.body?.email != null ? String(req.body.email).trim() : null,
	      contactPerson: req.body?.contactPerson != null ? String(req.body.contactPerson).trim() : null,
      contactPersonMobile: req.body?.contactPersonMobile != null ? String(req.body.contactPersonMobile).trim() : null,
      city: req.body?.city != null ? String(req.body.city).trim() : null,
      state: req.body?.state != null ? String(req.body.state).trim() : null,
      mobile2: req.body?.mobile2 != null ? String(req.body.mobile2).trim() : null,
      paymentTerms: req.body?.paymentTerms != null ? String(req.body.paymentTerms).trim() : null,
      defaultCreditDays: req.body?.defaultCreditDays != null ? Number(req.body.defaultCreditDays) : null,
      isVendor: req.body?.isVendor ? 1 : 0,
      catalogueLink: req.body?.catalogueLink != null ? String(req.body.catalogueLink).trim() : null,
      msmeApplicable: req.body?.msmeApplicable ? 1 : 0,
      msmeCertificateUrl: req.body?.msmeCertificateUrl != null ? String(req.body.msmeCertificateUrl).trim() : null,
      createdBy: req.body?.createdBy != null ? String(req.body.createdBy).trim() : null,
    };

	    await pool.query(
	      `
	      INSERT INTO suppliers (id, name, gst_number, gst_type, credit_voucher_applicable, address, phone, bank, account_number, ifsc_code, email, contact_person, contact_person_mobile, city, state, mobile_2, payment_terms, default_credit_days, is_vendor, catalogue_link, msme_applicable, msme_certificate_url, created_by, created_at, updated_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
	      `,
	      [
	        supplier.id,
	        supplier.name,
	        supplier.gstNumber,
	        supplier.gstType,
	        supplier.creditVoucherApplicable,
	        supplier.address,
		        supplier.phone,
            supplier.bank,
            supplier.accountNumber,
            supplier.ifscCode,
	          supplier.email,
	        supplier.contactPerson,
        supplier.contactPersonMobile,
        supplier.city,
        supplier.state,
        supplier.mobile2,
        supplier.paymentTerms,
        supplier.defaultCreditDays,
        supplier.isVendor,
        supplier.catalogueLink,
        supplier.msmeApplicable,
        supplier.msmeCertificateUrl,
        supplier.createdBy,
      ]
    );

    res.status(201).json({
      supplier: {
        id: supplier.id,
        name: supplier.name,
	        gstNumber: supplier.gstNumber ?? undefined,
	        gstType: supplier.gstType ?? undefined,
	        creditVoucherApplicable: Boolean(supplier.creditVoucherApplicable),
	        address: supplier.address ?? undefined,
		        phone: supplier.phone ?? undefined,
            bank: supplier.bank ?? undefined,
            accountNumber: supplier.accountNumber ?? undefined,
            ifscCode: supplier.ifscCode ?? undefined,
		        email: supplier.email ?? undefined,
	        contactPerson: supplier.contactPerson ?? undefined,
	        contactPersonMobile: supplier.contactPersonMobile ?? undefined,
	        city: supplier.city ?? undefined,
	        state: supplier.state ?? undefined,
	        mobile2: supplier.mobile2 ?? undefined,
	        paymentTerms: supplier.paymentTerms ?? undefined,
	        defaultCreditDays: supplier.defaultCreditDays ?? undefined,
	        isVendor: Boolean(supplier.isVendor),
	        catalogueLink: supplier.catalogueLink ?? undefined,
          msmeApplicable: Boolean(supplier.msmeApplicable),
          msmeCertificateUrl: supplier.msmeCertificateUrl ?? undefined,
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
	    const creditVoucherApplicable = req.body?.creditVoucherApplicable ? 1 : 0;
	    const address = req.body?.address != null ? String(req.body.address).trim() : null;
	    const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
      const bank = req.body?.bank != null ? String(req.body.bank).trim() : null;
      const accountNumber = req.body?.accountNumber != null ? String(req.body.accountNumber).trim() : null;
      const ifscCode = req.body?.ifscCode != null ? String(req.body.ifscCode).trim().toUpperCase() : null;
	    const email = req.body?.email != null ? String(req.body.email).trim() : null;
    const contactPerson = req.body?.contactPerson != null ? String(req.body.contactPerson).trim() : null;
    const contactPersonMobile = req.body?.contactPersonMobile != null ? String(req.body.contactPersonMobile).trim() : null;
    const city = req.body?.city != null ? String(req.body.city).trim() : null;
    const state = req.body?.state != null ? String(req.body.state).trim() : null;
    const mobile2 = req.body?.mobile2 != null ? String(req.body.mobile2).trim() : null;
    const paymentTerms = req.body?.paymentTerms != null ? String(req.body.paymentTerms).trim() : null;
    const defaultCreditDays = req.body?.defaultCreditDays != null ? Number(req.body.defaultCreditDays) : null;
    const catalogueLink = req.body?.catalogueLink != null ? String(req.body.catalogueLink).trim() : null;
    const msmeApplicable = req.body?.msmeApplicable ? 1 : 0;
    const msmeCertificateUrl = req.body?.msmeCertificateUrl != null ? String(req.body.msmeCertificateUrl).trim() : null;
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;

	    await pool.query(
	      `
	      UPDATE suppliers
	      SET name=?, gst_number=?, gst_type=?, credit_voucher_applicable=?, address=?, phone=?, bank=?, account_number=?, ifsc_code=?, email=?, contact_person=?, contact_person_mobile=?, city=?, state=?, mobile_2=?, payment_terms=?, default_credit_days=?, is_vendor=?, catalogue_link=?, msme_applicable=?, msme_certificate_url=?, updated_by=?, updated_at=NOW()
	      WHERE id=?
	      `,
	      [
	        name,
	        gstNumber,
	        gstType,
	        creditVoucherApplicable,
	        address,
		        phone,
            bank,
            accountNumber,
            ifscCode,
	          email,
	        contactPerson,
	        contactPersonMobile,
	        city,
	        state,
	        mobile2,
	        paymentTerms,
          defaultCreditDays,
	        req.body?.isVendor ? 1 : 0,
	        catalogueLink,
          msmeApplicable,
          msmeCertificateUrl,
	        updatedBy,
	        id,
	      ]
	    );

	    const [rows] = await pool.query(
	      `
	      SELECT id, name, gst_number AS gstNumber, gst_type AS gstType, credit_voucher_applicable AS creditVoucherApplicable, address, phone, bank, account_number AS accountNumber, ifsc_code AS ifscCode, email, contact_person AS contactPerson, contact_person_mobile AS contactPersonMobile, city, state, mobile_2 AS mobile2, payment_terms AS paymentTerms, default_credit_days AS defaultCreditDays, is_vendor AS isVendor, catalogue_link AS catalogueLink, msme_applicable AS msmeApplicable, msme_certificate_url AS msmeCertificateUrl
	      FROM suppliers WHERE id=?
	      `,
	      [id]
	    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'Supplier not found' });
	    res.json({
	      supplier: {
	        ...row,
	        gstType: normalizeGstType(row.gstType),
	        isVendor: Boolean(row.isVendor),
	        creditVoucherApplicable: Boolean(row.creditVoucherApplicable),
          msmeApplicable: Boolean(row.msmeApplicable),
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

app.delete('/api/masters/suppliers/:id', async (req, res) => {
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM suppliers WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'supplier')) return;
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: States ---
app.get('/api/masters/states', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await ensureGeoMastersTables(pool);
    const [rows] = await pool.query('SELECT id, name FROM states ORDER BY name');
    const states = (Array.isArray(rows) ? rows : []).map((r) => ({ id: String(r.id ?? ''), name: String(r.name ?? '') }));
    res.json({ states });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/states', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await ensureGeoMastersTables(pool);
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO states (id, name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [id, name]);
    res.status(201).json({ state: { id, name } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'State already exists' });
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/states/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await ensureGeoMastersTables(pool);
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    await pool.query('UPDATE states SET name=?, updated_at=NOW() WHERE id=?', [name, id]);
    res.json({ state: { id, name } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'State already exists' });
    res.status(500).json({ error: message });
  }
});

app.delete('/api/masters/states/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await ensureGeoMastersTables(pool);
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM states WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Cities ---
app.get('/api/masters/cities', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await ensureGeoMastersTables(pool);
    const state = String(req.query?.state ?? '').trim();
    const [rows] = await pool.query(
      state ? 'SELECT id, state_name AS state, name FROM cities WHERE state_name=? ORDER BY name' : 'SELECT id, state_name AS state, name FROM cities ORDER BY state_name, name',
      state ? [state] : []
    );
    const cities = (Array.isArray(rows) ? rows : []).map((r) => ({
      id: String(r.id ?? ''),
      state: String(r.state ?? ''),
      name: String(r.name ?? ''),
    }));
    res.json({ cities });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/cities', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await ensureGeoMastersTables(pool);
    const state = String(req.body?.state ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!state) return res.status(400).json({ error: 'state is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO cities (id, state_name, name, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [id, state, name]);
    res.status(201).json({ city: { id, state, name } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'City already exists for this state' });
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/cities/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await ensureGeoMastersTables(pool);
    const id = String(req.params.id ?? '').trim();
    const state = String(req.body?.state ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!state) return res.status(400).json({ error: 'state is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    await pool.query('UPDATE cities SET state_name=?, name=?, updated_at=NOW() WHERE id=?', [state, name, id]);
    res.json({ city: { id, state, name } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'City already exists for this state' });
    res.status(500).json({ error: message });
  }
});

app.delete('/api/masters/cities/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await ensureGeoMastersTables(pool);
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM cities WHERE id=?', [id]);
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
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM projects WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'project')) return;
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
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM departments WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'department')) return;
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
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM stores WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'store')) return;
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Customers ---
app.get('/api/masters/customers', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      'SELECT id, name, phone, address, category_name AS categoryName, sub_category_name AS subCategoryName, city, state, contact_person AS contactPerson, contact_number AS contactNumber, email_id AS emailId FROM customers ORDER BY name'
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
    const categoryName = req.body?.categoryName != null ? String(req.body.categoryName).trim() : null;
    const subCategoryName = req.body?.subCategoryName != null ? String(req.body.subCategoryName).trim() : null;
    const city = req.body?.city != null ? String(req.body.city).trim() : null;
    const state = req.body?.state != null ? String(req.body.state).trim() : null;
    const contactPerson = req.body?.contactPerson != null ? String(req.body.contactPerson).trim() : null;
    const contactNumber = req.body?.contactNumber != null ? String(req.body.contactNumber).trim() : null;
    const emailId = req.body?.emailId != null ? String(req.body.emailId).trim() : null;
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query(
      'INSERT INTO customers (id, name, phone, address, category_name, sub_category_name, city, state, contact_person, contact_number, email_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [id, name, phone, address, categoryName, subCategoryName, city, state, contactPerson, contactNumber, emailId, createdBy]
    );
    res.status(201).json({ customer: { id, name, phone, address, categoryName, subCategoryName, city, state, contactPerson, contactNumber, emailId } });
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
    const categoryName = req.body?.categoryName != null ? String(req.body.categoryName).trim() : null;
    const subCategoryName = req.body?.subCategoryName != null ? String(req.body.subCategoryName).trim() : null;
    const city = req.body?.city != null ? String(req.body.city).trim() : null;
    const state = req.body?.state != null ? String(req.body.state).trim() : null;
    const contactPerson = req.body?.contactPerson != null ? String(req.body.contactPerson).trim() : null;
    const contactNumber = req.body?.contactNumber != null ? String(req.body.contactNumber).trim() : null;
    const emailId = req.body?.emailId != null ? String(req.body.emailId).trim() : null;
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query(
      'UPDATE customers SET name=?, phone=?, address=?, category_name=?, sub_category_name=?, city=?, state=?, contact_person=?, contact_number=?, email_id=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [name, phone, address, categoryName, subCategoryName, city, state, contactPerson, contactNumber, emailId, updatedBy, id]
    );
    res.json({ customer: { id, name, phone, address, categoryName, subCategoryName, city, state, contactPerson, contactNumber, emailId } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/customers/:id', async (req, res) => {
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM customers WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'customer')) return;
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
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM transporters WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'transporter')) return;
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Users ---
app.get('/api/masters/users', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const includeInactive = String(req.query?.includeInactive ?? '').trim().toLowerCase() === '1';
    const includePasswordPlain = String(req.query?.includePasswordPlain ?? '').trim().toLowerCase() === '1';
    const [passwordPlainCols] = await pool.query('SHOW COLUMNS FROM users LIKE ?', ['password_plain']);
    if (!Array.isArray(passwordPlainCols) || passwordPlainCols.length === 0) {
      await pool.query('ALTER TABLE users ADD COLUMN password_plain TEXT NULL');
    }
    const [rows] = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        role,
        role AS designation,
        login_id AS loginId,
        menu_access AS menuAccess,
        is_active AS isActive,
        phone AS mobile,
        po_approval_amount AS poApprovalAmount,
        CASE WHEN password_hash IS NULL OR password_hash='' THEN 0 ELSE 1 END AS hasPassword
        ${includePasswordPlain ? ', password_plain AS passwordPlain' : ''}
      FROM users
      WHERE is_deleted=0
      ${includeInactive ? '' : 'AND is_active=1'}
      ORDER BY name
      `
    );
    // Ensure boolean
    const users = (rows || []).map((r) => {
      let menuAccess = [];
      try {
        const raw = r?.menuAccess;
        if (raw != null && String(raw).trim()) {
          const parsed = JSON.parse(String(raw));
          if (Array.isArray(parsed)) menuAccess = parsed.map((x) => String(x));
        }
      } catch {}
      return {
        ...r,
        role: r?.role != null ? String(r.role) : '',
        designation: r?.designation != null ? String(r.designation) : '',
        loginId: r?.loginId != null ? String(r.loginId) : '',
        menuAccess,
        isActive: Boolean(r?.isActive),
        hasPassword: Boolean(r?.hasPassword),
        passwordPlain: includePasswordPlain && r?.passwordPlain != null ? String(r.passwordPlain) : undefined,
      };
    });
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
    const loginId = String(req.body?.loginId ?? '').trim();
    const role = String(req.body?.role ?? req.body?.designation ?? '').trim();
    const password = String(req.body?.password ?? '').trim();
    const mobile = req.body?.mobile != null ? String(req.body.mobile).trim() : null;
    const isActive = req.body?.isActive === false ? 0 : 1;
    const poApprovalAmountRaw = req.body?.poApprovalAmount;
    const poApprovalAmount = poApprovalAmountRaw === '' || poApprovalAmountRaw == null ? null : Number(poApprovalAmountRaw);
    const menuAccessRaw = req.body?.menuAccess;
    const menuAccess = Array.isArray(menuAccessRaw) ? menuAccessRaw.map((x) => String(x)) : [];
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!loginId) return res.status(400).json({ error: 'loginId is required' });
    if (!role) return res.status(400).json({ error: 'role is required' });
    if (!password) return res.status(400).json({ error: 'password is required' });
    const id = crypto.randomUUID();
    const passwordHash = sha256(password);
    await pool.query(
      'INSERT INTO users (id, name, role, login_id, menu_access, phone, email, is_active, po_approval_amount, created_at, password_hash, password_plain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      [id, name, role, loginId, JSON.stringify(menuAccess), mobile, email || null, isActive, Number.isFinite(poApprovalAmount) ? poApprovalAmount : null, passwordHash, password]
    );
    res.status(201).json({
      user: {
        id,
        name,
        email: email || null,
        role,
        designation: role,
        loginId,
        menuAccess,
        isActive: Boolean(isActive),
        mobile,
        poApprovalAmount: Number.isFinite(poApprovalAmount) ? poApprovalAmount : null,
        hasPassword: true,
      },
    });
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
    const loginId = String(req.body?.loginId ?? '').trim();
    const role = String(req.body?.role ?? req.body?.designation ?? '').trim();
    const mobile = req.body?.mobile != null ? String(req.body.mobile).trim() : null;
    const password = req.body?.password != null ? String(req.body.password).trim() : '';
    const isActive = req.body?.isActive === false ? 0 : 1;
    const poApprovalAmountRaw = req.body?.poApprovalAmount;
    const poApprovalAmount = poApprovalAmountRaw === '' || poApprovalAmountRaw == null ? null : Number(poApprovalAmountRaw);
    const menuAccessRaw = req.body?.menuAccess;
    const menuAccess = Array.isArray(menuAccessRaw) ? menuAccessRaw.map((x) => String(x)) : [];
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!loginId) return res.status(400).json({ error: 'loginId is required' });
    if (!role) return res.status(400).json({ error: 'role is required' });

    if (password) {
      const passwordHash = sha256(password);
      await pool.query(
        'UPDATE users SET name=?, role=?, login_id=?, menu_access=?, phone=?, email=?, is_active=?, po_approval_amount=?, password_hash=?, password_plain=? WHERE id=?',
        [name, role, loginId, JSON.stringify(menuAccess), mobile, email || null, isActive, Number.isFinite(poApprovalAmount) ? poApprovalAmount : null, passwordHash, password, id]
      );
    } else {
      await pool.query(
        'UPDATE users SET name=?, role=?, login_id=?, menu_access=?, phone=?, email=?, is_active=?, po_approval_amount=? WHERE id=?',
        [name, role, loginId, JSON.stringify(menuAccess), mobile, email || null, isActive, Number.isFinite(poApprovalAmount) ? poApprovalAmount : null, id]
      );
    }

    const [[meta]] = await pool.query(
      "SELECT CASE WHEN password_hash IS NULL OR password_hash='' THEN 0 ELSE 1 END AS hasPassword FROM users WHERE id=? LIMIT 1",
      [id]
    );
    res.json({
      user: {
        id,
        name,
        email: email || null,
        role,
        designation: role,
        loginId,
        menuAccess,
        isActive: Boolean(isActive),
        mobile,
        poApprovalAmount: Number.isFinite(poApprovalAmount) ? poApprovalAmount : null,
        hasPassword: Boolean(meta?.hasPassword),
      },
    });
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
    const deletedBy = req.body?.deletedBy != null ? String(req.body.deletedBy).trim() : null;

    // "Delete" means hide from the system (soft delete) so it disappears from the Users list.
    // Also make inactive to prevent login.
    await pool.query('UPDATE users SET is_active=0, is_deleted=1, deleted_at=NOW(), deleted_by=? WHERE id=?', [deletedBy, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Settings: Document Sequences ---
app.get('/api/settings/doc-sequences', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    await ensureDocSequencesTable(pool);
    const [rows] = await pool.query(`
      SELECT
        ds.firm_id,
        f.name AS firmName,
        ds.kind,
        ds.fy,
        ds.next_no
      FROM doc_sequences ds
      LEFT JOIN firms f ON f.id = ds.firm_id
      ORDER BY f.name, ds.kind, ds.fy DESC
    `);

    res.json({ sequences: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/settings/doc-sequences/starting-number', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const firmId = String(req.body?.firmId || 'DEFAULT').trim();
    const kind = String(req.body?.kind || '').trim().toUpperCase();
    const fy = String(req.body?.fy || fiscalYearLabel(new Date())).trim();
    const startingNo = Number(req.body?.startingNo);

    if (!kind) return res.status(400).json({ error: 'kind is required' });
    if (!Number.isFinite(startingNo) || startingNo < 1) return res.status(400).json({ error: 'startingNo must be a positive number' });

    await ensureDocSequencesTable(pool);
    await pool.query(
      `
      INSERT INTO doc_sequences (firm_id, kind, fy, next_no)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE next_no = VALUES(next_no)
      `,
      [firmId, kind, fy, startingNo]
    );

    res.json({ ok: true, firmId, kind, fy, nextNo: startingNo });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/settings/doc-sequences', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const { firmId, kind, fy } = req.query;

    if (!firmId || !kind || !fy) {
      return res.status(400).json({ error: 'firmId, kind, and fy are required' });
    }

    await pool.query(
      'DELETE FROM doc_sequences WHERE firm_id = ? AND kind = ? AND fy = ?',
      [firmId, kind, fy]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/settings/doc-sequences', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const { firmId, kind, oldFy, newFy, nextNo } = req.body;
    console.log('[API] Updating doc_sequence:', { firmId, kind, oldFy, newFy, nextNo });

    if (!firmId || !kind || !oldFy || !newFy) {
      return res.status(400).json({ error: 'firmId, kind, oldFy, and newFy are required' });
    }

    const [result] = await pool.query(
      `
      UPDATE doc_sequences
      SET fy = ?, next_no = ?
      WHERE firm_id = ? AND kind = ? AND fy = ?
      `,
      [newFy, nextNo, firmId, kind, oldFy]
    );
    console.log('[API] Update result:', result);

    res.json({ ok: true });
  } catch (e) {
    console.error('[API] Update error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});




app.get('/api/settings/links', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query(
      `SELECT id, name, link, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt FROM settings_links ORDER BY updated_at DESC, created_at DESC`
    );
    res.json({ links: Array.isArray(rows) ? rows : [] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/settings/links', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    const link = String(req.body?.link ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!link) return res.status(400).json({ error: 'link is required' });
    const id = crypto.randomUUID();
    await pool.query(
      `
      INSERT INTO settings_links (id, name, link, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
      `,
      [id, name, link]
    );
    res.status(201).json({ link: { id, name, link } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/settings/links/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    const link = String(req.body?.link ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!link) return res.status(400).json({ error: 'link is required' });
    await pool.query(
      `
      UPDATE settings_links
      SET name = ?, link = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [name, link, id]
    );
    res.json({ link: { id, name, link } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/settings/links/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM settings_links WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Create RFQ for a PR (no link with PO/follow-up flows)
app.post('/api/requests/:id/rfq', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const prId = String(req.params.id ?? '').trim();
    if (!prId) return res.status(400).json({ error: 'id is required' });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'items are required' });

    const [[prRow]] = await pool.query(
      'SELECT id, firm_id AS firmId, project_id AS projectId FROM purchase_requisitions WHERE id = ? LIMIT 1',
      [prId]
    );
    if (!prRow) return res.status(404).json({ error: 'PR not found' });

    const rfqId = crypto.randomUUID();
    const rfqNumber = await allocateDocNumber(pool, prRow.firmId, 'RFQ', new Date());

    await pool.query(
      `
      INSERT INTO rfqs (id, rfq_number, pr_id, firm_id, project_id, status, rfq_date, remarks, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'created', CURDATE(), NULL, ?, NOW(), NOW())
      `,
      [rfqId, rfqNumber, prId, prRow.firmId ? String(prRow.firmId) : null, prRow.projectId ? String(prRow.projectId) : null, 'system']
    );

	    for (const row of items) {
	      const itemId = String(row?.itemId ?? '').trim();
	      const supplierIdRaw = row?.supplierId != null ? String(row.supplierId).trim() : '';
	      const supplierId = supplierIdRaw ? supplierIdRaw : null;
	      const supplierRateRaw = row?.supplierRate != null ? Number(row.supplierRate) : null;
	      const supplierRate = supplierRateRaw != null && Number.isFinite(supplierRateRaw) ? supplierRateRaw : null;
	      const quantity = Number(row?.quantity ?? 0);
	      const specification = row?.specification != null ? String(row.specification).trim() : null;
	      if (!itemId) return res.status(400).json({ error: 'Each item requires itemId' });
	      if (!supplierId) return res.status(400).json({ error: 'Each item requires supplierId' });
	      if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Each item requires valid quantity' });
	      await pool.query(
	        `
	        INSERT INTO rfq_items (id, rfq_id, item_id, supplier_id, supplier_rate, specification, quantity, created_at)
	        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
	        `,
	        [crypto.randomUUID(), rfqId, itemId, supplierId, supplierRate, specification, quantity]
	      );
	    }

	    res.status(201).json({ rfq: { id: rfqId, rfqNumber, prId } });
	  } catch (e) {
	    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
	  }
		});

// RFQ list (Quotation Master)
app.get('/api/rfqs', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const q = String(req.query?.q ?? '').trim();
    const firmId = String(req.query?.firmId ?? '').trim();
    const projectId = String(req.query?.projectId ?? '').trim();
    const status = String(req.query?.status ?? '').trim();
    const from = String(req.query?.from ?? '').trim();
    const to = String(req.query?.to ?? '').trim();

    const where = [];
    const params = [];

    if (firmId) {
      where.push('r.firm_id = ?');
      params.push(firmId);
    }
    if (projectId) {
      where.push('r.project_id = ?');
      params.push(projectId);
    }
    if (status) {
      where.push('r.status = ?');
      params.push(status);
    }
    if (from) {
      where.push('r.rfq_date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('r.rfq_date <= ?');
      params.push(to);
    }
    if (q) {
      where.push('(r.rfq_number LIKE ? OR f.name LIKE ? OR p.name LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `
      SELECT
        r.id AS id,
        r.rfq_number AS rfqNumber,
        r.rfq_date AS rfqDate,
        r.status AS status,
        r.pr_id AS prId,
        r.remarks AS remarks,
        f.id AS firmId,
        f.name AS firmName,
        p.id AS projectId,
        p.name AS projectName,
        COUNT(ri.id) AS itemCount,
        SUM(CASE WHEN ri.supplier_rate IS NULL OR ri.supplier_rate = 0 THEN 1 ELSE 0 END) AS pendingRateCount
      FROM rfqs r
      LEFT JOIN firms f ON f.id = r.firm_id
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN rfq_items ri ON ri.rfq_id = r.id
      ${whereSql}
      GROUP BY r.id
      ORDER BY r.rfq_date DESC, r.created_at DESC
      `,
      params
    );

    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      id: String(r.id ?? ''),
      rfqNumber: String(r.rfqNumber ?? ''),
      rfqDate: toIsoDate(r.rfqDate) || '',
      status: String(r.status ?? 'created'),
      prId: r.prId ? String(r.prId) : null,
      remarks: r.remarks != null ? String(r.remarks) : null,
      firmId: r.firmId ? String(r.firmId) : null,
      firmName: r.firmName ? String(r.firmName) : null,
      projectId: r.projectId ? String(r.projectId) : null,
      projectName: r.projectName ? String(r.projectName) : null,
      itemCount: Number(r.itemCount ?? 0),
      pendingRateCount: Number(r.pendingRateCount ?? 0),
    }));

    res.json({ rfqs: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/rfqs/:id/items', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const rfqId = String(req.params.id ?? '').trim();
    if (!rfqId) return res.status(400).json({ error: 'id is required' });

    const [rows] = await pool.query(
      `
      SELECT
        ri.id AS rfqItemId,
        ri.item_id AS itemId,
        iname.name AS itemName,
        ri.specification AS specification,
        ri.quantity AS quantity,
        ri.supplier_id AS supplierId,
        s.name AS supplierName,
        ri.supplier_rate AS supplierRate
      FROM rfq_items ri
      LEFT JOIN items it ON it.id = ri.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      LEFT JOIN suppliers s ON s.id = ri.supplier_id
      WHERE ri.rfq_id = ?
      ORDER BY ri.created_at ASC
      `,
      [rfqId]
    );

    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      rfqItemId: String(r.rfqItemId ?? ''),
      itemId: String(r.itemId ?? ''),
      itemName: String(r.itemName ?? ''),
      specification: String(r.specification ?? ''),
      quantity: Number(r.quantity ?? 0),
      supplierId: r.supplierId ? String(r.supplierId) : null,
      supplierName: r.supplierName ? String(r.supplierName) : null,
      supplierRate: r.supplierRate != null ? Number(r.supplierRate) : null,
    }));

    res.json({ items: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Pending Supplier Rate (RFQ Items)
app.get('/api/rfq-items/pending-supplier-rate', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const [rows] = await pool.query(
      `
      SELECT
        ri.id AS rfqItemId,
        ri.rfq_id AS rfqId,
        r.rfq_number AS rfqNumber,
        r.rfq_date AS rfqDate,
        r.pr_id AS prId,
        pr.pr_number AS prNumber,
        ri.item_id AS itemId,
        iname.name AS item,
        ri.specification AS specification,
        ri.quantity AS quantity,
        ri.supplier_id AS supplierId,
        s.name AS supplierName,
        ri.supplier_rate AS supplierRate
      FROM rfq_items ri
      INNER JOIN rfqs r ON r.id = ri.rfq_id
      LEFT JOIN purchase_requisitions pr ON pr.id = r.pr_id
      LEFT JOIN items it ON it.id = ri.item_id
      LEFT JOIN item_names iname ON iname.id = it.item_name_id
      LEFT JOIN suppliers s ON s.id = ri.supplier_id
      WHERE (ri.supplier_rate IS NULL OR ri.supplier_rate = 0)
      ORDER BY r.rfq_date DESC, ri.created_at DESC
      `
    );

    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      rfqItemId: String(r.rfqItemId ?? ''),
      rfqId: String(r.rfqId ?? ''),
      rfqNumber: String(r.rfqNumber ?? ''),
      rfqDate: toIsoDate(r.rfqDate) || '',
      prId: r.prId ? String(r.prId) : null,
      prNumber: r.prNumber ? String(r.prNumber) : null,
      itemId: String(r.itemId ?? ''),
      item: String(r.item ?? ''),
      specification: String(r.specification ?? ''),
      quantity: Number(r.quantity ?? 0),
      supplierId: r.supplierId ? String(r.supplierId) : null,
      supplierName: r.supplierName ? String(r.supplierName) : null,
      supplierRate: r.supplierRate != null ? Number(r.supplierRate) : null,
    }));

    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/rfq-items/:id/supplier-rate', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    const supplierRateRaw = req.body?.supplierRate;
    const supplierRate = Number(supplierRateRaw);
    if (!Number.isFinite(supplierRate) || supplierRate <= 0) return res.status(400).json({ error: 'supplierRate must be a positive number' });

    const [[found]] = await pool.query('SELECT id FROM rfq_items WHERE id = ? LIMIT 1', [id]);
    if (!found) return res.status(404).json({ error: 'RFQ item not found' });

    await pool.query('UPDATE rfq_items SET supplier_rate = ? WHERE id = ?', [supplierRate, id]);
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
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM units WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'unit')) return;
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Priorities ---
app.get('/api/masters/priorities', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const [rows] = await pool.query('SELECT id, name FROM priorities ORDER BY name');
    res.json({ priorities: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/masters/priorities', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query('INSERT INTO priorities (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [
      id,
      name,
      createdBy,
    ]);
    res.status(201).json({ priority: { id, name } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('Duplicate') || message.includes('ER_DUP_ENTRY')) return res.status(400).json({ error: 'Priority already exists' });
    res.status(500).json({ error: message });
  }
});

app.put('/api/masters/priorities/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query('UPDATE priorities SET name=?, updated_by=?, updated_at=NOW() WHERE id=?', [name, updatedBy, id]);
    res.json({ priority: { id, name } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/priorities/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM priorities WHERE id=?', [id]);
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
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM item_categories WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'item category')) return;
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
	        n.type AS type,
	        n.unit_id AS unitId,
	        u.name AS unitName,
	        n.item_category_id AS itemCategoryId,
	        c.name AS itemCategoryName,
        n.catalogue_link AS catalogueLink,
        GROUP_CONCAT(ins.specification_id ORDER BY ins.specification_id SEPARATOR ',') AS specificationIdsCsv,
        GROUP_CONCAT(CONCAT(ins.specification_id, ':', COALESCE(sp.name, '')) ORDER BY ins.specification_id SEPARATOR '||') AS specificationsCsv
      FROM item_names n
      LEFT JOIN units u ON u.id = n.unit_id
      LEFT JOIN item_categories c ON c.id = n.item_category_id
      LEFT JOIN item_name_specifications ins ON ins.item_name_id = n.id
      LEFT JOIN specifications sp ON sp.id = ins.specification_id
      GROUP BY n.id
      ORDER BY n.name
      `
    );
    const itemNames = (Array.isArray(rows) ? rows : []).map((r) => {
      const csv = r.specificationIdsCsv != null ? String(r.specificationIdsCsv) : '';
      const specificationIds = csv
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const specCsv = r.specificationsCsv != null ? String(r.specificationsCsv) : '';
      const specifications = specCsv
        .split('||')
        .map((pair) => {
          const [id, name] = String(pair ?? '').split(':');
          const sid = String(id ?? '').trim();
          const sname = String(name ?? '').trim();
          if (!sid) return null;
          return { id: sid, name: sname || sid };
        })
        .filter(Boolean);
      const out = { ...r };
      delete out.specificationIdsCsv;
      delete out.specificationsCsv;
      return { ...out, specificationIds, specifications };
    });
    res.json({ itemNames });
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
	    const typeRaw = String(req.body?.type ?? '').trim();
	    const typeNorm = typeRaw.toLowerCase() === 'services' ? 'Services' : 'Goods';
	    const unitId = req.body?.unitId != null ? String(req.body.unitId).trim() : '';
	    const itemCategoryId = req.body?.itemCategoryId != null ? String(req.body.itemCategoryId).trim() : '';
    const specificationIds = Array.isArray(req.body?.specificationIds)
      ? req.body.specificationIds.map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (!unitId) return res.status(400).json({ error: 'unitId is required' });
    if (!itemCategoryId) return res.status(400).json({ error: 'itemCategoryId is required' });
	    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
	    const catalogueLink = req.body?.catalogueLink != null ? String(req.body.catalogueLink).trim() : null;
	    await pool.query(
	      'INSERT INTO item_names (id, name, type, unit_id, item_category_id, catalogue_link, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
	      [id, name, typeNorm, unitId, itemCategoryId, catalogueLink, createdBy]
	    );
    if (specificationIds.length) {
      for (const specId of specificationIds) {
        await pool.query('INSERT IGNORE INTO item_name_specifications (item_name_id, specification_id, created_at) VALUES (?, ?, NOW())', [
          id,
          specId,
        ]);
      }
    }
    const [rows] = await pool.query(
      `
	      SELECT
	        n.id,
	        n.name,
	        n.type AS type,
	        n.unit_id AS unitId,
	        u.name AS unitName,
	        n.item_category_id AS itemCategoryId,
	        c.name AS itemCategoryName,
        n.catalogue_link AS catalogueLink,
        GROUP_CONCAT(ins.specification_id ORDER BY ins.specification_id SEPARATOR ',') AS specificationIdsCsv,
        GROUP_CONCAT(CONCAT(ins.specification_id, ':', COALESCE(sp.name, '')) ORDER BY ins.specification_id SEPARATOR '||') AS specificationsCsv
      FROM item_names n
      LEFT JOIN units u ON u.id = n.unit_id
      LEFT JOIN item_categories c ON c.id = n.item_category_id
      LEFT JOIN item_name_specifications ins ON ins.item_name_id = n.id
      LEFT JOIN specifications sp ON sp.id = ins.specification_id
      WHERE n.id = ?
      GROUP BY n.id
      `,
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const csv = row?.specificationIdsCsv != null ? String(row.specificationIdsCsv) : '';
    const outSpecIds = csv
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const specCsv = row?.specificationsCsv != null ? String(row.specificationsCsv) : '';
    const specifications = specCsv
      .split('||')
      .map((pair) => {
        const [id2, name2] = String(pair ?? '').split(':');
        const sid = String(id2 ?? '').trim();
        const sname = String(name2 ?? '').trim();
        if (!sid) return null;
        return { id: sid, name: sname || sid };
      })
      .filter(Boolean);
    if (row) delete row.specificationIdsCsv;
    if (row) delete row.specificationsCsv;
    res.status(201).json({
      itemName: row
        ? { ...row, specificationIds: outSpecIds, specifications }
        : { id, name, unitId, itemCategoryId, specificationIds, specifications },
    });
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
	    const typeRaw = String(req.body?.type ?? '').trim();
	    const typeNorm = typeRaw.toLowerCase() === 'services' ? 'Services' : 'Goods';
	    const unitId = req.body?.unitId != null ? String(req.body.unitId).trim() : '';
	    const itemCategoryId = req.body?.itemCategoryId != null ? String(req.body.itemCategoryId).trim() : '';
    const specificationIds = Array.isArray(req.body?.specificationIds)
      ? req.body.specificationIds.map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (!unitId) return res.status(400).json({ error: 'unitId is required' });
    if (!itemCategoryId) return res.status(400).json({ error: 'itemCategoryId is required' });
	    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
	    const catalogueLink = req.body?.catalogueLink != null ? String(req.body.catalogueLink).trim() : null;
	    await pool.query(
	      'UPDATE item_names SET name=?, type=?, unit_id=?, item_category_id=?, catalogue_link=?, updated_by=?, updated_at=NOW() WHERE id=?',
	      [name, typeNorm, unitId, itemCategoryId, catalogueLink, updatedBy, id]
	    );
    await pool.query('DELETE FROM item_name_specifications WHERE item_name_id=?', [id]);
    if (specificationIds.length) {
      for (const specId of specificationIds) {
        await pool.query('INSERT IGNORE INTO item_name_specifications (item_name_id, specification_id, created_at) VALUES (?, ?, NOW())', [
          id,
          specId,
        ]);
      }
    }
    const [rows] = await pool.query(
      `
	      SELECT
	        n.id,
	        n.name,
	        n.type AS type,
	        n.unit_id AS unitId,
	        u.name AS unitName,
	        n.item_category_id AS itemCategoryId,
	        c.name AS itemCategoryName,
        n.catalogue_link AS catalogueLink,
        GROUP_CONCAT(ins.specification_id ORDER BY ins.specification_id SEPARATOR ',') AS specificationIdsCsv,
        GROUP_CONCAT(CONCAT(ins.specification_id, ':', COALESCE(sp.name, '')) ORDER BY ins.specification_id SEPARATOR '||') AS specificationsCsv
      FROM item_names n
      LEFT JOIN units u ON u.id = n.unit_id
      LEFT JOIN item_categories c ON c.id = n.item_category_id
      LEFT JOIN item_name_specifications ins ON ins.item_name_id = n.id
      LEFT JOIN specifications sp ON sp.id = ins.specification_id
      WHERE n.id = ?
      GROUP BY n.id
      `,
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const csv = row?.specificationIdsCsv != null ? String(row.specificationIdsCsv) : '';
    const outSpecIds = csv
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const specCsv = row?.specificationsCsv != null ? String(row.specificationsCsv) : '';
    const specifications = specCsv
      .split('||')
      .map((pair) => {
        const [id2, name2] = String(pair ?? '').split(':');
        const sid = String(id2 ?? '').trim();
        const sname = String(name2 ?? '').trim();
        if (!sid) return null;
        return { id: sid, name: sname || sid };
      })
      .filter(Boolean);
    if (row) delete row.specificationIdsCsv;
    if (row) delete row.specificationsCsv;
    res.json({
      itemName: row
        ? { ...row, specificationIds: outSpecIds, specifications }
        : { id, name, unitId, itemCategoryId, specificationIds, specifications },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/masters/item-names/:id', async (req, res) => {
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM item_name_specifications WHERE item_name_id=?', [id]);
    await pool.query('DELETE FROM item_names WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'item name')) return;
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/masters/item-names/:id/items-template', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });

    const [[itemNameRow]] = await pool.query(
      `
      SELECT
        n.id,
        n.name,
        u.name AS unitName,
        c.name AS itemCategoryName
      FROM item_names n
      LEFT JOIN units u ON u.id = n.unit_id
      LEFT JOIN item_categories c ON c.id = n.item_category_id
      WHERE n.id = ?
      LIMIT 1
      `,
      [id]
    );
    if (!itemNameRow) return res.status(404).json({ error: 'Item name not found' });

    const [specRows] = await pool.query(
      `
      SELECT s.name
      FROM item_name_specifications ins
      INNER JOIN specifications s ON s.id = ins.specification_id
      WHERE ins.item_name_id = ?
      ORDER BY s.name
      `,
      [id]
    );
    const [storeRows] = await pool.query(
      `
      SELECT name
      FROM stores
      ORDER BY name
      `
    );

    const toCsvCell = (value) => {
      const raw = String(value ?? '');
      const escaped = raw.replace(/"/g, '""');
      return /[",\r\n]/.test(raw) ? `"${escaped}"` : escaped;
    };

    const specColumns = (Array.isArray(specRows) ? specRows : [])
      .map((r) => String(r.name ?? '').trim())
      .filter(Boolean);
    const storeColumns = (Array.isArray(storeRows) ? storeRows : [])
      .map((r) => String(r.name ?? '').trim())
      .filter(Boolean)
      .map((name) => `Opening Stock - ${name}`);
    const header = ['item_name', 'description', 'unit', 'item_category', ...specColumns, ...storeColumns, 'Re-Order Level', 'Rate'];
    const lines = [header.map(toCsvCell).join(',')];

    for (let i = 0; i < 25; i += 1) {
      const row = [
        String(itemNameRow.name ?? ''),
        '',
        String(itemNameRow.unitName ?? ''),
        String(itemNameRow.itemCategoryName ?? ''),
        ...specColumns.map(() => ''),
        ...storeColumns.map(() => ''),
        '',
        '',
      ];
      lines.push(row.map(toCsvCell).join(','));
    }

    const safeName = String(itemNameRow.name ?? 'item')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'item';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-items-template.csv"`);
    res.send(`${lines.join('\n')}\n`);
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
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM specifications WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'specification')) return;
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
    const itemNameId = String(req.query.itemNameId ?? '').trim();
    const [rows] = await pool.query(
      `
      SELECT
        sv.id,
        sv.specification_id AS specificationId,
        sv.item_name_id AS itemNameId,
        iname.name AS itemName,
        sv.value,
        sv.is_active AS isActive,
        (
          SELECT COUNT(*)
          FROM items it
          WHERE JSON_VALID(it.specifications_json)
            AND JSON_UNQUOTE(JSON_EXTRACT(it.specifications_json, CONCAT('$.', sv.specification_id))) = sv.value
        ) AS usageCount
      FROM specification_values sv
      LEFT JOIN item_names iname ON iname.id = sv.item_name_id
      WHERE sv.specification_id=?
        ${itemNameId ? 'AND (sv.item_name_id = ? OR sv.item_name_id IS NULL)' : ''}
      ORDER BY sv.value
      `,
      itemNameId ? [specificationId, itemNameId] : [specificationId]
    );
    const specificationValues = (rows || []).map((r) => ({
      ...r,
      isActive: Boolean(r.isActive),
      usageCount: Number(r.usageCount ?? 0),
      isUsed: Number(r.usageCount ?? 0) > 0,
    }));
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
    const itemNameId = req.body?.itemNameId != null ? String(req.body.itemNameId).trim() : '';
    const value = String(req.body?.value ?? '').trim();
    if (!specificationId) return res.status(400).json({ error: 'specificationId is required' });
    if (!value) return res.status(400).json({ error: 'value is required' });
    const [[dup]] = await pool.query(
      `
      SELECT id
      FROM specification_values
      WHERE specification_id = ?
        AND COALESCE(item_name_id, '') = ?
        AND value = ?
      LIMIT 1
      `,
      [specificationId, itemNameId, value]
    );
    if (dup?.id) return res.status(400).json({ error: 'Value already exists' });
    const id = crypto.randomUUID();
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    await pool.query(
      'INSERT INTO specification_values (id, specification_id, item_name_id, value, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, NOW(), NOW())',
      [id, specificationId, itemNameId || null, value, createdBy]
    );
    res.status(201).json({ specificationValue: { id, specificationId, itemNameId: itemNameId || null, value, isActive: true } });
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
    const itemNameId = req.body?.itemNameId != null ? String(req.body.itemNameId).trim() : '';
    const value = String(req.body?.value ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!specificationId) return res.status(400).json({ error: 'specificationId is required' });
    if (!value) return res.status(400).json({ error: 'value is required' });
    const [[currentRow]] = await pool.query(
      'SELECT id, specification_id AS specificationId, item_name_id AS itemNameId, value FROM specification_values WHERE id=? LIMIT 1',
      [id]
    );
    if (!currentRow) return res.status(404).json({ error: 'Specification value not found' });
    const currentSpecificationId = String(currentRow.specificationId ?? '').trim();
    const currentItemNameId = String(currentRow.itemNameId ?? '').trim();
    const currentValue = String(currentRow.value ?? '').trim();
    const [[dup]] = await pool.query(
      `
      SELECT id
      FROM specification_values
      WHERE specification_id = ?
        AND COALESCE(item_name_id, '') = ?
        AND value = ?
        AND id <> ?
      LIMIT 1
      `,
      [specificationId, itemNameId, value, id]
    );
    if (dup?.id) return res.status(400).json({ error: 'Value already exists' });
    const changingKey = currentSpecificationId !== specificationId || currentItemNameId !== itemNameId || currentValue !== value;
    if (changingKey) {
      const [[usageRow]] = await pool.query(
        `
        SELECT COUNT(*) AS usageCount
        FROM items
        WHERE JSON_VALID(specifications_json)
          AND JSON_UNQUOTE(JSON_EXTRACT(specifications_json, CONCAT('$.', ?))) = ?
        `,
        [currentSpecificationId, currentValue]
      );
      const usageCount = Number(usageRow?.usageCount ?? 0);
      if (usageCount > 0) {
        return res.status(409).json({
          error: `Cannot edit. This specification value is already used in ${usageCount} item(s).`,
        });
      }
    }
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    await pool.query(
      'UPDATE specification_values SET specification_id=?, item_name_id=?, value=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [specificationId, itemNameId || null, value, updatedBy, id]
    );
    res.json({ specificationValue: { id, specificationId, itemNameId: itemNameId || null, value, isActive: true } });
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

    const [[specValueRow]] = await pool.query(
      'SELECT id, specification_id AS specificationId, item_name_id AS itemNameId, value FROM specification_values WHERE id=? LIMIT 1',
      [id]
    );
    if (!specValueRow) return res.status(404).json({ error: 'Specification value not found' });

    const specificationId = String(specValueRow.specificationId ?? '').trim();
    const value = String(specValueRow.value ?? '').trim();
    const [[usageRow]] = await pool.query(
      `
      SELECT COUNT(*) AS usageCount
      FROM items
      WHERE JSON_VALID(specifications_json)
        AND JSON_UNQUOTE(JSON_EXTRACT(specifications_json, CONCAT('$.', ?))) = ?
      `,
      [specificationId, value]
    );
    const usageCount = Number(usageRow?.usageCount ?? 0);
    if (usageCount > 0) {
      return res.status(409).json({
        error: `Cannot delete. This specification value is already used in ${usageCount} item(s).`,
      });
    }

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
        it.unit,
        it.photo_1 AS photo1,
        it.photo_2 AS photo2,
        it.photo_3 AS photo3,
        it.photo_4 AS photo4,
        it.photo_5 AS photo5,
        it.item_link AS itemLink,
	        it.video_link AS videoLink,
	        it.reorder_level AS reorderLevel,
	        it.opening_stock AS openingStock
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
    const photo1 = req.body?.photo1 != null ? String(req.body.photo1).trim() : null;
    const photo2 = req.body?.photo2 != null ? String(req.body.photo2).trim() : null;
    const photo3 = req.body?.photo3 != null ? String(req.body.photo3).trim() : null;
    const photo4 = req.body?.photo4 != null ? String(req.body.photo4).trim() : null;
    const photo5 = req.body?.photo5 != null ? String(req.body.photo5).trim() : null;
    const itemLink = req.body?.itemLink != null ? String(req.body.itemLink).trim() : null;
    const videoLink = req.body?.videoLink != null ? String(req.body.videoLink).trim() : null;
	    const reorderLevelRaw = req.body?.reorderLevel;
    const reorderLevel =
      reorderLevelRaw === null || reorderLevelRaw === undefined || String(reorderLevelRaw).trim() === ''
        ? null
        : Math.max(0, Number(reorderLevelRaw));
	    if (reorderLevelRaw !== null && reorderLevelRaw !== undefined && String(reorderLevelRaw).trim() !== '' && !Number.isFinite(reorderLevel)) {
	      return res.status(400).json({ error: 'reorderLevel must be a number' });
	    }
	    const rateRaw = req.body?.rate;
    const rate =
      rateRaw === null || rateRaw === undefined || String(rateRaw).trim() === ''
        ? 0
        : Math.max(0, Number(rateRaw));
    if (rateRaw !== null && rateRaw !== undefined && String(rateRaw).trim() !== '' && !Number.isFinite(rate)) {
      return res.status(400).json({ error: 'rate must be a number' });
    }
    const openingStockRaw = req.body?.openingStock;
	    const openingStock =
	      openingStockRaw === null || openingStockRaw === undefined || String(openingStockRaw).trim() === ''
	        ? 0
	        : Math.max(0, Number(openingStockRaw));
	    if (openingStockRaw !== null && openingStockRaw !== undefined && String(openingStockRaw).trim() !== '' && !Number.isFinite(openingStock)) {
	      return res.status(400).json({ error: 'openingStock must be a number' });
	    }
    const storeOpeningBalances = Array.isArray(req.body?.storeOpeningBalances) ? req.body.storeOpeningBalances : [];
	    const specs = Array.isArray(req.body?.specs) ? req.body.specs : [];
	    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;

    // itemCode/uniqueKey are app-specific; generate simple deterministic values.
    const id = crypto.randomUUID();
    const itemCode = `IT-${id.slice(0, 8).toUpperCase()}`;
    const specificationsJson = JSON.stringify(Object.fromEntries(specs.map((s) => [String(s.specificationId), String(s.value)])));
    const uniqueKey = `${itemNameId}:${sha256(specificationsJson).slice(0, 16)}`;

	    await pool.query(
		      'INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, photo_1, photo_2, photo_3, photo_4, photo_5, item_link, video_link, reorder_level, rate, opening_stock, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
		      [id, itemNameId, itemCode, specificationsJson, uniqueKey, description, unit, photo1, photo2, photo3, photo4, photo5, itemLink, videoLink, Number.isFinite(reorderLevel) ? reorderLevel : null, Number.isFinite(rate) ? rate : 0, Number.isFinite(openingStock) ? openingStock : 0, createdBy]
		    );
    await repairMissingItemSpecificationValues(pool, { itemId: id });
    if (storeOpeningBalances.length) {
      const [allStores] = await pool.query('SELECT id, name FROM stores');
      const storeIdByName = new Map(
        (Array.isArray(allStores) ? allStores : []).map((s) => [String(s.name ?? '').trim().toLowerCase(), String(s.id ?? '').trim()])
      );
      const year = fiscalYearLabel(new Date());
      for (const entry of storeOpeningBalances) {
        const storeName = String(entry?.storeName ?? '').trim();
        const qtyRaw = Number(entry?.quantity ?? 0);
        if (!storeName || !Number.isFinite(qtyRaw) || qtyRaw <= 0) continue;
        const storeId = storeIdByName.get(storeName.toLowerCase());
        if (!storeId) return res.status(400).json({ error: `Store not found: ${storeName}` });
        const qty = Math.max(0, qtyRaw);
        await pool.query(
          `
          INSERT INTO item_opening_balances (id, store_id, item_id, quantity, reorder_level, year, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE quantity=VALUES(quantity), reorder_level=VALUES(reorder_level), updated_at=NOW()
          `,
          [crypto.randomUUID(), storeId, id, qty, Number.isFinite(reorderLevel) ? reorderLevel : 0, year]
        );
      }
    }

    const [rows] = await pool.query(
      `
		      SELECT it.id, it.item_name_id AS itemNameId, it.item_code AS itemCode, n.name AS itemName,
		             it.specifications_json AS specificationsJson, it.unique_key AS uniqueKey, it.description, it.unit,
                 it.photo_1 AS photo1, it.photo_2 AS photo2, it.photo_3 AS photo3, it.photo_4 AS photo4, it.photo_5 AS photo5,
			             it.item_link AS itemLink, it.video_link AS videoLink, it.reorder_level AS reorderLevel, it.rate AS rate, it.opening_stock AS openingStock
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
    const photo1 = req.body?.photo1 != null ? String(req.body.photo1).trim() : null;
    const photo2 = req.body?.photo2 != null ? String(req.body.photo2).trim() : null;
    const photo3 = req.body?.photo3 != null ? String(req.body.photo3).trim() : null;
    const photo4 = req.body?.photo4 != null ? String(req.body.photo4).trim() : null;
    const photo5 = req.body?.photo5 != null ? String(req.body.photo5).trim() : null;
    const itemLink = req.body?.itemLink != null ? String(req.body.itemLink).trim() : null;
    const videoLink = req.body?.videoLink != null ? String(req.body.videoLink).trim() : null;
	    const reorderLevelRaw = req.body?.reorderLevel;
    const reorderLevel =
      reorderLevelRaw === null || reorderLevelRaw === undefined || String(reorderLevelRaw).trim() === ''
        ? null
        : Math.max(0, Number(reorderLevelRaw));
	    if (reorderLevelRaw !== null && reorderLevelRaw !== undefined && String(reorderLevelRaw).trim() !== '' && !Number.isFinite(reorderLevel)) {
	      return res.status(400).json({ error: 'reorderLevel must be a number' });
	    }
	    const rateRaw = req.body?.rate;
    const rate =
      rateRaw === null || rateRaw === undefined || String(rateRaw).trim() === ''
        ? 0
        : Math.max(0, Number(rateRaw));
    if (rateRaw !== null && rateRaw !== undefined && String(rateRaw).trim() !== '' && !Number.isFinite(rate)) {
      return res.status(400).json({ error: 'rate must be a number' });
    }
    const openingStockRaw = req.body?.openingStock;
	    const openingStock =
	      openingStockRaw === null || openingStockRaw === undefined || String(openingStockRaw).trim() === ''
	        ? 0
	        : Math.max(0, Number(openingStockRaw));
	    if (openingStockRaw !== null && openingStockRaw !== undefined && String(openingStockRaw).trim() !== '' && !Number.isFinite(openingStock)) {
	      return res.status(400).json({ error: 'openingStock must be a number' });
	    }
    const storeOpeningBalances = Array.isArray(req.body?.storeOpeningBalances) ? req.body.storeOpeningBalances : [];
	    const specs = Array.isArray(req.body?.specs) ? req.body.specs : [];
	    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;
    const specificationsJson = JSON.stringify(Object.fromEntries(specs.map((s) => [String(s.specificationId), String(s.value)])));
    const uniqueKey = `${itemNameId}:${sha256(specificationsJson).slice(0, 16)}`;
	    await pool.query(
		      'UPDATE items SET item_name_id=?, specifications_json=?, unique_key=?, description=?, unit=?, photo_1=?, photo_2=?, photo_3=?, photo_4=?, photo_5=?, item_link=?, video_link=?, reorder_level=?, rate=?, opening_stock=?, updated_by=?, updated_at=NOW() WHERE id=?',
		      [itemNameId, specificationsJson, uniqueKey, description, unit, photo1, photo2, photo3, photo4, photo5, itemLink, videoLink, Number.isFinite(reorderLevel) ? reorderLevel : null, Number.isFinite(rate) ? rate : 0, Number.isFinite(openingStock) ? openingStock : 0, updatedBy, id]
		    );
    await repairMissingItemSpecificationValues(pool, { itemId: id });
    if (storeOpeningBalances.length) {
      const [allStores] = await pool.query('SELECT id, name FROM stores');
      const storeIdByName = new Map(
        (Array.isArray(allStores) ? allStores : []).map((s) => [String(s.name ?? '').trim().toLowerCase(), String(s.id ?? '').trim()])
      );
      const year = fiscalYearLabel(new Date());
      await pool.query('DELETE FROM item_opening_balances WHERE item_id = ? AND year = ?', [id, year]);
      for (const entry of storeOpeningBalances) {
        const storeName = String(entry?.storeName ?? '').trim();
        const qtyRaw = Number(entry?.quantity ?? 0);
        if (!storeName || !Number.isFinite(qtyRaw) || qtyRaw <= 0) continue;
        const storeId = storeIdByName.get(storeName.toLowerCase());
        if (!storeId) return res.status(400).json({ error: `Store not found: ${storeName}` });
        const qty = Math.max(0, qtyRaw);
        await pool.query(
          `
          INSERT INTO item_opening_balances (id, store_id, item_id, quantity, reorder_level, year, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE quantity=VALUES(quantity), reorder_level=VALUES(reorder_level), updated_at=NOW()
          `,
          [crypto.randomUUID(), storeId, id, qty, Number.isFinite(reorderLevel) ? reorderLevel : 0, year]
        );
      }
    }
	    const [rows] = await pool.query(
      `
		      SELECT it.id, it.item_name_id AS itemNameId, it.item_code AS itemCode, n.name AS itemName,
		             it.specifications_json AS specificationsJson, it.unique_key AS uniqueKey, it.description, it.unit,
                 it.photo_1 AS photo1, it.photo_2 AS photo2, it.photo_3 AS photo3, it.photo_4 AS photo4, it.photo_5 AS photo5,
			             it.item_link AS itemLink, it.video_link AS videoLink, it.reorder_level AS reorderLevel, it.rate AS rate, it.opening_stock AS openingStock
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
  let pool;
  let id = '';
  try {
    pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM items WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    if (await sendDeleteInUseError(res, pool, id, e, 'item')) return;
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Masters: Bulk templates & import (CSV over JSON rows) ---
function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function requireRows(body) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  return rows.map((r) => (r && typeof r === 'object' ? r : {}));
}

function findDuplicates(list) {
  const counts = new Map();
  for (const v of list) {
    const k = normalizeKey(v);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, c]) => c > 1)
    .map(([k]) => k);
}

function csvTemplateResponse(res, filename, headerLine) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`${headerLine}\n`);
}

async function selectExistingNames(pool, table, names) {
  const norm = names.map((n) => String(n ?? '').trim()).filter(Boolean);
  if (!norm.length) return [];
  const placeholders = norm.map(() => '?').join(',');
  const [rows] = await pool.query(`SELECT name FROM ${table} WHERE LOWER(TRIM(name)) IN (${placeholders})`, norm.map((n) => n.toLowerCase()));
  return (rows || []).map((r) => normalizeKey(r.name));
}

// Firms
app.get('/api/masters/firms/template', async (_req, res) => {
  csvTemplateResponse(res, 'firms-template.csv', 'name,sortName,cin,gstNumber,address,phone,logoUrl,termsConditions');
});
app.post('/api/masters/firms/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'firms', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate firm names found', duplicates: dupAll });

    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      await pool.query(
        `
        INSERT INTO firms (id, name, sort_name, cin, gst_number, address, phone, logo_url, terms_conditions, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [
          crypto.randomUUID(),
          name,
          r.sortName != null ? String(r.sortName).trim() || null : null,
          r.cin != null ? String(r.cin).trim() || null : null,
          r.gstNumber != null ? String(r.gstNumber).trim() || null : null,
          r.address != null ? String(r.address).trim() || null : null,
          r.phone != null ? String(r.phone).trim() || null : null,
          r.logoUrl != null ? String(r.logoUrl).trim() || null : null,
          r.termsConditions != null ? String(r.termsConditions).trim() || null : null,
        ]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Departments
app.get('/api/masters/departments/template', async (_req, res) => {
  csvTemplateResponse(res, 'departments-template.csv', 'name');
});
app.post('/api/masters/departments/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'departments', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate department names found', duplicates: dupAll });
    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      await pool.query('INSERT INTO departments (id, name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [crypto.randomUUID(), name]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/masters/items/:id/opening-balances', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    const [rows] = await pool.query(
      `
      SELECT
        iob.store_id AS storeId,
        st.name AS storeName,
        iob.year AS year,
        iob.quantity AS quantity
      FROM item_opening_balances iob
      LEFT JOIN stores st ON st.id = iob.store_id
      WHERE iob.item_id = ?
      ORDER BY st.name, iob.year
      `,
      [id]
    );
    res.json({
      balances: (Array.isArray(rows) ? rows : []).map((r) => ({
        storeId: String(r.storeId ?? ''),
        storeName: String(r.storeName ?? ''),
        year: String(r.year ?? ''),
        quantity: Number(r.quantity ?? 0),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// States
app.get('/api/masters/states/template', async (_req, res) => {
  csvTemplateResponse(res, 'states-template.csv', 'name');
});
app.post('/api/masters/states/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await ensureGeoMastersTables(pool);
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'states', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate state names found', duplicates: dupAll });
    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      await pool.query('INSERT INTO states (id, name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [crypto.randomUUID(), name]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Cities
app.get('/api/masters/cities/template', async (_req, res) => {
  csvTemplateResponse(res, 'cities-template.csv', 'state,name');
});
app.post('/api/masters/cities/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await ensureGeoMastersTables(pool);
    const rows = requireRows(req.body);

    const pairs = rows
      .map((r) => ({
        state: String(r.state ?? '').trim(),
        name: String(r.name ?? '').trim(),
      }))
      .filter((r) => r.state && r.name);

    const pairKeys = pairs.map((r) => `${normalizeKey(r.state)}||${normalizeKey(r.name)}`);
    const dupInFile = findDuplicates(pairKeys);
    if (dupInFile.length) return res.status(409).json({ error: 'Duplicate city/state combinations found in file', duplicates: dupInFile });

    if (pairs.length) {
      const [existingRows] = await pool.query('SELECT state_name AS state, name FROM cities');
      const existingSet = new Set(
        (Array.isArray(existingRows) ? existingRows : []).map((r) => `${normalizeKey(r.state)}||${normalizeKey(r.name)}`)
      );
      const dupExisting = pairKeys.filter((k) => existingSet.has(k));
      if (dupExisting.length) {
        return res.status(409).json({ error: 'Duplicate city/state combinations found', duplicates: Array.from(new Set(dupExisting)) });
      }
    }

    for (const r of pairs) {
      await pool.query('INSERT INTO cities (id, state_name, name, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [
        crypto.randomUUID(),
        r.state,
        r.name,
      ]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Units
app.get('/api/masters/units/template', async (_req, res) => {
  csvTemplateResponse(res, 'units-template.csv', 'name');
});
app.post('/api/masters/units/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'units', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate unit names found', duplicates: dupAll });
    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      await pool.query('INSERT INTO units (id, name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [crypto.randomUUID(), name]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Priorities
app.get('/api/masters/priorities/template', async (_req, res) => {
  csvTemplateResponse(res, 'priorities-template.csv', 'name');
});
app.post('/api/masters/priorities/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'priorities', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate priority names found', duplicates: dupAll });
    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      await pool.query('INSERT INTO priorities (id, name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [crypto.randomUUID(), name]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Item Categories
app.get('/api/masters/item-categories/template', async (_req, res) => {
  csvTemplateResponse(res, 'item-categories-template.csv', 'name');
});
app.post('/api/masters/item-categories/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'item_categories', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate item category names found', duplicates: dupAll });
    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      await pool.query('INSERT INTO item_categories (id, name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [crypto.randomUUID(), name]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Specifications
app.get('/api/masters/specifications/template', async (_req, res) => {
  csvTemplateResponse(res, 'specifications-template.csv', 'name');
});
app.post('/api/masters/specifications/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'specifications', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate specification names found', duplicates: dupAll });
    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      await pool.query('INSERT INTO specifications (id, name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [crypto.randomUUID(), name]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Suppliers
app.get('/api/masters/suppliers/template', async (_req, res) => {
  csvTemplateResponse(
    res,
    'suppliers-template.csv',
    'name,gstNumber,gstType,creditVoucherApplicable,address,phone,bank,accountNumber,ifscCode,mobile2,email,contactPerson,contactPersonMobile,city,state,paymentTerms,defaultCreditDays,isVendor,catalogueLink'
  );
});
app.post('/api/masters/suppliers/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'suppliers', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate supplier names found', duplicates: dupAll });

    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      const gstTypeRaw = r.gstType != null ? String(r.gstType).trim() : '';
      const gstType = gstTypeRaw === 'Intra-State' || gstTypeRaw === 'Inter-State' ? gstTypeRaw : null;
      const cvApplicableRaw = String(r.creditVoucherApplicable ?? '').trim().toLowerCase();
      const creditVoucherApplicable = cvApplicableRaw === 'yes' || cvApplicableRaw === '1' || cvApplicableRaw === 'true' ? 1 : 0;
      const isVendorRaw = String(r.isVendor ?? '').trim().toLowerCase();
      const isVendor = isVendorRaw === 'yes' || isVendorRaw === '1' || isVendorRaw === 'true' ? 1 : 0;

      await pool.query(
        `
        INSERT INTO suppliers (
          id, name, gst_number, gst_type, credit_voucher_applicable, address, phone, bank, account_number, ifsc_code, mobile_2, email,
	          contact_person, contact_person_mobile, city, state, payment_terms, default_credit_days,
          is_vendor, catalogue_link, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [
          crypto.randomUUID(),
          name,
          r.gstNumber != null ? String(r.gstNumber).trim() || null : null,
          gstType,
          creditVoucherApplicable,
          r.address != null ? String(r.address).trim() || null : null,
	          r.phone != null ? String(r.phone).trim() || null : null,
            r.bank != null ? String(r.bank).trim() || null : null,
            r.accountNumber != null ? String(r.accountNumber).trim() || null : null,
            r.ifscCode != null ? String(r.ifscCode).trim().toUpperCase() || null : null,
	          r.mobile2 != null ? String(r.mobile2).trim() || null : null,
          r.email != null ? String(r.email).trim() || null : null,
          r.contactPerson != null ? String(r.contactPerson).trim() || null : null,
          r.contactPersonMobile != null ? String(r.contactPersonMobile).trim() || null : null,
          r.city != null ? String(r.city).trim() || null : null,
          r.state != null ? String(r.state).trim() || null : null,
          r.paymentTerms != null ? String(r.paymentTerms).trim() || null : null,
          r.defaultCreditDays != null ? Number(r.defaultCreditDays) || null : null,
          isVendor,
          r.catalogueLink != null ? String(r.catalogueLink).trim() || null : null,
        ]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Customers
app.get('/api/masters/customers/template', async (_req, res) => {
  csvTemplateResponse(res, 'customers-template.csv', 'name,categoryName,subCategoryName,city,state,contactPerson,contactNumber,emailId');
});
app.post('/api/masters/customers/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'customers', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate customer names found', duplicates: dupAll });

    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      await pool.query(
        `INSERT INTO customers (id, name, phone, address, category_name, sub_category_name, city, state, contact_person, contact_number, email_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          crypto.randomUUID(),
          name,
          r.phone != null ? String(r.phone).trim() || null : null,
          r.address != null ? String(r.address).trim() || null : null,
          r.categoryName != null ? String(r.categoryName).trim() || null : null,
          r.subCategoryName != null ? String(r.subCategoryName).trim() || null : null,
          r.city != null ? String(r.city).trim() || null : null,
          r.state != null ? String(r.state).trim() || null : null,
          r.contactPerson != null ? String(r.contactPerson).trim() || null : null,
          r.contactNumber != null ? String(r.contactNumber).trim() || null : null,
          r.emailId != null ? String(r.emailId).trim() || null : null,
        ]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Transporters
app.get('/api/masters/transporters/template', async (_req, res) => {
  csvTemplateResponse(res, 'transporters-template.csv', 'name,phone');
});
app.post('/api/masters/transporters/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'transporters', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate transporter names found', duplicates: dupAll });

    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      await pool.query('INSERT INTO transporters (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [
        crypto.randomUUID(),
        name,
        r.phone != null ? String(r.phone).trim() || null : null,
      ]);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Users
app.get('/api/masters/users/template', async (_req, res) => {
  csvTemplateResponse(res, 'users-template.csv', 'name,designation,email,mobile');
});
app.post('/api/masters/users/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const emails = rows.map((r) => String(r.email ?? '').trim()).filter(Boolean);
    const dupEmailInFile = findDuplicates(emails);

    let existingEmail = [];
    if (emails.length) {
      const placeholders = emails.map(() => '?').join(',');
      const [found] = await pool.query(`SELECT email FROM users WHERE LOWER(TRIM(email)) IN (${placeholders})`, emails.map((e) => e.toLowerCase()));
      existingEmail = (found || []).map((r) => normalizeKey(r.email));
    }

    const dupAll = Array.from(new Set([...dupEmailInFile, ...existingEmail]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate user emails found', duplicates: dupAll });

    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      const designation = String(r.designation ?? '').trim();
      if (!name || !designation) continue;
      const email = r.email != null ? String(r.email).trim() || null : null;
      const mobile = r.mobile != null ? String(r.mobile).trim() || null : null;
      await pool.query(
        `
        INSERT INTO users (id, name, designation, email, mobile, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, NOW(), NOW())
        `,
        [crypto.randomUUID(), name, designation, email, mobile]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Projects
app.get('/api/masters/projects/template', async (_req, res) => {
  csvTemplateResponse(res, 'projects-template.csv', 'firmName,name,clientName,startDate,endDate,status');
});
app.post('/api/masters/projects/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);

    const [firmRows] = await pool.query('SELECT id, name FROM firms');
    const firmIdByName = new Map((firmRows || []).map((f) => [normalizeKey(f.name), String(f.id)]));

    const pairs = rows
      .map((r) => {
        const firmName = String(r.firmName ?? '').trim();
        const name = String(r.name ?? '').trim();
        return { firmName, name };
      })
      .filter((p) => p.firmName && p.name);

    const dupInFile = findDuplicates(pairs.map((p) => `${normalizeKey(p.firmName)}::${normalizeKey(p.name)}`));

    // Existing duplicates
    let existingPairs = [];
    if (pairs.length) {
      const firmIds = Array.from(new Set(pairs.map((p) => firmIdByName.get(normalizeKey(p.firmName))).filter(Boolean)));
      if (firmIds.length) {
        const placeholders = firmIds.map(() => '?').join(',');
        const [projRows] = await pool.query(`SELECT firm_id AS firmId, name FROM projects WHERE firm_id IN (${placeholders})`, firmIds);
        const existingSet = new Set((projRows || []).map((p) => `${String(p.firmId)}::${normalizeKey(p.name)}`));
        existingPairs = pairs
          .map((p) => {
            const firmId = firmIdByName.get(normalizeKey(p.firmName));
            return firmId ? `${firmId}::${normalizeKey(p.name)}` : '';
          })
          .filter((k) => k && existingSet.has(k));
      }
    }

    const dupAll = Array.from(new Set([...dupInFile, ...existingPairs]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate projects found (firm+name)', duplicates: dupAll });

    const unknownFirms = Array.from(new Set(pairs.map((p) => normalizeKey(p.firmName)).filter((k) => !firmIdByName.has(k))));
    if (unknownFirms.length) return res.status(400).json({ error: 'Unknown firm names in template', unknownFirms });

    for (const r of rows) {
      const firmName = String(r.firmName ?? '').trim();
      const name = String(r.name ?? '').trim();
      if (!firmName || !name) continue;
      const firmId = firmIdByName.get(normalizeKey(firmName));
      if (!firmId) continue;
      const clientName = r.clientName != null ? String(r.clientName).trim() || null : null;
      const startDate = r.startDate != null ? String(r.startDate).trim() || null : null;
      const endDate = r.endDate != null ? String(r.endDate).trim() || null : null;
      const status = r.status != null ? String(r.status).trim() || null : null;
      await pool.query(
        `
        INSERT INTO projects (id, firm_id, name, client_name, start_date, end_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [crypto.randomUUID(), firmId, name, clientName, startDate, endDate, status]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Stores
app.get('/api/masters/stores/template', async (_req, res) => {
  csvTemplateResponse(res, 'stores-template.csv', 'firmName,name,location');
});
app.post('/api/masters/stores/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);

    const [firmRows] = await pool.query('SELECT id, name FROM firms');
    const firmIdByName = new Map((firmRows || []).map((f) => [normalizeKey(f.name), String(f.id)]));

    const pairs = rows
      .map((r) => ({ firmName: String(r.firmName ?? '').trim(), name: String(r.name ?? '').trim() }))
      .filter((p) => p.firmName && p.name);

    const dupInFile = findDuplicates(pairs.map((p) => `${normalizeKey(p.firmName)}::${normalizeKey(p.name)}`));

    const unknownFirms = Array.from(new Set(pairs.map((p) => normalizeKey(p.firmName)).filter((k) => !firmIdByName.has(k))));
    if (unknownFirms.length) return res.status(400).json({ error: 'Unknown firm names in template', unknownFirms });

    // Existing duplicates by firm+name
    let existingPairs = [];
    if (pairs.length) {
      const firmIds = Array.from(new Set(pairs.map((p) => firmIdByName.get(normalizeKey(p.firmName))).filter(Boolean)));
      if (firmIds.length) {
        const placeholders = firmIds.map(() => '?').join(',');
        const [storeRows] = await pool.query(`SELECT firm_id AS firmId, name FROM stores WHERE firm_id IN (${placeholders})`, firmIds);
        const existingSet = new Set((storeRows || []).map((s) => `${String(s.firmId)}::${normalizeKey(s.name)}`));
        existingPairs = pairs
          .map((p) => {
            const firmId = firmIdByName.get(normalizeKey(p.firmName));
            return firmId ? `${firmId}::${normalizeKey(p.name)}` : '';
          })
          .filter((k) => k && existingSet.has(k));
      }
    }

    const dupAll = Array.from(new Set([...dupInFile, ...existingPairs]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate stores found (firm+name)', duplicates: dupAll });

    for (const r of rows) {
      const firmName = String(r.firmName ?? '').trim();
      const name = String(r.name ?? '').trim();
      if (!firmName || !name) continue;
      const firmId = firmIdByName.get(normalizeKey(firmName));
      if (!firmId) continue;
      const location = r.location != null ? String(r.location).trim() || null : null;
      await pool.query('INSERT INTO stores (id, firm_id, name, location, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())', [
        crypto.randomUUID(),
        firmId,
        name,
        location,
      ]);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Item Names
app.get('/api/masters/item-names/template', async (_req, res) => {
  csvTemplateResponse(res, 'item-names-template.csv', 'name,unitName,itemCategoryName');
});
app.post('/api/masters/item-names/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);
    const names = rows.map((r) => String(r.name ?? '').trim()).filter(Boolean);
    const dupInFile = findDuplicates(names);
    const existing = await selectExistingNames(pool, 'item_names', names);
    const dupAll = Array.from(new Set([...dupInFile, ...existing]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate item name values found', duplicates: dupAll });

    const [unitRows] = await pool.query('SELECT id, name FROM units');
    const unitIdByName = new Map((unitRows || []).map((u) => [normalizeKey(u.name), String(u.id)]));
    const [catRows] = await pool.query('SELECT id, name FROM item_categories');
    const catIdByName = new Map((catRows || []).map((c) => [normalizeKey(c.name), String(c.id)]));

    const unknownUnits = new Set();
    const unknownCats = new Set();
    for (const r of rows) {
      const unitName = String(r.unitName ?? '').trim();
      const catName = String(r.itemCategoryName ?? '').trim();
      if (unitName && !unitIdByName.has(normalizeKey(unitName))) unknownUnits.add(unitName);
      if (catName && !catIdByName.has(normalizeKey(catName))) unknownCats.add(catName);
    }
    if (unknownUnits.size || unknownCats.size) {
      return res.status(400).json({ error: 'Unknown unit or item category names', unknownUnits: Array.from(unknownUnits), unknownItemCategories: Array.from(unknownCats) });
    }

    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      const unitName = String(r.unitName ?? '').trim();
      const catName = String(r.itemCategoryName ?? '').trim();
      const unitId = unitName ? unitIdByName.get(normalizeKey(unitName)) : null;
      const catId = catName ? catIdByName.get(normalizeKey(catName)) : null;
      await pool.query(
        'INSERT INTO item_names (id, name, unit_id, item_category_id, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
        [crypto.randomUUID(), name, unitId ?? null, catId ?? null]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Specification Values
app.get('/api/masters/specification-values/template', async (_req, res) => {
  csvTemplateResponse(res, 'spec-values-template.csv', 'specificationName,value,isActive');
});
app.post('/api/masters/specification-values/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);

    const [specRows] = await pool.query('SELECT id, name FROM specifications');
    const specIdByName = new Map((specRows || []).map((s) => [normalizeKey(s.name), String(s.id)]));

    const pairs = rows
      .map((r) => ({ specName: String(r.specificationName ?? '').trim(), value: String(r.value ?? '').trim() }))
      .filter((p) => p.specName && p.value);

    const unknownSpecs = Array.from(new Set(pairs.map((p) => normalizeKey(p.specName)).filter((k) => !specIdByName.has(k))));
    if (unknownSpecs.length) return res.status(400).json({ error: 'Unknown specification names', unknownSpecifications: unknownSpecs });

    const dupInFile = findDuplicates(pairs.map((p) => `${normalizeKey(p.specName)}::${normalizeKey(p.value)}`));

    // Existing duplicates
    let existingPairs = [];
    if (pairs.length) {
      const specIds = Array.from(new Set(pairs.map((p) => specIdByName.get(normalizeKey(p.specName))).filter(Boolean)));
      if (specIds.length) {
        const placeholders = specIds.map(() => '?').join(',');
        const [valRows] = await pool.query(
          `SELECT specification_id AS specificationId, value FROM specification_values WHERE specification_id IN (${placeholders})`,
          specIds
        );
        const existingSet = new Set((valRows || []).map((v) => `${String(v.specificationId)}::${normalizeKey(v.value)}`));
        existingPairs = pairs
          .map((p) => {
            const specId = specIdByName.get(normalizeKey(p.specName));
            return specId ? `${specId}::${normalizeKey(p.value)}` : '';
          })
          .filter((k) => k && existingSet.has(k));
      }
    }

    const dupAll = Array.from(new Set([...dupInFile, ...existingPairs]));
    if (dupAll.length) return res.status(409).json({ error: 'Duplicate specification values found', duplicates: dupAll });

    for (const r of rows) {
      const specName = String(r.specificationName ?? '').trim();
      const value = String(r.value ?? '').trim();
      if (!specName || !value) continue;
      const specId = specIdByName.get(normalizeKey(specName));
      if (!specId) continue;
      const isActiveRaw = String(r.isActive ?? 'true').trim().toLowerCase();
      const isActive = !(isActiveRaw === '0' || isActiveRaw === 'false' || isActiveRaw === 'no');
      await pool.query(
        'INSERT INTO specification_values (id, specification_id, value, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
        [crypto.randomUUID(), specId, value, isActive ? 1 : 0]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Items
app.get('/api/masters/items/template', async (_req, res) => {
  csvTemplateResponse(res, 'items-template.csv', 'itemName,unit,description,specs,Re-Order Level,Rate');
});
app.post('/api/masters/items/import', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = requireRows(req.body);

    const [itemNameRows] = await pool.query('SELECT id, name FROM item_names');
    const itemNameIdByName = new Map((itemNameRows || []).map((n) => [normalizeKey(n.name), String(n.id)]));
    const [specRows] = await pool.query('SELECT id, name FROM specifications');
    const specIdByName = new Map((specRows || []).map((s) => [normalizeKey(s.name), String(s.id)]));

    const unknownItemNames = new Set();
    const unknownSpecs = new Set();

    const normalized = rows
      .map((r) => {
        const itemName = String(r.itemName ?? '').trim();
        const unit = r.unit != null ? String(r.unit).trim() : '';
        const description = r.description != null ? String(r.description).trim() : '';
        const reorderRaw = r['Re-Order Level'] ?? r.reorderLevel ?? r.reorder_level ?? '';
        const reorderLevel = String(reorderRaw ?? '').trim();
        const rateRaw = r.Rate ?? r.rate ?? r.itemRate ?? r.item_rate ?? '';
        const rate = String(rateRaw ?? '').trim();
        const specsRaw = String(r.specs ?? '').trim();
        const specs = [];
        if (specsRaw) {
          for (const part of specsRaw.split(';').map((p) => p.trim()).filter(Boolean)) {
            const [k, ...rest] = part.split('=');
            const specName = String(k ?? '').trim();
            const value = rest.join('=').trim();
            if (!specName || !value) continue;
            const specId = specIdByName.get(normalizeKey(specName));
            if (!specId) unknownSpecs.add(specName);
            specs.push({ specName, specId: specId || null, value });
          }
        }
        const itemNameId = itemNameIdByName.get(normalizeKey(itemName)) || null;
        if (itemName && !itemNameId) unknownItemNames.add(itemName);
        return { itemName, itemNameId, unit, description, reorderLevel, rate, specs };
      })
      .filter((r) => r.itemName);

    if (unknownItemNames.size) return res.status(400).json({ error: 'Unknown item names', unknownItemNames: Array.from(unknownItemNames) });
    if (unknownSpecs.size) return res.status(400).json({ error: 'Unknown specifications', unknownSpecifications: Array.from(unknownSpecs) });

    // Compute uniqueKey for duplicates check
    const uniqueKeys = normalized.map((r) => {
      const specsObj = Object.fromEntries((r.specs || []).filter((s) => s.specId).map((s) => [String(s.specId), String(s.value)]));
      const specificationsJson = JSON.stringify(specsObj);
      return `${r.itemNameId}:${sha256(specificationsJson).slice(0, 16)}`;
    });

    const dupInFile = findDuplicates(uniqueKeys);
    if (dupInFile.length) return res.status(409).json({ error: 'Duplicate items found in upload (same name+specs)', duplicates: dupInFile });

    let existing = [];
    if (uniqueKeys.length) {
      const placeholders = uniqueKeys.map(() => '?').join(',');
      const [found] = await pool.query(`SELECT unique_key AS uniqueKey FROM items WHERE unique_key IN (${placeholders})`, uniqueKeys);
      existing = (found || []).map((r) => String(r.uniqueKey));
    }
    if (existing.length) return res.status(409).json({ error: 'Duplicate items already exist (unique key)', duplicates: existing });

    for (let i = 0; i < normalized.length; i++) {
      const r = normalized[i];
      const itemNameId = r.itemNameId;
      if (!itemNameId) continue;
      const id = crypto.randomUUID();
      const itemCode = `IT-${id.slice(0, 8).toUpperCase()}`;
      const specsObj = Object.fromEntries((r.specs || []).filter((s) => s.specId).map((s) => [String(s.specId), String(s.value)]));
      const specificationsJson = JSON.stringify(specsObj);
      const uniqueKey = `${itemNameId}:${sha256(specificationsJson).slice(0, 16)}`;
      const parsedReorderLevel = r.reorderLevel ? Number(r.reorderLevel) : null;
      const parsedRate = r.rate ? Number(r.rate) : 0;
      await pool.query(
        'INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, reorder_level, rate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [
          id,
          itemNameId,
          itemCode,
          specificationsJson,
          uniqueKey,
          r.description || null,
          r.unit || null,
          Number.isFinite(parsedReorderLevel) ? Math.max(0, parsedReorderLevel) : null,
          Number.isFinite(parsedRate) ? Math.max(0, parsedRate) : 0,
        ]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Dashboard helpers ---
app.get('/api/dashboard/activity', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const day = String(req.query?.date ?? '').trim(); // YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });

    const dayStart = `${day} 00:00:00`;
    const nextDayDate = new Date(`${day}T00:00:00`);
    nextDayDate.setDate(nextDayDate.getDate() + 1);
    const nextDay = `${nextDayDate.getFullYear()}-${String(nextDayDate.getMonth() + 1).padStart(2, '0')}-${String(nextDayDate.getDate()).padStart(2, '0')}`;
    const nextDayStart = `${nextDay} 00:00:00`;

    const countByDay = async (table, field = 'created_at', extraWhere = '', extraParams = []) => {
      const sql = `SELECT COUNT(*) AS c FROM ${table} WHERE ${field} >= ? AND ${field} < ? ${extraWhere}`;
      const [rows] = await pool.query(sql, [dayStart, nextDayStart, ...extraParams]);
      return Number(rows?.[0]?.c ?? 0);
    };

    const countByDateField = async (table, field, extraWhere = '', extraParams = []) => {
      const sql = `SELECT COUNT(*) AS c FROM ${table} WHERE ${field} = ? ${extraWhere}`;
      const [rows] = await pool.query(sql, [day, ...extraParams]);
      return Number(rows?.[0]?.c ?? 0);
    };

    const [
      firms,
      stores,
      departments,
      users,
      suppliers,
      customers,
      transporters,
      projects,
      units,
      itemCategories,
      itemNames,
      specifications,
      specificationValues,
      items,
      prs,
      pos,
      grns,
      invoices,
      issues,
      returns,
      damages,
      transfers,
    ] = await Promise.all([
      countByDay('firms'),
      countByDay('stores'),
      countByDay('departments'),
      countByDay('users'),
      countByDay('suppliers'),
      countByDay('customers'),
      countByDay('transporters'),
      countByDay('projects'),
      countByDay('units'),
      countByDay('item_categories'),
      countByDay('item_names'),
      countByDay('specifications'),
      countByDay('specification_values'),
      countByDay('items'),
      countByDay('purchase_requisitions'),
      countByDay('purchase_orders'),
      countByDay('grns'),
      countByDay('invoices'),
      countByDay('item_issues'),
      countByDay('item_returns'),
      countByDay('item_damages'),
      countByDay('item_transfers'),
    ]);

    // Count actual payment entries by payment_date rather than generic invoice updates.
    const payments = await countByDateField('invoices', 'payment_date', 'AND payment_status IS NOT NULL AND TRIM(payment_status) <> ""');

    const mastersBreakdown = {
      firms,
      stores,
      departments,
      users,
      suppliers,
      customers,
      transporters,
      projects,
      units,
      itemCategories,
      itemNames,
      specifications,
      specificationValues,
      items,
    };
    const masters = Object.values(mastersBreakdown).reduce((sum, count) => sum + Number(count ?? 0), 0);

    const operationsBreakdown = {
      prs,
      pos,
      grns,
      invoices,
      payments,
      issues,
      returns,
      damages,
      transfers,
    };
    const operations = Object.values(operationsBreakdown).reduce((sum, count) => sum + Number(count ?? 0), 0);

    const total = masters + operations;

    res.json({
      counts: {
        masters,
        operations,
        total,
        mastersBreakdown,
        operationsBreakdown,
      },
    });
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

function normalizeAreaUnitName(unitName) {
  const u = String(unitName ?? '').trim().toLowerCase();
  if (!u) return null;
  if (u === 'sq ft' || u === 'sqft' || u === 'sq. ft' || u === 'sqft.' || u === 'sq feet') return 'sqft';
  if (u === 'sq mtr' || u === 'sq mtrs' || u === 'sqmtr' || u === 'sq. mtr' || u === 'sq meter' || u === 'sq metre' || u === 'sq m' || u === 'sqm')
    return 'sqm';
  return null;
}

function baseDimUnitForAreaUnit(areaUnit) {
  if (areaUnit === 'sqft') return 'ft';
  if (areaUnit === 'sqm') return 'm';
  return null;
}

function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return NaN;
  return Math.round(x * 1000) / 1000;
}

function computeAreaQty(length, breadth, pcs) {
  const l = round2(length);
  const b = round2(breadth);
  const p = Math.trunc(Number(pcs));
  if (!Number.isFinite(l) || l <= 0) return NaN;
  if (!Number.isFinite(b) || b <= 0) return NaN;
  if (!Number.isFinite(p) || p < 1) return NaN;
  return l * b * p;
}

function convertAreaQty(qty, fromDimUnit, toDimUnit) {
  const q = Number(qty);
  const fromU = String(fromDimUnit ?? '').trim().toLowerCase();
  const toU = String(toDimUnit ?? '').trim().toLowerCase();
  if (!Number.isFinite(q)) return NaN;
  if (!fromU || !toU || fromU === toU) return q;
  // Convert area units via m² <-> ft²
  const M2_TO_FT2 = 10.7639104167;
  if (fromU === 'm' && toU === 'ft') return q * M2_TO_FT2;
  if (fromU === 'ft' && toU === 'm') return q / M2_TO_FT2;
  return NaN;
}

// --- Stock Transactions (Issues, Returns, Damages, Transfers) ---

async function getNextTransactionNo(pool, table, prefix) {
  const [rows] = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
  const count = rows[0].count + 1;
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${date}-${String(count).padStart(4, '0')}`;
}

async function getProjectReturnBalances(pool, projectId) {
  const normalizedProjectId = String(projectId ?? '').trim();
  if (!normalizedProjectId) return [];

  const [issueRows] = await pool.query(
    `SELECT ii.item_id AS itemId, SUM(ii.quantity) AS quantity
     FROM item_issue_items ii
     INNER JOIN item_issues i ON i.id = ii.issue_id
     WHERE i.issue_type = 'Project' AND i.project_id = ?
     GROUP BY ii.item_id`,
    [normalizedProjectId]
  );
  const [returnRows] = await pool.query(
    `SELECT ri.item_id AS itemId, SUM(ri.quantity) AS quantity
     FROM item_return_items ri
     INNER JOIN item_returns r ON r.id = ri.return_id
     WHERE r.return_type = 'Project' AND r.project_id = ?
     GROUP BY ri.item_id`,
    [normalizedProjectId]
  );

  const returnedByItem = new Map(
    (Array.isArray(returnRows) ? returnRows : []).map((row) => [String(row.itemId ?? '').trim(), Number(row.quantity) || 0])
  );
  return (Array.isArray(issueRows) ? issueRows : [])
    .map((row) => {
      const itemId = String(row.itemId ?? '').trim();
      const issuedQuantity = Number(row.quantity) || 0;
      const returnedQuantity = returnedByItem.get(itemId) || 0;
      return { itemId, issuedQuantity, returnedQuantity, balance: Math.max(0, issuedQuantity - returnedQuantity) };
    })
    .filter((row) => row.itemId && row.balance > 0);
}

async function handleListTransactions(req, res, table, itemsTable, kind) {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const isIssue = table === 'item_issues';
    const isTransfer = table === 'item_transfers';
    const query = isTransfer
      ? `
        SELECT t.*,
               fs.name AS store_name,
               ts.name AS to_store_name,
               NULL AS material_request_no
        FROM ${table} t
        LEFT JOIN stores fs ON fs.id = t.from_store_id
        LEFT JOIN stores ts ON ts.id = t.to_store_id
        ORDER BY t.created_at DESC
      `
      : isIssue
        ? `
          SELECT t.*,
                 mr.request_no AS material_request_no,
                 s.name AS store_name
          FROM ${table} t
          LEFT JOIN material_requests mr ON mr.id = t.material_request_id
          LEFT JOIN stores s ON s.id = t.store_id
          ORDER BY t.created_at DESC
        `
        : `
          SELECT t.*,
                 NULL AS material_request_no,
                 s.name AS store_name,
                 p.name AS project_name
          FROM ${table} t
          LEFT JOIN stores s ON s.id = t.store_id
          LEFT JOIN projects p ON p.id = t.project_id
          ORDER BY t.created_at DESC
        `;

    const [rows] = await pool.query(query);

    const [specRows] = await pool.query('SELECT id, name FROM specifications');
    const specNameById = new Map(
      (Array.isArray(specRows) ? specRows : []).map((r) => [String(r.id ?? '').trim(), String(r.name ?? '').trim()])
    );
    const formatSpecsLabel = (specificationsJson) => {
      const raw = String(specificationsJson ?? '').trim();
      if (!raw) return '';
      try {
        const obj = JSON.parse(raw) || {};
        if (!obj || typeof obj !== 'object') return '';
        const parts = [];
        for (const [specId, v] of Object.entries(obj)) {
          const sid = String(specId ?? '').trim();
          const sval = String(v ?? '').trim();
          if (!sid || !sval) continue;
          const specName = specNameById.get(sid) || sid;
          parts.push(`${specName}: ${sval}`);
        }
        return parts.join(' - ');
      } catch {
        return raw
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .join(' - ');
      }
    };
    const transactions = [];

    for (const row of Array.isArray(rows) ? rows : []) {
      const [itemRows] = await pool.query(
        `
        SELECT itx.*, iname.name AS itemName, it.specifications_json AS specificationsJson
        FROM ${itemsTable} itx
        LEFT JOIN items it ON it.id = itx.item_id
        LEFT JOIN item_names iname ON iname.id = it.item_name_id
        WHERE itx.${kind}_id = ?
        `,
        [row.id]
      );
      transactions.push({
        id: row.id,
        transactionNo: row.transaction_no || row.id,
        firmId: row.firm_id,
        storeId: row.store_id || row.from_store_id,
        store: row.store_name || row.store_id || row.from_store_id || row.store,
        department: row.department,
        person: row.person || row.requested_by,
        date: toIsoDate(row.date) || toIsoDate(row.created_at),
        issueType: row.issue_type === 'Internal Used' ? 'Internal Use' : row.issue_type,
        issuedTo: row.issued_to,
        returnType: row.return_type,
        customerName: row.customer_name,
        approvedBy: row.approved_by,
        toFirmId: row.to_firm_id,
        toStore: row.to_store_name || row.to_store_id || row.to_store,
        toDepartment: row.to_department,
        projectId: row.project_id,
        projectName: row.project_name,
        returnBy: row.return_by,
        materialRequestId: row.material_request_id,
        materialRequestNo: row.material_request_no,
        items: (Array.isArray(itemRows) ? itemRows : []).map(it => ({
          itemId: it.item_id,
          item: (() => {
            const name = String(it.itemName ?? '').trim() || String(it.item_id ?? '').trim();
            const specText = formatSpecsLabel(it.specificationsJson);
            return [name, specText].filter(Boolean).join(' - ');
          })(),
          quantity: it.quantity,
          specification: it.specification,
          remark: it.remark
        }))
      });
    }

    res.json({ [table.includes('issue') ? 'issues' : table.includes('return') ? 'returns' : table.includes('damage') ? 'damages' : 'transfers']: transactions });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleCreateTransaction(req, res, table, itemsTable, kind, prefix) {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const id = crypto.randomUUID();
    const transactionNo = await getNextTransactionNo(pool, table, prefix);
    const data = req.body;

    if (table === 'item_returns' && !String(data.returnBy ?? '').trim()) {
      return res.status(400).json({ error: 'Return By is required.' });
    }
    if (table === 'item_returns' && !String(data.person ?? '').trim()) {
      return res.status(400).json({ error: 'Received By is required.' });
    }
    if (table === 'item_returns' && data.returnType === 'Project') {
      const projectId = String(data.projectId ?? '').trim();
      if (!projectId) return res.status(400).json({ error: 'Project Name is required.' });
      const balances = await getProjectReturnBalances(pool, projectId);
      if (!balances.length) return res.status(400).json({ error: 'No items for Return' });
      const balanceByItem = new Map(balances.map((row) => [row.itemId, row.balance]));
      const requestedByItem = new Map();
      for (const item of Array.isArray(data.items) ? data.items : []) {
        const itemId = String(item?.itemId ?? '').trim();
        const quantity = Number(item?.quantity) || 0;
        requestedByItem.set(itemId, (requestedByItem.get(itemId) || 0) + quantity);
      }
      if (!requestedByItem.size) return res.status(400).json({ error: 'No items for Return' });
      for (const [itemId, quantity] of requestedByItem) {
        const balance = balanceByItem.get(itemId) || 0;
        if (!itemId || quantity <= 0 || quantity > balance) {
          return res.status(400).json({ error: `Return quantity exceeds available project balance (${balance}).` });
        }
      }
    }

    if (table === 'item_issues') {
      const issueType = String(data.issueType ?? '').trim();
      const department = String(data.department ?? '').trim();
      if (issueType === 'Internal Use' && !department) {
        return res.status(400).json({ error: 'Department is required for Internal Use issues.' });
      }
    }

    const storeId = data.storeId || data.store;
    const toStoreId = data.toStoreId || data.toStore;

    let storeCol = 'store';
    if (table === 'item_issues' || table === 'item_returns' || table === 'item_damages') {
      storeCol = 'store_id';
    } else if (table === 'item_transfers') {
      storeCol = 'from_store_id';
    }

    let toStoreCol = 'to_store';
    if (table === 'item_transfers') {
      toStoreCol = 'to_store_id';
    }

    const materialRequestId = table === 'item_issues' ? (data.materialRequestId || null) : null;

    const cols = [
      'id',
      'transaction_no',
      'firm_id',
      storeCol,
      'department',
      'person',
      'return_by',
      'date',
      'issue_type',
      'issued_to',
      'return_type',
      'customer_name',
      'approved_by',
      'to_firm_id',
      toStoreCol,
      'to_department',
      'project_id',
    ];
    const params = [
      id,
      transactionNo,
      data.firmId,
      storeId,
      data.department,
      data.person,
      data.returnBy,
      data.date,
      data.issueType,
      data.issuedTo,
      data.returnType,
      data.customerName,
      data.approvedBy,
      data.toFirmId,
      toStoreId,
      data.toDepartment,
      data.projectId,
    ];

    // Only "issues" table supports material_request_id in some schemas.
    if (table === 'item_issues') {
      cols.push('material_request_id');
      params.push(materialRequestId);
    }

    await pool.query(
      `INSERT INTO ${table} (${cols.join(', ')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, NOW(), NOW())`,
      params
    );

    const normalizeSpecsObject = (raw) => {
      if (!raw || typeof raw !== 'object') return {};
      const out = {};
      for (const [k, v] of Object.entries(raw)) {
        const sid = String(k ?? '').trim();
        const sval = String(v ?? '').trim();
        if (!sid || !sval) continue;
        out[sid] = sval;
      }
      return out;
    };

    const stableJsonStringify = (obj) => {
      const entries = Object.entries(obj || {}).sort(([a], [b]) => String(a).localeCompare(String(b)));
      return JSON.stringify(Object.fromEntries(entries));
    };

    for (const item of data.items || []) {
      let resolvedItemId = String(item?.itemId ?? '').trim();
      if (!resolvedItemId) {
        const itemNameId = String(item?.itemNameId ?? '').trim();
        const specsObj = normalizeSpecsObject(item?.specs);
        const specIds = Object.keys(specsObj);
        if (!itemNameId || !specIds.length) {
          return res.status(400).json({ error: 'Each item requires itemId (or itemNameId+specs)' });
        }
        const specificationsJson = stableJsonStringify(specsObj);
        const uniqueKey = `${itemNameId}:${sha256(specificationsJson).slice(0, 16)}`;

        const [[found]] = await pool.query('SELECT id FROM items WHERE unique_key=? LIMIT 1', [uniqueKey]);
        if (found?.id) {
          resolvedItemId = String(found.id);
        } else {
          const newId = crypto.randomUUID();
          const itemCode = `IT-${newId.slice(0, 8).toUpperCase()}`;
          const [[meta]] = await pool.query(
            `
            SELECT u.name AS unitName
            FROM item_names n
            LEFT JOIN units u ON u.id = n.unit_id
            WHERE n.id = ?
            LIMIT 1
            `,
            [itemNameId]
          );
          const unitName = meta?.unitName != null ? String(meta.unitName) : null;
          await pool.query(
            `
            INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, reorder_level, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, NOW(), NOW())
            `,
            [newId, itemNameId, itemCode, specificationsJson, uniqueKey, unitName, 'system']
          );
          resolvedItemId = newId;
        }
      }

      await pool.query(
        `INSERT INTO ${itemsTable} (id, ${kind}_id, item_id, quantity, specification, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), id, resolvedItemId, item.quantity, item.specification, item.remark]
      );

      if (materialRequestId) {
        await pool.query(
          `UPDATE material_request_items
           SET issued_quantity = issued_quantity + ?
           WHERE request_id = ? AND item_id = ?`,
          [item.quantity, materialRequestId, resolvedItemId]
        );
      }
    }

    if (materialRequestId) {
      const [remaining] = await pool.query(
        `SELECT SUM(quantity - issued_quantity) as rem
         FROM material_request_items
         WHERE request_id = ?`,
        [materialRequestId]
      );
      if (remaining[0]?.rem <= 0) {
        await pool.query(`UPDATE material_requests SET status = 'Closed' WHERE id = ?`, [materialRequestId]);
      }
    }

    res.json({ id, transactionNo });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

app.get('/api/stock-transactions/issues', (req, res) => handleListTransactions(req, res, 'item_issues', 'item_issue_items', 'issue'));
app.post('/api/stock-transactions/issues', (req, res) => handleCreateTransaction(req, res, 'item_issues', 'item_issue_items', 'issue', 'ISS'));
app.put('/api/stock-transactions/issues/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

    const id = String(req.params.id ?? '').trim();
    const data = req.body ?? {};
    const issueType = String(data.issueType ?? '').trim();
    const department = String(data.department ?? '').trim();
    const projectId = String(data.projectId ?? '').trim();
    const allowedIssueTypes = new Set(['Sales', 'Project', 'Internal Use']);
    if (!allowedIssueTypes.has(issueType)) return res.status(400).json({ error: 'Invalid issue type.' });
    if (issueType === 'Project' && !projectId) return res.status(400).json({ error: 'Project is required for Project-type issues.' });
    if (issueType === 'Internal Use' && !department) {
      return res.status(400).json({ error: 'Department is required for Internal Use issues.' });
    }

    const [[current]] = await pool.query('SELECT id, store_id AS storeId FROM item_issues WHERE id = ? LIMIT 1', [id]);
    if (!current) return res.status(404).json({ error: 'Issue not found.' });
    let storeId = String(data.storeId ?? '').trim();
    if (!storeId && data.store) {
      const [[storeRow]] = await pool.query('SELECT id FROM stores WHERE name = ? AND firm_id = ? LIMIT 1', [String(data.store).trim(), String(data.firmId ?? '').trim()]);
      storeId = String(storeRow?.id ?? '').trim();
    }
    storeId = storeId || String(current.storeId ?? '').trim();

    await pool.query(
      `UPDATE item_issues
       SET firm_id = ?, store_id = ?, department = ?, project_id = ?, person = ?, date = ?, issue_type = ?, issued_to = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        String(data.firmId ?? '').trim(),
        storeId,
        department || null,
        issueType === 'Project' ? projectId : null,
        String(data.person ?? '').trim(),
        data.date,
        issueType,
        String(data.issuedTo ?? '').trim() || null,
        id,
      ]
    );
    res.json({ issue: { ...data, id, storeId, department, projectId: issueType === 'Project' ? projectId : undefined } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
app.delete('/api/stock-transactions/issues/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await pool.query('DELETE FROM item_issues WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stock-transactions/project-return-balances', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const projectId = String(req.query.projectId ?? '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required.' });
    res.json({ balances: await getProjectReturnBalances(pool, projectId) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
app.get('/api/stock-transactions/returns', (req, res) => handleListTransactions(req, res, 'item_returns', 'item_return_items', 'return'));
app.post('/api/stock-transactions/returns', (req, res) => handleCreateTransaction(req, res, 'item_returns', 'item_return_items', 'return', 'RET'));
app.delete('/api/stock-transactions/returns/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await pool.query('DELETE FROM item_returns WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stock-transactions/damages', (req, res) => handleListTransactions(req, res, 'item_damages', 'item_damage_items', 'damage'));
app.post('/api/stock-transactions/damages', (req, res) => handleCreateTransaction(req, res, 'item_damages', 'item_damage_items', 'damage', 'DAM'));
app.delete('/api/stock-transactions/damages/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await pool.query('DELETE FROM item_damages WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stock-transactions/transfers', (req, res) => handleListTransactions(req, res, 'item_transfers', 'item_transfer_items', 'transfer'));
app.post('/api/stock-transactions/transfers', (req, res) => handleCreateTransaction(req, res, 'item_transfers', 'item_transfer_items', 'transfer', 'TRA'));
app.delete('/api/stock-transactions/transfers/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await pool.query('DELETE FROM item_transfers WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Inventory (minimal) ---
app.get('/api/inventory/opening-balances', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const storeId = String(req.query.storeId ?? '').trim();
    const year = String(req.query.year ?? fiscalYearLabel(new Date())).trim() || fiscalYearLabel(new Date());
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
    const year = String(req.body?.year ?? fiscalYearLabel(new Date())).trim() || fiscalYearLabel(new Date());
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
    const year = String(req.query.year ?? fiscalYearLabel(new Date())).trim() || fiscalYearLabel(new Date());
    const includeEmpty = String(req.query.includeEmpty ?? '').trim() === '1' || String(req.query.includeEmpty ?? '').trim().toLowerCase() === 'true';
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
	        it.unit AS unit,
	        it.reorder_level AS reorderLevel,
	        it.opening_stock AS openingStock,
	          it.photo_1 AS photo1,
          it.photo_2 AS photo2,
          it.photo_3 AS photo3,
          it.photo_4 AS photo4,
          it.photo_5 AS photo5,
          it.item_link AS itemLink,
          it.video_link AS videoLink
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
			          reorderLevel: num(r.reorderLevel, 0),
	              openingStock: num(r.openingStock, 0),
              photo1: r.photo1 != null ? String(r.photo1) : '',
              photo2: r.photo2 != null ? String(r.photo2) : '',
              photo3: r.photo3 != null ? String(r.photo3) : '',
              photo4: r.photo4 != null ? String(r.photo4) : '',
              photo5: r.photo5 != null ? String(r.photo5) : '',
              itemLink: r.itemLink != null ? String(r.itemLink) : '',
              videoLink: r.videoLink != null ? String(r.videoLink) : '',
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
          WHERE st.firm_id = ?
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
          WHERE COALESCE(NULLIF(t.to_firm_id, ''), t.firm_id) = ? AND DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?
          UNION
          SELECT t.from_store_id AS storeId, ti.item_id AS itemId
          FROM item_transfers t
          INNER JOIN item_transfer_items ti ON ti.transfer_id = t.id
          WHERE t.firm_id = ? AND DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?
        ) x
      ) base
      LEFT JOIN (
        SELECT iob.store_id AS storeId, iob.item_id AS itemId, SUM(iob.quantity) AS opening
        FROM item_opening_balances iob
        INNER JOIN stores st ON st.id = iob.store_id
        WHERE st.firm_id = ?
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
        WHERE COALESCE(NULLIF(t.to_firm_id, ''), t.firm_id) = ? AND DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?
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

    const keyOf = (storeId, itemId) => `${String(storeId ?? '')}||${String(itemId ?? '')}`;
    const aggMap = new Map();
    for (const r of Array.isArray(aggRows) ? aggRows : []) {
      const storeId = String(r.storeId ?? '');
      const itemId = String(r.itemId ?? '');
      if (!storeId || !itemId) continue;
      aggMap.set(keyOf(storeId, itemId), {
        opening: num(r.opening, 0),
        purchase: num(r.purchase, 0),
	        returns: 0,
        issue: num(r.issueQty, 0),
        damage: num(r.damageQty, 0),
        transferIn: num(r.transferIn, 0),
        transferOut: num(r.transferOut, 0),
      });
    }

    const mergeInventoryQuantity = (sourceRows, sourceField, targetField) => {
      for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
        const storeId = String(row.storeId ?? '');
        const itemId = String(row.itemId ?? '');
        if (!storeId || !itemId) continue;
        const key = keyOf(storeId, itemId);
        const agg = aggMap.get(key) ?? {
          opening: 0,
          purchase: 0,
          returns: 0,
          issue: 0,
          damage: 0,
          transferIn: 0,
          transferOut: 0,
        };
        agg[targetField] = num(agg[targetField], 0) + num(row[sourceField], 0);
        aggMap.set(key, agg);
      }
    };

    const [returnAggRows] = await pool.query(
      `
      SELECT r.store_id AS storeId, ri.item_id AS itemId, SUM(ri.quantity) AS returnQty
      FROM item_returns r
      INNER JOIN item_return_items ri ON ri.return_id = r.id
      WHERE r.firm_id = ? AND DATE(COALESCE(r.date, r.created_at)) >= ? AND DATE(COALESCE(r.date, r.created_at)) <= ?
      GROUP BY r.store_id, ri.item_id
      `,
      [firmId, range.start, range.end]
    );
    mergeInventoryQuantity(returnAggRows, 'returnQty', 'returns');

    const [damageTransactionRows] = await pool.query(
      `
      SELECT d.store_id AS storeId, di.item_id AS itemId, SUM(di.quantity) AS damageQty
      FROM item_damages d
      INNER JOIN item_damage_items di ON di.damage_id = d.id
      WHERE d.firm_id = ? AND DATE(COALESCE(d.date, d.created_at)) >= ? AND DATE(COALESCE(d.date, d.created_at)) <= ?
      GROUP BY d.store_id, di.item_id
      `,
      [firmId, range.start, range.end]
    );
    mergeInventoryQuantity(damageTransactionRows, 'damageQty', 'damage');

    const storeIds = Array.from(storeById.keys());
    const itemIds = Array.from(itemById.keys());

    const makeRow = (storeId, itemId) => {
      const meta = itemById.get(itemId) ?? { itemCode: '', itemName: '', specificationsJson: '', unit: '', reorderLevel: 0, openingStock: 0, photo1: '', photo2: '', photo3: '', photo4: '', photo5: '', itemLink: '', videoLink: '' };
      const agg = aggMap.get(keyOf(storeId, itemId)) ?? {
	        opening: 0,
	        purchase: 0,
	        returns: 0,
        issue: 0,
        damage: 0,
        transferIn: 0,
        transferOut: 0,
	      };
      const opening = num(agg.opening, 0);
      const reorderLevel = num(meta.reorderLevel, 0);
      const purchase = num(agg.purchase, 0);
      const issue = num(agg.issue, 0);
      const damage = num(agg.damage, 0);
      const returns = num(agg.returns, 0);
      const transferIn = num(agg.transferIn, 0);
      const transferOut = num(agg.transferOut, 0);
      const balance = opening + purchase + returns + transferIn - issue - damage - transferOut;
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
          photo1: meta.photo1,
          photo2: meta.photo2,
          photo3: meta.photo3,
          photo4: meta.photo4,
          photo5: meta.photo5,
          itemLink: meta.itemLink,
          videoLink: meta.videoLink,
	        purchase,
        issue,
        damage,
        returns,
        balance,
      };
    };

    const rows = includeEmpty
      ? storeIds.flatMap((storeId) => itemIds.map((itemId) => makeRow(storeId, itemId)))
      : storeIds.length
        ? Array.from(aggMap.keys()).map((k) => {
            const [storeId, itemId] = String(k).split('||');
            return makeRow(storeId, itemId);
          })
        : [];

    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});


function formatReportItemLabel(itemName, specificationsJson) {
  const base = String(itemName ?? '').trim();
  let specs = [];
  try {
    const obj = typeof specificationsJson === 'string' ? JSON.parse(specificationsJson || '{}') : specificationsJson;
    if (obj && typeof obj === 'object') {
      specs = Object.values(obj).map((v) => String(v ?? '').trim()).filter(Boolean);
    }
  } catch {}
  return [base, ...specs].filter(Boolean).join(' - ') || '-';
}

app.get('/api/reports/expenses', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const from = String(req.query.from ?? '').trim();
    const to = String(req.query.to ?? '').trim();
    const expense = String(req.query.expense ?? '').trim();
    const expenseMap = new Map([
      ['courier', 'Courier Charge'],
      ['packing', 'Packing Charge'],
      ['labour', 'Labour Charge'],
      ['other', 'Other Charge'],
      ['chargesGst', 'GST on Charges'],
    ]);
    const where = ['1=1'];
    const params = [];
    if (from) {
      where.push('DATE(x.invoiceDate) >= ?');
      params.push(from);
    }
    if (to) {
      where.push('DATE(x.invoiceDate) <= ?');
      params.push(to);
    }
    if (expense) {
      where.push('(x.expenseId = ? OR x.expenses = ?)');
      params.push(expense, expenseMap.get(expense) ?? expense);
    }

    const [rows] = await pool.query(
      `
      SELECT
        x.invoiceDate AS date,
        x.invoiceNo,
        x.invoiceId,
        x.expenseId,
        x.expenses,
        x.supplier,
        x.amount
      FROM (
        SELECT inv.invoice_date AS invoiceDate, inv.invoice_number AS invoiceNo, inv.id AS invoiceId, inv.created_at AS createdAt, 'courier' AS expenseId, 'Courier Charge' AS expenses, s.name AS supplier, COALESCE(inv.courier_charge, 0) AS amount
        FROM invoices inv
        LEFT JOIN suppliers s ON s.id = inv.supplier_id
        UNION ALL
        SELECT inv.invoice_date AS invoiceDate, inv.invoice_number AS invoiceNo, inv.id AS invoiceId, inv.created_at AS createdAt, 'packing' AS expenseId, 'Packing Charge' AS expenses, s.name AS supplier, COALESCE(inv.packing_charge, 0) AS amount
        FROM invoices inv
        LEFT JOIN suppliers s ON s.id = inv.supplier_id
        UNION ALL
        SELECT inv.invoice_date AS invoiceDate, inv.invoice_number AS invoiceNo, inv.id AS invoiceId, inv.created_at AS createdAt, 'labour' AS expenseId, 'Labour Charge' AS expenses, s.name AS supplier, COALESCE(inv.labour_charge, 0) AS amount
        FROM invoices inv
        LEFT JOIN suppliers s ON s.id = inv.supplier_id
        UNION ALL
        SELECT inv.invoice_date AS invoiceDate, inv.invoice_number AS invoiceNo, inv.id AS invoiceId, inv.created_at AS createdAt, 'other' AS expenseId, 'Other Charge' AS expenses, s.name AS supplier, COALESCE(inv.other_charge, 0) AS amount
        FROM invoices inv
        LEFT JOIN suppliers s ON s.id = inv.supplier_id
        UNION ALL
        SELECT inv.invoice_date AS invoiceDate, inv.invoice_number AS invoiceNo, inv.id AS invoiceId, inv.created_at AS createdAt, 'chargesGst' AS expenseId, 'GST on Charges' AS expenses, s.name AS supplier, COALESCE(inv.charges_gst_amount, 0) AS amount
        FROM invoices inv
        LEFT JOIN suppliers s ON s.id = inv.supplier_id
      ) x
      WHERE ${where.join(' AND ')}
        AND COALESCE(x.amount, 0) > 0
      ORDER BY x.invoiceDate DESC, x.createdAt DESC, x.invoiceNo, x.expenses
      `,
      params
    );

    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      date: toIsoDate(r.date) || '',
      invoiceNo: String(r.invoiceNo ?? r.invoiceId ?? ''),
      expenses: String(r.expenses ?? ''),
      expenseId: String(r.expenseId ?? ''),
      supplier: String(r.supplier ?? ''),
      amount: round2(num(r.amount, 0)),
    }));
    res.json({ rows: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

async function fetchStockSummaryRows(pool) {
  const [rows] = await pool.query(
    `
    SELECT
      it.id AS itemId,
      iname.name AS itemName,
      it.specifications_json AS specificationsJson,
      ic.name AS category,
      it.reorder_level AS reorderLevel,
      COALESCE(opening.openingQty, 0) AS openingQty,
      COALESCE(purchase.purchaseQty, 0) AS purchaseQty,
      COALESCE(returns.returnQty, 0) AS returnQty,
      COALESCE(issue.issueQty, 0) AS issueQty,
      COALESCE(damage.damageQty, 0) AS damageQty,
      COALESCE(po.pendingPoQty, 0) AS poInProgress
    FROM items it
    LEFT JOIN item_names iname ON iname.id = it.item_name_id
    LEFT JOIN item_categories ic ON ic.id = iname.item_category_id
    LEFT JOIN (
      SELECT item_id AS itemId, SUM(COALESCE(quantity, 0)) AS openingQty
      FROM item_opening_balances
      GROUP BY item_id
    ) opening ON opening.itemId = it.id
    LEFT JOIN (
      SELECT qc.item_id AS itemId, SUM(COALESCE(qc.accepted_qty, 0)) AS purchaseQty
      FROM qc_records qc
      GROUP BY qc.item_id
    ) purchase ON purchase.itemId = it.id
    LEFT JOIN (
      SELECT iri.item_id AS itemId, SUM(COALESCE(iri.quantity, 0)) AS returnQty
      FROM item_return_items iri
      GROUP BY iri.item_id
    ) returns ON returns.itemId = it.id
    LEFT JOIN (
      SELECT iii.item_id AS itemId, SUM(COALESCE(iii.quantity, 0)) AS issueQty
      FROM item_issue_items iii
      GROUP BY iii.item_id
    ) issue ON issue.itemId = it.id
    LEFT JOIN (
      SELECT damageRows.itemId, SUM(damageRows.damageQty) AS damageQty
      FROM (
        SELECT item_id AS itemId, COALESCE(quantity, 0) AS damageQty
        FROM damaged_items
        UNION ALL
        SELECT idi.item_id AS itemId, COALESCE(idi.quantity, 0) AS damageQty
        FROM item_damage_items idi
      ) damageRows
      GROUP BY damageRows.itemId
    ) damage ON damage.itemId = it.id
    LEFT JOIN (
      SELECT
        poi.item_id AS itemId,
        SUM(GREATEST(COALESCE(poi.quantity, 0) - COALESCE(poi.cancelled_qty, 0) - COALESCE(grn.receivedQty, 0), 0)) AS pendingPoQty
      FROM purchase_order_items poi
      INNER JOIN purchase_orders po ON po.id = poi.po_id
      LEFT JOIN (
        SELECT g.po_id AS poId, gi.item_id AS itemId, SUM(COALESCE(gi.received_qty, 0)) AS receivedQty
        FROM grns g
        INNER JOIN grn_items gi ON gi.grn_id = g.id
        GROUP BY g.po_id, gi.item_id
      ) grn ON grn.poId = poi.po_id AND grn.itemId = poi.item_id
      WHERE po.status IN ('Open', 'Partial')
      GROUP BY poi.item_id
    ) po ON po.itemId = it.id
    WHERE it.is_active = 1
    ORDER BY iname.name ASC
    `
  );

  return (Array.isArray(rows) ? rows : []).map((r) => {
    const currentBalance =
      num(r.openingQty, 0) +
      num(r.purchaseQty, 0) +
      num(r.returnQty, 0) -
      num(r.issueQty, 0) -
      num(r.damageQty, 0);
    const reorderLevel = num(r.reorderLevel, 0);
    const poInProgress = num(r.poInProgress, 0);
    return {
      itemId: String(r.itemId ?? ''),
      item: formatReportItemLabel(r.itemName, r.specificationsJson),
      category: String(r.category ?? ''),
      currentBalance: round2(currentBalance),
      closingStock: round2(currentBalance),
      poInProgress: round2(poInProgress),
      reorderLevel: round2(reorderLevel),
      shortfall: round2(Math.max(0, reorderLevel - (currentBalance + poInProgress))),
    };
  });
}

app.get('/api/reports/stock-summary', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    res.json({ rows: await fetchStockSummaryRows(pool) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/reports/pending-order', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const rows = (await fetchStockSummaryRows(pool)).filter((r) => r.reorderLevel > 0 && r.currentBalance + r.poInProgress < r.reorderLevel);
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

	    const [[poRow]] = await pool.query('SELECT id, supplier_id AS supplierId, status FROM purchase_orders WHERE id = ?', [poId]);
	    if (!poRow) return res.status(404).json({ error: 'PO not found' });
      if (String(poRow.status ?? '').trim().toLowerCase() === 'draft') return res.status(400).json({ error: 'Draft PO cannot be used for invoice.' });
	    const supplierId = String(poRow.supplierId ?? '').trim();
    if (!supplierId) return res.status(500).json({ error: 'PO is missing supplierId' });

    const courierCharge = Math.max(0, num(req.body?.courierCharge, 0));
    const packingCharge = Math.max(0, num(req.body?.packingCharge, 0));
    const labourCharge = Math.max(0, num(req.body?.labourCharge, 0));
    const otherCharge = Math.max(0, num(req.body?.otherCharge, 0));
    const chargesGstAmount = Math.max(0, num(req.body?.chargesGstAmount, 0));
    const paymentModeRaw = String(req.body?.paymentMode ?? '').trim().toLowerCase();
    const paymentMode = paymentModeRaw === 'cash' ? 'Cash' : paymentModeRaw === 'credit' ? 'Credit' : null;
    const tallyEntryDate = req.body?.tallyEntryDate != null ? String(req.body.tallyEntryDate).trim() : null;
    const documentUrl = req.body?.documentUrl != null ? String(req.body.documentUrl).trim() : null;
    const cnCopyUrl = req.body?.cnCopyUrl != null ? String(req.body.cnCopyUrl).trim() : null;
    const ewayBillUrl = req.body?.ewayBillUrl != null ? String(req.body.ewayBillUrl).trim() : null;
    const ewayBillNumber = req.body?.ewayBillNumber != null ? String(req.body.ewayBillNumber).trim() : null;
    const cnNumber = req.body?.cnNumber != null ? String(req.body.cnNumber).trim() : null;
    const courierNumber = req.body?.courierNumber != null ? String(req.body.courierNumber).trim() : null;
    const transporterName = req.body?.transporterName != null ? String(req.body.transporterName).trim() : null;

    const [poItemMetaRows] = await pool.query(
      `
      SELECT
        poi.item_id AS itemId,
        poi.dim_unit AS poDimUnit,
        it.unit AS unit
      FROM purchase_order_items poi
      LEFT JOIN items it ON it.id = poi.item_id
      WHERE poi.po_id = ?
      `,
      [poId]
    );
    const poMetaByItemId = new Map();
    for (const r of Array.isArray(poItemMetaRows) ? poItemMetaRows : []) {
      const itemId = String(r.itemId ?? '').trim();
      if (!itemId) continue;
      poMetaByItemId.set(itemId, { poDimUnit: r.poDimUnit != null ? String(r.poDimUnit) : null, unit: r.unit != null ? String(r.unit) : null });
    }

    const normalizedItems = items
      .map((it) => {
        const itemId = String(it?.itemId ?? '').trim();
        if (!itemId) return null;
        const meta = poMetaByItemId.get(itemId) ?? {};
        const areaUnit = normalizeAreaUnitName(meta.unit);
        const poDimUnit = meta.poDimUnit || baseDimUnitForAreaUnit(areaUnit);
        const isArea = !!poDimUnit;

        const dimLengthInput = it?.length ?? it?.dimLength ?? it?.dim_length;
        const dimBreadthInput = it?.breadth ?? it?.dimBreadth ?? it?.dim_breadth;
        const dimPcsInput = it?.pcs ?? it?.dimPcs ?? it?.dim_pcs;
        const inputUnitRaw = it?.inputUnit ?? it?.dimInputUnit ?? it?.dim_input_unit ?? it?.dimInputUnit;
        const inputUnit = String(inputUnitRaw ?? '').trim().toLowerCase() || (poDimUnit ? String(poDimUnit).trim().toLowerCase() : '');

        const dimLength = dimLengthInput != null && String(dimLengthInput).trim() !== '' ? num(dimLengthInput, NaN) : NaN;
        const dimBreadth = dimBreadthInput != null && String(dimBreadthInput).trim() !== '' ? num(dimBreadthInput, NaN) : NaN;
        const dimPcs = dimPcsInput != null && String(dimPcsInput).trim() !== '' ? num(dimPcsInput, NaN) : 1;

        const qtyInputUnit = isArea ? computeAreaQty(dimLength, dimBreadth, dimPcs) : NaN;
        const quantityInput = Math.max(0, num(it?.quantity, 0));
        const quantity = isArea ? convertAreaQty(qtyInputUnit, inputUnit, poDimUnit) : quantityInput;

        return {
          itemId,
          quantity: Math.max(0, quantity),
          rate: Math.max(0, num(it?.rate, 0)),
          taxPercent: Math.max(0, num(it?.taxPercent, 0)),
          dimLength: isArea ? round2(dimLength) : null,
          dimBreadth: isArea ? round2(dimBreadth) : null,
          dimPcs: isArea ? Math.trunc(Number(dimPcs)) : null,
          dimInputUnit: isArea ? inputUnit : null,
          poDimUnit: isArea ? String(poDimUnit).trim().toLowerCase() : null,
          isArea,
          qtyInputUnit,
        };
      })
      .filter((it) => it && it.itemId && it.quantity > 0);
    if (!normalizedItems.length) return res.status(400).json({ error: 'No valid invoice items' });

    for (const it of normalizedItems) {
      if (it.isArea) {
        if (!it.poDimUnit) return res.status(400).json({ error: 'PO is missing dimension unit for area-unit invoice item' });
        if (it.dimInputUnit !== 'ft' && it.dimInputUnit !== 'm') return res.status(400).json({ error: 'Invalid invoice input unit for area-unit item' });
        if (!Number.isFinite(it.qtyInputUnit) || it.qtyInputUnit <= 0) return res.status(400).json({ error: 'Each area-unit invoice item requires valid length, breadth and PCs' });
        if (!Number.isFinite(it.quantity) || it.quantity <= 0) return res.status(400).json({ error: 'Invalid converted invoice quantity for area-unit item' });
      }
    }

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
        payment_status, payment_date, payment_mode, tally_entry_date,
        status,
        document_url, cn_copy_url, eway_bill_url,
        eway_bill_number, cn_number, courier_number, transporter_name,
        created_by, created_at, updated_by, updated_at
      ) VALUES (
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        'pending',
        ?, ?, ?,
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
        paymentMode === 'Cash' ? 'Full Paid' : null,
        paymentMode === 'Cash' ? invoiceDate : null,
        paymentMode,
        tallyEntryDate || null,
        documentUrl,
        cnCopyUrl,
        ewayBillUrl,
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
        INSERT INTO invoice_items (id, invoice_id, item_id, quantity, rate, tax_percent, created_by, created_at, updated_by, updated_at, dim_length, dim_breadth, dim_pcs, dim_input_unit)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE quantity=VALUES(quantity), rate=VALUES(rate), tax_percent=VALUES(tax_percent), updated_by=VALUES(updated_by), updated_at=NOW(),
          dim_length=VALUES(dim_length), dim_breadth=VALUES(dim_breadth), dim_pcs=VALUES(dim_pcs), dim_input_unit=VALUES(dim_input_unit)
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
          it.isArea ? it.dimLength : null,
          it.isArea ? it.dimBreadth : null,
          it.isArea ? it.dimPcs : null,
          it.isArea ? it.dimInputUnit : null,
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
          paymentStatus: paymentMode === 'Cash' ? 'Full Paid' : undefined,
          paymentDate: paymentMode === 'Cash' ? invoiceDate : undefined,
          paymentMode,
          tallyEntryDate: tallyEntryDate || undefined,
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

// --- Credit Vouchers (for suppliers without invoices) ---
async function handleCreateCreditVoucher(req, res) {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const poId = String(req.params.id ?? '').trim();
    if (!poId) return res.status(400).json({ error: 'po id is required' });

    const requestedVoucherNumber = req.body?.voucherNumber != null ? String(req.body.voucherNumber).trim() : null;
    const voucherDateInput = String(req.body?.voucherDate ?? '').trim();
    const voucherDate = toIsoDate(voucherDateInput) || voucherDateInput;
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!voucherDate) return res.status(400).json({ error: 'voucherDate is required' });
    if (!items.length) return res.status(400).json({ error: 'At least one item is required' });

    const [[poRow]] = await pool.query(
      `
      SELECT po.id AS poId, po.firm_id AS firmId, po.supplier_id AS supplierId, COALESCE(s.credit_voucher_applicable, 0) AS creditVoucherApplicable
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = ?
      LIMIT 1
      `,
      [poId]
    );
    if (!poRow) return res.status(404).json({ error: 'PO not found' });
    const firmId = String(poRow.firmId ?? '').trim();
    const supplierId = String(poRow.supplierId ?? '').trim();
    if (!supplierId) return res.status(500).json({ error: 'PO is missing supplierId' });
    if (!Number(poRow.creditVoucherApplicable ?? 0)) {
      return res.status(400).json({ error: 'Credit Voucher is not applicable for this supplier.' });
    }

    const [[existingCv]] = await pool.query('SELECT id FROM credit_vouchers WHERE po_id = ? LIMIT 1', [poId]);
    if (existingCv?.id) return res.status(400).json({ error: 'Credit Voucher already exists for this PO.' });

    const [[anyInvoice]] = await pool.query('SELECT id FROM invoices WHERE po_id = ? LIMIT 1', [poId]);
    if (anyInvoice?.id) return res.status(400).json({ error: 'Invoice already exists for this PO. Credit Voucher is not allowed.' });

    // Ensure PO is fully received (GRN complete across multiple GRNs).
    const [[recvMeta]] = await pool.query(
      `
      SELECT
        COALESCE(SUM(poi.quantity), 0) AS poQty,
        COALESCE(SUM(gi.received_qty), 0) AS grnQty
      FROM purchase_order_items poi
      LEFT JOIN grns g ON g.po_id = poi.po_id
      LEFT JOIN grn_items gi ON gi.grn_id = g.id AND gi.item_id = poi.item_id
      WHERE poi.po_id = ?
      `,
      [poId]
    );
    const poQty = Number(recvMeta?.poQty ?? 0);
    const grnQty = Number(recvMeta?.grnQty ?? 0);
    if (!(poQty > 1e-9) || poQty - grnQty > 1e-9) {
      return res.status(400).json({ error: 'Credit Voucher can be created only after full GRN receipt.' });
    }

    const [poItems] = await pool.query('SELECT item_id AS itemId, quantity AS poQty FROM purchase_order_items WHERE po_id = ?', [poId]);
    const poQtyByItemId = new Map(
      (Array.isArray(poItems) ? poItems : []).map((r) => [String(r.itemId ?? '').trim(), Number(r.poQty ?? 0)])
    );

    const normalizedItems = items
      .map((it) => ({
        itemId: String(it?.itemId ?? '').trim(),
        quantity: Math.max(0, num(it?.quantity, 0)),
        rate: Math.max(0, num(it?.rate, 0)),
      }))
      .filter((it) => it.itemId && it.quantity > 0);
    if (!normalizedItems.length) return res.status(400).json({ error: 'No valid credit voucher items' });

    for (const it of normalizedItems) {
      const maxQty = poQtyByItemId.get(it.itemId);
      if (maxQty == null) return res.status(400).json({ error: 'Credit voucher item must belong to the PO.' });
      if (it.quantity - maxQty > 1e-9) return res.status(400).json({ error: 'Credit voucher quantity cannot exceed PO quantity.' });
    }

    const totalAmount = normalizedItems.reduce((sum, it) => sum + it.quantity * it.rate, 0);
    const creditVoucherId = crypto.randomUUID();
    const voucherNumber = await allocateCreditVoucherNumber(pool, firmId, voucherDate ? new Date(voucherDate) : new Date());

    await pool.query(
      `
      INSERT INTO credit_vouchers (
        id, po_id, supplier_id,
        voucher_number, voucher_date,
        status,
        total_amount,
        payment_status, payment_date, payment_amount, payment_mode, tally_entry_date,
        created_by, created_at, updated_by, updated_at
      ) VALUES (
        ?, ?, ?,
        ?, ?,
        'Recorded',
        ?,
        NULL, NULL, 0, 'Credit', NULL,
        ?, NOW(), ?, NOW()
      )
      `,
      [creditVoucherId, poId, supplierId, voucherNumber || requestedVoucherNumber, voucherDate, totalAmount, updatedBy, updatedBy]
    );

    for (const it of normalizedItems) {
      await pool.query(
        `
        INSERT INTO credit_voucher_items (id, credit_voucher_id, item_id, quantity, rate, amount, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [crypto.randomUUID(), creditVoucherId, it.itemId, it.quantity, it.rate, it.quantity * it.rate]
      );
    }

    // Attach all GRNs for this PO for audit.
    const [grnRows] = await pool.query('SELECT id FROM grns WHERE po_id = ?', [poId]);
    for (const g of Array.isArray(grnRows) ? grnRows : []) {
      const grnId = String(g?.id ?? '').trim();
      if (!grnId) continue;
      await pool.query('INSERT IGNORE INTO credit_voucher_grns (credit_voucher_id, grn_id, created_at) VALUES (?, ?, NOW())', [
        creditVoucherId,
        grnId,
      ]);
    }

    res.status(201).json({
      creditVoucher: {
        id: creditVoucherId,
        poId,
        supplierId,
        voucherNo: voucherNumber || requestedVoucherNumber || creditVoucherId,
        voucherDate,
        status: 'Recorded',
        totalAmount,
        approvedBy: undefined,
        approvedAt: undefined,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

async function allocateCreditVoucherNumber(pool, firmId, date = new Date()) {
  const allocated = await allocateDocNumber(pool, firmId, 'CV', date);
  return allocated;
}

async function peekCreditVoucherNumber(pool, firmId, date = new Date()) {
  const fyRaw = fiscalYearLabel(date);
  const fId = String(firmId || 'DEFAULT').trim();
  await ensureDocSequencesTable(pool);

  // Fetch firm sort_name
  let sortName = 'GEN';
  if (fId !== 'DEFAULT') {
    const [fRows] = await pool.query('SELECT sort_name FROM firms WHERE id = ? LIMIT 1', [fId]);
    const fRow = Array.isArray(fRows) ? fRows[0] : null;
    if (fRow?.sort_name) {
      sortName = String(fRow.sort_name).trim().toUpperCase();
    }
  }

  const [rows] = await pool.query('SELECT next_no AS nextNo FROM doc_sequences WHERE firm_id=? AND kind=? AND fy=? LIMIT 1', [fId, 'CV', fyRaw]);
  const nextNo = Number((Array.isArray(rows) ? rows[0] : null)?.nextNo ?? 1);
  const seq = String(Number.isFinite(nextNo) && nextNo > 0 ? nextNo : 1).padStart(5, '0');
  return `${sortName}/CV/${fyRaw}/${seq}`;
}

app.post('/api/pos/:id/credit-voucher', handleCreateCreditVoucher);
app.post('/api/pos/:id/credit-vouchers', handleCreateCreditVoucher);

app.get('/api/credit-vouchers/next-number', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const voucherDateInput = String(req.query?.voucherDate ?? '').trim();
    const firmId = String(req.query?.firmId || '').trim();
    const voucherDate = toIsoDate(voucherDateInput) || voucherDateInput;
    const nextVoucherNo = await peekCreditVoucherNumber(pool, firmId, voucherDate ? new Date(voucherDate) : new Date());
    res.json({ voucherNo: nextVoucherNo });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/credit-vouchers/:id.pdf', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const creditVoucherId = String(req.params.id ?? '').trim();
    if (!creditVoucherId) return res.status(400).json({ error: 'credit voucher id is required' });

    const [headRows] = await pool.query(
      `
      SELECT
        cv.id,
        cv.voucher_number AS voucherNo,
        cv.voucher_date AS voucherDate,
        cv.total_amount AS totalAmount,
        cv.status,
        cv.updated_by AS approvedBy,
        cv.po_id AS poId,
        po.po_number AS poNumber,
        s.name AS supplierName
      FROM credit_vouchers cv
      LEFT JOIN purchase_orders po ON po.id = cv.po_id
      LEFT JOIN suppliers s ON s.id = cv.supplier_id
      WHERE cv.id = ?
      LIMIT 1
      `,
      [creditVoucherId]
    );
    const header = Array.isArray(headRows) ? headRows[0] : null;
    if (!header) return res.status(404).json({ error: 'Credit Voucher not found' });

    const [itemRows] = await pool.query(
      `
      SELECT
        cvi.quantity,
        cvi.rate,
        cvi.amount,
        iname.name AS itemName,
        i.specifications_json AS specificationsJson
      FROM credit_voucher_items cvi
      LEFT JOIN items i ON i.id = cvi.item_id
      LEFT JOIN item_names iname ON iname.id = i.item_name_id
      WHERE cvi.credit_voucher_id = ?
      ORDER BY cvi.created_at ASC
      `,
      [creditVoucherId]
    );

    const [specRows] = await pool.query('SELECT id, name FROM specifications ORDER BY name');
    const specNameById = new Map((Array.isArray(specRows) ? specRows : []).map((r) => [String(r.id ?? '').trim(), String(r.name ?? '').trim()]));
    const formatSpecParts = (specificationsJson) => {
      const raw = String(specificationsJson ?? '').trim();
      if (!raw) return [];
      try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return [];
        const out = [];
        for (const [k, v] of Object.entries(obj)) {
          const val = String(v ?? '').trim();
          if (!val) continue;
          const name = specNameById.get(String(k ?? '').trim()) || '';
          out.push(name ? `${name}: ${val}` : val);
        }
        return out;
      } catch {
        return raw
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    };

    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]); // A4
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const drawText = (text, x, y, size = 10, useBold = false) => {
      page.drawText(toPdfText(text), { x, y, size, font: useBold ? bold : font, color: rgb(0, 0, 0) });
    };
    const textWidth = (text, size = 10, useBold = false) =>
      (useBold ? bold : font).widthOfTextAtSize(String(text ?? ''), size);
    const wrapText = (text, maxWidth, size = 8.5) => {
      const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
      if (!words.length) return ['-'];
      const lines = [];
      let current = words[0];
      for (let i = 1; i < words.length; i++) {
        const candidate = `${current} ${words[i]}`;
        if (textWidth(candidate, size, false) <= maxWidth) current = candidate;
        else {
          lines.push(current);
          current = words[i];
        }
      }
      lines.push(current);
      return lines;
    };
    const formatDateDDMMYYYY = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return '';
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return raw;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = String(d.getFullYear());
      return `${dd}/${mm}/${yyyy}`;
    };

    let y = 810;
    const heading = 'CREDIT VOUCHER';
    drawText(heading, (595.28 - textWidth(heading, 16, true)) / 2, y, 16, true);
    y -= 26;
    drawText(`Voucher No: ${String(header.voucherNo ?? creditVoucherId)}`, 40, y, 10, true);
    drawText(`Date: ${formatDateDDMMYYYY(header.voucherDate)}`, 400, y, 10, true);
    y -= 18;
    drawText(`PO: ${String(header.poNumber ?? header.poId ?? '')}`, 40, y, 10);
    y -= 18;
    drawText(`Supplier: ${String(header.supplierName ?? '')}`, 40, y, 10);
    y -= 24;

    // Table (with borders)
    const tableX = 40;
    const col1 = 250; // Item (wrapped)
    const col2 = 70;  // Qty
    const col3 = 70;  // Rate
    const col4 = 110; // Amount
    const x1 = tableX;
    const x2 = tableX + col1;
    const x3 = x2 + col2;
    const x4 = x3 + col3;
    const x5 = x4 + col4;
    const rowH = 20;
    const headerTop = y + 12;
    const headerBottom = headerTop - rowH;
    page.drawRectangle({ x: tableX, y: headerBottom, width: x5 - x1, height: rowH, borderWidth: 1, borderColor: rgb(0, 0, 0) });
    page.drawLine({ start: { x: x2, y: headerTop }, end: { x: x2, y: headerBottom }, thickness: 1, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: x3, y: headerTop }, end: { x: x3, y: headerBottom }, thickness: 1, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: x4, y: headerTop }, end: { x: x4, y: headerBottom }, thickness: 1, color: rgb(0, 0, 0) });
    drawText('Item', x1 + 6, headerBottom + 6, 10, true);
    drawText('Qty', x3 - textWidth('Qty', 10, true) - 6, headerBottom + 6, 10, true);
    drawText('Rate', x4 - textWidth('Rate', 10, true) - 6, headerBottom + 6, 10, true);
    drawText('Amount', x5 - textWidth('Amount', 10, true) - 6, headerBottom + 6, 10, true);
    y = headerBottom - 2;

    const rows = Array.isArray(itemRows) ? itemRows : [];
    for (const row of rows) {
      const itemName = [
        String(row?.itemName ?? '').trim(),
        ...formatSpecParts(row?.specificationsJson),
      ].filter(Boolean).join(' - ') || '-';
      const qty = Number(row?.quantity ?? 0);
      const rate = Number(row?.rate ?? 0);
      const amount = Number(row?.amount ?? qty * rate);

      const itemLines = wrapText(itemName, col1 - 12, 8.5);
      const bodyRowH = Math.max(rowH, itemLines.length * 11 + 8);
      const rowTop = y;
      const rowBottom = rowTop - bodyRowH;
      page.drawRectangle({ x: tableX, y: rowBottom, width: x5 - x1, height: bodyRowH, borderWidth: 1, borderColor: rgb(0, 0, 0) });
      page.drawLine({ start: { x: x2, y: rowTop }, end: { x: x2, y: rowBottom }, thickness: 1, color: rgb(0, 0, 0) });
      page.drawLine({ start: { x: x3, y: rowTop }, end: { x: x3, y: rowBottom }, thickness: 1, color: rgb(0, 0, 0) });
      page.drawLine({ start: { x: x4, y: rowTop }, end: { x: x4, y: rowBottom }, thickness: 1, color: rgb(0, 0, 0) });
      let lineY = rowTop - 13;
      for (const line of itemLines) {
        drawText(line, x1 + 6, lineY, 8.5);
        lineY -= 11;
      }
      const qtyText = qty.toFixed(3);
      const rateText = rate.toFixed(3);
      const amountText = amount.toFixed(3);
      const numY = rowBottom + Math.max(6, (bodyRowH - 9) / 2 - 1);
      drawText(qtyText, x3 - textWidth(qtyText, 9, false) - 6, numY, 9);
      drawText(rateText, x4 - textWidth(rateText, 9, false) - 6, numY, 9);
      drawText(amountText, x5 - textWidth(amountText, 9, false) - 6, numY, 9);
      y = rowBottom - 2;
      if (y < 70) break;
    }

    y -= 10;
    drawText(`Total Amount: ${Number(header.totalAmount ?? 0).toFixed(3)}`, 380, y, 11, true);
    const signatureY = 110; // fixed visible zone above page bottom
    drawText('Supplier/Vendor Sign:', 40, signatureY, 10.5, true);
    page.drawLine({ start: { x: 170, y: signatureY + 2 }, end: { x: 330, y: signatureY + 2 }, thickness: 1.2, color: rgb(0, 0, 0) });
    drawText('Approved By:', 380, signatureY, 10.5, true);
    page.drawLine({ start: { x: 465, y: signatureY + 2 }, end: { x: 560, y: signatureY + 2 }, thickness: 1.2, color: rgb(0, 0, 0) });

    const pdfBytes = await doc.save();
    res.setHeader('Content-Type', 'application/pdf');
    const fileName = `${String(header.voucherNo ?? creditVoucherId).replace(/[^\w\-\/]+/g, '_')}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/credit-vouchers/:id/items', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const creditVoucherId = String(req.params.id ?? '').trim();
    if (!creditVoucherId) return res.status(400).json({ error: 'credit voucher id is required' });
    const [rows] = await pool.query(
      `
      SELECT
        cvi.id,
        cvi.item_id AS itemId,
        COALESCE(iname.name, '') AS itemName,
        i.specifications_json AS specificationsJson,
        u.name AS unit,
        cvi.quantity,
        cvi.rate,
        cvi.amount
      FROM credit_voucher_items cvi
      LEFT JOIN items i ON i.id = cvi.item_id
      LEFT JOIN item_names iname ON iname.id = i.item_name_id
      LEFT JOIN units u ON u.id = iname.unit_id
      WHERE cvi.credit_voucher_id = ?
      ORDER BY cvi.created_at ASC
      `,
      [creditVoucherId]
    );
    const [specRows] = await pool.query('SELECT id, name FROM specifications ORDER BY name');
    const specNameById = new Map((Array.isArray(specRows) ? specRows : []).map((r) => [String(r.id ?? '').trim(), String(r.name ?? '').trim()]));
    const formatSpecParts = (specificationsJson) => {
      const raw = String(specificationsJson ?? '').trim();
      if (!raw) return [];
      try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return [];
        const out = [];
        for (const [k, v] of Object.entries(obj)) {
          const val = String(v ?? '').trim();
          if (!val) continue;
          const name = specNameById.get(String(k ?? '').trim()) || '';
          out.push(name ? `${name}: ${val}` : val);
        }
        return out;
      } catch {
        return raw
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    };
    res.json({
      items: (Array.isArray(rows) ? rows : []).map((r) => ({
        id: String(r.id ?? ''),
        itemId: String(r.itemId ?? ''),
        itemName: [String(r.itemName ?? '').trim(), ...formatSpecParts(r.specificationsJson)].filter(Boolean).join(' - '),
        unit: String(r.unit ?? '').trim(),
        quantity: Number(r.quantity ?? 0),
        rate: Number(r.rate ?? 0),
        amount: Number(r.amount ?? 0),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/credit-vouchers/:id/approve-entry', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const creditVoucherId = String(req.params.id ?? '').trim();
    if (!creditVoucherId) return res.status(400).json({ error: 'credit voucher id is required' });
    const approvedBy = String(req.body?.approvedBy ?? '').trim();
    const approveDateInput = String(req.body?.approveDate ?? '').trim();
    const approveDate = toIsoDate(approveDateInput) || approveDateInput;
    if (!approvedBy) return res.status(400).json({ error: 'approvedBy is required' });
    if (!approveDate) return res.status(400).json({ error: 'approveDate is required' });

    const [[row]] = await pool.query('SELECT id, status FROM credit_vouchers WHERE id = ? LIMIT 1', [creditVoucherId]);
    if (!row) return res.status(404).json({ error: 'Credit Voucher not found' });
    const status = String(row.status ?? '').trim() || 'Recorded';
    if (status === 'Approved' || status === 'Paid') return res.status(400).json({ error: 'Credit Voucher already approved.' });

    await pool.query(
      `
      UPDATE credit_vouchers
      SET approved_by=?, approved_at=?, status='Approved', updated_by=?, updated_at=NOW()
      WHERE id=?
      `,
      [approvedBy, approveDate, approvedBy, creditVoucherId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/credit-vouchers/:id/payment', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const creditVoucherId = String(req.params.id ?? '').trim();
    if (!creditVoucherId) return res.status(400).json({ error: 'credit voucher id is required' });

    const paymentDateInput = String(req.body?.paymentDate ?? '').trim();
    const paymentDate = toIsoDate(paymentDateInput) || paymentDateInput;
    const paymentAmount = Math.max(0, num(req.body?.paymentAmount, 0));
    const paymentMode = req.body?.paymentMode != null ? String(req.body.paymentMode).trim() : null;
    const paymentCopy = req.body?.paymentCopy != null ? String(req.body.paymentCopy).trim() : null;
    const tallyEntryDate = req.body?.tallyEntryDate != null ? String(req.body.tallyEntryDate).trim() : null;
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || null;

    if (!paymentDate) return res.status(400).json({ error: 'paymentDate is required' });
    if (!paymentMode) return res.status(400).json({ error: 'paymentMode is required' });
    if (!paymentCopy) return res.status(400).json({ error: 'paymentCopy is required' });
    if (!paymentCopy) return res.status(400).json({ error: 'paymentCopy is required' });
    if (!Number.isFinite(paymentAmount) || paymentAmount < 0) return res.status(400).json({ error: 'paymentAmount must be 0 or more' });

    const [[meta]] = await pool.query(
      `
      SELECT id, po_id AS poId, total_amount AS voucherAmount
      FROM credit_vouchers
      WHERE id = ?
      LIMIT 1
      `,
      [creditVoucherId]
    );
    if (!meta) return res.status(404).json({ error: 'Credit Voucher not found' });
    const poId = String(meta.poId ?? '').trim();
    const voucherAmount = Number(meta.voucherAmount ?? 0);

    const paymentStatus = paymentAmount >= voucherAmount - 1e-9 ? 'Full Paid' : paymentAmount > 1e-9 ? 'Partly Paid' : 'Partly Paid';
    const nextStatus = paymentStatus.toLowerCase().includes('full') ? 'Paid' : 'Approved';

    await pool.query(
      `
      UPDATE credit_vouchers
      SET payment_status=?, payment_date=?, payment_amount=?, payment_mode=?, tally_entry_date=COALESCE(?, tally_entry_date), status=?, updated_by=?, updated_at=NOW()
      WHERE id=?
      `,
      [paymentStatus, paymentDate, paymentAmount, paymentMode, tallyEntryDate || null, nextStatus, updatedBy, creditVoucherId]
    );

    // Append a PO ledger row (direct payment) linked to this credit voucher.
    if (poId && paymentAmount > 1e-9) {
      await pool.query(
        `
        INSERT INTO po_advance_invoice_adjustments
          (id, po_id, invoice_id, adjusted_amount, payment_mode, payment_copy, receipt_type, reference_type, entry_key, created_by, updated_by)
        VALUES (?, ?, NULL, ?, ?, ?, 'DIRECT_PAYMENT', 'CREDIT_VOUCHER', ?, ?, ?)
        `,
        [crypto.randomUUID(), poId, paymentAmount, paymentMode, paymentCopy || null, creditVoucherId, updatedBy || 'system', updatedBy || 'system']
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/invoices/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'invoice id is required' });

    const supplierInvoiceNo = String(req.body?.supplierInvoiceNo ?? '').trim();
    const invoiceDate = String(req.body?.invoiceDate ?? '').trim();
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || null;
    const paymentMode = req.body?.paymentMode != null ? String(req.body.paymentMode).trim() || null : null;
    const tallyEntryDate = req.body?.tallyEntryDate != null ? String(req.body.tallyEntryDate).trim() || null : null;
    const documentUrl = req.body?.documentUrl != null ? String(req.body.documentUrl).trim() : undefined;
    const cnCopyUrl = req.body?.cnCopyUrl != null ? String(req.body.cnCopyUrl).trim() : undefined;
    const ewayBillUrl = req.body?.ewayBillUrl != null ? String(req.body.ewayBillUrl).trim() : undefined;
    const ewayBillNumber = req.body?.ewayBillNumber != null ? String(req.body.ewayBillNumber).trim() : undefined;
    const cnNumber = req.body?.cnNumber != null ? String(req.body.cnNumber).trim() : undefined;
    const courierNumber = req.body?.courierNumber != null ? String(req.body.courierNumber).trim() : undefined;
    const transporterName = req.body?.transporterName != null ? String(req.body.transporterName).trim() : undefined;

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!supplierInvoiceNo) return res.status(400).json({ error: 'supplierInvoiceNo is required' });
    if (!invoiceDate) return res.status(400).json({ error: 'invoiceDate is required' });
    if (!items.length) return res.status(400).json({ error: 'At least one item is required' });

    const courierCharge = Math.max(0, num(req.body?.courierCharge, 0));
    const packingCharge = Math.max(0, num(req.body?.packingCharge, 0));
    const labourCharge = Math.max(0, num(req.body?.labourCharge, 0));
    const otherCharge = Math.max(0, num(req.body?.otherCharge, 0));
    const chargesGstAmount = Math.max(0, num(req.body?.chargesGstAmount, 0));

    const [[invRow]] = await pool.query('SELECT po_id AS poId FROM invoices WHERE id = ? LIMIT 1', [invoiceId]);
    if (!invRow?.poId) return res.status(404).json({ error: 'Invoice not found' });
    const poId = String(invRow.poId);

    const [poItemMetaRows] = await pool.query(
      `
      SELECT
        poi.item_id AS itemId,
        poi.dim_unit AS poDimUnit,
        it.unit AS unit
      FROM purchase_order_items poi
      LEFT JOIN items it ON it.id = poi.item_id
      WHERE poi.po_id = ?
      `,
      [poId]
    );
    const poMetaByItemId = new Map();
    for (const r of Array.isArray(poItemMetaRows) ? poItemMetaRows : []) {
      const itemId = String(r.itemId ?? '').trim();
      if (!itemId) continue;
      poMetaByItemId.set(itemId, { poDimUnit: r.poDimUnit != null ? String(r.poDimUnit) : null, unit: r.unit != null ? String(r.unit) : null });
    }

    const normalizedItems = items
      .map((it) => {
        const itemId = String(it?.itemId ?? '').trim();
        if (!itemId) return null;
        const meta = poMetaByItemId.get(itemId) ?? {};
        const areaUnit = normalizeAreaUnitName(meta.unit);
        const poDimUnit = meta.poDimUnit || baseDimUnitForAreaUnit(areaUnit);
        const isArea = !!poDimUnit;

        const dimLengthInput = it?.length ?? it?.dimLength ?? it?.dim_length;
        const dimBreadthInput = it?.breadth ?? it?.dimBreadth ?? it?.dim_breadth;
        const dimPcsInput = it?.pcs ?? it?.dimPcs ?? it?.dim_pcs;
        const inputUnitRaw = it?.inputUnit ?? it?.dimInputUnit ?? it?.dim_input_unit;
        const inputUnit = String(inputUnitRaw ?? '').trim().toLowerCase() || (poDimUnit ? String(poDimUnit).trim().toLowerCase() : '');

        const dimLength = dimLengthInput != null && String(dimLengthInput).trim() !== '' ? num(dimLengthInput, NaN) : NaN;
        const dimBreadth = dimBreadthInput != null && String(dimBreadthInput).trim() !== '' ? num(dimBreadthInput, NaN) : NaN;
        const dimPcs = dimPcsInput != null && String(dimPcsInput).trim() !== '' ? num(dimPcsInput, NaN) : 1;

        const qtyInputUnit = isArea ? computeAreaQty(dimLength, dimBreadth, dimPcs) : NaN;
        const quantityInput = Math.max(0, num(it?.quantity, 0));
        const quantity = isArea ? convertAreaQty(qtyInputUnit, inputUnit, poDimUnit) : quantityInput;

        return {
          itemId,
          quantity: Math.max(0, quantity),
          rate: Math.max(0, num(it?.rate, 0)),
          taxPercent: Math.max(0, num(it?.taxPercent, 0)),
          dimLength: isArea ? round2(dimLength) : null,
          dimBreadth: isArea ? round2(dimBreadth) : null,
          dimPcs: isArea ? Math.trunc(Number(dimPcs)) : null,
          dimInputUnit: isArea ? inputUnit : null,
          poDimUnit: isArea ? String(poDimUnit).trim().toLowerCase() : null,
          isArea,
          qtyInputUnit,
        };
      })
      .filter((it) => it && it.itemId && it.quantity > 0);
    if (!normalizedItems.length) return res.status(400).json({ error: 'No valid invoice items' });

    for (const it of normalizedItems) {
      if (it.isArea) {
        if (!it.poDimUnit) return res.status(400).json({ error: 'PO is missing dimension unit for area-unit invoice item' });
        if (it.dimInputUnit !== 'ft' && it.dimInputUnit !== 'm') return res.status(400).json({ error: 'Invalid invoice input unit for area-unit item' });
        if (!Number.isFinite(it.qtyInputUnit) || it.qtyInputUnit <= 0) return res.status(400).json({ error: 'Each area-unit invoice item requires valid length, breadth and PCs' });
        if (!Number.isFinite(it.quantity) || it.quantity <= 0) return res.status(400).json({ error: 'Invalid converted invoice quantity for area-unit item' });
      }
    }

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
          payment_mode=COALESCE(?, payment_mode), tally_entry_date=COALESCE(?, tally_entry_date),
          document_url=COALESCE(?, document_url), cn_copy_url=COALESCE(?, cn_copy_url),
          eway_bill_url=COALESCE(?, eway_bill_url), eway_bill_number=COALESCE(?, eway_bill_number),
          cn_number=COALESCE(?, cn_number), courier_number=COALESCE(?, courier_number),
          transporter_name=COALESCE(?, transporter_name),
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
        paymentMode,
        tallyEntryDate || null,
        documentUrl !== undefined ? documentUrl : null,
        cnCopyUrl !== undefined ? cnCopyUrl : null,
        ewayBillUrl !== undefined ? ewayBillUrl : null,
        ewayBillNumber !== undefined ? ewayBillNumber : null,
        cnNumber !== undefined ? cnNumber : null,
        courierNumber !== undefined ? courierNumber : null,
        transporterName !== undefined ? transporterName : null,
        updatedBy,
        invoiceId,
      ]
    );

    for (const it of normalizedItems) {
      await pool.query(
        `
        INSERT INTO invoice_items (id, invoice_id, item_id, quantity, rate, tax_percent, created_by, created_at, updated_by, updated_at, dim_length, dim_breadth, dim_pcs, dim_input_unit)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE quantity=VALUES(quantity), rate=VALUES(rate), tax_percent=VALUES(tax_percent), updated_by=VALUES(updated_by), updated_at=NOW(),
          dim_length=VALUES(dim_length), dim_breadth=VALUES(dim_breadth), dim_pcs=VALUES(dim_pcs), dim_input_unit=VALUES(dim_input_unit)
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
          it.isArea ? it.dimLength : null,
          it.isArea ? it.dimBreadth : null,
          it.isArea ? it.dimPcs : null,
          it.isArea ? it.dimInputUnit : null,
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
	    try {
	      await pool.query('ALTER TABLE po_advance_invoice_adjustments DROP INDEX uniq_invoice');
	    } catch {}
	    const invoiceId = String(req.params.id ?? '').trim();
	    if (!invoiceId) return res.status(400).json({ error: 'invoice id is required' });
	    const paymentDate = String(req.body?.paymentDate ?? '').trim();
	    const paymentAmountRaw = req.body?.paymentAmount;
	    const paymentAmount = Number(paymentAmountRaw ?? 0);
	    const adjustedAmountRaw = req.body?.adjustedAmount;
	    const adjustedAmountInput = adjustedAmountRaw == null ? null : Number(adjustedAmountRaw);
	    const paymentMode = req.body?.paymentMode != null ? String(req.body.paymentMode).trim() : null;
	    const paymentCopy = req.body?.paymentCopy != null ? String(req.body.paymentCopy).trim() : null;
	    const debitNoteQtyRaw = req.body?.debitNoteQty;
	    const debitNoteQty = debitNoteQtyRaw == null ? null : Number(debitNoteQtyRaw);
	    const debitNoteReason = req.body?.debitNoteReason != null ? String(req.body.debitNoteReason).trim() : null;
	    const tallyEntryDate = req.body?.tallyEntryDate != null ? String(req.body.tallyEntryDate).trim() : null;
	    const updatedBy = String(req.body?.updatedBy ?? '').trim() || null;
	    if (!paymentDate) return res.status(400).json({ error: 'paymentDate is required' });
	    if (!paymentMode) return res.status(400).json({ error: 'paymentMode is required' });
	    if (!Number.isFinite(paymentAmount) || paymentAmount < 0) return res.status(400).json({ error: 'paymentAmount must be 0 or more' });
	    if (adjustedAmountInput != null && (!Number.isFinite(adjustedAmountInput) || adjustedAmountInput < 0))
	      return res.status(400).json({ error: 'adjustedAmount must be 0 or more' });
	    if (paymentMode === 'Debit Note') {
	      if (debitNoteQty == null || !Number.isFinite(debitNoteQty) || debitNoteQty <= 0) {
	        return res.status(400).json({ error: 'debitNoteQty must be greater than 0 for Debit Note' });
	      }
	      if (!debitNoteReason) return res.status(400).json({ error: 'debitNoteReason is required for Debit Note' });
	    }
	    const [[invMeta]] = await pool.query(
	      `
	      SELECT inv.total_amount AS invoiceAmount, COALESCE(adj.adjustedAmount, 0) AS adjustedAmount
	      FROM invoices inv
      LEFT JOIN (
        SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS adjustedAmount
        FROM po_advance_invoice_adjustments
        WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
           OR (receipt_type IS NULL AND (payment_mode IS NULL OR TRIM(payment_mode) = ''))
        GROUP BY invoice_id
      ) adj ON adj.invoiceId = inv.id
      WHERE inv.id = ?
      LIMIT 1
      `,
      [invoiceId]
    );
	    if (!invMeta) return res.status(404).json({ error: 'Invoice not found' });
	    const invoiceAmount = Number(invMeta.invoiceAmount ?? 0);
	    const adjustedAmount =
	      adjustedAmountInput != null ? Math.max(0, adjustedAmountInput) : Number(invMeta.adjustedAmount ?? 0);
	    const actualPaymentAmount = paymentMode === 'Debit Note' ? 0 : Math.max(0, paymentAmount);
	    const debitNoteAmount = paymentMode === 'Debit Note' ? Math.max(0, paymentAmount) : 0;
	    const totalPaidInitial = adjustedAmount + actualPaymentAmount + debitNoteAmount;
		    const paymentStatusInitial = totalPaidInitial >= invoiceAmount - 1e-9 ? 'Full Paid' : 'Partly Paid';
		    await pool.query(
		      `UPDATE invoices
		       SET payment_status=?, payment_date=?, payment_amount=?, payment_mode=COALESCE(?, payment_mode),
		           debit_note_qty=COALESCE(?, debit_note_qty),
		           debit_note_amount=COALESCE(?, debit_note_amount),
		           debit_note_reason=COALESCE(?, debit_note_reason),
		           tally_entry_date=COALESCE(?, tally_entry_date), updated_by=?, updated_at=NOW()
		       WHERE id=?`,
		      [
		        paymentStatusInitial,
		        paymentDate,
		        actualPaymentAmount,
		        paymentMode || null,
		        paymentMode === 'Debit Note' ? debitNoteQty : null,
		        // Debit note amounts must be stored as DIRECT_PAYMENT receipts; keep invoice column at 0 to avoid double counting.
		        paymentMode === 'Debit Note' ? 0 : null,
		        paymentMode === 'Debit Note' ? debitNoteReason : null,
		        tallyEntryDate || null,
		        updatedBy,
		        invoiceId,
		      ]
		    );

    // If client provided adjusted total, append only the positive delta as a new ledger row.
    if (adjustedAmountInput != null) {
      const [[poRow]] = await pool.query('SELECT po_id AS poId FROM invoices WHERE id = ? LIMIT 1', [invoiceId]);
      const poId = poRow?.poId != null ? String(poRow.poId) : '';
      const currentAdjusted = Number(invMeta.adjustedAmount ?? 0);
      if (adjustedAmount + 1e-9 < currentAdjusted) {
        return res.status(400).json({ error: 'Adjusted amount cannot be reduced. Ledger rows are append-only.' });
      }
      const deltaAdjusted = Math.max(0, adjustedAmount - currentAdjusted);
      if (poId && deltaAdjusted > 1e-9) {
        try {
          await pool.query(
            `
            INSERT INTO po_advance_invoice_adjustments
              (id, po_id, invoice_id, adjusted_amount, receipt_type, reference_type, entry_key, created_by, updated_by)
            VALUES (?, ?, ?, ?, 'ADVANCE_ADJUSTMENT', 'INVOICE', ?, ?, ?)
            `,
            [crypto.randomUUID(), poId, invoiceId, deltaAdjusted, crypto.randomUUID(), updatedBy || 'system', updatedBy || 'system']
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.toLowerCase().includes('uniq_invoice') || msg.toLowerCase().includes('duplicate entry')) {
            await pool.query(
              `
              UPDATE po_advance_invoice_adjustments
              SET adjusted_amount = COALESCE(adjusted_amount, 0) + ?,
                  receipt_type = 'ADVANCE_ADJUSTMENT',
                  reference_type = 'INVOICE',
                  updated_by = ?,
                  updated_at = NOW()
              WHERE po_id = ? AND invoice_id = ?
              LIMIT 1
              `,
              [deltaAdjusted, updatedBy || 'system', poId, invoiceId]
            );
          } else {
            throw e;
          }
        }
      }
    }
	    if (actualPaymentAmount > 1e-9 || debitNoteAmount > 1e-9) {
	      const [[poRow]] = await pool.query('SELECT po_id AS poId FROM invoices WHERE id = ? LIMIT 1', [invoiceId]);
	      const poId = poRow?.poId != null ? String(poRow.poId) : '';
	      if (poId) {
	        try {
	          await pool.query(
	            `
	            INSERT INTO po_advance_invoice_adjustments
	              (id, po_id, invoice_id, adjusted_amount, payment_mode, payment_copy, receipt_type, reference_type, entry_key, created_by, updated_by)
	            VALUES (?, ?, ?, ?, ?, ?, 'DIRECT_PAYMENT', 'INVOICE', ?, ?, ?)
	            `,
	            [
	              crypto.randomUUID(),
	              poId,
	              invoiceId,
	              paymentMode === 'Debit Note' ? debitNoteAmount : actualPaymentAmount,
	              paymentMode || null,
	              paymentMode === 'Debit Note' ? null : paymentCopy || null,
	              crypto.randomUUID(),
	              updatedBy || 'system',
	              updatedBy || 'system',
	            ]
	          );
	        } catch (e) {
	          const msg = e instanceof Error ? e.message : String(e);
	          if (msg.toLowerCase().includes('uniq_invoice') || msg.toLowerCase().includes('duplicate entry')) {
	            // Legacy DB: merge direct payments into the single existing row.
	            await pool.query(
	              `
	              UPDATE po_advance_invoice_adjustments
	              SET adjusted_amount = COALESCE(adjusted_amount, 0) + ?,
	                  payment_mode = COALESCE(?, payment_mode),
	                  payment_copy = COALESCE(?, payment_copy),
	                  receipt_type = 'DIRECT_PAYMENT',
	                  reference_type = 'INVOICE',
	                  updated_by = ?,
	                  updated_at = NOW()
	              WHERE po_id = ? AND invoice_id = ?
	              LIMIT 1
	              `,
	              [
	                paymentMode === 'Debit Note' ? debitNoteAmount : actualPaymentAmount,
	                paymentMode || null,
	                paymentMode === 'Debit Note' ? null : paymentCopy || null,
	                updatedBy || 'system',
	                poId,
	                invoiceId,
	              ]
	            );
	          } else {
	            throw e;
	          }
	        }
	      }
	    }

	    // Refresh payment_status after inserting payment/debit-note receipt rows.
	    const [[totalsRow]] = await pool.query(
	      `
	      SELECT
	        inv.total_amount AS invoiceAmount,
	        COALESCE(adj.adjustedAmount, 0) AS adjustedAmount,
	        COALESCE(rec.actualReceiptAmount, 0) AS actualReceiptAmount
	      FROM invoices inv
	      LEFT JOIN (
	        SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS adjustedAmount
	        FROM po_advance_invoice_adjustments
	        WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
	        GROUP BY invoice_id
	      ) adj ON adj.invoiceId = inv.id
	      LEFT JOIN (
	        SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS actualReceiptAmount
	        FROM po_advance_invoice_adjustments
	        WHERE receipt_type = 'DIRECT_PAYMENT'
	        GROUP BY invoice_id
	      ) rec ON rec.invoiceId = inv.id
	      WHERE inv.id = ?
	      LIMIT 1
	      `,
	      [invoiceId]
	    );
	    if (totalsRow) {
	      const invAmt = Number(totalsRow.invoiceAmount ?? 0);
	      const totalPaid = Number(totalsRow.adjustedAmount ?? 0) + Number(totalsRow.actualReceiptAmount ?? 0);
	      const paymentStatus = totalPaid >= invAmt - 1e-9 ? 'Full Paid' : totalPaid > 1e-9 ? 'Partly Paid' : null;
	      await pool.query(`UPDATE invoices SET payment_status=?, updated_at=NOW() WHERE id=?`, [paymentStatus, invoiceId]);
	    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/credit-vouchers/:id/receipts', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const cvId = req.params.id;

    const [rows] = await pool.query(
      `
      SELECT
        id,
        po_id AS poId,
        invoice_id AS invoiceId,
        adjusted_amount AS amount,
        payment_mode AS paymentMode,
        payment_copy AS paymentCopy,
        receipt_type AS receiptType,
        reference_type AS referenceType,
        created_by AS createdBy,
        created_at AS createdAt,
        updated_by AS updatedBy,
        updated_at AS updatedAt
      FROM po_advance_invoice_adjustments
      WHERE entry_key = ? AND reference_type = 'CREDIT_VOUCHER'
      ORDER BY created_at DESC, updated_at DESC
      `,
      [cvId]
    );

    const receipts = (Array.isArray(rows) ? rows : []).map((r) => ({
      id: String(r.id ?? ''),
      poId: String(r.poId ?? ''),
      invoiceId: String(r.invoiceId ?? ''),
      amount: Number(r.amount ?? 0),
      paymentMode: r.paymentMode != null ? String(r.paymentMode) : '',
      paymentCopy: r.paymentCopy != null ? String(r.paymentCopy) : '',
      receiptType: r.receiptType != null ? String(r.receiptType) : 'ADVANCE_ADJUSTMENT',
      referenceType: r.referenceType != null ? String(r.referenceType) : '',
      createdBy: r.createdBy != null ? String(r.createdBy) : '',
      createdAt: toIsoDateTime(r.createdAt) || '',
      updatedBy: r.updatedBy != null ? String(r.updatedBy) : '',
      updatedAt: toIsoDateTime(r.updatedAt) || '',
    }));

    const totals = receipts.reduce(
      (acc, x) => {
        if (String(x.receiptType) === 'DIRECT_PAYMENT') acc.actualReceiptAmount += Number(x.amount ?? 0);
        else acc.adjustedAmount += Number(x.amount ?? 0);
        return acc;
      },
      { adjustedAmount: 0, actualReceiptAmount: 0 }
    );

    res.json({ receipts, totals });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/invoices/:id/receipts', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'invoice id is required' });

    const [rows] = await pool.query(
      `
      SELECT
        id,
        po_id AS poId,
        invoice_id AS invoiceId,
        adjusted_amount AS amount,
        payment_mode AS paymentMode,
        payment_copy AS paymentCopy,
        receipt_type AS receiptType,
        reference_type AS referenceType,
        created_by AS createdBy,
        created_at AS createdAt,
        updated_by AS updatedBy,
        updated_at AS updatedAt
      FROM po_advance_invoice_adjustments
      WHERE invoice_id = ?
      ORDER BY created_at DESC, updated_at DESC
      `,
      [invoiceId]
    );

    const receipts = (Array.isArray(rows) ? rows : []).map((r) => ({
      id: String(r.id ?? ''),
      poId: String(r.poId ?? ''),
      invoiceId: String(r.invoiceId ?? ''),
      amount: Number(r.amount ?? 0),
      paymentMode: r.paymentMode != null ? String(r.paymentMode) : '',
      paymentCopy: r.paymentCopy != null ? String(r.paymentCopy) : '',
      receiptType: r.receiptType != null ? String(r.receiptType) : 'ADVANCE_ADJUSTMENT',
      referenceType: r.referenceType != null ? String(r.referenceType) : '',
      createdBy: r.createdBy != null ? String(r.createdBy) : '',
      createdAt: toIsoDateTime(r.createdAt) || '',
      updatedBy: r.updatedBy != null ? String(r.updatedBy) : '',
      updatedAt: toIsoDateTime(r.updatedAt) || '',
    }));

    const totals = receipts.reduce(
      (acc, x) => {
        if (String(x.receiptType) === 'DIRECT_PAYMENT') acc.actualReceiptAmount += Number(x.amount ?? 0);
        else acc.adjustedAmount += Number(x.amount ?? 0);
        return acc;
      },
      { adjustedAmount: 0, actualReceiptAmount: 0 }
    );

    res.json({ receipts, totals });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/receipts/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });

    const [[row]] = await pool.query(
      'SELECT id, invoice_id AS invoiceId FROM po_advance_invoice_adjustments WHERE id = ? LIMIT 1',
      [id]
    );
    if (!row?.id) return res.status(404).json({ error: 'Receipt row not found' });

    await pool.query('DELETE FROM po_advance_invoice_adjustments WHERE id = ? LIMIT 1', [id]);
    const invoiceId = String(row.invoiceId ?? '');
    if (invoiceId) {
      // Keep invoice aggregates/status in sync after receipt deletion.
      const [[totalsRow]] = await pool.query(
        `
        SELECT
          inv.total_amount AS invoiceAmount,
          COALESCE(adj.adjustedAmount, 0) AS adjustedAmount,
          COALESCE(pay.nonDebitPaid, 0) AS nonDebitPaid,
          COALESCE(pay.debitNotePaid, 0) AS debitNotePaid
        FROM invoices inv
        LEFT JOIN (
          SELECT invoice_id AS invoiceId, SUM(adjusted_amount) AS adjustedAmount
          FROM po_advance_invoice_adjustments
          WHERE receipt_type = 'ADVANCE_ADJUSTMENT'
          GROUP BY invoice_id
        ) adj ON adj.invoiceId = inv.id
        LEFT JOIN (
          SELECT
            invoice_id AS invoiceId,
            SUM(CASE WHEN LOWER(TRIM(payment_mode)) = 'debit note' THEN 0 ELSE adjusted_amount END) AS nonDebitPaid,
            SUM(CASE WHEN LOWER(TRIM(payment_mode)) = 'debit note' THEN adjusted_amount ELSE 0 END) AS debitNotePaid
          FROM po_advance_invoice_adjustments
          WHERE receipt_type = 'DIRECT_PAYMENT'
          GROUP BY invoice_id
        ) pay ON pay.invoiceId = inv.id
        WHERE inv.id = ?
        LIMIT 1
        `,
        [invoiceId]
      );

      if (totalsRow) {
        const invoiceAmount = Number(totalsRow.invoiceAmount ?? 0);
        const adjustedAmount = Number(totalsRow.adjustedAmount ?? 0);
        const nonDebitPaid = Number(totalsRow.nonDebitPaid ?? 0);
        const debitNotePaid = Number(totalsRow.debitNotePaid ?? 0);
        const grandPaid = adjustedAmount + nonDebitPaid + debitNotePaid;
        const paymentStatus = grandPaid >= invoiceAmount - 1e-9 ? 'Full Paid' : grandPaid > 1e-9 ? 'Partly Paid' : null;

        await pool.query(
          `
          UPDATE invoices
          SET payment_amount = ?, debit_note_amount = ?, payment_status = ?, updated_at = NOW()
          WHERE id = ?
          `,
          [Math.max(0, nonDebitPaid), Math.max(0, debitNotePaid), paymentStatus, invoiceId]
        );
      }
    }
    res.json({ ok: true, invoiceId });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/invoices/:id/approve-entry', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'invoice id is required' });
    const approvedBy = String(req.body?.approvedBy ?? '').trim();
    const approveDate = String(req.body?.approveDate ?? '').trim();
    if (!approvedBy) return res.status(400).json({ error: 'approvedBy is required' });
    if (!approveDate) return res.status(400).json({ error: 'approveDate is required' });
    await pool.query(
      `UPDATE invoices
       SET approved_by=?, approved_at=?, status='approved', updated_by=?, updated_at=NOW()
       WHERE id=?`,
      [approvedBy, approveDate, approvedBy, invoiceId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/invoices/:id/tally-entry', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const invoiceId = String(req.params.id ?? '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'invoice id is required' });
    const tallyEntryDate = String(req.body?.tallyEntryDate ?? '').trim();
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || null;
    if (!tallyEntryDate) return res.status(400).json({ error: 'tallyEntryDate is required' });
    await pool.query(
      `UPDATE invoices SET tally_entry_date=?, updated_by=?, updated_at=NOW() WHERE id=?`,
      [tallyEntryDate, updatedBy, invoiceId]
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

function setStaticCacheHeaders(res, filePath) {
  if (filePath.endsWith('index.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return;
  }
  if (/\.[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }
  res.setHeader('Cache-Control', 'no-cache');
}

app.use(express.static(distDir, { dotfiles: 'allow', index: false, setHeaders: setStaticCacheHeaders }));

// Ensure missing API routes don't fall back to SPA HTML (which breaks JSON parsing in the client).

// --- Courier Tracking ---
const COURIER_STATUSES = new Set(['In Progress', 'Received', 'Cancel']);
function normalizeCourierStatus(value, fallback = 'In Progress') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'received') return 'Received';
  if (raw === 'cancel' || raw === 'cancelled' || raw === 'canceled') return 'Cancel';
  if (raw === 'in progress' || raw === 'progress' || raw === '') return fallback;
  return fallback;
}
function courierDateIso(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
function mapCourierRow(r) {
  return {
    id: String(r.id ?? ''),
    date: courierDateIso(r.date),
    courierNo: String(r.courierNo ?? ''),
    courierCompany: r.courierCompany != null ? String(r.courierCompany) : '',
    supplierId: r.supplierId != null ? String(r.supplierId) : '',
    supplierName: r.supplierName != null ? String(r.supplierName) : '',
    projectId: r.projectId != null ? String(r.projectId) : '',
    projectName: r.projectName != null ? String(r.projectName) : '',
    poId: r.poId != null ? String(r.poId) : '',
    poNumber: r.poNumber != null ? String(r.poNumber) : '',
    courierCopyUrl: r.courierCopyUrl != null ? String(r.courierCopyUrl) : '',
    expectedDate: courierDateIso(r.expectedDate),
    status: normalizeCourierStatus(r.status),
    lastUpdateDate: courierDateIso(r.lastUpdateDate),
    lastUpdateBy: r.lastUpdateBy != null ? String(r.lastUpdateBy) : '',
    lastUpdateRemarks: r.lastUpdateRemarks != null ? String(r.lastUpdateRemarks) : '',
    createdAt: r.createdAt ? String(r.createdAt) : '',
    updatedAt: r.updatedAt ? String(r.updatedAt) : '',
  };
}
async function selectCourierRows(pool, whereSql = '', params = []) {
  const [rows] = await pool.query(
    `
    SELECT
      c.id,
      c.courier_date AS date,
      c.courier_no AS courierNo,
      c.courier_company AS courierCompany,
      c.supplier_id AS supplierId,
      s.name AS supplierName,
      c.project_id AS projectId,
      p.name AS projectName,
      c.po_id AS poId,
      po.po_number AS poNumber,
      c.courier_copy_url AS courierCopyUrl,
      c.expected_date AS expectedDate,
      c.status,
      c.last_update_date AS lastUpdateDate,
      c.last_update_by AS lastUpdateBy,
      c.last_update_remarks AS lastUpdateRemarks,
      c.created_at AS createdAt,
      c.updated_at AS updatedAt
    FROM couriers c
    LEFT JOIN suppliers s ON CONVERT(s.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.supplier_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    LEFT JOIN projects p ON CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.project_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    LEFT JOIN purchase_orders po ON CONVERT(po.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.po_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    ${whereSql}
    ORDER BY c.courier_date DESC, c.created_at DESC
    `,
    params
  );
  return (Array.isArray(rows) ? rows : []).map(mapCourierRow);
}

app.get('/api/couriers', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    res.json({ couriers: await selectCourierRows(pool) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/couriers/pending-receipt', async (_req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    res.json({ couriers: await selectCourierRows(pool, 'WHERE CONVERT(c.status USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?', ['In Progress']) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/couriers', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const courierDate = String(req.body?.date ?? '').slice(0, 10);
    const courierNo = String(req.body?.courierNo ?? '').trim();
    const courierCompany = String(req.body?.courierCompany ?? '').trim();
    const supplierId = String(req.body?.supplierId ?? '').trim();
    const projectId = String(req.body?.projectId ?? '').trim() || null;
    const poId = String(req.body?.poId ?? '').trim() || null;
    const courierCopyUrl = req.body?.courierCopyUrl != null ? String(req.body.courierCopyUrl).trim() || null : null;
    const expectedDate = String(req.body?.expectedDate ?? '').slice(0, 10);
    const createdBy = req.body?.createdBy != null ? String(req.body.createdBy).trim() : null;
    if (!courierDate) return res.status(400).json({ error: 'Date is required' });
    if (!courierNo) return res.status(400).json({ error: 'Courier No. is required' });
    if (!courierCompany) return res.status(400).json({ error: 'Courier Company is required' });
    if (!supplierId) return res.status(400).json({ error: 'Supplier is required' });
    if (!expectedDate) return res.status(400).json({ error: 'Expected Date is required' });
    const id = crypto.randomUUID();
    await pool.query(
      `
      INSERT INTO couriers
        (id, courier_date, courier_no, courier_company, supplier_id, project_id, po_id, courier_copy_url, expected_date, status, last_update_date, last_update_by, last_update_remarks, created_by, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Progress', NULL, NULL, NULL, ?, NOW(), NOW())
      `,
      [id, courierDate, courierNo, courierCompany, supplierId, projectId, poId, courierCopyUrl, expectedDate, createdBy]
    );
    const rows = await selectCourierRows(pool, 'WHERE c.id = ?', [id]);
    res.status(201).json({ courier: rows[0] ?? null });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/couriers/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const courierId = String(req.params.id ?? '').trim();
    if (!courierId) return res.status(400).json({ error: 'id is required' });
    await pool.query('DELETE FROM courier_updates WHERE courier_id = ?', [courierId]);
    const [result] = await pool.query('DELETE FROM couriers WHERE id = ? LIMIT 1', [courierId]);
    if (!result || Number(result.affectedRows ?? 0) === 0) return res.status(404).json({ error: 'Courier not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/couriers/:id/updates', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const courierId = String(req.params.id ?? '').trim();
    if (!courierId) return res.status(400).json({ error: 'id is required' });
    const [rows] = await pool.query(
      `
      SELECT id, courier_id AS courierId, update_date AS updateDate, updated_by AS updatedBy, status, remarks, update_photo_url AS updatePhotoUrl, received_by AS receivedBy, received_date AS receivedDate, created_at AS createdAt
      FROM courier_updates
      WHERE courier_id = ?
      ORDER BY update_date DESC, created_at DESC
      `,
      [courierId]
    );
    res.json({ updates: (Array.isArray(rows) ? rows : []).map((r) => ({
      id: String(r.id ?? ''),
      courierId: String(r.courierId ?? ''),
      updateDate: courierDateIso(r.updateDate),
      updatedBy: r.updatedBy != null ? String(r.updatedBy) : '',
      status: normalizeCourierStatus(r.status),
      remarks: r.remarks != null ? String(r.remarks) : '',
      updatePhotoUrl: r.updatePhotoUrl != null ? String(r.updatePhotoUrl) : '',
      receivedBy: r.receivedBy != null ? String(r.receivedBy) : '',
      receivedDate: courierDateIso(r.receivedDate),
      createdAt: r.createdAt ? String(r.createdAt) : '',
    })) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/couriers/:id/updates', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    const courierId = String(req.params.id ?? '').trim();
    const updateDate = String(req.body?.updateDate ?? '').slice(0, 10);
    const updatedBy = String(req.body?.updatedBy ?? '').trim();
    const status = normalizeCourierStatus(req.body?.status);
    const remarks = req.body?.remarks != null ? String(req.body.remarks).trim() : '';
    const updatePhotoUrl = req.body?.updatePhotoUrl != null ? String(req.body.updatePhotoUrl).trim() : '';
    const receivedBy = req.body?.receivedBy != null ? String(req.body.receivedBy).trim() : '';
    const receivedDate = req.body?.receivedDate != null ? String(req.body.receivedDate).slice(0, 10) : '';
    if (!courierId) return res.status(400).json({ error: 'id is required' });
    if (!updateDate) return res.status(400).json({ error: 'Update Date is required' });
    if (!updatedBy) return res.status(400).json({ error: 'Update By is required' });
    if (!COURIER_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });
    if (status === 'In Progress' && !remarks) return res.status(400).json({ error: 'Remarks are required for In Progress status' });
    if (status === 'Received' && !receivedBy) return res.status(400).json({ error: 'Received By is required for Received status' });
    if (status === 'Received' && !receivedDate) return res.status(400).json({ error: 'Received Date is required for Received status' });
    const [existingRows] = await pool.query('SELECT id FROM couriers WHERE id = ? LIMIT 1', [courierId]);
    if (!Array.isArray(existingRows) || !existingRows.length) return res.status(404).json({ error: 'Courier not found' });
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO courier_updates (id, courier_id, update_date, updated_by, status, remarks, update_photo_url, received_by, received_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [id, courierId, updateDate, updatedBy, status, remarks || null, updatePhotoUrl || null, receivedBy || null, status === 'Received' ? receivedDate : null]
    );
    await pool.query(
      `UPDATE couriers SET status=?, last_update_date=?, last_update_by=?, last_update_remarks=?, updated_at=NOW() WHERE id=?`,
      [status, updateDate, updatedBy, remarks || null, courierId]
    );
    const rows = await selectCourierRows(pool, 'WHERE c.id = ?', [courierId]);
    res.status(201).json({ courier: rows[0] ?? null });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// SPA fallback (React Router / client-side routes).
app.use((_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const indexPath = path.join(distDir, 'index.html');
  res.sendFile(indexPath, { dotfiles: 'allow' }, (error) => {
    if (!error) return;
    console.error(`Unable to serve frontend index ${indexPath}: ${error.code ?? 'unknown'} ${error.message}`);
    if (!res.headersSent) res.status(error.statusCode ?? 500).send('Unable to serve frontend build output. Check the application runtime log.');
  });
});

app.listen(port, () => {
  // Keep log simple for Hostinger runtime logs.
  console.log(`Server listening on port ${port}`);
  void runScheduledSpecValueRepair();
  const repairTimer = setInterval(() => void runScheduledSpecValueRepair(), SPEC_VALUE_REPAIR_INTERVAL_MS);
  repairTimer.unref?.();
});
