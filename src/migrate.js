import { readFileSync } from 'fs';
import { pool } from './db.js';

const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
await pool.query(sql);
console.log('Schema migrated.');
await pool.end();
