---
name: create-jira-issue
description: "Create or update Jira issues for EN (Engineering) or AW (Apheris Web), or move existing issues to EN, interactively. Use this skill when: create issue, update issue, move issue, transfer issue, move to EN board, current sprint, new EN ticket, new AW ticket, jira issue, engineering ticket, create task, fix jira formatting"
---

# Purpose

This skill guides you through creating or updating a Jira issue on EN (Engineering, the default) or AW (Apheris Web), and moving an existing issue to EN. It ensures all required template fields are filled when creating issues, asks clarifying questions for missing information, and presents a preview before making Jira changes.

## Variables

- **Credentials**: Loaded from `~/.config/atlassian-jira/credentials.json` or environment variables (JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN)
- **Supported creation/update project keys**: EN (default), AW
- **Supported move destination**: EN
- **baseDir**: this skill's directory

## Instructions

When creating an issue, you must gather information for the issue template which includes:

**Required Fields:**

- **Board**: EN by default; use AW only when explicitly requested. Include the destination in the preview
- **Title**: Short, descriptive title for the issue
- **Context**: Background information explaining why this issue exists, what problem it solves, or what feature it implements
- **Definition of Done**: List of criteria that must be met for the issue to be considered complete. The script renders them as Jira checkboxes (action items), so pass each criterion as plain text without a `[ ]` prefix

**Optional Fields:**

- **Issue Type**: Type of issue (Task, Bug, Story) - defaults to Task
- **Assignee**: Display name or email of the person to assign (resolved via Jira user search)
- **Sprint**: Sprint name (partial match, e.g. "155") or numeric sprint ID
- **Attachments**: File paths to images/files to attach and embed inline in the description
- **Footer**: Markdown appended after the Definition of Done (e.g. an attribution line)

## Moving an Existing Issue Between Boards

Use this workflow instead of the issue-creation workflow when the user asks to move or transfer an existing issue to EN, optionally into a sprint. Do **not** ask for a new title, context, or Definition of Done: the issue and its description are retained by Jira.

1. **Parse and inspect**
   - Extract the source issue key, target board, optional target issue type, and desired sprint.
   - Fetch the source issue and list the target board's active sprint(s) and available issue types. The source issue type is retained when a matching type exists in the destination project.
   - If the user says “current sprint”, use `current`; it resolves to the target board's sole active sprint.
2. **Resolve missing information**
   - Use EN as the destination and include it in the confirmation preview.
   - If the source issue type does not exist in the target project, ask the user to select a target type from the available types.
   - Ask which sprint to use only if the user requests sprint placement but does not identify one. Do not add a sprint if none was requested.
3. **Present the move preview and confirm**
   - State the source key, target board, target issue type, and target sprint (if any).
   - Clearly say that Jira will assign a new issue key and send its required bulk-move notification.
   - Use the `question` tool and require explicit confirmation before running the move command.
4. **Move and assign sprint**
   - Run the bundled script only after confirmation:

     ```bash
     bun {baseDir}/scripts/move-issue.ts \
       --issue "SOURCE-123" \
       --board "EN" \
       --sprint "current"
     ```

   - Add `--issueType "Task"` only when the destination type needs to differ from, or cannot be inferred from, the source type.
   - The script waits for Jira's asynchronous move operation to finish, then adds the **new** issue key to the sprint. Do not attempt sprint assignment before the move completes.
5. **Verify and report**
   - Report the new issue key and URL, target board, and sprint. If sprint assignment fails after a successful transfer, explicitly report the partial success and the new key so it can be corrected.

> A board transfer is not readily reversible. Always obtain confirmation even where the user supplied a direct instruction.

## Issue Creation and Description Update Workflow

> Execute the following steps in order, top to bottom for issue creation:

1. **Parse Initial Input**
   - Analyze the user's initial prompt for any pre-filled information
   - Extract: board, title, context, definition of done criteria, issue type
   - Note which fields are complete, partial, or missing

2. **Identify Missing Required Fields**
   - Check which required fields are missing or unclear
   - Prepare targeted questions for each missing field

