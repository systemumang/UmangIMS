-- Migration to fix stock transaction tables
-- Ensure item_returns and item_damages have correct columns
-- Especially adding item_id to item_return_items and item_damage_items if missing

CREATE TABLE IF NOT EXISTS item_returns (
  id VARCHAR(255) PRIMARY KEY,
  transaction_no VARCHAR(255) NOT NULL,
  firm_id VARCHAR(255) NOT NULL,
  store_id VARCHAR(255),
  department VARCHAR(255),
  person VARCHAR(255),
  date DATE,
  return_type VARCHAR(255),
  customer_name VARCHAR(255),
  project_id VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (transaction_no),
  INDEX (firm_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS item_return_items (
  id VARCHAR(255) PRIMARY KEY,
  return_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  quantity DOUBLE NOT NULL,
  specification TEXT,
  remark TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (return_id) REFERENCES item_returns(id) ON DELETE CASCADE,
  INDEX (return_id),
  INDEX (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS item_damages (
  id VARCHAR(255) PRIMARY KEY,
  transaction_no VARCHAR(255) NOT NULL,
  firm_id VARCHAR(255) NOT NULL,
  store_id VARCHAR(255),
  department VARCHAR(255),
  person VARCHAR(255),
  date DATE,
  approved_by VARCHAR(255),
  project_id VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (transaction_no),
  INDEX (firm_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS item_damage_items (
  id VARCHAR(255) PRIMARY KEY,
  damage_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  quantity DOUBLE NOT NULL,
  specification TEXT,
  remark TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (damage_id) REFERENCES item_damages(id) ON DELETE CASCADE,
  INDEX (damage_id),
  INDEX (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- If tables already exist, ensure item_id column exists (MySQL doesn't have ADD COLUMN IF NOT EXISTS easily)
-- We will try to add it, ignoring errors if it already exists, via a workaround or just assuming it's needed.
-- But the best way is to use a procedure.

DELIMITER //
CREATE PROCEDURE AddColumnIfMissing()
BEGIN
    IF NOT EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_NAME='item_return_items' AND COLUMN_NAME='item_id') THEN
        ALTER TABLE item_return_items ADD COLUMN item_id VARCHAR(255) NOT NULL AFTER return_id;
    END IF;
    IF NOT EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_NAME='item_damage_items' AND COLUMN_NAME='item_id') THEN
        ALTER TABLE item_damage_items ADD COLUMN item_id VARCHAR(255) NOT NULL AFTER damage_id;
    END IF;
    IF NOT EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_NAME='item_returns' AND COLUMN_NAME='project_id') THEN
        ALTER TABLE item_returns ADD COLUMN project_id VARCHAR(255) AFTER customer_name;
    END IF;
    IF NOT EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_NAME='item_damages' AND COLUMN_NAME='project_id') THEN
        ALTER TABLE item_damages ADD COLUMN project_id VARCHAR(255) AFTER approved_by;
    END IF;
END //
DELIMITER ;
CALL AddColumnIfMissing();
DROP PROCEDURE AddColumnIfMissing;
