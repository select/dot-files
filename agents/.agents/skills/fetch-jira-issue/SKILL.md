---
name: fetch-jira-issue
description: "Fetch Jira issue with attachments and save to markdown. Use this skill when: fetch jira, jira issue, get ticket, jira ticket, download jira, EN-1234, AW-1234, FR-1234"
---

# Purpose

This skill fetches a Jira issue including its description, comments, attachments, and linked pull requests, then saves everything to a well-organized markdown file with downloaded attachments.

## Variables

- **JIRA_URL**: Jira instance URL (from environment)
- **JIRA_USERNAME**: Jira username/email (from environment)
- **JIRA_API_TOKEN**: Jira API token (from environment)
- **Output directory**: `issues/[issueKey]/`

## Instructions

When fetching a Jira issue, you need:

**Required:**

- **Issue identifier**: One of:
  - Issue key: `EN-4526`, `FR-123`
  - Full URL: `https://apheris.atlassian.net/browse/EN-4526`

## Workflow

> Execute the following steps in order, top to bottom:

1. **Determine Issue Identifier**
   
   **IF** user provides explicit issue identifier (key or URL):
   - Extract issue key from URL or use directly if already in key format
   - Validate format matches `[A-Z]+-\d+` pattern
   - Proceed to step 2
   
   **ELSE IF** user says "current issue", "this branch", "this ticket", or similar:
   - Get current branch name using `git branch --show-current`
   - Extract issue key from branch name (pattern: `[A-Z]+-\d+`)
   - If no match found, ask user to provide issue identifier explicitly
   - Proceed to step 2
   
   **ELSE**:
   - Ask user to provide issue identifier

2. **Fetch Issue Using Script**
   - Run the bundled script to fetch issue data:

   ```bash
   bun /path/to/.opencode/skills/fetch-jira-issue/scripts/fetch-issue.ts \
     --issue "EN-4526"
   ```

3. **Report Result**
   - On success: Report saved file path, attachment count, and PR links
   - On failure: Show error message with troubleshooting guidance

## Script Reference

The `scripts/fetch-issue.ts` script accepts:

**Command line arguments:**

```bash
# Using issue key:
bun fetch-issue.ts --issue "EN-4526"

# Using full URL:
bun fetch-issue.ts --issue "https://apheris.atlassian.net/browse/EN-4526"
```

## Output Format

The generated markdown file includes:

1. **Header**: Issue key and summary
2. **Metadata**: Type, status, priority, assignee, reporter, dates, labels
3. **Description**: Converted from Atlassian Document Format to markdown
4. **Attachments**: List with links to downloaded files
5. **Pull Requests**: Linked PRs with status, author, and URLs
6. **Discussion**: All comments with author, timestamps, and content

### Directory Structure

```
issues/
└── EN-4526/
    ├── issue.md           # Main issue document
    ├── mockup.png         # Downloaded attachment
    ├── requirements.pdf   # Downloaded attachment
    └── design-spec.docx   # Downloaded attachment
```

## Cookbook

### Input Format Examples

- IF: User provides issue key
- THEN: Use directly
- EXAMPLES:
  - User: "fetch jira EN-4526"
  - Script args: `--issue "EN-4526"`

- IF: User provides full Jira URL
- THEN: Extract issue key from URL
- EXAMPLES:
  - User: "get ticket https://apheris.atlassian.net/browse/EN-4526"
  - Script args: `--issue "https://apheris.atlassian.net/browse/EN-4526"`

- IF: User refers to current branch/issue
- THEN: Extract issue key from current git branch name
- EXAMPLES:
  - User: "fetch the current issue"
  - User: "get jira for this branch"
  - User: "fetch this ticket"
  - Agent: Run `git branch --show-current`, extract `[A-Z]+-\d+` pattern
  - Example branch: `feature/EN-4526-add-user-auth` → Extract: `EN-4526`
  - Script args: `--issue "EN-4526"`

- IF: User mentions issue in conversation
- THEN: Extract issue key and offer to fetch
- EXAMPLES:
  - User: "I'm working on EN-4526"
  - Agent: "Would you like me to fetch the details for EN-4526?"

### Debug Mode

Set `JIRA_DEBUG=true` to save raw JSON responses:

- `issue.json` - Raw issue data
- `comments.json` - Raw comments data
- `devinfo.json` - Raw development info (PRs)