3. **Ask Clarifying Questions**
   - Use the `question` tool to ask about missing/unclear fields
   - Ask questions one section at a time or batch related questions
   - For each question, provide context about what's expected

   Example questions:
   - Default to EN without asking a board-selection question; honor an explicit AW request and show the destination in the preview.
   - "What should the title be for this issue?"
   - "Can you provide the context? (Background information explaining why this issue exists)"
   - "What are the Definition of Done criteria? (List the conditions that must be met for this to be complete)"

4. **Handle Issue Type**
   - Ask about issue type if not specified:

   ```
   question: "What type of issue is this?"
   options:
   - Task (Recommended)
   - Bug
   - Story
   ```

5. **Generate Issue Preview**
   - Format the collected information as a Jira issue markdown preview:

   ```markdown
   ## Issue Preview

   **Board:** [EN/AW]
   **Title:** [title]
   **Type:** [Task/Bug/Story]

   ### Context

   [context]

   ### Definition of Done

   - [ ] [criterion 1]
   - [ ] [criterion 2]
   - ...
   ```

   The `[ ]` boxes are only for the preview. In the `definitionOfDone` array, pass the bare criterion text; the script turns each item into a Jira checkbox.

6. **Present Summary and Confirm**
   - Show the formatted issue preview to the user
   - Use the `question` tool to ask for confirmation:
     - "Submit as-is"
     - "Edit before submitting"
     - "Cancel"
   - If user wants to edit, go back to step 3 for the specific field

7. **Submit to Jira Using Script**
   - Only proceed after explicit user confirmation
   - **Always create/update through the script**, not the Atlassian MCP `createJiraIssue`/`editJiraIssue` tools with markdown content: their markdown converter has no task lists, so `- [ ] item` ends up as a bullet whose text starts with a literal `[ ]`. Put anything that must come after the Definition of Done (such as an attribution line) in `footer`. If the script reports missing credentials, ask the user to create `~/.config/atlassian-jira/credentials.json` (`{"jiraUrl", "username", "apiToken"}`). If the MCP tools must be used anyway, generate the description with `--dry-run` (it needs no credentials) and send that JSON with `contentFormat: "adf"`
   - **For complex/multiline content**: Use the temporary file approach (see "Handling Multiline Content" section below)
   - **For simple content**: Use direct stdin with echo

   Simple example:
   ```bash
   echo '{"board": "EN", "title": "...", "context": "...", "definitionOfDone": ["...", "..."], "issueType": "Task"}' | \
     bun {baseDir}/scripts/create-issue.ts --stdin
   ```

   Complex example (with multiline content, special characters):
   ```bash
   # 1. Write JSON to temp file using write tool
   # 2. Pipe file to script
   cat {cwd}/.issue-input.json | bun {baseDir}/scripts/create-issue.ts --stdin
   # 3. Clean up temp file
   rm {cwd}/.issue-input.json
   ```

The script handles:
- Proper Atlassian Document Format (ADF) structure
- Definition of Done as Jira checkboxes (ADF task list; a leading `[ ]`/`[x]` in an item is stripped, `[x]` marks it done)
- Optional `footer` after the Definition of Done
- Wiki markup fallback for inline image embedding (via Jira v2 API)
- Markdown parsing in context field (see below)
- User search for assignee resolution
- Sprint lookup by name or ID
- File attachment upload
- Input validation
- Error handling with detailed messages
- Returns JSON with created issue key and URL

### Markdown Support

The `context` field supports the Markdown subset below, converted to Jira's Atlassian Document Format (ADF) or Jira wiki markup when attachments are embedded. Both paths support headings; fenced code is kept literal.

Supply the body of the context, without a leading `## Context` heading: the script adds the Context and Definition of Done headings itself. Use headings for subsections such as `## Implementation scope` and `### Backend`.

