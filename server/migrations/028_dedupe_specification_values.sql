-- 028_dedupe_specification_values.sql
--
-- Purpose:
-- 1. Back up the current specification_values table.
-- 2. Archive duplicate rows separately for rollback/audit.
-- 3. Delete only surplus duplicates, keeping one canonical row per logical value.
-- 4. Add a uniqueness guard so the repair job and future inserts cannot recreate duplicates.
--
-- Safety:
-- - Existing transactions are safe because no live transaction table references specification_values.id.
-- - Transactional tables store specification text/JSON directly, not spec value row ids.
--
-- Recommended run procedure:
-- 1. Run during low traffic.
-- 2. Preferably stop/restart the app around this migration so the 30-minute repair job
--    does not insert more rows while cleanup is running.

-- Step 1: Full snapshot backup.
DROP TABLE IF EXISTS specification_values_backup_20260717;
CREATE TABLE specification_values_backup_20260717 LIKE specification_values;
INSERT INTO specification_values_backup_20260717
SELECT *
FROM specification_values;

-- Step 2: Normalize existing values for cleaner grouping.
UPDATE specification_values
SET
  item_name_id = NULLIF(TRIM(item_name_id), ''),
  value = TRIM(value)
WHERE
  (item_name_id IS NOT NULL AND item_name_id <> TRIM(item_name_id))
  OR value <> TRIM(value);

-- Step 3: Pick one canonical row per logical value group.
DROP TEMPORARY TABLE IF EXISTS specification_values_keep_ids;
CREATE TEMPORARY TABLE specification_values_keep_ids AS
SELECT keep_id
FROM (
  SELECT
    id AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY
        specification_id,
        COALESCE(item_name_id, ''),
        LOWER(TRIM(value))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM specification_values
) ranked
WHERE rn = 1;

-- Step 4: Archive only the duplicate rows that will be deleted.
DROP TABLE IF EXISTS specification_values_duplicates_20260717;
CREATE TABLE specification_values_duplicates_20260717 AS
SELECT sv.*
FROM specification_values sv
LEFT JOIN specification_values_keep_ids keepers
  ON keepers.keep_id = sv.id
WHERE keepers.keep_id IS NULL;

-- Step 5: Delete duplicate surplus rows, keep one row per logical value.
DELETE sv
FROM specification_values sv
LEFT JOIN specification_values_keep_ids keepers
  ON keepers.keep_id = sv.id
WHERE keepers.keep_id IS NULL;

DROP TEMPORARY TABLE IF EXISTS specification_values_keep_ids;

-- Step 6: Add helper generated columns used for robust uniqueness.
-- These columns avoid indexing raw TEXT directly and normalize case/whitespace.
ALTER TABLE specification_values
  ADD COLUMN IF NOT EXISTS item_name_scope VARCHAR(255)
    GENERATED ALWAYS AS (COALESCE(NULLIF(TRIM(item_name_id), ''), '')) STORED,
  ADD COLUMN IF NOT EXISTS value_norm_hash CHAR(64)
    GENERATED ALWAYS AS (SHA2(LOWER(TRIM(value)), 256)) STORED;

-- Step 7: Remove old non-primary unique indexes on the table, if any remain.
SET @drop_unique_sql = (
  SELECT GROUP_CONCAT(CONCAT('DROP INDEX `', INDEX_NAME, '` ON specification_values') SEPARATOR '; ')
  FROM (
    SELECT DISTINCT INDEX_NAME
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'specification_values'
      AND non_unique = 0
      AND index_name <> 'PRIMARY'
  ) uniqs
);
SET @drop_unique_sql = IFNULL(@drop_unique_sql, 'SELECT 1');
PREPARE stmt_drop_uniqs FROM @drop_unique_sql;
EXECUTE stmt_drop_uniqs;
DEALLOCATE PREPARE stmt_drop_uniqs;

-- Step 8: Add the durable uniqueness guard.
ALTER TABLE specification_values
  ADD UNIQUE INDEX uq_spec_values_scope_hash (specification_id, item_name_scope, value_norm_hash);

-- Step 9: Verification queries.
SELECT COUNT(*) AS total_rows_after_cleanup FROM specification_values;

SELECT COUNT(*) AS duplicate_groups_remaining
FROM (
  SELECT 1
  FROM specification_values
  GROUP BY specification_id, COALESCE(item_name_id, ''), LOWER(TRIM(value))
  HAVING COUNT(*) > 1
) d;

SELECT COUNT(*) AS archived_duplicate_rows
FROM specification_values_duplicates_20260717;
