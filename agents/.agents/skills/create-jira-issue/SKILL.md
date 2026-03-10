---
name: create-jira-issue
description: "Create Jira issues for EN (Engineering) or AW (Apheris Web) boards interactively. Use this skill when: create issue, new EN ticket, new AW ticket, jira issue, engineering ticket, create task"
---

# Purpose

This skill guides you through creating a Jira issue on the EN (Engineering) or AW (Apheris Web) board. It ensures all required template fields are filled, asks clarifying questions for missing information, and presents a preview before submission.

## Variables

- JIRA_URL: Jira instance URL (from environment)
- JIRA_USERNAME: Jira username (from environment)
- JIRA_API_TOKEN: Jira API token (from environment)
- Supported project keys: EN, AW

## Instructions

When creating an issue, you must gather information for the issue template which includes:

**Required Fields:**

- **Board**: Which board to create the issue on (EN or AW)
- **Title**: Short, descriptive title for the issue
- **Context**: Background information explaining why this issue exists, what problem it solves, or what feature it implements
- **Definition of Done**: List of criteria that must be met for the issue to be considered complete

**Optional Fields:**

- **Issue Type**: Type of issue (Task, Bug, Story) - defaults to Task

## Workflow

> Execute the following steps in order, top to bottom:

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
   - "Which board should this issue be created on?" (options: EN, AW)
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

6. **Present Summary and Confirm**
   - Show the formatted issue preview to the user
   - Use the `question` tool to ask for confirmation:
     - "Submit as-is"
     - "Edit before submitting"
     - "Cancel"
   - If user wants to edit, go back to step 3 for the specific field

7. **Submit to Jira Using Script**
   - Only proceed after explicit user confirmation
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
   - Input validation
   - Error handling with detailed messages
   - Returns JSON with created issue key and URL

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
  --issueType "Task"
```

**JSON via stdin (recommended for complex content):**

```bash
echo '{
  "board": "EN",
  "title": "Implement user authentication",
  "context": "We need to add authentication to secure the API endpoints. This is required for the upcoming security audit and will enable us to properly track user actions.",
  "definitionOfDone": [
    "Unit tests pass with >80% coverage",
    "Code reviewed and approved",
    "Documentation updated",
    "Integration tests pass",
    "Deployed to staging environment"
  ],
  "issueType": "Task"
}' | bun create-issue.ts --stdin
```

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
  "issueType": "Bug"
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

## Cookbook

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
- THEN: Check JIRA_USERNAME and JIRA_API_TOKEN environment variables
- EXAMPLES:
  - "Authentication failed. Please verify your JIRA_USERNAME and JIRA_API_TOKEN environment variables are set correctly."

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
