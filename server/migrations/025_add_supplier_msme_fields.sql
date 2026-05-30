-- Add MSME fields to suppliers
ALTER TABLE suppliers ADD COLUMN msme_applicable TINYINT NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN msme_certificate_url LONGTEXT NULL;
