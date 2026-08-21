---
name: aikido
description: 'Fetch Aikido Security scan results and vulnerability findings for a PR, repo or scan id via the Aikido REST API. Use this skill when: aikido, aikido security check failed, app.aikido.dev link, featurebranch scan, new HIGH issue introduced, vulnerability findings, SCA/SAST/secrets findings, security gate failing'
---

# Purpose

Agents cannot read `https://app.aikido.dev/...` links (login-only SPA). This skill gets the same information
through the **Aikido public REST API** plus the GitHub check run, so an Aikido-blocked PR can be triaged
from the terminal.

## Variables

- **Script**: `{baseDir}/scripts/aikido.ts` (run with `bun`)
- **Credentials**: `AIKIDO_CLIENT_ID` / `AIKIDO_CLIENT_SECRET` (+ optional `AIKIDO_API_URL` for US/ME/AU regions),
  or `~/.config/aikido/credentials.json` — see `{baseDir}/resources/install.md`
- **API base**: `https://app.aikido.dev/api/public/v1`, OAuth2 client-credentials token from `/api/oauth/token`
- Token is cached in `~/.cache/aikido/token.json`

## Capabilities & limits

| Want | Available? |
| --- | --- |
| Aikido check status, scan URL, new/solved counts per severity | ✅ from the GitHub check run (no Aikido creds needed) |
| PR check (CI scan) metadata: gate status, counts, repo id, branch, commit | ✅ `GET /report/ciScans` |
| Open issue groups + issue details (title, CVE, package, file, severity, fix, reachability) | ✅ `/open-issue-groups`, `/issues/export`, `/issues/{id}`, `/issues/groups/{id}` |
| Code quality findings for a PR | ✅ `/code-quality/findings?code_repo_id=&pr_number=` (via `get`) |
| **The exact per-scan list of "new issues" of a feature-branch scan** | ❌ not exposed publicly — only counts. Correlate with repo issues, or open the scan URL in a logged-in browser (`chrome-devtools` skill) |

## Workflow

1. **PR triage** (start here when a PR's `Aikido Security` check fails):

   ```bash
   bun {baseDir}/scripts/aikido.ts pr https://github.com/owner/repo/pull/123
   # or: apheris/hub#2603 · 2603 (current repo) · add --no-api to skip Aikido API
   ```

   Prints: PR/commit, check conclusion, scan URL, `N new HIGH / M new MEDIUM` counts, and — with credentials —
   the matching `ciScans` record, the Aikido `code_repo_id`, and the repo's open issue groups.

2. **Identify the offending finding.** Use the severity/type counts from step 1 and match against the repo's
   issues, filtering by what the PR touched (e.g. dependency changes → `--type open_source`):

   ```bash
   bun {baseDir}/scripts/aikido.ts repos hub                       # get code_repo_id
   bun {baseDir}/scripts/aikido.ts groups --repo-id 123 --limit 50
   bun {baseDir}/scripts/aikido.ts issues --repo hub --severities critical,high --type open_source
   bun {baseDir}/scripts/aikido.ts issue 456789                    # full detail incl. CVE + fix
   bun {baseDir}/scripts/aikido.ts group 3022                      # the ?groupId= from the scan URL
   ```

3. **Fallback for exact feature-branch findings** — if the counts cannot be attributed with confidence,
   use the `chrome-devtools` skill with the user's logged-in browser profile to open
   `https://app.aikido.dev/featurebranch/scan/<scanId>` and read the findings table, or ask the user to paste it.

4. **Report** back with: severity, type, package/file, CVE, why the PR introduced it, and the fix
   (upgrade/peerDependency/ignore-with-justification).

## Commands

| Command | Purpose |
| --- | --- |
| `pr <ref>` | Aikido check runs on a PR + scan/repo detail |
| `scan <id> [--repo-id N]` | one PR check's metadata (pages `/report/ciScans` to find it) |
| `scans [--repo-id N] [--search S] [--gate-status failed]` | recent PR checks |
| `repos [name]` | code repositories with their Aikido ids |
| `issues --repo <name\|id> [--severities ...] [--type ...] [--status open]` | issue export |
| `groups [--repo-id N] [--type ...]` | open issue groups |
| `group <id>` / `issue <id>` | full details |
| `get <path> [k=v ...]` | raw GET on `/api/public/v1` — escape hatch for any endpoint in https://apidocs.aikido.dev/llms.txt |

Global flags: `--json`, `--limit N`, `--page N`, `--out FILE`, `--no-api`.

## Notes

- Issue types: `open_source`, `sast`, `iac`, `leaked_secret`, `malware`, `license`, `eol`, `docker_container`, `cloud`, `scm_security`.
- Rate limits and full endpoint list: https://apidocs.aikido.dev/llms.txt (machine-readable index with OpenAPI per endpoint).
- The CI/gating API (`X-AIK-API-SECRET`, `AikidoSec/ci-api-client`) only starts/polls scans and returns counts — not used here.
- Never print the client secret; the script only writes the short-lived token to `~/.cache/aikido/token.json` (mode 600).
