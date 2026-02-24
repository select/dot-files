---
name: fetch-github-pr
description: Fetch GitHub pull request (PR) comments and save to markdown. Use this skill when: "fetch PR", "PR comments", "review comments", "github PR", "get PR feedback" 
---

# Purpose

This skill fetches all comments from a GitHub Pull Request (both review comments and general discussion) and saves them to a well-organized markdown file. Comments are organized by file and line number with threading preserved.

## Variables

- **gh CLI**: Required - GitHub CLI must be installed and authenticated
- **Output directory**: `issues/[issueId]/pr-comments-{owner}-{repo}-{prNumber}.md`

## Instructions

When fetching PR comments, you need:

**Required:**
PR identifier or Jira Issue ID

- **PR identifier**: One of:
  - Full URL: `https://github.com/owner/repo/pull/123`
  - Short format: `owner/repo#123`
  - PR number: `#123` or `123` (uses current repo from git remote)
- **Jira Issue ID**: If provided `fetch-jira-issue` must be use to the the PR identifier

## Workflow

> Execute the following steps in order, top to bottom:

1. **Detect Input Type**
   - Determine if the user provided a **Jira issue ID** or a **PR identifier**
   - **Jira issue ID pattern**: `[A-Z]+-\d+` (e.g., `EN-4945`, `PROJ-123`)
   - **PR identifier patterns**:
     - Full URL: `https://github.com/owner/repo/pull/123`
     - Short format: `owner/repo#123`
     - PR number only: `#123` or `123`

2. **If Jira Issue ID Detected** (e.g., user says "get PR comments for EN-4945"):
   - First, load and use the `fetch-jira-issue` skill to fetch the Jira issue
   - From the fetched Jira issue markdown, look for linked GitHub PRs in the "Development" or "Links" section
   - Extract the PR URL(s) from the Jira issue
   - If no PR is linked in Jira, inform the user and ask them to provide the PR directly
   - Continue to step 3 with the extracted PR URL(s)

3. **If PR Identifier Detected** (or extracted from Jira):
   - Parse the PR format provided
   - If only a number is given, verify we're in a git repository with a GitHub remote
   - Extract owner, repo, and PR number

4. **Fetch PR Comments Using Script**
   - Run the bundled script using `bun` to fetch and organize comments:

   ```bash
   bun /path/to/.opencode/skills/fetch-github-pr/scripts/fetch-pr-comments.ts \
     --pr "owner/repo#123" \
     --jiraIssueId "EN-1234"  # optional, use the Jira ID if available
   ```

5. **Report Result**
   - On success: Report the saved file path and comment statistics
   - On failure: Show error message with troubleshooting guidance

## Script Reference

The `scripts/fetch-pr-comments.ts` script accepts:

**Command line arguments:**

```bash
bun /path/to/.opencode/skills/fetch-github-pr/scripts/fetch-pr-comments.ts \
  --pr "https://github.com/owner/repo/pull/123"

# Or with explicit Jira issue ID:
bun /path/to/.opencode/skills/fetch-github-pr/scripts/fetch-pr-comments.ts \
  --pr "owner/repo#123" \
  --jiraIssueId "EN-4526"

# Or just PR number (uses current repo):
bun /path/to/.opencode/skills/fetch-github-pr/scripts/fetch-pr-comments.ts --pr "123"
```

**Output:** Saves markdown to `issues/[issueId]/pr-comments-{owner}-{repo}-{prNumber}.md` containing: PR header → File comments (by path/line, threaded) → General discussion comments. Reports stats on completion.

## Cookbook

### Input Detection Examples

- IF: User provides a Jira issue ID (e.g., "EN-4945", "PROJ-123")
- THEN: First fetch the Jira issue to find linked PRs, then fetch PR comments
- EXAMPLES:
  - User: "get PR comments for EN-4945"
  - Action: Load `fetch-jira-issue` skill → fetch EN-4945 → extract PR link → run script with PR URL
  - User: "fetch PR feedback for PROJ-123"
  - Action: Same flow - Jira first, then PR comments

- IF: User provides full GitHub URL
- THEN: Extract owner, repo, and PR number from URL directly
- EXAMPLES:
  - User: "fetch PR https://github.com/apheris/hub/pull/456"
  - Script args: `--pr "https://github.com/apheris/hub/pull/456"`

- IF: User provides short format
- THEN: Parse owner/repo#number directly
- EXAMPLES:
  - User: "get comments from apheris/hub#456"
  - Script args: `--pr "apheris/hub#456"`

- IF: User provides just PR number
- THEN: Use current git remote to determine owner/repo
- EXAMPLES:
  - User: "fetch PR 456"
  - Script args: `--pr "456"` (script resolves from git remote)
