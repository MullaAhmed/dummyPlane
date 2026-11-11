-- Nodes accept the `output` kind: what an agent shows with show_output, in
-- OpenUI Lang. SQLite cannot change a CHECK constraint in place: the table is
-- rebuilt with foreign keys off (see db::migrate_up_to), its rows, ids and
-- index kept, so a terminal's scrollback still points at its node.
CREATE TABLE nodes_new (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('terminal', 'orchestrator', 'note', 'kanban', 'git', 'file', 'output')),
  payload_json TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);

INSERT INTO nodes_new (id, workspace_id, kind, payload_json, updated_at)
  SELECT id, workspace_id, kind, payload_json, updated_at FROM nodes;

DROP TABLE nodes;
ALTER TABLE nodes_new RENAME TO nodes;
CREATE INDEX nodes_workspace ON nodes(workspace_id);
