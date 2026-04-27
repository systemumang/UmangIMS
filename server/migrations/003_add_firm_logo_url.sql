PRAGMA foreign_keys = ON;

-- Add Logo URL (or data URL) to firms master
ALTER TABLE firms ADD COLUMN logo_url TEXT;

