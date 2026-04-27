PRAGMA foreign_keys = ON;

ALTER TABLE purchase_requisitions
ADD COLUMN request_type TEXT NOT NULL DEFAULT 'Stock';

