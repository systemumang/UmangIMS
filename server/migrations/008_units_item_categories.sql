PRAGMA foreign_keys = ON;

-- UNITS (Master)
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ITEM CATEGORIES (Master)
CREATE TABLE IF NOT EXISTS item_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ITEM NAMES: add unit/category references
ALTER TABLE item_names ADD COLUMN unit_id TEXT;
ALTER TABLE item_names ADD COLUMN item_category_id TEXT;

CREATE INDEX IF NOT EXISTS idx_item_names_unit_id ON item_names(unit_id);
CREATE INDEX IF NOT EXISTS idx_item_names_item_category_id ON item_names(item_category_id);

-- Backfill item categories from legacy `item_names.category`
INSERT OR IGNORE INTO item_categories (id, name, created_by, created_at, updated_by, updated_at)
SELECT
  'ICAT-' || lower(hex(randomblob(16))),
  trim(category) AS name,
  'system',
  datetime('now'),
  'system',
  datetime('now')
FROM item_names
WHERE category IS NOT NULL AND trim(category) <> ''
GROUP BY trim(category);

UPDATE item_names
SET item_category_id = (
  SELECT id FROM item_categories WHERE name = trim(item_names.category) LIMIT 1
)
WHERE category IS NOT NULL AND trim(category) <> '' AND (item_category_id IS NULL OR item_category_id = '');

