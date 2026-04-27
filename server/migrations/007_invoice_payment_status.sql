-- Add payment tracking fields on invoices for lightweight status/date updates from UI
ALTER TABLE invoices ADD COLUMN payment_status TEXT;
ALTER TABLE invoices ADD COLUMN payment_date TEXT;

