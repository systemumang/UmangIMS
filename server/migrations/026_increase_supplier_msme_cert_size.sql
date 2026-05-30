-- Update msme_certificate_url to LONGTEXT to support large data URLs
ALTER TABLE suppliers MODIFY COLUMN msme_certificate_url LONGTEXT NULL;
