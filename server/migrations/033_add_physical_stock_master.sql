-- Migration 033: Add physical_stock_master table
CREATE TABLE IF NOT EXISTS physical_stock_master (
  id VARCHAR(255) PRIMARY KEY,
  firm_id VARCHAR(255) NOT NULL,
  store_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  physical_stock DECIMAL(15, 4) NOT NULL,
  taken_by VARCHAR(255) NOT NULL,
  taken_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ps_firm_store (firm_id, store_id),
  KEY idx_ps_item (item_id),
  KEY idx_ps_taken_on (taken_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
