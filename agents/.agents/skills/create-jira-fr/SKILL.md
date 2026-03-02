---
name: create-jira-fr
description: "Create Jira Feature Requests (FR board) interactively. Use this skill when: create FR, new feature request, submit FR, jira feature request, FR ticket"
---

# Purpose

This skill guides you through creating a Jira Feature Request (FR) on the FR board. It ensures all required template fields are filled, asks clarifying questions for missing information, and presents a preview before submission.

## Variables

- JIRA_URL: Jira instance URL (from environment)
- JIRA_USERNAME: Jira username (from environment)
- JIRA_API_TOKEN: Jira API token (from environment)
- FR_PROJECT_KEY: FR

## Instructions

When creating a Feature Request, you must gather information for the FR template which includes:

**Required Fields:**

- **Title**: Short, descriptive title for the feature
- **Description**: Brief explanation of what the feature does
- **Use Case**: Written as "As a [role], I want to [action] so that [benefit]"
- **Expected Behavior**: Bullet points describing what should happen when the feature is implemented

**Optional Fields:**

- **Additional Information**: Links, references, related tickets, or any other context

## Workflow

> Execute the following steps in order, top to bottom:

1. **Parse Initial Input**
   - Analyze the user's initial prompt for any pre-filled information
   - Extract: title, description, use case, expected behavior, additional info
   - Note which fields are complete, partial, or missing

2. **Identify Missing Required Fields**
   - Check which required fields are missing or unclear
   - Prepare targeted questions for each missing field

3. **Ask Clarifying Questions**
   - Use the `question` tool to ask about missing/unclear fields
   - Ask questions one section at a time or batch related questions
   - For each question, provide context about what's expected

   Example questions:
   - "What should the title be for this feature request?"
   - "Can you describe the use case? (As a [role], I want to [action] so that [benefit])"
   - "What behavior do you expect when this feature is implemented? (List as bullet points)"
   - "Any additional context, links, or related tickets? (Optional - you can skip this)"

4. **Handle Optional Fields**
   - For optional fields (Additional Information), explicitly offer to skip
   - If user provides empty response or says "skip", mark as skipped

5. **Ask About Footer Checklist**
   - Use the `question` tool to ask about supporting tickets for the footer checklist
   - This helps track which supporting tickets have been created
   - Ask with multiple selection enabled:

   ```
   question: "Which supporting tickets have been created and will be linked to this FR?"
   options (multiple selection):
   - RFC Document
   - Testing Strategy
   - Engineering tasks (covering dev, infra, quality)
   - Documentation tasks
   - None yet (I'll create them later)
   ```

   - Map responses to the `footer` object in the script input:
     - "RFC Document" → `footer.rfcDocument: true`
     - "Testing Strategy" → `footer.testingStrategy: true`
     - "Engineering tasks..." → `footer.engineeringTasks: true`
     - "Documentation tasks" → `footer.documentationTasks: true`

6. **Generate FR Preview**
   - Format the collected information as a Jira FR markdown preview:

   ```markdown
   ## Feature Request Preview

   **Title:** [title]

   ### Description

   [description]

   ### Use Case

   [use case in "As a..." format]

   ### Expected Behavior

   - [bullet point 1]
   - [bullet point 2]
   - ...

   ### Additional Information

   [additional info or "None provided"]
   ```

7. **Present Summary and Confirm**
   - Show the formatted FR preview to the user
   - Use the `question` tool to ask for confirmation:
     - "Submit as-is"
     - "Edit before submitting"
     - "Cancel"
   - If user wants to edit, go back to step 3 for the specific field

8. **Submit to Jira Using Script**
   - Only proceed after explicit user confirmation
   - Use the bundled script to create the FR with proper ADF formatting:

   ```bash
   echo '{"title": "...", "description": "...", "useCase": "...", "expectedBehavior": ["...", "..."], "additionalInfo": "..."}' | \
     npx ts-node /path/to/.opencode/skills/create-jira-fr/scripts/create-fr.ts --stdin
   ```

   The script handles:
   - Proper Atlassian Document Format (ADF) structure
   - Input validation
   - Error handling with detailed messages
   - Returns JSON with created issue key and URL

9. **Report Result**
   - On success: Return the created issue URL (e.g., https://apheris.atlassian.net/browse/FR-XXX)
   - On failure: Show error message and offer to retry or save draft locally

## Script Reference

The `scripts/create-fr.ts` script accepts input via:

**Command line arguments:**

```bash
npx ts-node create-fr.ts \
  --title "Add dark mode to dashboard" \
  --description "Implement a dark mode theme option for the main dashboard" \
  --useCase "As a user, I want to switch to dark mode so that I can reduce eye strain" \
  --expectedBehavior "Toggle switch in settings" \
  --expectedBehavior "All components respect theme" \
  --additionalInfo "Related to accessibility initiative"
```

**JSON via stdin (recommended for complex content):**

```bash
echo '{
  "title": "Add dark mode to dashboard",
  "description": "Implement a dark mode theme option for the main dashboard",
  "useCase": "As a user, I want to switch to dark mode so that I can reduce eye strain during night usage",
  "expectedBehavior": [
    "Toggle switch in settings to enable/disable dark mode",
    "All dashboard components respect the theme setting",
    "User preference is persisted across sessions"
  ],
  "additionalInfo": "Related to accessibility improvements initiative",
  "footer": {
    "rfcDocument": false,
    "testingStrategy": true,
    "engineeringTasks": true,
    "documentationTasks": false
  }
}' | npx ts-node create-fr.ts --stdin
```

**Script output:**

```json
{
	"success": true,
	"key": "FR-658",
	"id": "12345",
	"url": "https://apheris.atlassian.net/browse/FR-658"
}
```

## Cookbook

### Question Flow Examples

- IF: User provides a complete description in initial prompt
- THEN: Skip description question, move to next missing field
- EXAMPLES:
  - User: "Create FR for adding dark mode to the dashboard"
  - Agent extracts: Title="Add dark mode to dashboard", Description=partial
  - Agent asks: "Can you elaborate on the description? What specifically should dark mode include?"

- IF: User says "skip" or provides empty response for optional field
- THEN: Mark field as "None provided" and continue
- EXAMPLES:
  - Agent: "Any additional context or related tickets? (Optional)"
  - User: "skip" or just presses Enter
  - Agent: Sets Additional Information to "None provided"

- IF: User wants to edit after preview
- THEN: Ask which field to edit, then return to that specific question
- EXAMPLES:
  - User: "Edit before submitting"
  - Agent: "Which section would you like to edit? (Title, Description, Use Case, Expected Behavior, Additional Information)"
  - User: "Use Case"
  - Agent: "What should the use case be? Current: 'As a user, I want to...'"

### Error Handling

- IF: Jira API returns 401 Unauthorized
- THEN: Check JIRA_USERNAME and JIRA_API_TOKEN environment variables
- EXAMPLES:
  - "Authentication failed. Please verify your JIRA_USERNAME and JIRA_API_TOKEN environment variables are set correctly."

- IF: Jira API returns 400 Bad Request
- THEN: Check the request payload format, especially the ADF structure
- EXAMPLES:
  - "Failed to create FR. The request format may be invalid. Error: [error details]"

- IF: Network error or timeout
- THEN: Offer to save draft locally and retry later
- EXAMPLES:
  - "Network error while creating FR. Would you like to save a draft locally to submit later?"
