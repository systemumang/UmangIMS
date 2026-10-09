-- Migration 034: Add verification and photo fields to physical stock records
ALTER TABLE physical_stock_master
  ADD COLUMN verified_by VARCHAR(255) NULL AFTER taken_by,
  ADD COLUMN photo_url TEXT NULL AFTER verified_by;
