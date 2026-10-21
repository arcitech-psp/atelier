# Knowledge shelf

Atelier can keep short, source-backed notes for later chats on the same installation. The `knowledge_save`, `knowledge_grep` and `knowledge_read` tools store and search notes on your computer; they do not use a server or need a network connection.

## Save a note

Use `knowledge_save` with a short title, the fact or rule, a lowercase topic such as `building-code`, and at least one HTTP or HTTPS source URL. Notes without a valid source URL are refused. Add one fact per note and include enough detail to make it useful in a later chat. Do not save guesses, personal information or secrets.

The shelf starts empty. Notes are written as JSON files under Atelier's per-install `atelier-knowledge/notes` data directory. You can set `ATELIER_KNOWLEDGE_DIR` to use a different local directory. Keep that directory private; anyone with access to the installation account can read its notes.

## Search and read

Use `knowledge_grep` with words from the fact, title or source. An optional `topic` narrows the search. Then pass a result's `id` to `knowledge_read` to see the full note and source URLs. Each chat on the same installation reads the same shelf; separate installations have separate shelves unless you point them at the same directory.

The shelf is plain local files. Back it up by copying the notes directory while Atelier is stopped, or remove it to clear saved notes.
