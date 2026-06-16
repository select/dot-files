# Confluence Skill — Installation

## Required CLI Tools

- `bun` — runtime for the TypeScript scripts (`{baseDir}/scripts/*.ts`)

## Required Environment Variables

One Atlassian Cloud API token works for both Jira and Confluence. The scripts
prefer the `JIRA_*` variables (matching the rest of this repo) and fall back to
`CONFLUENCE_*`:

| Variable | Description | Example |
| --- | --- | --- |
| `JIRA_URL` | Atlassian site URL (with or without `/wiki`) | `https://apheris.atlassian.net` |
| `JIRA_USERNAME` | Atlassian account email | `you@apheris.com` |
| `JIRA_API_TOKEN` | Atlassian API token | `ATATT...` |

Alternatively set `CONFLUENCE_URL` / `CONFLUENCE_USERNAME` / `CONFLUENCE_API_TOKEN`.

Generate an API token at: <https://id.atlassian.com/manage-profile/security/api-tokens>

> The token must belong to an account that has Confluence access. A Jira-only
> token returns `403 Current user not permitted to use Confluence`.

## Verify

```bash
bun {baseDir}/scripts/search.ts --query "test" --limit 3
```

If you see `403`, your token's account lacks Confluence permission — use a token
from an account with wiki access.

## Notes on conversion fidelity

The Markdown ⇄ storage-format conversion covers the common building blocks
(headings, lists, code blocks with language, tables, blockquotes, links,
images, rules). It is intentionally lightweight and does **not** model every
Confluence macro — exotic macros are reduced to their text content when reading.
For pages that must preserve complex macros, edit them in Confluence directly.
