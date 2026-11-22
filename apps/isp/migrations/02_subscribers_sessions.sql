-- Subscribers, RADIUS accounting sessions, and NAS secret rotation history

CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    connection_type TEXT NOT NULL DEFAULT 'pppoe',
    framed_ip TEXT,
    download_kbps INTEGER NOT NULL DEFAULT 20480,
    upload_kbps INTEGER NOT NULL DEFAULT 10240,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS radius_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    nas_ip TEXT,
    nas_port TEXT,
    framed_ip TEXT,
    calling_station_id TEXT,
    acct_input_octets INTEGER NOT NULL DEFAULT 0,
    acct_output_octets INTEGER NOT NULL DEFAULT 0,
    acct_session_time INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    terminate_cause INTEGER,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    stopped_at TEXT
);

CREATE TABLE IF NOT EXISTS nas_secret_rotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES nas_clients(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    rotated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscribers_username ON subscribers(username);
CREATE INDEX IF NOT EXISTS idx_radius_sessions_status ON radius_sessions(status);
CREATE INDEX IF NOT EXISTS idx_radius_sessions_username ON radius_sessions(username);
