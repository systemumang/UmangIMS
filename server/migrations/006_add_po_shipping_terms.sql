PRAGMA foreign_keys = ON;

-- Add shipping address and Terms & Conditions at PO header level
ALTER TABLE purchase_orders ADD COLUMN shipping_address TEXT;
ALTER TABLE purchase_orders ADD COLUMN terms_conditions TEXT;

