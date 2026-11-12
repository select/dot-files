---
name: aikido
description: 'Fetch Aikido Security scan results and exact vulnerability findings for a PR or scan id via the Aikido REST API. Use this skill when: aikido, aikido security check failed, app.aikido.dev link, featurebranch scan, new HIGH issue introduced, vulnerability findings, SCA/SAST/secrets findings, security gate failing'
---

# Purpose

Aikido application links are login-only, but the **public REST API exposes exact PR-check findings**.
Use `GET /report/ciScans/{scan_id}/detail`, not repository issue correlation, to identify what a scan added or resolved.

## Variables

- **Script**: `{baseDir}/scripts/aikido.ts` (run with `bun`)
- **Credentials**: `AIKIDO_CLIENT_ID` / `AIKIDO_CLIENT_SECRET` (+ optional `AIKIDO_API_URL` for US/ME/AU regions),
  or `~/.config/aikido/credentials.json` — see `{baseDir}/resources/install.md`
- **API base**: `https://app.aikido.dev/api/public/v1`; OAuth2 client-credentials token from `/api/oauth/token`
- Token is cached in `~/.cache/aikido/token.json` (mode 0600).

## Workflow

1. **PR triage**:

   ```bash
   bun {baseDir}/scripts/aikido.ts pr https://github.com/owner/repo/pull/123
   # or: owner/repo#123 · 123 (current repo)
   ```

   Reads the head commit's GitHub Aikido checks and their scan URLs/counts. With credentials it fetches
   exact added/resolved findings for each distinct scan. Without credentials (or with `--no-api`), it
   reports GitHub check data only and explicitly says findings were not fetched. Do not infer that
   credentials are missing without checking the supported environment/file configuration safely.

2. **Exact findings** (any ecosystem, including Python `uv.lock`, plus code/Docker/secret findings):

   ```bash
   bun {baseDir}/scripts/aikido.ts pr-findings https://github.com/owner/repo/pull/123
   bun {baseDir}/scripts/aikido.ts scan 246450237
   bun {baseDir}/scripts/aikido.ts scan 'https://app.aikido.dev/featurebranch/scan/246450237?groupId=3022' --json
   ```

   `pr-findings` requires credentials and a scan URL on a head-commit check. It uses the same direct
   detail endpoint as `scan`; it does not read lockfiles, run pnpm audit, or guess from open/closed issues.
   PR commands reject details whose `end_commit_id` differs from the PR head, rather than reporting stale findings.
   API errors (including missing `reports:read` scope, unavailable scans, or exhausted retries) fail visibly;
   they must not be presented as an empty successful scan or silently replaced by correlation.

3. **Report** the added/resolved findings: title, CVE/CWE where available, package/file/line,
   installed and patched versions, issue status, scanned commit and completed scan types.
   The detail endpoint's `severity` is a **numeric Aikido priority score (1–100)**, not the string
   critical/high/medium/low used by other endpoints. Do not relabel it without a documented mapping.
   Added issues may be ignored/snoozed, so list totals need not equal gate counts. Preserve status and
   do not discard findings just to make totals match. `--json` preserves the full response, including
   nullable fields and removed-issue IDs; added findings need not have issue IDs. Markdown is a summary.

## Commands

| Command | Purpose |
| --- | --- |
| `pr <ref>` | GitHub Aikido checks/counts plus exact scan findings when credentials are available |
| `pr-findings <ref>` | Require exact added/resolved findings from head-commit scan URLs |
| `scan <id\|URL>` | Direct PR-check detail, including `issues_added` and `issues_removed`; no metadata pagination needed |
| `scans [--repo-id N] [--search S] [--gate-status failed]` | Recent PR-check metadata via `/report/ciScans` |
| `repos [name]` | Code repositories with their Aikido IDs |
| `issues --repo <name\|id> [--severities ...] [--type ...] [--status open]` | Repository issue export (not a per-scan finding list) |
| `groups [--repo-id N] [--type ...]` | Open issue groups |
| `group <id>` / `issue <id>` | Full repository issue/group details |
| `get <path> [k=v ...]` | Raw GET on `/api/public/v1` |

Output flags: `--json`, `--out FILE`. List pagination: `--limit N`, `--page N`.
`--no-api` is for GitHub-only `pr`; API-dependent commands reject it.

## Notes

- The detail endpoint requires **`reports:read`**. Repository/issue commands need their corresponding read scopes.
- Current endpoint reference: https://apidocs.aikido.dev/reference/getciscandetail.md
- Full endpoint index and rate limits: https://apidocs.aikido.dev/llms.txt
- The script throttles public API requests; on a 429 it waits about one minute and retries once.
- If no scan URL is available, use `scans` to locate the relevant scan and confirm its commit before reporting.
- Repository issues and independent audits may provide extra context, but are not substitutes for exact scan details.
- Never print credentials or token caches, and never require a browser login when API access is already configured.
