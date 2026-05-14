-- PO enhancements: advance and cancellation tracking
ALTER TABLE purchase_orders ADD COLUMN advance_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN cancel_reason TEXT;
ALTER TABLE purchase_orders ADD COLUMN cancelled_by TEXT;
ALTER TABLE purchase_orders ADD COLUMN cancelled_at TEXT;

-- PO line-level partial cancellation support
ALTER TABLE purchase_order_items ADD COLUMN cancelled_qty REAL NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN cancel_reason TEXT;

-- Invoice accounting/payment routing enhancements
ALTER TABLE invoices ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'Credit';
ALTER TABLE invoices ADD COLUMN tally_entry_date TEXT;
