---
name: fetch-my-open-prs
description: "Fetch all open GitHub pull requests authored by the current user and list them in markdown grouped by repository. Use when: open PRs, my PRs, list PRs, show open pull requests, what PRs do I have open"
---

# Purpose

Fetches all open GitHub pull requests authored by the authenticated user and presents them as a markdown list grouped by repository.

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`)

## Workflow

1. **Run the script**

   ```bash
   node {baseDir}/scripts/fetch-my-open-prs.js
   ```

   Optionally save to a file:

   ```bash
   node {baseDir}/scripts/fetch-my-open-prs.js --output open-prs.md
   ```

2. **Present the output** to the user directly in the conversation.

## Output Format

```markdown
# Open PRs for @username
_Generated: YYYY-MM-DD_

## owner/repo-name

- [#123 My feature title](https://github.com/owner/repo/pull/123) _(draft)_ `label`
  Created: YYYY-MM-DD · [@username](https://github.com/username)

## owner/other-repo

- [#456 Another PR](https://github.com/owner/other-repo/pull/456)
  Created: YYYY-MM-DD · [@username](https://github.com/username)
```

## Cookbook

- IF: User asks "what are my open PRs?" or "list my open pull requests"
- THEN: Run the script and display the markdown output

- IF: User wants to save the list to a file
- THEN: Run with `--output <filename>`

- IF: `gh` is not authenticated
- THEN: Tell the user to run `gh auth login` first
