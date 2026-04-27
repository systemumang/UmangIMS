PRAGMA foreign_keys = ON;

-- Operations screens rely heavily on filtering by status/date.
-- These indexes keep list queries fast as the dataset grows.

CREATE INDEX IF NOT EXISTS idx_prs_status_created_at ON purchase_requisitions(status, created_at);

CREATE INDEX IF NOT EXISTS idx_pos_status_created_at ON purchase_orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_pos_order_date ON purchase_orders(order_date);

CREATE INDEX IF NOT EXISTS idx_grns_received_date ON grns(received_date);
CREATE INDEX IF NOT EXISTS idx_grns_created_at ON grns(created_at);

CREATE INDEX IF NOT EXISTS idx_invoices_status_created_at ON invoices(status, created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date);

CREATE INDEX IF NOT EXISTS idx_payments_status_created_at ON payments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);

