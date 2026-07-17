-- Monitoring queries for specification_values
-- Use these in phpMyAdmin / Hostinger SQL tab whenever you want to verify
-- that duplicates are not returning and row growth remains stable.

-- 1. Total current rows
SELECT COUNT(*) AS total_rows
FROM specification_values;

-- 2. Duplicate group count
SELECT COUNT(*) AS duplicate_groups_remaining
FROM (
  SELECT 1
  FROM specification_values
  GROUP BY specification_id, COALESCE(item_name_id, ''), LOWER(TRIM(value))
  HAVING COUNT(*) > 1
) d;

-- 3. Top duplicate groups, if any exist
SELECT
  sv.specification_id AS specification_id,
  s.name AS specification_name,
  COALESCE(sv.item_name_id, '') AS item_name_scope,
  TRIM(sv.value) AS value_text,
  COUNT(*) AS duplicate_count
FROM specification_values sv
LEFT JOIN specifications s ON s.id = sv.specification_id
GROUP BY sv.specification_id, s.name, COALESCE(sv.item_name_id, ''), LOWER(TRIM(sv.value)), TRIM(sv.value)
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, specification_name ASC, value_text ASC
LIMIT 50;

-- 4. Recent daily growth
SELECT
  DATE(created_at) AS day,
  COUNT(*) AS rows_created
FROM specification_values
GROUP BY DATE(created_at)
ORDER BY day DESC
LIMIT 30;

-- 5. Current size by specification
SELECT
  sv.specification_id AS specification_id,
  s.name AS specification_name,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT CONCAT(COALESCE(sv.item_name_id, ''), '|', LOWER(TRIM(sv.value)))) AS distinct_logical_values
FROM specification_values sv
LEFT JOIN specifications s ON s.id = sv.specification_id
GROUP BY sv.specification_id, s.name
ORDER BY total_rows DESC, specification_name ASC;
