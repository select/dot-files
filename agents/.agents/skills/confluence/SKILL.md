---
name: confluence
description: 'Search, read, and write Confluence pages as Markdown. Use this skill when: confluence, wiki page, find a doc, search confluence, read confluence page, publish to confluence, update wiki, confluence URL, atlassian wiki'
---

# Purpose

Interact with Confluence Cloud from the terminal as plain Markdown:

- **Find** documents with free-text or CQL search.
- **Read** a page (by id, URL, or title) and save it as Markdown with a frontmatter block.
- **Write** Markdown back as a new or updated page, uploading referenced local images as attachments.

Pages round-trip: `read.ts` writes a YAML frontmatter (`confluenceId`, `title`, `space`, `parentId`, `version`, `url`) so an edited file can be pushed back with `write.ts` without re-specifying anything.

## Variables

- **Credentials**: from `JIRA_URL` / `JIRA_USERNAME` / `JIRA_API_TOKEN` (one Atlassian Cloud token covers Jira and Confluence). Falls back to `CONFLUENCE_URL` / `CONFLUENCE_USERNAME` / `CONFLUENCE_API_TOKEN`.
- **Scripts**: `{baseDir}/scripts/{search,read,write}.ts` (run with `bun`).
- **Default output**: `confluence/<pageId>-<slug>.md`

## Instructions

Requires `bun` and valid Atlassian credentials (see `{baseDir}/resources/install.md`).

Pick the operation from the user's intent:

| Intent | Script |
| --- | --- |
| "find / search / which page about X" | `search.ts` |
| "read / open / get / download page X" | `read.ts` |
| "publish / update / create / push page" | `write.ts` |

## Workflow

> Execute the following steps in order, top to bottom:

1. **Identify the operation** — search, read, or write — from the user request.

2. **Search** (find documents)

   ```bash
   bun {baseDir}/scripts/search.ts --query "<text>" [--space AP] [--limit 25]
   ```

   - Free text becomes a `siteSearch ~ "..."` CQL query, newest first.
   - For precise queries pass raw CQL: `--cql 'type=page AND title ~ "sprint"'`.
   - Add `--json` for machine-readable output.
   - Present the results (title, space, id, date, URL) and, if the user wanted a
     specific page, offer to read it.

3. **Read** (page → Markdown)

   ```bash
   bun {baseDir}/scripts/read.ts --id <pageId>
   bun {baseDir}/scripts/read.ts --url "<confluence page URL>"
   bun {baseDir}/scripts/read.ts --title "<exact title>" --space AP
   ```

   - Saves to `confluence/<id>-<slug>.md` by default; use `--out <file>` to choose,
     or `--stdout` to print without writing.
   - The file starts with a frontmatter block used for round-tripping.

4. **Write** (Markdown → page)

   - **Update an existing page** (after read + edit): the frontmatter carries the id, so just:

     ```bash
     bun {baseDir}/scripts/write.ts --file <md>
     ```

   - **Create a new page**:

     ```bash
     bun {baseDir}/scripts/write.ts --file <md> --title "<Title>" --space AP [--parentId <id>]
     ```

   - Flags override frontmatter (`--id`, `--title`, `--space`, `--parentId`).
   - Add `--write-back` to refresh the local file's frontmatter (new version/id) after publishing.
   - A leading `# Title` that matches the page title is dropped (Confluence shows the title separately).
   - Local image paths in the Markdown are uploaded as page attachments; `http(s)` images are embedded by URL.

5. **Report** — show the page URL, id, and new version. For search, show the result list.

## Cookbook

### Find then read

- IF: user asks "find the page about Gemini in pi"
- THEN: `search.ts --query "Gemini in pi"`, show hits, then `read.ts --id <chosen>`
- EXAMPLES:
  - "search confluence for the onboarding doc"
  - "which wiki page documents Vertex ADC?"

### Edit an existing page

- IF: user wants to change an existing page
- THEN: `read.ts --id <id>` → edit the Markdown file → `write.ts --file <file>` (id comes from frontmatter)
- EXAMPLES:
  - "add a troubleshooting section to page 4620156929"
  - "update the sprint notes wiki page"

### Publish a new doc

- IF: user has Markdown and wants it on Confluence
- THEN: `write.ts --file notes.md --title "..." --space AP --parentId <parent>`
- EXAMPLES:
  - "publish this summary to Confluence under the AP space"

### Supported Markdown

Headings, paragraphs, **bold**/*italic*/`code`, links, ordered/unordered lists (one nesting level), fenced code blocks (language preserved), GFM tables, blockquotes, horizontal rules, and images (local → attachment, remote → URL). Conversion both ways is best-effort for these elements; very complex Confluence macros are stripped to their text on read.
