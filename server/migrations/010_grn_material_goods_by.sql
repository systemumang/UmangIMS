PRAGMA foreign_keys = ON;

ALTER TABLE grns ADD COLUMN material_received_by TEXT;
ALTER TABLE grns ADD COLUMN goods_collected_by TEXT;

CREATE INDEX IF NOT EXISTS idx_grns_material_received_by ON grns(material_received_by);
CREATE INDEX IF NOT EXISTS idx_grns_goods_collected_by ON grns(goods_collected_by);

