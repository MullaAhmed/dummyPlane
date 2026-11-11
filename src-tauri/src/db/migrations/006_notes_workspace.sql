-- A project's notes open in a workspace tab of their own, as its code does: the
-- kind accepts `notes`, at most one per project. SQLite cannot change a CHECK
-- constraint in place, so the table is rebuilt with foreign keys off (see
-- db::migrate_up_to): its rows keep their ids, and what references them stays.
CREATE TABLE workspaces_new (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  pantheon   TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'canvas' CHECK (kind IN ('canvas', 'code', 'notes')),
  folder     TEXT
);

INSERT INTO workspaces_new (id, project_id, name, position, pantheon, created_at, updated_at, kind, folder)
  SELECT id, project_id, name, position, pantheon, created_at, updated_at, kind, folder FROM workspaces;

DROP TABLE workspaces;
ALTER TABLE workspaces_new RENAME TO workspaces;

CREATE INDEX workspaces_project ON workspaces(project_id);
CREATE UNIQUE INDEX workspaces_one_code ON workspaces(project_id) WHERE kind = 'code';
CREATE UNIQUE INDEX workspaces_one_notes ON workspaces(project_id) WHERE kind = 'notes';