| Markdown | Result |
|----------|--------|
| `#` … `######` | Headings (levels 1–6) |
| `**bold**` | Bold text |
| `` `code` `` | Inline code |
| `[text](url)` | Clickable link |
| `1. item` | Numbered list |
| `- item` | Bullet list |
| ` ```lang ` | Code block with syntax highlighting |

Example context with markdown:
```
"context": "**Problem:**\nThe API returns `500` errors when:\n1. User is not authenticated\n2. Token is expired\n\n**Solution:**\nUse `validateToken()` before each request.\n\n```python\nif not validate_token(token):\n    raise AuthError()\n```\n\n**Reference:** [PR #123](https://github.com/...)"
```

8. **Report Result**
   - On success: Return the created issue URL (e.g., https://apheris.atlassian.net/browse/EN-XXX)
   - On failure: Show error message and offer to retry or save draft locally

## Script Reference

The `scripts/create-issue.ts` script accepts input via:

**Command line arguments:**

```bash
bun create-issue.ts \
  --board "EN" \
  --title "Implement user authentication" \
  --context "We need to add authentication to secure the API endpoints" \
  --definitionOfDone "Unit tests pass" \
  --definitionOfDone "Code reviewed" \
  --definitionOfDone "Documentation updated" \
  --issueType "Task" \
  --assignee "Nina Zorina" \
  --sprint "155" \
  --attachment "/path/to/screenshot.png" \
  --footer "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Add `--dry-run` to print the ADF description as JSON without calling Jira.

**JSON via stdin (recommended for complex content):**

```bash
echo '{
  "board": "EN",
  "title": "Implement user authentication",
  "context": "We need to add authentication to secure the API endpoints.",
  "definitionOfDone": [
    "Unit tests pass with >80% coverage",
    "Code reviewed and approved",
    "Documentation updated"
  ],
  "issueType": "Task",
  "assignee": "Nina Zorina",
  "sprint": "155",
  "attachments": ["/path/to/screenshot.png", "/path/to/mockup.png"],
  "footer": "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
}' | bun create-issue.ts --stdin
```

When `attachments` are provided, the script:
1. Creates the issue with ADF description
2. Uploads each file as a Jira attachment
3. Re-writes the description using Jira wiki markup (v2 API) with `!filename.png!` syntax for inline rendering
4. Reads the description back as ADF and swaps the Definition of Done bullets for checkboxes (wiki markup has no checkbox syntax)

**Moving an existing issue to EN:**

```bash
bun {baseDir}/scripts/move-issue.ts --issue "SOURCE-123" --board "EN" --sprint "current"
```

Move destinations are restricted to EN. Omit `--sprint` when no sprint placement was requested. In `move-issue.ts`, a digits-only sprint value is an internal ID; otherwise use a name fragment or `current` for the sole active sprint. In `create-issue.ts`, JSON numbers are internal IDs, while strings (including digits-only strings) are name fragments. The script waits for the move to complete before assigning the new key to the sprint.

**Updating an existing issue:**

```bash
echo '{
  "board": "EN",
  "title": "Implement user authentication",
  "context": "Updated context with better formatting...",
  "definitionOfDone": ["Updated criteria"],
  "issueKey": "EN-1234"
}' | bun create-issue.ts --stdin --update
```

Note: When updating, only the description (context + definition of done + footer) is modified. The title and issue type are not changed. Assignee and sprint can also be set during updates.

### Handling Multiline Content and Special Characters

When creating issues with complex content (multiline text, special characters, quotes, code blocks), **always use the stdin method with a temporary file** to avoid shell escaping issues:

**Recommended approach:**

1. Write the JSON to a temporary file using the `write` tool
2. Pipe the file content to the script
3. Clean up the temporary file

```bash
# Step 1: Write JSON to temp file (use write tool)
# File: {cwd}/.issue-input.json

# Step 2: Pipe to script
cat {cwd}/.issue-input.json | bun {baseDir}/scripts/create-issue.ts --stdin

# Step 3: Clean up
rm {cwd}/.issue-input.json
```

**Why this approach?**
- Avoids shell escaping issues with quotes, apostrophes, newlines
- Handles multiline content reliably (investigation findings, code snippets, etc.)
- No need to escape special characters like `'`, `"`, `\n`, backticks
- Works with any content length

**Example with complex content:**

