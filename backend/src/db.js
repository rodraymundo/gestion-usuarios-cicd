'use strict';

const fs = require('fs');
const path = require('path');
// Módulo SQLite incluido en Node 22.13+ (no requiere compilar nada, ideal para Alpine).
const { DatabaseSync } = require('node:sqlite');

const PUBLIC_COLUMNS = 'id, name, username, email, role, created_at, updated_at';
const EDITABLE = ['name', 'username', 'email', 'role', 'password_hash'];

const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
const plain = (row) => (row ? { ...row } : null);

/**
 * Capa de acceso a datos. Todas las consultas usan parámetros (sin concatenar entradas del usuario)
 * y se envuelven en un span de OpenTelemetry para que aparezcan en las trazas.
 */
function openDatabase(dbPath, telemetry) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email         TEXT,
      role          TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);

  const sql = {
    list: `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY id`,
    search:
      `SELECT ${PUBLIC_COLUMNS} FROM users ` +
      `WHERE name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR COALESCE(email, '') LIKE ? ESCAPE '\\' ` +
      'ORDER BY id',
    byId: `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`,
    byUsername: 'SELECT * FROM users WHERE username = ?',
    insert:
      'INSERT INTO users (name, username, email, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    remove: 'DELETE FROM users WHERE id = ?',
    count: 'SELECT COUNT(*) AS total FROM users',
    ping: 'SELECT 1 AS ok',
  };
  const stmt = Object.fromEntries(Object.entries(sql).map(([key, text]) => [key, db.prepare(text)]));
  const traced = (name, statement, fn) => telemetry.dbSpan(name, statement, fn);

  return {
    ping() {
      return traced('SELECT health', sql.ping, () => stmt.ping.get().ok === 1);
    },

    count() {
      return traced('SELECT users', sql.count, () => stmt.count.get().total);
    },

    list(query) {
      if (query) {
        const like = `%${escapeLike(query)}%`;
        return traced('SELECT users', sql.search, () => stmt.search.all(like, like, like).map(plain));
      }
      return traced('SELECT users', sql.list, () => stmt.list.all().map(plain));
    },

    get(id) {
      return traced('SELECT users', sql.byId, () => plain(stmt.byId.get(id)));
    },

    getByUsername(username) {
      return traced('SELECT users', sql.byUsername, () => plain(stmt.byUsername.get(username)));
    },

    insert({ name, username, email, role, password_hash: passwordHash }) {
      return traced('INSERT users', sql.insert, () => {
        const now = new Date().toISOString();
        const info = stmt.insert.run(name, username, email ?? null, role, passwordHash, now, now);
        return plain(stmt.byId.get(Number(info.lastInsertRowid)));
      });
    },

    update(id, fields) {
      const keys = Object.keys(fields).filter((key) => EDITABLE.includes(key));
      if (keys.length === 0) return this.get(id);
      const statement = `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
      return traced('UPDATE users', statement, () => {
        const values = keys.map((key) => fields[key]);
        db.prepare(statement).run(...values, new Date().toISOString(), id);
        return plain(stmt.byId.get(id));
      });
    },

    remove(id) {
      return traced('DELETE users', sql.remove, () => stmt.remove.run(id).changes > 0);
    },

    close() {
      db.close();
    },
  };
}

module.exports = { openDatabase };
