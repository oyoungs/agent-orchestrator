// SQLite DDL（migrations，版本从 1 开始）

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  parent_id      TEXT,
  dag_group      TEXT,
  type           TEXT NOT NULL,
  prompt         TEXT NOT NULL,
  status         TEXT NOT NULL,
  agent_id       TEXT,
  model_id       TEXT,
  workspace_id   TEXT,
  priority       INTEGER NOT NULL DEFAULT 0,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  started_at     INTEGER,
  finished_at    INTEGER,
  result_summary TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status);

CREATE TABLE agent_runtimes (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  version         TEXT,
  cli_path        TEXT,
  capabilities    TEXT,
  config_ref      TEXT,
  available       INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER
);

CREATE TABLE models (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'direct',
  wire_api     TEXT NOT NULL,
  base_url     TEXT NOT NULL DEFAULT '',
  auth_ref     TEXT,
  billing      TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  added_by     TEXT
);
CREATE UNIQUE INDEX idx_models_provider_model ON models(provider, model_id);

CREATE TABLE model_change_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  payload    TEXT,
  actor      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE worker_runs (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  agent_id        TEXT,
  model_id        TEXT,
  workspace_path  TEXT,
  status          TEXT NOT NULL,
  exit_code       INTEGER,
  started_at      INTEGER,
  finished_at     INTEGER,
  error_class     TEXT,
  raw_output_ref  TEXT
);

CREATE TABLE usage_records (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL,
  provider           TEXT,
  model              TEXT,
  input_tokens       INTEGER DEFAULT 0,
  output_tokens      INTEGER DEFAULT 0,
  cache_read_tokens  INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  reasoning_tokens   INTEGER DEFAULT 0,
  latency_ms         INTEGER,
  cost_usd           REAL,
  source             TEXT NOT NULL DEFAULT 'provider'
);

CREATE TABLE metric_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT,
  event_type TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  payload    TEXT
);
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE tasks ADD COLUMN routing_info TEXT;
ALTER TABLE tasks ADD COLUMN session_key TEXT;
`,
  },
  {
    version: 3,
    sql: `
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  title      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 回填：把历史 session_key（原根任务 id）升级为正式会话
INSERT INTO sessions (id, title, created_at, updated_at)
SELECT
  t1.session_key,
  (SELECT t2.prompt FROM tasks t2 WHERE t2.session_key = t1.session_key ORDER BY t2.created_at ASC LIMIT 1),
  MIN(t1.created_at),
  MAX(t1.updated_at)
FROM tasks t1
WHERE t1.session_key IS NOT NULL
GROUP BY t1.session_key;
`,
  },
  {
    version: 4,
    sql: `
ALTER TABLE sessions ADD COLUMN context TEXT NOT NULL DEFAULT '';
`,
  },
  {
    version: 5,
    sql: `
ALTER TABLE tasks ADD COLUMN target_dir TEXT;
`,
  },
];
