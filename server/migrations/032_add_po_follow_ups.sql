-- Add PO follow ups table and columns on purchase_orders
CREATE TABLE IF NOT EXISTS po_follow_ups (
  id VARCHAR(255) PRIMARY KEY,
  po_id VARCHAR(255) NOT NULL,
  follow_up_date DATE NOT NULL,
  follow_up_remarks TEXT NULL,
  next_follow_up_date DATE NULL,
  follow_up_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_po_follow_ups_po_id (po_id),
  KEY idx_po_follow_ups_date (follow_up_date),
  CONSTRAINT fk_po_follow_ups_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ensure columns exist in purchase_orders table
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS last_follow_up_date DATE NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS last_follow_up_remarks TEXT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS last_follow_up_by VARCHAR(255) NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS next_follow_up_date DATE NULL;
