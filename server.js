import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

// Lightweight process-level health check (no DB dependency).
app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'ims-umang',
    timestamp: new Date().toISOString(),
  });
});

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

      await ensureColumn('purchase_orders', 'advance_amount', 'DOUBLE NOT NULL DEFAULT 0');
      await ensureColumn('purchase_orders', 'advance_date', 'DATE NULL');
      await ensureColumn('purchase_orders', 'payment_type', 'VARCHAR(32) NULL');
      await ensureColumn('purchase_orders', 'payment_mode', 'VARCHAR(32) NULL');
      await ensureColumn('purchase_orders', 'cancel_reason', 'TEXT NULL');
      await ensureColumn('purchase_orders', 'cancelled_by', 'VARCHAR(255) NULL');
      await ensureColumn('purchase_orders', 'cancelled_at', 'DATETIME NULL');

      await ensureColumn('purchase_order_items', 'cancelled_qty', 'DOUBLE NOT NULL DEFAULT 0');
      await ensureColumn('purchase_order_items', 'cancel_reason', 'TEXT NULL');

      await pool.query(`
        CREATE TABLE IF NOT EXISTS po_advances (
          id VARCHAR(255) PRIMARY KEY,
          po_id VARCHAR(255) NOT NULL,
          advance_date DATE NOT NULL,
          advance_amount DOUBLE NOT NULL DEFAULT 0,
          payment_mode VARCHAR(32) NULL,
          payment_copy TEXT NULL,
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

      await ensureColumn('users', 'login_id', 'VARCHAR(255) NULL');
      await ensureColumn('users', 'menu_access', 'TEXT NULL');
      await ensureColumn('users', 'is_deleted', 'TINYINT NOT NULL DEFAULT 0');
      await ensureColumn('users', 'deleted_at', 'DATETIME NULL');
      await ensureColumn('users', 'deleted_by', 'VARCHAR(255) NULL');
      await ensureColumn('purchase_requisition_items', 'priority_id', 'VARCHAR(255) NULL');

      // Spec values are now scoped by Item Name + Specification (item_name_id may be NULL for legacy/global values).
      await ensureColumn('specification_values', 'item_name_id', 'VARCHAR(255) NULL');

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
	      await ensureColumn('suppliers', 'catalogue_link', 'TEXT NULL');
        await ensureColumn('suppliers', 'contact_person', 'VARCHAR(255) NULL');
        await ensureColumn('suppliers', 'contact_person_mobile', 'VARCHAR(32) NULL');
        await ensureColumn('suppliers', 'city', 'VARCHAR(255) NULL');
        await ensureColumn('suppliers', 'state', 'VARCHAR(255) NULL');
	      await ensureColumn('suppliers', 'mobile_2', 'VARCHAR(32) NULL');
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
	      await ensureColumn('items', 'opening_stock', 'DOUBLE NOT NULL DEFAULT 0');
	      await ensureColumn('material_requests', 'firm_id', 'VARCHAR(255) NULL');
	      await ensureColumn('material_requests', 'store_id', 'VARCHAR(255) NULL');
	      await ensureColumn('material_requests', 'department', 'VARCHAR(255) NULL');
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
      pri.requested_qty AS quantity,
      COALESCE(pri.approved_qty, pri.requested_qty) AS approvedQty,
      pri.priority_id AS priorityId,
      p.name AS priority,
      pri.remarks AS specification
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
    quantity: Number(r.quantity ?? 0),
    approvedQty: Number(r.approvedQty ?? r.quantity ?? 0),
    priorityId: r.priorityId ? String(r.priorityId) : null,
    priority: r.priority ? String(r.priority) : null,
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
	        pri.requested_qty AS quantity,
	        COALESCE(pri.approved_qty, pri.requested_qty) AS approvedQty,
          pri.priority_id AS priorityId,
          p.name AS priority,
        pri.remarks AS specification
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
		      quantity: Number(r.quantity ?? 0),
		      approvedQty: Number(r.approvedQty ?? r.quantity ?? 0),
          priorityId: r.priorityId ? String(r.priorityId) : null,
          priority: r.priority ? String(r.priority) : null,
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
	        COALESCE(pri.approved_qty, pri.requested_qty) AS approvedQty,
          pri.priority_id AS priorityId,
          p.name AS priority,
        pri.remarks AS specification
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
		      quantity: Number(r.quantity ?? 0),
		      approvedQty: Number(r.approvedQty ?? r.quantity ?? 0),
          priorityId: r.priorityId ? String(r.priorityId) : null,
          priority: r.priority ? String(r.priority) : null,
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
	        COALESCE(SUM(GREATEST(0, COALESCE(poi.quantity, 0) - COALESCE(grnq.grnQty, 0))), 0) AS pendingQty
	      FROM purchase_orders po
	      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
	      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.id
	      LEFT JOIN priorities p ON p.id = pri.priority_id
	      LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
      LEFT JOIN (
        SELECT g.po_id AS poId, gi.item_id AS itemId, SUM(gi.received_qty) AS grnQty
        FROM grns g
        INNER JOIN grn_items gi ON gi.grn_id = g.id
        GROUP BY g.po_id, gi.item_id
      ) grnq ON grnq.poId = poi.po_id AND grnq.itemId = poi.item_id
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
        COALESCE(adj.adjustedAmount, 0) AS adjustedAmount
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
           OR (receipt_type IS NULL AND (payment_mode IS NULL OR TRIM(payment_mode) = ''))
        GROUP BY invoice_id
      ) adj ON adj.invoiceId = inv.id
      WHERE ${where.join(' AND ')}
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `,
      params
    );

    let out = (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const invoiceAmount = Number(r.invoiceAmount ?? 0);
        const adjustedAmount = Number(r.adjustedAmount ?? 0);
        const paymentAmount = Number(r.paymentAmount ?? 0);
        const paymentStatus = String(r.paymentStatus ?? '').toLowerCase();
        const paymentMode = r.paymentMode != null ? String(r.paymentMode) : 'Credit';
        const paymentModeLower = paymentMode.trim().toLowerCase();
        const tallyEntryDate = toIsoDate(r.tallyEntryDate) || undefined;

        const isFull = paymentStatus.includes('full');
        const paidAmount = Math.max(0, paymentAmount);
        const remainingAmount = isFull ? 0 : Math.max(0, invoiceAmount - adjustedAmount - paidAmount);
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
      // Invoice is due for payment only when fully linked against GRN qty.
      .filter((x) => x.totalInvoiceQty > 0 && Math.abs(x.totalInvoiceQty - x.totalLinkedQty) <= 1e-9)
      // Show only invoices where all invoice qty is QC-approved (invoice qty <= approved qty for each item).
      // `totalApprovedQty` is computed as SUM(LEAST(invoiceQty, approvedQty)) so equality means fully approved.
      .filter((x) => x.totalInvoiceQty > 0 && Math.abs(x.totalInvoiceQty - x.totalApprovedQty) <= 1e-9)
      // Only "accounted" invoices become due for payment.
      // If tally_entry_date column exists, require it to be set.
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
        po.po_number AS poNumber,
        f.name AS firmName,
        s.name AS supplierName,
        COALESCE(invq.totalInvoiceQty, 0) AS totalInvoiceQty,
        COALESCE(qcq.totalApprovedQty, 0) AS totalApprovedQty
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
      WHERE inv.id = ?
      LIMIT 1
      `,
      [invoiceId]
    );

    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r) return res.status(404).json({ error: 'Invoice not found' });

    const invoiceAmount = Number(r.invoiceAmount ?? 0);
    const paymentStatusLower = String(r.paymentStatus ?? '').toLowerCase();
    const paymentMode = r.paymentMode != null ? String(r.paymentMode) : 'Credit';
    const paymentModeLower = paymentMode.trim().toLowerCase();
    const isCash = paymentModeLower === 'cash';
    const isFull = paymentStatusLower.includes('full');
    const paidAmount = isFull ? invoiceAmount : 0;
    const remainingAmount = Math.max(0, invoiceAmount - paidAmount);

    const totalInvoiceQty = Number(r.totalInvoiceQty ?? 0);
    const totalApprovedQty = Number(r.totalApprovedQty ?? 0);
    const tallyEntryDate = toIsoDate(r.tallyEntryDate) || '';

    const failures = [];
    if (!(remainingAmount > 1e-9)) failures.push('Fully paid (remainingAmount is 0)');
    if (isCash) failures.push('Payment mode is Cash (verify partial cash payments are entered correctly)');
    if (!(totalInvoiceQty > 0)) failures.push('No invoice items (totalInvoiceQty is 0)');
    if (!(totalInvoiceQty > 0 && Math.abs(totalInvoiceQty - totalApprovedQty) <= 1e-9)) failures.push('Not fully QC-approved (invoice qty != approved qty)');
    if (hasTallyEntryDate && !tallyEntryDate) failures.push('Tally entry date is empty');

    const eligible =
      remainingAmount > 1e-9 &&
      totalInvoiceQty > 0 &&
      Math.abs(totalInvoiceQty - totalApprovedQty) <= 1e-9 &&
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
        totalApprovedQty,
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

function mapPoStatus(value) {
  const s = String(value ?? '').toLowerCase();
  if (s === 'closed') return 'Closed';
  if (s === 'partial') return 'Partial';
  return 'Open';
}

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
      pri.requested_qty AS quantity,
      pri.priority_id AS priorityId,
      p.name AS priority,
      pri.remarks AS specification
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
      po.po_number AS poNumber,
      po.order_date AS orderDate,
      po.payment_terms AS paymentTerms,
      po.shipping_address AS shippingAddress,
      po.terms_conditions AS termsConditions,
      po.advance_amount AS advanceAmount,
      po.advance_date AS advanceDate,
      po.cancel_reason AS cancelReason,
      po.cancelled_by AS cancelledBy,
      po.cancelled_at AS cancelledAt,
      po.status AS status,
      po.created_by AS createdBy,
      po.created_at AS createdAt,
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

  const [poItemRows] = await pool.query(
    `
    SELECT
      poi.id AS id,
      poi.po_id AS poId,
      poi.item_id AS itemId,
      iname.name AS item,
      it.specifications_json AS specificationsJson,
      poi.quantity AS quantity,
      poi.rate AS rate,
      poi.discount_percent AS discountPercent,
      poi.tax_percent AS taxPercent,
      poi.cancelled_qty AS cancelledQty,
      poi.cancel_reason AS cancelReason,
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
    id: String(poRow.id ?? ''),
    poNumber: poRow.poNumber != null ? String(poRow.poNumber) : undefined,
    prId: String(poRow.prId ?? ''),
    firmId: String(poRow.firmId ?? ''),
    orderDate: toIsoDate(poRow.orderDate) || '',
    paymentTerms: poRow.paymentTerms != null ? String(poRow.paymentTerms) : undefined,
    shippingAddress: poRow.shippingAddress != null ? String(poRow.shippingAddress) : undefined,
    termsConditions: poRow.termsConditions != null ? String(poRow.termsConditions) : undefined,
    advanceAmount: Number(poRow.advanceAmount ?? 0),
    advanceDate: toIsoDate(poRow.advanceDate) || null,
    cancelReason: poRow.cancelReason != null ? String(poRow.cancelReason) : null,
    cancelledBy: poRow.cancelledBy != null ? String(poRow.cancelledBy) : null,
    cancelledAt: toIsoDateTime(poRow.cancelledAt) || null,
    createdBy: poRow.createdBy != null ? String(poRow.createdBy) : undefined,
    supplierId: poRow.supplierId != null ? String(poRow.supplierId) : undefined,
    supplier: String(poRow.supplier ?? ''),
    status: mapPoStatus(poRow.status),
    createdAt: toIsoDateTime(poRow.createdAt) || new Date().toISOString(),
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
    itemLabel: [String(r.item ?? '').trim(), ...formatSpecParts(r.specificationsJson)].filter(Boolean).join(' - ') || String(r.item ?? ''),
    quantity: Number(r.quantity ?? 0),
    rate: Number(r.rate ?? 0),
    discountPercent: r.discountPercent != null ? Number(r.discountPercent) : undefined,
    taxPercent: r.taxPercent != null ? Number(r.taxPercent) : undefined,
    goodsAmount: r.goodsAmount != null ? Number(r.goodsAmount) : undefined,
    taxAmount: r.taxAmount != null ? Number(r.taxAmount) : undefined,
    totalAmount: r.totalAmount != null ? Number(r.totalAmount) : undefined,
  }));

  return { po, items };
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
      gi.received_qty AS quantityReceived
    FROM grn_items gi
    LEFT JOIN items it ON it.id = gi.item_id
    LEFT JOIN item_names iname ON iname.id = it.item_name_id
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
    quantityReceived: Number(r.quantityReceived ?? 0),
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
      inv.tally_entry_date AS tallyEntryDate,
      COALESCE(adj.adjustedAmount, 0) AS adjustedAmount,
      inv.document_url AS documentUrl,
      inv.cn_copy_url AS cnCopyUrl,
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
      ii.quantity AS quantity,
      ii.rate AS rate,
      ii.tax_percent AS taxPercent,
      (ii.quantity * ii.rate) AS totalAmount
    FROM invoice_items ii
    LEFT JOIN items it ON it.id = ii.item_id
    LEFT JOIN item_names iname ON iname.id = it.item_name_id
    WHERE ii.invoice_id = ?
    ORDER BY ii.created_at ASC
    `,
    [invoiceId]
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
    adjustedAmount: Number(invRow.adjustedAmount ?? 0),
    tallyEntryDate: toIsoDate(invRow.tallyEntryDate) || undefined,
    documentUrl: invRow.documentUrl != null ? String(invRow.documentUrl) : undefined,
    cnCopyUrl: invRow.cnCopyUrl != null ? String(invRow.cnCopyUrl) : undefined,
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
    quantity: Number(r.quantity ?? 0),
    rate: Number(r.rate ?? 0),
    taxPercent: Number(r.taxPercent ?? 0),
    totalAmount: Number(r.totalAmount ?? 0),
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
        po.advance_date AS advanceDate,
        po.created_at AS createdAt,
        po.status AS status,
        po.advance_amount AS advanceAmount,
        COUNT(poi.id) AS itemCount,
        COALESCE(SUM(poi.total_amount), 0) AS totalAmount
      FROM purchase_orders po
      LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
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
        advanceAmount: Number(r.advanceAmount ?? 0),
        advanceDate: toIsoDate(r.advanceDate) || null,
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

    const [invoiceRows] = await pool.query(
      `
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
        inv.created_at AS createdAt
      FROM invoices inv
      WHERE inv.po_id = ?
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      `,
      [poId]
    );

    const [adjRows] = await pool.query(
      `
      SELECT invoice_id AS invoiceId, adjusted_amount AS adjustedAmount
      FROM po_advance_invoice_adjustments
      WHERE po_id = ?
        AND (
          receipt_type = 'ADVANCE_ADJUSTMENT'
          OR (receipt_type IS NULL AND (payment_mode IS NULL OR TRIM(payment_mode) = ''))
        )
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

    const placeholders = invoiceIds.map(() => '?').join(',');
    const [invRows] = await pool.query(`SELECT id, po_id AS poId FROM invoices WHERE id IN (${placeholders})`, invoiceIds);
    const invalid = invoiceIds.filter(
      (id) => !((Array.isArray(invRows) ? invRows : []).some((r) => String(r.id) === id && String(r.poId) === poId))
    );
    if (invalid.length) return res.status(400).json({ error: `Some invoices do not belong to this PO.` });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [currentRows] = await conn.query(
        `
        SELECT invoice_id AS invoiceId, COALESCE(SUM(adjusted_amount), 0) AS adjustedAmount
        FROM po_advance_invoice_adjustments
        WHERE po_id = ?
          AND (
            receipt_type = 'ADVANCE_ADJUSTMENT'
            OR (receipt_type IS NULL AND (payment_mode IS NULL OR TRIM(payment_mode) = ''))
          )
        GROUP BY invoice_id
        `,
        [poId]
      );
      const currentByInvoiceId = Object.fromEntries(
        (Array.isArray(currentRows) ? currentRows : []).map((r) => [String(r.invoiceId ?? ''), Number(r.adjustedAmount ?? 0)])
      );
      for (const r of rows) {
        const current = Number(currentByInvoiceId[r.invoiceId] ?? 0);
        if (r.adjustedAmount + 1e-9 < current) {
          throw new Error(`Adjusted amount cannot be reduced for invoice ${r.invoiceId}. Historical receipt rows are append-only.`);
        }
        const delta = Math.max(0, r.adjustedAmount - current);
        if (!(delta > 1e-9)) continue;
        try {
          await conn.query(
            `INSERT INTO po_advance_invoice_adjustments
             (id, po_id, invoice_id, adjusted_amount, payment_mode, receipt_type, reference_type, entry_key, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, 'ADVANCE_ADJUSTMENT', 'INVOICE', ?, ?, ?)`,
            [crypto.randomUUID(), poId, r.invoiceId, delta, r.paymentMode || null, crypto.randomUUID(), updatedBy, updatedBy]
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
                  reference_type = 'INVOICE',
                  updated_by = ?,
                  updated_at = NOW()
              WHERE po_id = ? AND invoice_id = ?
              LIMIT 1
              `,
              [delta, r.paymentMode || null, updatedBy, poId, r.invoiceId]
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
          poi.po_id AS poId,
          poi.item_id AS itemId,
          iname.name AS item,
          it.specifications_json AS specificationsJson,
          poi.quantity AS quantity,
          poi.rate AS rate,
          poi.discount_percent AS discountPercent,
          poi.tax_percent AS taxPercent,
          poi.cancelled_qty AS cancelledQty,
          poi.cancel_reason AS cancelReason,
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
          cancelledQty: Number(r.cancelledQty ?? 0),
          cancelReason: r.cancelReason != null ? String(r.cancelReason) : null,
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
    const requestNo = await allocateDocNumber(pool, 'MR', new Date());

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
    if (!requestedBy) return res.status(400).json({ error: 'requestedBy is required' });
    if (!requiredDate) return res.status(400).json({ error: 'requiredDate is required' });
    if (!items.length) return res.status(400).json({ error: 'items are required' });

    const [storeRows] = await pool.query('SELECT id, name FROM stores WHERE firm_id = ? AND name = ? LIMIT 1', [firmId, storeName]);
    const storeRow = Array.isArray(storeRows) ? storeRows[0] : null;
    if (!storeRow?.id) return res.status(400).json({ error: 'Store not found for selected firm' });
    const storeId = String(storeRow.id);

    const prId = crypto.randomUUID();
    const prNumber = await allocateDocNumber(pool, 'PR', new Date());
    const remarks = department ? JSON.stringify({ department }) : JSON.stringify({});

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

	    for (const row of items) {
	      let itemId = String(row?.itemId ?? '').trim();
	      const itemNameId = String(row?.itemNameId ?? '').trim();
	      const quantity = Number(row?.quantity ?? 0);
        const priorityId = row?.priorityId != null ? String(row.priorityId).trim() : '';
	      let specification = String(row?.specification ?? '').trim();

	      // New format: Item Name + spec selections (server resolves/creates the item id).
	      if (!itemId && itemNameId) {
	        const specsObj = normalizeSpecsObject(row?.specs);
	        const specIds = Object.keys(specsObj);
	        if (!specIds.length) return res.status(400).json({ error: 'Each item requires specs for selected item name' });
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

	        // Store specs JSON in remarks for traceability.
	        specification = JSON.stringify(specsObj);
	      }

	      if (!itemId) return res.status(400).json({ error: 'Each item requires itemId (or itemNameId+specs)' });
	      if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Each item requires a valid quantity' });
	      if (!specification) return res.status(400).json({ error: 'Each item requires specification' });

      const prItemId = crypto.randomUUID();
      await pool.query(
	        `
	        INSERT INTO purchase_requisition_items
	          (id, pr_id, item_id, requested_qty, approved_qty, required_date, priority_id, remarks, status, created_by, created_at, updated_at)
	        VALUES
	          (?, ?, ?, ?, NULL, ?, ?, ?, 'pending', ?, NOW(), NOW())
	        `,
	        [prItemId, prId, itemId, quantity, requiredDate, priorityId || null, specification, 'system']
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
          pri.priority_id AS priorityId,
          p.name AS priority,
	        pri.remarks AS specification
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
	      quantity: Number(r.quantity ?? 0),
          priorityId: r.priorityId ? String(r.priorityId) : null,
          priority: r.priority ? String(r.priority) : null,
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
	        (id, po_number, firm_id, store_id, project_id, supplier_id, pr_id, status, order_date, payment_terms, payment_type, payment_mode, advance_amount, advance_date, remarks, created_by, created_at, updated_at, shipping_address, terms_conditions)
	      VALUES
	        (?, ?, ?, ?, ?, ?, ?, 'issued', CURDATE(), ?, ?, ?, ?, ?, NULL, ?, NOW(), NOW(), ?, ?)
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

// Create Direct PO (not linked to any PR)
	app.post('/api/pos', async (req, res) => {
	  try {
	    const pool = getMysqlPool();
	    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });

	    const firmId = String(req.body?.firmId ?? '').trim();
	    const storeId = String(req.body?.storeId ?? '').trim();
		    const projectId = req.body?.projectId != null ? String(req.body.projectId ?? '').trim() : '';
		    const supplierIdRaw = String(req.body?.supplierId ?? '').trim();
		    const supplierNameRaw = String(req.body?.supplier ?? '').trim();
        const department = String(req.body?.department ?? '').trim();
        const requestedBy = String(req.body?.requestedBy ?? '').trim();
        const requiredDateInput = String(req.body?.requiredDate ?? '').trim();
        const requiredDate = toIsoDate(requiredDateInput);
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
	    if (!storeId && !projectId) return res.status(400).json({ error: 'storeId or projectId is required' });
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
	    const poNumber = await allocateDocNumber(pool, 'PO', new Date());

	    const directPrId = crypto.randomUUID();
	    const directPrNumber = `DPO-${poNumber}`;
	    const directRemarks = JSON.stringify({ department, directPo: true, requiredDate });
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
			        (id, po_number, firm_id, store_id, project_id, supplier_id, pr_id, status, order_date, payment_terms, payment_type, payment_mode, advance_amount, advance_date, remarks, created_by, created_at, updated_at, shipping_address, terms_conditions)
			      VALUES
			        (?, ?, ?, ?, ?, ?, ?, 'issued', CURDATE(), ?, ?, ?, ?, ?, NULL, ?, NOW(), NOW(), ?, ?)
		      `,
		      [
	        poId,
	        poNumber,
	        firmId,
	        effectiveStoreId,
	        projectId ? projectId : null,
		        supplierId,
			        directPrId,
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
	    for (const row of items) {
	      let itemId = String(row?.itemId ?? '').trim();
        if (!itemId) {
          const itemNameId = String(row?.itemNameId ?? '').trim();
          const specsObj = normalizeSpecsObject(row?.specs);
          const specIds = Object.keys(specsObj);
          if (!itemNameId || !specIds.length) return res.status(400).json({ error: 'Each item requires itemId (or itemNameId+specs)' });
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
	          (id, pr_id, item_id, requested_qty, approved_qty, required_date, remarks, status, created_by, created_at, updated_at)
	        VALUES
	          (?, ?, ?, ?, ?, ?, ?, 'approved', ?, NOW(), NOW())
	        `,
	        [prItemId, directPrId, itemId, quantity, quantity, requiredDate, prSpecText, 'system']
	      );

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
	        payment_copy AS paymentCopy
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
	      if (!advanceDate) continue;
	      if (!Number.isFinite(advanceAmount) || advanceAmount <= 0) continue;
	      normalized.push({
	        id: String(raw?.id ?? '').trim(),
	        advanceDate,
	        advanceAmount,
	        paymentMode,
	        paymentCopy,
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
	        INSERT INTO po_advances (id, po_id, advance_date, advance_amount, payment_mode, payment_copy, created_by, created_at, updated_at)
	        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
	        `,
	        [row.id || crypto.randomUUID(), poId, row.advanceDate, row.advanceAmount, row.paymentMode || null, row.paymentCopy || null, 'Purchase Team']
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
	        payment_copy AS paymentCopy
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
      'SELECT id, status, advance_amount AS advanceAmount, advance_date AS advanceDate FROM purchase_orders WHERE id = ? LIMIT 1',
      [poId]
    );
    if (!poRow) return res.status(404).json({ error: 'PO not found' });

    const supplierId = req.body?.supplierId != null ? String(req.body.supplierId).trim() : '';
    const paymentTerms = String(req.body?.paymentTerms ?? '').trim();
    const shippingAddress = req.body?.shippingAddress != null ? String(req.body.shippingAddress).trim() : null;
    const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions).trim() : null;
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || 'system';
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

    for (const row of items) {
      const itemId = String(row?.itemId ?? '').trim();
      const quantity = num(row?.quantity, NaN);
      const rate = num(row?.rate, NaN);
      const discountPercent = Math.max(0, num(row?.discountPercent, 0));
      const taxPercent = Math.max(0, num(row?.taxPercent, 0));
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0) continue;

      const lineCancel = cancelByItemId.get(itemId) || { cancelledQty: 0, reason: '' };
      const cancelledQty = Math.max(0, Math.min(quantity, num(lineCancel.cancelledQty, 0)));
      const effectiveQty = Math.max(0, quantity - cancelledQty);
      const goodsAmount = effectiveQty * rate * (1 - discountPercent / 100);
      const taxAmount = goodsAmount * (taxPercent / 100);
      const totalAmount = goodsAmount + taxAmount;

      await pool.query(
        `
        UPDATE purchase_order_items
        SET quantity = ?,
            rate = ?,
            discount_percent = ?,
            tax_percent = ?,
            cancelled_qty = ?,
            cancel_reason = ?,
            goods_amount = ?,
            tax_amount = ?,
            total_amount = ?,
            updated_by = ?,
            updated_at = NOW()
        WHERE po_id = ? AND item_id = ?
        `,
        [quantity, rate, discountPercent || null, taxPercent || null, cancelledQty, lineCancel.reason || null, goodsAmount, taxAmount, totalAmount, updatedBy, poId, itemId]
      );
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

    const items = (Array.isArray(itemRows) ? itemRows : []).map((r) => {
      const base = String(r.itemName ?? '').trim();
      const specs = formatSpecParts(r.specificationsJson);
      const label = [base, ...specs].filter(Boolean).join(' - ') || '-';
      return {
        label,
        quantity: Number(r.quantity ?? 0),
        rate: Number(r.rate ?? 0),
        discountPercent: Number(r.discountPercent ?? 0),
        taxPercent: Number(r.taxPercent ?? 0),
        goodsAmount: Number(r.goodsAmount ?? 0),
        taxAmount: Number(r.taxAmount ?? 0),
        totalAmount: Number(r.totalAmount ?? 0),
      };
    });

    const doc = await PDFDocument.create();
    let page = doc.addPage([595.28, 841.89]); // A4
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const margin = 36;
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    let y = 841.89 - margin;

    const wrapLines = (text, f, size, maxWidth) => {
      const raw = String(text ?? '').replace(/\r?\n/g, ' ').trim();
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

      const lines = opts.wrap === false ? [String(text ?? '')] : wrapLines(text, f, size, maxWidth);
      for (const line of lines) {
        page.drawText(String(line ?? ''), { x, y, size, font: f, color });
        y -= lineHeight;
      }
	    };
    const drawTextPreserveNewlines = (text, opts = {}) => {
      const parts = String(text ?? '').split(/\r?\n/);
      for (const part of parts) {
        const line = String(part ?? '');
        if (line.trim()) {
          drawText(line, opts);
        } else {
          y -= (opts.lineHeight ?? (opts.size ?? 10) + 4);
        }
      }
    };

    const formatMoney = (value) => Number(value || 0).toFixed(2);
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
      page.drawText(String(text ?? ''), {
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
      const value = String(text ?? '');
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
    drawText('PURCHASE ORDER', { bold: true, size: 16 });
    drawText(`${poNumber || '-'}`, { bold: true, size: 11 });
    drawText(`Date: ${formatDate(poRow.orderDate)}`, { size: 9 });
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
    drawBox(margin, topY - 78, halfWidth, 82);
    drawBox(margin + halfWidth + 10, topY - 78, halfWidth, 82);
    drawAt('Supplier', margin + 8, topY - 12, { bold: true, size: 9 });
    drawAt(String(poRow.supplierName ?? '').trim() || '-', margin + 8, topY - 26, { bold: true, size: 9 });
    drawAt(`GST: ${String(poRow.supplierGstNumber ?? '').trim() || '-'}`, margin + 8, topY - 40, { size: 8 });
    drawAt(String(poRow.supplierAddress ?? '').trim() || '-', margin + 8, topY - 54, { size: 8 });
    drawAt(`Payment Terms: ${String(poRow.paymentTerms ?? '').trim() || '-'}`, margin + 8, topY - 68, { bold: true, size: 8 });

    const firmX = margin + halfWidth + 10;
    drawAt('Firm / Delivery', firmX + 8, topY - 12, { bold: true, size: 9 });
    drawAt(String(poRow.firmName ?? '').trim() || '-', firmX + 8, topY - 26, { bold: true, size: 9 });
    drawAt(`GST: ${String(poRow.firmGstNumber ?? '').trim() || '-'}`, firmX + 8, topY - 40, { size: 8 });
    drawAt(`Store: ${String(poRow.storeName ?? '').trim() || '-'}`, firmX + 8, topY - 54, { size: 8 });
    y = topY - 92;

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
    const colBounds = [tableLeft, tableLeft + 36, tableLeft + 246, tableLeft + 316, tableLeft + 379, tableLeft + 430, tableLeft + 474, tableRight];
    const col = {
      serialLeft: colBounds[0],
      serialRight: colBounds[1],
      itemLeft: colBounds[1],
      itemRight: colBounds[2],
      qtyRight: colBounds[3],
      rateRight: colBounds[4],
      discRight: colBounds[5],
      gstRight: colBounds[6],
      taxableRight: colBounds[7],
    };
    const headerY = y;
    const headerBottom = headerY - 16;
    page.drawRectangle({
      x: tableLeft,
      y: headerBottom,
      width: tableWidth,
      height: 20,
      color: rgb(0.88, 0.9, 0.93),
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    for (const x of colBounds) drawLine(x, headerBottom, x, headerBottom + 20, 1);
    drawLine(tableLeft, headerBottom + 20, tableRight, headerBottom + 20, 1);
    drawLine(tableLeft, headerBottom, tableRight, headerBottom, 1);
    drawAt('Sl No.', tableLeft + 4, headerY - 10, { bold: true, size: 8 });
    drawAt('Item Description', col.itemLeft + 4, headerY - 10, { bold: true, size: 8 });
    drawRight('Qty', col.qtyRight - 4, headerY - 10, { bold: true, size: 8 });
    drawRight('Rate', col.rateRight - 4, headerY - 10, { bold: true, size: 8 });
    drawRight('Disc %', col.discRight - 4, headerY - 10, { bold: true, size: 8 });
    drawRight('GST %', col.gstRight - 4, headerY - 10, { bold: true, size: 8 });
    drawRight('Amt.', col.taxableRight - 8, headerY - 10, { bold: true, size: 8 });
    y -= 20;

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
      const labelLines = wrapLines(String(it.label ?? '').trim() || '-', font, 8, col.itemRight - col.itemLeft - 8);
      const rowHeight = Math.max(18, labelLines.length * 11 + 8);
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
      drawRight(formatNumber(it.quantity), col.qtyRight - 4, rowTop - 6, { size: 8 });
      drawRight(formatMoney(it.rate), col.rateRight - 4, rowTop - 6, { size: 8 });
      drawRight(formatNumber(it.discountPercent), col.discRight - 4, rowTop - 6, { size: 8 });
      drawRight(formatNumber(it.taxPercent), col.gstRight - 4, rowTop - 6, { size: 8 });
      drawRight(formatMoney(it.goodsAmount), col.taxableRight - 8, rowTop - 6, { size: 8 });
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
    const toPctLabel = (value) => {
      const n = Number(value ?? 0);
      if (!Number.isFinite(n) || n <= 0) return '0';
      const rounded = Number(n.toFixed(2));
      return Number.isInteger(rounded) ? String(rounded) : String(rounded);
    };
    const igstPct = grandGoods > 0 ? (grandIgst / grandGoods) * 100 : 0;
    const cgstPct = grandGoods > 0 ? (grandCgst / grandGoods) * 100 : 0;
    const sgstPct = grandGoods > 0 ? (grandSgst / grandGoods) * 100 : 0;

    const summaryRows = isInterState
      ? [
          ['Taxable Subtotal', formatMoney(grandGoods)],
          [`IGST (${toPctLabel(igstPct)}%)`, formatMoney(grandIgst)],
          ['Disc. Amount', formatMoney(grandDisc)],
          ['Grand Total', formatMoney(grandTotal)],
        ]
      : [
          ['Taxable Subtotal', formatMoney(grandGoods)],
          [`CGST (${toPctLabel(cgstPct)}%)`, formatMoney(grandCgst)],
          [`SGST (${toPctLabel(sgstPct)}%)`, formatMoney(grandSgst)],
          ['Disc. Amount', formatMoney(grandDisc)],
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

    const pdfBytes = await doc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Disposition', `attachment; filename=\"${poNumber || poId}.pdf\"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    res.status(500).send(e instanceof Error ? e.message : String(e));
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
        poi.item_id AS itemId,
        iname.name AS item,
        GREATEST(0, COALESCE(poi.quantity, 0) - COALESCE(linkq.linkQty, 0)) AS pendingQty,
        poi.rate AS rate
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
        contact_person AS contactPerson,
        contact_person_mobile AS contactPersonMobile,
        city,
        state,
        mobile_2 AS mobile2,
        payment_terms AS paymentTerms,
        is_vendor AS isVendor,
        catalogue_link AS catalogueLink
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
      contactPerson: req.body?.contactPerson != null ? String(req.body.contactPerson).trim() : null,
      contactPersonMobile: req.body?.contactPersonMobile != null ? String(req.body.contactPersonMobile).trim() : null,
      city: req.body?.city != null ? String(req.body.city).trim() : null,
      state: req.body?.state != null ? String(req.body.state).trim() : null,
      mobile2: req.body?.mobile2 != null ? String(req.body.mobile2).trim() : null,
      paymentTerms: req.body?.paymentTerms != null ? String(req.body.paymentTerms).trim() : null,
      isVendor: req.body?.isVendor ? 1 : 0,
      catalogueLink: req.body?.catalogueLink != null ? String(req.body.catalogueLink).trim() : null,
      createdBy: req.body?.createdBy != null ? String(req.body.createdBy).trim() : null,
    };

    await pool.query(
      `
      INSERT INTO suppliers (id, name, gst_number, gst_type, address, phone, contact_person, contact_person_mobile, city, state, mobile_2, payment_terms, is_vendor, catalogue_link, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        supplier.id,
        supplier.name,
        supplier.gstNumber,
        supplier.gstType,
        supplier.address,
        supplier.phone,
        supplier.contactPerson,
        supplier.contactPersonMobile,
        supplier.city,
        supplier.state,
        supplier.mobile2,
        supplier.paymentTerms,
        supplier.isVendor,
        supplier.catalogueLink,
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
        contactPerson: supplier.contactPerson ?? undefined,
        contactPersonMobile: supplier.contactPersonMobile ?? undefined,
        city: supplier.city ?? undefined,
        state: supplier.state ?? undefined,
        mobile2: supplier.mobile2 ?? undefined,
        paymentTerms: supplier.paymentTerms ?? undefined,
        isVendor: Boolean(supplier.isVendor),
        catalogueLink: supplier.catalogueLink ?? undefined,
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
    const contactPerson = req.body?.contactPerson != null ? String(req.body.contactPerson).trim() : null;
    const contactPersonMobile = req.body?.contactPersonMobile != null ? String(req.body.contactPersonMobile).trim() : null;
    const city = req.body?.city != null ? String(req.body.city).trim() : null;
    const state = req.body?.state != null ? String(req.body.state).trim() : null;
    const mobile2 = req.body?.mobile2 != null ? String(req.body.mobile2).trim() : null;
    const paymentTerms = req.body?.paymentTerms != null ? String(req.body.paymentTerms).trim() : null;
    const catalogueLink = req.body?.catalogueLink != null ? String(req.body.catalogueLink).trim() : null;
    const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : null;

    await pool.query(
      `
      UPDATE suppliers
      SET name=?, gst_number=?, gst_type=?, address=?, phone=?, contact_person=?, contact_person_mobile=?, city=?, state=?, mobile_2=?, payment_terms=?, is_vendor=?, catalogue_link=?, updated_by=?, updated_at=NOW()
      WHERE id=?
      `,
      [name, gstNumber, gstType, address, phone, contactPerson, contactPersonMobile, city, state, mobile2, paymentTerms, req.body?.isVendor ? 1 : 0, catalogueLink, updatedBy, id]
    );

    const [rows] = await pool.query(
      `
      SELECT id, name, gst_number AS gstNumber, gst_type AS gstType, address, phone, contact_person AS contactPerson, contact_person_mobile AS contactPersonMobile, city, state, mobile_2 AS mobile2, payment_terms AS paymentTerms, is_vendor AS isVendor, catalogue_link AS catalogueLink
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
      'INSERT INTO users (id, name, role, login_id, menu_access, phone, email, is_active, po_approval_amount, created_at, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)',
      [id, name, role, loginId, JSON.stringify(menuAccess), mobile, email || null, isActive, Number.isFinite(poApprovalAmount) ? poApprovalAmount : null, passwordHash]
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
        'UPDATE users SET name=?, role=?, login_id=?, menu_access=?, phone=?, email=?, is_active=?, po_approval_amount=?, password_hash=? WHERE id=?',
        [name, role, loginId, JSON.stringify(menuAccess), mobile, email || null, isActive, Number.isFinite(poApprovalAmount) ? poApprovalAmount : null, passwordHash, id]
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

// --- Settings: Catelouge ---
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
    const rfqNumber = await allocateDocNumber(pool, 'RFQ', new Date());

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
      'INSERT INTO item_names (id, name, unit_id, item_category_id, catalogue_link, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [id, name, unitId, itemCategoryId, catalogueLink, createdBy]
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
      'UPDATE item_names SET name=?, unit_id=?, item_category_id=?, catalogue_link=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [name, unitId, itemCategoryId, catalogueLink, updatedBy, id]
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
    const header = ['item_name', 'description', 'unit', 'item_category', ...specColumns, ...storeColumns];
    const lines = [header.map(toCsvCell).join(',')];

    for (let i = 0; i < 25; i += 1) {
      const row = [
        String(itemNameRow.name ?? ''),
        '',
        String(itemNameRow.unitName ?? ''),
        String(itemNameRow.itemCategoryName ?? ''),
        ...specColumns.map(() => ''),
        ...storeColumns.map(() => ''),
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
		      'INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, photo_1, photo_2, photo_3, photo_4, photo_5, item_link, video_link, reorder_level, opening_stock, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
		      [id, itemNameId, itemCode, specificationsJson, uniqueKey, description, unit, photo1, photo2, photo3, photo4, photo5, itemLink, videoLink, Number.isFinite(reorderLevel) ? reorderLevel : null, Number.isFinite(openingStock) ? openingStock : 0, createdBy]
		    );
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
			             it.item_link AS itemLink, it.video_link AS videoLink, it.reorder_level AS reorderLevel, it.opening_stock AS openingStock
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
		      'UPDATE items SET item_name_id=?, specifications_json=?, unique_key=?, description=?, unit=?, photo_1=?, photo_2=?, photo_3=?, photo_4=?, photo_5=?, item_link=?, video_link=?, reorder_level=?, opening_stock=?, updated_by=?, updated_at=NOW() WHERE id=?',
		      [itemNameId, specificationsJson, uniqueKey, description, unit, photo1, photo2, photo3, photo4, photo5, itemLink, videoLink, Number.isFinite(reorderLevel) ? reorderLevel : null, Number.isFinite(openingStock) ? openingStock : 0, updatedBy, id]
		    );
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
			             it.item_link AS itemLink, it.video_link AS videoLink, it.reorder_level AS reorderLevel, it.opening_stock AS openingStock
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
  csvTemplateResponse(res, 'suppliers-template.csv', 'name,gstNumber,gstType,address,phone,paymentTerms');
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
      await pool.query(
        `
        INSERT INTO suppliers (id, name, gst_number, gst_type, address, phone, payment_terms, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [
          crypto.randomUUID(),
          name,
          r.gstNumber != null ? String(r.gstNumber).trim() || null : null,
          gstType,
          r.address != null ? String(r.address).trim() || null : null,
          r.phone != null ? String(r.phone).trim() || null : null,
          r.paymentTerms != null ? String(r.paymentTerms).trim() || null : null,
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
  csvTemplateResponse(res, 'items-template.csv', 'itemName,unit,description,specs,Re-Order Level');
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
        return { itemName, itemNameId, unit, description, reorderLevel, specs };
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
      await pool.query(
        'INSERT INTO items (id, item_name_id, item_code, specifications_json, unique_key, description, unit, reorder_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [
          id,
          itemNameId,
          itemCode,
          specificationsJson,
          uniqueKey,
          r.description || null,
          r.unit || null,
          Number.isFinite(parsedReorderLevel) ? Math.max(0, parsedReorderLevel) : null,
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

    const countByDay = async (table, field = 'created_at', extraWhere = '', extraParams = []) => {
      const sql = `SELECT COUNT(*) AS c FROM ${table} WHERE DATE(${field}) = ? ${extraWhere}`;
      const [rows] = await pool.query(sql, [day, ...extraParams]);
      return Number(rows?.[0]?.c ?? 0);
    };

    const mastersParts = await Promise.all([
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
    ]);
    const masters = mastersParts.reduce((a, b) => a + b, 0);

    const prs = await countByDay('purchase_requisitions');
    const pos = await countByDay('purchase_orders');
    const grns = await countByDay('grns');
    const invoices = await countByDay('invoices');
    // Payments are stored on invoices; count invoices updated on the day with a payment status.
    const payments = await countByDay('invoices', 'updated_at', 'AND payment_status IS NOT NULL AND TRIM(payment_status) <> ""');

    const stockParts = await Promise.all([
      countByDay('item_issues'),
      countByDay('item_returns'),
      countByDay('item_damages'),
      countByDay('item_transfers'),
    ]);
    const stock = stockParts.reduce((a, b) => a + b, 0);

    const total = masters + prs + pos + grns + invoices + payments + stock;

    res.json({
      counts: {
        masters,
        prs,
        pos,
        grns,
        invoices,
        payments,
        stock,
        total,
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

// --- Stock Transactions (Issues, Returns, Damages, Transfers) ---

async function getNextTransactionNo(pool, table, prefix) {
  const [rows] = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
  const count = rows[0].count + 1;
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${date}-${String(count).padStart(4, '0')}`;
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
                 s.name AS store_name
          FROM ${table} t
          LEFT JOIN stores s ON s.id = t.store_id
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
        store: row.store_name || row.store_id || row.from_store_id || row.store,
        department: row.department,
        person: row.person || row.requested_by,
        date: toIsoDate(row.date) || toIsoDate(row.created_at),
        issueType: row.issue_type,
        issuedTo: row.issued_to,
        returnType: row.return_type,
        customerName: row.customer_name,
        approvedBy: row.approved_by,
        toFirmId: row.to_firm_id,
        toStore: row.to_store_name || row.to_store_id || row.to_store,
        toDepartment: row.to_department,
        projectId: row.project_id,
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
app.delete('/api/stock-transactions/issues/:id', async (req, res) => {
  try {
    const pool = getMysqlPool();
    if (!pool) return res.status(500).json({ error: 'Database is not configured.' });
    await pool.query('DELETE FROM item_issues WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
          WHERE t.firm_id = ? AND DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?
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
        issue: num(r.issueQty, 0),
        damage: num(r.damageQty, 0),
        transferIn: num(r.transferIn, 0),
        transferOut: num(r.transferOut, 0),
      });
    }

    const storeIds = Array.from(storeById.keys());
    const itemIds = Array.from(itemById.keys());

    const makeRow = (storeId, itemId) => {
	      const meta = itemById.get(itemId) ?? { itemCode: '', itemName: '', specificationsJson: '', unit: '', reorderLevel: 0, openingStock: 0, photo1: '', photo2: '', photo3: '', photo4: '', photo5: '', itemLink: '', videoLink: '' };
	      const agg = aggMap.get(keyOf(storeId, itemId)) ?? {
	        opening: 0,
	        purchase: 0,
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
      const returns = 0;
      const transferIn = num(agg.transferIn, 0);
      const transferOut = num(agg.transferOut, 0);
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
    const paymentModeRaw = String(req.body?.paymentMode ?? '').trim().toLowerCase();
    const paymentMode = paymentModeRaw === 'cash' ? 'Cash' : paymentModeRaw === 'credit' ? 'Credit' : null;
    const tallyEntryDate = req.body?.tallyEntryDate != null ? String(req.body.tallyEntryDate).trim() : null;
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
        payment_status, payment_date, payment_mode, tally_entry_date,
        status,
        document_url, cn_copy_url,
        eway_bill_number, cn_number, courier_number, transporter_name,
        created_by, created_at, updated_by, updated_at
      ) VALUES (
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
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
        paymentMode === 'Cash' ? 'Full Paid' : null,
        paymentMode === 'Cash' ? invoiceDate : null,
        paymentMode,
        tallyEntryDate || null,
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
          payment_mode=COALESCE(?, payment_mode), tally_entry_date=?,
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
    const tallyEntryDate = req.body?.tallyEntryDate != null ? String(req.body.tallyEntryDate).trim() : null;
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || null;
    if (!paymentDate) return res.status(400).json({ error: 'paymentDate is required' });
    if (!paymentMode) return res.status(400).json({ error: 'paymentMode is required' });
    if (!Number.isFinite(paymentAmount) || paymentAmount < 0) return res.status(400).json({ error: 'paymentAmount must be 0 or more' });
    if (adjustedAmountInput != null && (!Number.isFinite(adjustedAmountInput) || adjustedAmountInput < 0))
      return res.status(400).json({ error: 'adjustedAmount must be 0 or more' });
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
    const totalPaid = adjustedAmount + paymentAmount;
    const paymentStatus = totalPaid >= invoiceAmount - 1e-9 ? 'Full Paid' : 'Partly Paid';
    await pool.query(
      `UPDATE invoices
       SET payment_status=?, payment_date=?, payment_amount=?, payment_mode=COALESCE(?, payment_mode), tally_entry_date=COALESCE(?, tally_entry_date), updated_by=?, updated_at=NOW()
       WHERE id=?`,
      [paymentStatus, paymentDate, paymentAmount, paymentMode || null, tallyEntryDate || null, updatedBy, invoiceId]
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
    if (paymentAmount > 1e-9) {
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
              paymentAmount,
              paymentMode || null,
              paymentCopy || null,
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
              [paymentAmount, paymentMode || null, paymentCopy || null, updatedBy || 'system', poId, invoiceId]
            );
          } else {
            throw e;
          }
        }
      }
    }
    res.json({ ok: true });
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
    res.json({ ok: true, invoiceId: String(row.invoiceId ?? '') });
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