```json
{
  "board": "EN",
  "title": "Fix API docs rendering for /api/v1/fine-tune endpoints",
  "context": "The /api/v1/fine-tune* endpoints are not rendering properly.\n\nInvestigation findings:\n\n1. Missing operationId: All fine-tune endpoints have operationId: null\n2. Malformed oneOf in request schema: Uses unnecessary oneOf wrapper\n\nThe ApiDocsMethodView.vue component's resolveRefs() function does not handle the oneOf array properly.\n\nRoot cause: Backend OpenAPI spec generation creates unnecessary oneOf wrappers.",
  "definitionOfDone": [
    "Backend: Remove oneOf wrapper from fine-tune endpoint request schemas",
    "Backend: Add proper operationId values to all fine-tune endpoints",
    "Verify all fine-tune endpoints render correctly in API docs UI"
  ],
  "issueType": "Bug",
  "assignee": "Nina Zorina",
  "sprint": "EN Sprint 155",
  "attachments": ["/tmp/screenshot-misaligned.png", "/tmp/screenshot-aligned.png"]
}
```

**Script output:**

```json
{
	"success": true,
	"key": "EN-1234",
	"id": "12345",
	"url": "https://apheris.atlassian.net/browse/EN-1234"
}
```

## Local regression tests

After changing the skill, run:

```bash
bun test {baseDir}/scripts/*.test.ts
```

These tests make no live Jira requests. They cover ADF and attachment/wiki headings, literal fenced code, lists, inline formatting, screenshot embedding, checkboxes, footers, dry-run, board defaults and mocked issue moves. Importing the scripts does not run their CLIs.

## Cookbook

### Updating an Existing Issue

When asked to update or fix formatting on an existing issue:

1. **Get the issue key** from the user (e.g., EN-1234)
2. **Prepare the updated content** with proper markdown formatting
3. **Write JSON to temp file** with `issueKey` field included
4. **Run the script with `--update` flag**

This also turns a Definition of Done written as plain bullets (or as bullets starting with a literal `[ ]`) into Jira checkboxes. Strip the `[ ]` from the items, or leave it for the script to strip, and keep any trailing attribution line in `footer`.

```bash
# Write to temp file with issueKey
cat {cwd}/.issue-input.json | bun {baseDir}/scripts/create-issue.ts --stdin --update
```

Example JSON for update:
```json
{
  "board": "EN",
  "title": "Original title",
  "issueKey": "EN-1234",
  "context": "**Problem:**\nFormatted content...",
  "definitionOfDone": ["Criterion 1", "Criterion 2"]
}
```

### Question Flow Examples

- IF: User provides a complete description in initial prompt
- THEN: Skip that question, move to next missing field
- EXAMPLES:
  - User: "Create EN issue for implementing dark mode"
  - Agent extracts: Board=EN, Title="Implement dark mode", Context=partial
  - Agent asks: "Can you provide more context? What problem does dark mode solve?"

- IF: User says "skip" or provides empty response for optional field
- THEN: Use default value and continue
- EXAMPLES:
  - Agent: "What type of issue is this? (Default: Task)"
  - User: "skip" or just presses Enter
  - Agent: Sets Issue Type to "Task"

- IF: User wants to edit after preview
- THEN: Ask which field to edit, then return to that specific question
- EXAMPLES:
  - User: "Edit before submitting"
  - Agent: "Which section would you like to edit? (Title, Context, Definition of Done, Issue Type)"
  - User: "Definition of Done"
  - Agent: "What should the Definition of Done criteria be? Current: ['Unit tests pass', 'Code reviewed']"

### Error Handling

- IF: Jira API returns 401 Unauthorized
- THEN: Check credentials file at `~/.config/atlassian-jira/credentials.json` or environment variables
- EXAMPLES:
  - "Authentication failed. Please verify your Jira credentials in ~/.config/atlassian-jira/credentials.json or environment variables."

- IF: Jira API returns 400 Bad Request
- THEN: Check the request payload format, especially the ADF structure
- EXAMPLES:
  - "Failed to create issue. The request format may be invalid. Error: [error details]"

- IF: Network error or timeout
- THEN: Offer to save draft locally and retry later
- EXAMPLES:
  - "Network error while creating issue. Would you like to save a draft locally to submit later?"

- IF: Invalid board specified
- THEN: Ask user to choose from valid boards
- EXAMPLES:
  - "Invalid board 'XY'. Please choose from: EN (Engineering) or AW (Apheris Web)"
