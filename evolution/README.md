# Evolution backlog — TaskOS migration source

`backlog.json` is retained as a migration input for four stable `EVO-` task IDs. Its current statuses are imported once into the global TaskOS registry.

While TaskOS recovery is in progress, do not add duplicate TODOs or launch autonomous execution from this file. Preserve the original IDs, titles, status and acceptance checks for provenance.

After `docs/tasks/tasks.json` is restored and validated, TaskOS owns lifecycle state. Proposed evolution work must be entered through the canonical TaskOS intake; this file remains a source snapshot and must not become a second active backlog.

The importer maps `completed` to TaskOS `done` and `active` to `doing`. Unknown statuses fail the import rather than being silently treated as todo.
