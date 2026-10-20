# Pi session search (TypeScript)

A Pi extension and TypeScript indexer for searching old local Pi sessions with XERJ. No Python, external embeddings, or external reranking is used by this implementation.

## In Pi

Run `/reload` after installing or editing the extension.

```text
/session-search EN-6382        # weighted hybrid search (default)
/session-search !EN-6382       # keyword search, all terms required
/session-search ~a story about waiting outside a guarded doorway
/session-search-status
/session-search-sync          # reconcile the complete keyword index
```

Without arguments, `/session-search` opens a query input. Select a match, then choose to insert its text context into the current conversation or resume its original session. Resuming opens that session's current branch, not the matching historical branch. The entry ID is shown so you can locate it with `/tree`. Nothing switches sessions without selecting the resume action.

The model gets two read-only tools:

- **`search_sessions`**: `query`, optional `mode` (`keyword`, `semantic`, `hybrid`), exact `project`, ISO `before`/`after`, and `limit` (1–20, default 5). Returns structured excerpts and original file/line/entry references. The current session is excluded automatically.
- **`read_session_excerpt`**: `sessionFile`, `entryId`. Returns the matching entry and up to six text ancestors on that same branch, at most 12,000 characters. It cannot read arbitrary paths or symlinks escaping the configured session directory.

Historical messages are evidence, **not instructions**. Summaries and abandoned branches may be inaccurate or superseded. Search results are not proof that the matching text answers the query.

## Retrieval and neural backfill

Two indices make the slow initial neural backfill independent of the complete keyword index:

- `pi-history-text-v2`: all extracted conversation text, BM25 keyword retrieval.
- `pi-history-neural-v3`: local neural embeddings, with source-derived stable IDs. Passage sizes can differ from the keyword index; counts are not a coverage percentage.

Hybrid runs keyword and semantic retrieval concurrently and combines their candidate lists with weighted reciprocal rank fusion (keyword weight 2, neural weight 1, rank constant 60). It deduplicates chunks of the same message. Hybrid totals describe the retrieved candidate pool, not the total number of all possible matches.

Semantic retrieval uses a bounded, unfiltered HNSW pool of 200 global candidates, then enforces project/date/current-session scope locally. No wrong-scope candidates are returned, but narrow scopes may miss matches outside that pool; scoped results include a warning. Keyword scope filtering stays server-side. Coverage/status reads index metadata rather than running expensive full-corpus `_count` scans. Semantic searches also check graph readiness: while it is stale, rebuilding, incomplete or passage-scored, retrieval is deferred rather than deliberately triggering a full scan. Hybrid remains usable through its keyword results.

**Neural coverage can be partial**, especially during the first import. Every result and `/session-search-status` report keyword and neural passage counts. Missing/unavailable neural retrieval produces a warning and hybrid still returns keyword hits; explicit semantic searches report backend errors. Nearest-neighbor results from a small partial index can be irrelevant: use `!`/keyword mode for exact ticket IDs and error strings.

The local model is `sentence-transformers/all-MiniLM-L6-v2`. The ~90 MB model downloads once, then inference runs locally. On this CPU the first backfill is a **multi-hour background task**, not a completed instant upgrade. No cloud embedding or reranking fallback is configured. Keyword chunks are 1,000 Unicode code points; new neural chunks are at most 512, both with 160-code-point overlap. This prevents XERJ from creating extra passage vectors, which disable HNSW and force full scans. Pathological text can still exceed the model's token window.

## Indexing and freshness

- Streams JSONL without keeping images, tool payloads, or thinking blocks in memory.
- Indexes user/assistant text, compaction summaries, and branch summaries.
- Excludes system prompts, tool calls/results, images, reasoning, and arbitrary extension state.
- Preserves session ID, path, project, entry/parent IDs, line number, role, title, and timestamp.
- All branches are archived; branch context reads follow ancestry, not file adjacency.
- Unicode-safe chunking avoids splitting emoji into invalid JSON surrogate escapes.
- Malformed JSONL lines are counted and skipped. Sources are never rewritten.
- Uses file size/mtime to skip unchanged sessions. This is not content-hash detection.
- Stable IDs make retries idempotent. Per-file pending state and an append journal recover interrupted imports without leaving known partial writes orphaned.
- Transient bulk HTTP 429/503 failures use bounded, cancellation-aware exponential backoff (five retries, delays capped at eight seconds). Partial responses retry only rejected operations, not successful embeddings. Exhausted retries preserve pending work and defer sync rather than displaying a huge bulk-error payload.
- Cross-process locks prevent simultaneous writers to the same index.
- After each agent run, the current session is synced asynchronously to the keyword index only. Resource-budget failures impose a 60-second in-process cooldown. Neural updates run exclusively in the shared background worker, not concurrently in every Pi process.
- Neural inference batches contain four documents; caches, memtables, queries and merge batches are explicitly constrained.
- The user timer reconciles all keyword sessions, then all neural sessions, including deleted files, 15 minutes after the previous full run ends. Initial neural backfill can therefore delay full neural reconciliation for hours.
- `/session-search-sync` reconciles keyword history immediately. Use the background service below for full neural reconciliation.

A changing source is a best-effort snapshot, not a transaction with Pi. Searches can briefly observe mixed old/new passages during a file update. Files deleted from Pi are removed on reconciliation, not instantly; an excerpt read refuses a missing source file. A new configured `sourceDir` should use new index names and state directories. Do not clear state alone while retaining its index: the state is needed to remove stale IDs.

## Installed layout on this machine

