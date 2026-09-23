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
| **The exact per-scan list of "new issues" of a feature-branch scan** | ❌ not exposed publicly — only counts. Correlate with repository issues and clearly state the result is a correlation, not a direct scan-to-issue mapping. |

## Workflow

1. **PR triage** (start here when a PR's `Aikido Security` check fails):

   ```bash
   bun {baseDir}/scripts/aikido.ts pr https://github.com/owner/repo/pull/123
   # or: owner/repo#123 · 123 (current repo)
   ```

   Prints: PR/commit, check conclusion, scan URL, `N new HIGH / M new MEDIUM` counts, and — with credentials —
   the matching `ciScans` record, the Aikido `code_repo_id`, and the repo's open issue groups.

2. **Correlate dependency findings automatically** (preferred for npm/pnpm PRs):

   ```bash
   bun {baseDir}/scripts/aikido.ts pr-findings https://github.com/owner/repo/pull/123
   ```

   This compares the base/head `pnpm-lock.yaml`, identifies added package versions, queries both **open and
   closed** Aikido Open Source issues, enriches matching candidates with `/issues/{id}`, and validates that
   their severity totals equal the scan's counts. It also runs `pnpm audit --lockfile-only` in a temporary
   directory as a clearly labelled secondary cross-check. Issue details are cached for 24 hours in
   `~/.cache/aikido/issues`; on an Aikido `429`, the command waits one minute and retries.

   The output calls a result **high-confidence correlated** only if the package/version and per-severity counts
   match. It is still not a direct API mapping: Aikido does not expose the exact issue IDs for a feature scan.

3. **Manual investigation** — use this for non-dependency findings or unmatched totals:

   ```bash
   bun {baseDir}/scripts/aikido.ts repos sample-app                # get code_repo_id
   bun {baseDir}/scripts/aikido.ts issues --repo sample-app --status closed --severities critical,high --type open_source
   bun {baseDir}/scripts/aikido.ts issue 123456                    # full detail incl. CVE + fix
   bun {baseDir}/scripts/aikido.ts group 1234                      # the ?groupId= from the scan URL
   ```

4. **Report** back with: severity, type, package/file, CVE, why the PR introduced it, the fix
   (upgrade/peerDependency/ignore-with-justification), and the correlation confidence. If totals do not
   match, report that the public API cannot establish an exact per-scan issue list.

## Commands

| Command | Purpose |
| --- | --- |
| `pr <ref>` | Aikido check runs and per-severity counts on a PR |
| `pr-findings <ref>` | Correlate a dependency PR's scan counts with lockfile changes, open/closed issues, and npm audit |
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
