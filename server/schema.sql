-- Local shared FleetSync database. Migrated with PRAGMA user_version.
-- This is a single-server prototype, not a university SSO or production deployment.
CREATE TABLE workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO workspace (id, revision) VALUES (1, 0);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  department TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE INDEX idx_vehicles_department ON vehicles(department);
CREATE TABLE department_profiles (
  name TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  period TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE(vehicle_id, period)
);
CREATE INDEX idx_reports_vehicle_month ON reports(vehicle_id,period);
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE INDEX idx_tickets_vehicle ON tickets(vehicle_id);
CREATE TABLE follow_ups (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  period TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE INDEX idx_follow_ups_vehicle_month ON follow_ups(vehicle_id,period);
CREATE TABLE report_history (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id),
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE ticket_history (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('Driver','Supervisor','Maintenance','Fleet Admin')),
  department TEXT,
  password_hash TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
