-- ISP & RADIUS schema (SQLite - separate from main moonwitness PostgreSQL database)

-- NAS / RADIUS clients
CREATE TABLE IF NOT EXISTS nas_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip_address TEXT NOT NULL UNIQUE,
    secret TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- RADIUS authentication log
CREATE TABLE IF NOT EXISTS radius_auth_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER REFERENCES nas_clients(id) ON DELETE SET NULL,
    username TEXT NOT NULL,
    nas_ip TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    reply_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_radius_auth_log_client_id ON radius_auth_log(client_id);
CREATE INDEX IF NOT EXISTS idx_radius_auth_log_username ON radius_auth_log(username);
CREATE INDEX IF NOT EXISTS idx_radius_auth_log_created_at ON radius_auth_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_radius_auth_log_success ON radius_auth_log(success);

-- Updated_at is not used in SQLite version (uses created_at only)