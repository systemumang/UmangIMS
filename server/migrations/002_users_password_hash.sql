PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN password_hash TEXT;

