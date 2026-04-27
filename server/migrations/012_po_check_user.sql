PRAGMA foreign_keys = ON;

ALTER TABLE purchase_orders ADD COLUMN check_po_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_check_po_user_id ON purchase_orders(check_po_user_id);
