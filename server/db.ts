import fs from 'node:fs';
import path from 'node:path';
import { open, type Database } from 'sqlite';
import sqlite3 from 'sqlite3';

export type Db = Database<sqlite3.Database, sqlite3.Statement>;

let dbPromise: Promise<Db> | null = null;

function resolveDbPath() {
  const dbPath = process.env.DB_PATH?.trim();
  if (dbPath) return dbPath;

  const url = process.env.DATABASE_URL?.trim();
  if (url && url.startsWith('file:')) {
    const p = url.slice('file:'.length);
    return p.startsWith('./') || p.startsWith('.\\') ? p : p;
  }

  return path.join('data', 'purchase_system.sqlite');
}

export async function getDb(): Promise<Db> {
  if (!dbPromise) {
    const filename = resolveDbPath();
    const dir = path.dirname(filename);
    if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    dbPromise = open({
      filename,
      driver: sqlite3.Database,
    });
  }
  return dbPromise;
}

