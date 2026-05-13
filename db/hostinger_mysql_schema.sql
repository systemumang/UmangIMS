-- Hostinger MySQL schema generated from local SQLite database
-- Source: data/purchase_system.sqlite
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

-- Table: audit_logs
CREATE TABLE audit_logs (
  id VARCHAR(255) PRIMARY KEY,
  module TEXT NOT NULL,
  record_id VARCHAR(255) NOT NULL,
  action TEXT NOT NULL,
  performed_by VARCHAR(255) NOT NULL,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: customers
CREATE TABLE customers (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  gst_number VARCHAR(255),
  phone VARCHAR(255),
  email VARCHAR(255),
  address TEXT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: damaged_items
CREATE TABLE damaged_items (
  id VARCHAR(255) PRIMARY KEY,
  firm_id VARCHAR(255) NOT NULL,
  store_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  quantity DOUBLE NOT NULL,
  reason TEXT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: departments
CREATE TABLE departments (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: firms
CREATE TABLE firms (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL,
  gst_number VARCHAR(255),
  pan VARCHAR(255),
  address TEXT,
  phone VARCHAR(255),
  email VARCHAR(255),
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, cin VARCHAR(255), logo_url TEXT, terms_conditions TEXT, sort_name TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: grn_invoice_item_links
CREATE TABLE grn_invoice_item_links (
  id VARCHAR(255) PRIMARY KEY,
  grn_item_id VARCHAR(255) NOT NULL,
  invoice_item_id VARCHAR(255) NOT NULL,
  linked_qty DOUBLE NOT NULL,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grn_item_id) REFERENCES grn_items(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id) ON DELETE CASCADE,
  UNIQUE (grn_item_id, invoice_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: grn_items
CREATE TABLE grn_items (
  id VARCHAR(255) PRIMARY KEY,
  grn_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  ordered_qty DOUBLE NOT NULL,
  received_qty DOUBLE NOT NULL,
  short_qty DOUBLE,
  damaged_qty DOUBLE,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grn_id) REFERENCES grns(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
  UNIQUE (grn_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: grns
CREATE TABLE grns (
  id VARCHAR(255) PRIMARY KEY,
  grn_number TEXT NOT NULL UNIQUE,
  po_id VARCHAR(255) NOT NULL,
  firm_id VARCHAR(255) NOT NULL,
  store_id VARCHAR(255) NOT NULL,
  received_by TEXT NOT NULL,
  received_date DATE NOT NULL,
  remarks TEXT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, material_received_by TEXT, goods_collected_by TEXT,
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: invoice_items
CREATE TABLE invoice_items (
  id VARCHAR(255) PRIMARY KEY,
  invoice_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  quantity DOUBLE NOT NULL,
  rate DOUBLE NOT NULL,
  amount DOUBLE NOT NULL,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, tax_percent DOUBLE NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
  UNIQUE (invoice_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: invoices
CREATE TABLE invoices (
  id VARCHAR(255) PRIMARY KEY,
  po_id VARCHAR(255) NOT NULL,
  supplier_id VARCHAR(255) NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  dispatch_date TEXT,
  transporter_name TEXT,
  cn_number TEXT,
  courier_number TEXT,
  vehicle_number TEXT,
  eway_bill_number TEXT,
  goods_amount DOUBLE NOT NULL,
  tax_amount DOUBLE NOT NULL,
  total_amount DOUBLE NOT NULL,
  transport_charges DOUBLE,
  other_charges DOUBLE,
  status VARCHAR(255) NOT NULL CHECK (status IN ('pending','verified','hold','approved')),
  document_url TEXT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, payment_status TEXT, payment_date DATE, courier_charge DOUBLE NOT NULL DEFAULT 0, packing_charge DOUBLE NOT NULL DEFAULT 0, labour_charge DOUBLE NOT NULL DEFAULT 0, other_charge DOUBLE NOT NULL DEFAULT 0, cn_copy_url TEXT, charges_gst_amount DOUBLE NOT NULL DEFAULT 0,
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  UNIQUE (supplier_id, invoice_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: issue_types
CREATE TABLE issue_types (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: item_categories
CREATE TABLE item_categories (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: item_issue_items
CREATE TABLE item_issue_items (
  id VARCHAR(255) PRIMARY KEY,
  issue_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  quantity DOUBLE NOT NULL,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issue_id) REFERENCES item_issues(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: item_issues
CREATE TABLE item_issues (
  id VARCHAR(255) PRIMARY KEY,
  firm_id VARCHAR(255) NOT NULL,
  store_id VARCHAR(255) NOT NULL,
  project_id VARCHAR(255),
  issue_type_id VARCHAR(255) NOT NULL,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (issue_type_id) REFERENCES issue_types(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: item_names
CREATE TABLE item_names (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, unit_id VARCHAR(255), item_category_id VARCHAR(255)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: item_opening_balances
CREATE TABLE item_opening_balances (
  id VARCHAR(255) PRIMARY KEY,
  store_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  quantity DOUBLE NOT NULL DEFAULT 0,
  year TEXT NOT NULL DEFAULT '2024-25',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, reorder_level DOUBLE NOT NULL DEFAULT 0,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (item_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: item_transfer_items
CREATE TABLE item_transfer_items (
  id VARCHAR(255) PRIMARY KEY,
  transfer_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  quantity DOUBLE NOT NULL,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transfer_id) REFERENCES item_transfers(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: item_transfers
CREATE TABLE item_transfers (
  id VARCHAR(255) PRIMARY KEY,
  firm_id VARCHAR(255) NOT NULL,
  from_store_id VARCHAR(255) NOT NULL,
  to_store_id VARCHAR(255) NOT NULL,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (from_store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (to_store_id) REFERENCES stores(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: items
CREATE TABLE items (
  id VARCHAR(255) PRIMARY KEY,
  item_name_id VARCHAR(255) NOT NULL,
  item_code TEXT NOT NULL UNIQUE,
  specifications_json TEXT NOT NULL,
  unique_key TEXT NOT NULL UNIQUE,
  description TEXT,
  unit VARCHAR(255),
  photo_1 TEXT,
  photo_2 TEXT,
  photo_3 TEXT,
  photo_4 TEXT,
  photo_5 TEXT,
  item_link TEXT,
  video_link TEXT,
  reorder_level DOUBLE,
  is_active INT NOT NULL DEFAULT 1,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_name_id) REFERENCES item_names(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: migrations
CREATE TABLE migrations (
      id VARCHAR(255) PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: payments
CREATE TABLE payments (
  id VARCHAR(255) PRIMARY KEY,
  supplier_id VARCHAR(255) NOT NULL,
  po_id VARCHAR(255) NOT NULL,
  invoice_id VARCHAR(255) NOT NULL,
  amount_paid DOUBLE NOT NULL,
  payment_date DATE NOT NULL,
  due_date TEXT,
  status VARCHAR(255),
  remarks TEXT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: projects
CREATE TABLE projects (
  id VARCHAR(255) PRIMARY KEY,
  firm_id VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  client_name TEXT,
  start_date TEXT,
  end_date TEXT,
  status VARCHAR(255),
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  UNIQUE (firm_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: purchase_order_items
CREATE TABLE purchase_order_items (
  id VARCHAR(255) PRIMARY KEY,
  po_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  quantity DOUBLE NOT NULL,
  rate DOUBLE NOT NULL,
  discount_percent DOUBLE,
  tax_percent DOUBLE,
  goods_amount DOUBLE NOT NULL,
  tax_amount DOUBLE NOT NULL,
  total_amount DOUBLE NOT NULL,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
  UNIQUE (po_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: purchase_orders
CREATE TABLE purchase_orders (
  id VARCHAR(255) PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  firm_id VARCHAR(255) NOT NULL,
  store_id VARCHAR(255) NOT NULL,
  project_id VARCHAR(255),
  supplier_id VARCHAR(255) NOT NULL,
  pr_id VARCHAR(255) NOT NULL,
  status VARCHAR(255) NOT NULL CHECK (status IN ('draft','issued','partial','closed')),
  order_date DATE NOT NULL,
  payment_terms TEXT,
  credit_days INT,
  remarks TEXT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by TEXT,
  approved_at TEXT, shipping_address TEXT, terms_conditions TEXT, check_po INT NOT NULL DEFAULT 0, check_date DATE, sent_by VARCHAR(255), sent_date DATE, check_po_user_id VARCHAR(255), sent_proof TEXT,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (pr_id) REFERENCES purchase_requisitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: purchase_requisition_items
CREATE TABLE purchase_requisition_items (
  id VARCHAR(255) PRIMARY KEY,
  pr_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  requested_qty DOUBLE NOT NULL,
  approved_qty DOUBLE,
  required_date DATE,
  remarks TEXT,
  status VARCHAR(255) NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by TEXT,
  approved_at TEXT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pr_id) REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: purchase_requisitions
CREATE TABLE purchase_requisitions (
  id VARCHAR(255) PRIMARY KEY,
  pr_number TEXT NOT NULL UNIQUE,
  firm_id VARCHAR(255) NOT NULL,
  store_id VARCHAR(255) NOT NULL,
  project_id VARCHAR(255),
  requested_by VARCHAR(255) NOT NULL,
  status VARCHAR(255) NOT NULL CHECK (status IN ('pending','partially_approved','approved','rejected','cancelled')),
  remarks TEXT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by TEXT,
  approved_at TEXT, request_type TEXT NOT NULL DEFAULT 'Stock',
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: qc_records
CREATE TABLE qc_records (
  id VARCHAR(255) PRIMARY KEY,
  grn_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  accepted_qty DOUBLE NOT NULL,
  rejected_qty DOUBLE NOT NULL,
  hold_qty DOUBLE NOT NULL,
  remarks TEXT,
  qc_by TEXT NOT NULL,
  qc_date TEXT NOT NULL,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grn_id) REFERENCES grns(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
  UNIQUE (grn_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: specification_values
CREATE TABLE specification_values (
  id VARCHAR(255) PRIMARY KEY,
  specification_id VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  is_active INT NOT NULL DEFAULT 1,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (specification_id) REFERENCES specifications(id) ON DELETE RESTRICT,
  UNIQUE (specification_id, value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: specifications
CREATE TABLE specifications (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: stock_ledger
CREATE TABLE stock_ledger (
  id VARCHAR(255) PRIMARY KEY,
  firm_id VARCHAR(255) NOT NULL,
  store_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  transaction_type TEXT NOT NULL,
  quantity DOUBLE NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id VARCHAR(255) NOT NULL,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: stores
CREATE TABLE stores (
  id VARCHAR(255) PRIMARY KEY,
  firm_id VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: suppliers
CREATE TABLE suppliers (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  gst_number VARCHAR(255),
  phone VARCHAR(255),
  email VARCHAR(255),
  address TEXT,
  default_credit_days INT,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, payment_terms TEXT, gst_type TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: transporters
CREATE TABLE transporters (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  phone VARCHAR(255),
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: units
CREATE TABLE units (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: users
CREATE TABLE users (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL,
  role VARCHAR(255) NOT NULL,
  phone VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  is_active INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, password_hash TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_audit_module ON audit_logs(module);
CREATE INDEX idx_audit_performed_by ON audit_logs(performed_by);
CREATE INDEX idx_audit_record_id ON audit_logs(record_id);
CREATE INDEX idx_damaged_firm_id ON damaged_items(firm_id);
CREATE INDEX idx_damaged_item_id ON damaged_items(item_id);
CREATE INDEX idx_damaged_store_id ON damaged_items(store_id);
CREATE INDEX idx_departments_name ON departments(name);
CREATE INDEX idx_grn_links_grn_item_id ON grn_invoice_item_links(grn_item_id);
CREATE INDEX idx_grn_links_invoice_item_id ON grn_invoice_item_links(invoice_item_id);
CREATE INDEX idx_grn_items_grn_id ON grn_items(grn_id);
CREATE INDEX idx_grn_items_item_id ON grn_items(item_id);
CREATE INDEX idx_grns_created_at ON grns(created_at);
CREATE INDEX idx_grns_firm_id ON grns(firm_id);
CREATE INDEX idx_grns_goods_collected_by ON grns(goods_collected_by);
CREATE INDEX idx_grns_material_received_by ON grns(material_received_by);
CREATE INDEX idx_grns_po_id ON grns(po_id);
CREATE INDEX idx_grns_received_date ON grns(received_date);
CREATE INDEX idx_grns_store_id ON grns(store_id);
CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_item_id ON invoice_items(item_id);
CREATE INDEX idx_invoices_invoice_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_po_id ON invoices(po_id);
CREATE INDEX idx_invoices_status_created_at ON invoices(status, created_at);
CREATE INDEX idx_invoices_supplier_id ON invoices(supplier_id);
CREATE INDEX idx_issue_items_issue_id ON item_issue_items(issue_id);
CREATE INDEX idx_issue_items_item_id ON item_issue_items(item_id);
CREATE INDEX idx_issues_firm_id ON item_issues(firm_id);
CREATE INDEX idx_issues_project_id ON item_issues(project_id);
CREATE INDEX idx_issues_store_id ON item_issues(store_id);
CREATE INDEX idx_issues_type_id ON item_issues(issue_type_id);
CREATE INDEX idx_item_names_item_category_id ON item_names(item_category_id);
CREATE INDEX idx_item_names_unit_id ON item_names(unit_id);
CREATE INDEX idx_iob_item_id ON item_opening_balances(item_id);
CREATE INDEX idx_iob_store_id ON item_opening_balances(store_id);
CREATE UNIQUE INDEX idx_item_opening_balance_store_item_year ON item_opening_balances(store_id, item_id, year);
CREATE INDEX idx_transfer_items_item_id ON item_transfer_items(item_id);
CREATE INDEX idx_transfer_items_transfer_id ON item_transfer_items(transfer_id);
CREATE INDEX idx_transfers_firm_id ON item_transfers(firm_id);
CREATE INDEX idx_transfers_from_store_id ON item_transfers(from_store_id);
CREATE INDEX idx_transfers_to_store_id ON item_transfers(to_store_id);
CREATE INDEX idx_items_item_name_id ON items(item_name_id);
CREATE INDEX idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX idx_payments_payment_date ON payments(payment_date);
CREATE INDEX idx_payments_po_id ON payments(po_id);
CREATE INDEX idx_payments_status_created_at ON payments(status, created_at);
CREATE INDEX idx_payments_supplier_id ON payments(supplier_id);
CREATE INDEX idx_projects_firm_id ON projects(firm_id);
CREATE INDEX idx_po_items_item_id ON purchase_order_items(item_id);
CREATE INDEX idx_po_items_po_id ON purchase_order_items(po_id);
CREATE INDEX idx_pos_firm_id ON purchase_orders(firm_id);
CREATE INDEX idx_pos_order_date ON purchase_orders(order_date);
CREATE INDEX idx_pos_pr_id ON purchase_orders(pr_id);
CREATE INDEX idx_pos_status_created_at ON purchase_orders(status, created_at);
CREATE INDEX idx_pos_store_id ON purchase_orders(store_id);
CREATE INDEX idx_pos_supplier_id ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_check_po ON purchase_orders(check_po);
CREATE INDEX idx_purchase_orders_check_po_user_id ON purchase_orders(check_po_user_id);
CREATE INDEX idx_purchase_orders_sent_by ON purchase_orders(sent_by);
CREATE INDEX idx_purchase_orders_sent_proof ON purchase_orders(sent_proof);
CREATE INDEX idx_pr_items_item_id ON purchase_requisition_items(item_id);
CREATE INDEX idx_pr_items_pr_id ON purchase_requisition_items(pr_id);
CREATE INDEX idx_prs_firm_id ON purchase_requisitions(firm_id);
CREATE INDEX idx_prs_project_id ON purchase_requisitions(project_id);
CREATE INDEX idx_prs_status_created_at ON purchase_requisitions(status, created_at);
CREATE INDEX idx_prs_store_id ON purchase_requisitions(store_id);
CREATE INDEX idx_qc_grn_id ON qc_records(grn_id);
CREATE INDEX idx_qc_item_id ON qc_records(item_id);
CREATE INDEX idx_specification_values_specification_id ON specification_values(specification_id);
CREATE INDEX idx_stock_firm_id ON stock_ledger(firm_id);
CREATE INDEX idx_stock_item_id ON stock_ledger(item_id);
CREATE INDEX idx_stock_store_id ON stock_ledger(store_id);
CREATE INDEX idx_stores_firm_id ON stores(firm_id);
CREATE INDEX idx_transporters_name ON transporters(name);

SET FOREIGN_KEY_CHECKS=1;
