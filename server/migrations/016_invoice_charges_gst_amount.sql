-- Add GST amount on extra charges (recorded at invoice level)
ALTER TABLE invoices ADD COLUMN charges_gst_amount REAL NOT NULL DEFAULT 0;

