PRAGMA foreign_keys = ON;

ALTER TABLE purchase_orders ADD COLUMN sent_proof TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_sent_proof ON purchase_orders(sent_proof);
