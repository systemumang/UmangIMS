PRAGMA foreign_keys = ON;

-- Add GST type to suppliers master
ALTER TABLE suppliers ADD COLUMN gst_type TEXT;