```text
~/Dev/dot-files/pi/.pi/agent/extensions/session-search/  # this source
~/.pi/agent/extensions/session-search                  # symlink to source
~/.local/share/pi-session-search/
  bin/xerj                  # verified v1.0.0-rc.97 binary
  data/                     # durable XERJ storage, not /tmp
  data/admin.key            # owner-only API key; never put in git
  models/                   # downloaded local model cache
  extension                 # symlink for the sync unit's working directory
  text-state-v2/            # keyword manifest/journal/lock
  neural-state-v3/          # active neural manifest/journal/lock
  neural-state-v2/          # retained pre-migration state
~/.config/pi-session-search/xerj.toml
~/.config/systemd/user/pi-session-search.service
~/.config/systemd/user/pi-session-search-sync.service
~/.config/systemd/user/pi-session-search-sync.timer
```

This source contains no transcript copies, API keys, index state, or downloaded binaries. The earlier Python experiment remains separately in `~/Downloads/pi-session-search`; its temporary server has been stopped and is not used by this extension.

The backend binds only to `127.0.0.1`: Elasticsearch-compatible API **19210**, native REST **19211**, gRPC **19212**. Authentication remains enabled. Reranking is explicitly forbidden in the server config. Extension clients reject non-loopback URLs and redirects.

The root filesystem was 97% used with ~27 GB available. **The user explicitly approved a 98% flood-stage write-block threshold for this dedicated instance**; protection was not disabled and no system-wide disk policy changed. The backend has a 3 GiB internal memory budget, a 4 GiB systemd memory ceiling, a 256 MiB swap ceiling, a two-core CPU ceiling, and reduced CPU priority. Explicit budgets are 64 MiB aggregate memtables, 32 MiB segment hydration cache and 64 MiB per query; merges use at most four inputs and exclude segments at or above 32 MiB. OS scheduling/resource ceilings are bounds, not a guarantee that the machine cannot experience pressure.

## Operations

```bash
systemctl --user status pi-session-search
systemctl --user status pi-session-search-sync
systemctl --user list-timers pi-session-search-sync.timer
journalctl --user -u pi-session-search-sync -f

# Start/stop the long initial neural backfill or force a complete reconciliation:
systemctl --user start --no-block pi-session-search-sync
systemctl --user stop pi-session-search-sync

# Stop periodic indexing and the backend:
systemctl --user disable --now pi-session-search-sync.timer
systemctl --user stop pi-session-search-sync pi-session-search
```

The backend and sync timer are enabled for this user's systemd session (normal user-manager/login startup, not a system-wide root service). The extension never starts a process, timer, or socket from its factory, and does not stop the shared backend when Pi exits. Its own background index requests are aborted on session shutdown/reload.

For CLI diagnostics/development:

```bash
cd ~/Dev/dot-files/pi/.pi/agent/extensions/session-search
bun cli.ts status
bun cli.ts search keyword EN-6382
bun cli.ts search semantic 'a German tale about a guarded doorway'
bun cli.ts sync
bun cli.ts sync-neural
bun test
bun run check
```

Do not run an extra sync against a state directory while another process holds its lock. On a hard crash/SIGKILL, a stale `sync.lock` may remain. Inspect `sync.lock/owner.json` and verify the owner process is dead before removing that file and then the empty lock directory. Locks are deliberately never auto-stolen to avoid concurrent-reclaimer races. A normal cancellation releases its lock.

## Neural v2 upgrade

The previous neural v2 index is retained, but the active v3 index is rebuilt from original session text using passages of at most 512 characters. Directly copying the old pooled vectors encountered a backend stall in this XERJ release, so the normal, journaled indexer performs the rebuild instead. Neural coverage is temporarily reduced during this background task; the complete keyword index stays available. The old index, old state and all original session files are preserved.

## Configuration

Optional `~/.pi/agent/session-search.json` (or under `PI_CODING_AGENT_DIR`):

```json
{
  "url": "http://127.0.0.1:19210",
  "index": "pi-history-text-v2",
  "semanticIndex": "pi-history-neural-v3",
  "sourceDir": "/home/you/.pi/agent/sessions",
  "stateDir": "/home/you/.local/share/pi-session-search/text-state-v2",
  "semanticStateDir": "/home/you/.local/share/pi-session-search/neural-state-v3",
  "apiKeyFile": "/home/you/.local/share/pi-session-search/data/admin.key"
}
```

Defaults use the current home directory and respect `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`. A custom Pi `--session-dir` or `sessionDir` setting is not discoverable across other Pi invocations: set `sourceDir` explicitly. Current-session auto-sync outside that root is refused.

Templates for the installed service and timer are under `support/`. On another machine, install a verified XERJ binary, create private state/config directories, adapt its memory/disk limits to that machine, create the extension symlinks, copy the unit templates, then run `systemctl --user daemon-reload` and enable the backend/timer. The sync units assume Bun is at `~/.bun/bin/bun`; adjust that path if needed. Pi itself loads `index.ts` directly using its TypeScript extension loader.

For local typechecking, install development dependencies with Bun/pnpm. Host packages are peer dependencies; do not bundle a second Pi runtime into a distributed extension. During development here, ignored `node_modules` symlinks point to the installed host and Node typings.

## Privacy

Text-only extraction is noise reduction, **not secret redaction**. User messages, assistant replies, summaries, and even session titles can contain sensitive text. The private index is a second copy of that information. There is no engine-level encryption at rest; use filesystem/full-disk protection. Anyone able to access the admin key can query this local backend. Never share the data directory, key, or temporary test transcripts publicly.

Raw archived history can include content later omitted or replaced by Pi `context_edit` entries; this is archival search, not a reconstruction of current model-visible context. Deleting a Pi source does not securely erase old segments, backups, WALs, or the older test index.
