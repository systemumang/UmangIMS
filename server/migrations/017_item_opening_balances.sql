CREATE TABLE IF NOT EXISTS item_opening_balances (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  year TEXT NOT NULL DEFAULT '2024-25',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_opening_balance_store_item_year ON item_opening_balances(store_id, item_id, year);
CREATE INDEX IF NOT EXISTS idx_iob_store_id ON item_opening_balances(store_id);
CREATE INDEX IF NOT EXISTS idx_iob_item_id ON item_opening_balances(item_id);
