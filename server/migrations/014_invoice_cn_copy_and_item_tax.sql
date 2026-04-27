-- Add CN/Courier copy attachment and per-line GST%
ALTER TABLE invoices ADD COLUMN cn_copy_url TEXT;

ALTER TABLE invoice_items ADD COLUMN tax_percent REAL NOT NULL DEFAULT 0;

