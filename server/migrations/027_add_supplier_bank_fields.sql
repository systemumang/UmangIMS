-- Add bank details to suppliers
ALTER TABLE suppliers ADD COLUMN bank VARCHAR(255) NULL;
ALTER TABLE suppliers ADD COLUMN account_number VARCHAR(255) NULL;
ALTER TABLE suppliers ADD COLUMN ifsc_code VARCHAR(64) NULL;
