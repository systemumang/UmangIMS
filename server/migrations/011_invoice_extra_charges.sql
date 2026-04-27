PRAGMA foreign_keys = ON;

ALTER TABLE invoices ADD COLUMN courier_charge REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN packing_charge REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN labour_charge REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN other_charge REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date);

