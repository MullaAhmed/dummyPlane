-- A workspace may work in its own folder. NULL is the project's folder, so a moved
-- project is followed; existing workspaces keep it.
ALTER TABLE workspaces ADD COLUMN folder TEXT;
