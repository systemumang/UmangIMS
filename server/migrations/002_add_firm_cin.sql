PRAGMA foreign_keys = ON;

-- Add CIN to firms master
ALTER TABLE firms ADD COLUMN cin TEXT;

