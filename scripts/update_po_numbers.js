import mysql from 'mysql2/promise';
import 'dotenv/config';
import { correctPoNumbers } from '../server/correct-po-numbers.js';

if (!process.env.DB_NAME || !process.env.DB_USER) throw new Error('Missing DB_NAME or DB_USER');
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
try {
  console.log('PO number correction:', await correctPoNumbers(pool));
} finally {
  await pool.end();
}
