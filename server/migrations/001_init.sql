PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

-- FIRMS
CREATE TABLE IF NOT EXISTS firms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  gst_number TEXT,
  pan TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- STORES
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_stores_firm_id ON stores(firm_id);

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT,
  email TEXT UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ITEM NAMES
CREATE TABLE IF NOT EXISTS item_names (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- SPECIFICATIONS
CREATE TABLE IF NOT EXISTS specifications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- SPECIFICATION VALUES
CREATE TABLE IF NOT EXISTS specification_values (
  id TEXT PRIMARY KEY,
  specification_id TEXT NOT NULL,
  value TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (specification_id) REFERENCES specifications(id) ON DELETE RESTRICT,
  UNIQUE (specification_id, value)
);
CREATE INDEX IF NOT EXISTS idx_specification_values_specification_id ON specification_values(specification_id);

-- ITEMS (dynamic)
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  item_name_id TEXT NOT NULL,
  item_code TEXT NOT NULL UNIQUE,
  specifications_json TEXT NOT NULL,
  unique_key TEXT NOT NULL UNIQUE,
  description TEXT,
  unit TEXT,
  photo_1 TEXT,
  photo_2 TEXT,
  photo_3 TEXT,
  photo_4 TEXT,
  photo_5 TEXT,
  item_link TEXT,
  video_link TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (item_name_id) REFERENCES item_names(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_items_item_name_id ON items(item_name_id);

-- SUPPLIERS
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  gst_number TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  default_credit_days INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  gst_number TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- PROJECTS
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  name TEXT NOT NULL,
  client_name TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  UNIQUE (firm_id, name)
);
CREATE INDEX IF NOT EXISTS idx_projects_firm_id ON projects(firm_id);

-- ISSUE TYPES
CREATE TABLE IF NOT EXISTS issue_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- PURCHASE REQUISITIONS
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id TEXT PRIMARY KEY,
  pr_number TEXT NOT NULL UNIQUE,
  firm_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  project_id TEXT,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','partially_approved','approved','rejected','cancelled')),
  remarks TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_prs_firm_id ON purchase_requisitions(firm_id);
CREATE INDEX IF NOT EXISTS idx_prs_store_id ON purchase_requisitions(store_id);
CREATE INDEX IF NOT EXISTS idx_prs_project_id ON purchase_requisitions(project_id);

-- PR ITEMS
CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  id TEXT PRIMARY KEY,
  pr_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  requested_qty REAL NOT NULL,
  approved_qty REAL,
  required_date TEXT,
  remarks TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by TEXT,
  approved_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pr_id) REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_pr_items_pr_id ON purchase_requisition_items(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_items_item_id ON purchase_requisition_items(item_id);

-- PURCHASE ORDERS
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  firm_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  project_id TEXT,
  supplier_id TEXT NOT NULL,
  pr_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','issued','partial','closed')),
  order_date TEXT NOT NULL,
  payment_terms TEXT,
  credit_days INTEGER,
  remarks TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (pr_id) REFERENCES purchase_requisitions(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_pos_firm_id ON purchase_orders(firm_id);
CREATE INDEX IF NOT EXISTS idx_pos_store_id ON purchase_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_pos_supplier_id ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pos_pr_id ON purchase_orders(pr_id);

-- PO ITEMS
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  rate REAL NOT NULL,
  discount_percent REAL,
  tax_percent REAL,
  goods_amount REAL NOT NULL,
  tax_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
  UNIQUE (po_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_item_id ON purchase_order_items(item_id);

-- INVOICES (includes dispatch)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  dispatch_date TEXT,
  transporter_name TEXT,
  cn_number TEXT,
  courier_number TEXT,
  vehicle_number TEXT,
  eway_bill_number TEXT,
  goods_amount REAL NOT NULL,
  tax_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  transport_charges REAL,
  other_charges REAL,
  status TEXT NOT NULL CHECK (status IN ('pending','verified','hold','approved')),
  document_url TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  UNIQUE (supplier_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_po_id ON invoices(po_id);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id ON invoices(supplier_id);

-- INVOICE ITEMS
CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  rate REAL NOT NULL,
  amount REAL NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
  UNIQUE (invoice_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_item_id ON invoice_items(item_id);

-- GRN
CREATE TABLE IF NOT EXISTS grns (
  id TEXT PRIMARY KEY,
  grn_number TEXT NOT NULL UNIQUE,
  po_id TEXT NOT NULL,
  firm_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  received_by TEXT NOT NULL,
  received_date TEXT NOT NULL,
  remarks TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_grns_po_id ON grns(po_id);
CREATE INDEX IF NOT EXISTS idx_grns_firm_id ON grns(firm_id);
CREATE INDEX IF NOT EXISTS idx_grns_store_id ON grns(store_id);

-- GRN ITEMS
CREATE TABLE IF NOT EXISTS grn_items (
  id TEXT PRIMARY KEY,
  grn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  ordered_qty REAL NOT NULL,
  received_qty REAL NOT NULL,
  short_qty REAL,
  damaged_qty REAL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (grn_id) REFERENCES grns(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
  UNIQUE (grn_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_grn_items_grn_id ON grn_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_item_id ON grn_items(item_id);

-- GRN ↔ INVOICE LINKING
CREATE TABLE IF NOT EXISTS grn_invoice_item_links (
  id TEXT PRIMARY KEY,
  grn_item_id TEXT NOT NULL,
  invoice_item_id TEXT NOT NULL,
  linked_qty REAL NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (grn_item_id) REFERENCES grn_items(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id) ON DELETE CASCADE,
  UNIQUE (grn_item_id, invoice_item_id)
);
CREATE INDEX IF NOT EXISTS idx_grn_links_grn_item_id ON grn_invoice_item_links(grn_item_id);
CREATE INDEX IF NOT EXISTS idx_grn_links_invoice_item_id ON grn_invoice_item_links(invoice_item_id);

-- QC
CREATE TABLE IF NOT EXISTS qc_records (
  id TEXT PRIMARY KEY,
  grn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  accepted_qty REAL NOT NULL,
  rejected_qty REAL NOT NULL,
  hold_qty REAL NOT NULL,
  remarks TEXT,
  qc_by TEXT NOT NULL,
  qc_date TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (grn_id) REFERENCES grns(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
  UNIQUE (grn_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_qc_grn_id ON qc_records(grn_id);
CREATE INDEX IF NOT EXISTS idx_qc_item_id ON qc_records(item_id);

-- STOCK LEDGER
CREATE TABLE IF NOT EXISTS stock_ledger (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_stock_firm_id ON stock_ledger(firm_id);
CREATE INDEX IF NOT EXISTS idx_stock_store_id ON stock_ledger(store_id);
CREATE INDEX IF NOT EXISTS idx_stock_item_id ON stock_ledger(item_id);

-- ITEM ISSUE
CREATE TABLE IF NOT EXISTS item_issues (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  project_id TEXT,
  issue_type_id TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (issue_type_id) REFERENCES issue_types(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_issues_firm_id ON item_issues(firm_id);
CREATE INDEX IF NOT EXISTS idx_issues_store_id ON item_issues(store_id);
CREATE INDEX IF NOT EXISTS idx_issues_project_id ON item_issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_type_id ON item_issues(issue_type_id);

-- ITEM ISSUE ITEMS
CREATE TABLE IF NOT EXISTS item_issue_items (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (issue_id) REFERENCES item_issues(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_issue_items_issue_id ON item_issue_items(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_items_item_id ON item_issue_items(item_id);

-- ITEM TRANSFER
CREATE TABLE IF NOT EXISTS item_transfers (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  from_store_id TEXT NOT NULL,
  to_store_id TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (from_store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (to_store_id) REFERENCES stores(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_transfers_firm_id ON item_transfers(firm_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from_store_id ON item_transfers(from_store_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_store_id ON item_transfers(to_store_id);

-- ITEM TRANSFER ITEMS
CREATE TABLE IF NOT EXISTS item_transfer_items (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (transfer_id) REFERENCES item_transfers(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer_id ON item_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_item_id ON item_transfer_items(item_id);

-- DAMAGED ITEMS
CREATE TABLE IF NOT EXISTS damaged_items (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_damaged_firm_id ON damaged_items(firm_id);
CREATE INDEX IF NOT EXISTS idx_damaged_store_id ON damaged_items(store_id);
CREATE INDEX IF NOT EXISTS idx_damaged_item_id ON damaged_items(item_id);

-- PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  po_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount_paid REAL NOT NULL,
  payment_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT,
  remarks TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_payments_supplier_id ON payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payments_po_id ON payments(po_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);

-- AUDIT LOG
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  remarks TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);
CREATE INDEX IF NOT EXISTS idx_audit_record_id ON audit_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_performed_by ON audit_logs(performed_by);
