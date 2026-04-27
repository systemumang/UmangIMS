PRAGMA foreign_keys = ON;

-- Add default Terms & Conditions per firm (for PO / PR documents)
ALTER TABLE firms ADD COLUMN terms_conditions TEXT;

