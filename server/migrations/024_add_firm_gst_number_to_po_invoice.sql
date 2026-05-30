-- Add firm_gst_number to purchase_orders and invoices
ALTER TABLE purchase_orders ADD COLUMN firm_gst_number TEXT;
ALTER TABLE invoices ADD COLUMN firm_gst_number TEXT;
