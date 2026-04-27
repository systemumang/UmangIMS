PRAGMA foreign_keys = ON;

ALTER TABLE purchase_orders ADD COLUMN check_po INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN check_date TEXT;
ALTER TABLE purchase_orders ADD COLUMN sent_by TEXT;
ALTER TABLE purchase_orders ADD COLUMN sent_date TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_check_po ON purchase_orders(check_po);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_sent_by ON purchase_orders(sent_by);

